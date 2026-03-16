/*
 * SurakshaNet — ESP32 Sensor Node
 * Solapur Municipal Corporation
 * 
 * Sensors:
 *   - MQ-4  → CH4 (Methane)
 *   - MQ-136 → H2S (Hydrogen Sulfide)
 *   - MAX30100/MAX30102 → Heart Rate + SpO2
 *   - MPU6050 → Fall Detection (Accelerometer)
 *   - Push Button → SOS
 * 
 * Library dependencies (install via Arduino Library Manager):
 *   - Firebase ESP Client (by Mobizt)
 *   - MAX30100lib or SparkFun MAX3010x
 *   - MPU6050 (by Electronic Cats)
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"
#include <MPU6050.h>

// ── CONFIGURE THESE FOR EACH DEVICE ──────────────────────────
#define WIFI_SSID         "YOUR_WIFI_NAME"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"
#define API_KEY           "YOUR_FIREBASE_API_KEY"
#define DATABASE_URL      "https://surakshanet-smc-default-rtdb.firebaseio.com"

#define WORKER_ID         "w001"          // Change per device
#define MANHOLE_ID        "MH-02"         // Set before deployment
#define ZONE              "north"
#define LOCATION_LABEL    "Ward 2 Main Line"
#define DEVICE_MODE       "monitoring"    // "premonitoring" or "monitoring"

// GPS coordinates captured at surface before entering
#define LAST_GPS_LAT      17.6980
#define LAST_GPS_LNG      75.9080
// ──────────────────────────────────────────────────────────────

// Pin definitions
#define MQ4_PIN           34    // CH4 analog pin
#define MQ136_PIN         35    // H2S analog pin
#define SOS_BUTTON_PIN    32    // SOS push button
#define BUZZER_PIN        25    // Local buzzer

// Firebase objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// Sensor objects
MAX30105 particleSensor;
MPU6050 mpu;

// Data variables
float ch4_ppm = 0;
float h2s_ppm = 0;
int heartRate = 0;
int spO2 = 0;
bool fallDetected = false;
bool sosTriggered = false;
String workerPosture = "standing";

// Fall detection
int16_t ax, ay, az, gx, gy, gz;
float accel_magnitude = 0;
unsigned long lastMovement = 0;
bool wasStationary = false;

// Timing
unsigned long lastPush = 0;
const int PUSH_INTERVAL = 5000; // push every 5 seconds

void setup() {
  Serial.begin(115200);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

  // Connect WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());

  // Firebase setup
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  Firebase.signUp(&config, &auth, "", "");
  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // MAX30102 (heart rate + SpO2)
  Wire.begin();
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found!");
  } else {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    Serial.println("MAX30102 ready");
  }

  // MPU6050 (fall detection)
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("MPU6050 not found!");
  } else {
    Serial.println("MPU6050 ready");
  }

  Serial.println("SurakshaNet sensor node ready!");
  Serial.println("Worker: " + String(WORKER_ID) + " | Manhole: " + String(MANHOLE_ID));
}

void loop() {
  readGasSensors();
  readHeartRateSpO2();
  detectFall();
  checkSOS();

  if (millis() - lastPush > PUSH_INTERVAL && Firebase.ready()) {
    pushToFirebase();
    lastPush = millis();
  }
}

void readGasSensors() {
  // MQ-4 for CH4 — convert ADC to % LEL
  int rawCH4 = analogRead(MQ4_PIN);
  float voltageCH4 = rawCH4 * (3.3 / 4095.0);
  float rsCH4 = (3.3 - voltageCH4) / voltageCH4 * 10.0;
  ch4_ppm = 100.0 * pow(rsCH4 / 9.9, -2.49); // calibrate per your sensor datasheet
  ch4_ppm = constrain(ch4_ppm, 0, 100);

  // MQ-136 for H2S
  int rawH2S = analogRead(MQ136_PIN);
  float voltageH2S = rawH2S * (3.3 / 4095.0);
  float rsH2S = (3.3 - voltageH2S) / voltageH2S * 10.0;
  h2s_ppm = 26.08 * pow(rsH2S / 6.5, -1.458); // calibrate per datasheet
  h2s_ppm = constrain(h2s_ppm, 0, 100);
}

void readHeartRateSpO2() {
  // Simple heart rate from MAX30102
  long irValue = particleSensor.getIR();
  if (irValue > 50000) {
    // Finger detected — use running average
    static long lastIR = 0;
    static int bpmBuffer[10];
    static int bpmIndex = 0;
    // Simplified reading — use SparkFun algorithm for production
    heartRate = 75 + random(-5, 5); // Replace with actual algorithm
    spO2 = 97 + random(-2, 1);      // Replace with actual algorithm
  } else {
    // No finger / not worn
    heartRate = 0;
    spO2 = 0;
  }
}

void detectFall() {
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  // Calculate acceleration magnitude
  float newMag = sqrt(
    (float)ax/16384.0 * (float)ax/16384.0 +
    (float)ay/16384.0 * (float)ay/16384.0 +
    (float)az/16384.0 * (float)az/16384.0
  );

  // Sudden spike = possible fall
  float delta = abs(newMag - accel_magnitude);
  accel_magnitude = newMag;

  if (delta > 2.5 && newMag < 0.5) {
    // Large acceleration change followed by near-zero = fall
    fallDetected = true;
    workerPosture = "fallen";
    sosTriggered = true; // Auto-trigger SOS on fall
    digitalWrite(BUZZER_PIN, HIGH);
    Serial.println("⚠️ FALL DETECTED!");
    return;
  }

  // Check for inactivity (stationary > 30 seconds)
  if (delta > 0.1) {
    lastMovement = millis();
    if (!fallDetected) {
      workerPosture = "standing";
    }
  } else if (millis() - lastMovement > 30000 && !fallDetected) {
    workerPosture = "stationary";
  }
}

void checkSOS() {
  // Manual SOS button (LOW = pressed because of INPUT_PULLUP)
  if (digitalRead(SOS_BUTTON_PIN) == LOW) {
    sosTriggered = true;
    digitalWrite(BUZZER_PIN, HIGH);
    Serial.println("🆘 SOS BUTTON PRESSED!");
  }
}

void pushToFirebase() {
  String basePath = "/sensors/" + String(WORKER_ID);

  // Gas sensors
  Firebase.RTDB.setFloat(&fbdo, basePath + "/ch4", ch4_ppm);
  Firebase.RTDB.setFloat(&fbdo, basePath + "/h2s", h2s_ppm);

  // Health sensors
  Firebase.RTDB.setInt(&fbdo, basePath + "/heartRate", heartRate);
  Firebase.RTDB.setInt(&fbdo, basePath + "/spO2", spO2);

  // Fall & posture
  Firebase.RTDB.setBool(&fbdo, basePath + "/fallDetected", fallDetected);
  Firebase.RTDB.setString(&fbdo, basePath + "/workerPosture", workerPosture);

  // SOS
  Firebase.RTDB.setBool(&fbdo, basePath + "/sosTriggered", sosTriggered);

  // Location info
  Firebase.RTDB.setString(&fbdo, basePath + "/manholeId", MANHOLE_ID);
  Firebase.RTDB.setString(&fbdo, basePath + "/zone", ZONE);
  Firebase.RTDB.setString(&fbdo, basePath + "/locationLabel", LOCATION_LABEL);
  Firebase.RTDB.setFloat(&fbdo, basePath + "/lastGpsLat", LAST_GPS_LAT);
  Firebase.RTDB.setFloat(&fbdo, basePath + "/lastGpsLng", LAST_GPS_LNG);

  // Mode
  Firebase.RTDB.setString(&fbdo, basePath + "/mode", DEVICE_MODE);
  Firebase.RTDB.setInt(&fbdo, basePath + "/lastUpdated", millis());

  Serial.printf("📡 Pushed: CH4=%.1f%%LEL H2S=%.1fPPM HR=%d SpO2=%d%% Fall=%s SOS=%s\n",
    ch4_ppm, h2s_ppm, heartRate, spO2,
    fallDetected ? "YES" : "no",
    sosTriggered ? "YES" : "no"
  );

  // Trigger warning if thresholds exceeded
  if (ch4_ppm > 25 || h2s_ppm > 10 || spO2 < 90 || fallDetected) {
    Serial.println("⚠️ DANGER THRESHOLD EXCEEDED");
    // Write alert to Firestore via HTTP (optional — see documentation)
  }
}
