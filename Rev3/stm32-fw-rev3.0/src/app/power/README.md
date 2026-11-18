# Power measurement code

Firmware for measuring how much current a sensor draws, using an INA219 as the
current sensor. One file per sensor under test.

| File | Measures | CMake target |
|---|---|---|
| `power_tmp117.c` | TMP117 temperature sensor (INA219 at 0x40, TMP117 at 0x48) | `power_tmp117` |

## Wiring (TMP117 test)

```
external 3.3 V (+) ──> INA219 VIN+
                       INA219 VIN-  ──> TMP117 VCC     (INA219 is in series)
external 3.3 V (-) ──> INA219 GND ── TMP117 GND ── Nucleo GND   (one common ground)
Nucleo 3V3 (or ext) ─> INA219 VCC
Nucleo D4 (PB7) ─────> INA219 SDA + TMP117 SDA
Nucleo D5 (PB6) ─────> INA219 SCL + TMP117 SCL
Nucleo powered from the Mac over USB
```

Your external meter goes in series in the same path (or measure across the
INA219 shunt). Do not also power the TMP117 from the Nucleo's 3V3.

## Build, flash, read

From `Rev3/stm32-fw-rev3.0/` (one-time toolchain setup is in the main README, section 1):

```bash
cmake --preset debug
cmake --build --preset debug
openocd -f interface/stlink.cfg -f target/stm32l4x.cfg \
        -c "program build/debug/power_tmp117.elf verify reset exit"
screen /dev/tty.usbmodem* 115200
```

(`screen`: quit with Ctrl-A then K, then y.) Output, about twice a second:

```
t=2012 ms  Vbus=3.296 V  shunt=120.0 uV  I=1200.0 uA  P=3955.2 uW  T=23.141 C  (n=128)
```

## Caveat: INA219 resolution

With the 0.1 ohm shunt the INA219 resolves 10 uV = 100 uA per count. The TMP117
draws ~3.5 uA standby to ~135 uA converting, so the INA219 reading is
approximate (the code averages 128 samples to help). Use the external meter
as the real measurement and the INA219 as a cross-check / time log.
