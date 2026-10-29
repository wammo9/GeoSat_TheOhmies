/*
 * gps_link.h - byte transport between the MCU and the SAM-M10Q.
 *
 * Two implementations, picked with GPS_LINK_I2C in board.h:
 *   1 = I2C (DDC) at GPS_I2C_ADDR, polled   (default, Rev 2.1)
 *   0 = USART1 at GPS_BAUD, interrupt-driven
 * gps.c only talks to this interface, so the parser doesn't care which.
 */
#ifndef GPS_LINK_H
#define GPS_LINK_H

#include <stddef.h>
#include <stdint.h>

void        gps_link_init(void);
void        gps_link_service(void);                      /* I2C: pull waiting bytes; UART: no-op */
int         gps_link_getc(void);                         /* next byte, or -1 */
int         gps_link_write(const uint8_t *buf, size_t len);  /* 0 = OK */
uint32_t    gps_link_overflows(void);                    /* dropped bytes / I2C errors */
const char *gps_link_describe(void);                     /* for the boot log */

#endif
