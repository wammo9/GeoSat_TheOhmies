#!/usr/bin/env python3
"""Add or change the reference coordinates for each site in a GPS session, then re-run the analysis.

Use it when you skipped the phone coordinates in the field, or want to replace them with
a point picked in Google Maps (right-click the exact spot -> click the "lat, lon" line to copy).

    python set_gps_refs.py results/gps_20261015_113000
"""
import argparse
import json
from pathlib import Path

import analyze_gps
from test_gps import parse_latlon


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("session", help="GPS session folder (contains locations.json)")
    p.add_argument("--tol", type=float, default=10.0, help="pass limit: GPS mean vs reference, m")
    p.add_argument("--no-show", action="store_true")
    args = p.parse_args()

    meta = Path(args.session) / "locations.json"
    locations = json.loads(meta.read_text())
    print(f"{len(locations)} site(s) in {args.session}. Press Enter to keep the current value.\n")

    for loc in locations:
        cur = (f"{loc['ref_lat']:.6f}, {loc['ref_lon']:.6f}" if loc.get("ref_lat") is not None else "none")
        while True:
            txt = input(f"[{loc['name']}] reference 'lat, lon' (current: {cur}): ").strip()
            if not txt:
                break
            try:
                loc["ref_lat"], loc["ref_lon"] = parse_latlon(txt)
                acc = input("    accuracy of that reference in m (blank = unknown): ").strip()
                loc["ref_acc_m"] = float(acc) if acc else None
                src = input("    source note (e.g. google maps, phone gps) [google maps]: ").strip()
                loc["ref_source"] = src or "google maps"
                break
            except ValueError:
                print("    couldn't parse - paste like: 40.00712, -105.26341")

    meta.write_text(json.dumps(locations, indent=2))
    print(f"\nSaved {meta}\nRe-running analysis ...")
    analyze_gps.analyze(Path(args.session), tol_m=args.tol, show=not args.no_show)


if __name__ == "__main__":
    main()