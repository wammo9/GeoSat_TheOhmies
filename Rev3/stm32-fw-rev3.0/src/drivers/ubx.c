/*
 * ubx.c - u-blox UBX binary protocol (see ubx.h).
 */
#include "ubx.h"
#include <string.h>

enum {
  ST_SYNC1 = 0,
  ST_SYNC2,
  ST_CLASS,
  ST_ID,
  ST_LEN1,
  ST_LEN2,
  ST_PAYLOAD,
  ST_CK_A,
  ST_CK_B,
};

void ubx_checksum(const uint8_t *buf, size_t len, uint8_t *ck_a, uint8_t *ck_b)
{
  uint8_t a = 0, b = 0;
  for (size_t i = 0; i < len; i++) {
    a = (uint8_t)(a + buf[i]);
    b = (uint8_t)(b + a);
  }
  *ck_a = a;
  *ck_b = b;
}

size_t ubx_build(uint8_t cls, uint8_t id, const uint8_t *payload, uint16_t len,
                 uint8_t *out, size_t out_size)
{
  size_t total = (size_t)len + 8U;
  if (out_size < total) {
    return 0;
  }
  out[0] = UBX_SYNC1;
  out[1] = UBX_SYNC2;
  out[2] = cls;
  out[3] = id;
  out[4] = (uint8_t)(len & 0xFFU);
  out[5] = (uint8_t)(len >> 8);
  if (len > 0U) {
    memcpy(&out[6], payload, len);
  }
  ubx_checksum(&out[2], (size_t)len + 4U, &out[6 + len], &out[7 + len]);
  return total;
}

size_t ubx_build_valset_u1(uint8_t layers, const ubx_cfg_u1_t *items, size_t n,
                           uint8_t *out, size_t out_size)
{
  /* payload: version(1) layers(1) reserved(2) then {key LE32, value U1} * n */
  uint8_t payload[4U + 5U * 16U];
  if (n > 16U) {
    return 0;
  }
  payload[0] = 0x00;   /* version 0: no transaction */
  payload[1] = layers;
  payload[2] = 0x00;
  payload[3] = 0x00;
  size_t k = 4;
  for (size_t i = 0; i < n; i++) {
    payload[k++] = (uint8_t)(items[i].key);
    payload[k++] = (uint8_t)(items[i].key >> 8);
    payload[k++] = (uint8_t)(items[i].key >> 16);
    payload[k++] = (uint8_t)(items[i].key >> 24);
    payload[k++] = items[i].value;
  }
  return ubx_build(UBX_CLASS_CFG, UBX_ID_CFG_VALSET, payload, (uint16_t)k, out, out_size);
}

void ubx_parser_reset(ubx_parser_t *p)
{
  p->state = ST_SYNC1;
}

bool ubx_parser_active(const ubx_parser_t *p)
{
  return p->state != ST_SYNC1;
}

static void ck_add(ubx_parser_t *p, uint8_t c)
{
  p->ck_a = (uint8_t)(p->ck_a + c);
  p->ck_b = (uint8_t)(p->ck_b + p->ck_a);
}

ubx_parse_result_t ubx_parser_feed(ubx_parser_t *p, uint8_t c)
{
  switch (p->state) {
    case ST_SYNC1:
      if (c == UBX_SYNC1) {
        p->state = ST_SYNC2;
      }
      return UBX_PARSE_BUSY;

    case ST_SYNC2:
      if (c == UBX_SYNC2) {
        p->state = ST_CLASS;
        p->ck_a = 0;
        p->ck_b = 0;
        return UBX_PARSE_BUSY;
      }
      if (c == UBX_SYNC1) {       /* B5 B5 62...: stay synced on the second B5 */
        return UBX_PARSE_BUSY;
      }
      p->state = ST_SYNC1;
      return UBX_PARSE_ERROR;

    case ST_CLASS:
      p->cls = c;
      ck_add(p, c);
      p->state = ST_ID;
      return UBX_PARSE_BUSY;

    case ST_ID:
      p->id = c;
      ck_add(p, c);
      p->state = ST_LEN1;
      return UBX_PARSE_BUSY;

    case ST_LEN1:
      p->len = c;
      ck_add(p, c);
      p->state = ST_LEN2;
      return UBX_PARSE_BUSY;

    case ST_LEN2:
      p->len |= (uint16_t)((uint16_t)c << 8);
      ck_add(p, c);
      p->idx = 0;
      p->store = (p->len <= UBX_MAX_PAYLOAD);
      p->state = (p->len == 0U) ? ST_CK_A : ST_PAYLOAD;
      return UBX_PARSE_BUSY;

    case ST_PAYLOAD:
      if (p->store) {
        p->payload[p->idx] = c;
      }
      ck_add(p, c);
      if (++p->idx >= p->len) {
        p->state = ST_CK_A;
      }
      return UBX_PARSE_BUSY;

    case ST_CK_A:
      if (c != p->ck_a) {
        p->state = ST_SYNC1;
        return UBX_PARSE_ERROR;
      }
      p->state = ST_CK_B;
      return UBX_PARSE_BUSY;

    case ST_CK_B:
      p->state = ST_SYNC1;
      if (c != p->ck_b) {
        return UBX_PARSE_ERROR;
      }
      /* Good checksum. An oversized frame is still "skipped", so report error. */
      return p->store ? UBX_PARSE_FRAME : UBX_PARSE_ERROR;

    default:
      p->state = ST_SYNC1;
      return UBX_PARSE_ERROR;
  }
}

static uint16_t rd_u16(const uint8_t *b) { return (uint16_t)(b[0] | (b[1] << 8)); }
static uint32_t rd_u32(const uint8_t *b)
{
  return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

bool ubx_decode_nav_pvt(const uint8_t *b, uint16_t len, ubx_nav_pvt_t *o)
{
  if (len != UBX_NAV_PVT_LEN) {
    return false;
  }
  o->itow_ms   = rd_u32(&b[0]);
  o->year      = rd_u16(&b[4]);
  o->month     = b[6];
  o->day       = b[7];
  o->hour      = b[8];
  o->min       = b[9];
  o->sec       = b[10];
  o->valid     = b[11];
  o->fix_type  = b[20];
  o->flags     = b[21];
  o->num_sv    = b[23];
  o->lon_e7    = (int32_t)rd_u32(&b[24]);
  o->lat_e7    = (int32_t)rd_u32(&b[28]);
  o->height_mm = (int32_t)rd_u32(&b[32]);
  o->hmsl_mm   = (int32_t)rd_u32(&b[36]);
  o->h_acc_mm  = rd_u32(&b[40]);
  o->v_acc_mm  = rd_u32(&b[44]);
  o->pdop_e2   = rd_u16(&b[76]);
  return true;
}
