#!/usr/bin/env python3
"""TMP36 validation: lab ambient, outdoors, and a heat-gun ramp against a reference thermometer.

For each condition: you set it up, press Enter, the script logs TMP36 (and the
LSM6DSOX die temperature as a secondary on-board reference) for --seconds,
then asks for your reference reading (phone / handheld thermometer).

    python test_temp.py                       # 25 s per condition, ramp 60 s
    python test_temp.py --seconds 30 --tol 2.5
    python test_temp.py --from-csv results/temp_.../temp_raw.csv

Tips
 * Let the board sit in a new environment ~5 min before pressing Enter. The
   script reports the drift rate so you can see if it hadn't settled.
 * A phone weather app gives the airport's temperature, not yours. A cheap
   handheld thermometer next to the board is a much better reference.
 * Heat gun: low setting, ~30 cm away, aim at the TMP36 only. Stop well before
   ~80 C to protect the board, battery and plastics. The ramp is about
   response and monotonic tracking, not absolute accuracy.
 * The ESP32 warms the PCB, so a small positive bias vs ambient is expected.
"""
import json
from pathlib import Path

import numpy as np

from common import (Report, ask_float, banner, base_parser, col, make_results_dir, open_device,
                    plt_setup, read_csv, save_fig, wait_for_enter, write_csv)

CONDITIONS = [
    ("lab_ambient", "Board on the bench at room temperature, away from your laptop's exhaust.", False),
    ("outside", "Take the board outside (shade, not direct sun) and let it settle ~5 min.", False),
    ("heat_gun", "Heat gun on LOW, ~30 cm from the TMP36. Start heating when you press Enter.", True),
]


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
                          status_fn=lambda d: f"TMP36 {d['TMP'][-1]['temp_c']:.1f} C" if d["TMP"] else "")
        for r in data["TMP"]:
            r["label"] = name
        rows += data["TMP"]
        prompt = "Reference temperature at END of ramp in C (blank = none)" if is_ramp \
            else "Reference thermometer reading in C (blank = none)"
        refs[name] = ask_float(prompt)
    dev.close()
    write_csv(out / "temp_raw.csv", rows, ["label", "host_t", "t_ms", "mv", "temp_c", "die_c"])
    (out / "temp_refs.json").write_text(json.dumps(refs, indent=2))
    return rows, refs


def analyze(rows, refs, args, out, show):
    rep = Report("Rev 1 TMP36 validation")
    labels = list(dict.fromkeys(r["label"] for r in rows))
    summary = []
    rep.note(f"{'condition':<13}{'mean C':>8}{'std':>6}{'drift C/min':>12}{'die C':>7}{'ref C':>7}{'error':>7}")
    for lab in labels:
        sel = [r for r in rows if r["label"] == lab]
        t, temp, die = col(sel, "host_t"), col(sel, "temp_c"), col(sel, "die_c")
        slope = np.polyfit(t, temp, 1)[0] * 60 if len(t) > 2 else float("nan")
        is_ramp = lab == "heat_gun"
        ref = refs.get(lab)
        # For the ramp, compare the last 3 s to the end-of-ramp reference
        measured = temp[t > t.max() - 3].mean() if is_ramp else temp.mean()
        err = measured - ref if ref is not None else float("nan")
        s = dict(label=lab, n=len(sel), mean_c=temp.mean(), std_c=temp.std(), drift_c_per_min=slope,
                 die_c=np.nanmean(die) if np.isfinite(die).any() else float("nan"),
                 min_c=temp.min(), max_c=temp.max(), ref_c=ref, error_c=err)
        summary.append(s)
        rep.note(f"{lab:<13}{measured:8.2f}{s['std_c']:6.2f}{slope:12.2f}{s['die_c']:7.1f}"
                 f"{ref if ref is not None else float('nan'):7.1f}{err:7.2f}")

        rep.check(f"{lab}: noise", s["std_c"] < args.max_noise or is_ramp,
                  f"std {s['std_c']:.2f} C (limit {args.max_noise})" if not is_ramp else "n/a for ramp")
        if is_ramp:
            rise = temp[t > t.max() - 3].mean() - temp[t < 3].mean()
            rep.check("heat_gun: responds to heat", rise > 5, f"rose {rise:.1f} C during capture")
        else:
            settled = abs(slope) < args.max_drift
            rep.check(f"{lab}: settled", settled, f"drift {slope:+.2f} C/min (limit {args.max_drift})")
        if ref is not None and is_ramp:
            # A handheld reading during a moving ramp isn't a fair accuracy reference: report only
            rep.note(f"    heat_gun end-of-ramp vs reference: {err:+.1f} C (informational)")
        elif ref is not None:
            rep.check(f"{lab}: accuracy vs reference", abs(err) <= args.tol,
                      f"{err:+.2f} C (tolerance +/-{args.tol} C)")
    rep.note("\nTMP36 datasheet: +/-1 C typ / +/-2 C max at 25 C; the ESP32 ADC adds its own error.")
    rep.note("die C = LSM6DSOX internal temperature (sits a few C above ambient from self-heating).")
    write_csv(out / "temp_summary.csv", summary)

    plt = plt_setup(show)
    fig, axes = plt.subplots(1, len(labels), figsize=(4.6 * len(labels), 3.8), squeeze=False)
    for ax, lab in zip(axes[0], labels):
        sel = [r for r in rows if r["label"] == lab]
        t = col(sel, "host_t")
        ax.plot(t, col(sel, "temp_c"), lw=1, label="TMP36")
        if np.isfinite(col(sel, "die_c")).any():
            ax.plot(t, col(sel, "die_c"), lw=1, alpha=0.7, label="LSM6DSOX die")
        if refs.get(lab) is not None:
            ax.axhline(refs[lab], color="k", ls="--", lw=1, label="reference")
            if lab != "heat_gun":
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
    p.add_argument("--ramp-seconds", type=float, default=60.0, help="heat-gun capture length")
    p.add_argument("--period", type=int, default=100, help="sample period ms")
    p.add_argument("--tol", type=float, default=2.0, help="accuracy tolerance vs reference, C")
    p.add_argument("--max-noise", type=float, default=0.5, help="max std dev in a static window, C")
    p.add_argument("--max-drift", type=float, default=0.3, help="max drift in a static window, C/min")
    p.add_argument("--from-csv", help="re-analyze temp_raw.csv (temp_refs.json read from same folder)")
    args = p.parse_args()

    banner("TEMPERATURE (TMP36) VALIDATION")
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
