#!/usr/bin/env python3
"""Process a GPS session folder made by test_gps.py.

Per location: number of fixes, time to fix (and the start type), mean
position, spread (CEP50, R95, 2DRMS in metres), sats/pDOP, the receiver's own
accuracy estimate (hAcc) next to the measured spread, and the offset between
the GPS mean position and your phone's reference point. Writes gps_summary.csv,
report.txt, plots, and gps_points.kml (open in Google Earth / Google My Maps).

    python analyze_gps.py results/gps_20261006_101500
    python analyze_gps.py results/gps_20261006_101500 --tol 8 --no-show
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

from common import BOARD, Report, col, plt_setup, read_csv, save_fig, write_csv

EARTH_R = 6_371_008.8  # m


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def to_en(lat, lon, lat0, lon0):
    """Local east/north metres around (lat0, lon0) - fine over a campus-sized area."""
    e = np.radians(np.asarray(lon) - lon0) * EARTH_R * math.cos(math.radians(lat0))
    n = np.radians(np.asarray(lat) - lat0) * EARTH_R
    return e, n


def clean_fixes(rows):
    good, seen = [], set()
    for r in rows:
        if not (r["valid"] == 1 and 0 <= r["fix_age_ms"] < 2000 and math.isfinite(r["lat"])):
            continue
        # one row per navigation epoch: GPS time of week (UBX), else the UTC string (NMEA)
        itow = r.get("itow_ms")
        key = int(itow) if itow is not None and math.isfinite(itow) and itow > 0 else (r.get("utc") or None)
        if key and key in seen:
            continue
        seen.add(key)
        good.append(r)
    return good


def _dop_key(rows):
    return "pdop" if rows and "pdop" in rows[0] else "hdop"   # Rev 1 sessions logged HDOP


def analyze(session: Path, tol_m: float = 2.0, cep_tol_m: float = 5.0, show: bool = True):
    session = Path(session)
    locations = json.loads((session / "locations.json").read_text())
    rep = Report(f"{BOARD} GPS field test - {session.name}")
    results = []

    for loc in locations:
        rows = read_csv(session / loc["csv"])
        fixes = clean_fixes(rows)
        name = loc["name"]
        res = dict(name=name, rows=len(rows), fixes=len(fixes), time_to_fix_s=loc.get("time_to_fix_s"),
                   start=loc.get("start", "asis"))
        if len(fixes) < 5:
            rep.check(f"{name}: got a fix", False, f"only {len(fixes)} valid fixes")
            results.append((loc, res, None))
            continue
        lat, lon = col(fixes, "lat"), col(fixes, "lon")
        lat0, lon0 = float(lat.mean()), float(lon.mean())
        e, n = to_en(lat, lon, lat0, lon0)
        r = np.hypot(e, n)
        res.update(mean_lat=lat0, mean_lon=lon0, mean_alt_m=float(np.nanmean(col(fixes, "alt_m"))),
                   std_e_m=float(e.std()), std_n_m=float(n.std()), cep50_m=float(np.median(r)),
                   r95_m=float(np.percentile(r, 95)), drms2_m=float(2 * math.hypot(e.std(), n.std())),
                   mean_sats=float(col(fixes, "sats").mean()),
                   mean_dop=float(np.nanmean(col(fixes, _dop_key(fixes)))),
                   duration_s=float(fixes[-1]["host_t"] - fixes[0]["host_t"]))
        if "h_acc_m" in fixes[0]:
            res.update(mean_hacc_m=float(np.nanmean(col(fixes, "h_acc_m"))),
                       final_hacc_m=float(fixes[-1]["h_acc_m"]),
                       frac_3d=float(np.mean(col(fixes, "fix_type") == 3)))
        ref = None
        if loc.get("ref_lat") is not None:
            ref = (loc["ref_lat"], loc["ref_lon"])
            res.update(ref_lat=ref[0], ref_lon=ref[1], ref_acc_m=loc.get("ref_acc_m"),
                       offset_m=haversine_m(ref[0], ref[1], lat0, lon0),
                       offset_bearing_deg=bearing_deg(ref[0], ref[1], lat0, lon0))
        results.append((loc, res, (fixes, e, n, lat0, lon0)))

        ttff = res['time_to_fix_s'] if res['time_to_fix_s'] is not None else float('nan')
        rep.note(f"[{name}]  {res['fixes']} fixes over {res['duration_s']:.0f} s, "
                 f"time to fix {ttff:.0f} s ({res['start']} start)")
        rep.note(f"    mean {lat0:.7f}, {lon0:.7f}  alt {res['mean_alt_m']:.1f} m   "
                 f"sats {res['mean_sats']:.1f}  {_dop_key(fixes).upper()} {res['mean_dop']:.2f}")
        rep.note(f"    spread: CEP50 {res['cep50_m']:.2f} m  R95 {res['r95_m']:.2f} m  "
                 f"2DRMS {res['drms2_m']:.2f} m")
        if "mean_hacc_m" in res:
            rep.note(f"    receiver hAcc: mean {res['mean_hacc_m']:.2f} m, at end {res['final_hacc_m']:.2f} m; "
                     f"3D fix {res['frac_3d'] * 100:.0f}% of epochs")
        if ref:
            acc = f" (phone said +/-{res['ref_acc_m']:.0f} m)" if res.get("ref_acc_m") else ""
            rep.note(f"    vs phone: {res['offset_m']:.2f} m toward {res['offset_bearing_deg']:.0f} deg{acc}")
        if loc.get("notes"):
            rep.note(f"    notes: {loc['notes']}")
        rep.check(f"{name}: precision (CEP50)", res["cep50_m"] <= cep_tol_m,
                  f"{res['cep50_m']:.2f} m (limit {cep_tol_m} m)")
        if ref:
            rep.check(f"{name}: agreement with phone", res["offset_m"] <= tol_m,
                      f"{res['offset_m']:.2f} m (limit {tol_m} m)")
        else:
            rep.note("    (no phone reference entered - accuracy not checked)")

    rep.note("\nu-blox rates the SAM-M10Q at about 1.5 m CEP in open sky; phones are typically")
    rep.note("+/-3-5 m, so the phone comparison checks gross agreement, not the module's full accuracy.")
    rep.note("CEP50 here is the spread over a few minutes (precision). hAcc is the receiver's own")
    rep.note("1-sigma accuracy estimate; a CEP50 far below hAcc just means the error was a slow offset.")
    write_csv(session / "gps_summary.csv", [res for _, res, _ in results])
    _plots(results, tol_m, session, show)
    _kml(results, session)
    rep.save(session)
    print(f"\nResults in {session}")
    return results


def _plots(results, tol_m, session, show):
    plt = plt_setup(show)
    good = [x for x in results if x[2] is not None]
    if not good:
        return
    fig, axes = plt.subplots(1, len(good), figsize=(5 * len(good), 5), squeeze=False)
    th = np.linspace(0, 2 * np.pi, 200)
    for ax, (loc, res, (fixes, e, n, lat0, lon0)) in zip(axes[0], good):
        sc = ax.scatter(e, n, c=col(fixes, "host_t"), s=8, cmap="viridis", alpha=0.8)
        ax.plot(res["cep50_m"] * np.cos(th), res["cep50_m"] * np.sin(th), "k--", lw=0.8,
                label=f"CEP50 {res['cep50_m']:.1f} m")
        ax.plot(res["r95_m"] * np.cos(th), res["r95_m"] * np.sin(th), "k:", lw=0.8,
                label=f"R95 {res['r95_m']:.1f} m")
        ax.plot(0, 0, "+", color="k", ms=12, mew=2, label="GPS mean")
        if "ref_lat" in res:
            re_, rn = to_en(res["ref_lat"], res["ref_lon"], lat0, lon0)
            ax.plot(re_, rn, "x", color="#dc2626", ms=12, mew=2.5,
                    label=f"phone ({res['offset_m']:.1f} m off)")
            if res.get("ref_acc_m"):
                ax.plot(re_ + res["ref_acc_m"] * np.cos(th), rn + res["ref_acc_m"] * np.sin(th),
                        color="#dc2626", lw=0.8, alpha=0.6)
        ax.set(title=res["name"], xlabel="east [m]", ylabel="north [m]")
        ax.set_aspect("equal", "datalim")
        ax.legend(fontsize=7, loc="upper left")
    fig.colorbar(sc, ax=axes[0].tolist(), label="time since capture start [s]", shrink=0.8)
    fig.suptitle("GPS scatter per location (relative to GPS mean)")
    fig.savefig(session / "gps_scatter.png", dpi=150, bbox_inches="tight")
    print("  saved gps_scatter.png")

    has_hacc = all("h_acc_m" in x[2][0][0] for x in good)
    fig, axes = plt.subplots(3 if has_hacc else 2, 1, figsize=(11, 8.5 if has_hacc else 6), sharex=True)
    a1, a2 = axes[0], axes[1]
    for loc, res, (fixes, e, n, lat0, lon0) in good:
        t = col(fixes, "host_t")
        a1.plot(t, np.hypot(e, n), lw=0.9, label=res["name"])
        a2.plot(t, col(fixes, "sats"), lw=0.9, label=res["name"])
        if has_hacc:
            axes[2].plot(t, col(fixes, "h_acc_m"), lw=0.9, label=res["name"])
    a1.set(ylabel="distance from mean [m]", title="Position wander during each capture")
    a2.set(ylabel="satellites used")
    if has_hacc:
        axes[2].set(ylabel="receiver hAcc [m]")
    axes[-1].set(xlabel="time since capture start [s]")
    a1.legend(fontsize=8)
    save_fig(fig, session / "gps_timeseries.png")

    with_ref = [x for x in good if "offset_m" in x[1]]
    if with_ref:
        fig, ax = plt.subplots(figsize=(1.8 + 1.6 * len(with_ref), 4))
        names = [x[1]["name"] for x in with_ref]
        vals = [x[1]["offset_m"] for x in with_ref]
        ax.bar(names, vals, color=["#2f9e6a" if v <= tol_m else "#dc2626" for v in vals])
        ax.axhline(tol_m, color="k", ls="--", lw=1, label=f"limit {tol_m} m")
        ax.set(ylabel="GPS mean vs phone [m]", title="Accuracy vs phone reference")
        ax.legend(fontsize=8)
        save_fig(fig, session / "gps_vs_phone.png")
    if show:
        plt.show()


def _kml(results, session):
    pts = []
    for loc, res, extra in results:
        if extra is None:
            continue
        pts.append((f"{res['name']} (GPS mean)", res["mean_lat"], res["mean_lon"]))
        if "ref_lat" in res:
            pts.append((f"{res['name']} (phone)", res["ref_lat"], res["ref_lon"]))
    marks = "\n".join(f"  <Placemark><name>{n}</name><Point><coordinates>{lo:.7f},{la:.7f},0"
                      f"</coordinates></Point></Placemark>" for n, la, lo in pts)
    (session / "gps_points.kml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n'
        f"{marks}\n</Document></kml>\n")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("session", help="session folder from test_gps.py (contains locations.json)")
    p.add_argument("--tol", type=float, default=10.0, help="pass limit: GPS mean vs phone, m")
    p.add_argument("--cep-tol", type=float, default=5.0, help="pass limit: CEP50 spread, m")
    p.add_argument("--no-show", action="store_true")
    a = p.parse_args()
    analyze(Path(a.session), a.tol, a.cep_tol, not a.no_show)


if __name__ == "__main__":
    main()
