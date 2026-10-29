#ifndef IMU_H
#define IMU_H

#include <stdbool.h>
#include <stdint.h>

typedef struct { float x, y, z; } vec3f_t;

/* LSM6DSOX: +/-4 g, +/-500 dps, 104 Hz */
bool lsm6dsox_setup(uint8_t addr7);
bool lsm6dsox_read(vec3f_t *accel_ms2, vec3f_t *gyro_rads);

/* LIS3MDL: +/-4 gauss, continuous, 80 Hz ultra-high-performance.
 * Tries each address given; returns the one that answered, or 0. */
uint8_t lis3mdl_setup(uint8_t addr_a, uint8_t addr_b);
bool    lis3mdl_read(vec3f_t *mag_ut);

#endif
