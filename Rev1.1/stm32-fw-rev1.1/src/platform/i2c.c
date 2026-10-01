/*
 * i2c.c - blocking I2C1 master using LL (polling, no DMA/IRQ).
 *
 * The STM32 "I2C v2" peripheral does the START/address/NBYTES/STOP sequencing
 * in hardware; we just feed TXDR / drain RXDR. Every wait has a timeout so a
 * missing sensor can't hang the firmware.
 */
#include "i2c.h"
#include "board.h"
#include "tick.h"
#include "stm32l4xx_ll_i2c.h"
#include "stm32l4xx_ll_rcc.h"

#define I2C_TIMEOUT_MS 10U

/*
 * TIMINGR for I2CCLK = PCLK1 = 16 MHz (values from RM0394, "Examples of timing
 * settings"). Recompute with CubeMX if the clock changes.
 */
#define I2C_TIMING_100K_16MHZ 0x30420F13U
#define I2C_TIMING_400K_16MHZ 0x10320309U

static int i2c_nack_abort(void)
{
  /* After a NACK the hardware sends STOP by itself; wait for it and clean up */
  uint32_t t0 = millis();
  while (!LL_I2C_IsActiveFlag_STOP(SENS_I2C) && (millis() - t0) < I2C_TIMEOUT_MS) { }
  LL_I2C_ClearFlag_NACK(SENS_I2C);
  LL_I2C_ClearFlag_STOP(SENS_I2C);
  LL_I2C_ClearFlag_TXE(SENS_I2C);   /* flush TXDR */
  return -1;
}

static int i2c_timeout_reset(void)
{
  /* Software reset: toggling PE clears the state machine and all flags */
  LL_I2C_Disable(SENS_I2C);
  while (LL_I2C_IsEnabled(SENS_I2C)) { }
  LL_I2C_Enable(SENS_I2C);
  return -2;
}

/* Wait for cond, bailing out on NACK or timeout. Only usable inside int functions. */
#define I2C_WAIT(cond)                                              \
  do {                                                              \
    uint32_t t0_ = millis();                                        \
    while (!(cond)) {                                               \
      if (LL_I2C_IsActiveFlag_NACK(SENS_I2C)) return i2c_nack_abort(); \
      if ((millis() - t0_) > I2C_TIMEOUT_MS) return i2c_timeout_reset(); \
    }                                                               \
  } while (0)

void i2c_init(void)
{
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOB);
  LL_APB1_GRP1_EnableClock(LL_APB1_GRP1_PERIPH_I2C1);
  LL_RCC_SetI2CClockSource(LL_RCC_I2C1_CLKSOURCE_PCLK1);

  /* Open-drain + internal pull-ups (the breakouts have their own too) */
  gpio_af(I2C_SCL_PORT, I2C_SCL_PIN, I2C_AF, LL_GPIO_OUTPUT_OPENDRAIN, LL_GPIO_PULL_UP);
  gpio_af(I2C_SDA_PORT, I2C_SDA_PIN, I2C_AF, LL_GPIO_OUTPUT_OPENDRAIN, LL_GPIO_PULL_UP);

  LL_I2C_Disable(SENS_I2C);
  LL_I2C_EnableAnalogFilter(SENS_I2C);
  LL_I2C_SetDigitalFilter(SENS_I2C, 0);
  LL_I2C_SetTiming(SENS_I2C, I2C_TIMING_400K_16MHZ);
  LL_I2C_Enable(SENS_I2C);
}

int i2c_probe(uint8_t addr7)
{
  I2C_WAIT(!LL_I2C_IsActiveFlag_BUSY(SENS_I2C));
  /* Zero-byte write: START, address, STOP. ACK -> STOPF only. NACK -> NACKF. */
  LL_I2C_HandleTransfer(SENS_I2C, (uint32_t)addr7 << 1, LL_I2C_ADDRSLAVE_7BIT, 0,
                        LL_I2C_MODE_AUTOEND, LL_I2C_GENERATE_START_WRITE);
  I2C_WAIT(LL_I2C_IsActiveFlag_STOP(SENS_I2C));
  LL_I2C_ClearFlag_STOP(SENS_I2C);
  return 0;
}

int i2c_read_regs(uint8_t addr7, uint8_t reg, uint8_t *buf, uint16_t len)
{
  if (len == 0U || len > 255U) {
    return -3;
  }

  I2C_WAIT(!LL_I2C_IsActiveFlag_BUSY(SENS_I2C));

  /* Phase 1: write register address, no STOP (SOFTEND -> TC flag) */
  LL_I2C_HandleTransfer(SENS_I2C, (uint32_t)addr7 << 1, LL_I2C_ADDRSLAVE_7BIT, 1,
                        LL_I2C_MODE_SOFTEND, LL_I2C_GENERATE_START_WRITE);
  I2C_WAIT(LL_I2C_IsActiveFlag_TXIS(SENS_I2C));
  LL_I2C_TransmitData8(SENS_I2C, reg);
  I2C_WAIT(LL_I2C_IsActiveFlag_TC(SENS_I2C));

  /* Phase 2: repeated START + read len bytes, hardware STOP at the end */
  LL_I2C_HandleTransfer(SENS_I2C, (uint32_t)addr7 << 1, LL_I2C_ADDRSLAVE_7BIT, len,
                        LL_I2C_MODE_AUTOEND, LL_I2C_GENERATE_RESTART_7BIT_READ);
  for (uint16_t i = 0; i < len; i++) {
    I2C_WAIT(LL_I2C_IsActiveFlag_RXNE(SENS_I2C));
    buf[i] = LL_I2C_ReceiveData8(SENS_I2C);
  }

  I2C_WAIT(LL_I2C_IsActiveFlag_STOP(SENS_I2C));
  LL_I2C_ClearFlag_STOP(SENS_I2C);
  return 0;
}

int i2c_write_regs(uint8_t addr7, uint8_t reg, const uint8_t *buf, uint16_t len)
{
  if (len > 254U) {
    return -3;
  }

  I2C_WAIT(!LL_I2C_IsActiveFlag_BUSY(SENS_I2C));

  LL_I2C_HandleTransfer(SENS_I2C, (uint32_t)addr7 << 1, LL_I2C_ADDRSLAVE_7BIT, len + 1U,
                        LL_I2C_MODE_AUTOEND, LL_I2C_GENERATE_START_WRITE);
  I2C_WAIT(LL_I2C_IsActiveFlag_TXIS(SENS_I2C));
  LL_I2C_TransmitData8(SENS_I2C, reg);
  for (uint16_t i = 0; i < len; i++) {
    I2C_WAIT(LL_I2C_IsActiveFlag_TXIS(SENS_I2C));
    LL_I2C_TransmitData8(SENS_I2C, buf[i]);
  }

  I2C_WAIT(LL_I2C_IsActiveFlag_STOP(SENS_I2C));
  LL_I2C_ClearFlag_STOP(SENS_I2C);
  return 0;
}
