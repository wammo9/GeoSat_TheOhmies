#!/usr/bin/env python3
"""PA1010D GPS field test: capture several minutes at each campus location, then compare to your phone.

Flow per location
 1. Name the location, walk there, set the board down with open sky.
 2. Press Enter. The script waits for a fix (showing sats/HDOP), then logs
    --seconds of fixes (default 240 s = 4 min). Time-to-fix is recorded too.
 3. Enter your phone's coordinates for the same spot (Google Maps: long-press
    the blue dot -> copy "lat, lon"; or a GPS/compass app). Optionally the
    accuracy the phone reports.
 Repeat for --locations spots (default 3). Each location is saved to its own
 CSV in one session folder; analyze_gps.py runs automatically at the end and
 can be re-run on the folder any time.

    python test_gps.py
    python test_gps.py --locations 3 --seconds 240 --fix-timeout 300
    python test_gps.py --out results/gps_campus --append     # add a location to an existing session

The board needs to stay connected to the laptop over USB for this test (power + data).
"""
import json
import math
from pathlib import Path

from common import (ask, ask_float, banner, base_parser, make_results_dir, open_device,
                    wait_for_enter, write_csv, ask_yes)
import analyze_gps

GPS_FIELDS = ["host_t", "t_ms", "valid", "lat", "lon", "alt_m", "sats", "hdop", "fix_age_ms", "utc", "chars"]


def is_fix(r):
    return r["valid"] == 1 and 0 <= r["fix_age_ms"] < 2000 and math.isfinite(r["lat"])


def parse_latlon(text):
    text = text.replace("°", " ").replace(",", " ").split()
    if len(text) != 2:
        raise ValueError
    lat, lon = float(text[0]), float(text[1])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError
    return lat, lon


def capture_location(dev, args, idx, total):
    name = ask(f"\n[{idx}/{total}] Location name (e.g. engineering_quad)", f"loc{idx}").replace(" ", "_")
    ans = wait_for_enter(f"Walk to '{name}'. Put the board flat with a clear view of the sky, "
                         "antenna up, away from walls/overhangs. Keep the laptop a step back.")
    if ans == "q":
        return None

    state = {"first_fix": None}

    def stop_when(d):
        rows = d["GPS"]
        if not rows:
            return False
        r = rows[-1]
        if state["first_fix"] is None:
            if is_fix(r):
                state["first_fix"] = r["host_t"]
                print(f"\n  Fix acquired after {r['host_t']:.0f} s - logging {args.seconds:.0f} s ...")
            elif r["host_t"] > args.fix_timeout:
                print(f"\n  No fix after {args.fix_timeout:.0f} s.")
                return True
            return False
        return r["host_t"] - state["first_fix"] >= args.seconds

    def status(d):
        rows = d["GPS"]
        if not rows:
            return "waiting for NMEA..."
        r = rows[-1]
        nfix = sum(is_fix(x) for x in rows)
        if state["first_fix"] is None:
            return f"searching... sats {int(r['sats'])}  NMEA chars {int(r['chars'])}"
        return (f"{r['lat']:.6f}, {r['lon']:.6f}  sats {int(r['sats'])}  "
                f"HDOP {r['hdop']:.2f}  fixes {nfix}")

    print("  Waiting for fix (bar = worst-case time budget) ...")
    data = dev.stream({"GPS": 1000}, args.fix_timeout + args.seconds, status_fn=status, stop_when=stop_when)
    rows = data["GPS"]
    csv_name = f"gps_{idx:02d}_{name}.csv"
    write_csv(args.session / csv_name, rows, GPS_FIELDS)
    nfix = sum(is_fix(r) for r in rows)
    print(f"  saved {csv_name}: {len(rows)} rows, {nfix} with a fix")

    ref = None
    while True:
        txt = ask("Phone coordinates 'lat, lon' (blank = skip)")
        if not txt:
            break
        try:
            ref = parse_latlon(txt)
            break
        except ValueError:
            print("    couldn't parse - paste like: 40.00712, -105.26341")
    acc = ask_float("Phone-reported accuracy in m (blank = unknown)") if ref else None
    notes = ask("Notes (sky view, buildings nearby, ...)")
    return {"name": name, "csv": csv_name, "ref_lat": ref[0] if ref else None,
            "ref_lon": ref[1] if ref else None, "ref_acc_m": acc,
            "time_to_fix_s": state["first_fix"], "notes": notes}


def main():
    p = base_parser(__doc__)
    p.add_argument("--locations", type=int, default=3, help="number of locations")
    p.add_argument("--seconds", type=float, default=40.0, help="logging time per location after fix")
    p.add_argument("--fix-timeout", type=float, default=20.0, help="max wait for a fix per location")
    p.add_argument("--append", action="store_true", help="add locations to an existing --out session")
    p.add_argument("--tol", type=float, default=10.0, help="pass limit: GPS mean vs phone, m (for analysis)")
    args = p.parse_args()

    banner("GPS (PA1010D) FIELD TEST")
    args.session = make_results_dir("gps", args.out)
    meta_path = args.session / "locations.json"
    locations = json.loads(meta_path.read_text()) if (args.append and meta_path.exists()) else []
    print(f"Session folder: {args.session}")

    dev = open_device(args)
    start = len(locations) + 1
    total = len(locations) + args.locations
    for idx in range(start, total + 1):
        loc = capture_location(dev, args, idx, total)
        if loc is None:
            break
        locations.append(loc)
        meta_path.write_text(json.dumps(locations, indent=2))  # save after every location
        if idx < total and not ask_yes("Continue to the next location?"):
            break
    dev.close()

    if locations:
        print("\nAnalyzing ...")
        analyze_gps.analyze(args.session, tol_m=args.tol, show=not args.no_show)


if __name__ == "__main__":
    main()