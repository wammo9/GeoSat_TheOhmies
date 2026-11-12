#ifndef GPS_H
#define GPS_H

#include <stdbool.h>
#include <stdint.h>

/*
 * u-blox SAM-M10Q GPS driver.
 *
 * Position comes from UBX-NAV-PVT (enabled by gps_setup). NMEA GGA/RMC stay on
 * as a fallback and for reading the raw stream on a terminal.
 */
typedef struct {
  bool     location_valid;   /* 3D/2D fix with gnssFixOK, or NMEA fix if no PVT yet */
  bool     from_pvt;         /* true: values below came from UBX-NAV-PVT */
  double   lat_deg;          /* double: float only resolves ~0.5 m at these values */
  double   lon_deg;
  float    alt_m;            /* above mean sea level */
  int      sats;             /* satellites used in the fix */

  /* Only filled from UBX-NAV-PVT */
  uint8_t  fix_type;         /* 0 none, 2 2D, 3 3D, 5 time only */
  float    h_acc_m;          /* receiver's horizontal accuracy estimate (1 sigma) */
  float    v_acc_m;
  float    pdop;
  bool     time_valid;       /* UTC date and time fully resolved */
  uint16_t year;
  uint8_t  month, day, hour, min, sec;

  /* Stream statistics */
  uint32_t chars_processed;
  uint32_t sentences_ok;     /* NMEA sentences parsed */
  uint32_t ubx_frames;       /* good UBX frames */
  uint32_t ubx_errors;       /* bad checksum / oversized UBX frames */
} gps_fix_t;

/* Configure the module over UART (RAM layer, redone every boot):
 *   NAV-PVT on, GGA + RMC on, GLL/GSA/GSV/VTG off.
 * Waits up to timeout_ms for the UBX ACK. Returns true if the module ACKed. */
bool gps_setup(uint32_t timeout_ms);

/* Drain the UART ring buffer and parse NMEA + UBX. Call every loop pass. */
void gps_poll(void);
const gps_fix_t *gps_get(void);

#endif
