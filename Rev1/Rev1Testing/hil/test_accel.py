#!/usr/bin/env python3
"""LSM6DSOX accelerometer validation: six-orientation 1 g test + vector-magnitude test.

The script walks you through six static orientations (+Z, -Z, +X, -X, +Y, -Y
pointing UP). For each one: orient the board, press Enter, keep it still for a
short settle countdown and then a --hold second capture. If the board moved
during the hold you're offered a redo.

Analysis
 * 1 g / polarity: the up axis should read +1 g, the other two ~0 g.
 * Six-point calibration: per-axis offset = (up + down)/2, scale = (up - down)/2.
 * Vector magnitude sqrt(x^2+y^2+z^2) should be 1.000 g in every orientation.
 * Gyro zero-rate bias while still (bonus, comes for free).

    python test_accel.py
    python test_accel.py --hold 10 --tol 0.05
    python test_accel.py --from-csv results/accel_.../accel_raw.csv

Use the axis arrows printed on the sensor breakout / your PCB silkscreen, and a
level surface (a 1 deg tilt puts ~17 mg on a "zero" axis). Pressing the board
against a square block or a table edge helps for the on-edge orientations.
"""
from pathlib import Path

import numpy as np

from common import (G, Report, ask_yes, banner, base_parser, col, countdown, make_results_dir,
                    open_device, plt_setup, read_csv, save_fig, wait_for_enter, write_csv)

ORIENTATIONS = [
    ("+Z", (0, 0, 1),  "Board FLAT, component side UP (sensor +Z arrow pointing to the ceiling)."),
    ("-Z", (0, 0, -1), "Board FLAT, flipped UPSIDE DOWN (component side facing the table)."),
    ("+X", (1, 0, 0),  "Board on its edge so the sensor's +X arrow points STRAIGHT UP."),
    ("-X", (-1, 0, 0), "Board on its edge so the sensor's +X arrow points STRAIGHT DOWN."),
    ("+Y", (0, 1, 0),  "Board on its edge so the sensor's +Y arrow points STRAIGHT UP."),
    ("-Y", (0, -1, 0), "Board on its edge so the sensor's +Y arrow points STRAIGHT DOWN."),
]
AXES = "xyz"


def to_g(rows):
    return np.column_stack([col(rows, f"a{a}") for a in AXES]) / G


def acquire(args, out):
    dev = open_device(args)
    rows = []
    quit_ = False
    for i, (name, _, text) in enumerate(ORIENTATIONS, 1):
        while True:
            if wait_for_enter(f"[{i}/6] {name} UP — {text}") == "q":
                quit_ = True
                break
            countdown(args.settle, "Hands off")
            data = dev.stream({"IMU": args.period}, args.hold,
                              status_fn=lambda d: _live(d["IMU"]))
            imu = data["IMU"]
            a = to_g(imu) if imu else np.zeros((1, 3))
            mean, std = a.mean(axis=0), a.std(axis=0)
            print(f"  mean [g]: x={mean[0]:+.3f} y={mean[1]:+.3f} z={mean[2]:+.3f}   "
                  f"|a|={np.linalg.norm(mean):.3f}   std max={std.max() * 1000:.1f} mg")
            problems = []
            if std.max() > args.max_std:
                problems.append(f"board moved (std {std.max() * 1000:.0f} mg > {args.max_std * 1000:.0f} mg)")
            if np.argmax(np.abs(mean)) != np.argmax(np.abs(ORIENTATIONS[i - 1][1])):
                problems.append("a different axis is pointing up than expected")
            if problems:
                print("  !! " + "; ".join(problems))
            if not problems and not args.confirm:
                break
            if ask_yes("Accept this capture?", default=not problems):
                break
        if quit_:
            break
        for r in imu:
            r["orientation"] = name
        rows += imu
    dev.close()
    if rows:
        write_csv(out / "accel_raw.csv", rows,
                  ["orientation", "host_t", "t_ms", "ax", "ay", "az", "gx", "gy", "gz", "die_c"])
    return rows


def _live(imu):
    if not imu:
        return ""
    r = imu[-1]
    return f"x={r['ax'] / G:+.2f} y={r['ay'] / G:+.2f} z={r['az'] / G:+.2f} g"


def analyze(rows, args, out, show):
    rep = Report("Rev 1 LSM6DSOX accelerometer validation")
    done = [o for o in ORIENTATIONS if any(r["orientation"] == o[0] for r in rows)]
    means, stds, mags = {}, {}, {}
    rep.note(f"{'orient':<7}{'x [g]':>9}{'y [g]':>9}{'z [g]':>9}{'|a| [g]':>9}{'max err [mg]':>14}")
    for name, exp, _ in done:
        sel = [r for r in rows if r["orientation"] == name]
        a = to_g(sel)
        means[name], stds[name] = a.mean(axis=0), a.std(axis=0)
        mags[name] = np.linalg.norm(a, axis=1)
        err = means[name] - np.array(exp)
        rep.note(f"{name:<7}" + "".join(f"{v:+9.3f}" for v in means[name]) +
                 f"{mags[name].mean():9.4f}{np.abs(err).max() * 1000:14.1f}")
        up = int(np.argmax(np.abs(exp)))
        rep.check(f"{name}: polarity/1 g on {AXES[up].upper()}", abs(err[up]) <= args.tol,
                  f"{means[name][up]:+.3f} g (expect {exp[up]:+d} +/-{args.tol})")
        others = [k for k in range(3) if k != up]
        worst = max(abs(err[k]) for k in others)
        rep.check(f"{name}: cross axes ~0 g", worst <= args.tol,
                  f"worst {worst * 1000:.1f} mg (limit {args.tol * 1000:.0f} mg)")

    if mags:
        per = {n: m.mean() for n, m in mags.items()}
        worst = max(per, key=lambda n: abs(per[n] - 1))
        rep.check("|a| = 1 g in every orientation", abs(per[worst] - 1) <= args.mag_tol,
                  f"worst {worst}: {per[worst]:.4f} g, range {min(per.values()):.3f}-"
                  f"{max(per.values()):.3f} (tol +/-{args.mag_tol})")

    # Six-point calibration from opposing pairs
    rep.note("\nSix-point calibration (from opposing orientations):")
    calib = {}
    for k, ax in enumerate(AXES):
        p, n = f"+{ax.upper()}", f"-{ax.upper()}"
        if p in means and n in means:
            off = (means[p][k] + means[n][k]) / 2
            scale = (means[p][k] - means[n][k]) / 2
            calib[ax] = (off, scale)
            rep.note(f"  {ax}: offset {off * 1000:+7.1f} mg   scale {scale:.4f} ({(scale - 1) * 100:+.2f}%)")
            rep.check(f"{ax} zero-g offset", abs(off) <= args.offset_tol,
                      f"{off * 1000:+.1f} mg (limit +/-{args.offset_tol * 1000:.0f} mg)")
            rep.check(f"{ax} scale factor", abs(scale - 1) <= args.scale_tol,
                      f"{(scale - 1) * 100:+.2f}% (limit +/-{args.scale_tol * 100:.1f}%)")
        else:
            rep.note(f"  {ax}: need both {p} and {n} captures")

    gyro = np.column_stack([col(rows, f"g{a}") for a in AXES]) * 180 / np.pi
    bias = gyro.mean(axis=0)
    rep.note(f"\nGyro zero-rate bias while still [dps]: " + "  ".join(f"{a}={b:+.3f}" for a, b in zip(AXES, bias)))
    rep.check("gyro bias at rest", np.abs(bias).max() <= args.gyro_tol,
              f"max {np.abs(bias).max():.2f} dps (limit {args.gyro_tol})")
    write_csv(out / "accel_summary.csv", [
        dict(orientation=n, mean_x_g=m[0], mean_y_g=m[1], mean_z_g=m[2], std_x_mg=stds[n][0] * 1000,
             std_y_mg=stds[n][1] * 1000, std_z_mg=stds[n][2] * 1000, mag_g=mags[n].mean())
        for n, m in means.items()])

    # --- plots
    plt = plt_setup(show)
    names = list(means)
    fig, ax = plt.subplots(figsize=(10, 4.2))
    w = 0.26
    colors = ["#2a6fdb", "#e0832b", "#2f9e6a"]
    xs = np.arange(len(names))
    for k in range(3):
        ax.bar(xs + (k - 1) * w, [means[n][k] for n in names], w, color=colors[k], label=f"{AXES[k].upper()} axis")
        ax.scatter(xs + (k - 1) * w, [dict((o[0], o[1]) for o in ORIENTATIONS)[n][k] for n in names],
                   marker="_", s=300, color="k", zorder=3, label="expected" if k == 0 else None)
    ax.set_xticks(xs, [f"{n} up" for n in names])
    ax.set(ylabel="acceleration [g]", title="Mean reading per orientation (black ticks = ideal)", ylim=(-1.25, 1.45))
    ax.axhline(0, color="k", lw=0.6)
    ax.legend(ncol=4, fontsize=8)
    save_fig(fig, out / "accel_orientations.png")

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
    offset = 0.0
    for n in names:
        sel = [r for r in rows if r["orientation"] == n]
        t = col(sel, "host_t") + offset
        a = to_g(sel)
        for k in range(3):
            a1.plot(t, a[:, k], lw=0.8, color=colors[k], label=f"{AXES[k].upper()}" if n == names[0] else None)
        a2.plot(t, mags[n], lw=0.8, color="#6b4fbb")
        a2.text(t.mean(), 1 + args.mag_tol * 1.6, n, ha="center", fontsize=8)
        offset = t.max() + 1.5
    a1.set(ylabel="accel [g]", title="Raw axes over all holds")
    a1.legend(ncol=3, fontsize=8)
    a2.axhspan(1 - args.mag_tol, 1 + args.mag_tol, color="k", alpha=0.07)
    a2.axhline(1, color="k", ls="--", lw=0.8)
    a2.set(ylabel="|a| [g]", xlabel="time [s] (holds placed end to end)", title="Vector magnitude",
           ylim=(1 - args.mag_tol * 3, 1 + args.mag_tol * 3))
    save_fig(fig, out / "accel_magnitude.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--hold", type=float, default=10.0, help="capture seconds per orientation")
    p.add_argument("--settle", type=float, default=2.0, help="countdown after Enter before capture")
    p.add_argument("--period", type=int, default=20, help="sample period ms (50 Hz)")
    p.add_argument("--tol", type=float, default=0.05, help="per-axis tolerance vs ideal, g")
    p.add_argument("--mag-tol", type=float, default=0.05, help="vector magnitude tolerance, g")
    p.add_argument("--offset-tol", type=float, default=0.04, help="zero-g offset limit, g")
    p.add_argument("--scale-tol", type=float, default=0.03, help="scale error limit (0.03 = 3%%)")
    p.add_argument("--gyro-tol", type=float, default=3.0, help="gyro bias limit at rest, dps")
    p.add_argument("--max-std", type=float, default=0.02, help="std (g) above which a hold counts as moved")
    p.add_argument("--confirm", action="store_true", help="ask to accept every capture, not just bad ones")
    p.add_argument("--from-csv", help="re-analyze an existing accel_raw.csv")
    args = p.parse_args()

    banner("ACCELEROMETER (LSM6DSOX) VALIDATION")
    if args.from_csv:
        rows, out = read_csv(Path(args.from_csv)), Path(args.from_csv).parent
    else:
        out = make_results_dir("accel", args.out)
        rows = acquire(args, out)
    if not rows:
        print("No data captured.")
        return
    analyze(rows, args, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
