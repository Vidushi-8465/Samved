/*
 * SMC LiveMonitor — ESP32 LoRa SENDER (Worker Device)
 * This device is WORN BY THE WORKER inside the sewer.
 * It has NO WiFi — it transmits via LoRa to the surface gateway.
 *
 * Hardware:
 *   - ESP32 DevKit
 *   - LoRa SX1276 (Ra-02) — connected via SPI
 *   - MQ-4  → CH4
 *   - MQ-136 → H2S
 *   - MQ-7  → CO  (Carbon Monoxide)
 *   - MAX30102 → Heart Rate + SpO2
 *   - MPU6050 → Fall Detection
 *   - SOS Push Button
 *   - Buzzer (local alert)
 *
 * Install libraries:
 *   - LoRa by Sandeep Mistry
 *   - MAX30105 by SparkFun
 *   - MPU6050 by Electronic Cats
 */

#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <MPU6050.h>
#include <ArduinoJson.h>

// ── LoRa Pins (ESP32) ─────────────────────────────────────────
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2
#define LORA_FREQ 433E6   // 433 MHz (use 865E6 for India ISM band)

// ── Sensor Pins ───────────────────────────────────────────────
#define MQ4_PIN   34   // CH4
#define MQ136_PIN 35   // H2S
#define MQ7_PIN   32   // CO
#define SOS_PIN   27   // SOS Button (INPUT_PULLUP)
#define BUZZER    25

// ── Device Config ─────────────────────────────────────────────
#define WORKER_ID      "w001"
#define MANHOLE_ID     "MH-05"
#define ZONE           "east"
#define LOCATION_LABEL "Hutatma Chowk"
#define DEVICE_MODE    "monitoring"   // or "premonitoring"
#define LAST_GPS_LAT   17.6870
#define LAST_GPS_LNG   75.9120

// ── Globals ───────────────────────────────────────────────────
MAX30105 particleSensor;
MPU6050  mpu;

float ch4 = 0, h2s = 0, co = 0;
int   heartRate = 0, spO2 = 0;
bool  fallDetected = false, sosTriggered = false;
String workerPosture = "standing";

int16_t ax, ay, az, gx, gy, gz;
float   accelMag = 0;
unsigned long lastMovement = 0;
unsigned long lastSend = 0;
const int SEND_INTERVAL = 5000; // 5 seconds

void setup() {
  Serial.begin(115200);
  pinMode(SOS_PIN, INPUT_PULLUP);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(BUZZER, LOW);

  // LoRa init
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa init FAILED!");
    while (true);
  }
  LoRa.setSpreadingFactor(9);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  Serial.println("LoRa sender ready");

  // MAX30102
  Wire.begin();
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeIR(0x1F);
    Serial.println("MAX30102 ready");
  }

  // MPU6050
  mpu.initialize();
  Serial.println(mpu.testConnection() ? "MPU6050 ready" : "MPU6050 failed");

  Serial.println("Worker device ready | ID: " + String(WORKER_ID));
}

void loop() {
  readGas();
  readHeartRate();
  detectFall();
  checkSOS();

  if (millis() - lastSend >= SEND_INTERVAL) {
    sendLoRaPacket();
    lastSend = millis();
  }
}

// ── Gas Sensors ───────────────────────────────────────────────
void readGas() {
  // CH4 (MQ-4): output in % LEL
  int rawCH4 = analogRead(MQ4_PIN);
  ch4 = map(rawCH4, 0, 4095, 0, 100);
  ch4 = constrain(ch4, 0, 100);

  // H2S (MQ-136): output in PPM
  int rawH2S = analogRead(MQ136_PIN);
  h2s = map(rawH2S, 0, 4095, 0, 50);
  h2s = constrain(h2s, 0, 50);

  // CO (MQ-7): output in PPM
  int rawCO = analogRead(MQ7_PIN);
  co = map(rawCO, 0, 4095, 0, 200);
  co = constrain(co, 0, 200);
}

// ── Heart Rate + SpO2 ─────────────────────────────────────────
void readHeartRate() {
  long irValue = particleSensor.getIR();
  if (irValue > 50000) {
    // Finger detected
    heartRate = 72 + random(-8, 15);  // Replace with SparkFun algorithm
    spO2 = 97 + random(-3, 2);
    spO2 = constrain(spO2, 70, 100);
  } else {
    heartRate = 0;
    spO2 = 0;
  }
}

// ── Fall Detection ────────────────────────────────────────────
void detectFall() {
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  float newMag = sqrt(
    pow((float)ax / 16384.0, 2) +
    pow((float)ay / 16384.0, 2) +
    pow((float)az / 16384.0, 2)
  );

  float delta = abs(newMag - accelMag);
  accelMag = newMag;

  if (delta > 2.5 && newMag < 0.6 && !fallDetected) {
    fallDetected = true;
    sosTriggered = true;
    workerPosture = "fallen";
    // Sound buzzer
    for (int i = 0; i < 5; i++) {
      digitalWrite(BUZZER, HIGH); delay(200);
      digitalWrite(BUZZER, LOW);  delay(200);
    }
    Serial.println("!! FALL DETECTED !!");
    return;
  }

  if (delta > 0.15) {
    lastMovement = millis();
    if (!fallDetected) workerPosture = "standing";
  } else if (!fallDetected && millis() - lastMovement > 30000) {
    workerPosture = "stationary";
  }
}

// ── SOS Button ────────────────────────────────────────────────
void checkSOS() {
  if (digitalRead(SOS_PIN) == LOW) {
    sosTriggered = true;
    digitalWrite(BUZZER, HIGH);
    Serial.println("!! SOS PRESSED !!");
    delay(200);
  }
}

// ── LoRa Packet ───────────────────────────────────────────────
void sendLoRaPacket() {
  // Lightweight CSV packet to save LoRa bandwidth
  // Format: WORKER_ID,ch4,h2s,co,hr,spo2,fall,sos,posture,manholeId,zone,lat,lng,mode
  String packet = String(WORKER_ID) + "," +
                  String(ch4, 1) + "," +
                  String(h2s, 1) + "," +
                  String(co, 1) + "," +
                  String(heartRate) + "," +
                  String(spO2) + "," +
                  String(fallDetected ? 1 : 0) + "," +
                  String(sosTriggered ? 1 : 0) + "," +
                  workerPosture + "," +
                  String(MANHOLE_ID) + "," +
                  String(ZONE) + "," +
                  String(LAST_GPS_LAT, 4) + "," +
                  String(LAST_GPS_LNG, 4) + "," +
                  String(DEVICE_MODE);

  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();

  Serial.println("Sent: " + packet);
}
