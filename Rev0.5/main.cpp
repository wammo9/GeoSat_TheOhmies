#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_LIS3MDL.h>
#include <Adafruit_INA219.h>
#include <TinyGPSPlus.h>

// --- GPIO ASSIGNMENTS ---
static const uint8_t PIN_TMP36_ADC = 0;  // A0 / GPIO0
static const uint8_t PIN_I2C_SDA   = 22; // D4 / GPIO22
static const uint8_t PIN_I2C_SCL   = 23; // D5 / GPIO23
static const uint8_t PIN_GPS_RX    = 2;  // D2 / GPIO2 (connects to XA1110 TX)
static const uint8_t PIN_GPS_TX    = 1;  // D1 / GPIO1 (connects to XA1110 RX)
// --- Hardware Instances ---
Adafruit_LSM6DSOX lsm6ds;
Adafruit_LIS3MDL  lis3mdl;
Adafruit_INA219   ina219;
TinyGPSPlus       gps;
HardwareSerial    gpsSerial(1); // Hardware UART1

// Status flags
bool lsm_ok = false;
bool lis_ok = false;
bool ina_ok = false;

// Non-blocking timer
unsigned long lastPrintTime = 0;
const unsigned long PRINT_INTERVAL_MS = 1000;

float readTMP36TemperatureC() {
  // Read analog value in millivolts using the ESP32 calibrated ADC API
  uint32_t mv = analogReadMilliVolts(PIN_TMP36_ADC);
  // TMP36 specification: 500 mV offset at 0°C, 10 mV / °C
  return ((float)mv - 500.0f) / 10.0f;
}

void setup() {
  Serial.begin(115200);
  
  // Wait up to 3 seconds for USB Serial Monitor to open
  unsigned long start = millis();
  while (!Serial && (millis() - start < 3000));

  Serial.println("\n=== XIAO ESP32-C6 Multi-Sensor Initialization ===");

  // 1. Initialize ADC for TMP36
  analogSetPinAttenuation(PIN_TMP36_ADC, ADC_11db);

  // 2. Initialize I2C Bus
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000); // 400kHz Fast Mode

  // 3. Initialize LSM6DSOX (Default address: 0x6A)
  if (lsm6ds.begin_I2C(0x6A, &Wire)) {
    Serial.println("[OK] LSM6DSOX initialized.");
    lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
    lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_500_DPS);
    lsm_ok = true;
  } else {
    Serial.println("[FAIL] LSM6DSOX not detected at 0x6A!");
  }

  // 4. Initialize LIS3MDL (Default address: 0x1C)
  if (lis3mdl.begin_I2C(0x1E, &Wire)) {
    Serial.println("[OK] LIS3MDL initialized.");
    lis3mdl.setRange(LIS3MDL_RANGE_4_GAUSS);
    lis3mdl.setOperationMode(LIS3MDL_CONTINUOUSMODE);
    lis_ok = true;
  } else {
    Serial.println("[FAIL] LIS3MDL not detected at 0x1C!");
  }

  // 5. Initialize INA219 (Default address: 0x40)
  if (ina219.begin(&Wire)) {
    Serial.println("[OK] INA219 initialized.");
    ina_ok = true;
  } else {
    Serial.println("[FAIL] INA219 not detected at 0x40!");
  }

  // 6. Initialize Hardware UART for GPS (Default baud: 9600)
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println("[OK] GPS Serial listening on D2.");
  Serial.println("==================================================\n");
}

void loop() {
  // Feed incoming GPS stream continuously to avoid dropping NMEA sentences
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Periodic sensor read and display
  if (millis() - lastPrintTime >= PRINT_INTERVAL_MS) {
    lastPrintTime = millis();

    Serial.println("---------------- SENSOR READINGS ----------------");

    // TMP36
    float tempC = readTMP36TemperatureC();
    Serial.printf("TMP36 Temp: %.2f °C (%.2f °F)\n", tempC, (tempC * 1.8f) + 32.0f);

    // LSM6DSOX IMU
    if (lsm_ok) {
      sensors_event_t accel, gyro, temp;
      lsm6ds.getEvent(&accel, &gyro, &temp);
      Serial.printf("Accel [m/s^2]: X=%.2f, Y=%.2f, Z=%.2f\n", accel.acceleration.x, accel.acceleration.y, accel.acceleration.z);
      Serial.printf("Gyro  [rad/s]: X=%.2f, Y=%.2f, Z=%.2f\n", gyro.gyro.x, gyro.gyro.y, gyro.gyro.z);
    }

    // LIS3MDL Magnetometer
    if (lis_ok) {
      sensors_event_t mag;
      lis3mdl.getEvent(&mag);
      Serial.printf("Mag    [uT]:   X=%.2f, Y=%.2f, Z=%.2f\n", mag.magnetic.x, mag.magnetic.y, mag.magnetic.z);
    }

    // INA219 Power Monitor
    if (ina_ok) {
      float busVoltage_V = ina219.getBusVoltage_V();
      float current_mA   = ina219.getCurrent_mA();
      float power_mW     = ina219.getPower_mW();
      Serial.printf("INA219:        %.2f V | %.2f mA | %.2f mW\n", busVoltage_V, current_mA, power_mW);
    }

    // XA1110 GPS
    Serial.print("GPS:           ");
    if (gps.location.isValid()) {
      Serial.printf("Lat: %.6f, Lon: %.6f | Alt: %.1fm | Sats: %d\n",
                    gps.location.lat(), gps.location.lng(),
                    gps.altitude.meters(), gps.satellites.value());
    } else {
      Serial.printf("Searching... (Characters processed: %u, Sats seen: %d)\n",
                    gps.charsProcessed(), gps.satellites.value());
    }

    Serial.println();
  }
}
