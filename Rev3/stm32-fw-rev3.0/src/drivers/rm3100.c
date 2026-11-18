/*
 * rm3100.c - PNI RM3100 over I2C. See rm3100.h.
 *
 * Registers (RM3100 datasheet; same map as the Linux iio rm3100 driver):
 *   0x00 POLL     single measurement: bit4 X, bit5 Y, bit6 Z
 *   0x01 CMM      continuous mode: bit0 START, bits3:2 DRDM, bit4 X, bit5 Y, bit6 Z
 *   0x04..0x09    cycle counts X/Y/Z, 16-bit big-endian each (reset value 200)
 *   0x0B TMRC     continuous-mode update rate, 0x92 (600 Hz) .. 0x9F
 *   0x24..0x2C    results X/Y/Z, 24-bit two's complement, big-endian
 *   0x34 STATUS   bit7 DRDY
 *   0x36 REVID
 * Gain at cycle count 200: 75 LSB/uT (38 at 100, 20 at 50).
 */
#include "rm3100.h"
#include "i2c.h"

#define REG_POLL    0x00U
#define REG_CMM     0x01U
#define REG_CCX     0x04U
#define REG_TMRC    0x0BU
#define REG_MX      0x24U
#define REG_STATUS  0x34U
#define REG_REVID   0x36U

#define CMM_START   (1U << 0)
#define CMM_DRDM_ALL (2U << 2)   /* DRDY after a full X+Y+Z set */
#define CMM_XYZ     (7U << 4)
#define STATUS_DRDY (1U << 7)

#define CYCLE_COUNT 200U
#define LSB_PER_UT  75.0f

static uint8_t s_addr;

uint8_t rm3100_setup(uint8_t rate, uint8_t *revid)
{
  s_addr = 0;
  for (uint8_t a = RM3100_ADDR_DEFAULT; a <= RM3100_ADDR_DEFAULT + 3U; a++) {
    uint8_t id = 0;
    if (i2c_probe(a) == 0 && i2c_read_regs(a, REG_REVID, &id, 1) == 0) {
      s_addr = a;
      *revid = id;
      break;
    }
  }
  if (s_addr == 0U) {
    return 0;
  }

  /* Stop any running mode, then set cycle counts and rate */
  const uint8_t stop = 0;
  if (i2c_write_regs(s_addr, REG_CMM, &stop, 1) != 0) {
    return 0;
  }
  const uint8_t cc[6] = { 0, CYCLE_COUNT, 0, CYCLE_COUNT, 0, CYCLE_COUNT };
  if (i2c_write_regs(s_addr, REG_CCX, cc, sizeof cc) != 0) {
    return 0;
  }
  if (i2c_write_regs(s_addr, REG_TMRC, &rate, 1) != 0) {
    return 0;
  }
  const uint8_t cmm = CMM_XYZ | CMM_DRDM_ALL | CMM_START;
  if (i2c_write_regs(s_addr, REG_CMM, &cmm, 1) != 0) {
    return 0;
  }
  return s_addr;
}

static int32_t be24(const uint8_t *b)
{
  uint32_t v = ((uint32_t)b[0] << 16) | ((uint32_t)b[1] << 8) | b[2];
  if (v & 0x800000UL) {
    v |= 0xFF000000UL;   /* sign-extend bit 23 */
  }
  return (int32_t)v;
}

bool rm3100_read_raw(int32_t xyz[3], bool *fresh)
{
  uint8_t st = 0;
  if (s_addr == 0U || i2c_read_regs(s_addr, REG_STATUS, &st, 1) != 0) {
    return false;
  }
  *fresh = (st & STATUS_DRDY) != 0U;

  uint8_t b[9];
  if (i2c_read_regs(s_addr, REG_MX, b, sizeof b) != 0) {
    return false;
  }
  xyz[0] = be24(&b[0]);
  xyz[1] = be24(&b[3]);
  xyz[2] = be24(&b[6]);
  return true;
}

bool rm3100_read(vec3f_t *mag_ut, bool *fresh)
{
  int32_t c[3];
  if (!rm3100_read_raw(c, fresh)) {
    return false;
  }
  mag_ut->x = (float)c[0] / LSB_PER_UT;
  mag_ut->y = (float)c[1] / LSB_PER_UT;
  mag_ut->z = (float)c[2] / LSB_PER_UT;
  return true;
}
