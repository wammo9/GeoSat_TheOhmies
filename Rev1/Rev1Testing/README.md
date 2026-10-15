# Rev 1 HIL test suite

Human-in-the-loop validation scripts for the Rev 1 sensor PCB (XIAO ESP32-C6).
The firmware in `src/main.cpp` boots idle and streams sensor data only when a
script asks for it; each script prompts you through the physical steps, captures
data, saves CSVs, analyzes immediately, and writes plots plus a PASS/FAIL `report.txt`.

## Setup

```bash
pio run -t upload                      # flash the HIL firmware (from the project root)
cd hil
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Close the PlatformIO serial monitor before running a script (only one program can hold the port).
The port is auto-detected; pass `--port /dev/cu.usbmodemXXXX` if you have several boards plugged in.

## Order to run

| Script | Covers | Default capture |
|---|---|---|
| `test_smoke.py` | MCU alive, I2C scan, every sensor streams plausible data | 5 s |
| `test_power.py --budget 0x40=<mA> --budget 0x41=<mA>` | power vs budget per rail (CS1 = IMU, CS2 = GPS) and labeled state | 20 s / state |
| `test_temp.py` | TMP36 vs reference: lab, outside, heat-gun ramp | 25 s (ramp 60 s) |
| `test_accel.py` | six-orientation 1 g test, 6-point calibration, vector magnitude, gyro bias | 10 s / orientation |
| `test_mag.py --expected-ut <NOAA total field>` | tumble capture, ellipsoid fit (hard/soft iron), field strength | 60 s |
| `test_gps.py` then `analyze_gps.py <session>` | 3 campus locations vs phone | 4 min / location after fix |

Every test except GPS takes `--from-csv <raw csv>` to re-run analysis on old data,
and `--no-show` to save plots without opening windows. GPS analysis is its own
script: `python analyze_gps.py results/gps_<timestamp>`.

Results land in `hil/results/<test>_<timestamp>/` (override with `--out`).
Pass/fail limits are all CLI flags (`--help` on any script); defaults are starting points, not spec.

## Dry run without hardware

`--port sim` uses `sim_device.py`, a fake board with deliberately imperfect sensors,
so you can rehearse the prompts and check the plots before going to the lab or across campus.

## Serial protocol (for debugging in a plain serial monitor)

`PING`, `INFO`, `SCAN`, `START IMU|MAG|TMP|PWR|GPS|ALL [period_ms]`, `STOP`, `MON`
(`MON` = the old human-readable 1 Hz printout). Data lines start with `$`, status lines with `#`.
Field lists are at the top of `src/main.cpp`.