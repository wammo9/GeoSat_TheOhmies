/*
 * rm3100.h - PNI RM3100 magneto-inductive magnetometer (I2C).
 *
 * Breakout wiring for I2C: I2CEN -> 3V3 (selects I2C); SSN (= SA0) and SO/MISO
 * (= SA1) -> GND for 0x20 (0x21-0x23 with them high); SCK = SCL, SI = SDA on the
 * sensor bus; AVDD + DVDD -> 3V3, AVSS + DVSS -> GND.
 * DRDY is optional; the driver polls the STATUS register instead.
 *
 * Runs in continuous measurement mode (CMM) with cycle count 200 on every axis:
 * 75 LSB/uT, about 15 nT noise, each XYZ conversion ~13 ms.
 */
#ifndef RM3100_H
#define RM3100_H

#include <stdbool.h>
#include <stdint.h>
#include "imu.h"   /* vec3f_t */

#define RM3100_ADDR_DEFAULT  0x20U   /* SA0 = SA1 = 0 */
#define RM3100_REVID_EXPECTED 0x22U

/* Continuous-mode update rates (TMRC register), valid at cycle count 200 */
#define RM3100_RATE_75HZ  0x95U
#define RM3100_RATE_37HZ  0x96U
#define RM3100_RATE_18HZ  0x97U
#define RM3100_RATE_9HZ   0x98U

/* Tries 0x20..0x23. Sets cycle count 200 on X/Y/Z and starts continuous mode
 * at `rate` (RM3100_RATE_*). Returns the address that answered, or 0.
 * *revid gets the REVID register (0x22 on current parts). */
uint8_t rm3100_setup(uint8_t rate, uint8_t *revid);

/* Latest XYZ result in uT. *fresh = true if a new conversion finished since the
 * last read (STATUS.DRDY). Returns false on an I2C error. */
bool rm3100_read(vec3f_t *mag_ut, bool *fresh);

/* Same result in raw counts (24-bit signed, 75 counts per uT): the compact
 * form to store or transmit. */
bool rm3100_read_raw(int32_t xyz[3], bool *fresh);

#endif
