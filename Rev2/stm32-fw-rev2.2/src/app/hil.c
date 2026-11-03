/*
 * hil.c - GeoSat Rev 2 hardware-in-the-loop (HIL) test firmware.
 *
 * Same serial protocol as the Rev 1 HIL firmware (XIAO ESP32-C6), so the
 * Python scripts in hil/ drive it the same way. The board boots IDLE and only
 * streams when a script asks. Protocol details: hil_proto.h.
 *
 * Sensors (all on I2C1, PB7 SDA / PB6 SCL = Nucleo D4 / D5):
 *   LSM6DSOX 0x6A/0x6B, LIS3MDL 0x1C/0x1E, TMP117 0x48-0x4B,
 *   SAM-M10Q 0x42 (or USART1 with -DGPS_LINK_I2C=OFF), INA219 0x40/0x41/0x44/0x45.
 *
 * Serial: ST-LINK virtual COM port (USART2), 115200 8N1.
 */
#include "board.h"
#include "clock.h"
#include "tick.h"
#include "debug_uart.h"
#include "i2c.h"
#include "adc.h"
#include "imu.h"
#include "ina219.h"
#include "tmp117.h"
#include "gps.h"
#include "gps_link.h"
#include "hil_proto.h"
#include "stm32l4xx_ll_gpio.h"
#include <math.h>
#include <stdio.h>

/* ---- detected hardware ---------------------------------------------------- */

static const uint8_t LSM_CANDIDATES[] = { 0x6A, 0x6B };
static const uint8_t TMP_CANDIDATES[] = { 0x48, 0x49, 0x4A, 0x4B };
static const uint8_t INA_CANDIDATES[] = { 0x40, 0x41, 0x44, 0x45 };   /* every one found is used */
#define MAX_INA (sizeof(INA_CANDIDATES) / sizeof(INA_CANDIDATES[0]))

static uint8_t  s_lsm;          /* 0 = not found */
static uint8_t  s_lis;
static uint8_t  s_tmp;
static uint8_t  s_ina[MAX_INA];
static uint8_t  s_ina_count;
static bool     s_gps_present;  /* I2C: answered at 0x42. UART: assumed. */
static bool     s_gps_cfg_ok;   /* SAM-M10Q ACKed the UBX config */
static uint32_t s_read_errors;  /* sensor reads that failed while streaming */

/* ---- streams ---------------------------------------------------------------- */

typedef struct {
  bool     on;
  uint32_t period;
  uint32_t last;
} stream_t;

static stream_t s_streams[HIL_S_COUNT];
static bool     s_monitor;
static uint32_t s_last_monitor;

static char s_line[192];

static void emit(int len)
{
  if (len > 0) {
    if ((size_t)len >= sizeof s_line) {      /* truncated: still end the line */
      s_line[sizeof s_line - 2U] = '\n';
      s_line[sizeof s_line - 1U] = '\0';
    }
    fputs(s_line, stdout);
  }
}

static float lsm_die_c(void)
{
  float t;
  if (s_lsm != 0U && lsm6dsox_read_temp(&t)) {
    return t;
  }
  return NAN;
}

/* ---- sensor detection --------------------------------------------------------- */

static void init_sensors(void)
{
  s_lsm = 0;
  for (size_t i = 0; i < sizeof LSM_CANDIDATES; i++) {
    if (lsm6dsox_setup(LSM_CANDIDATES[i])) {
      s_lsm = LSM_CANDIDATES[i];
      break;
    }
  }
  if (s_lsm) { printf("#OK,LSM6DSOX,0x%02X\n", s_lsm); } else { printf("#FAIL,LSM6DSOX\n"); }

  s_lis = lis3mdl_setup(LIS3MDL_ADDR_B, LIS3MDL_ADDR_A);   /* 0x1C first: Adafruit default */
  if (s_lis) { printf("#OK,LIS3MDL,0x%02X\n", s_lis); } else { printf("#FAIL,LIS3MDL\n"); }

  s_tmp = 0;
  for (size_t i = 0; i < sizeof TMP_CANDIDATES; i++) {
    if (i2c_probe(TMP_CANDIDATES[i]) == 0 && tmp117_setup(TMP_CANDIDATES[i])) {
      s_tmp = TMP_CANDIDATES[i];
      break;
    }
  }
  if (s_tmp) { printf("#OK,TMP117,0x%02X\n", s_tmp); } else { printf("#FAIL,TMP117\n"); }

  s_ina_count = 0;
  for (size_t i = 0; i < MAX_INA; i++) {
    if (ina219_setup_at(INA_CANDIDATES[i])) {
      s_ina[s_ina_count++] = INA_CANDIDATES[i];
      printf("#OK,INA219,0x%02X\n", INA_CANDIDATES[i]);
    }
  }
  if (s_ina_count == 0U) { printf("#FAIL,INA219\n"); }

#if GPS_LINK_I2C
  s_gps_present = (i2c_probe(GPS_I2C_ADDR) == 0);
#else
  s_gps_present = true;   /* a UART can't be probed */
#endif
  s_gps_cfg_ok = false;
  if (s_gps_present) {
    gps_link_init();
    s_gps_cfg_ok = gps_setup(1000);
  }
  if (!s_gps_present) {
    printf("#FAIL,SAM-M10Q,no answer at 0x%02X\n", (unsigned)GPS_I2C_ADDR);
  } else if (s_gps_cfg_ok) {
    printf("#OK,SAM-M10Q,%s,UBX ACK\n", gps_link_describe());
  } else {
    printf("#WARN,SAM-M10Q,%s,no UBX ACK (NMEA fallback only)\n", gps_link_describe());
  }
}

static bool stream_available(int s)
{
  switch (s) {
    case HIL_S_IMU: return s_lsm != 0U;
    case HIL_S_MAG: return s_lis != 0U;
    case HIL_S_TMP: return s_tmp != 0U;
    case HIL_S_PWR: return s_ina_count > 0U;
    case HIL_S_GPS: return s_gps_present;
    default:        return false;
  }
}

/* ---- data lines ---------------------------------------------------------------- */

static void emit_stream(int s, uint32_t t)
{
  switch (s) {
    case HIL_S_IMU: {
      vec3f_t a, g;
      if (!lsm6dsox_read(&a, &g)) { s_read_errors++; return; }
      emit(hil_fmt_imu(s_line, sizeof s_line, t, &a, &g, lsm_die_c()));
      break;
    }
    case HIL_S_MAG: {
      vec3f_t m;
      if (!lis3mdl_read(&m)) { s_read_errors++; return; }
      emit(hil_fmt_mag(s_line, sizeof s_line, t, &m));
      break;
    }
    case HIL_S_TMP: {
      int16_t raw = 0;
      bool    fresh = false;
      bool    ok = tmp117_read(&raw, &fresh);
      if (!ok) { s_read_errors++; }
      emit(hil_fmt_tmp(s_line, sizeof s_line, t, ok, raw, lsm_die_c(), fresh));
      break;
    }
    case HIL_S_PWR:
      for (uint8_t i = 0; i < s_ina_count; i++) {
        float v, sh, cur, p;
        if (!ina219_read_at(s_ina[i], &v, &sh, &cur, &p)) { s_read_errors++; continue; }
        emit(hil_fmt_pwr(s_line, sizeof s_line, t, s_ina[i], v, sh, cur, p));
      }
      break;
    case HIL_S_GPS:
      emit(hil_fmt_gps(s_line, sizeof s_line, t, gps_get(), gps_link_overflows()));
      break;
    default:
      break;
  }
}

static void start_stream(int s, uint32_t period)
{
  if (!stream_available(s)) {
    printf("#ERR,NOSENSOR,%s\n", hil_stream_names[s]);
    return;
  }
  stream_t *st = &s_streams[s];
  st->period = period ? period : hil_stream_default_ms[s];
  st->last   = millis() - st->period;   /* fire on the next loop pass */
  st->on     = true;
  printf("#ACK,START,%s,%lu\n", hil_stream_names[s], (unsigned long)st->period);
}

static void stop_all(void)
{
  for (int i = 0; i < HIL_S_COUNT; i++) {
    s_streams[i].on = false;
  }
  s_monitor = false;
}

/* ---- INFO / SCAN / MON ---------------------------------------------------------- */

static void print_addr(const char *key, uint8_t addr)
{
  if (addr) { printf(",%s=0x%02X", key, addr); } else { printf(",%s=none", key); }
}

static void print_info(void)
{
  printf("#INFO,fw=%s,mcu=%s", HIL_FW_VERSION,
#if defined(STM32L433xx)
         "STM32L433"
#else
         "STM32L432"
#endif
  );
  print_addr("lsm", s_lsm);
  print_addr("lis", s_lis);
  print_addr("tmp", s_tmp);
#if GPS_LINK_I2C
  print_addr("gps", s_gps_present ? GPS_I2C_ADDR : 0U);
#else
  printf(",gps=uart");
#endif
  printf(",gps_cfg=%s,ina=", s_gps_present ? (s_gps_cfg_ok ? "ack" : "noack") : "none");
  if (s_ina_count == 0U) {
    printf("none");
  }
  for (uint8_t i = 0; i < s_ina_count; i++) {
    printf("%s0x%02X", i ? ";" : "", s_ina[i]);
  }
  const gps_fix_t *f = gps_get();
  printf(",gps_chars=%lu,gps_ubx=%lu,gps_link_err=%lu,read_err=%lu,rx_ovf=%lu\n",
         (unsigned long)f->chars_processed, (unsigned long)f->ubx_frames,
         (unsigned long)gps_link_overflows(), (unsigned long)s_read_errors,
         (unsigned long)debug_uart_rx_overflows());
}

static void i2c_scan(void)
{
  int n = 0;
  printf("#SCAN");
  for (uint8_t a = 0x08; a < 0x78; a++) {
    if (i2c_probe(a) == 0) {
      printf(",0x%02X", a);
      n++;
    }
  }
  printf("\n#SCAN_DONE,%d\n", n);
}

static void print_monitor(void)
{
  printf("---------------- SENSOR READINGS ----------------\n");
  int16_t raw;
  bool fresh;
  if (s_tmp && tmp117_read(&raw, &fresh)) {
    float t = tmp117_raw_to_c(raw);
    printf("TMP117 Temp:   %.3f C (%.3f F)\n", (double)t, (double)(t * 1.8f + 32.0f));
  }
  printf("Supply VDDA:   %lu mV\n", (unsigned long)adc_read_vdda_mv());
  vec3f_t a, g, m;
  if (s_lsm && lsm6dsox_read(&a, &g)) {
    printf("Accel [m/s^2]: X=%.2f, Y=%.2f, Z=%.2f\n", (double)a.x, (double)a.y, (double)a.z);
    printf("Gyro  [rad/s]: X=%.2f, Y=%.2f, Z=%.2f\n", (double)g.x, (double)g.y, (double)g.z);
  }
  if (s_lis && lis3mdl_read(&m)) {
    printf("Mag    [uT]:   X=%.2f, Y=%.2f, Z=%.2f\n", (double)m.x, (double)m.y, (double)m.z);
  }
  for (uint8_t i = 0; i < s_ina_count; i++) {
    float v, sh, cur, p;
    if (ina219_read_at(s_ina[i], &v, &sh, &cur, &p)) {
      printf("INA219 0x%02X:   %.2f V | %.2f mA | %.2f mW\n", s_ina[i], (double)v, (double)cur,
             (double)p);
    }
  }
  const gps_fix_t *f = gps_get();
  if (f->location_valid) {
    printf("GPS:           %.7f, %.7f | Alt %.1f m | Sats %d | fix %u | hAcc %.2f m\n",
           f->lat_deg, f->lon_deg, (double)f->alt_m, f->sats, (unsigned)f->fix_type,
           (double)f->h_acc_m);
  } else {
    printf("GPS:           searching... (sats %d, chars %lu, UBX %lu)\n", f->sats,
           (unsigned long)f->chars_processed, (unsigned long)f->ubx_frames);
  }
  printf("\n");
}

/* ---- I2C line diagnostics --------------------------------------------------------- */

/* pd = level with the internal pull-DOWN on: 1 means an external pull-up is present.
 * pu = level with the internal pull-UP on:   0 means something holds the line low. */
static void line_state(GPIO_TypeDef *port, uint32_t pin, int *pd, int *pu)
{
  LL_GPIO_SetPinMode(port, pin, LL_GPIO_MODE_INPUT);
  LL_GPIO_SetPinPull(port, pin, LL_GPIO_PULL_DOWN);
  delay_ms(3);
  *pd = LL_GPIO_IsInputPinSet(port, pin) ? 1 : 0;
  LL_GPIO_SetPinPull(port, pin, LL_GPIO_PULL_UP);
  delay_ms(3);
  *pu = LL_GPIO_IsInputPinSet(port, pin) ? 1 : 0;
  LL_GPIO_SetPinPull(port, pin, LL_GPIO_PULL_NO);
}

static const char *line_verdict(int pd, int pu)
{
  if (pu == 0) { return "HELD_LOW"; }
  if (pd == 1) { return "PULLED_UP"; }
  return "FLOATING";
}

static void bus_check(void)
{
  int pd, pu;
  line_state(I2C_SDA_PORT, I2C_SDA_PIN, &pd, &pu);
  printf("#BUS,SDA,PB7,pd=%d,pu=%d,%s\n", pd, pu, line_verdict(pd, pu));
  line_state(I2C_SCL_PORT, I2C_SCL_PIN, &pd, &pu);
  printf("#BUS,SCL,PB6,pd=%d,pu=%d,%s\n", pd, pu, line_verdict(pd, pu));
  i2c_init();   /* back to I2C alternate function */
  printf("#BUS_DONE\n");
}

/* A device left mid-transfer (MCU reset during a read) can hold SDA low forever.
 * Clocking SCL up to 9 times lets it finish its byte and release the bus. */
static int i2c_bus_recover(void)
{
  LL_GPIO_SetPinMode(I2C_SDA_PORT, I2C_SDA_PIN, LL_GPIO_MODE_INPUT);
  LL_GPIO_SetPinPull(I2C_SDA_PORT, I2C_SDA_PIN, LL_GPIO_PULL_UP);
  LL_GPIO_SetPinOutputType(I2C_SCL_PORT, I2C_SCL_PIN, LL_GPIO_OUTPUT_OPENDRAIN);
  LL_GPIO_SetOutputPin(I2C_SCL_PORT, I2C_SCL_PIN);
  LL_GPIO_SetPinMode(I2C_SCL_PORT, I2C_SCL_PIN, LL_GPIO_MODE_OUTPUT);
  delay_us(10);

  int pulses = 0;
  while (!LL_GPIO_IsInputPinSet(I2C_SDA_PORT, I2C_SDA_PIN) && pulses < 9) {
    LL_GPIO_ResetOutputPin(I2C_SCL_PORT, I2C_SCL_PIN);
    delay_us(10);
    LL_GPIO_SetOutputPin(I2C_SCL_PORT, I2C_SCL_PIN);
    delay_us(10);
    pulses++;
  }
  /* STOP condition: SDA low -> high while SCL is high */
  LL_GPIO_SetPinOutputType(I2C_SDA_PORT, I2C_SDA_PIN, LL_GPIO_OUTPUT_OPENDRAIN);
  LL_GPIO_ResetOutputPin(I2C_SDA_PORT, I2C_SDA_PIN);
  LL_GPIO_SetPinMode(I2C_SDA_PORT, I2C_SDA_PIN, LL_GPIO_MODE_OUTPUT);
  delay_us(10);
  LL_GPIO_SetOutputPin(I2C_SDA_PORT, I2C_SDA_PIN);
  delay_us(10);
  return pulses;
}

/* ---- commands ------------------------------------------------------------------------ */

static void print_help(void)
{
  printf("#HELP,PING | INFO | SCAN | START IMU|MAG|TMP|PWR|GPS|ALL [ms] | STOP | MON | BUS"
         " | REINIT | GPSRST HOT|WARM|COLD\n");
}

static void handle_command(char *line)
{
  hil_cmd_t c = hil_parse(line);
  switch (c.kind) {
    case HIL_CMD_NONE:   break;
    case HIL_CMD_PING:   printf("#PONG\n"); break;
    case HIL_CMD_INFO:   print_info(); break;
    case HIL_CMD_SCAN:   i2c_scan(); break;
    case HIL_CMD_HELP:   print_help(); break;
    case HIL_CMD_BUS:    stop_all(); bus_check(); break;
    case HIL_CMD_STOP:   stop_all(); printf("#ACK,STOP\n"); break;
    case HIL_CMD_MON:
      s_monitor = true;
      s_last_monitor = millis() - 1000U;
      printf("#ACK,MON\n");
      break;
    case HIL_CMD_START:
      if (c.stream < 0) {
        for (int i = 0; i < HIL_S_COUNT; i++) {
          if (stream_available(i)) {
            start_stream(i, c.period_ms);
          }
        }
      } else {
        start_stream(c.stream, c.period_ms);
      }
      break;
    case HIL_CMD_REINIT: {
      stop_all();
      int pulses = i2c_bus_recover();
      i2c_init();
      printf("#I2C,recovery_pulses=%d\n", pulses);
      init_sensors();
      print_info();
      printf("#ACK,REINIT\n");
      break;
    }
    case HIL_CMD_GPSRST:
      if (!s_gps_present) {
        printf("#ERR,NOSENSOR,GPS\n");
        break;
      }
      printf("#ACK,GPSRST,%s\n", c.gps_mode);
      s_gps_cfg_ok = gps_restart(c.gps_mask, 1000);
      printf(s_gps_cfg_ok ? "#OK,GPSCFG,%s\n" : "#WARN,GPSCFG,%s,no UBX ACK\n", c.gps_mode);
      break;
    case HIL_CMD_BAD_STREAM: printf("#ERR,BADSTREAM,%s\n", c.word); break;
    case HIL_CMD_BAD_ARG:    printf("#ERR,BADARG,%s\n", c.word); break;
    case HIL_CMD_UNKNOWN:
    default:                 printf("#ERR,UNKNOWN,%s\n", c.word); break;
  }
}

static void poll_commands(void)
{
  static char     buf[64];
  static uint16_t len;
  static bool     overlong;
  int ch;
  while ((ch = debug_uart_getc()) >= 0) {
    if (ch == '\n' || ch == '\r') {
      if (overlong) {
        printf("#ERR,TOOLONG\n");
      } else if (len) {
        buf[len] = '\0';
        handle_command(buf);
      }
      len = 0;
      overlong = false;
    } else if (len < sizeof buf - 1U) {
      buf[len++] = (char)ch;
    } else {
      overlong = true;
    }
  }
}

/* ---- main ------------------------------------------------------------------------- */

int main(void)
{
  clock_init();
  tick_init();
  board_led_init();
  debug_uart_init(115200);
  debug_uart_rx_enable();

  printf("\n#BOOT,%s\n", HIL_FW_VERSION);
  adc_init();
  i2c_init();
  printf("#I2C,SDA=PB7(D4),SCL=PB6(D5),400kHz\n");
  init_sensors();
  print_info();
  printf("#READY\n");

  uint32_t last_led = millis();
  while (1) {
    gps_poll();          /* drains the SAM-M10Q every 100 ms (I2C) or the UART ring */
    poll_commands();

    uint32_t now = millis();
    for (int i = 0; i < HIL_S_COUNT; i++) {
      stream_t *st = &s_streams[i];
      if (!st->on || (now - st->last) < st->period) {
        continue;
      }
      /* steady cadence, but don't try to catch up after a long stall */
      st->last = ((now - st->last) > 5U * st->period) ? now : st->last + st->period;
      emit_stream(i, now);
    }

    if (s_monitor && (now - s_last_monitor) >= 1000U) {
      s_last_monitor = now;
      print_monitor();
    }
    if ((now - last_led) >= 500U) {
      last_led = now;
      board_led_toggle();   /* heartbeat */
    }
    __WFI();             /* SysTick (1 ms) or a UART byte wakes us */
  }
}
