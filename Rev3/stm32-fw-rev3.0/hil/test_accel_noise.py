#!/usr/bin/env python3
"""Accelerometer noise floor: ADXL355 vs LSM6DSOX, board flat and perfectly still.

Answers "is the ADXL355 as quiet as the seismic requirement assumes?". Both
sensors log at the same time for --seconds while nothing moves. For each
sensor and axis:
 * rms noise about a slow trend (ug)
 * noise density from the power spectrum, median over the flat part of the
   band (ug/sqrt(Hz)): the number seismometer specs and the ADXL355 datasheet
   (22.5 ug/sqrt(Hz) at +/-2 g) are written in

    python test_accel_noise.py                      # 60 s
    python test_accel_noise.py --seconds 120 --max-density 30
    python test_accel_noise.py --from-csv results/accelnoise_.../accelnoise_raw.csv

Setup: this measures the floor, so the floor has to be quiet. Concrete floor
(ground level if you can), not a desk; nobody walking nearby; no fans, pumps or
HVAC vents close by; USB cable slack so it can't tug the board. Footsteps 5 m
away show up clearly on the ADXL355. Anything left in the environment shows up
as noise, so the result is an upper bound on the sensor's own noise.

The ADXL355 is logged at its full 125 Hz (every sample). The LSM6DSOX is logged
at 25 Hz to leave serial bandwidth, which folds its higher-frequency noise into
the band: its density here is an approximate comparison, not a spec check.
"""
import os
from pathlib import Path

import numpy as np

from common import (BOARD, G, Report, banner, base_parser, col, countdown, make_results_dir,
                    open_device, plt_setup, read_csv, save_fig, wait_for_enter, write_csv)

SENSORS = {"adxl355": ("ADX", "ADXL355"), "lsm6dsox": ("IMU", "LSM6DSOX")}
COLORS = {"adxl355": "#1d4ed8", "lsm6dsox": "#c2410c"}
AXES = "xyz"
ADXL355_DENSITY_UG = 22.5   # datasheet, +/-2 g range


def acquire(args, out):
    if args.port == "sim":
        os.environ["HIL_SIM_ACCEL"] = "still"   # tell the simulator the board isn't moving
    dev = open_device(args)
    sensors = [s for s, (kind, _) in SENSORS.items() if dev.has(kind)]
    if not sensors:
        raise SystemExit("No accelerometer detected by the firmware.")
    print(f"Logging: {', '.join(SENSORS[s][1] for s in sensors)}")
    if wait_for_enter("Board flat on a concrete floor, cable slack, nobody moving nearby. "
                      f"Capture is {args.seconds:.0f} s.") == "q":
        dev.close()
        return []
    countdown(args.settle, "Step away")
    periods = {"adxl355": args.period, "lsm6dsox": args.imu_period}
    data = dev.stream({SENSORS[s][0]: periods[s] for s in sensors}, args.seconds)
    dev.close()
    rows = []
    for s in sensors:
        for r in data[SENSORS[s][0]]:
            r["sensor"] = s
            rows.append(r)
    if rows:
        write_csv(out / "accelnoise_raw.csv", rows,
                  ["sensor", "host_t", "t_ms", "ax", "ay", "az", "temp_c", "fresh"])
    return rows


def new_samples(rows):
    """ADXL355 rows carry 'fresh'; keep only new samples so repeats don't hide noise."""
    if rows and "fresh" in rows[0] and np.isfinite(rows[0]["fresh"]):
        fresh = [r for r in rows if r["fresh"] == 1]
        if len(fresh) > 50:
            return fresh
    return rows


def detrend(t, v, window_s):
    """Remove slow drift (tilt creep, temperature) with a moving average over window_s."""
    order = np.argsort(t)
    t, v = t[order], v[order]
    c = np.concatenate([[0.0], np.cumsum(v)])
    lo = np.searchsorted(t, t - window_s / 2)
    hi = np.searchsorted(t, t + window_s / 2, side="right")
    return t, v - (c[hi] - c[lo]) / (hi - lo)


def welch(x, fs, nper):
    """One-sided power spectral density (units^2/Hz), Hann window, 50% overlap."""
    nper = min(nper, len(x))
    step = nper // 2
    w = np.hanning(nper)
    scale = fs * np.sum(w ** 2)
    segs = [x[i:i + nper] for i in range(0, len(x) - nper + 1, step)]
    p = np.mean([np.abs(np.fft.rfft((s - s.mean()) * w)) ** 2 for s in segs], axis=0) / scale
    p[1:-1] *= 2
    return np.fft.rfftfreq(nper, 1 / fs), p


def analyze(rows, args, out, show):
    rep = Report(f"{BOARD} accelerometer noise floor")
    names = list(dict.fromkeys(r["sensor"] for r in rows))
    summary, series, spectra = [], {}, {}
    rep.note(f"Board still for the whole capture; drift slower than {args.detrend_s:.0f} s removed.\n")
    rep.note(f"{'sensor':<10}{'axis':<6}{'rate Hz':>8}{'rms ug':>9}{'density ug/rtHz':>17}{'band Hz':>12}")
    for n in names:
        sel = new_samples([r for r in rows if r["sensor"] == n])
        if len(sel) < 100:
            rep.check(f"{SENSORS[n][1]}: data", False, f"only {len(sel)} samples")
            continue
        tf = col(sel, "t_ms") / 1000.0                  # firmware time: steadier than host time
        fs = 1.0 / np.median(np.diff(np.sort(tf)))
        # flat band: above the slow-drift cut, below the sensor's low-pass (ADXL355: ODR/4)
        f_hi = min(0.8 * fs / 4, 0.4 * fs) if n == "adxl355" else 0.4 * fs
        f_lo = max(1.0, 2.0 / args.detrend_s)
        series[n], spectra[n] = {}, {}
        worst = 0.0
        for a in AXES:
            t, v = detrend(tf, col(sel, f"a{a}") / G * 1e6, args.detrend_s)   # m/s^2 -> ug
            # at least ~15 averaged segments so the spectrum isn't a single noisy periodogram
            f, p = welch(v, fs, min(args.nperseg, max(64, len(v) // 8)))
            band = (f >= f_lo) & (f <= f_hi)
            dens = float(np.sqrt(np.median(p[band]))) if band.any() else float("nan")
            s = dict(sensor=n, axis=a, rate_hz=fs, rms_ug=float(v.std()), density_ug_rthz=dens,
                     band_lo_hz=f_lo, band_hi_hz=f_hi)
            summary.append(s)
            series[n][a] = (t - t.min(), v)
            spectra[n][a] = (f, np.sqrt(p))
            worst = max(worst, dens)
            rep.note(f"{SENSORS[n][1]:<10}{a:<6}{fs:8.1f}{s['rms_ug']:9.1f}{dens:17.1f}"
                     f"{f'{f_lo:.0f}-{f_hi:.0f}':>12}")
        if n == "adxl355":
            rep.check("ADXL355 noise density", worst <= args.max_density,
                      f"worst axis {worst:.1f} ug/rtHz (limit {args.max_density:.0f}; datasheet "
                      f"{ADXL355_DENSITY_UG} ug/rtHz)")
        else:
            rep.note(f"    {SENSORS[n][1]} worst-axis density {worst:.0f} ug/rtHz (approximate, reference only)")
    by = {(s["sensor"], s["axis"]): s for s in summary}
    if all(("adxl355", a) in by and ("lsm6dsox", a) in by for a in AXES):
        ratio = np.mean([by[("lsm6dsox", a)]["density_ug_rthz"] / by[("adxl355", a)]["density_ug_rthz"]
                         for a in AXES])
        rep.note(f"\nThe ADXL355's noise density is {ratio:.1f}x lower than the LSM6DSOX's (mean over axes).")
    rep.note(f"ADXL355 datasheet: {ADXL355_DENSITY_UG} ug/rtHz at +/-2 g. Z includes the 1 g it's "
             "measuring, so a tiny tilt shows up as drift there; the detrend removes that.")
    write_csv(out / "accelnoise_summary.csv", summary)

    plt = plt_setup(show)
    names_plot = list(series)
    lim = 1.05 * max(np.abs(series[n][a][1]).max() for n in names_plot for a in AXES)
    for same, fname in ((True, "accelnoise_timeseries.png"), (False, "accelnoise_timeseries_own.png")):
        fig, axes = plt.subplots(3, len(names_plot), figsize=(6.5 * len(names_plot), 8), sharex=True,
                                 squeeze=False)
        for j, n in enumerate(names_plot):
            for k, a in enumerate(AXES):
                ax = axes[k, j]
                t, v = series[n][a]
                ax.plot(t, v, lw=0.5, color=COLORS[n], label=f"{v.std():.0f} ug rms")
                if same:
                    ax.set_ylim(-lim, lim)
                ax.set(ylabel=f"{a.upper()} - trend [ug]")
                ax.legend(fontsize=7, loc="upper right")
            axes[0, j].set_title(f"{SENSORS[n][1]} ({'same scale' if same else 'own scale'})")
            axes[-1, j].set_xlabel("time [s]")
        fig.suptitle("Accelerometer noise, board still" +
                     (": both sensors on the same scale" if same else ""))
        save_fig(fig, out / fname)

    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    styles = {"x": "-", "y": "--", "z": ":"}
    for n in spectra:
        for a in AXES:
            f, d = spectra[n][a]
            ax.loglog(f[1:], d[1:], styles[a], lw=1.0, color=COLORS[n], label=f"{SENSORS[n][1]} {a.upper()}")
    ax.axhline(ADXL355_DENSITY_UG, color="k", ls="--", lw=1, label=f"ADXL355 datasheet {ADXL355_DENSITY_UG} ug/rtHz")
    ax.set(xlabel="frequency [Hz]", ylabel="noise density [ug/sqrt(Hz)]",
           title="Noise spectrum, board still (lower is quieter)")
    ax.legend(fontsize=7, ncol=2)
    save_fig(fig, out / "accelnoise_spectrum.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=60.0, help="still capture length")
    p.add_argument("--settle", type=float, default=5.0, help="countdown after Enter so you can step away")
    p.add_argument("--period", type=int, default=8, help="ADXL355 poll period ms (8 = every 125 Hz sample)")
    p.add_argument("--imu-period", type=int, default=40, help="LSM6DSOX poll period ms")
    p.add_argument("--max-density", type=float, default=45.0,
                   help="ADXL355 noise density limit, ug/sqrt(Hz) (default 2x datasheet)")
    p.add_argument("--detrend-s", type=float, default=5.0, help="drift slower than this is removed, s")
    p.add_argument("--nperseg", type=int, default=512, help="samples per spectrum segment")
    p.add_argument("--from-csv", help="re-analyze an existing accelnoise_raw.csv")
    args = p.parse_args()

    banner("ACCELEROMETER NOISE FLOOR (ADXL355 vs LSM6DSOX)")
    if args.from_csv:
        rows, out = read_csv(Path(args.from_csv)), Path(args.from_csv).parent
    else:
        out = make_results_dir("accelnoise", args.out)
        rows = acquire(args, out)
    if not rows:
        print("No data captured.")
        return
    analyze(rows, args, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
