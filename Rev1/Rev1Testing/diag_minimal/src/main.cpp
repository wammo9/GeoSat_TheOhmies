// Minimal GPIO23 / I2C check for the Rev 1 board -- no HIL firmware involved.
// Temporarily use this as src/main.cpp, flash, open the monitor.
#include <Arduino.h>
#include <Wire.h>

const int SDA_PIN = 22;  // XIAO D4
const int SCL_PIN = 23;  // XIAO D5

void lineCheck(int pin, const char *name) {
  pinMode(pin, INPUT_PULLDOWN); delay(5);
  int pd = digitalRead(pin);
  pinMode(pin, INPUT_PULLUP);   delay(5);
  int pu = digitalRead(pin);
  pinMode(pin, INPUT);
  Serial.printf("%s (GPIO%d): with pull-down=%d  with pull-up=%d  -> %s\n", name, pin, pd, pu,
                pu == 0 ? "HELD LOW" : pd == 1 ? "EXTERNAL PULL-UP OK" : "FLOATING");
}

void setup() {
  Serial.begin(115200);
  delay(3000);  // time to open the monitor
  Serial.println("\n=== Minimal GPIO23 / I2C check ===");

  // 1) Line check, done before Wire ever touches the pins
  lineCheck(SDA_PIN, "SDA");
  lineCheck(SCL_PIN, "SCL");

  // 2) Toggle D5 so it can be measured with a meter (I2C not started yet)
  pinMode(SCL_PIN, OUTPUT);
  for (int i = 0; i < 4; i++) {
    digitalWrite(SCL_PIN, HIGH);
    Serial.println("D5 driven HIGH for 4 s  -> meter on D5 should read ~3.3 V");
    delay(4000);
    digitalWrite(SCL_PIN, LOW);
    Serial.println("D5 driven LOW  for 4 s  -> meter on D5 should read ~0 V");
    delay(4000);
  }
  pinMode(SCL_PIN, INPUT);

  // 3) Plain I2C scan at 100 kHz
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
}

void loop() {
  int n = 0;
  Serial.print("I2C scan:");
  for (uint8_t a = 0x08; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.printf(" 0x%02X", a); n++; }
  }
  Serial.printf("  (%d found)\n", n);
  delay(3000);
}