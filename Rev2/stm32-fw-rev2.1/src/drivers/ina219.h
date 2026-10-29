#ifndef INA219_H
#define INA219_H

#include <stdbool.h>
#include <stdint.h>

/* Same calibration as Adafruit's default (32 V, 2 A, 0.1 ohm shunt) */
bool  ina219_setup(uint8_t addr7);
bool  ina219_read(float *bus_v, float *current_ma, float *power_mw);

#endif
