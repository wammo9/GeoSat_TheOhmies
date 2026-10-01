/*
 * gps.c - NMEA line assembly + parsing with minmea (replaces TinyGPSPlus).
 *
 * The Ultimate GPS v3 (MT3333) streams GGA/RMC/GSA/GSV at 1 Hz by default. We use:
 *   RMC -> fix valid flag, lat/lon
 *   GGA -> fix quality, satellites in use, altitude
 */
#include "gps.h"
#include "gps_uart.h"
#include "minmea.h"
#include <string.h>

static char      s_line[MINMEA_MAX_SENTENCE_LENGTH + 16];  /* NMEA max is 82 incl. CRLF */
static uint16_t  s_len;
static gps_fix_t s_fix;

static void parse_line(const char *line)
{
  switch (minmea_sentence_id(line, false)) {
    case MINMEA_SENTENCE_RMC: {
      struct minmea_sentence_rmc f;
      if (minmea_parse_rmc(&f, line)) {
        s_fix.sentences_ok++;
        s_fix.location_valid = f.valid;
        if (f.valid) {
          s_fix.lat_deg = minmea_tocoord(&f.latitude);
          s_fix.lon_deg = minmea_tocoord(&f.longitude);
        }
      }
      break;
    }
    case MINMEA_SENTENCE_GGA: {
      struct minmea_sentence_gga f;
      if (minmea_parse_gga(&f, line)) {
        s_fix.sentences_ok++;
        s_fix.sats = f.satellites_tracked;
        if (f.fix_quality > 0) {
          s_fix.lat_deg = minmea_tocoord(&f.latitude);
          s_fix.lon_deg = minmea_tocoord(&f.longitude);
          s_fix.alt_m   = minmea_tofloat(&f.altitude);
        }
      }
      break;
    }
    default:
      break;
  }
}

void gps_poll(void)
{
  int c;
  while ((c = gps_uart_getc()) >= 0) {
    s_fix.chars_processed++;

    if (c == '$') {           /* start of sentence: resync */
      s_len = 0;
    }
    if (s_len < sizeof(s_line) - 1U) {
      s_line[s_len++] = (char)c;
    } else {
      s_len = 0;              /* garbage / overlong line: drop it */
      continue;
    }
    if (c == '\n') {
      s_line[s_len] = '\0';
      if (s_line[0] == '$') {
        parse_line(s_line);
      }
      s_len = 0;
    }
  }
}

const gps_fix_t *gps_get(void)
{
  return &s_fix;
}
