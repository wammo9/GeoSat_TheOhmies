/*
 * clock.c - system clock setup.
 *
 * Out of reset the L4 runs from MSI at 4 MHz. We bump MSI to 16 MHz:
 *   - no PLL needed (PLL costs current)
 *   - 0 flash wait states in voltage Range 1
 *   - clean integer dividers for 115200 baud and 400 kHz I2C
 *
 * Low-power pass later: drop to voltage Range 2, lower MSI when idle, and
 * enable LSE + MSI PLL-mode (MSIPLLEN) to trim MSI against the 32.768 kHz
 * crystal for accurate UART timing.
 */
#include "clock.h"
#include "stm32l4xx.h"
#include "stm32l4xx_ll_bus.h"
#include "stm32l4xx_ll_pwr.h"
#include "stm32l4xx_ll_rcc.h"
#include "stm32l4xx_ll_system.h"

void clock_init(void)
{
  LL_APB1_GRP1_EnableClock(LL_APB1_GRP1_PERIPH_PWR);

  /* Range 1 is the reset default; set it explicitly anyway */
  LL_PWR_SetRegulVoltageScaling(LL_PWR_REGU_VOLTAGE_SCALE1);
  while (LL_PWR_IsActiveFlag_VOS()) { }

  /* Range 1: 0 wait states is valid up to 16 MHz */
  LL_FLASH_SetLatency(LL_FLASH_LATENCY_0);
  while (LL_FLASH_GetLatency() != LL_FLASH_LATENCY_0) { }

  /* MSI -> 16 MHz (range 8). Allowed while MSI is on and ready. */
  LL_RCC_MSI_Enable();
  while (!LL_RCC_MSI_IsReady()) { }
  LL_RCC_MSI_EnableRangeSelection();
  LL_RCC_MSI_SetRange(LL_RCC_MSIRANGE_8);
  while (!LL_RCC_MSI_IsReady()) { }

  LL_RCC_SetSysClkSource(LL_RCC_SYS_CLKSOURCE_MSI);
  while (LL_RCC_GetSysClkSource() != LL_RCC_SYS_CLKSOURCE_STATUS_MSI) { }

  LL_RCC_SetAHBPrescaler(LL_RCC_SYSCLK_DIV_1);
  LL_RCC_SetAPB1Prescaler(LL_RCC_APB1_DIV_1);
  LL_RCC_SetAPB2Prescaler(LL_RCC_APB2_DIV_1);

  SystemCoreClockUpdate();   /* SystemCoreClock = 16000000 */
}
