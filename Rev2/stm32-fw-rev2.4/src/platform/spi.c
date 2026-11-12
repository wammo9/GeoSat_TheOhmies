/*
 * spi.c - blocking SPI1 master using LL (polling, no DMA/IRQ).
 *
 * PCLK2 = 16 MHz, /4 = 4 MHz SCK (ADXL355 allows up to 10 MHz). 8-bit frames,
 * so the RX FIFO threshold is set to a quarter (1 byte) or RXNE never fires.
 */
#include "spi.h"
#include "board.h"
#include "tick.h"
#include "stm32l4xx_ll_spi.h"
#include <stddef.h>

#define SPI_TIMEOUT_MS 5U

#define SPI_WAIT(cond)                                         \
  do {                                                         \
    uint32_t t0_ = millis();                                   \
    while (!(cond)) {                                          \
      if ((millis() - t0_) > SPI_TIMEOUT_MS) { spi_cs_high(); return -2; } \
    }                                                          \
  } while (0)

static inline void spi_cs_low(void)  { LL_GPIO_ResetOutputPin(SPI_CS_PORT, SPI_CS_PIN); }
static inline void spi_cs_high(void) { LL_GPIO_SetOutputPin(SPI_CS_PORT, SPI_CS_PIN); }

void spi_init(void)
{
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA);
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOB);
  LL_APB2_GRP1_EnableClock(LL_APB2_GRP1_PERIPH_SPI1);

  gpio_af(SPI_SCK_PORT, SPI_SCK_PIN, SPI_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_NO);
  gpio_af(SPI_MISO_PORT, SPI_MISO_PIN, SPI_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_UP);
  gpio_af(SPI_MOSI_PORT, SPI_MOSI_PIN, SPI_AF, LL_GPIO_OUTPUT_PUSHPULL, LL_GPIO_PULL_NO);

  /* Chip select: push-pull output, idle high */
  LL_GPIO_SetOutputPin(SPI_CS_PORT, SPI_CS_PIN);
  LL_GPIO_SetPinMode(SPI_CS_PORT, SPI_CS_PIN, LL_GPIO_MODE_OUTPUT);
  LL_GPIO_SetPinOutputType(SPI_CS_PORT, SPI_CS_PIN, LL_GPIO_OUTPUT_PUSHPULL);
  LL_GPIO_SetPinSpeed(SPI_CS_PORT, SPI_CS_PIN, LL_GPIO_SPEED_FREQ_HIGH);
  LL_GPIO_SetPinPull(SPI_CS_PORT, SPI_CS_PIN, LL_GPIO_PULL_NO);

  /* Optional data-ready input (not required by the driver) */
  LL_GPIO_SetPinMode(ADXL_DRDY_PORT, ADXL_DRDY_PIN, LL_GPIO_MODE_INPUT);
  LL_GPIO_SetPinPull(ADXL_DRDY_PORT, ADXL_DRDY_PIN, LL_GPIO_PULL_DOWN);

  LL_SPI_Disable(SENS_SPI);
  LL_SPI_SetBaudRatePrescaler(SENS_SPI, LL_SPI_BAUDRATEPRESCALER_DIV4);
  LL_SPI_SetClockPolarity(SENS_SPI, LL_SPI_POLARITY_LOW);   /* mode 0 */
  LL_SPI_SetClockPhase(SENS_SPI, LL_SPI_PHASE_1EDGE);
  LL_SPI_SetTransferDirection(SENS_SPI, LL_SPI_FULL_DUPLEX);
  LL_SPI_SetMode(SENS_SPI, LL_SPI_MODE_MASTER);
  LL_SPI_SetNSSMode(SENS_SPI, LL_SPI_NSS_SOFT);
  LL_SPI_SetDataWidth(SENS_SPI, LL_SPI_DATAWIDTH_8BIT);
  LL_SPI_SetRxFIFOThreshold(SENS_SPI, LL_SPI_RX_FIFO_TH_QUARTER);
  LL_SPI_SetTransferBitOrder(SENS_SPI, LL_SPI_MSB_FIRST);
  LL_SPI_DisableCRC(SENS_SPI);
  LL_SPI_Enable(SENS_SPI);
}

static int xfer(uint8_t out, uint8_t *in)
{
  SPI_WAIT(LL_SPI_IsActiveFlag_TXE(SENS_SPI));
  LL_SPI_TransmitData8(SENS_SPI, out);
  SPI_WAIT(LL_SPI_IsActiveFlag_RXNE(SENS_SPI));
  uint8_t b = LL_SPI_ReceiveData8(SENS_SPI);
  if (in != NULL) {
    *in = b;
  }
  return 0;
}

static int finish(void)
{
  SPI_WAIT(!LL_SPI_IsActiveFlag_BSY(SENS_SPI));
  spi_cs_high();
  return 0;
}

int spi_write(uint8_t cmd, const uint8_t *tx, uint16_t len)
{
  spi_cs_low();
  if (xfer(cmd, NULL) != 0) { return -2; }
  for (uint16_t i = 0; i < len; i++) {
    if (xfer(tx[i], NULL) != 0) { return -2; }
  }
  return finish();
}

int spi_read(uint8_t cmd, uint8_t *rx, uint16_t len)
{
  spi_cs_low();
  if (xfer(cmd, NULL) != 0) { return -2; }
  for (uint16_t i = 0; i < len; i++) {
    if (xfer(0x00, &rx[i]) != 0) { return -2; }
  }
  return finish();
}
