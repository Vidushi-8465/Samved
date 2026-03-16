#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <LoRa.h>

// ---------------- WIFI ----------------
const char* WIFI_SSID = "GALAXY M14 5G BE15";
const char* WIFI_PASS = "12345678";

// --------------- FIREBASE -------------
const char* FIREBASE_URL = "https://surakshanet-smc-default-rtdb.firebaseio.com/sensors.json";

// --------------- LORA PINS ------------
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  26

// --------------- VARIABLES ------------
int heartRate = 0;
int spo2 = 0;
int finger = 0;
int alertCode = 0;
int ch4 = 0;
int co = 0;
int gasAlert = 0;

// ---------- HELPER: GET VALUE ----------
int getValue(String data, String key) {
  int start = data.indexOf(key);
  if (start == -1) return 0;

  start += key.length();
  int end = data.indexOf(",", start);

  if (end == -1) {
    end = data.length();
  }

  String val = data.substring(start, end);
  val.trim();
  return val.toInt();
}

// ---------- WIFI CONNECT ----------
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ---------- FIREBASE UPLOAD ----------
bool uploadToFirebase() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    connectWiFi();
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;
  if (!https.begin(client, FIREBASE_URL)) {
    Serial.println("HTTPS begin failed");
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  bool fallDetected = (alertCode == 1 || alertCode == 4);
  String posture = (alertCode == 3 || alertCode == 4) ? "tilted" : "standing";

  String json = "{";
  json += "\"heartRate\":" + String(heartRate) + ",";
  json += "\"spO2\":" + String(spo2) + ",";
  json += "\"ch4\":" + String(ch4) + ",";
  json += "\"co\":" + String(co) + ",";
  json += "\"fingerDetected\":" + String(finger == 1 ? "true" : "false") + ",";
  json += "\"fallDetected\":" + String(fallDetected ? "true" : "false") + ",";
  json += "\"alertCode\":" + String(alertCode) + ",";
  json += "\"gasAlert\":" + String(gasAlert) + ",";
  json += "\"workerPosture\":\"" + posture + "\",";
  json += "\"mode\":\"monitoring\"";
  json += "}";

  int httpCode = https.PATCH(json);
  String response = https.getString();

  Serial.print("Firebase HTTP code: ");
  Serial.println(httpCode);
  Serial.print("Firebase response: ");
  Serial.println(response);

  https.end();

  return (httpCode > 0 && httpCode < 300);
}

// ---------- SETUP ----------
void setup() {
  Serial.begin(115200);
  delay(1000);

  connectWiFi();

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed");
    while (1);
  }

  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);

  Serial.println("LoRa Receiver Ready");
}

// ---------- LOOP ----------
void loop() {
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    String incoming = "";
    while (LoRa.available()) {
      incoming += (char)LoRa.read();
    }

    Serial.println("Received: " + incoming);

    heartRate = getValue(incoming, "HR:");
    spo2      = getValue(incoming, "SP:");
    finger    = getValue(incoming, "FNG:");
    alertCode = getValue(incoming, "AL:");
    ch4       = getValue(incoming, "M4:");
    co        = getValue(incoming, "M7:");
    gasAlert  = getValue(incoming, "GA:");

    Serial.println("Parsed values:");
    Serial.println("HR   = " + String(heartRate));
    Serial.println("SpO2 = " + String(spo2));
    Serial.println("CH4  = " + String(ch4));
    Serial.println("CO   = " + String(co));
    Serial.println("AL   = " + String(alertCode));
    Serial.println("GA   = " + String(gasAlert));

    uploadToFirebase();
  }
}