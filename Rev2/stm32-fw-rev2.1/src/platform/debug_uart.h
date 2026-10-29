#ifndef DEBUG_UART_H
#define DEBUG_UART_H

#include <stdint.h>

/* USART2 on the ST-LINK virtual COM port. After init, printf() goes here. */
void debug_uart_init(uint32_t baud);
void debug_uart_putc(char c);

#endif
