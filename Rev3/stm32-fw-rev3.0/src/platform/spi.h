#ifndef SPI_H
#define SPI_H

#include <stdint.h>

/* SPI1 master, mode 0, 4 MHz, software chip select (see board.h).
 * All calls block with a timeout; 0 = OK, <0 = error. */
void spi_init(void);

/* Register-style helpers: CS low, send `cmd`, then write `len` bytes from tx
 * or read `len` bytes into rx, CS high. */
int  spi_write(uint8_t cmd, const uint8_t *tx, uint16_t len);
int  spi_read(uint8_t cmd, uint8_t *rx, uint16_t len);

#endif
