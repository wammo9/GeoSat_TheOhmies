# Rev 1 validation results

Clean runs from bring-up and validation of the Rev 1 sensor PCB (XIAO ESP32-C6), captured
with the HIL test suite in `../hil/` and firmware `rev1-hil-1.5`. Each folder holds the raw
CSV(s), plots and a `report.txt` with the PASS/FAIL checks. Any run can be re-analyzed
from its CSV (see `../hil/README.md`).

| Run | Test | Result |
|---|---|---|
| `smoke_20261015_100920` | Comms + streaming | PASS: LSM6DSOX (0x6A), LIS3MDL (0x1C), 2x INA219 (0x40, 0x41) on I2C; all streams plausible |
| `accel_20261015_101023` | LSM6DSOX six-orientation | ±1 g on the correct axis with correct polarity in all 6 orientations; vector magnitude within ~±1% of 1 g |
| `temp_20261015_102117` | TMP36 vs reference | Lab ambient within ~0.2 °C of reference; hand-warming ramp tracked to ~0.2 °C (heat source: hand, not heat gun) |
| `mag_20261015_102947` | LIS3MDL tumble + ellipsoid fit | 98% coverage, 1.4% fit residual, 7.6 µT hard-iron offset; calibrated \|B\| 41.8 µT within ~2% of a phone reference at the same spot (indoor field ~18% below WMM 51.06 µT due to the building) |
| `gps_20261015_115121` | GPS field test, 3 campus sites | PASS: offset from Google Maps reference 0.4 / 2.1 / 4.8 m (all within 10 m); CEP50 0.1–0.3 m over ~41 s per site; 10–13 satellites, HDOP 0.9–1.1; hot start (fix already held) |

## Bring-up notes

- **Intermittent SCL (D5) contact at the XIAO** made the whole I2C bus disappear until the
  XIAO was reseated; reflow or solder the XIAO directly.
- **Both INA219 breakouts default to 0x40**; A0 bridged on one so it moves to 0x41.
- The schematic's MCU symbol is the XIAO ESP32-**S3** part, so its GPIO labels don't match
  the C6; firmware maps by XIAO pad / D-number instead.
- Power analysis (`test_power.py`) not yet run.