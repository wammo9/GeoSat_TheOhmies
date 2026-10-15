#!/usr/bin/env python3
"""Power analysis: log INA219 current/voltage in labeled operating states and compare to the power budget.

For each state you name (e.g. "idle", "gps_acquiring", "gps_locked") the script
waits for you to set the board up, then logs for --seconds. At the end it
compares mean current per INA219 against your budget numbers.

    python test_power.py --budget 0x40=95
    python test_power.py --budget 0x40=95 --budget 0x41=30 --seconds 30
    python test_power.py --from-csv results/power_.../power_raw.csv --budget 0x40=95

Note: the Adafruit INA219 driver's default calibration assumes a 0.1 ohm shunt
(32 V / 2 A range). If your Rev 1 shunt is different, scale current_ma by
0.1 / R_shunt (bus voltage and shunt mV are unaffected).
"""
from pathlib import Path

import numpy as np

from common import (Report, banner, base_parser, col, make_results_dir, open_device, plt_setup,
                    read_csv, save_fig, wait_for_enter, ask, write_csv)


def parse_budget(items):
    budget = {}
    for item in items or []:
        addr, ma = item.split("=")
        budget[addr.strip().upper().replace("0X", "0x")] = float(ma)
    return budget


def acquire(args, out):
    dev = open_device(args)
    rows = []
    print("\nYou'll log one window per operating state. Leave the state name blank to finish.")
    while True:
        label = ask("State name (e.g. idle, gps_acquiring, all_streaming)").replace(" ", "_")
        if not label:
            break
        if wait_for_enter(f"Set the board into '{label}'.") == "q":
            break
        data = dev.stream({"PWR": args.period}, args.seconds)
        for r in data["PWR"]:
            r["label"] = label
        rows += data["PWR"]
        print(f"  logged {len(data['PWR'])} samples for '{label}'")
    dev.close()
    if rows:
        write_csv(out / "power_raw.csv", rows, ["label", "host_t", "t_ms", "addr", "bus_v",
                                                 "shunt_mv", "current_ma", "power_mw"])
    return rows


def analyze(rows, budget, tol_pct, out, show):
    rep = Report("Rev 1 power analysis")
    labels = list(dict.fromkeys(r["label"] for r in rows))
    addrs = sorted({r["addr"] for r in rows})
    summary = []
    rep.note(f"{'state':<18}{'sensor':<7}{'mean mA':>9}{'std':>7}{'min':>8}{'max':>8}{'bus V':>8}{'mW':>9}")
    for lab in labels:
        for a in addrs:
            sel = [r for r in rows if r["label"] == lab and r["addr"] == a]
            if not sel:
                continue
            i, v, p = col(sel, "current_ma"), col(sel, "bus_v"), col(sel, "power_mw")
            s = dict(label=lab, addr=a, n=len(sel), mean_ma=i.mean(), std_ma=i.std(), min_ma=i.min(),
                     max_ma=i.max(), mean_v=v.mean(), min_v=v.min(), mean_mw=p.mean())
            summary.append(s)
            rep.note(f"{lab:<18}{a:<7}{s['mean_ma']:9.2f}{s['std_ma']:7.2f}{s['min_ma']:8.2f}"
                     f"{s['max_ma']:8.2f}{s['mean_v']:8.3f}{s['mean_mw']:9.1f}")
            if a in budget:
                b = budget[a]
                diff = 100 * (s["mean_ma"] - b) / b
                s["budget_ma"], s["diff_pct"] = b, diff
                rep.check(f"{lab} @ {a} within budget", s["mean_ma"] <= b * (1 + tol_pct / 100),
                          f"{s['mean_ma']:.1f} mA vs budget {b:.1f} mA ({diff:+.1f}%)")
    if not budget:
        rep.note("\n(no --budget given: no pass/fail, just the measurements)")
    write_csv(out / "power_summary.csv", summary)

    plt = plt_setup(show)
    fig, axes = plt.subplots(len(addrs), 1, figsize=(10, 3.2 * len(addrs)), squeeze=False)
    for ax, a in zip(axes[:, 0], addrs):
        offset = 0.0
        for lab in labels:
            sel = [r for r in rows if r["label"] == lab and r["addr"] == a]
            if not sel:
                continue
            t = col(sel, "host_t")
            ax.plot(t + offset, col(sel, "current_ma"), lw=1, label=lab)
            offset += t.max() + 2
        if a in budget:
            ax.axhline(budget[a], color="k", ls="--", lw=1, label="budget")
        ax.set(title=f"INA219 {a} current by state", xlabel="time [s] (states placed end to end)",
               ylabel="current [mA]")
        ax.legend(fontsize=8, ncol=4)
    save_fig(fig, out / "power_timeseries.png")
    if show:
        plt.show()
    rep.save(out)


def main():
    p = base_parser(__doc__)
    p.add_argument("--budget", action="append", metavar="ADDR=mA",
                   help="expected current for an INA219, e.g. 0x40=95 (repeatable)")
    p.add_argument("--tol", type=float, default=10.0, help="allowed %% over budget (default 10)")
    p.add_argument("--seconds", type=float, default=20.0, help="log time per state")
    p.add_argument("--period", type=int, default=50, help="sample period ms")
    p.add_argument("--from-csv", help="re-analyze an existing power_raw.csv")
    args = p.parse_args()

    banner("POWER ANALYSIS")
    if args.from_csv:
        rows, out = read_csv(Path(args.from_csv)), Path(args.from_csv).parent
    else:
        out = make_results_dir("power", args.out)
        rows = acquire(args, out)
    if not rows:
        print("No data captured.")
        return
    analyze(rows, parse_budget(args.budget), args.tol, out, not args.no_show)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
