# Rev 2 HIL test suite (NUCLEO-L432KC + breakouts)

Rev 2.3: adds the RM3100 magnetometer (`$RMG` stream), `test_mag_noise.py`, and
`test_mag.py --sensor rm3100|lis3mdl|both`.

Human-in-the-loop validation scripts, ported from the Rev 1 (XIAO ESP32-C6) suite.
The `geosat_hil` firmware boots idle and streams sensor data only when a script asks
for it; each script prompts you through the physical steps, captures data, saves CSVs,
analyzes immediately, and writes plots plus a PASS/FAIL `report.txt`.

What changed from Rev 1:

| | Rev 1 | Rev 2 |
|---|---|---|
| MCU / port | XIAO ESP32-C6, USB CDC | Nucleo-L432KC, ST-LINK virtual COM port (auto-detected) |
| Temperature | TMP36 (analog) | **TMP117** (I2C 0x48), ±0.1 °C; logs only new conversions |
| GPS | PA1010D, NMEA over UART | **SAM-M10Q** (I2C 0x42), UBX-NAV-PVT: fix type, hAcc/vAcc, pDOP |
| GPS test | time-to-fix from whatever state the module was in | adds `--start cold|warm|hot` to restart the receiver and measure TTFF |
| I2C diag | pin hunt across XIAO pads | line levels on D4/D5, bus recovery, named scan |

## Setup

```bash
# from the firmware folder
cmake --build --preset debug
openocd -f interface/stlink.cfg -f target/stm32l4x.cfg \
        -c "program build/debug/geosat_hil.elf verify reset exit"
cd hil
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Wiring is the same as `geosat_fw` (top-level README, section 6): everything on D4 (SDA) /
D5 (SCL), 3V3, GND. Close any serial monitor before running a script (only one program can
hold the port). Pass `--port /dev/cu.usbmodemXXXX` if more than one board is plugged in.

## Order to run

| Script | Covers | Default capture |
|---|---|---|
| `diag_i2c.py` | only if something's missing: line levels, bus recovery, named I2C scan | ~10 s |
| `test_smoke.py [--ina N]` | MCU alive, I2C scan, every sensor streams plausible data, GPS link + UBX config | 5 s |
| `test_power.py --budget 0x40=<mA>` | current vs budget per INA219, per labeled state | 20 s / state |
| `test_temp.py` | TMP117 vs reference: lab, outside, heat ramp | 25 s (ramp 60 s) |
| `test_accel.py` | six-orientation 1 g test, 6-point calibration, vector magnitude, gyro bias | 10 s / orientation |
| `test_mag.py --expected-ut <NOAA total field>` | tumble capture, ellipsoid fit (hard/soft iron), field strength; RM3100 and LIS3MDL together by default | 60 s |
| `test_mag_noise.py [--delta-nt 30]` | board still: RM3100 vs LIS3MDL noise, smallest step each can see at 10 Hz | 30 s |
| `test_gps.py [--start cold]` then `analyze_gps.py <session>` | 3 campus locations vs phone, TTFF | 4 min / location after fix |

Every test except GPS takes `--from-csv <raw csv>` to re-run analysis on old data, and
`--no-show` to save plots without opening windows. `analyze_gps.py` also reads Rev 1 GPS
sessions (HDOP instead of pDOP), so old and new runs can be compared.

Results land in `hil/results/<test>_<timestamp>/` (override with `--out`).
Pass/fail limits are all CLI flags (`--help` on any script); defaults are starting points, not spec.

### Notes on the new sensors

- **RM3100:** `test_mag.py` captures both magnetometers in one tumble and reports each
  sensor's own calibration, plus whether they agree on field strength.
  `test_mag_noise.py` is the one that shows why the RM3100 is on the board. Do it on a
  non-metal surface with the laptop a metre away (long USB cable), because anything
  moving nearby shows up at the nanotesla level. `--delta-nt` is the change you need to
  detect (default 30 nT).
- **TMP117:** converts every 500 ms, averaging 8 readings (`tmp117.c`). The script
  polls every 250 ms and keeps only rows with `fresh = 1`. The sensor is good to
  ±0.1 °C, so set `--tol` to your reference thermometer's accuracy (default 1.0 °C).
- **SAM-M10Q:** `fix_type` 3 = 3D. `h_acc_m` is the receiver's own 1-sigma estimate, logged
  next to the measured spread. `--start cold` clears its stored satellite data with
  UBX-CFG-RST before each location, so the time to fix is a true cold start. The default
  `asis` keeps whatever it already has, like Rev 1, which usually means a hot start.

## Dry run without hardware

`--port sim` uses `sim_device.py`, a fake board with deliberately imperfect sensors (a
TMP117 that converts every 500 ms, a SAM-M10Q with a ~27 s cold start), so you can rehearse
the prompts and check the plots before going to the lab or across campus.

## Serial protocol (for debugging in a plain serial monitor, 115200 8N1)

`PING`, `INFO`, `SCAN`, `START IMU|MAG|TMP|PWR|GPS|RMG|ALL [period_ms]`, `STOP`, `MON`
(human-readable 1 Hz printout), `BUS` (SDA/SCL line levels), `REINIT` (bus recovery +
re-detect), `GPSRST HOT|WARM|COLD`, `HELP`. Data lines start with `$`, status lines with
`#`. Field lists are at the top of `src/app/hil_proto.h` and in `FIELDS` in `common.py`;
`tests/host/` checks that the two agree.
