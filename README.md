# GeoSat – The Ohmies

CU Boulder ECEN Capstone 2026-27, Space Grant GeoSat project.

GeoSat is a small sensor module for a satellite-style payload. It measures
temperature, acceleration, magnetic field, power draw and GPS position/time.
This repo holds everything the team builds: the firmware for each PCB revision,
the hardware-in-the-loop (HIL) test suites that validate it, and the team's
project-management web app.

## Repository layout

| Folder | What's in it | Details |
|---|---|---|
| [`Rev0.5/`](Rev0.5) | First prototype: ESP32-C6 PlatformIO sketch + a plotting script | – |
| [`Rev1/`](Rev1) | Rev 1 PCB (XIAO ESP32-C6): firmware and HIL test suite in `Rev1Testing/`, with recorded results in `rev1_results/` | [`Rev1/Rev1Testing/README.md`](Rev1/Rev1Testing/README.md) |
| [`Rev1.1/`](Rev1.1) | Port of the firmware to the STM32L4 (bare-metal LL, CMake) | [`Rev1.1/stm32-fw-rev1.1/README.md`](Rev1.1/stm32-fw-rev1.1/README.md) |
| [`Rev2/`](Rev2) | STM32L4 firmware, one folder per revision (2.1 to 2.4). **2.4 is the latest.** | [`Rev2/stm32-fw-rev2.4/README.md`](Rev2/stm32-fw-rev2.4/README.md) |
| [`TeamBoard/`](TeamBoard) | Team task board, calendar, budget and archive (React + Supabase) | [`TeamBoard/README.md`](TeamBoard/README.md) |
| [`GUI_Models/`](GUI_Models) | Mock-ups of the ground-station GUI (images only) | – |

## Hardware revisions

| Rev | MCU / board | Sensors added |
|---|---|---|
| 0.5 | ESP32-C6 dev kit | Prototype sensors, Arduino framework |
| 1 | XIAO ESP32-C6 | TMP36 temp, LSM6DSOX IMU, LIS3MDL magnetometer, INA219 power monitors, Adafruit Ultimate GPS (PA1010D) |
| 1.1 | STM32L432KC (Nucleo) / STM32L433CCT6 | Same sensors, ported to bare-metal STM32 |
| 2.1 | STM32L4 | u-blox SAM-M10Q GPS (UBX over I2C) |
| 2.2 | STM32L4 | TMP117 temp sensor; `geosat_hil` test image and Python HIL suite |
| 2.3 | STM32L4 | PNI RM3100 low-noise magnetometer |
| 2.4 | STM32L4 | ADXL355 low-noise accelerometer (SPI) |

## Quick start

Pick the part you want to work on.

### Firmware (Rev 2.4, STM32L4)

Needs macOS or Linux, the Arm GNU toolchain, CMake, Ninja and OpenOCD. A
Nucleo-L432KC with sensor breakouts is the dev target.

```bash
brew install --cask gcc-arm-embedded     # the cask, not the formula (it has no newlib)
brew install cmake ninja open-ocd

cd Rev2/stm32-fw-rev2.4
cmake --preset debug
cmake --build --preset debug

# flash over the ST-LINK
openocd -f interface/stlink.cfg -f target/stm32l4x.cfg \
        -c "program build/debug/geosat_fw.elf verify reset exit"
```

It builds three images: `blink` (flash this first to check the toolchain),
`geosat_fw` (the full application) and `geosat_hil` (the test image).
Wiring, serial output, debugging and the per-sensor notes are in the
[Rev 2.4 README](Rev2/stm32-fw-rev2.4/README.md). The first configure
downloads the ST/CMSIS/sensor driver sources, so it needs internet once.

### HIL tests (Python)

Each script walks you through a physical step (tumble the board, hold it
still, take it outside), captures data, saves CSVs and plots, and writes a
PASS/FAIL `report.txt`.

```bash
# flash the test image first
openocd -f interface/stlink.cfg -f target/stm32l4x.cfg \
        -c "program build/debug/geosat_hil.elf verify reset exit"

cd Rev2/stm32-fw-rev2.4/hil
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python test_smoke.py
```

Scripts include `test_smoke`, `test_power`, `test_temp`, `test_accel`,
`test_accel_noise`, `test_mag`, `test_mag_noise` and `test_gps` (plus
`analyze_gps`). Close any serial monitor first, since only one program can hold
the port. Results go to `hil/results/<test>_<timestamp>/`. Pass/fail limits are
CLI flags; see the [HIL README](Rev2/stm32-fw-rev2.4/hil/README.md) for the
recommended run order and what each test needs.

The HIL protocol parser can also be checked on your laptop with no hardware
(see section 8 of the Rev 2.4 README, `tests/host/`).

### Team Board (web app)

Needs Node.js. For a local backend you also need Docker (for Supabase).

```bash
cd TeamBoard
npm install
cp .env.example .env       # add your Supabase URL and anon key
npm run dev                # http://localhost:5173
npm test                   # schema and logic tests
npm run build              # production build in dist/
```

Without a Supabase project the site shows a "Backend setup needed" screen.
To run a local one: `npm run db:start` (prints the URL and key for `.env.local`),
and `npm run db:stop` when done. Hosted setup, the SQL upgrade scripts
and the two-browser verification checklist are in the
[TeamBoard README](TeamBoard/README.md).

## Older revisions

- **Rev 0.5** is a PlatformIO project (`Rev0.5/platform.ini`, `main.cpp`);
  `plot_geosat.py` plots its output.
- **Rev 1** firmware is PlatformIO (`pio run -t upload` from `Rev1/Rev1Testing`);
  its HIL suite lives in `Rev1/Rev1Testing/hil`, set up the same way as above.
- **Rev 1.1 and Rev 2.1 to 2.3** are kept as snapshots of earlier firmware and
  build the same way as 2.4. New work goes in the newest folder.

## Team

Six-person CU Boulder ECEN capstone team. Task tracking, the calendar and the
budget live in the Team Board.
