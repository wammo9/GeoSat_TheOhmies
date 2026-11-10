#ifndef CLOCK_H
#define CLOCK_H

/* SYSCLK = HCLK = PCLK1 = PCLK2 = MSI @ 16 MHz. Updates SystemCoreClock. */
void clock_init(void);

#endif
