#!/usr/bin/env python3
"""TMP117 validation: lab ambient, outdoors, and a heat ramp against a reference thermometer.

For each condition: you set it up, press Enter, the script logs the TMP117 (and
the LSM6DSOX die temperature as a secondary on-board reference) for --seconds,
then asks for your reference reading (handheld thermometer).

    python test_temp.py                       # 25 s per condition, ramp 60 s
    python test_temp.py --seconds 30 --tol 0.5
    python test_temp.py --from-csv results/temp_.../temp_raw.csv

The TMP117 converts every 500 ms (8 averaged conversions, set in tmp117.c). The
script polls every 250 ms and uses only the 'fresh' rows (new conversions) for
the statistics, so repeated values don't hide noise.

Tips
 * Let the board sit in a new environment ~5 min before pressing Enter. The
   script reports the drift rate so you can see if it hadn't settled.
 * The TMP117 is good to +/-0.1 C (max, -20..50 C), so the reference
   thermometer is almost always the bigger error. Put the probe right next to
   the sensor and use the best one you can borrow; --tol should reflect the
   reference's accuracy, not the TMP117's.
 * Heat: hand warming or a heat gun on LOW ~30 cm away, aimed at the TMP117
   only. Stop well before ~80 C to protect the board, battery and plastics. The
   ramp is about response and monotonic tracking, not absolute accuracy.
 * The breakout's small copper area means it tracks air fast; touching it reads
   your finger.
"""
import json
from pathlib import Path

import numpy as np

from common import (BOARD, Report, ask_float, banner, base_parser, col, make_results_dir,
                    open_device, plt_setup, read_csv, save_fig, wait_for_enter, write_csv)

CONDITIONS = [
    ("lab_ambient", "Board on the bench at room temperature, away from your laptop's exhaust.", False),
    ("outside", "Take the board outside (shade, not direct sun) and let it settle ~5 min.", False),
    ("heat_ramp", "Warm the TMP117 (hand or heat gun on LOW, ~30 cm). Start when you press Enter.", True),
]
TMP117_LSB_C = 0.0078125
TMP_FIELDS = ["label", "host_t", "t_ms", "raw", "temp_c", "die_c", "fresh"]


def acquire(args, out):
    dev = open_device(args)
    rows, refs = [], {}
    for name, instructions, is_ramp in CONDITIONS:
        secs = args.ramp_seconds if is_ramp else args.seconds
        ans = wait_for_enter(f"[{name}] {instructions}  ({secs:.0f} s capture)  s = skip")
        if ans == "q":
            break
        if ans == "s":
            continue
        data = dev.stream({"TMP": args.period}, secs,
                          status_fn=lambda d: f"TMP117 {d['TMP'][-1]['temp_c']:.3f} C" if d["TMP"] else "")
        for r in data["TMP"]:
            r["label"] = name
        rows += data["TMP"]
        prompt = "Reference temperature at END of ramp in C (blank = none)" if is_ramp \
            else "Reference thermometer reading in C (blank = none)"
        refs[name] = ask_float(prompt)
    dev.close()
    write_csv(out / "temp_raw.csv", rows, TMP_FIELDS)
    (out / "temp_refs.json").write_text(json.dumps(refs, indent=2))
    return rows, refs


def fresh_only(rows):
    """New conversions only (falls back to every finite row for CSVs without the column)."""
    good = [r for r in rows if np.isfinite(r["temp_c"])]
    if good and "fresh" in good[0]:
        fresh = [r for r in good if r["fresh"] == 1]
        if len(fresh) >= 3:
            return fresh
    return good


def analyze(rows, refs, args, out, show):
    rep = Report(f"{BOARD} TMP117 validation")
    labels = list(dict.fromkeys(r["label"] for r in rows))
    summary = []
    rep.note(f"{'condition':<13}{'mean C':>9}{'noise':>7}{'drift C/min':>12}{'die C':>7}{'ref C':>7}{'error':>8}")
    for lab in labels:
        sel = fresh_only([r for r in rows if r["label"] == lab])
        if len(sel) < 3:
            rep.check(f"{lab}: data", False, f"only {len(sel)} valid readings")
            continue
        t, temp, die = col(sel, "host_t"), col(sel, "temp_c"), col(sel, "die_c")
        slope = np.polyfit(t, temp, 1)[0] * 60 if len(t) > 2 else float("nan")
        is_ramp = lab.startswith("heat")
        ref = refs.get(lab)
        # For the ramp, compare the last 3 s to the end-of-ramp reference
        measured = temp[t > t.max() - 3].mean() if is_ramp else temp.mean()
        err = measured - ref if ref is not None else float("nan")
        # Noise = scatter about the linear trend, so slow room drift isn't counted as noise
        resid = temp - np.polyval(np.polyfit(t, temp, 1), t) if len(t) > 2 else temp - temp.mean()
        s = dict(label=lab, n=len(sel), mean_c=temp.mean(), std_c=temp.std(), noise_c=resid.std(),
                 drift_c_per_min=slope,
                 die_c=np.nanmean(die) if np.isfinite(die).any() else float("nan"),
                 min_c=temp.min(), max_c=temp.max(), ref_c=ref, error_c=err)
        summary.append(s)
        rep.note(f"{lab:<13}{measured:9.3f}{s['noise_c']:7.3f}{slope:12.3f}{s['die_c']:7.1f}"
                 f"{ref if ref is not None else float('nan'):7.1f}{err:+8.2f}")

        rep.check(f"{lab}: noise", s["noise_c"] < args.max_noise or is_ramp,
                  f"{s['noise_c']:.3f} C rms about trend (limit {args.max_noise})" if not is_ramp
                  else "n/a for ramp")
        if is_ramp:
            rise = temp[t > t.max() - 3].mean() - temp[t < t.min() + 3].mean()
            rep.check(f"{lab}: responds to heat", rise > args.min_rise,
                      f"rose {rise:.1f} C during capture (need > {args.min_rise} C)")
            steps = np.diff(temp)
            backwards = float(abs(steps[steps < 0].sum()))
            rep.note(f"    ramp: {rise:.1f} C rise, {backwards:.2f} C of downward steps along the way")
        else:
            settled = abs(slope) < args.max_drift
            rep.check(f"{lab}: settled", settled, f"drift {slope:+.2f} C/min (limit {args.max_drift})")
        if ref is not None and is_ramp:
            # A handheld reading during a moving ramp isn't a fair accuracy reference: report only
            rep.note(f"    {lab} end-of-ramp vs reference: {err:+.1f} C (informational)")
        elif ref is not None:
            rep.check(f"{lab}: accuracy vs reference", abs(err) <= args.tol,
                      f"{err:+.2f} C (tolerance +/-{args.tol} C)")
    rep.note(f"\nTMP117 datasheet: +/-0.1 C max from -20 to 50 C, {TMP117_LSB_C} C resolution. "
             "Agreement here is limited by the reference thermometer.")
    rep.note("noise = rms scatter of new conversions about a straight-line fit (drift removed).")
    rep.note("die C = LSM6DSOX internal temperature (sits a few C above ambient from self-heating).")
    write_csv(out / "temp_summary.csv", summary)

    plt = plt_setup(show)
    fig, axes = plt.subplots(1, len(labels), figsize=(4.6 * len(labels), 3.8), squeeze=False)
    for ax, lab in zip(axes[0], labels):
        sel = fresh_only([r for r in rows if r["label"] == lab])
        if not sel:
            continue
        t = col(sel, "host_t")
        ax.plot(t, col(sel, "temp_c"), lw=1, label="TMP117")
        if np.isfinite(col(sel, "die_c")).any():
            ax.plot(t, col(sel, "die_c"), lw=1, alpha=0.7, label="LSM6DSOX die")
        if refs.get(lab) is not None:
            ax.axhline(refs[lab], color="k", ls="--", lw=1, label="reference")
            if not lab.startswith("heat"):
                ax.axhspan(refs[lab] - args.tol, refs[lab] + args.tol, color="k", alpha=0.06)
        ax.set(title=lab, xlabel="time [s]", ylabel="temperature [C]")
        ax.legend(fontsize=8)
    save_fig(fig, out / "temp_timeseries.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=25.0, help="capture per static condition")
    p.add_argument("--ramp-seconds", type=float, default=60.0, help="heat-ramp capture length")
    p.add_argument("--period", type=int, default=250, help="poll period ms (TMP117 converts every 500 ms)")
    p.add_argument("--tol", type=float, default=1.0,
                   help="accuracy tolerance vs reference, C (set to your reference's accuracy)")
    p.add_argument("--max-noise", type=float, default=0.05, help="max rms noise in a static window, C")
    p.add_argument("--max-drift", type=float, default=0.3, help="max drift in a static window, C/min")
    p.add_argument("--min-rise", type=float, default=3.0, help="min temperature rise during the ramp, C")
    p.add_argument("--from-csv", help="re-analyze temp_raw.csv (temp_refs.json read from same folder)")
    args = p.parse_args()

    banner("TEMPERATURE (TMP117) VALIDATION")
    if args.from_csv:
        out = Path(args.from_csv).parent
        rows = read_csv(Path(args.from_csv))
        ref_file = out / "temp_refs.json"
        refs = json.loads(ref_file.read_text()) if ref_file.exists() else {}
    else:
        out = make_results_dir("temp", args.out)
        rows, refs = acquire(args, out)
    if not rows:
        print("No data captured.")
        return
    analyze(rows, refs, args, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
