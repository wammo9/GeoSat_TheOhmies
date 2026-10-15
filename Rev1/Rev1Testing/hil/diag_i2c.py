#!/usr/bin/env python3
"""I2C bring-up diagnostic: checks SDA/SCL line levels, then hunts every free XIAO pin
pair for responding devices. Needs firmware rev1-hil-1.1 or newer.

    python diag_i2c.py
"""
import time

from common import banner, base_parser, open_device

C6_TO_XIAO = {0: "D0", 1: "D1", 2: "D2", 21: "D3", 22: "D4", 23: "D5", 16: "D6",
              17: "D7", 19: "D8", 20: "D9", 18: "D10"}
KNOWN = {"0x6A": "LSM6DSOX", "0x6B": "LSM6DSOX", "0x1C": "LIS3MDL", "0x1E": "LIS3MDL",
         "0x40": "INA219", "0x41": "INA219", "0x44": "INA219", "0x45": "INA219", "0x10": "PA1010D"}
VERDICT = {"PULLED_UP": "OK (external pull-up present)",
           "FLOATING": "NO PULL-UP: not connected to any breakout, or breakouts unpowered",
           "HELD_LOW": "HELD LOW: shorted to GND or a device is clamping it"}


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
    raise SystemExit(f"No {done} reply to {cmd} (flash firmware rev1-hil-1.1?)")


def pad(gpio_label):
    g = int(gpio_label.replace("GPIO", "").split(",")[0])
    return f"{gpio_label} ({C6_TO_XIAO.get(g, '?')})"


def main():
    args = base_parser(__doc__).parse_args()
    banner("I2C DIAGNOSTIC")
    dev = open_device(args)

    print("\nLine levels (board powered, bus idle):")
    lines, _ = collect(dev, "BUS", "#BUS_DONE", 5)
    for l in lines:
        _, name, gpio, _pd, _pu, verdict = l.split(",")
        print(f"  {name:<5} {pad(gpio):<14} {VERDICT.get(verdict, verdict)}")

    print("\nSearching every free pin pair for I2C devices ...")
    lines, done = collect(dev, "HUNT", "#HUNT_DONE", 60)
    for l in lines:
        if "SDA=" not in l:
            continue
        parts = l.split(",")
        sda, scl, addrs = parts[1][4:], parts[2][4:], parts[3:]
        names = ", ".join(f"{a} {KNOWN.get(a, '?')}" for a in addrs)
        tag = "  <- configured pins" if (sda, scl) == ("GPIO22", "GPIO23") else ""
        print(f"  SDA={pad(sda)}  SCL={pad(scl)}: {names}{tag}")
    if done.endswith(",0"):
        print("  no devices answered on any pin pair")
    dev.close()

    print("\nReading it:")
    print("  * SDA/SCL HELD LOW  -> look for a short or solder bridge to GND on that net, or unplug breakouts one at a time")
    print("  * SDA/SCL NO PULL-UP -> the D4/D5 pads aren't reaching the breakouts: continuity XIAO pad 5/6 -> breakout SDA/SCL")
    print("  * devices found on other pins -> routing differs from the schematic; tell me the pins and I'll remap the firmware")
    print("  * devices found only with SDA/SCL swapped -> SDA and SCL are crossed on the board")


if __name__ == "__main__":
    main()