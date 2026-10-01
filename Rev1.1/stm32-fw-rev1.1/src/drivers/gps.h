#ifndef GPS_H
#define GPS_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  bool     location_valid;
  float    lat_deg;
  float    lon_deg;
  float    alt_m;
  int      sats;
  uint32_t chars_processed;
  uint32_t sentences_ok;
} gps_fix_t;

/* Drain the UART ring buffer and parse any complete NMEA sentences.
 * Call often (every loop pass). */
void gps_poll(void);
const gps_fix_t *gps_get(void);

#endif
