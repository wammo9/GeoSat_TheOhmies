/*
 * adxl355.c - ADXL355 over SPI. See adxl355.h.
 *
 * SPI command byte = (register << 1) | R, with R = 1 for a read; multi-byte
 * reads auto-increment the address. Registers (ADXL354/ADXL355 datasheet):
 *   0x00 DEVID_AD = 0xAD, 0x01 DEVID_MST = 0x1D, 0x02 PARTID = 0xED
 *   0x04 STATUS (bit0 DATA_RDY)
 *   0x06 TEMP2 (bits 3:0 = temp[11:8]), 0x07 TEMP1
 *   0x08..0x10 XDATA3..ZDATA1: 20-bit two's complement, left-justified in 3 bytes
 *   0x28 FILTER (bits 3:0 ODR_LPF), 0x2C RANGE (bits 1:0: 01 = +/-2 g)
 *   0x2D POWER_CTL (bit0 STANDBY), 0x2F RESET (write 0x52)
 */
#include "adxl355.h"
#include "spi.h"
#include "tick.h"

#define REG_DEVID_AD   0x00U
#define REG_STATUS     0x04U
#define REG_TEMP2      0x06U
#define REG_XDATA3     0x08U
#define REG_FILTER     0x28U
#define REG_RANGE      0x2CU
#define REG_POWER_CTL  0x2DU
#define REG_RESET      0x2FU

#define RESET_CODE     0x52U
#define RANGE_2G       0x81U   /* reset value: I2C_HS set, INT_POL low, +/-2 g */
#define STATUS_DRDY    0x01U

#define LSB_PER_G      256000.0f
#define G_MS2          9.80665f

/* Temperature transfer function (datasheet typ.): 1885 LSB at 25 C, -9.05 LSB/C */
#define TEMP_LSB_25C   1885.0f
#define TEMP_LSB_PER_C (-9.05f)

static bool s_ok;

static int rd(uint8_t reg, uint8_t *buf, uint16_t len)
{
  return spi_read((uint8_t)((reg << 1) | 1U), buf, len);
}

static int wr(uint8_t reg, uint8_t val)
{
  return spi_write((uint8_t)(reg << 1), &val, 1);
}

bool adxl355_setup(uint8_t odr, uint8_t *partid)
{
  s_ok = false;
  uint8_t id[3] = { 0, 0, 0 };
  if (rd(REG_DEVID_AD, id, 3) != 0) {
    return false;
  }
  *partid = id[2];
  if (id[0] != 0xADU || id[1] != 0x1DU || id[2] != 0xEDU) {
    return false;
  }
  if (wr(REG_RESET, RESET_CODE) != 0) {
    return false;
  }
  delay_ms(10);   /* reset reloads trim from NVM; comes back in standby */
  if (wr(REG_RANGE, RANGE_2G) != 0 || wr(REG_FILTER, (uint8_t)(odr & 0x0FU)) != 0 ||
      wr(REG_POWER_CTL, 0x00U) != 0) {   /* measurement mode, temperature + DRDY on */
    return false;
  }
  s_ok = true;
  return true;
}

static int32_t be20(const uint8_t *b)
{
  uint32_t v = ((uint32_t)b[0] << 12) | ((uint32_t)b[1] << 4) | ((uint32_t)b[2] >> 4);
  if (v & 0x80000UL) {
    v |= 0xFFF00000UL;   /* sign-extend bit 19 */
  }
  return (int32_t)v;
}

bool adxl355_read_raw(int32_t xyz[3], bool *fresh)
{
  uint8_t st = 0;
  uint8_t b[9];
  if (!s_ok || rd(REG_STATUS, &st, 1) != 0 || rd(REG_XDATA3, b, sizeof b) != 0) {
    return false;
  }
  *fresh = (st & STATUS_DRDY) != 0U;
  xyz[0] = be20(&b[0]);
  xyz[1] = be20(&b[3]);
  xyz[2] = be20(&b[6]);
  return true;
}

bool adxl355_read(vec3f_t *accel_ms2, bool *fresh)
{
  int32_t c[3];
  if (!adxl355_read_raw(c, fresh)) {
    return false;
  }
  const float k = G_MS2 / LSB_PER_G;
  accel_ms2->x = (float)c[0] * k;
  accel_ms2->y = (float)c[1] * k;
  accel_ms2->z = (float)c[2] * k;
  return true;
}

bool adxl355_read_temp(float *temp_c)
{
  uint8_t b[2];
  if (!s_ok || rd(REG_TEMP2, b, 2) != 0) {
    return false;
  }
  float raw = (float)((((uint16_t)b[0] & 0x0FU) << 8) | b[1]);
  *temp_c = 25.0f + (raw - TEMP_LSB_25C) / TEMP_LSB_PER_C;
  return true;
}
