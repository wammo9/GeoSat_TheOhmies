/*
 * adxl355.h - Analog Devices ADXL355 low-noise 3-axis accelerometer (SPI).
 *
 * Wired through the EVAL-ADXL355-PMDZ (12-pin PMOD, extended SPI) to SPI1:
 * see board.h. 20-bit output, +/-2 g range: 256,000 LSB/g (3.9 ug/LSB),
 * 22.5 ug/sqrt(Hz) noise density.
 */
#ifndef ADXL355_H
#define ADXL355_H

#include <stdbool.h>
#include <stdint.h>
#include "imu.h"   /* vec3f_t */

/* Output data rate (FILTER register ODR_LPF); the low-pass corner is ODR/4 */
#define ADXL355_ODR_4000HZ  0x00U
#define ADXL355_ODR_1000HZ  0x02U
#define ADXL355_ODR_500HZ   0x03U
#define ADXL355_ODR_250HZ   0x04U
#define ADXL355_ODR_125HZ   0x05U
#define ADXL355_ODR_62HZ    0x06U   /* 62.5 Hz */
#define ADXL355_ODR_31HZ    0x07U   /* 31.25 Hz */

/* Resets the part, checks its ID registers (0xAD / 0x1D / 0xED), sets +/-2 g
 * and `odr`, and starts measuring. Returns false if it isn't there.
 * *partid gets PARTID (0xED for a real ADXL355, whatever was read otherwise). */
bool adxl355_setup(uint8_t odr, uint8_t *partid);

/* Latest XYZ sample in m/s^2. *fresh = true if a new sample was ready
 * (STATUS.DATA_RDY). Returns false on an SPI error. */
bool adxl355_read(vec3f_t *accel_ms2, bool *fresh);

/* Same sample in raw 20-bit counts (256,000 per g): the compact form to store. */
bool adxl355_read_raw(int32_t xyz[3], bool *fresh);

/* On-chip temperature, degC (uncalibrated: +/- a few degC). */
bool adxl355_read_temp(float *temp_c);

#endif
