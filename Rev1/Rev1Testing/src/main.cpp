// Rev 1 PCB hardware-in-the-loop (HIL) test firmware
// XIAO ESP32-C6 + LSM6DSOX/LIS3MDL + 2x INA219 + PA1010D GPS + TMP36
//
// The board boots IDLE and waits for line-based commands on USB serial
// (115200, '\n'-terminated, case-insensitive):
//
//   PING                 -> #PONG
//   INFO                 -> #INFO,fw=...,lsm=0x6A,lis=0x1C,ina=0x40;0x41,gps_chars=N
//   SCAN                 -> #SCAN,<addr>... then #SCAN_DONE,<count>
//   START <S> [period]   -> #ACK,START,<S>,<period_ms>   S = IMU|MAG|TMP|PWR|GPS|ALL
//   STOP                 -> #ACK,STOP   (stops every stream and monitor mode)
//   MON                  -> #ACK,MON    (old human-readable 1 Hz printout)
//   BUS                  -> #BUS,<pin>,... line-level check of SDA/SCL, then #BUS_DONE
//   HUNT                 -> I2C scan on every free XIAO pin pair, then #HUNT_DONE
//   REINIT               -> restart I2C on the configured pins and re-detect sensors
//   PIN <gpio> LOW|HIGH|IN -> drive/release a free XIAO pin for meter checks (stops I2C)
//
// Data lines (one per sample, comma separated, '$' prefix):
//   $IMU,t_ms,ax,ay,az,gx,gy,gz,die_c       accel m/s^2, gyro rad/s, LSM die temp C
//   $MAG,t_ms,mx,my,mz                      uT
//   $TMP,t_ms,mv,temp_c,die_c               TMP36 mV (16x averaged), C, LSM die temp C
//   $PWR,t_ms,addr,bus_v,shunt_mv,current_ma,power_mw   one line per INA219
//   $GPS,t_ms,valid,lat,lon,alt_m,sats,hdop,fix_age_ms,utc,chars
// Lines starting with '#' are status/acks; anything else can be ignored by the host.

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_LIS3MDL.h>
#include <Adafruit_INA219.h>
#include <TinyGPSPlus.h>
#include "driver/gpio.h"

static const char *FW_VERSION = "rev1-hil-1.5";

// --- GPIO ASSIGNMENTS (Rev1_Schematic.SchDoc, 9/21/2026) ---
// The schematic symbol E1 is the XIAO_ESP32S3 part, so its pin labels are S3
// GPIO names. The board is a XIAO ESP32-C6 (same footprint), so map by XIAO
// pad number / D-name, NOT by the GPIO label on the symbol:
//   pad 1  D0  "GPIO01" -> C6 GPIO0   TMP36 VOUT (also TP1)
//   pad 5  D4  "GPIO05" -> C6 GPIO22  I2C SDA (CS1, CS2, B1)
//   pad 6  D5  "GPIO06" -> C6 GPIO23  I2C SCL
//   pad 8  D7  "GPIO44" -> C6 GPIO17  GPS TX -> MCU RX (also TP2)
//   pad 12 3V3 -> 3.3V_ESP (SW1 selects ESP 3V3 vs. P1 screw terminal)
// GPS RX (PA1010D pin 10) and the PA1010D's own I2C pins are not routed on Rev 1.
static const int  PIN_TMP36_ADC = 0;  // D0 / GPIO0 (ADC1_CH0)
static const int  PIN_I2C_SDA   = 22; // D4 / GPIO22
// SCL is D5 / GPIO23 as designed. Only if D5 and D6 are bridged as a workaround,
// build with REV1_SCL_GPIO 16 instead.
#ifndef REV1_SCL_GPIO
#define REV1_SCL_GPIO 23
#endif
static const int  PIN_I2C_SCL   = REV1_SCL_GPIO; // D5 / GPIO23 (as designed) or D6 / GPIO16 (bridge)
static const int  PIN_SCL_DEAD  = 23;            // left as a high-Z input so it can't fight the bus
static const int  PIN_GPS_RX    = 17; // D7 / GPIO17 <- PA1010D TX (pin 11)
static const int  PIN_GPS_TX    = 19; // D8 / GPIO19 -> not connected on Rev 1 (claimed so UART1 has a TX pin)

// --- I2C address candidates (first one that ACKs wins) ---
static const uint8_t LSM_CANDIDATES[] = {0x6A, 0x6B};
static const uint8_t LIS_CANDIDATES[] = {0x1C, 0x1E};
// Two INA219 breakouts share the bus: CS1 measures the 3.3V_LSM rail (IMU/mag,
// via SW4 with SW2 open) and CS2 the 3.3V_GPS rail (via SW5 with SW3 open).
// Both breakouts default to 0x40, so one needs its A0 jumper bridged (-> 0x41).
static const uint8_t INA_CANDIDATES[] = {0x40, 0x41, 0x44, 0x45}; // all found are used
static const size_t  MAX_INA = sizeof(INA_CANDIDATES);

// --- Hardware Instances ---
Adafruit_LSM6DSOX lsm6ds;
Adafruit_LIS3MDL  lis3mdl;
Adafruit_INA219  *ina[MAX_INA] = {nullptr};
uint8_t           inaAddr[MAX_INA];
size_t            inaCount = 0;
TinyGPSPlus       gps;
HardwareSerial    gpsSerial(1); // Hardware UART1

uint8_t lsmAddr = 0, lisAddr = 0;
bool lsm_ok = false, lis_ok = false;

// --- Streams ---
enum StreamId { S_IMU, S_MAG, S_TMP, S_PWR, S_GPS, S_COUNT };
struct SensorStream {
  const char *name;
  uint32_t defaultPeriod;
  bool on;
  uint32_t period;
  uint32_t last;
};
SensorStream streams[S_COUNT] = {
  {"IMU", 20,   false, 20,   0},  // 50 Hz
  {"MAG", 20,   false, 20,   0},  // 50 Hz
  {"TMP", 100,  false, 100,  0},  // 10 Hz
  {"PWR", 100,  false, 100,  0},  // 10 Hz
  {"GPS", 1000, false, 1000, 0},  // 1 Hz (PA1010D default update rate, 9600 baud)
};

bool monitorMode = false;
uint32_t lastMonitor = 0;
String cmdBuf;

// ----------------------------------------------------------------------------
// ALWAYS start I2C through this. It pins down the two differences from the
// known-good minimal sketch (diag_minimal/), which found all sensors on 10/15:
//  * int pin arguments: on Arduino-ESP32 2.x, Wire.begin(uint8_t, uint8_t, hz)
//    resolves to the SLAVE overload begin(addr, sda, scl), silently killing the bus.
//  * 100 kHz, the speed that worked. Raise I2C_HZ to 400000 only after
//    test_smoke.py passes at 100 kHz.
static const uint32_t I2C_HZ = 100000;
bool i2cMasterBegin(int sda, int scl, uint32_t hz) {
  return Wire.begin(sda, scl, hz);
}

// ----------------------------------------------------------------------------
bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

float readTMP36mV() {
  // Average 16 calibrated ADC reads to knock down ADC noise (~1 ms total)
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(PIN_TMP36_ADC);
  return sum / 16.0f;
}

float tmp36C(float mv) {
  // TMP36: 500 mV offset at 0 C, 10 mV / C
  return (mv - 500.0f) / 10.0f;
}

float lsmDieTempC() {
  if (!lsm_ok) return NAN;
  sensors_event_t a, g, t;
  lsm6ds.getEvent(&a, &g, &t);
  return t.temperature;
}

// ----------------------------------------------------------------------------
void initSensors() {
  lsm_ok = lis_ok = false;
  for (size_t i = 0; i < inaCount; i++) { delete ina[i]; ina[i] = nullptr; }
  inaCount = 0;
  // LSM6DSOX accel/gyro
  for (uint8_t a : LSM_CANDIDATES) {
    if (i2cPresent(a) && lsm6ds.begin_I2C(a, &Wire)) {
      lsmAddr = a;
      lsm_ok = true;
      lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
      lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);
      lsm6ds.setAccelDataRate(LSM6DS_RATE_104_HZ);
      lsm6ds.setGyroDataRate(LSM6DS_RATE_104_HZ);
      break;
    }
  }
  if (lsm_ok) Serial.printf("#OK,LSM6DSOX,0x%02X\n", lsmAddr);
  else        Serial.println("#FAIL,LSM6DSOX");

  // LIS3MDL magnetometer
  for (uint8_t a : LIS_CANDIDATES) {
    if (i2cPresent(a) && lis3mdl.begin_I2C(a, &Wire)) {
      lisAddr = a;
      lis_ok = true;
      lis3mdl.setRange(LIS3MDL_RANGE_4_GAUSS);
      lis3mdl.setPerformanceMode(LIS3MDL_ULTRAHIGHMODE);
      lis3mdl.setDataRate(LIS3MDL_DATARATE_80_HZ);
      lis3mdl.setOperationMode(LIS3MDL_CONTINUOUSMODE);
      break;
    }
  }
  if (lis_ok) Serial.printf("#OK,LIS3MDL,0x%02X\n", lisAddr);
  else        Serial.println("#FAIL,LIS3MDL");

  // INA219 current monitor(s) -- every responding address is used
  for (uint8_t a : INA_CANDIDATES) {
    if (!i2cPresent(a)) continue;
    Adafruit_INA219 *dev = new Adafruit_INA219(a);
    if (dev->begin(&Wire)) {
      // Default calibration = 32 V / 2 A range, assumes a 0.1 ohm shunt.
      ina[inaCount] = dev;
      inaAddr[inaCount] = a;
      inaCount++;
      Serial.printf("#OK,INA219,0x%02X\n", a);
    } else {
      delete dev;
    }
  }
  if (inaCount == 0) Serial.println("#FAIL,INA219");
}

// ----------------------------------------------------------------------------
void emitIMU(uint32_t t) {
  sensors_event_t a, g, tp;
  lsm6ds.getEvent(&a, &g, &tp);
  Serial.printf("$IMU,%lu,%.4f,%.4f,%.4f,%.5f,%.5f,%.5f,%.2f\n", (unsigned long)t,
                a.acceleration.x, a.acceleration.y, a.acceleration.z,
                g.gyro.x, g.gyro.y, g.gyro.z, tp.temperature);
}

void emitMAG(uint32_t t) {
  sensors_event_t m;
  lis3mdl.getEvent(&m);
  Serial.printf("$MAG,%lu,%.3f,%.3f,%.3f\n", (unsigned long)t,
                m.magnetic.x, m.magnetic.y, m.magnetic.z);
}

void emitTMP(uint32_t t) {
  float mv = readTMP36mV();
  Serial.printf("$TMP,%lu,%.1f,%.2f,%.2f\n", (unsigned long)t, mv, tmp36C(mv), lsmDieTempC());
}

void emitPWR(uint32_t t) {
  for (size_t i = 0; i < inaCount; i++) {
    Serial.printf("$PWR,%lu,0x%02X,%.3f,%.3f,%.2f,%.2f\n", (unsigned long)t, inaAddr[i],
                  ina[i]->getBusVoltage_V(), ina[i]->getShuntVoltage_mV(),
                  ina[i]->getCurrent_mA(), ina[i]->getPower_mW());
  }
}

void emitGPS(uint32_t t) {
  bool valid = gps.location.isValid();
  char utc[24] = "";
  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() > 2000) {
    snprintf(utc, sizeof(utc), "%04u-%02u-%02uT%02u:%02u:%02uZ",
             gps.date.year(), gps.date.month(), gps.date.day(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
  }
  Serial.printf("$GPS,%lu,%d,%.7f,%.7f,%.2f,%lu,%.2f,%ld,%s,%lu\n", (unsigned long)t,
                valid ? 1 : 0,
                valid ? gps.location.lat() : NAN,
                valid ? gps.location.lng() : NAN,
                gps.altitude.isValid() ? gps.altitude.meters() : NAN,
                (unsigned long)gps.satellites.value(),
                gps.hdop.isValid() ? gps.hdop.hdop() : NAN,
                valid ? (long)gps.location.age() : -1L,
                utc,
                (unsigned long)gps.charsProcessed());
}

void emitStream(StreamId id, uint32_t t) {
  switch (id) {
    case S_IMU: emitIMU(t); break;
    case S_MAG: emitMAG(t); break;
    case S_TMP: emitTMP(t); break;
    case S_PWR: emitPWR(t); break;
    case S_GPS: emitGPS(t); break;
    default: break;
  }
}

bool streamAvailable(StreamId id) {
  switch (id) {
    case S_IMU: return lsm_ok;
    case S_MAG: return lis_ok;
    case S_PWR: return inaCount > 0;
    default:    return true; // TMP36 (analog) and GPS (UART) can't be probed
  }
}

// ----------------------------------------------------------------------------
// Original human-readable printout, kept for quick bench checks (MON command)
void printMonitor() {
  Serial.println("---------------- SENSOR READINGS ----------------");
  float tempC = tmp36C(readTMP36mV());
  Serial.printf("TMP36 Temp: %.2f C (%.2f F)\n", tempC, tempC * 1.8f + 32.0f);
  if (lsm_ok) {
    sensors_event_t a, g, tp;
    lsm6ds.getEvent(&a, &g, &tp);
    Serial.printf("Accel [m/s^2]: X=%.2f, Y=%.2f, Z=%.2f\n", a.acceleration.x, a.acceleration.y, a.acceleration.z);
    Serial.printf("Gyro  [rad/s]: X=%.2f, Y=%.2f, Z=%.2f\n", g.gyro.x, g.gyro.y, g.gyro.z);
  }
  if (lis_ok) {
    sensors_event_t m;
    lis3mdl.getEvent(&m);
    Serial.printf("Mag    [uT]:   X=%.2f, Y=%.2f, Z=%.2f\n", m.magnetic.x, m.magnetic.y, m.magnetic.z);
  }
  for (size_t i = 0; i < inaCount; i++) {
    Serial.printf("INA219 0x%02X:   %.2f V | %.2f mA | %.2f mW\n", inaAddr[i],
                  ina[i]->getBusVoltage_V(), ina[i]->getCurrent_mA(), ina[i]->getPower_mW());
  }
  Serial.print("GPS:           ");
  if (gps.location.isValid()) {
    Serial.printf("Lat: %.6f, Lon: %.6f | Alt: %.1fm | Sats: %lu\n",
                  gps.location.lat(), gps.location.lng(), gps.altitude.meters(),
                  (unsigned long)gps.satellites.value());
  } else {
    Serial.printf("Searching... (chars: %lu, sats: %lu)\n",
                  (unsigned long)gps.charsProcessed(), (unsigned long)gps.satellites.value());
  }
  Serial.println();
}

// ----------------------------------------------------------------------------
void printInfo() {
  Serial.printf("#INFO,fw=%s,lsm=", FW_VERSION);
  if (lsm_ok) Serial.printf("0x%02X", lsmAddr); else Serial.print("none");
  Serial.print(",lis=");
  if (lis_ok) Serial.printf("0x%02X", lisAddr); else Serial.print("none");
  Serial.print(",ina=");
  if (inaCount == 0) Serial.print("none");
  for (size_t i = 0; i < inaCount; i++) Serial.printf("%s0x%02X", i ? ";" : "", inaAddr[i]);
  Serial.printf(",gps_chars=%lu,gps_fail_cs=%lu\n",
                (unsigned long)gps.charsProcessed(), (unsigned long)gps.failedChecksum());
}


// ----------------------------------------------------------------------------
// I2C bring-up diagnostics
// Free XIAO pads on the C6 (GPIO0 = TMP36 and GPIO17 = GPS RX are left alone):
//   D1=1 D2=2 D3=21 D4=22 D5=23 D6=16 D9=20 D10=18
static const int HUNT_PINS[] = {1, 2, 21, 22, 23, 16, 20, 18}; // GPIO19 = dummy GPS TX

// pd = level with the internal pull-DOWN on: 1 means an external pull-up is present.
// pu = level with the internal pull-UP on:   0 means something is holding the line low.
void lineState(int pin, int &pd, int &pu) {
  // ESP-IDF calls on purpose: Arduino's pinMode() can be ignored for a pin the
  // peripheral manager still assigns to I2C/UART, which would fake a result.
  gpio_num_t g = (gpio_num_t)pin;
  gpio_reset_pin(g);
  gpio_set_direction(g, GPIO_MODE_INPUT);
  gpio_set_pull_mode(g, GPIO_PULLDOWN_ONLY); delay(3); pd = gpio_get_level(g);
  gpio_set_pull_mode(g, GPIO_PULLUP_ONLY);   delay(3); pu = gpio_get_level(g);
  gpio_set_pull_mode(g, GPIO_FLOATING);
}

const char *lineVerdict(int pd, int pu) {
  if (pu == 0) return "HELD_LOW";        // shorted to GND or a device clamping it
  if (pd == 1) return "PULLED_UP";       // healthy idle I2C line
  return "FLOATING";                     // no external pull-up / not connected
}

void busCheck() {
  Wire.end();
  int pd, pu;
  lineState(PIN_I2C_SDA, pd, pu);
  Serial.printf("#BUS,SDA,GPIO%d,pd=%d,pu=%d,%s\n", PIN_I2C_SDA, pd, pu, lineVerdict(pd, pu));
  lineState(PIN_I2C_SCL, pd, pu);
  Serial.printf("#BUS,SCL,GPIO%d,pd=%d,pu=%d,%s\n", PIN_I2C_SCL, pd, pu, lineVerdict(pd, pu));
  // Every free pad too: a pulled-up pad that isn't D4/D5 is a routing clue
  for (int p : HUNT_PINS) {
    if (p == PIN_I2C_SDA || p == PIN_I2C_SCL) continue;
    lineState(p, pd, pu);
    if (pd == 1 || pu == 0) Serial.printf("#BUS,OTHER,GPIO%d,pd=%d,pu=%d,%s\n", p, pd, pu, lineVerdict(pd, pu));
  }
  i2cMasterBegin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_HZ);
  Serial.println("#BUS_DONE");
}

void i2cHunt() {
  // Only pins with an external pull-up can be a real I2C line, so test those pairs.
  int cand[sizeof(HUNT_PINS) / sizeof(HUNT_PINS[0])];
  size_t n = 0;
  Wire.end();
  for (int p : HUNT_PINS) {
    int pd, pu;
    lineState(p, pd, pu);
    if (pd == 1) cand[n++] = p;
  }
  Serial.printf("#HUNT,pulled_up_pins=%u\n", (unsigned)n);
  int hits = 0;
  for (size_t i = 0; i < n; i++) {
    for (size_t j = 0; j < n; j++) {
      if (i == j) continue;
      Wire.end();
      i2cMasterBegin(cand[i], cand[j], 100000);
      Wire.setTimeOut(5);
      String found;
      for (uint8_t a = 0x08; a < 0x78; a++) {
        if (i2cPresent(a)) { char b[6]; snprintf(b, sizeof(b), ",0x%02X", a); found += b; }
      }
      if (found.length()) {
        Serial.printf("#HUNT,SDA=GPIO%d,SCL=GPIO%d%s\n", cand[i], cand[j], found.c_str());
        hits++;
      }
    }
  }
  Wire.end();
  i2cMasterBegin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_HZ);
  Serial.printf("#HUNT_DONE,%d\n", hits);
}

void i2cScan() {
  int n = 0;
  Serial.print("#SCAN");
  for (uint8_t a = 0x08; a < 0x78; a++) {
    if (i2cPresent(a)) { Serial.printf(",0x%02X", a); n++; }
  }
  Serial.println();
  Serial.printf("#SCAN_DONE,%d\n", n);
}

int streamIndex(const String &name) {
  for (int i = 0; i < S_COUNT; i++) if (name == streams[i].name) return i;
  return -1;
}

void startStream(int i, long period) {
  if (!streamAvailable((StreamId)i)) {
    Serial.printf("#ERR,NOSENSOR,%s\n", streams[i].name);
    return;
  }
  streams[i].period = period > 0 ? (uint32_t)period : streams[i].defaultPeriod;
  if (streams[i].period < 5) streams[i].period = 5;
  streams[i].last = millis() - streams[i].period; // fire on next loop
  streams[i].on = true;
  Serial.printf("#ACK,START,%s,%lu\n", streams[i].name, (unsigned long)streams[i].period);
}

void handleCommand(String line) {
  line.trim();
  line.toUpperCase();
  if (line.length() == 0) return;

  int sp = line.indexOf(' ');
  String cmd  = sp < 0 ? line : line.substring(0, sp);
  String args = sp < 0 ? String("") : line.substring(sp + 1);
  args.trim();

  if (cmd == "PING") {
    Serial.println("#PONG");
  } else if (cmd == "INFO") {
    printInfo();
  } else if (cmd == "BUS") {
    busCheck();
  } else if (cmd == "HUNT") {
    i2cHunt();
  } else if (cmd == "REINIT") {
    for (auto &st : streams) st.on = false;
    Wire.end();
    i2cMasterBegin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_HZ);
    initSensors();
    printInfo();
    Serial.println("#ACK,REINIT");
  } else if (cmd == "PIN") {
    int sp2 = args.indexOf(' ');
    long pin = args.substring(0, sp2).toInt();
    String mode = sp2 < 0 ? String("") : args.substring(sp2 + 1);
    bool allowed = false;
    for (int p : HUNT_PINS) if (p == pin) allowed = true;
    if (!allowed || sp2 < 0) {
      Serial.println("#ERR,PIN,use PIN <gpio> LOW|HIGH|IN with a free XIAO pin");
    } else {
      Wire.end();
      for (auto &st : streams) st.on = false;
      gpio_num_t g = (gpio_num_t)pin;
      gpio_reset_pin(g);
      if (mode == "LOW" || mode == "HIGH") {
        gpio_set_direction(g, GPIO_MODE_INPUT_OUTPUT);   // drive AND read the pad back
        gpio_set_level(g, mode == "HIGH" ? 1 : 0);
      } else {
        gpio_set_direction(g, GPIO_MODE_INPUT);
        gpio_set_pull_mode(g, GPIO_FLOATING);
      }
      delay(5);
      Serial.printf("#ACK,PIN,GPIO%ld,%s,pad_reads=%d (I2C stopped; send REINIT to restore)\n",
                    pin, mode.c_str(), gpio_get_level(g));
    }
  } else if (cmd == "SCAN") {
    i2cScan();
  } else if (cmd == "STOP") {
    for (auto &s : streams) s.on = false;
    monitorMode = false;
    Serial.println("#ACK,STOP");
  } else if (cmd == "MON") {
    monitorMode = true;
    Serial.println("#ACK,MON");
  } else if (cmd == "START") {
    int sp2 = args.indexOf(' ');
    String name = sp2 < 0 ? args : args.substring(0, sp2);
    long period = sp2 < 0 ? 0 : args.substring(sp2 + 1).toInt();
    if (name == "ALL") {
      for (int i = 0; i < S_COUNT; i++) if (streamAvailable((StreamId)i)) startStream(i, period);
    } else {
      int i = streamIndex(name);
      if (i < 0) Serial.printf("#ERR,BADSTREAM,%s\n", name.c_str());
      else startStream(i, period);
    }
  } else {
    Serial.printf("#ERR,UNKNOWN,%s\n", cmd.c_str());
  }
}

void pollCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdBuf.length()) handleCommand(cmdBuf);
      cmdBuf = "";
    } else if (cmdBuf.length() < 64) {
      cmdBuf += c;
    }
  }
}

// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  unsigned long start = millis();
  while (!Serial && (millis() - start < 3000));

  Serial.printf("\n#BOOT,%s\n", FW_VERSION);

  analogSetPinAttenuation(PIN_TMP36_ADC, ADC_11db);
  if (PIN_I2C_SCL != PIN_SCL_DEAD) pinMode(PIN_SCL_DEAD, INPUT);
  i2cMasterBegin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_HZ);
  Serial.printf("#I2C,SDA=GPIO%d,SCL=GPIO%d\n", PIN_I2C_SDA, PIN_I2C_SCL);
  initSensors();
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println("#OK,GPS_UART,9600");
  printInfo();
  Serial.println("#READY");
}

void loop() {
  // Keep NMEA flowing into the parser so no sentences are dropped
  while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());

  pollCommands();

  uint32_t now = millis();
  for (int i = 0; i < S_COUNT; i++) {
    SensorStream &s = streams[i];
    if (!s.on || (now - s.last) < s.period) continue;
    // Hold a steady cadence, but don't try to "catch up" after a long stall
    s.last = (now - s.last > 5 * s.period) ? now : s.last + s.period;
    emitStream((StreamId)i, now);
  }

  if (monitorMode && now - lastMonitor >= 1000) {
    lastMonitor = now;
    printMonitor();
  }
}