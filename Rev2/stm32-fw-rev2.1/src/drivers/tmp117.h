#ifndef TMP117_H
#define TMP117_H

#include <stdbool.h>
#include <stdint.h>

/* Adafruit 4821 default address (ADD0 -> GND). Solder-jumper options:
 * 0x49 (ADD0 -> V+), 0x4A (ADD0 -> SDA), 0x4B (ADD0 -> SCL). */
#define TMP117_ADDR_DEFAULT 0x48U

/* 1 LSB of the result register = 1/128 degC */
#define TMP117_LSB_C 0.0078125f

/* Checks the device ID, soft-resets, then starts continuous conversion:
 * one result every 500 ms, each the average of 8 conversions.
 * The sensor free-runs on its own, so the MCU can sleep between reads. */
bool tmp117_setup(uint8_t addr7);

/* Latest result in raw LSBs (the compact form to store/transmit).
 * Returns false on an I2C error or if no conversion has finished yet. */
bool tmp117_read_raw(int16_t *raw);

static inline float tmp117_raw_to_c(int16_t raw)
{
  return (float)raw * TMP117_LSB_C;
}

#endif
