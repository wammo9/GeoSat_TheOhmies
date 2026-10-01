/*
 * blink.c - step 1 sanity check.
 *
 * Proves the toolchain, linker script, startup code, clock tree, SysTick,
 * flashing and the ST-LINK virtual COM port all work before any sensors are
 * involved. Expect LD3 (green, next to the USB connector) to toggle every
 * 500 ms and a counter on the serial port at 115200 8N1.
 */
#include "board.h"
#include "clock.h"
#include "debug_uart.h"
#include "tick.h"
#include <stdio.h>

int main(void)
{
  clock_init();
  tick_init();
  board_led_init();
  debug_uart_init(115200);

  printf("\n=== NUCLEO-L432KC blink ===\n");
  printf("SYSCLK = %lu Hz\n", (unsigned long)SystemCoreClock);
  printf("float printf check: pi ~= %.4f\n", 3.14159265);

  uint32_t n = 0;
  while (1) {
    board_led_toggle();
    printf("tick %lu  (uptime %lu ms)\n", (unsigned long)n++, (unsigned long)millis());
    delay_ms(500);
  }
}
