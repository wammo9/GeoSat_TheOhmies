/*
 * hil_proto.h - serial protocol of the HIL test image (geosat_hil).
 *
 * Pure C, no hardware access: the command parser and the data-line
 * formatters live here so they can be unit-tested on a PC
 * (tests/host/test_hil_proto.c) against the Python scripts in hil/.
 *
 * Commands (115200 8N1, '\n'-terminated, case-insensitive):
 *   PING                        -> #PONG
 *   INFO                        -> #INFO,fw=...,lsm=..,lis=..,tmp=..,gps=..,ina=..;..,...
 *   SCAN                        -> #SCAN,<addr>... then #SCAN_DONE,<count>
 *   START <S> [period_ms]       -> #ACK,START,<S>,<period>   S = IMU|MAG|TMP|PWR|GPS|RMG|ADX|ALL
 *   STOP                        -> #ACK,STOP
 *   MON                         -> #ACK,MON  (human-readable 1 Hz printout)
 *   BUS                         -> #BUS,SDA|SCL,<pin>,pd=..,pu=..,<verdict> then #BUS_DONE
 *   REINIT                      -> bus recovery + re-detect sensors, #INFO, #ACK,REINIT
 *   GPSRST HOT|WARM|COLD        -> #ACK,GPSRST,<mode> then #OK|#WARN,GPSCFG
 *   HELP                        -> list of commands
 *
 * Data lines ('$' prefix, comma separated, one per sample):
 *   $IMU,t_ms,ax,ay,az,gx,gy,gz,die_c         m/s^2, rad/s, LSM6DSOX die degC
 *   $MAG,t_ms,mx,my,mz                        uT (LIS3MDL)
 *   $RMG,t_ms,mx,my,mz,fresh                  uT (RM3100), fresh = 1 if a new conversion
 *   $ADX,t_ms,ax,ay,az,temp_c,fresh           m/s^2 (ADXL355), on-chip degC, fresh = new sample
 *   $TMP,t_ms,raw,temp_c,die_c,fresh          TMP117 LSBs (1/128 degC), degC, LSM die degC,
 *                                             fresh = 1 if a new conversion since the last read
 *   $PWR,t_ms,addr,bus_v,shunt_mv,current_ma,power_mw     one line per INA219
 *   $GPS,t_ms,valid,lat,lon,alt_m,sats,fix_type,h_acc_m,v_acc_m,pdop,
 *        fix_age_ms,utc,itow_ms,chars,ubx_frames,ubx_err,link_err
 * Lines starting with '#' are status/acks.
 */
#ifndef HIL_PROTO_H
#define HIL_PROTO_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "imu.h"   /* vec3f_t */
#include "gps.h"   /* gps_fix_t */

#define HIL_FW_VERSION "rev2-hil-1.2"

typedef enum {
  HIL_S_IMU = 0, HIL_S_MAG, HIL_S_TMP, HIL_S_PWR, HIL_S_GPS, HIL_S_RMG, HIL_S_ADX, HIL_S_COUNT
} hil_stream_t;

typedef enum {
  HIL_CMD_NONE = 0,     /* empty line */
  HIL_CMD_PING,
  HIL_CMD_INFO,
  HIL_CMD_SCAN,
  HIL_CMD_START,        /* stream (or -1 = ALL), period_ms (0 = default) */
  HIL_CMD_STOP,
  HIL_CMD_MON,
  HIL_CMD_BUS,
  HIL_CMD_REINIT,
  HIL_CMD_GPSRST,       /* gps_mask */
  HIL_CMD_HELP,
  HIL_CMD_BAD_STREAM,   /* word = the stream name we didn't know */
  HIL_CMD_BAD_ARG,      /* word = the command */
  HIL_CMD_UNKNOWN,      /* word = the command */
} hil_cmd_kind_t;

typedef struct {
  hil_cmd_kind_t kind;
  int            stream;      /* hil_stream_t, or -1 for ALL */
  uint32_t       period_ms;   /* 0 = stream default */
  uint16_t       gps_mask;    /* GPS_START_* */
  const char    *gps_mode;    /* "HOT" / "WARM" / "COLD" */
  char           word[24];
} hil_cmd_t;

extern const char    *const hil_stream_names[HIL_S_COUNT];
extern const uint32_t       hil_stream_default_ms[HIL_S_COUNT];

/* Parses (and upper-cases in place) one command line. */
hil_cmd_t hil_parse(char *line);

/* Data-line formatters. Each writes one line with a trailing '\n' and returns
 * the length snprintf reported (>= size means it was truncated). */
int hil_fmt_imu(char *buf, size_t size, uint32_t t_ms, const vec3f_t *a, const vec3f_t *g,
                float die_c);
int hil_fmt_mag(char *buf, size_t size, uint32_t t_ms, const vec3f_t *m);
int hil_fmt_rmg(char *buf, size_t size, uint32_t t_ms, const vec3f_t *m, bool fresh);
int hil_fmt_adx(char *buf, size_t size, uint32_t t_ms, const vec3f_t *a, float temp_c, bool fresh);
int hil_fmt_tmp(char *buf, size_t size, uint32_t t_ms, bool ok, int16_t raw, float die_c,
                bool fresh);
int hil_fmt_pwr(char *buf, size_t size, uint32_t t_ms, uint8_t addr, float bus_v, float shunt_mv,
                float current_ma, float power_mw);
int hil_fmt_gps(char *buf, size_t size, uint32_t t_ms, const gps_fix_t *fix, uint32_t link_err);

#endif /* HIL_PROTO_H */
