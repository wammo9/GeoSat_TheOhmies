/*
 * tmp117.c - TI TMP117 (+/-0.1 degC) digital temperature sensor.
 *
 * Registers are 16-bit, big-endian (MSB first).
 *   0x00 Temp_Result   signed, 1 LSB = 0.0078125 degC
 *   0x01 Configuration
 *   0x0F Device_ID     DID (bits 11:0) = 0x117
 *
 * Configuration bits used here:
 *   MOD  [11:10]  00 = continuous conversion
 *   CONV [9:7]    011 = 500 ms conversion cycle
 *   AVG  [6:5]    01 = 8 conversions averaged (about 125 ms active per cycle)
 *   Soft_Reset [1]
 * Reset default is 0x0220 (continuous, 1 s cycle, 8 averages).
 *
 * Power note: the sensor draws ~135 uA while converting and ~1.25 uA in
 * shutdown. With 8 averages on a 500 ms cycle it averages roughly 35 uA.
 * Switching AVG to 00 (single conversion, 15.5 ms) cuts that to roughly 5 uA
 * at the cost of more noise; change TMP117_AVG below.
 */
#include "tmp117.h"
#include "i2c.h"
#include "tick.h"

#define REG_TEMP        0x00U
#define REG_CONFIG      0x01U
#define REG_DEVICE_ID   0x0FU

#define DEVICE_ID_MASK  0x0FFFU
#define DEVICE_ID_TMP117 0x0117U

#define CFG_SOFT_RESET  (1U << 1)

#define TMP117_MOD_CONTINUOUS (0U << 10)
#define TMP117_CONV_500MS     (3U << 7)
#define TMP117_AVG            (1U << 5)   /* 0 = none, 1 = 8, 2 = 32, 3 = 64 */

#define TMP117_CONFIG  (TMP117_MOD_CONTINUOUS | TMP117_CONV_500MS | TMP117_AVG)

#define TEMP_NOT_READY  0x8000U   /* value before the first conversion finishes */

static uint8_t s_addr;

static int rd16(uint8_t reg, uint16_t *v)
{
  uint8_t b[2];
  int rc = i2c_read_regs(s_addr, reg, b, 2);
  if (rc != 0) {
    return rc;
  }
  *v = (uint16_t)(((uint16_t)b[0] << 8) | b[1]);
  return 0;
}

static int wr16(uint8_t reg, uint16_t v)
{
  uint8_t b[2] = { (uint8_t)(v >> 8), (uint8_t)(v & 0xFFU) };
  return i2c_write_regs(s_addr, reg, b, 2);
}

bool tmp117_setup(uint8_t addr7)
{
  s_addr = addr7;

  uint16_t id = 0;
  if (rd16(REG_DEVICE_ID, &id) != 0 || (id & DEVICE_ID_MASK) != DEVICE_ID_TMP117) {
    return false;
  }

  /* Soft reset reloads EEPROM defaults; it takes about 2 ms */
  if (wr16(REG_CONFIG, CFG_SOFT_RESET) != 0) {
    return false;
  }
  delay_ms(5);

  return wr16(REG_CONFIG, TMP117_CONFIG) == 0;
}

bool tmp117_read_raw(int16_t *raw)
{
  uint16_t v = 0;
  if (rd16(REG_TEMP, &v) != 0) {
    return false;
  }
  if (v == TEMP_NOT_READY) {
    return false;
  }
  *raw = (int16_t)v;
  return true;
}
