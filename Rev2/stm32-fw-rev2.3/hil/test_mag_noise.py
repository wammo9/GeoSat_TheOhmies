#!/usr/bin/env python3
"""Magnetometer noise floor: RM3100 vs LIS3MDL, board perfectly still.

Answers "can it see a 10-30 nT change at 10 Hz?". Both sensors log at the same
time for --seconds while nothing moves. For each sensor and axis:
 * raw noise: rms scatter of every new sample about a slow trend (nT)
 * 10 Hz noise: samples averaged into 100 ms bins first, then the same rms.
   That's what a 10 Hz loop sees if it averages every conversion in each
   100 ms window; a loop that reads ONE conversion per cycle sees the raw noise.
 * smallest detectable step = 3 x the noise, for both cases

    python test_mag_noise.py                    # 30 s, pass if RM3100 can see 30 nT steps
    python test_mag_noise.py --seconds 60 --delta-nt 10
    python test_mag_noise.py --from-csv results/magnoise_.../magnoise_raw.csv

Setup matters more than usual: nanotesla-level fields move when people walk by,
elevators run, or a laptop's fan/charger is nearby. Put the board on a
non-metal surface, a metre or more from the laptop (long USB cable), and don't
touch the bench. Anything left in the environment shows up as noise, so the
result is an upper bound on the sensor's own noise.
"""
import os
from pathlib import Path

import numpy as np

from common import (BOARD, Report, banner, base_parser, col, countdown, make_results_dir,
                    open_device, plt_setup, read_csv, save_fig, wait_for_enter, write_csv)

SENSORS = {"rm3100": ("RMG", "RM3100"), "lis3mdl": ("MAG", "LIS3MDL")}
AXES = "xyz"
BIN_S = 0.1   # 10 Hz, the flight firmware's magnetometer rate


def acquire(args, out):
    if args.port == "sim":
        os.environ["HIL_SIM_MAG"] = "still"   # tell the simulator the board isn't moving
    dev = open_device(args)
    sensors = [s for s, (kind, _) in SENSORS.items() if dev.has(kind)]
    if not sensors:
        raise SystemExit("No magnetometer detected by the firmware.")
    print(f"Logging: {', '.join(SENSORS[s][1] for s in sensors)}")
    if wait_for_enter("Board on a non-metal surface, laptop a metre away, nobody touching the bench. "
                      f"Capture is {args.seconds:.0f} s.") == "q":
        dev.close()
        return []
    countdown(args.settle, "Step back")
    data = dev.stream({SENSORS[s][0]: args.period for s in sensors}, args.seconds)
    dev.close()
    rows = []
    for s in sensors:
        for r in data[SENSORS[s][0]]:
            r["sensor"] = s
            rows.append(r)
    if rows:
        write_csv(out / "magnoise_raw.csv", rows, ["sensor", "host_t", "t_ms", "mx", "my", "mz", "fresh"])
    return rows


def new_samples(rows):
    """RM3100 rows carry 'fresh'; keep only new conversions so repeats don't hide noise."""
    if rows and "fresh" in rows[0] and np.isfinite(rows[0]["fresh"]):
        fresh = [r for r in rows if r["fresh"] == 1]
        if len(fresh) > 20:
            return fresh
    return rows


def detrend(t, v, window_s):
    """Remove slow drift with a moving average over window_s (keeps the fast noise)."""
    out = np.empty_like(v)
    for i, ti in enumerate(t):
        sel = np.abs(t - ti) <= window_s / 2
        out[i] = v[i] - v[sel].mean()
    return out


def bin_average(t, v, width):
    idx = np.floor((t - t.min()) / width).astype(int)
    counts = np.bincount(idx)
    sums = np.bincount(idx, weights=v)
    keep = counts > 0
    return (np.nonzero(keep)[0] + 0.5) * width + t.min(), sums[keep] / counts[keep]


def analyze(rows, args, out, show):
    rep = Report(f"{BOARD} magnetometer noise floor")
    names = list(dict.fromkeys(r["sensor"] for r in rows))
    summary, series = [], {}
    rep.note(f"Board still for the whole capture; drift slower than {args.detrend_s:.0f} s removed.\n")
    rep.note(f"{'sensor':<9}{'axis':<6}{'rate Hz':>8}{'raw nT':>9}{'10 Hz nT':>10}"
             f"{'step, 1 read':>14}{'step, 10 Hz avg':>17}")
    for n in names:
        sel = new_samples([r for r in rows if r["sensor"] == n])
        t = col(sel, "host_t")
        if len(t) < 30:
            rep.check(f"{SENSORS[n][1]}: data", False, f"only {len(t)} samples")
            continue
        rate = (len(t) - 1) / (t.max() - t.min())
        series[n] = {}
        worst_step = 0.0
        for a in AXES:
            v = col(sel, f"m{a}") * 1000.0   # uT -> nT
            raw = detrend(t, v, args.detrend_s)
            tb, vb = bin_average(t, v, BIN_S)
            b10 = detrend(tb, vb, args.detrend_s)
            s = dict(sensor=n, axis=a, rate_hz=rate, raw_noise_nt=float(raw.std()),
                     noise_10hz_nt=float(b10.std()), step_3sigma_nt=float(3 * b10.std()),
                     step_1read_nt=float(3 * raw.std()),
                     mean_ut=float(v.mean() / 1000))
            summary.append(s)
            series[n][a] = (t, raw, tb, b10)
            worst_step = max(worst_step, s["step_3sigma_nt"])
            rep.note(f"{SENSORS[n][1]:<9}{a:<6}{rate:8.1f}{s['raw_noise_nt']:9.1f}{s['noise_10hz_nt']:10.1f}"
                     f"{s['step_1read_nt']:14.1f}{s['step_3sigma_nt']:17.1f}")
        if n == "rm3100":
            rep.check("RM3100 can resolve the target step at 10 Hz (averaged)", worst_step <= args.delta_nt,
                      f"worst axis 3-sigma {worst_step:.1f} nT (target {args.delta_nt:.0f} nT)")
            one = max(x["step_1read_nt"] for x in summary if x["sensor"] == n)
            rep.note(f"    RM3100 reading one conversion per 100 ms instead: worst-axis step {one:.1f} nT "
                     f"({'meets' if one <= args.delta_nt else 'misses'} the {args.delta_nt:.0f} nT target)")
        else:
            rep.note(f"    {SENSORS[n][1]} worst-axis 3-sigma step: {worst_step:.1f} nT (reference only)")
    by = {(s["sensor"], s["axis"]): s for s in summary}
    if all(("rm3100", a) in by and ("lis3mdl", a) in by for a in AXES):
        ratio = np.mean([by[("lis3mdl", a)]["noise_10hz_nt"] / by[("rm3100", a)]["noise_10hz_nt"]
                         for a in AXES])
        rep.note(f"\nAt 10 Hz the RM3100 is {ratio:.1f}x quieter than the LIS3MDL (mean over axes).")
    rep.note("RM3100 datasheet: ~15 nT noise at cycle count 200 (75 LSB/uT, 13 nT per count). "
             "LIS3MDL: ~320 nT rms in ultra-high-performance mode.")
    write_csv(out / "magnoise_summary.csv", summary)

    plt = plt_setup(show)
    names_plot = list(series)
    colors = {"rm3100": "#1d4ed8", "lis3mdl": "#c2410c"}
    # One y-limit for every panel: the largest excursion of any sensor on any axis
    lim = 1.05 * max(np.abs(series[n][a][1]).max() for n in names_plot for a in AXES)
    for same, fname in ((True, "magnoise_timeseries.png"), (False, "magnoise_timeseries_own.png")):
        fig, axes = plt.subplots(3, len(names_plot), figsize=(6.5 * len(names_plot), 8), sharex=True,
                                 squeeze=False)
        for j, n in enumerate(names_plot):
            for k, a in enumerate(AXES):
                ax = axes[k, j]
                t, raw, tb, b10 = series[n][a]
                ax.plot(t, raw, lw=0.5, alpha=0.35, color=colors[n],
                        label=f"every sample ({raw.std():.0f} nT rms)")
                ax.plot(tb, b10, lw=1.2, color=colors[n], label=f"10 Hz average ({b10.std():.0f} nT rms)")
                ax.axhspan(-args.delta_nt / 2, args.delta_nt / 2, color="k", alpha=0.08,
                           label=f"{args.delta_nt:.0f} nT target" if k == 0 else None)
                if same:
                    ax.set_ylim(-lim, lim)
                ax.set(ylabel=f"{a.upper()} - trend [nT]")
                ax.legend(fontsize=7, loc="upper right")
            axes[0, j].set_title(f"{SENSORS[n][1]} ({'same scale' if same else 'own scale'})")
            axes[-1, j].set_xlabel("time [s]")
        fig.suptitle("Magnetometer noise, board still" +
                     (": both sensors on the same scale" if same else ""))
        save_fig(fig, out / fname)

    fig, ax = plt.subplots(figsize=(7.5, 4))
    xs = np.arange(3)
    w = 0.38
    for i, n in enumerate(series):
        vals = [by[(n, a)]["step_3sigma_nt"] for a in AXES]
        ax.bar(xs + (i - (len(series) - 1) / 2) * w, vals, w, color=colors[n], label=SENSORS[n][1])
    ax.axhline(args.delta_nt, color="k", ls="--", lw=1, label=f"target step {args.delta_nt:.0f} nT")
    ax.set_xticks(xs, [a.upper() for a in AXES])
    ax.set(ylabel="smallest detectable step at 10 Hz [nT]", yscale="log",
           title="3-sigma step per axis (lower is better)")
    ax.legend(fontsize=8)
    save_fig(fig, out / "magnoise_steps.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=30.0, help="still capture length")
    p.add_argument("--settle", type=float, default=3.0, help="countdown after Enter so you can step back")
    p.add_argument("--period", type=int, default=20, help="poll period ms")
    p.add_argument("--delta-nt", type=float, default=30.0,
                   help="smallest field change the RM3100 must resolve at 10 Hz, nT")
    p.add_argument("--detrend-s", type=float, default=5.0, help="drift slower than this is removed, s")
    p.add_argument("--from-csv", help="re-analyze an existing magnoise_raw.csv")
    args = p.parse_args()

    banner("MAGNETOMETER NOISE FLOOR (RM3100 vs LIS3MDL)")
    if args.from_csv:
        rows, out = read_csv(Path(args.from_csv)), Path(args.from_csv).parent
    else:
        out = make_results_dir("magnoise", args.out)
        rows = acquire(args, out)
    if not rows:
        print("No data captured.")
        return
    analyze(rows, args, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()