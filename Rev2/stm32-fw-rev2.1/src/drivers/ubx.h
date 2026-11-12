/*
 * ubx.h - u-blox UBX binary protocol: frame building and a byte-wise parser.
 *
 * Pure protocol code (no hardware access), so it can be unit-tested on a PC.
 *
 * Frame: 0xB5 0x62 | class | id | len (LE16) | payload | CK_A CK_B
 * Checksum: 8-bit Fletcher over class, id, len and payload.
 */
#ifndef UBX_H
#define UBX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define UBX_SYNC1          0xB5U
#define UBX_SYNC2          0x62U

#define UBX_CLASS_NAV      0x01U
#define UBX_CLASS_ACK      0x05U
#define UBX_CLASS_CFG      0x06U

#define UBX_ID_NAV_PVT     0x07U
#define UBX_ID_ACK_NAK     0x00U
#define UBX_ID_ACK_ACK     0x01U
#define UBX_ID_CFG_VALSET  0x8AU

#define UBX_NAV_PVT_LEN    92U

/* Largest payload we keep. NAV-PVT (92 B) is the biggest message we use;
 * anything longer is skipped, not buffered. */
#define UBX_MAX_PAYLOAD    100U

/* CFG-VALSET layers */
#define UBX_LAYER_RAM      0x01U
#define UBX_LAYER_BBR      0x02U   /* battery-backed RAM: survives power-off while V_BCKP is up */
#define UBX_LAYER_FLASH    0x04U   /* SAM-M10Q has no flash; don't use */

/* Configuration keys used here (u-blox M10 interface description).
 * The 0x2xxxxxxx prefix means a 1-byte value. */
#define UBX_KEY_MSGOUT_UBX_NAV_PVT_UART1  0x20910007UL
#define UBX_KEY_MSGOUT_NMEA_GGA_UART1     0x209100BBUL
#define UBX_KEY_MSGOUT_NMEA_GLL_UART1     0x209100CAUL
#define UBX_KEY_MSGOUT_NMEA_GSA_UART1     0x209100C0UL
#define UBX_KEY_MSGOUT_NMEA_GSV_UART1     0x209100C5UL
#define UBX_KEY_MSGOUT_NMEA_RMC_UART1     0x209100ACUL
#define UBX_KEY_MSGOUT_NMEA_VTG_UART1     0x209100B1UL

#define UBX_KEY_MSGOUT_UBX_NAV_PVT_I2C    0x20910006UL
#define UBX_KEY_MSGOUT_NMEA_GGA_I2C       0x209100BAUL
#define UBX_KEY_MSGOUT_NMEA_GLL_I2C       0x209100C9UL
#define UBX_KEY_MSGOUT_NMEA_GSA_I2C       0x209100BFUL
#define UBX_KEY_MSGOUT_NMEA_GSV_I2C       0x209100C4UL
#define UBX_KEY_MSGOUT_NMEA_RMC_I2C       0x209100ABUL
#define UBX_KEY_MSGOUT_NMEA_VTG_I2C       0x209100B0UL

typedef struct {
  uint32_t key;
  uint8_t  value;   /* only 1-byte (U1/L) keys are needed so far */
} ubx_cfg_u1_t;

/* Decoded UBX-NAV-PVT (only the fields we use). */
typedef struct {
  uint32_t itow_ms;
  uint16_t year;
  uint8_t  month, day, hour, min, sec;
  uint8_t  valid;        /* bit0 validDate, bit1 validTime, bit2 fullyResolved */
  uint8_t  fix_type;     /* 0 none, 1 DR, 2 2D, 3 3D, 4 GNSS+DR, 5 time only */
  uint8_t  flags;        /* bit0 gnssFixOK */
  uint8_t  num_sv;
  int32_t  lon_e7;       /* deg * 1e7 */
  int32_t  lat_e7;       /* deg * 1e7 */
  int32_t  height_mm;    /* above ellipsoid */
  int32_t  hmsl_mm;      /* above mean sea level */
  uint32_t h_acc_mm;     /* horizontal accuracy estimate */
  uint32_t v_acc_mm;     /* vertical accuracy estimate */
  uint16_t pdop_e2;      /* position DOP * 100 */
} ubx_nav_pvt_t;

/* ---- Frame building ---- */

/* Fletcher checksum over buf[0..len). */
void ubx_checksum(const uint8_t *buf, size_t len, uint8_t *ck_a, uint8_t *ck_b);

/* Build a complete frame into out. Returns frame length, or 0 if out_size is too small. */
size_t ubx_build(uint8_t cls, uint8_t id, const uint8_t *payload, uint16_t len,
                 uint8_t *out, size_t out_size);

/* Build a CFG-VALSET frame setting n 1-byte keys in the given layer(s). */
size_t ubx_build_valset_u1(uint8_t layers, const ubx_cfg_u1_t *items, size_t n,
                           uint8_t *out, size_t out_size);

/* ---- Parsing ---- */

typedef enum {
  UBX_PARSE_BUSY = 0,    /* byte consumed, frame not finished */
  UBX_PARSE_FRAME,       /* complete frame with good checksum */
  UBX_PARSE_ERROR,       /* bad checksum or oversized frame; parser has reset */
} ubx_parse_result_t;

typedef struct {
  uint8_t  state;
  uint8_t  cls, id;
  uint16_t len, idx;
  uint8_t  ck_a, ck_b;
  bool     store;        /* false: payload too large, skip it */
  uint8_t  payload[UBX_MAX_PAYLOAD];
} ubx_parser_t;

void ubx_parser_reset(ubx_parser_t *p);
bool ubx_parser_active(const ubx_parser_t *p);   /* true while inside a frame */

/* Feed one byte. The first byte must be UBX_SYNC1 to start a frame. */
ubx_parse_result_t ubx_parser_feed(ubx_parser_t *p, uint8_t c);

/* Decode a NAV-PVT payload. Returns false if len is wrong. */
bool ubx_decode_nav_pvt(const uint8_t *payload, uint16_t len, ubx_nav_pvt_t *out);

#endif /* UBX_H */
