#!/usr/bin/env python3
"""Smoke test: is the MCU alive, are all sensors on the bus, and do they all stream sane data?

Covers Rev 1 results item 2 ("microcontroller and sensors are powered and can
talk to each other") and item 3 ("data gathering ability"). Run this first,
right after flashing.

    python test_smoke.py [--port /dev/cu.usbmodem101] [--seconds 5]
"""
import numpy as np

from common import (G, Report, banner, base_parser, col, make_results_dir, open_device,
                    write_csv, write_json)

EXPECTED_I2C = {"0x6A/0x6B": "LSM6DSOX", "0x1C/0x1E": "LIS3MDL"}
INA_ADDRS = ["0x40", "0x41", "0x44", "0x45"]
EXPECTED_INA = 2  # CS1 (3.3V_LSM rail) + CS2 (3.3V_GPS rail)

# Generous "is this physically plausible" windows -- not accuracy specs.
SANITY = {
    "accel |a| [g]":   (0.8, 1.2),
    "mag |B| [uT]":    (15.0, 120.0),
    "TMP36 [C]":       (0.0, 50.0),
    "bus voltage [V]": (3.0, 5.5),
}


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=5.0, help="stream duration")
    args = p.parse_args()

    banner("SMOKE TEST — comms + streaming")
    dev = open_device(args)
    out = make_results_dir("smoke", args.out)
    rep = Report("Rev 1 smoke test")
    rep.note(f"Firmware info: {dev.info}")

    found = dev.scan()
    rep.note(f"I2C scan: {', '.join(found) or 'nothing'}")
    for addrs, name in EXPECTED_I2C.items():
        hit = [a for a in addrs.split("/") if a in found]
        rep.check(f"{name} on I2C", bool(hit), hit[0] if hit else f"expected at {addrs}")
    ina = [a for a in INA_ADDRS if a in found]
    rep.check(f"{EXPECTED_INA}x INA219 on I2C", len(ina) == EXPECTED_INA,
              f"found {', '.join(ina) or 'none'}" + ("" if len(ina) == EXPECTED_INA else
              " (both breakouts default to 0x40: bridge A0 on one)"))

    kinds = {k: None for k in ("IMU", "MAG", "TMP", "PWR", "GPS") if dev.has(k)}
    print(f"\nStreaming {', '.join(kinds)} for {args.seconds:.0f}s ...")
    data = dev.stream(kinds, args.seconds)
    dev.close()

    for kind, rows in data.items():
        if rows:
            write_csv(out / f"smoke_{kind.lower()}.csv", rows)
        rep.check(f"{kind} streaming", len(rows) > 0, f"{len(rows)} samples")

    summary = {}
    if data.get("IMU"):
        r = data["IMU"]
        mag = np.sqrt(col(r, "ax") ** 2 + col(r, "ay") ** 2 + col(r, "az") ** 2) / G
        summary["accel |a| [g]"] = float(np.mean(mag))
        rep.note(f"LSM6DSOX die temp: {np.mean(col(r, 'die_c')):.1f} C")
    if data.get("MAG"):
        r = data["MAG"]
        summary["mag |B| [uT]"] = float(np.mean(np.sqrt(col(r, "mx") ** 2 + col(r, "my") ** 2 + col(r, "mz") ** 2)))
    if data.get("TMP"):
        summary["TMP36 [C]"] = float(np.mean(col(data["TMP"], "temp_c")))
    if data.get("PWR"):
        r = data["PWR"]
        summary["bus voltage [V]"] = float(np.mean(col(r, "bus_v")))
        rep.note(f"INA219 mean current: {np.mean(col(r, 'current_ma')):.1f} mA")
    for name, val in summary.items():
        lo, hi = SANITY[name]
        rep.check(f"{name} plausible", lo <= val <= hi, f"{val:.3f} (window {lo}-{hi})")

    gps = data.get("GPS", [])
    if gps:
        chars = col(gps, "chars")
        rep.check("GPS UART receiving NMEA", chars[-1] > 0, f"{int(chars[-1])} chars parsed")
        rep.note(f"GPS fix: {'yes' if gps[-1]['valid'] == 1 else 'not yet (normal indoors)'}, "
                 f"sats={int(gps[-1]['sats'])}")

    write_json(out / "summary.json", {"info": dev.info, "i2c": found, "means": summary})
    rep.save(out)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()