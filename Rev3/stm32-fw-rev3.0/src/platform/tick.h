#ifndef TICK_H
#define TICK_H

#include <stdint.h>

void     tick_init(void);        /* 1 ms SysTick; call after clock_init() */
uint32_t millis(void);
void     delay_ms(uint32_t ms);  /* sleeps (WFI) between ticks */
void     delay_us(uint32_t us);  /* busy-wait, for short hardware settle times */

#endif
