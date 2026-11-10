#ifndef INA219_H
#define INA219_H

#include <stdbool.h>
#include <stdint.h>

/* Same calibration as Adafruit's default (32 V, 2 A, 0.1 ohm shunt) */
bool  ina219_setup(uint8_t addr7);
bool  ina219_read(float *bus_v, float *current_ma, float *power_mw);

/* Same calibration, for several INA219s on one bus (0x40/0x41/0x44/0x45). */
bool  ina219_setup_at(uint8_t addr7);
bool  ina219_read_at(uint8_t addr7, float *bus_v, float *shunt_mv, float *current_ma,
                     float *power_mw);

#endif
