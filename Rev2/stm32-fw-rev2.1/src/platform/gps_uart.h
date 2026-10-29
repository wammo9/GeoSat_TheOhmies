#ifndef GPS_UART_H
#define GPS_UART_H

#include <stddef.h>
#include <stdint.h>

/* USART1 @ 9600 8N1, interrupt-driven RX into a ring buffer */
void gps_uart_init(uint32_t baud);
int  gps_uart_getc(void);                       /* next byte, or -1 if empty */
void gps_uart_write(const char *s);             /* ASCII text */
void gps_uart_write_bytes(const uint8_t *buf, size_t len);  /* binary, e.g. UBX frames */
uint32_t gps_uart_overflows(void);              /* dropped bytes (ring full / ORE) */

#endif
