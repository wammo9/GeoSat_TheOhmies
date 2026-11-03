#ifndef DEBUG_UART_H
#define DEBUG_UART_H

#include <stdint.h>

/* USART2 on the ST-LINK virtual COM port. After init, printf() goes here. */
void debug_uart_init(uint32_t baud);
void debug_uart_putc(char c);

/* Optional RX path (used by the HIL test image): interrupt-driven ring buffer,
 * so command bytes aren't lost while the main loop is busy on I2C. */
void     debug_uart_rx_enable(void);
int      debug_uart_getc(void);          /* next byte, or -1 if empty */
uint32_t debug_uart_rx_overflows(void);  /* bytes dropped (ring full / ORE) */

#endif
