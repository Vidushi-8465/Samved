/*
 * SurakshaNet — ESP32 LoRa RECEIVER / WiFi Gateway (Surface Device)
 * This device sits on the SURFACE near the manhole.
 * It receives LoRa packets from the worker device
 * and pushes data to Firebase via WiFi.
 *
 * Hardware:
 *   - ESP32 DevKit
 *   - LoRa SX1276 (Ra-02)
 *   - WiFi (built-in ESP32)
 *
 * Install libraries:
 *   - LoRa by Sandeep Mistry
 *   - Firebase ESP Client by Mobizt
 *   - ArduinoJson by Benoit Blanchon
 */

#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ── LoRa Pins ─────────────────────────────────────────────────
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2
#define LORA_FREQ 433E6

// ── WiFi + Firebase ───────────────────────────────────────────
#define WIFI_SSID     "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define API_KEY       "YOUR_FIREBASE_API_KEY"
#define DATABASE_URL  "https://surakshanet-smc-default-rtdb.firebaseio.com"

// ── Firebase ──────────────────────────────────────────────────
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

bool firebaseReady = false;

void setup() {
  Serial.begin(115200);

  // ── WiFi ──────────────────────────────────────────────────
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500); Serial.print("."); tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi FAILED — will retry");
  }

  // ── Firebase ──────────────────────────────────────────────
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  Firebase.signUp(&config, &auth, "", "");
  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  firebaseReady = true;
  Serial.println("Firebase ready");

  // ── LoRa ──────────────────────────────────────────────────
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa init FAILED!");
    while (true);
  }
  LoRa.setSpreadingFactor(9);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  Serial.println("LoRa gateway ready — waiting for packets...");
}

void loop() {
  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  // Check for incoming LoRa packet
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String received = "";
    while (LoRa.available()) {
      received += (char)LoRa.read();
    }
    int rssi = LoRa.packetRssi();
    Serial.println("Received [RSSI: " + String(rssi) + "]: " + received);
    parseAndPush(received, rssi);
  }
}

// ── Parse CSV and push to Firebase ───────────────────────────
void parseAndPush(String packet, int rssi) {
  // Format: workerId,ch4,h2s,co,hr,spo2,fall,sos,posture,manholeId,zone,lat,lng,mode
  String fields[14];
  int idx = 0;
  int start = 0;

  for (int i = 0; i <= packet.length() && idx < 14; i++) {
    if (i == packet.length() || packet[i] == ',') {
      fields[idx++] = packet.substring(start, i);
      start = i + 1;
    }
  }

  if (idx < 14) {
    Serial.println("Bad packet — only " + String(idx) + " fields");
    return;
  }

  String workerId    = fields[0];
  float  ch4         = fields[1].toFloat();
  float  h2s         = fields[2].toFloat();
  float  co          = fields[3].toFloat();
  int    heartRate   = fields[4].toInt();
  int    spO2        = fields[5].toInt();
  bool   fallDetect  = fields[6] == "1";
  bool   sosTrig     = fields[7] == "1";
  String posture     = fields[8];
  String manholeId   = fields[9];
  String zone        = fields[10];
  float  lat         = fields[11].toFloat();
  float  lng         = fields[12].toFloat();
  String mode        = fields[13];

  // Derive location label from manholeId
  String locationLabel = getManholeLabel(manholeId);

  // Push to Firebase Realtime Database
  String path = "/sensors/" + workerId;

  if (!Firebase.ready()) return;

  Firebase.RTDB.setFloat(&fbdo,  path + "/ch4",           ch4);
  Firebase.RTDB.setFloat(&fbdo,  path + "/h2s",           h2s);
  Firebase.RTDB.setFloat(&fbdo,  path + "/co",            co);
  Firebase.RTDB.setInt(&fbdo,    path + "/heartRate",     heartRate);
  Firebase.RTDB.setInt(&fbdo,    path + "/spO2",          spO2);
  Firebase.RTDB.setBool(&fbdo,   path + "/fallDetected",  fallDetect);
  Firebase.RTDB.setBool(&fbdo,   path + "/sosTriggered",  sosTrig);
  Firebase.RTDB.setString(&fbdo, path + "/workerPosture", posture);
  Firebase.RTDB.setString(&fbdo, path + "/manholeId",     manholeId);
  Firebase.RTDB.setString(&fbdo, path + "/zone",          zone);
  Firebase.RTDB.setString(&fbdo, path + "/locationLabel", locationLabel);
  Firebase.RTDB.setFloat(&fbdo,  path + "/lastGpsLat",    lat);
  Firebase.RTDB.setFloat(&fbdo,  path + "/lastGpsLng",    lng);
  Firebase.RTDB.setString(&fbdo, path + "/mode",          mode);
  Firebase.RTDB.setInt(&fbdo,    path + "/rssi",          rssi);
  Firebase.RTDB.setInt(&fbdo,    path + "/lastUpdated",   millis());

  Serial.println("Pushed to Firebase: " + workerId +
    " CH4=" + String(ch4) +
    " H2S=" + String(h2s) +
    " CO=" + String(co) +
    " HR=" + String(heartRate) +
    " SpO2=" + String(spO2) +
    " Fall=" + String(fallDetect) +
    " SOS=" + String(sosTrig)
  );

  // Auto-create alert in Firebase if threshold exceeded
  if (sosTrig || fallDetect || ch4 > 25 || h2s > 10 || co > 50 || spO2 < 90) {
    String alertType = sosTrig ? "SOS" :
                       fallDetect ? "FALL" :
                       ch4 > 25 ? "CH4_CRITICAL" :
                       h2s > 10 ? "H2S_CRITICAL" :
                       co > 50  ? "CO_HIGH" : "SPO2_CRITICAL";

    String alertPath = "/alerts/" + workerId + "_" + String(millis());
    Firebase.RTDB.setString(&fbdo, alertPath + "/workerId",   workerId);
    Firebase.RTDB.setString(&fbdo, alertPath + "/type",       alertType);
    Firebase.RTDB.setString(&fbdo, alertPath + "/zone",       zone);
    Firebase.RTDB.setString(&fbdo, alertPath + "/manholeId",  manholeId);
    Firebase.RTDB.setBool(&fbdo,   alertPath + "/resolved",   false);
    Firebase.RTDB.setInt(&fbdo,    alertPath + "/timestamp",  millis());
    Serial.println("Alert created: " + alertType);
  }
}

// ── Manhole label lookup ──────────────────────────────────────
String getManholeLabel(String manholeId) {
  if (manholeId == "MH-01") return "Hotgi Road Junction";
  if (manholeId == "MH-02") return "Ward 2 Main Line";
  if (manholeId == "MH-03") return "Akkalkot Road Entry";
  if (manholeId == "MH-04") return "Vijapur Road Crossing";
  if (manholeId == "MH-05") return "Hutatma Chowk";
  if (manholeId == "MH-06") return "Osmanabad Naka";
  if (manholeId == "MH-07") return "Pandharpur Road Main";
  if (manholeId == "MH-08") return "Bijapur Road Junction";
  if (manholeId == "MH-09") return "Mangalwar Peth Centre";
  if (manholeId == "MH-10") return "Budhwar Peth Main";
  return manholeId;
}
