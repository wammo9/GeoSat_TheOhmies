/*
 * main.c - GeoSat sensor module, naive port of the XIAO ESP32-C6 sketch.
 *
 * Same behaviour as the Arduino version:
 *   - GPS NMEA drained continuously
 *   - every 1 s: TMP36, LSM6DSOX, LIS3MDL, INA219, GPS printed to serial
 *
 * Serial output is on the ST-LINK virtual COM port at 115200 8N1.
 */
#include "board.h"
#include "clock.h"
#include "tick.h"
#include "debug_uart.h"
#include "i2c.h"
#include "adc.h"
#include "gps_uart.h"
#include "imu.h"
#include "ina219.h"
#include "gps.h"
#include "stm32l4xx_ll_adc.h"
#include <stdio.h>

#define PRINT_INTERVAL_MS 1000U

static bool    lsm_ok;
static uint8_t lis_addr;   /* 0 = not found */
static bool    ina_ok;

static float read_tmp36_c(uint32_t *vdda_mv_out)
{
  uint32_t vdda = adc_read_vdda_mv();
  uint32_t mv   = adc_read_channel_mv(TMP36_ADC_CH, vdda);
  if (vdda_mv_out) { *vdda_mv_out = vdda; }
  /* TMP36: 500 mV offset at 0 C, 10 mV / C */
  return ((float)mv - 500.0f) / 10.0f;
}

static void i2c_scan(void)
{
  printf("I2C scan:");
  int found = 0;
  for (uint8_t a = 0x08; a < 0x78; a++) {
    if (i2c_probe(a) == 0) {
      printf(" 0x%02X", a);
      found++;
    }
  }
  printf(found ? "\n" : " (nothing - check wiring / pull-ups / SB16+SB18)\n");
}

static void setup(void)
{
  clock_init();
  tick_init();
  board_led_init();
  debug_uart_init(115200);

  printf("\n=== NUCLEO-L432KC Multi-Sensor Initialization ===\n");
  printf("SYSCLK %lu Hz\n", (unsigned long)SystemCoreClock);

  /* 1. ADC for TMP36 (+ VREFINT for real VDDA) */
  adc_init();

  /* 2. I2C bus @ 400 kHz */
  i2c_init();
  i2c_scan();

  /* 3. LSM6DSOX */
  lsm_ok = lsm6dsox_setup(LSM6DSOX_ADDR);
  printf(lsm_ok ? "[OK] LSM6DSOX initialized (0x%02X).\n"
                : "[FAIL] LSM6DSOX not detected at 0x%02X!\n", LSM6DSOX_ADDR);

  /* 4. LIS3MDL - the ESP32 code used 0x1E but printed 0x1C, so try both */
  lis_addr = lis3mdl_setup(LIS3MDL_ADDR_A, LIS3MDL_ADDR_B);
  if (lis_addr) {
    printf("[OK] LIS3MDL initialized (0x%02X).\n", lis_addr);
  } else {
    printf("[FAIL] LIS3MDL not detected at 0x%02X or 0x%02X!\n", LIS3MDL_ADDR_A, LIS3MDL_ADDR_B);
  }

  /* 5. INA219 */
  ina_ok = ina219_setup(INA219_ADDR);
  printf(ina_ok ? "[OK] INA219 initialized (0x%02X).\n"
                : "[FAIL] INA219 not detected at 0x%02X!\n", INA219_ADDR);

  /* 6. GPS UART */
  gps_uart_init(GPS_BAUD);
  printf("[OK] GPS USART1 listening on D0 (PA10) @ %u baud.\n", (unsigned)GPS_BAUD);
  printf("==================================================\n\n");
}

static void print_readings(void)
{
  printf("---------------- SENSOR READINGS ----------------\n");

  uint32_t vdda;
  float t = read_tmp36_c(&vdda);
  printf("TMP36 Temp:    %.2f C (%.2f F)   [VDDA %lu mV]\n",
         t, t * 1.8f + 32.0f, (unsigned long)vdda);

  if (lsm_ok) {
    vec3f_t a, g;
    if (lsm6dsox_read(&a, &g)) {
      printf("Accel [m/s^2]: X=%.2f, Y=%.2f, Z=%.2f\n", a.x, a.y, a.z);
      printf("Gyro  [rad/s]: X=%.2f, Y=%.2f, Z=%.2f\n", g.x, g.y, g.z);
    } else {
      printf("LSM6DSOX:      read error\n");
    }
  }

  if (lis_addr) {
    vec3f_t m;
    if (lis3mdl_read(&m)) {
      printf("Mag    [uT]:   X=%.2f, Y=%.2f, Z=%.2f\n", m.x, m.y, m.z);
    } else {
      printf("LIS3MDL:       read error\n");
    }
  }

  if (ina_ok) {
    float v, i, p;
    if (ina219_read(&v, &i, &p)) {
      printf("INA219:        %.2f V | %.2f mA | %.2f mW\n", v, i, p);
    } else {
      printf("INA219:        read error\n");
    }
  }

  const gps_fix_t *fix = gps_get();
  printf("GPS:           ");
  if (fix->location_valid) {
    printf("Lat: %.6f, Lon: %.6f | Alt: %.1fm | Sats: %d\n",
           fix->lat_deg, fix->lon_deg, fix->alt_m, fix->sats);
  } else {
    printf("Searching... (Characters processed: %lu, Sentences: %lu, Sats: %d, RX drops: %lu)\n",
           (unsigned long)fix->chars_processed, (unsigned long)fix->sentences_ok,
           fix->sats, (unsigned long)gps_uart_overflows());
  }
  printf("\n");
}

int main(void)
{
  setup();

  uint32_t last_print = millis();
  while (1) {
    /* Parse whatever NMEA has arrived (ISR has been buffering it) */
    gps_poll();

    if ((millis() - last_print) >= PRINT_INTERVAL_MS) {
      last_print += PRINT_INTERVAL_MS;
      board_led_toggle();   /* heartbeat */
      print_readings();
    }

    /* Sleep until the next interrupt (1 ms SysTick or a GPS byte).
     * First step toward low power; Stop 2 comes later. */
    __WFI();
  }
}
