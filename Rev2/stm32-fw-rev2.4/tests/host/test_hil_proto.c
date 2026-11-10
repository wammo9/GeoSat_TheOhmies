/*
 * Host unit test for src/app/hil_proto.c (command parser + data-line formats).
 *
 *   cc -std=c11 -Wall -Wextra -I../../src/app -I../../src/drivers \
 *      test_hil_proto.c ../../src/app/hil_proto.c -lm -o test_hil_proto
 *   ./test_hil_proto > lines.txt && python3 check_lines.py lines.txt
 *
 * The C side checks the parser; the sample data lines it prints are checked
 * against the Python FIELDS table in hil/common.py by check_lines.py.
 */
#include "hil_proto.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static hil_cmd_t parse(const char *s)
{
  static char buf[80];
  strncpy(buf, s, sizeof buf - 1);
  return hil_parse(buf);
}

int main(void)
{
  hil_cmd_t c;
  c = parse("");                assert(c.kind == HIL_CMD_NONE);
  c = parse("   ");             assert(c.kind == HIL_CMD_NONE);
  c = parse("ping");            assert(c.kind == HIL_CMD_PING);
  c = parse(" Info ");          assert(c.kind == HIL_CMD_INFO);
  c = parse("start imu");       assert(c.kind == HIL_CMD_START && c.stream == HIL_S_IMU && c.period_ms == 0);
  c = parse("START GPS 1000");  assert(c.kind == HIL_CMD_START && c.stream == HIL_S_GPS && c.period_ms == 1000);
  c = parse("START  TMP\t250"); assert(c.kind == HIL_CMD_START && c.stream == HIL_S_TMP && c.period_ms == 250);
  c = parse("start rmg 50");    assert(c.kind == HIL_CMD_START && c.stream == HIL_S_RMG && c.period_ms == 50);
  c = parse("START ADX 8");     assert(c.kind == HIL_CMD_START && c.stream == HIL_S_ADX && c.period_ms == 8);
  c = parse("START ALL");       assert(c.kind == HIL_CMD_START && c.stream == -1);
  c = parse("START PWR 1");     assert(c.kind == HIL_CMD_START && c.period_ms == 5);
  c = parse("START PWR 0");     assert(c.kind == HIL_CMD_START && c.period_ms == 0);
  c = parse("START FOO");       assert(c.kind == HIL_CMD_BAD_STREAM && strcmp(c.word, "FOO") == 0);
  c = parse("START");           assert(c.kind == HIL_CMD_BAD_ARG);
  c = parse("START IMU 12x");   assert(c.kind == HIL_CMD_BAD_ARG);
  c = parse("START IMU -5");    assert(c.kind == HIL_CMD_BAD_ARG);
  c = parse("stop");            assert(c.kind == HIL_CMD_STOP);
  c = parse("gpsrst cold");     assert(c.kind == HIL_CMD_GPSRST && c.gps_mask == GPS_START_COLD && strcmp(c.gps_mode, "COLD") == 0);
  c = parse("GPSRST WARM");     assert(c.kind == HIL_CMD_GPSRST && c.gps_mask == GPS_START_WARM);
  c = parse("GPSRST HOT");      assert(c.kind == HIL_CMD_GPSRST && c.gps_mask == GPS_START_HOT);
  c = parse("GPSRST");          assert(c.kind == HIL_CMD_BAD_ARG);
  c = parse("GPSRST LUKEWARM"); assert(c.kind == HIL_CMD_BAD_ARG);
  c = parse("frobnicate now");  assert(c.kind == HIL_CMD_UNKNOWN && strcmp(c.word, "FROBNICATE") == 0);
  c = parse("averyveryverylongcommandnamethatoverflows");
  assert(c.kind == HIL_CMD_UNKNOWN && strlen(c.word) == sizeof(c.word) - 1);
  c = parse("BUS");    assert(c.kind == HIL_CMD_BUS);
  c = parse("REINIT"); assert(c.kind == HIL_CMD_REINIT);
  c = parse("MON");    assert(c.kind == HIL_CMD_MON);
  c = parse("SCAN");   assert(c.kind == HIL_CMD_SCAN);
  c = parse("help");   assert(c.kind == HIL_CMD_HELP);

  /* sample data lines for check_lines.py */
  char b[192];
  vec3f_t a = { 0.1234f, -0.05f, 9.8066f }, g = { 0.00123f, -0.0045f, 0.0f }, m = { 21.5f, -4.25f, 47.0f };
  hil_fmt_imu(b, sizeof b, 123456, &a, &g, 29.5f);                    fputs(b, stdout);
  hil_fmt_mag(b, sizeof b, 123457, &m);                               fputs(b, stdout);
  vec3f_t r = { 21.5067f, -4.2533f, 47.0133f };
  hil_fmt_rmg(b, sizeof b, 123457, &r, true);                         fputs(b, stdout);
  vec3f_t x = { 0.000123f, -0.002345f, 9.806650f };
  hil_fmt_adx(b, sizeof b, 123457, &x, 24.61f, false);                fputs(b, stdout);
  hil_fmt_tmp(b, sizeof b, 123458, true, 2993, 27.5f, true);          fputs(b, stdout);   /* 23.3828 C */
  hil_fmt_tmp(b, sizeof b, 123459, true, -1280, NAN, false);          fputs(b, stdout);   /* -10 C, no LSM */
  hil_fmt_tmp(b, sizeof b, 123460, false, 0, 27.5f, false);           fputs(b, stdout);
  hil_fmt_pwr(b, sizeof b, 123461, 0x41, 3.296f, 3.12f, 31.2f, 102.0f); fputs(b, stdout);

  gps_fix_t f;
  memset(&f, 0, sizeof f);
  f.chars_processed = 812; f.ubx_frames = 3;
  hil_fmt_gps(b, sizeof b, 2000, &f, 0);                              fputs(b, stdout);   /* nothing yet */
  f.from_pvt = true; f.fix_type = 0; f.h_acc_m = 4294967.0f; f.v_acc_m = 3750000.0f; f.pdop = 99.99f;
  f.update_ms = 2900; f.itow_ms = 345600000;
  hil_fmt_gps(b, sizeof b, 3000, &f, 1);                              fputs(b, stdout);   /* PVT, no fix */
  f.location_valid = true; f.fix_type = 3; f.sats = 14; f.lat_deg = 40.0071234; f.lon_deg = -105.2634567;
  f.alt_m = 1655.4f; f.h_acc_m = 1.25f; f.v_acc_m = 2.1f; f.pdop = 1.31f; f.time_valid = true;
  f.year = 2026; f.month = 10; f.day = 29; f.hour = 16; f.min = 5; f.sec = 9; f.update_ms = 9800; f.itow_ms = 345609000;
  hil_fmt_gps(b, sizeof b, 10000, &f, 0);                             fputs(b, stdout);   /* 3D fix */

  fprintf(stderr, "parser: all assertions passed\n");
  return 0;
}
