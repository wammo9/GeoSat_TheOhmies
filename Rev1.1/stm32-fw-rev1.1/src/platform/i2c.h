#ifndef I2C_H
#define I2C_H

#include <stdint.h>

/* I2C1 master, 400 kHz. All calls block with a timeout; 0 = OK, <0 = error. */
void i2c_init(void);
int  i2c_probe(uint8_t addr7);
int  i2c_read_regs(uint8_t addr7, uint8_t reg, uint8_t *buf, uint16_t len);
int  i2c_write_regs(uint8_t addr7, uint8_t reg, const uint8_t *buf, uint16_t len);

#endif
