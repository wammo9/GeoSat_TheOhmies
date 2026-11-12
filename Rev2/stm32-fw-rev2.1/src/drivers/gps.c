/*
 * gps.c - u-blox SAM-M10Q: UBX-NAV-PVT + NMEA fallback, over I2C or UART
 * (transport in gps_link.c, chosen by GPS_LINK_I2C in board.h).
 *
 * Out of the box the SAM-M10Q sends NMEA 4.11 (GGA, GLL, GSA, GSV, RMC, VTG, TXT)
 * at 1 Hz on both UART (9600 baud) and I2C. gps_setup() switches on UBX-NAV-PVT, which carries the
 * fix, UTC time and the receiver's own accuracy estimate (hAcc/vAcc), and
 * switches off the NMEA sentences we don't use so the link stays light.
 *
 * The stream is a mix of NMEA lines ('$' ... '\n') and binary UBX frames
 * (0xB5 0x62 ...). u-blox never interleaves two messages, so a small mode
 * switch is enough to route each byte.
 */
#include "gps.h"
#include "gps_link.h"
#include "board.h"
#include "tick.h"
#include "ubx.h"
#include "minmea.h"
#include <string.h>

typedef enum { MODE_IDLE = 0, MODE_NMEA, MODE_UBX } rx_mode_t;

static rx_mode_t    s_mode;
static char         s_line[MINMEA_MAX_SENTENCE_LENGTH + 16];   /* NMEA max is 82 incl. CRLF */
static uint16_t     s_len;
static ubx_parser_t s_ubx;
static gps_fix_t    s_fix;
static bool         s_pvt_seen;     /* once PVT arrives, NMEA no longer drives the fix */

/* ACK tracking for gps_setup() */
static volatile int8_t s_ack;       /* 0 waiting, 1 ACK, -1 NAK */
static uint8_t         s_ack_cls, s_ack_id;

/* ----------------------------------------------------------------------- */

/* NMEA ddmm.mmmm -> decimal degrees, in double (minmea_tocoord is float). */
static double nmea_coord(const struct minmea_float *f)
{
  if (f->scale == 0) {
    return 0.0;
  }
  double v   = (double)f->value / (double)f->scale;
  int    deg = (int)(v / 100.0);
  return (double)deg + (v - (double)deg * 100.0) / 60.0;
}

static void handle_nmea(const char *line)
{
  switch (minmea_sentence_id(line, false)) {
    case MINMEA_SENTENCE_RMC: {
      struct minmea_sentence_rmc f;
      if (minmea_parse_rmc(&f, line)) {
        s_fix.sentences_ok++;
        if (!s_pvt_seen) {
          s_fix.location_valid = f.valid;
          if (f.valid) {
            s_fix.lat_deg = nmea_coord(&f.latitude);
            s_fix.lon_deg = nmea_coord(&f.longitude);
          }
        }
      }
      break;
    }
    case MINMEA_SENTENCE_GGA: {
      struct minmea_sentence_gga f;
      if (minmea_parse_gga(&f, line)) {
        s_fix.sentences_ok++;
        if (!s_pvt_seen) {
          s_fix.sats = f.satellites_tracked;
          if (f.fix_quality > 0) {
            s_fix.lat_deg = nmea_coord(&f.latitude);
            s_fix.lon_deg = nmea_coord(&f.longitude);
            s_fix.alt_m   = minmea_tofloat(&f.altitude);
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

static void handle_ubx(const ubx_parser_t *p)
{
  s_fix.ubx_frames++;

  if (p->cls == UBX_CLASS_NAV && p->id == UBX_ID_NAV_PVT) {
    ubx_nav_pvt_t pvt;
    if (!ubx_decode_nav_pvt(p->payload, p->len, &pvt)) {
      return;
    }
    s_pvt_seen      = true;
    s_fix.from_pvt  = true;
    s_fix.fix_type  = pvt.fix_type;
    s_fix.sats      = pvt.num_sv;
    s_fix.h_acc_m   = (float)pvt.h_acc_mm * 0.001f;
    s_fix.v_acc_m   = (float)pvt.v_acc_mm * 0.001f;
    s_fix.pdop      = (float)pvt.pdop_e2 * 0.01f;
    s_fix.location_valid = ((pvt.flags & 0x01U) != 0U) &&
                           (pvt.fix_type == 2U || pvt.fix_type == 3U || pvt.fix_type == 4U);
    if (s_fix.location_valid) {
      s_fix.lat_deg = (double)pvt.lat_e7 * 1e-7;
      s_fix.lon_deg = (double)pvt.lon_e7 * 1e-7;
      s_fix.alt_m   = (float)pvt.hmsl_mm * 0.001f;
    }
    s_fix.time_valid = (pvt.valid & 0x07U) == 0x07U;   /* date, time, fully resolved */
    s_fix.year  = pvt.year;
    s_fix.month = pvt.month;
    s_fix.day   = pvt.day;
    s_fix.hour  = pvt.hour;
    s_fix.min   = pvt.min;
    s_fix.sec   = pvt.sec;
    return;
  }

  if (p->cls == UBX_CLASS_ACK && p->len == 2U &&
      p->payload[0] == s_ack_cls && p->payload[1] == s_ack_id) {
    s_ack = (p->id == UBX_ID_ACK_ACK) ? 1 : -1;
  }
}

static void nmea_start(char c)
{
  s_mode = MODE_NMEA;
  s_len  = 0;
  s_line[s_len++] = c;
}

void gps_poll(void)
{
  gps_link_service();

  int ci;
  while ((ci = gps_link_getc()) >= 0) {
    uint8_t c = (uint8_t)ci;
    s_fix.chars_processed++;

    switch (s_mode) {
      case MODE_UBX: {
        ubx_parse_result_t r = ubx_parser_feed(&s_ubx, c);
        if (r == UBX_PARSE_FRAME) {
          handle_ubx(&s_ubx);
          s_mode = MODE_IDLE;
        } else if (r == UBX_PARSE_ERROR) {
          s_fix.ubx_errors++;
          s_mode = MODE_IDLE;
          if (c == '$') {           /* lost sync: this byte may start a sentence */
            nmea_start('$');
          }
        }
        break;
      }

      case MODE_NMEA:
        if (c == UBX_SYNC1) {        /* NMEA is ASCII, so 0xB5 means a UBX frame cut in */
          ubx_parser_reset(&s_ubx);
          (void)ubx_parser_feed(&s_ubx, c);
          s_mode = MODE_UBX;
          break;
        }
        if (c == '$') {              /* new sentence: resync */
          nmea_start('$');
          break;
        }
        if (s_len < sizeof(s_line) - 1U) {
          s_line[s_len++] = (char)c;
        } else {
          s_mode = MODE_IDLE;        /* overlong line: drop it */
          break;
        }
        if (c == '\n') {
          s_line[s_len] = '\0';
          handle_nmea(s_line);
          s_mode = MODE_IDLE;
        }
        break;

      case MODE_IDLE:
      default:
        if (c == '$') {
          nmea_start('$');
        } else if (c == UBX_SYNC1) {
          ubx_parser_reset(&s_ubx);
          (void)ubx_parser_feed(&s_ubx, c);
          s_mode = MODE_UBX;
        }
        break;
    }
  }
}

const gps_fix_t *gps_get(void)
{
  return &s_fix;
}

bool gps_setup(uint32_t timeout_ms)
{
  /* Message rates for the port we actually read (1 = every nav epoch, 0 = off). */
  static const ubx_cfg_u1_t cfg[] = {
#if GPS_LINK_I2C
    { UBX_KEY_MSGOUT_UBX_NAV_PVT_I2C,   1 },
    { UBX_KEY_MSGOUT_NMEA_GGA_I2C,      1 },
    { UBX_KEY_MSGOUT_NMEA_RMC_I2C,      1 },
    { UBX_KEY_MSGOUT_NMEA_GLL_I2C,      0 },
    { UBX_KEY_MSGOUT_NMEA_GSA_I2C,      0 },
    { UBX_KEY_MSGOUT_NMEA_GSV_I2C,      0 },
    { UBX_KEY_MSGOUT_NMEA_VTG_I2C,      0 },
#else
    { UBX_KEY_MSGOUT_UBX_NAV_PVT_UART1, 1 },
    { UBX_KEY_MSGOUT_NMEA_GGA_UART1,    1 },
    { UBX_KEY_MSGOUT_NMEA_RMC_UART1,    1 },
    { UBX_KEY_MSGOUT_NMEA_GLL_UART1,    0 },
    { UBX_KEY_MSGOUT_NMEA_GSA_UART1,    0 },
    { UBX_KEY_MSGOUT_NMEA_GSV_UART1,    0 },
    { UBX_KEY_MSGOUT_NMEA_VTG_UART1,    0 },
#endif
  };
  uint8_t frame[8 + 4 + 5 * (sizeof(cfg) / sizeof(cfg[0]))];
  size_t  n = ubx_build_valset_u1(UBX_LAYER_RAM, cfg, sizeof(cfg) / sizeof(cfg[0]),
                                  frame, sizeof(frame));
  if (n == 0U) {
    return false;
  }

  s_ack_cls = UBX_CLASS_CFG;
  s_ack_id  = UBX_ID_CFG_VALSET;

  /* The module may still be booting right after power-up; retry a few times. */
  for (int attempt = 0; attempt < 3; attempt++) {
    s_ack = 0;
    (void)gps_link_write(frame, n);
    uint32_t t0 = millis();
    while ((millis() - t0) < timeout_ms) {
      gps_poll();
      if (s_ack != 0) {
        return s_ack > 0;
      }
    }
  }
  return false;
}
