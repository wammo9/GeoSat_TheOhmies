/*
 * gps_link.c - SAM-M10Q transport: I2C (default) or USART1. See gps_link.h.
 *
 * u-blox I2C ("DDC") interface, slave address 0x42:
 *   reg 0xFD/0xFE : number of bytes waiting, big-endian
 *   reg 0xFF      : message stream (reads 0xFF when empty)
 *   write         : message bytes sent directly, no register byte
 */
#include "gps_link.h"
#include "board.h"
#include "tick.h"

#if GPS_LINK_I2C

#include "i2c.h"
#include <stdbool.h>
#include <stdio.h>

#define REG_AVAIL_HI    0xFDU
#define REG_STREAM      0xFFU
#define POLL_PERIOD_MS  100U    /* module outputs once a second; 10 polls/s is plenty */
#define CHUNK           64U     /* bytes per I2C read */
#define RX_BUF_SIZE     512U    /* power of two */

static uint8_t  s_rx_buf[RX_BUF_SIZE];
static uint16_t s_head, s_tail;
static uint32_t s_errors;
static uint32_t s_last_poll;
static bool     s_polled_once;

static uint16_t rx_free(void)
{
  return (uint16_t)((s_tail - s_head - 1U) & (RX_BUF_SIZE - 1U));
}

void gps_link_init(void)
{
  /* I2C1 is already up (shared sensor bus); nothing else to do. */
  s_head = s_tail = 0;
  s_polled_once = false;
}

void gps_link_service(void)
{
  uint32_t now = millis();
  if (s_polled_once && (now - s_last_poll) < POLL_PERIOD_MS) {
    return;
  }
  s_polled_once = true;
  s_last_poll   = now;

  uint8_t cnt[2];
  if (i2c_read_regs(GPS_I2C_ADDR, REG_AVAIL_HI, cnt, 2) != 0) {
    s_errors++;
    return;
  }
  uint16_t avail = (uint16_t)((cnt[0] << 8) | cnt[1]);
  if (avail == 0xFFFFU) {       /* not ready / bad read */
    return;
  }

  /* Leave anything we can't buffer on the module; it keeps it for the next poll. */
  while (avail > 0U) {
    uint16_t n = avail;
    if (n > CHUNK)     { n = CHUNK; }
    if (n > rx_free()) { n = rx_free(); }
    if (n == 0U)       { break; }

    uint8_t tmp[CHUNK];
    if (i2c_read_regs(GPS_I2C_ADDR, REG_STREAM, tmp, n) != 0) {
      s_errors++;
      return;
    }
    for (uint16_t i = 0; i < n; i++) {
      s_rx_buf[s_head] = tmp[i];
      s_head = (uint16_t)((s_head + 1U) & (RX_BUF_SIZE - 1U));
    }
    avail = (uint16_t)(avail - n);
  }
}

int gps_link_getc(void)
{
  if (s_tail == s_head) {
    return -1;
  }
  uint8_t c = s_rx_buf[s_tail];
  s_tail = (uint16_t)((s_tail + 1U) & (RX_BUF_SIZE - 1U));
  return c;
}

int gps_link_write(const uint8_t *buf, size_t len)
{
  /* A 1-byte write would be taken as a register address, so never send one. */
  if (len < 2U || len > 255U) {
    return -3;
  }
  int rc = i2c_write_raw(GPS_I2C_ADDR, buf, (uint16_t)len);
  if (rc != 0) {
    s_errors++;
  }
  /* Let the next service() call read the reply right away. */
  s_polled_once = false;
  return rc;
}

uint32_t gps_link_overflows(void)
{
  return s_errors;
}

const char *gps_link_describe(void)
{
  static char s[48];
  snprintf(s, sizeof s, "I2C1 @ 0x%02X (D4/D5)", (unsigned)GPS_I2C_ADDR);
  return s;
}

#else  /* ---------------- USART1 ---------------- */

#include "gps_uart.h"

void gps_link_init(void)        { gps_uart_init(GPS_BAUD); }
void gps_link_service(void)     { }
int  gps_link_getc(void)        { return gps_uart_getc(); }
int  gps_link_write(const uint8_t *buf, size_t len)
{
  gps_uart_write_bytes(buf, len);
  return 0;
}
uint32_t    gps_link_overflows(void) { return gps_uart_overflows(); }
const char *gps_link_describe(void)  { return "USART1 @ 9600 (D0 RX / D1 TX)"; }

#endif
