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

/* ---- RX (only when debug_uart_rx_enable() is called) ---------------------- */

#define DBG_RX_BUF_SIZE 256U   /* power of two */

static volatile uint8_t  s_rx[DBG_RX_BUF_SIZE];
static volatile uint16_t s_rx_head;   /* written by the ISR */
static volatile uint16_t s_rx_tail;   /* written by main */
static volatile uint32_t s_rx_ovf;

void debug_uart_rx_enable(void)
{
  s_rx_head = s_rx_tail = 0;
  LL_USART_ClearFlag_ORE(DBG_UART);
  LL_USART_EnableIT_RXNE(DBG_UART);   /* also fires on overrun */
  NVIC_SetPriority(USART2_IRQn, 6);
  NVIC_EnableIRQ(USART2_IRQn);
}

void USART2_IRQHandler(void)
{
  if (LL_USART_IsActiveFlag_ORE(DBG_UART)) {
    LL_USART_ClearFlag_ORE(DBG_UART);
    s_rx_ovf++;
  }
  if (LL_USART_IsActiveFlag_FE(DBG_UART)) {
    LL_USART_ClearFlag_FE(DBG_UART);
  }
  if (LL_USART_IsActiveFlag_NE(DBG_UART)) {
    LL_USART_ClearFlag_NE(DBG_UART);
  }
  if (LL_USART_IsActiveFlag_RXNE(DBG_UART)) {
    uint8_t  b    = LL_USART_ReceiveData8(DBG_UART);
    uint16_t next = (uint16_t)((s_rx_head + 1U) & (DBG_RX_BUF_SIZE - 1U));
    if (next != s_rx_tail) {
      s_rx[s_rx_head] = b;
      s_rx_head = next;
    } else {
      s_rx_ovf++;
    }
  }
}

int debug_uart_getc(void)
{
  if (s_rx_tail == s_rx_head) {
    return -1;
  }
  uint8_t b = s_rx[s_rx_tail];
  s_rx_tail = (uint16_t)((s_rx_tail + 1U) & (DBG_RX_BUF_SIZE - 1U));
  return b;
}

uint32_t debug_uart_rx_overflows(void)
{
  return s_rx_ovf;
}
