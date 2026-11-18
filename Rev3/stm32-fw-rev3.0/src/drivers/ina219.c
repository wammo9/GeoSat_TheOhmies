/*
 * ina219.c - minimal INA219 driver, matching Adafruit_INA219::setCalibration_32V_2A().
 *
 * Shunt 0.1 ohm, max 3.2 A:
 *   Current_LSB = 100 uA  -> CAL = trunc(0.04096 / (Current_LSB * Rshunt)) = 4096
 *   Power_LSB   = 20 * Current_LSB = 2 mW
 * Registers are 16-bit big-endian.
 */
#include "ina219.h"
#include "i2c.h"

#define REG_CONFIG   0x00U
#define REG_SHUNT_V  0x01U
#define REG_BUS_V    0x02U
#define REG_POWER    0x03U
#define REG_CURRENT  0x04U
#define REG_CAL      0x05U

/* BRNG=32V | PGA=/8 (320 mV) | BADC=12-bit | SADC=12-bit 1S | shunt+bus continuous */
#define INA219_CONFIG  (0x2000U | 0x1800U | 0x0180U | 0x0018U | 0x0007U)
#define INA219_CAL     4096U
#define CURRENT_LSB_MA 0.1f
#define POWER_LSB_MW   2.0f

#define SHUNT_LSB_MV   0.01f   /* 10 uV per LSB, signed */

static uint8_t s_addr;   /* device used by the single-sensor calls below */

static int wr16(uint8_t addr, uint8_t reg, uint16_t v)
{
  uint8_t b[2] = { (uint8_t)(v >> 8), (uint8_t)(v & 0xFFU) };
  return i2c_write_regs(addr, reg, b, 2);
}

static int rd16(uint8_t addr, uint8_t reg, uint16_t *v)
{
  uint8_t b[2] = { 0, 0 };
  int rc = i2c_read_regs(addr, reg, b, 2);
  *v = (uint16_t)((b[0] << 8) | b[1]);
  return rc;
}

bool ina219_setup_at(uint8_t addr7)
{
  if (i2c_probe(addr7) != 0) {
    return false;
  }
  return wr16(addr7, REG_CAL, INA219_CAL) == 0 && wr16(addr7, REG_CONFIG, INA219_CONFIG) == 0;
}

bool ina219_read_at(uint8_t addr7, float *bus_v, float *shunt_mv, float *current_ma,
                    float *power_mw)
{
  uint16_t bus, shunt, cur, pwr;

  /* Rewrite CAL in case the chip browned out and reset (Adafruit does the same) */
  if (wr16(addr7, REG_CAL, INA219_CAL) != 0) { return false; }
  if (rd16(addr7, REG_BUS_V, &bus) != 0)     { return false; }
  if (rd16(addr7, REG_SHUNT_V, &shunt) != 0) { return false; }
  if (rd16(addr7, REG_CURRENT, &cur) != 0)   { return false; }
  if (rd16(addr7, REG_POWER, &pwr) != 0)     { return false; }

  *bus_v      = (float)(bus >> 3) * 0.004f;          /* 4 mV/LSB, bits 15:3 */
  *shunt_mv   = (float)(int16_t)shunt * SHUNT_LSB_MV;
  *current_ma = (float)(int16_t)cur * CURRENT_LSB_MA;
  *power_mw   = (float)pwr * POWER_LSB_MW;
  return true;
}

bool ina219_setup(uint8_t addr7)
{
  s_addr = addr7;
  return ina219_setup_at(addr7);
}

bool ina219_read(float *bus_v, float *current_ma, float *power_mw)
{
  float shunt_mv;
  return ina219_read_at(s_addr, bus_v, &shunt_mv, current_ma, power_mw);
}
