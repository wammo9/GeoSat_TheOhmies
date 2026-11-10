#!/usr/bin/env python3
"""I2C bring-up diagnostic for the Nucleo-L432KC bench setup.

Checks the SDA (PB7 / D4) and SCL (PB6 / D5) line levels, runs bus recovery and
re-detects every sensor (REINIT), then scans the bus and names what answered.

    python diag_i2c.py
"""
import time

from common import banner, base_parser, open_device

KNOWN = {
    "0x6A": "LSM6DSOX", "0x6B": "LSM6DSOX",
    "0x1C": "LIS3MDL", "0x1E": "LIS3MDL",
    "0x20": "RM3100", "0x21": "RM3100", "0x22": "RM3100", "0x23": "RM3100",
    "0x48": "TMP117", "0x49": "TMP117", "0x4A": "TMP117", "0x4B": "TMP117",
    "0x42": "SAM-M10Q GPS",
    "0x40": "INA219", "0x41": "INA219", "0x44": "INA219", "0x45": "INA219",
}
EXPECTED = ["LSM6DSOX", "LIS3MDL", "RM3100", "TMP117", "SAM-M10Q GPS"]
VERDICT = {"PULLED_UP": "OK (external pull-up present)",
           "FLOATING": "NO PULL-UP: not reaching any breakout, or breakouts unpowered",
           "HELD_LOW": "HELD LOW: shorted to GND, or a device is clamping it"}


def collect(dev, cmd, done, timeout):
    dev.send(cmd)
    lines, end = [], time.time() + timeout
    while time.time() < end:
        line = dev.readline()
        if not line:
            continue
        if line.startswith(done):
            return lines, line
        if line.startswith("#"):
            lines.append(line)
    raise SystemExit(f"No {done} reply to {cmd} (is geosat_hil flashed?)")


def main():
    args = base_parser(__doc__).parse_args()
    banner("I2C DIAGNOSTIC (NUCLEO-L432KC)")
    dev = open_device(args)

    print("\nLine levels (board powered, bus idle):")
    lines, _ = collect(dev, "BUS", "#BUS_DONE", 5)
    verdicts = {}
    for l in lines:
        _, name, pin, _pd, _pu, verdict = l.split(",")
        verdicts[name] = verdict
        print(f"  {name:<4} {pin} ({'D4' if name == 'SDA' else 'D5'})  {VERDICT.get(verdict, verdict)}")

    print("\nBus recovery + sensor re-detect (REINIT) ...")
    lines, _ = collect(dev, "REINIT", "#ACK,REINIT", 10)
    for l in lines:
        if l.startswith(("#OK", "#FAIL", "#WARN", "#I2C")):
            print(f"  {l[1:]}")

    found = dev.scan()
    print("\nI2C scan:")
    names = []
    for a in found:
        names.append(KNOWN.get(a, "?"))
        print(f"  {a}  {KNOWN.get(a, 'unknown device')}")
    if not found:
        print("  nothing answered")
    missing = [n for n in EXPECTED if n not in names]
    dev.close()

    print("\nReading it:")
    if "HELD_LOW" in verdicts.values():
        print("  * a line is HELD LOW: look for a short to GND, or unplug breakouts one at a time to find")
        print("    the one clamping it. REINIT's recovery pulses fix a sensor stuck mid-transfer.")
    if "FLOATING" in verdicts.values():
        print("  * a line has NO PULL-UP: D4/D5 aren't reaching the breakouts. Check the jumper wires,")
        print("    the Qwiic cable, and that the breakouts have 3V3 and GND.")
    if missing:
        print(f"  * not found: {', '.join(missing)}. Check that breakout's power and Qwiic/jumper seating.")
        if "RM3100" in missing:
            print("    RM3100 breakout: I2CEN must be tied to 3V3 (low = SPI mode), and SA0/SA1 to GND")
            print("    for 0x20. Both AVDD and DVDD need 3V3.")
        if "SAM-M10Q GPS" in missing:
            print("    The SAM-M10Q may also be in UART mode if the firmware was built with GPS_LINK_I2C=OFF.")
    print("  * Nucleo-32: solder bridges SB16/SB18 tie D4/D5 to A4/A5. Leave A4/A5 unconnected.")
    print("  * several breakouts with pull-ups in parallel can make the bus too stiff; if it's flaky,")
    print("    open the I2C pull-up jumper on all but one breakout.")


if __name__ == "__main__":
    main()
