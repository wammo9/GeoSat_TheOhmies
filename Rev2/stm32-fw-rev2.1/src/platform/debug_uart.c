#include "debug_uart.h"
#include "board.h"
#include "stm32l4xx_ll_rcc.h"
#include "stm32l4xx_ll_usart.h"
#include <stdio.h>

void debug_uart_init(uint32_t baud)
{
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA);
  LL_APB1_GRP1_EnableClock(LL_APB1_GRP1_PERIPH_USART2);
  LL_RCC_SetUSARTClockSource(LL_RCC_USART2_CLKSOURCE_PCLK1);

  gpio_af(DBG_TX_PORT, DBG_TX_PIN, DBG_TX_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_NO);
  gpio_af(DBG_RX_PORT, DBG_RX_PIN, DBG_RX_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_UP);

  LL_USART_Disable(DBG_UART);
  LL_USART_ConfigCharacter(DBG_UART, LL_USART_DATAWIDTH_8B, LL_USART_PARITY_NONE,
                           LL_USART_STOPBITS_1);
  LL_USART_SetTransferDirection(DBG_UART, LL_USART_DIRECTION_TX_RX);
  LL_USART_SetOverSampling(DBG_UART, LL_USART_OVERSAMPLING_16);
  /* PCLK1 == SystemCoreClock because APB1 prescaler is /1 (see clock.c) */
  LL_USART_SetBaudRate(DBG_UART, SystemCoreClock, LL_USART_OVERSAMPLING_16, baud);
  LL_USART_Enable(DBG_UART);
  while (!LL_USART_IsActiveFlag_TEACK(DBG_UART)) { }

  /* Unbuffered stdout: printf output appears immediately, even without '\n' */
  setvbuf(stdout, NULL, _IONBF, 0);
}

void debug_uart_putc(char c)
{
  while (!LL_USART_IsActiveFlag_TXE(DBG_UART)) { }
  LL_USART_TransmitData8(DBG_UART, (uint8_t)c);
}
