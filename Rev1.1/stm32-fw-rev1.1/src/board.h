/*
 * board.h - NUCLEO-L432KC pin map for the GeoSat sensor module port.
 *
 *  Function         MCU pin   Nucleo-32 header   Was on XIAO ESP32-C6
 *  ---------------  -------   ----------------   --------------------
 *  User LED (LD3)   PB3       D13                -
 *  Debug UART TX    PA2       (ST-LINK VCP)      USB CDC Serial
 *  Debug UART RX    PA15      (ST-LINK VCP)      USB CDC Serial
 *  I2C1 SDA         PB7       D4                 D4 / GPIO22
 *  I2C1 SCL         PB6       D5                 D5 / GPIO23
 *  GPS UART TX      PA9       D1  -> Ultimate GPS v3 RX   D1 / GPIO1
 *  GPS UART RX      PA10      D0  <- Ultimate GPS v3 TX   D2 / GPIO2
 *  TMP36 Vout       PA0       A0  (ADC1_IN5)     A0 / GPIO0
 *
 *  !! Nucleo-32 gotcha: solder bridges SB16/SB18 tie PB6/PB7 to PA6/PA5
 *     (A5/A4) by default. Leave A4/A5 unconnected (or remove the bridges).
 *
 *  NOTE: the GPS moved from D2 to D0. USART1 RX is on PA10 (D0), not D2.
 */
#ifndef BOARD_H
#define BOARD_H

#include "stm32l4xx.h"
#include "stm32l4xx_ll_bus.h"
#include "stm32l4xx_ll_gpio.h"

/* User LED */
#define LED_PORT        GPIOB
#define LED_PIN         LL_GPIO_PIN_3
#define LED_GPIO_CLK()  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOB)

/* Debug UART (USART2 -> ST-LINK virtual COM port) */
#define DBG_UART        USART2
#define DBG_TX_PORT     GPIOA
#define DBG_TX_PIN      LL_GPIO_PIN_2
#define DBG_TX_AF       LL_GPIO_AF_7
#define DBG_RX_PORT     GPIOA
#define DBG_RX_PIN      LL_GPIO_PIN_15
#define DBG_RX_AF       LL_GPIO_AF_3

/* I2C1 sensor bus */
#define SENS_I2C        I2C1
#define I2C_SCL_PORT    GPIOB
#define I2C_SCL_PIN     LL_GPIO_PIN_6
#define I2C_SDA_PORT    GPIOB
#define I2C_SDA_PIN     LL_GPIO_PIN_7
#define I2C_AF          LL_GPIO_AF_4

/* GPS UART (USART1) */
#define GPS_UART        USART1
#define GPS_UART_IRQn   USART1_IRQn
#define GPS_TX_PORT     GPIOA
#define GPS_TX_PIN      LL_GPIO_PIN_9
#define GPS_RX_PORT     GPIOA
#define GPS_RX_PIN      LL_GPIO_PIN_10
#define GPS_AF          LL_GPIO_AF_7
#define GPS_BAUD        9600U

/* TMP36 analog input */
#define TMP36_PORT      GPIOA
#define TMP36_PIN       LL_GPIO_PIN_0
#define TMP36_ADC_CH    LL_ADC_CHANNEL_5

/* I2C addresses (7-bit) */
#define LSM6DSOX_ADDR   0x6AU
#define LIS3MDL_ADDR_A  0x1EU   /* address the ESP32 code used */
#define LIS3MDL_ADDR_B  0x1CU   /* Adafruit breakout default */
#define INA219_ADDR     0x40U

/* Put a pin in alternate-function mode (picks AFRL/AFRH for you). */
static inline void gpio_af(GPIO_TypeDef *port, uint32_t pin, uint32_t af,
                           uint32_t otype, uint32_t pull)
{
  LL_GPIO_SetPinMode(port, pin, LL_GPIO_MODE_ALTERNATE);
  LL_GPIO_SetPinOutputType(port, pin, otype);
  LL_GPIO_SetPinSpeed(port, pin, LL_GPIO_SPEED_FREQ_HIGH);
  LL_GPIO_SetPinPull(port, pin, pull);
  if (pin <= LL_GPIO_PIN_7) {
    LL_GPIO_SetAFPin_0_7(port, pin, af);
  } else {
    LL_GPIO_SetAFPin_8_15(port, pin, af);
  }
}

static inline void board_led_init(void)
{
  LED_GPIO_CLK();
  LL_GPIO_SetPinMode(LED_PORT, LED_PIN, LL_GPIO_MODE_OUTPUT);
  LL_GPIO_SetPinOutputType(LED_PORT, LED_PIN, LL_GPIO_OUTPUT_PUSHPULL);
  LL_GPIO_SetPinSpeed(LED_PORT, LED_PIN, LL_GPIO_SPEED_FREQ_LOW);
  LL_GPIO_SetPinPull(LED_PORT, LED_PIN, LL_GPIO_PULL_NO);
  LL_GPIO_ResetOutputPin(LED_PORT, LED_PIN);
}

static inline void board_led_toggle(void) { LL_GPIO_TogglePin(LED_PORT, LED_PIN); }

#endif /* BOARD_H */
