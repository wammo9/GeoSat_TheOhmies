#!/usr/bin/env python3
"""Smoke test: is the MCU alive, are all sensors on the bus, and do they all stream sane data?

Covers "microcontroller and sensors are powered and can talk to each other"
and "data gathering ability". Run this first, right after flashing geosat_hil.

    python test_smoke.py [--port /dev/cu.usbmodem101] [--seconds 5] [--ina 1]
"""
import numpy as np

from common import (BOARD, G, Report, banner, base_parser, col, make_results_dir, open_device,
                    write_csv, write_json)

EXPECTED_I2C = {
    "0x6A/0x6B": "LSM6DSOX",
    "0x1C/0x1E": "LIS3MDL",
    "0x48/0x49/0x4A/0x4B": "TMP117",
}
GPS_I2C = "0x42"   # SAM-M10Q (only on the bus when the firmware uses the I2C link)
INA_ADDRS = ["0x40", "0x41", "0x44", "0x45"]

# Generous "is this physically plausible" windows -- not accuracy specs.
SANITY = {
    "accel |a| [g]":   (0.8, 1.2),
    "mag |B| [uT]":    (15.0, 120.0),
    "TMP117 [C]":      (0.0, 50.0),
    "bus voltage [V]": (3.0, 5.5),
}
MAX_DIE_DELTA_C = 10.0   # TMP117 vs LSM6DSOX die temperature, same board


def main():
    p = base_parser(__doc__)
    p.add_argument("--seconds", type=float, default=5.0, help="stream duration")
    p.add_argument("--ina", type=int, default=1, help="number of INA219s expected (0 = none fitted)")
    args = p.parse_args()

    banner("SMOKE TEST - comms + streaming")
    dev = open_device(args)
    out = make_results_dir("smoke", args.out)
    rep = Report(f"{BOARD} smoke test")
    rep.note(f"Firmware info: {dev.info}")

    found = dev.scan()
    rep.note(f"I2C scan: {', '.join(found) or 'nothing'}")
    for addrs, name in EXPECTED_I2C.items():
        hit = [a for a in addrs.split("/") if a in found]
        rep.check(f"{name} on I2C", bool(hit), hit[0] if hit else f"expected at {addrs}")
    gps_on_i2c = dev.info.get("gps") != "uart"
    if gps_on_i2c:
        rep.check("SAM-M10Q on I2C", GPS_I2C in found, GPS_I2C if GPS_I2C in found else
                  "expected at 0x42 (Qwiic cable seated? breakout powered?)")
    if dev.info.get("gps", "none") != "none":
        rep.check("SAM-M10Q accepted UBX config", dev.info.get("gps_cfg") == "ack",
                  f"gps_cfg={dev.info.get('gps_cfg')}" +
                  ("" if dev.info.get("gps_cfg") == "ack" else " (NMEA fallback only; send REINIT)"))
    ina = [a for a in INA_ADDRS if a in found]
    if args.ina:
        rep.check(f"{args.ina}x INA219 on I2C", len(ina) == args.ina,
                  f"found {', '.join(ina) or 'none'}" + ("" if len(ina) == args.ina else
                  " (two breakouts both default to 0x40: bridge A0 on one)"))

    kinds = {k: None for k in ("IMU", "MAG", "TMP", "PWR", "GPS") if dev.has(k)}
    print(f"\nStreaming {', '.join(kinds)} for {args.seconds:.0f}s ...")
    data = dev.stream(kinds, args.seconds)
    info_after = dev.get_info()
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
        rep.note(f"LSM6DSOX die temp: {np.nanmean(col(r, 'die_c')):.1f} C")
    if data.get("MAG"):
        r = data["MAG"]
        summary["mag |B| [uT]"] = float(np.mean(np.sqrt(col(r, "mx") ** 2 + col(r, "my") ** 2 + col(r, "mz") ** 2)))
    if data.get("TMP"):
        r = data["TMP"]
        temp = col(r, "temp_c")
        good = np.isfinite(temp)
        rep.check("TMP117 conversions arriving", good.any() and np.nansum(col(r, "fresh")) > 0,
                  f"{int(np.nansum(col(r, 'fresh')))} new results in {len(r)} reads")
        if good.any():
            summary["TMP117 [C]"] = float(np.nanmean(temp))
            die = col(r, "die_c")
            if np.isfinite(die).any():
                delta = float(np.nanmean(die) - np.nanmean(temp))
                rep.check("TMP117 agrees with LSM6DSOX die temp", abs(delta) <= MAX_DIE_DELTA_C,
                          f"die - TMP117 = {delta:+.1f} C (limit +/-{MAX_DIE_DELTA_C:.0f} C; "
                          "the die runs a few C warm)")
    if data.get("PWR"):
        r = data["PWR"]
        summary["bus voltage [V]"] = float(np.mean(col(r, "bus_v")))
        rep.note(f"INA219 mean current: {np.mean(col(r, 'current_ma')):.1f} mA")
    for name, val in summary.items():
        lo, hi = SANITY[name]
        rep.check(f"{name} plausible", lo <= val <= hi, f"{val:.3f} (window {lo}-{hi})")

    gps = data.get("GPS", [])
    if gps:
        last = gps[-1]
        rep.check("GPS link receiving data", last["chars"] > 0, f"{int(last['chars'])} bytes parsed")
        rep.check("UBX-NAV-PVT frames arriving", last["ubx_frames"] > 0,
                  f"{int(last['ubx_frames'])} frames, {int(last['ubx_err'])} bad")
        rep.check("GPS link error-free", last["link_err"] == 0,
                  f"{int(last['link_err'])} I2C/UART errors")
        fix = {0: "none", 2: "2D", 3: "3D", 5: "time only"}.get(int(last["fix_type"]), str(last["fix_type"]))
        rep.note(f"GPS fix: {fix}{'' if last['valid'] == 1 else ' (normal indoors)'}, "
                 f"sats={int(last['sats'])}, hAcc={last['h_acc_m']:.1f} m")
    rep.note(f"Firmware counters after streaming: read_err={info_after.get('read_err')}, "
             f"rx_ovf={info_after.get('rx_ovf')}")
    rep.check("no sensor read errors while streaming", info_after.get("read_err", "0") == "0",
              f"read_err={info_after.get('read_err')}")

    write_json(out / "summary.json", {"info": dev.info, "i2c": found, "means": summary})
    rep.save(out)
    print(f"\nResults in {out}")


if __name__ == "__main__":
    main()
