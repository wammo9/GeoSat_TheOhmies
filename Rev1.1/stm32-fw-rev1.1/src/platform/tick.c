#include "tick.h"
#include "stm32l4xx.h"

static volatile uint32_t s_ms;

void SysTick_Handler(void)
{
  s_ms++;
}

void tick_init(void)
{
  SysTick_Config(SystemCoreClock / 1000U);
}

uint32_t millis(void)
{
  return s_ms;
}

void delay_ms(uint32_t ms)
{
  uint32_t start = s_ms;
  while ((s_ms - start) < ms) {
    __WFI();   /* sleep until the next interrupt (SysTick, UART RX, ...) */
  }
}

void delay_us(uint32_t us)
{
  /* ~4 cycles per loop iteration; good enough for settle delays */
  uint32_t n = (SystemCoreClock / 4000000U) * us + 1U;
  while (n--) {
    __NOP();
  }
}
