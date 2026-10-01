/*
 * gps_uart.c - USART1 RX interrupt -> ring buffer.
 *
 * Replaces the Arduino HardwareSerial buffer. At 9600 baud a byte arrives
 * every ~1 ms, so the ISR catches everything even while main() is busy on I2C.
 */
#include "gps_uart.h"
#include "board.h"
#include "stm32l4xx_ll_rcc.h"
#include "stm32l4xx_ll_usart.h"

#define RX_BUF_SIZE 512U   /* power of two */

static volatile uint8_t  s_rx_buf[RX_BUF_SIZE];
static volatile uint16_t s_head;   /* written by ISR */
static volatile uint16_t s_tail;   /* written by main */
static volatile uint32_t s_overflows;

void gps_uart_init(uint32_t baud)
{
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA);
  LL_APB2_GRP1_EnableClock(LL_APB2_GRP1_PERIPH_USART1);
  LL_RCC_SetUSARTClockSource(LL_RCC_USART1_CLKSOURCE_PCLK2);

  gpio_af(GPS_TX_PORT, GPS_TX_PIN, GPS_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_NO);
  gpio_af(GPS_RX_PORT, GPS_RX_PIN, GPS_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_UP);

  LL_USART_Disable(GPS_UART);
  LL_USART_ConfigCharacter(GPS_UART, LL_USART_DATAWIDTH_8B, LL_USART_PARITY_NONE,
                           LL_USART_STOPBITS_1);
  LL_USART_SetTransferDirection(GPS_UART, LL_USART_DIRECTION_TX_RX);
  LL_USART_SetOverSampling(GPS_UART, LL_USART_OVERSAMPLING_16);
  /* PCLK2 == SystemCoreClock (APB2 prescaler /1) */
  LL_USART_SetBaudRate(GPS_UART, SystemCoreClock, LL_USART_OVERSAMPLING_16, baud);
  LL_USART_Enable(GPS_UART);
  while (!LL_USART_IsActiveFlag_TEACK(GPS_UART) || !LL_USART_IsActiveFlag_REACK(GPS_UART)) { }

  LL_USART_EnableIT_RXNE(GPS_UART);   /* also fires on overrun (ORE) */
  NVIC_SetPriority(GPS_UART_IRQn, 5);
  NVIC_EnableIRQ(GPS_UART_IRQn);
}

void USART1_IRQHandler(void)
{
  /* Errors must be cleared or the IRQ keeps firing */
  if (LL_USART_IsActiveFlag_ORE(GPS_UART)) {
    LL_USART_ClearFlag_ORE(GPS_UART);
    s_overflows++;
  }
  if (LL_USART_IsActiveFlag_FE(GPS_UART)) {
    LL_USART_ClearFlag_FE(GPS_UART);
  }
  if (LL_USART_IsActiveFlag_NE(GPS_UART)) {
    LL_USART_ClearFlag_NE(GPS_UART);
  }

  if (LL_USART_IsActiveFlag_RXNE(GPS_UART)) {
    uint8_t c = LL_USART_ReceiveData8(GPS_UART);
    uint16_t next = (uint16_t)((s_head + 1U) & (RX_BUF_SIZE - 1U));
    if (next != s_tail) {
      s_rx_buf[s_head] = c;
      s_head = next;
    } else {
      s_overflows++;
    }
  }
}

int gps_uart_getc(void)
{
  if (s_tail == s_head) {
    return -1;
  }
  uint8_t c = s_rx_buf[s_tail];
  s_tail = (uint16_t)((s_tail + 1U) & (RX_BUF_SIZE - 1U));
  return c;
}

void gps_uart_write(const char *s)
{
  while (*s) {
    while (!LL_USART_IsActiveFlag_TXE(GPS_UART)) { }
    LL_USART_TransmitData8(GPS_UART, (uint8_t)*s++);
  }
  while (!LL_USART_IsActiveFlag_TC(GPS_UART)) { }
}

uint32_t gps_uart_overflows(void)
{
  return s_overflows;
}
