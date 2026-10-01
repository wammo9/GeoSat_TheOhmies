/*
 * imu.c - glue between ST's platform-independent drivers and our I2C layer.
 *
 * The ST drivers (lsm6dsox_reg.c / lis3mdl_reg.c) know every register; they
 * only need read/write callbacks. The I2C address rides in ctx.handle.
 */
#include "imu.h"
#include "i2c.h"
#include "tick.h"
#include "lsm6dsox_reg.h"
#include "lis3mdl_reg.h"
#include <stdint.h>
#include <stdio.h>

#define G_TO_MS2      9.80665f
#define DEG_TO_RAD    0.01745329252f
#define GAUSS_TO_UT   100.0f
#define RESET_TIMEOUT_MS 50U

static stmdev_ctx_t s_lsm;
static stmdev_ctx_t s_lis;

/* ---- I2C callbacks --------------------------------------------------------- */

static int32_t plat_write(void *handle, uint8_t reg, const uint8_t *buf, uint16_t len)
{
  return i2c_write_regs((uint8_t)(uintptr_t)handle, reg, buf, len);
}

static int32_t plat_read(void *handle, uint8_t reg, uint8_t *buf, uint16_t len)
{
  return i2c_read_regs((uint8_t)(uintptr_t)handle, reg, buf, len);
}

/* LIS3MDL auto-increments only when the register address MSB is set */
static int32_t lis_write(void *handle, uint8_t reg, const uint8_t *buf, uint16_t len)
{
  if (len > 1U) { reg |= 0x80U; }
  return i2c_write_regs((uint8_t)(uintptr_t)handle, reg, buf, len);
}

static int32_t lis_read(void *handle, uint8_t reg, uint8_t *buf, uint16_t len)
{
  if (len > 1U) { reg |= 0x80U; }
  return i2c_read_regs((uint8_t)(uintptr_t)handle, reg, buf, len);
}

/* ---- LSM6DSOX -------------------------------------------------------------- */

bool lsm6dsox_setup(uint8_t addr7)
{
  s_lsm.write_reg = plat_write;
  s_lsm.read_reg  = plat_read;
  s_lsm.mdelay    = delay_ms;
  s_lsm.handle    = (void *)(uintptr_t)addr7;

  uint8_t id = 0;
  if (lsm6dsox_device_id_get(&s_lsm, &id) != 0 || id != LSM6DSOX_ID) {
    return false;
  }

  /* Software reset -> known state */
  lsm6dsox_reset_set(&s_lsm, PROPERTY_ENABLE);
  uint8_t rst = 1;
  uint32_t t0 = millis();
  do {
    lsm6dsox_reset_get(&s_lsm, &rst);
  } while (rst && (millis() - t0) < RESET_TIMEOUT_MS);

  lsm6dsox_i3c_disable_set(&s_lsm, LSM6DSOX_I3C_DISABLE);
  lsm6dsox_block_data_update_set(&s_lsm, PROPERTY_ENABLE);  /* no torn MSB/LSB reads */

  lsm6dsox_xl_full_scale_set(&s_lsm, LSM6DSOX_4g);
  lsm6dsox_gy_full_scale_set(&s_lsm, LSM6DSOX_500dps);
  lsm6dsox_xl_data_rate_set(&s_lsm, LSM6DSOX_XL_ODR_104Hz);
  lsm6dsox_gy_data_rate_set(&s_lsm, LSM6DSOX_GY_ODR_104Hz);
  return true;
}

bool lsm6dsox_read(vec3f_t *accel_ms2, vec3f_t *gyro_rads)
{
  int16_t a[3], g[3];
  if (lsm6dsox_acceleration_raw_get(&s_lsm, a) != 0) { return false; }
  if (lsm6dsox_angular_rate_raw_get(&s_lsm, g) != 0) { return false; }

  /* mg -> m/s^2, mdps -> rad/s (same units the Adafruit library reported) */
  accel_ms2->x = lsm6dsox_from_fs4_to_mg(a[0]) * (G_TO_MS2 / 1000.0f);
  accel_ms2->y = lsm6dsox_from_fs4_to_mg(a[1]) * (G_TO_MS2 / 1000.0f);
  accel_ms2->z = lsm6dsox_from_fs4_to_mg(a[2]) * (G_TO_MS2 / 1000.0f);
  gyro_rads->x = lsm6dsox_from_fs500_to_mdps(g[0]) * (DEG_TO_RAD / 1000.0f);
  gyro_rads->y = lsm6dsox_from_fs500_to_mdps(g[1]) * (DEG_TO_RAD / 1000.0f);
  gyro_rads->z = lsm6dsox_from_fs500_to_mdps(g[2]) * (DEG_TO_RAD / 1000.0f);
  return true;
}

/* ---- LIS3MDL --------------------------------------------------------------- */

static bool lis3mdl_try(uint8_t addr7)
{
  s_lis.write_reg = lis_write;
  s_lis.read_reg  = lis_read;
  s_lis.mdelay    = delay_ms;
  s_lis.handle    = (void *)(uintptr_t)addr7;

  uint8_t id = 0;
  return lis3mdl_device_id_get(&s_lis, &id) == 0 && id == LIS3MDL_ID;
}

uint8_t lis3mdl_setup(uint8_t addr_a, uint8_t addr_b)
{
  uint8_t addr;
  if (lis3mdl_try(addr_a)) {
    addr = addr_a;
  } else if (lis3mdl_try(addr_b)) {
    addr = addr_b;
  } else {
    return 0;
  }

  lis3mdl_reset_set(&s_lis, PROPERTY_ENABLE);
  uint8_t rst = 1;
  uint32_t t0 = millis();
  do {
    lis3mdl_reset_get(&s_lis, &rst);
  } while (rst && (millis() - t0) < RESET_TIMEOUT_MS);

  lis3mdl_block_data_update_set(&s_lis, PROPERTY_ENABLE);
  lis3mdl_data_rate_set(&s_lis, LIS3MDL_UHP_80Hz);
  lis3mdl_full_scale_set(&s_lis, LIS3MDL_4_GAUSS);
  lis3mdl_operating_mode_set(&s_lis, LIS3MDL_CONTINUOUS_MODE);
  return addr;
}

bool lis3mdl_read(vec3f_t *mag_ut)
{
  int16_t m[3];
  int32_t rc = lis3mdl_magnetic_raw_get(&s_lis, m);
  if (rc != 0) {
    uint8_t a = (uint8_t)(uintptr_t)s_lis.handle;
    uint8_t status = 0xFF, xl = 0xFF;
    int rc_s = i2c_read_regs(a, 0x27, &status, 1);   /* STATUS_REG */
    int rc_x = i2c_read_regs(a, 0x28, &xl, 1);       /* OUT_X_L, single byte */
    printf("LIS3MDL dbg: multi rc=%ld | status rc=%d val=0x%02X | single rc=%d val=0x%02X\n",
           (long)rc, rc_s, status, rc_x, xl);
    return false;
  }
  mag_ut->x = lis3mdl_from_fs4_to_gauss(m[0]) * GAUSS_TO_UT;
  mag_ut->y = lis3mdl_from_fs4_to_gauss(m[1]) * GAUSS_TO_UT;
  mag_ut->z = lis3mdl_from_fs4_to_gauss(m[2]) * GAUSS_TO_UT;
  return true;
}
