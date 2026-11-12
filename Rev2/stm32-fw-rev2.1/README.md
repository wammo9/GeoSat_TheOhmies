# GeoSat sensor module firmware, Rev 2.1 (STM32L4, bare-metal LL)

Rev 2.1 change: GPS is now the u-blox SAM-M10Q (was the Adafruit Ultimate GPS v3).
See "SAM-M10Q GPS" below.

Port of the XIAO ESP32-C6 Arduino sketch to the STM32L432KC (NUCLEO-L432KC) /
STM32L433CCT6 flight board. CMSIS + ST LL drivers, arm-none-eabi-gcc, CMake,
no STM32CubeIDE and no HAL.

Two firmware images:

| Target      | What it does                                                        |
|-------------|---------------------------------------------------------------------|
| `blink`     | LED + `printf` over the ST-LINK USB serial. Flash this first.        |
| `geosat_fw` | The full port: TMP117, LSM6DSOX, LIS3MDL, INA219, SAM-M10Q GPS.      |

---

## 1. One-time setup (Apple Silicon Mac)

```bash
# Arm GNU toolchain. Use the CASK, not `brew install arm-none-eabi-gcc`
# (the formula has no newlib, so printf/libc won't link).
brew install --cask gcc-arm-embedded

brew install cmake ninja open-ocd
```

Check it:

```bash
arm-none-eabi-gcc --version     # should print 13.x or 14.x
openocd --version
```

If `arm-none-eabi-gcc` isn't found, add the toolchain to your PATH in `~/.zshrc`
(the version folder may differ; `ls /Applications/ArmGNUToolchain`):

```bash
export PATH="/Applications/ArmGNUToolchain/14.2.rel1/arm-none-eabi/bin:$PATH"
```

VS Code extensions (it will prompt you from `.vscode/extensions.json`):
CMake Tools, C/C++, Cortex-Debug, Serial Monitor.

## 2. Build

Open the `geosat-fw` folder in VS Code. CMake Tools picks the **Debug
(NUCLEO-L432KC)** preset. The first configure downloads the ST/CMSIS/sensor
driver sources into `build/_deps` (needs internet once, ~1 min).

Build with **Cmd+Shift+B**, or from the terminal:

```bash
cmake --preset debug
cmake --build --preset debug
```

Output lands in `build/debug/`: `blink.elf/.bin/.hex`, `geosat_fw.elf/.bin/.hex`, and `.map` files.

## 3. Flash blink

Plug the Nucleo into USB. Pick one:

- **VS Code:** Cmd+Shift+P → *Tasks: Run Task* → **Flash blink**
- **Terminal:**
  ```bash
  openocd -f interface/stlink.cfg -f target/stm32l4x.cfg \
          -c "program build/debug/blink.elf verify reset exit"
  ```
- **No tools at all:** the Nucleo shows up as a USB drive called `NODE_L432KC`.
  Drag `build/debug/blink.bin` onto it.

The green LED LD3 should toggle every 500 ms.

## 4. See the serial output

The ST-LINK exposes a USB serial port wired to USART2 (115200 8N1).

- **VS Code:** Serial Monitor tab → port `/dev/tty.usbmodem…` → 115200 → Start
- **Terminal:** `screen /dev/tty.usbmodem* 115200` (quit: Ctrl-A then K, then y)

Expected:

```
=== NUCLEO-L432KC blink ===
SYSCLK = 16000000 Hz
float printf check: pi ~= 3.1416
tick 0  (uptime 3 ms)
tick 1  (uptime 503 ms)
```

If you see that, the toolchain, linker script, clocks, SysTick, flashing and
UART are all good.

## 5. Debugging

Press **F5** and pick *Debug blink* or *Debug geosat_fw*. It builds, flashes
through OpenOCD, and stops at `main()`. Breakpoints, stepping and variable
watches all work.

## 6. Wire the sensors and flash `geosat_fw`

| Signal       | Nucleo pin | MCU pin | XIAO pin it replaces |
|--------------|-----------:|---------|----------------------|
| I2C SDA      | D4         | PB7     | D4                   |
| I2C SCL      | D5         | PB6     | D5                   |
| SAM-M10Q GPS (I2C 0x42) | D4 / D5 (shared bus) | PB7 / PB6 | UART GPS on D0/D1 (UART still available, see below) |
| TMP117 (I2C, 0x48) | D4 / D5 (shared bus) | PB7 / PB6 | replaces the TMP36 on A0 |
| 3V3 / GND    | 3V3 / GND  |         |                      |

- **Don't use A4/A5.** Solder bridges SB16/SB18 connect them to D4/D5 (PB7/PB6).
- The Nucleo's pins are 3.3 V only. Your breakouts already are.

Then run **Flash geosat_fw** and open the serial monitor. At boot it scans the
I2C bus, so a missing sensor shows up immediately. The LIS3MDL is probed at
both 0x1E and 0x1C: the old code used 0x1E but printed 0x1C.

## 7. Building for the STM32L433CCT6 flight board

Select the **Debug (STM32L433CCT6 flight board)** preset (or
`cmake --preset flight-debug`). It changes the device define and startup file.
The linker script already fits both chips. Re-check `src/board.h` against the
flight board's schematic; that file is the only place pins live.

---

## Project layout

```
CMakeLists.txt, CMakePresets.json
cmake/arm-none-eabi.cmake   toolchain + CPU flags
cmake/deps.cmake            pinned third-party sources (fetched at configure)
linker/stm32l43x_flash.ld   256K flash / 64K RAM
src/board.h                 ALL pin assignments + I2C addresses
src/platform/               clock, tick, debug UART, I2C, ADC, GPS UART, syscalls
src/drivers/                imu (ST drivers glue), ina219, tmp117, ubx (u-blox protocol), gps_link (I2C/UART), gps (UBX + minmea)
src/app/blink.c, main.c     the two firmware images
```

## Arduino → STM32 mapping

| Arduino / ESP32                   | Here                                                           |
|-----------------------------------|----------------------------------------------------------------|
| `Serial.printf`                   | `printf` → USART2 → ST-LINK USB serial (`syscalls.c`)           |
| `millis()`                        | `millis()` from 1 ms SysTick (`tick.c`)                          |
| `Wire` @ 400 kHz                  | `i2c.c` (LL, blocking with timeouts)                            |
| TMP36 + `analogReadMilliVolts`    | TMP117 over I2C (`tmp117.c`); `adc.c` now only tracks VDDA via VREFINT |
| `Adafruit_LSM6DSOX` / `LIS3MDL`   | ST's official `lsm6dsox-pid` / `lis3mdl-pid` drivers (`imu.c`)   |
| `Adafruit_INA219`                 | `ina219.c`, same 32 V / 2 A calibration                          |
| `HardwareSerial` + `TinyGPSPlus`  | I2C (or USART1) link + UBX-NAV-PVT parser, `minmea` NMEA fallback (`gps_link.c`, `ubx.c`, `gps.c`)|

## SAM-M10Q GPS

**Default link: I2C**, address 0x42, on the shared sensor bus.

| SAM-M10Q | Nucleo | MCU |
|----------|--------|-----|
| SDA      | D4     | PB7 |
| SCL      | D5     | PB6 |
| 3V3/GND  | 3V3/GND|     |

On the SparkFun breakout a Qwiic cable works. Leave PPS, RST, INT and SAFE
unconnected.

- **Boot:** `gps_setup()` sends one UBX-CFG-VALSET (RAM layer, so it's redone
  every boot) that turns on UBX-NAV-PVT and turns off GLL/GSA/GSV/VTG on the I2C
  port. GGA and RMC stay on as a fallback. Expect 0x42 in the I2C scan, then
  `[OK] SAM-M10Q configured (UBX ACK)`.
- **Polling:** the firmware reads the module's byte count (registers 0xFD/0xFE)
  about 10 times a second and drains the data stream (0xFF) in 64-byte reads.
  Bytes that don't fit stay on the module until the next poll.
- **Output:** position (7 decimals), altitude, satellites, fix type, the
  receiver's own accuracy estimate (hAcc/vAcc), pDOP and UTC time.
- **Clock stretching:** u-blox modules may stretch SCL for up to 20 ms, so the
  I2C timeout is now 25 ms.
- **UART instead:** configure with `-DGPS_LINK_I2C=OFF` (or add
  `"GPS_LINK_I2C": "OFF"` to a preset). Then wire module TXD to D0 (PA10) and
  RXD to D1 (PA9), at 9600 baud.
- **Flight board:** the GPS moves to its own I2C bus there. Point it at that
  bus's peripheral and pins in `board.h` / `i2c.c`, and route TXD/RXD to test
  pads for u-center debugging.
- **Hardware notes:** don't load TIMEPULSE/PPS at power-up (it is tied to
  SAFEBOOT_N), and don't put a capacitor on RESET_N. The SparkFun board adds
  2.2 kΩ pull-ups to the bus; open its I2CPUR jumper if the bus misbehaves.

## Next steps (low-power pass)

1. Voltage Range 2 and a lower MSI when idle.
2. LSE + MSI PLL-mode for an accurate clock.
3. RTC wakeup + Stop 2 instead of SysTick + `__WFI()`.
4. Move the GPS to LPUART1 so it can receive while the MCU is in Stop 2.
5. Put the sensors in power-down or low ODR between samples.
