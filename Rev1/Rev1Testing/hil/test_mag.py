#!/usr/bin/env python3
"""LIS3MDL magnetometer validation: tumble capture, ellipsoid fit (hard/soft iron), field-strength check.

Press Enter, then slowly tumble the board through every orientation for
--seconds. A live "coverage" figure shows how much of the sphere of
directions you've visited; aim for 80%+ (figure-eights while rolling the
board through all faces works well).

Analysis
 * Raw XY / XZ / YZ scatter: uncalibrated data = off-centre, squashed ellipses.
 * Ellipsoid-to-sphere least-squares fit -> hard-iron offset (centre, uT) and
   soft-iron matrix (3x3); same model as MATLAB magcal's 'auto' fit.
 * |B| before and after calibration; after calibration it should be flat.
 * Fit residual: how well a single ellipsoid explains the data.
 * Fitted field strength vs. your local Earth field (NOAA/WMM calculator ->
   "Total Field"; for Boulder it's roughly 52 uT, look up the exact value).

    python test_mag.py --expected-ut 52.1
    python test_mag.py --from-csv results/mag_.../mag_raw.csv --expected-ut 52.1

Do this away from steel desks, laptops, magnets, power bricks and the bench
supply; nearby iron moving relative to the board is not something the fit can
remove.
"""
from pathlib import Path

import numpy as np

from common import (Report, banner, base_parser, col, make_results_dir, open_device, plt_setup,
                    read_csv, save_fig, wait_for_enter, write_csv, write_json)

N_LAT, N_LON = 8, 16  # 128 equal-area direction bins


class Coverage:
    """Tracks which equal-area direction bins have been visited (centre = running min/max midpoint)."""

    def __init__(self):
        self.lo = np.full(3, np.inf)
        self.hi = np.full(3, -np.inf)
        self.pts = []

    def add(self, m):
        m = np.asarray(m, float)
        self.lo, self.hi = np.minimum(self.lo, m), np.maximum(self.hi, m)
        self.pts.append(m)

    def live_fraction(self):
        """Cached version for the live display (recomputed at most 4x per second)."""
        import time
        now = time.time()
        if now - getattr(self, "_t", 0) > 0.25:
            self._t, self._f = now, self.fraction()
        return self._f

    def fraction(self, pts=None, center=None):
        pts = np.asarray(self.pts if pts is None else pts)
        if len(pts) < 10:
            return 0.0
        center = (self.lo + self.hi) / 2 if center is None else center
        v = pts - center
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        lat_bin = np.clip(((v[:, 2] + 1) / 2 * N_LAT).astype(int), 0, N_LAT - 1)  # uniform in z = equal area
        lon_bin = ((np.arctan2(v[:, 1], v[:, 0]) + np.pi) / (2 * np.pi) * N_LON).astype(int) % N_LON
        return len(set(zip(lat_bin, lon_bin))) / (N_LAT * N_LON)


def fit_ellipsoid(m):
    """Least-squares general ellipsoid fit.

    Model: a x^2 + b y^2 + c z^2 + 2d xy + 2e xz + 2f yz + 2g x + 2h y + 2i z = 1
    Returns centre (hard iron), W (soft-iron correction, symmetric), radius R
    such that |W (m - centre)| ~= R for every sample.
    """
    x, y, z = m[:, 0], m[:, 1], m[:, 2]
    D = np.column_stack([x * x, y * y, z * z, 2 * x * y, 2 * x * z, 2 * y * z, 2 * x, 2 * y, 2 * z])
    v, *_ = np.linalg.lstsq(D, np.ones(len(m)), rcond=None)
    A = np.array([[v[0], v[3], v[4]], [v[3], v[1], v[5]], [v[4], v[5], v[2]]])
    b = v[6:9]
    center = -np.linalg.solve(A, b)
    k = 1 + center @ A @ center
    M = A / k
    evals, evecs = np.linalg.eigh(M)
    if np.any(evals <= 0):
        raise ValueError("fit is not an ellipsoid (data too sparse/planar - tumble through more orientations)")
    radii = 1 / np.sqrt(evals)
    R = float(np.prod(radii) ** (1 / 3))  # geometric mean radius = field strength estimate
    W = evecs @ np.diag(np.sqrt(evals)) @ evecs.T * R
    return center, W, R, radii


def acquire(args, out):
    dev = open_device(args)
    cov = Coverage()
    instructions = ("Hold the board away from metal. After Enter, SLOWLY tumble it through every "
                    f"orientation for {args.seconds:.0f} s (roll it over all six faces, add figure-eights).")
    if wait_for_enter(instructions) == "q":
        dev.close()
        return []

    def status(d):
        return f"coverage {cov.live_fraction() * 100:4.0f}%"

    def on_sample(kind, r):
        cov.add((r["mx"], r["my"], r["mz"]))

    data = dev.stream({"MAG": args.period}, args.seconds, status_fn=status, on_sample=on_sample,
                      stop_when=lambda d: args.stop_at_coverage and cov.live_fraction() >= args.stop_at_coverage)
    dev.close()
    rows = data["MAG"]
    if rows:
        write_csv(out / "mag_raw.csv", rows, ["host_t", "t_ms", "mx", "my", "mz"])
    return rows


def analyze(rows, args, out, show):
    rep = Report("Rev 1 LIS3MDL magnetometer validation")
    m = np.column_stack([col(rows, "mx"), col(rows, "my"), col(rows, "mz")])
    m = m[np.isfinite(m).all(axis=1)]
    t = col(rows, "host_t")[: len(m)]
    raw_mag = np.linalg.norm(m, axis=1)
    rep.note(f"Samples: {len(m)} over {t.max() - t.min():.1f} s")
    rep.note(f"Raw |B|: mean {raw_mag.mean():.2f} uT, std {raw_mag.std():.2f} uT "
             f"({100 * raw_mag.std() / raw_mag.mean():.1f}%)  <- varies with orientation if uncalibrated")

    try:
        center, W, R, radii = fit_ellipsoid(m)
    except (ValueError, np.linalg.LinAlgError) as e:
        rep.check("ellipsoid fit", False, str(e))
        rep.save(out)
        return
    cal = (m - center) @ W.T
    cal_mag = np.linalg.norm(cal, axis=1)
    resid = cal_mag - R
    rms_pct = 100 * np.sqrt(np.mean(resid ** 2)) / R
    coverage = Coverage().fraction(m, center)
    axis_ratio = radii.max() / radii.min()

    rep.note(f"\nHard-iron offset [uT]: x={center[0]:+.2f}  y={center[1]:+.2f}  z={center[2]:+.2f}  "
             f"(|offset| = {np.linalg.norm(center):.2f})")
    rep.note("Soft-iron correction matrix W (calibrated = W @ (raw - offset)):")
    for row in W:
        rep.note("    [" + "  ".join(f"{v:+.4f}" for v in row) + "]")
    rep.note(f"Ellipsoid radii [uT]: {', '.join(f'{r:.2f}' for r in radii)}  (max/min = {axis_ratio:.3f})")
    rep.note(f"Fitted field strength: {R:.2f} uT")
    rep.note(f"Calibrated |B|: mean {cal_mag.mean():.2f} uT, std {cal_mag.std():.2f} uT "
             f"({100 * cal_mag.std() / cal_mag.mean():.2f}%)")
    rep.note(f"Fit residual RMS: {rms_pct:.2f}% of field")
    rep.note(f"Orientation coverage: {coverage * 100:.0f}% of {N_LAT * N_LON} direction bins")

    rep.check("orientation coverage", coverage >= args.min_coverage,
              f"{coverage * 100:.0f}% (need {args.min_coverage * 100:.0f}% for a trustworthy fit)")
    rep.check("ellipsoid fit residual", rms_pct <= args.max_resid,
              f"{rms_pct:.2f}% RMS (limit {args.max_resid}%)")
    rep.check("soft-iron distortion modest", axis_ratio <= args.max_axis_ratio,
              f"axis ratio {axis_ratio:.3f} (limit {args.max_axis_ratio})")
    rep.check("hard-iron offset within sensor range", np.abs(center).max() < 400 * 0.5,
              f"max {np.abs(center).max():.1f} uT (4 gauss range = 400 uT)")
    if args.expected_ut:
        err = 100 * (R - args.expected_ut) / args.expected_ut
        rep.check("field strength vs local Earth field", abs(err) <= args.field_tol,
                  f"{R:.2f} uT vs {args.expected_ut:.2f} uT ({err:+.1f}%, tol +/-{args.field_tol}%)")
    else:
        rep.note("\n(pass --expected-ut <NOAA total field> to check absolute field strength)")

    write_json(out / "mag_calibration.json", {
        "hard_iron_offset_uT": center.tolist(), "soft_iron_W": W.tolist(),
"field_strength_uT": R, "radii_uT": radii.tolist(),
        "residual_rms_pct": rms_pct, "coverage": coverage, "expected_uT": args.expected_ut,
        "apply_as": "calibrated = W @ (raw - hard_iron_offset)"})
    write_csv(out / "mag_calibrated.csv", [
        dict(host_t=ti, mx_cal=c[0], my_cal=c[1], mz_cal=c[2], mag_raw=r0, mag_cal=r1)
        for ti, c, r0, r1 in zip(t, cal, raw_mag, cal_mag)])

    # --- plots
    plt = plt_setup(show)
    ref = args.expected_ut or R
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.8))
    th = np.linspace(0, 2 * np.pi, 200)
    for ax, (i, j) in zip(axes, [(0, 1), (0, 2), (1, 2)]):
        ax.scatter(m[:, i], m[:, j], s=3, alpha=0.5, color="#c2410c", label="raw")
        ax.scatter(cal[:, i], cal[:, j], s=3, alpha=0.5, color="#1d4ed8", label="calibrated")
        ax.plot(ref * np.cos(th), ref * np.sin(th), "k--", lw=0.8, label=f"{ref:.1f} uT circle")
        ax.plot(*center[[i, j]], "x", color="#c2410c", ms=10, mew=2)
        ax.plot(0, 0, "+", color="k", ms=10)
        ax.set(xlabel=f"{'XYZ'[i]} [uT]", ylabel=f"{'XYZ'[j]} [uT]", title=f"{'XYZ'[i]}-{'XYZ'[j]}")
        ax.set_aspect("equal", "datalim")
    axes[0].legend(fontsize=8, loc="upper left", markerscale=3)
    fig.suptitle("Magnetometer: raw (off-centre ellipse) vs ellipsoid-calibrated (centred circle)")
    save_fig(fig, out / "mag_projections.png")

    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4), gridspec_kw={"width_ratios": [2.2, 1]})
    a1.plot(t, raw_mag, lw=0.8, color="#c2410c", label="raw |B|")
    a1.plot(t, cal_mag, lw=0.8, color="#1d4ed8", label="calibrated |B|")
    if args.expected_ut:
        a1.axhline(args.expected_ut, color="k", ls="--", lw=1, label="expected (WMM)")
    a1.set(xlabel="time [s]", ylabel="|B| [uT]", title="Field magnitude during tumble")
    a1.legend(fontsize=8)
    bins = np.linspace(min(raw_mag.min(), cal_mag.min()), max(raw_mag.max(), cal_mag.max()), 60)
    a2.hist(raw_mag, bins, alpha=0.6, color="#c2410c", label="raw")
    a2.hist(cal_mag, bins, alpha=0.6, color="#1d4ed8", label="calibrated")
    a2.set(xlabel="|B| [uT]", ylabel="samples", title="Magnitude distribution")
    a2.legend(fontsize=8)
    save_fig(fig, out / "mag_magnitude.png")

    fig = plt.figure(figsize=(6, 5.5))
    ax3 = fig.add_subplot(projection="3d")
    ax3.scatter(*m.T, s=2, alpha=0.4, color="#c2410c", label="raw")
    ax3.scatter(*cal.T, s=2, alpha=0.4, color="#1d4ed8", label="calibrated")
    ax3.set(xlabel="X [uT]", ylabel="Y [uT]", zlabel="Z [uT]", title="3D point cloud")
    ax3.legend(fontsize=8, markerscale=4)
    save_fig(fig, out / "mag_3d.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=60.0, help="tumble capture length")
    p.add_argument("--period", type=int, default=20, help="sample period ms (50 Hz)")
    p.add_argument("--expected-ut", type=float, help="local total field from NOAA/WMM, uT")
    p.add_argument("--field-tol", type=float, default=10.0, help="field strength tolerance, %%")
    p.add_argument("--max-resid", type=float, default=2.0, help="max fit residual RMS, %% of field")
    p.add_argument("--max-axis-ratio", type=float, default=1.25, help="max ellipsoid major/minor radius")
    p.add_argument("--min-coverage", type=float, default=0.7, help="min direction coverage (0-1)")
    p.add_argument("--stop-at-coverage", type=float, default=0.0,
                   help="end capture early once coverage reaches this (0 = run full time)")
    p.add_argument("--from-csv", help="re-analyze an existing mag_raw.csv")
    args = p.parse_args()

    banner("MAGNETOMETER (LIS3MDL) VALIDATION")
    if args.from_csv:
        rows, out = read_csv(Path(args.from_csv)), Path(args.from_csv).parent
    else:
        out = make_results_dir("mag", args.out)
        rows = acquire(args, out)
    if len(rows) < 50:
        print("Not enough data captured.")
        return
    analyze(rows, args, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
