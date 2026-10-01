# GeoSat sensor module firmware (STM32L4, bare-metal LL)

Port of the XIAO ESP32-C6 Arduino sketch to the STM32L432KC (NUCLEO-L432KC) /
STM32L433CCT6 flight board. CMSIS + ST LL drivers, arm-none-eabi-gcc, CMake,
no STM32CubeIDE and no HAL.

Two firmware images:

| Target      | What it does                                                        |
|-------------|---------------------------------------------------------------------|
| `blink`     | LED + `printf` over the ST-LINK USB serial. Flash this first.        |
| `geosat_fw` | The full port: TMP36, LSM6DSOX, LIS3MDL, INA219, Ultimate GPS v3 GPS.         |

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
| GPS TX → MCU | **D0**     | PA10    | D2 (moved!)          |
| MCU → GPS RX | D1         | PA9     | D1                   |
| TMP36 Vout   | A0         | PA0     | A0                   |
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
src/drivers/                imu (ST drivers glue), ina219, gps (minmea)
src/app/blink.c, main.c     the two firmware images
```

## Arduino → STM32 mapping

| Arduino / ESP32                   | Here                                                           |
|-----------------------------------|----------------------------------------------------------------|
| `Serial.printf`                   | `printf` → USART2 → ST-LINK USB serial (`syscalls.c`)           |
| `millis()`                        | `millis()` from 1 ms SysTick (`tick.c`)                          |
| `Wire` @ 400 kHz                  | `i2c.c` (LL, blocking with timeouts)                            |
| `analogReadMilliVolts`            | `adc.c`, corrected by VREFINT factory calibration                |
| `Adafruit_LSM6DSOX` / `LIS3MDL`   | ST's official `lsm6dsox-pid` / `lis3mdl-pid` drivers (`imu.c`)   |
| `Adafruit_INA219`                 | `ina219.c`, same 32 V / 2 A calibration                          |
| `HardwareSerial` + `TinyGPSPlus`  | USART1 RX interrupt ring buffer + `minmea` (`gps_uart.c`, `gps.c`)|

## Next steps (low-power pass)

1. Voltage Range 2 and a lower MSI when idle.
2. LSE + MSI PLL-mode for an accurate clock.
3. RTC wakeup + Stop 2 instead of SysTick + `__WFI()`.
4. Move the GPS to LPUART1 so it can receive while the MCU is in Stop 2.
5. Put the sensors in power-down or low ODR between samples.
