/*
 * hil_proto.c - command parser and data-line formatters for the HIL image.
 * No hardware access; see hil_proto.h for the protocol.
 */
#include "hil_proto.h"
#include "tmp117.h"
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char *const hil_stream_names[HIL_S_COUNT] = { "IMU", "MAG", "TMP", "PWR", "GPS" };

/* Same cadences as the Rev 1 HIL firmware. TMP117 converts every 500 ms, so a
 * 250 ms poll sees every result; the 'fresh' column marks the new ones. */
const uint32_t hil_stream_default_ms[HIL_S_COUNT] = { 20, 20, 250, 100, 1000 };

#define MIN_PERIOD_MS 5U

static char *next_token(char **cursor)
{
  char *s = *cursor;
  while (*s == ' ' || *s == '\t') {
    s++;
  }
  if (*s == '\0') {
    *cursor = s;
    return NULL;
  }
  char *start = s;
  while (*s != '\0' && *s != ' ' && *s != '\t') {
    s++;
  }
  if (*s != '\0') {
    *s++ = '\0';
  }
  *cursor = s;
  return start;
}

static void set_word(hil_cmd_t *c, const char *w)
{
  strncpy(c->word, w, sizeof(c->word) - 1U);
  c->word[sizeof(c->word) - 1U] = '\0';
}

hil_cmd_t hil_parse(char *line)
{
  hil_cmd_t c;
  memset(&c, 0, sizeof c);
  c.stream = -1;

  for (char *p = line; *p != '\0'; p++) {
    *p = (char)toupper((unsigned char)*p);
  }

  char *cur = line;
  char *cmd = next_token(&cur);
  if (cmd == NULL) {
    c.kind = HIL_CMD_NONE;
    return c;
  }
  char *arg1 = next_token(&cur);
  char *arg2 = next_token(&cur);

  if (strcmp(cmd, "PING") == 0)   { c.kind = HIL_CMD_PING;   return c; }
  if (strcmp(cmd, "INFO") == 0)   { c.kind = HIL_CMD_INFO;   return c; }
  if (strcmp(cmd, "SCAN") == 0)   { c.kind = HIL_CMD_SCAN;   return c; }
  if (strcmp(cmd, "STOP") == 0)   { c.kind = HIL_CMD_STOP;   return c; }
  if (strcmp(cmd, "MON") == 0)    { c.kind = HIL_CMD_MON;    return c; }
  if (strcmp(cmd, "BUS") == 0)    { c.kind = HIL_CMD_BUS;    return c; }
  if (strcmp(cmd, "REINIT") == 0) { c.kind = HIL_CMD_REINIT; return c; }
  if (strcmp(cmd, "HELP") == 0)   { c.kind = HIL_CMD_HELP;   return c; }

  if (strcmp(cmd, "START") == 0) {
    if (arg1 == NULL) {
      c.kind = HIL_CMD_BAD_ARG;
      set_word(&c, cmd);
      return c;
    }
    if (strcmp(arg1, "ALL") == 0) {
      c.stream = -1;
    } else {
      c.stream = -2;
      for (int i = 0; i < HIL_S_COUNT; i++) {
        if (strcmp(arg1, hil_stream_names[i]) == 0) {
          c.stream = i;
        }
      }
      if (c.stream == -2) {
        c.kind = HIL_CMD_BAD_STREAM;
        set_word(&c, arg1);
        return c;
      }
    }
    if (arg2 != NULL) {
      char *end = NULL;
      unsigned long v = strtoul(arg2, &end, 10);
      if (end == arg2 || *end != '\0' || v > 600000UL) {
        c.kind = HIL_CMD_BAD_ARG;
        set_word(&c, cmd);
        return c;
      }
      c.period_ms = (uint32_t)v;
      if (c.period_ms != 0U && c.period_ms < MIN_PERIOD_MS) {
        c.period_ms = MIN_PERIOD_MS;
      }
    }
    c.kind = HIL_CMD_START;
    return c;
  }

  if (strcmp(cmd, "GPSRST") == 0) {
    if (arg1 != NULL && strcmp(arg1, "HOT") == 0) {
      c.gps_mask = GPS_START_HOT;  c.gps_mode = "HOT";
    } else if (arg1 != NULL && strcmp(arg1, "WARM") == 0) {
      c.gps_mask = GPS_START_WARM; c.gps_mode = "WARM";
    } else if (arg1 != NULL && strcmp(arg1, "COLD") == 0) {
      c.gps_mask = GPS_START_COLD; c.gps_mode = "COLD";
    } else {
      c.kind = HIL_CMD_BAD_ARG;
      set_word(&c, cmd);
      return c;
    }
    c.kind = HIL_CMD_GPSRST;
    return c;
  }

  c.kind = HIL_CMD_UNKNOWN;
  set_word(&c, cmd);
  return c;
}

/* ---- data lines ---------------------------------------------------------- */

int hil_fmt_imu(char *buf, size_t size, uint32_t t_ms, const vec3f_t *a, const vec3f_t *g,
                float die_c)
{
  return snprintf(buf, size, "$IMU,%lu,%.4f,%.4f,%.4f,%.5f,%.5f,%.5f,%.2f\n",
                  (unsigned long)t_ms, (double)a->x, (double)a->y, (double)a->z,
                  (double)g->x, (double)g->y, (double)g->z, (double)die_c);
}

int hil_fmt_mag(char *buf, size_t size, uint32_t t_ms, const vec3f_t *m)
{
  return snprintf(buf, size, "$MAG,%lu,%.3f,%.3f,%.3f\n", (unsigned long)t_ms,
                  (double)m->x, (double)m->y, (double)m->z);
}

int hil_fmt_tmp(char *buf, size_t size, uint32_t t_ms, bool ok, int16_t raw, float die_c,
                bool fresh)
{
  if (!ok) {
    /* read error or no conversion finished yet: keep the column count */
    return snprintf(buf, size, "$TMP,%lu,nan,nan,%.2f,0\n", (unsigned long)t_ms, (double)die_c);
  }
  return snprintf(buf, size, "$TMP,%lu,%d,%.4f,%.2f,%d\n", (unsigned long)t_ms, (int)raw,
                  (double)tmp117_raw_to_c(raw), (double)die_c, fresh ? 1 : 0);
}

int hil_fmt_pwr(char *buf, size_t size, uint32_t t_ms, uint8_t addr, float bus_v, float shunt_mv,
                float current_ma, float power_mw)
{
  return snprintf(buf, size, "$PWR,%lu,0x%02X,%.3f,%.3f,%.2f,%.2f\n", (unsigned long)t_ms,
                  (unsigned)addr, (double)bus_v, (double)shunt_mv, (double)current_ma,
                  (double)power_mw);
}

int hil_fmt_gps(char *buf, size_t size, uint32_t t_ms, const gps_fix_t *f, uint32_t link_err)
{
  char utc[32] = "";
  if (f->time_valid && f->year > 2000U) {
    snprintf(utc, sizeof utc, "%04u-%02u-%02uT%02u:%02u:%02uZ", (unsigned)f->year,
             (unsigned)f->month, (unsigned)f->day, (unsigned)f->hour, (unsigned)f->min,
             (unsigned)f->sec);
  }
  const bool   valid   = f->location_valid;
  const bool   pvt     = f->from_pvt;
  const long   age     = (f->update_ms != 0U) ? (long)(t_ms - f->update_ms) : -1L;
  const double nan_d   = (double)NAN;

  return snprintf(buf, size,
                  "$GPS,%lu,%d,%.7f,%.7f,%.2f,%d,%u,%.2f,%.2f,%.2f,%ld,%s,%lu,%lu,%lu,%lu,%lu\n",
                  (unsigned long)t_ms, valid ? 1 : 0,
                  valid ? f->lat_deg : nan_d,
                  valid ? f->lon_deg : nan_d,
                  valid ? (double)f->alt_m : nan_d,
                  f->sats,
                  (unsigned)f->fix_type,
                  pvt ? (double)f->h_acc_m : nan_d,
                  pvt ? (double)f->v_acc_m : nan_d,
                  pvt ? (double)f->pdop : nan_d,
                  age, utc,
                  (unsigned long)(pvt ? f->itow_ms : 0U),
                  (unsigned long)f->chars_processed, (unsigned long)f->ubx_frames,
                  (unsigned long)f->ubx_errors, (unsigned long)link_err);
}
