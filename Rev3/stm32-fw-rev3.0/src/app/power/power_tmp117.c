/*
 * power_tmp117.c - measure the current the TMP117 draws, using an INA219.
 *
 * Lives in src/app/power/, the home for power-measurement code (one file per
 * sensor under test; this is the TMP117 one).
 *
 * Starts the TMP117 the same way geosat_fw does (continuous, 500 ms cycle, 8x
 * averaged), then repeatedly averages the INA219 shunt reading and prints
 * current, bus voltage, power and the TMP117 temperature. Nothing else on the
 * board is initialised.
 *
 * Wiring (high-side measurement, INA219 in series with the TMP117 VCC):
 *   external 3.3 V (+) -> INA219 VIN+
 *   INA219 VIN-        -> TMP117 VCC
 *   external 3.3 V (-) -> INA219 GND, TMP117 GND, Nucleo GND  (ONE common ground)
 *   INA219 VCC         -> 3.3 V (Nucleo 3V3 or the external supply)
 *   INA219 SDA/SCL     -> D4 (PB7) / D5 (PB6), TMP117 SDA/SCL on the same pins
 *
 * Resolution warning: with the stock 0.1 ohm shunt the INA219's shunt register
 * has 10 uV/LSB = 100 uA/LSB, while the TMP117 draws only ~3.5 uA (standby) to
 * ~135 uA (converting). Single readings are at/below one LSB; averaging helps,
 * but treat your external meter as the real number and this as a cross-check.
 * Tip: take a zero-offset reading with the TMP117 VCC disconnected.
 *
 * Serial: 115200 8N1 on the ST-LINK virtual COM port.
 */
#include "board.h"
#include "clock.h"
#include "debug_uart.h"
#include "i2c.h"
#include "ina219.h"
#include "tick.h"
#include "tmp117.h"
#include <stdio.h>

#define AVG_SAMPLES   128
#define SAMPLE_GAP_MS 1
#define SHUNT_OHMS    0.1f   /* Adafruit INA219 breakout; change for a custom shunt */

int main(void)
{
  clock_init();
  tick_init();
  debug_uart_init(115200);

  printf("\n=== TMP117 power measurement (INA219) ===\n");

  i2c_init();

  printf("I2C scan:");
  for (uint8_t a = 0x08; a < 0x78; a++) {
    if (i2c_probe(a) == 0) {
      printf(" 0x%02X", a);
    }
  }
  printf("\n");

  if (!ina219_setup(INA219_ADDR)) {
    printf("[FAIL] INA219 not detected at 0x%02X. Check SDA/SCL/GND and its VCC.\n",
           INA219_ADDR);
    while (1) { delay_ms(1000); }
  }
  printf("[OK] INA219 (0x%02X), 32 V range, %.2f ohm shunt, %d-sample average.\n\n",
         INA219_ADDR, (double)SHUNT_OHMS, AVG_SAMPLES);

  if (tmp117_setup(TMP117_ADDR)) {
    printf("[OK] TMP117 running (0x%02X), continuous, 500 ms cycle.\n\n", TMP117_ADDR);
  } else {
    printf("[WARN] TMP117 not detected at 0x%02X; the current below is NOT the sensor's.\n\n",
           TMP117_ADDR);
  }

  while (1) {
    float sum_bus = 0.0f, sum_shunt = 0.0f;
    int n = 0;

    for (int i = 0; i < AVG_SAMPLES; i++) {
      float bus_v, shunt_mv, cur_ma, pwr_mw;
      if (ina219_read_at(INA219_ADDR, &bus_v, &shunt_mv, &cur_ma, &pwr_mw)) {
        sum_bus += bus_v;
        sum_shunt += shunt_mv;
        n++;
      }
      delay_ms(SAMPLE_GAP_MS);
    }

    if (n == 0) {
      printf("t=%lu ms  INA219 read error\n", (unsigned long)millis());
      continue;
    }

    float bus_v     = sum_bus / (float)n;
    float shunt_uv  = (sum_shunt / (float)n) * 1000.0f;
    float current_ua = shunt_uv / SHUNT_OHMS;            /* uV / ohm = uA */
    float power_uw   = bus_v * current_ua;               /* V * uA = uW   */

    int16_t raw;
    float temp_c = 0.0f;
    bool have_t = tmp117_read_raw(&raw);
    if (have_t) { temp_c = tmp117_raw_to_c(raw); }

    printf("t=%lu ms  Vbus=%.3f V  shunt=%.1f uV  I=%.1f uA  P=%.1f uW  T=%.3f C  (n=%d)\n",
           (unsigned long)millis(), (double)bus_v, (double)shunt_uv,
           (double)current_ua, (double)power_uw,
           (double)(have_t ? temp_c : 0.0f), n);
  }
}
