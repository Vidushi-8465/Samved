#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <FirebaseESP32.h>

// =============================================
//   CONFIG
// =============================================
#define WIFI_SSID     "motorola edge 30"
#define WIFI_PASSWORD "invincible"
#define FIREBASE_URL  "https://smc-device-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_KEY  "wtsXpWx5itO8EKyOSq2yAYkPMiDKUd7AeTWaAgFi"

// ── TWILIO SMS CONFIG ──────────────────────
// Get these from twilio.com/console (free trial, no card needed)
#define TWILIO_ACCOUNT_SID  "ACae548d0e18174fa94bb2a4bccfdae952"
#define TWILIO_AUTH_TOKEN   "73edff061113b1d1c75a5f398115bd35"
#define TWILIO_FROM_NUMBER  " +18777804236"

const char* MANAGER_PHONES[] = {
  "+91 70580 85334",   // replace with manager's real number e.g. +919876500001
  "+91 90041 14709",
};
const int MANAGER_COUNT = 2;

// SMS cooldown — one SMS per 5 minutes max
unsigned long lastSMSTime  = 0;
#define SMS_COOLDOWN_MS  300000
// ──────────────────────────────────────────

// =============================================
//   LoRa pins
// =============================================
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2

// =============================================
//   Firebase objects
// =============================================
FirebaseData   fbdo;
FirebaseConfig config;
FirebaseAuth   auth;

// =============================================
//   Globals
// =============================================
int lastHR   = 0;
int lastSpO2 = 0;
unsigned long lastPacketTime = 0;
String workerID = "w001";

// =============================================
//   BASE64 ENCODE (needed for Twilio auth)
// =============================================
String base64Encode(String input) {
  const char* chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String output = "";
  int i = 0;
  unsigned char a3[3], a4[4];
  int len = input.length();
  const char* data = input.c_str();
  while (len--) {
    a3[i++] = *(data++);
    if (i == 3) {
      a4[0] = (a3[0] & 0xfc) >> 2;
      a4[1] = ((a3[0] & 0x03) << 4) + ((a3[1] & 0xf0) >> 4);
      a4[2] = ((a3[1] & 0x0f) << 2) + ((a3[2] & 0xc0) >> 6);
      a4[3] = a3[2] & 0x3f;
      for (int j = 0; j < 4; j++) output += chars[a4[j]];
      i = 0;
    }
  }
  if (i) {
    for (int j = i; j < 3; j++) a3[j] = '\0';
    a4[0] = (a3[0] & 0xfc) >> 2;
    a4[1] = ((a3[0] & 0x03) << 4) + ((a3[1] & 0xf0) >> 4);
    a4[2] = ((a3[1] & 0x0f) << 2) + ((a3[2] & 0xc0) >> 6);
    for (int j = 0; j < i + 1; j++) output += chars[a4[j]];
    while (i++ < 3) output += '=';
  }
  return output;
}

// =============================================
//   SEND SMS VIA TWILIO
// =============================================
void sendTwilioSMS(String message) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SMS] WiFi down — skipping");
    return;
  }
  if (millis() - lastSMSTime < SMS_COOLDOWN_MS && lastSMSTime > 0) {
    Serial.println("[SMS] Cooldown active — skipping");
    return;
  }

  Serial.println("[SMS] Sending via Twilio...");

  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect("api.twilio.com", 443)) {
    Serial.println("[SMS] Connection to Twilio failed");
    return;
  }

  String authHeader = base64Encode(
    String(TWILIO_ACCOUNT_SID) + ":" + String(TWILIO_AUTH_TOKEN)
  );

  for (int i = 0; i < MANAGER_COUNT; i++) {
    // URL-encode message
    String encodedMsg = "";
    for (int j = 0; j < message.length(); j++) {
      char c = message[j];
      if      (c == '\n') encodedMsg += "%0A";
      else if (c == ' ')  encodedMsg += "+";
      else if (isAlphaNumeric(c)) encodedMsg += c;
      else { encodedMsg += "%"; if (c < 16) encodedMsg += "0"; encodedMsg += String(c, HEX); }
    }

    String toNum   = String(MANAGER_PHONES[i]);
    String fromNum = String(TWILIO_FROM_NUMBER);
    toNum.replace("+", "%2B");
    fromNum.replace("+", "%2B");

    String body = "To=" + toNum + "&From=" + fromNum + "&Body=" + encodedMsg;
    String url  = "/2010-04-01/Accounts/" + String(TWILIO_ACCOUNT_SID) + "/Messages.json";

    client.println("POST " + url + " HTTP/1.1");
    client.println("Host: api.twilio.com");
    client.println("Authorization: Basic " + authHeader);
    client.println("Content-Type: application/x-www-form-urlencoded");
    client.println("Content-Length: " + String(body.length()));
    client.println("Connection: close");
    client.println();
    client.print(body);

    delay(2000);
    String response = "";
    while (client.available()) response += (char)client.read();

    if (response.indexOf("\"queued\"") >= 0 || response.indexOf("201") >= 0) {
      Serial.println("[SMS] Sent to " + String(MANAGER_PHONES[i]));
    } else {
      Serial.println("[SMS] Failed — " + response.substring(0, 100));
    }
  }

  client.stop();
  lastSMSTime = millis();
}

// =============================================
//   SETUP
// =============================================
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("============================");
  Serial.println(" IOTians - Base Station");
  Serial.println(" Full Safety Monitor v4");
  Serial.println(" Pre-Monitor + Continuous");
  Serial.println("============================");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500); Serial.print("."); tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" Connected!");
    Serial.print("IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println(" WiFi FAILED — running offline");
  }

  config.host = FIREBASE_URL;
  config.signer.tokens.legacy_token = FIREBASE_KEY;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  Serial.println("Firebase ready");

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("ERROR: LoRa FAILED!");
    while (1);
  }
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  Serial.println("LoRa OK");
  Serial.println("Waiting for worker data...");
  Serial.println("============================\n");
}

// =============================================
//   LOOP
// =============================================
void loop() {

  // Signal lost check
  if (lastPacketTime > 0 && millis() - lastPacketTime > 15000) {
    Serial.println("WARNING: No data for 15 sec!");
    lastPacketTime = millis();
    if (WiFi.status() == WL_CONNECTED)
      Firebase.setString(fbdo,
        "/sensors/" + workerID + "/status", "OFFLINE");
  }

  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String received = "";
  while (LoRa.available())
    received += (char)LoRa.read();

  lastPacketTime = millis();
  int rssi = LoRa.packetRssi();

  Serial.println("\nRaw packet: " + received);

  // Extract mode first
  String mode = extractString(received, "MODE");

  // Worker ID
  int idVal = extractValue(received, "ID");
  if      (idVal == 1) workerID = "w001";
  else if (idVal == 2) workerID = "w002";
  else if (idVal == 3) workerID = "w003";
  else if (idVal == 4) workerID = "w004";
  else if (idVal == 5) workerID = "w005";

  // =============================================
  //   PRE-MONITORING PACKET
  // =============================================
  if (mode == "PRE") {
    handlePreMonitor(received, rssi);
    return;
  }

  // =============================================
  //   CONTINUOUS MONITORING PACKET
  // =============================================
  handleContinuous(received, rssi);
}

// =============================================
//   PRE-MONITORING HANDLER
// =============================================
void handlePreMonitor(String received, int rssi) {

  int l1m4 = extractValue(received, "L1M4");
  int l1m7 = extractValue(received, "L1M7");
  int l2m4 = extractValue(received, "L2M4");
  int l2m7 = extractValue(received, "L2M7");
  int l3m4 = extractValue(received, "L3M4");
  int l3m7 = extractValue(received, "L3M7");
  String result = extractString(received, "RES");

  // Serial display
  Serial.println("==============================");
  Serial.println("   PRE-MONITORING RESULTS");
  Serial.println("==============================");
  Serial.print("Signal     : "); Serial.print(rssi); Serial.println(" dBm");
  Serial.println("--- 3 LEVEL GAS SAMPLES ---");
  Serial.print("Level 1 — CH4: "); Serial.print(l1m4);
  Serial.print(" PPM  CO: ");      Serial.print(l1m7); Serial.println(" PPM");
  Serial.print("Level 2 — CH4: "); Serial.print(l2m4);
  Serial.print(" PPM  CO: ");      Serial.print(l2m7); Serial.println(" PPM");
  Serial.print("Level 3 — CH4: "); Serial.print(l3m4);
  Serial.print(" PPM  CO: ");      Serial.print(l3m7); Serial.println(" PPM");
  Serial.println("--- VERDICT ---");
  if (result == "SAFE") {
    Serial.println("✓ SAFE — Entry permitted");
    Serial.println("  Normal precautions apply");
  } else if (result == "WARNING") {
    Serial.println("⚠ WARNING — Enter with caution");
    Serial.println("  Full protective gear required");
  } else if (result == "UNSAFE") {
    Serial.println("✗ UNSAFE — DO NOT ENTER!");
    Serial.println("  Dangerous gas levels detected");
  }
  Serial.println("==============================\n");

  // SMS for ALL pre-monitor results (SAFE / WARNING / UNSAFE)
  {
    String verdict = "";
    String action  = "";
    if (result == "SAFE") {
      verdict = "SAFE - Entry Permitted";
      action  = "Normal precautions apply.";
    } else if (result == "WARNING") {
      verdict = "WARNING - Enter with Caution";
      action  = "Full PPE required before entry.";
    } else if (result == "UNSAFE") {
      verdict = "UNSAFE - DO NOT ENTER!";
      action  = "Do NOT send worker inside.";
    }

    String msg = "SurakshaNet SMC Solapur\n";
    msg += "PRE-MONITORING REPORT\n";
    msg += "Worker ID : " + workerID + "\n";
    msg += "Result    : " + verdict + "\n";
    msg += "--- Gas Readings ---\n";
    msg += "Level 1: CH4=" + String(l1m4) + " PPM  CO=" + String(l1m7) + " PPM\n";
    msg += "Level 2: CH4=" + String(l2m4) + " PPM  CO=" + String(l2m7) + " PPM\n";
    msg += "Level 3: CH4=" + String(l3m4) + " PPM  CO=" + String(l3m7) + " PPM\n";
    msg += "Signal    : " + String(rssi) + " dBm\n";
    msg += action;
    sendTwilioSMS(msg);
  }

  // Push to Firebase
  if (WiFi.status() == WL_CONNECTED) {
    String path    = "/sensors/" + workerID;
    String prePath = path + "/pre_monitor";

    Firebase.setString(fbdo, prePath + "/result",     result);
    Firebase.setInt   (fbdo, prePath + "/level1_ch4", l1m4);
    Firebase.setInt   (fbdo, prePath + "/level1_co",  l1m7);
    Firebase.setInt   (fbdo, prePath + "/level2_ch4", l2m4);
    Firebase.setInt   (fbdo, prePath + "/level2_co",  l2m7);
    Firebase.setInt   (fbdo, prePath + "/level3_ch4", l3m4);
    Firebase.setInt   (fbdo, prePath + "/level3_co",  l3m7);
    Firebase.setInt   (fbdo, prePath + "/rssi",        rssi);
    Firebase.setString(fbdo, path    + "/mode",       "PRE");
    Firebase.setString(fbdo, path    + "/status",     "PRE_MONITOR");

    Serial.println("Firebase → pre_monitor [" + result + "] ✓");
  } else {
    Serial.println("WiFi down — Firebase skipped");
  }
}

// =============================================
//   CONTINUOUS MONITORING HANDLER
// =============================================
void handleContinuous(String received, int rssi) {

  int hrVal       = extractValue(received, "HR");
  int spVal       = extractValue(received, "SP");
  int fng         = extractValue(received, "FNG");
  int motionAlert = extractValue(received, "AL");
  int postureCode = extractValue(received, "PC");
  int mq4         = extractValue(received, "M4");
  int mq7         = extractValue(received, "M7");
  int gasAlert    = extractValue(received, "GA");

  if (hrVal > 0) lastHR   = hrVal;
  if (spVal > 0) lastSpO2 = spVal;

  int hrToShow = hrVal  > 0 ? hrVal  : lastHR;
  int spToShow = spVal  > 0 ? spVal  : lastSpO2;

  bool gasWarming = (mq4 == -1 || mq7 == -1);
  if (mq4 == -1) mq4 = 0;
  if (mq7 == -1) mq7 = 0;

  // Posture string
  String posture;
  if      (postureCode == 1) posture = "fallen";
  else if (postureCode == 2) posture = "stationary";
  else if (postureCode == 3) posture = "tilt";
  else if (postureCode == 4) posture = "walking";
  else                       posture = "standing";

  // Status
  String status;
  bool anyDanger  = (motionAlert == 1 || motionAlert == 4 ||
                     gasAlert >= 4 ||
                     (spToShow > 0 && spToShow < 90) ||
                     (hrToShow > 0 && (hrToShow < 50 || hrToShow > 130)));
  bool anyWarning = (motionAlert > 0 || gasAlert > 0 ||
                     (hrToShow > 0 && (hrToShow < 60 || hrToShow > 120)) ||
                     (spToShow > 0 && spToShow < 95));

  if      (anyDanger)  status = "DANGER";
  else if (anyWarning) status = "WARNING";
  else                 status = "SAFE";

  // SMS only when FALL is detected
  if (motionAlert == 1 || motionAlert == 4) {
    String msg = "SurakshaNet SMC Solapur\n";
    msg += "*** FALL DETECTED ***\n";
    msg += "Worker ID : " + workerID + "\n";
    msg += "Posture   : " + posture + "\n";
    msg += "--- Vitals ---\n";
    msg += "Heart Rate: " + (hrToShow > 0 ? String(hrToShow) + " BPM" : "No reading") + "\n";
    msg += "SpO2      : " + (spToShow > 0 ? String(spToShow) + "%" : "No reading") + "\n";
    msg += "--- Gas Levels ---\n";
    if (gasWarming) {
      msg += "Gas sensors warming up\n";
    } else {
      msg += "CH4: " + String(mq4) + " PPM\n";
      msg += "CO : " + String(mq7) + " PPM\n";
    }
    msg += "LoRa Signal: " + String(rssi) + " dBm\n";
    msg += "Open app immediately!";
    sendTwilioSMS(msg);
  }

  // Push to Firebase
  if (WiFi.status() == WL_CONNECTED) {
    String path = "/sensors/" + workerID;

    Firebase.setString(fbdo, path + "/mode",         "CONTINUOUS");
    Firebase.setInt   (fbdo, path + "/hr",           hrToShow);
    Firebase.setInt   (fbdo, path + "/spo2",         spToShow);
    Firebase.setInt   (fbdo, path + "/finger",       fng);
    Firebase.setInt   (fbdo, path + "/mq4_ppm",      mq4);
    Firebase.setInt   (fbdo, path + "/mq7_ppm",      mq7);
    Firebase.setInt   (fbdo, path + "/gas_alert",    gasAlert);
    Firebase.setBool  (fbdo, path + "/gasWarming",   gasWarming);
    Firebase.setInt   (fbdo, path + "/motion_alert", motionAlert);
    Firebase.setInt   (fbdo, path + "/posture_code", postureCode);
    Firebase.setString(fbdo, path + "/posture",      posture);
    Firebase.setBool  (fbdo, path + "/fall",
                       motionAlert == 1 || motionAlert == 4);
    Firebase.setBool  (fbdo, path + "/sos",          motionAlert >= 4);
    Firebase.setInt   (fbdo, path + "/rssi",         rssi);
    Firebase.setString(fbdo, path + "/status",       status);
    Firebase.setInt   (fbdo, path + "/last_seen",    millis()/1000);

    Serial.println("Firebase → " + workerID +
                   " [" + status + "] [" + posture + "] ✓");
  } else {
    Serial.println("WiFi down — Firebase skipped");
  }

  // Serial display
  Serial.println("==============================");
  Serial.println("    WORKER SAFETY UPDATE");
  Serial.println("     CONTINUOUS MODE");
  Serial.println("==============================");
  Serial.print("Signal  : "); Serial.print(rssi);
  if      (rssi > -60)  Serial.println(" dBm (Excellent)");
  else if (rssi > -80)  Serial.println(" dBm (Good)");
  else if (rssi > -100) Serial.println(" dBm (Weak)");
  else                  Serial.println(" dBm (Very Weak!)");

  Serial.println("--- VITALS ---");
  Serial.print("Finger  : "); Serial.println(fng ? "ON" : "OFF");

  Serial.print("HR      : ");
  if      (hrVal > 0)  { Serial.print(hrVal);   Serial.println(" BPM"); }
  else if (lastHR > 0) { Serial.print(lastHR);  Serial.println(" BPM (last)"); }
  else                   Serial.println("Reading...");

  Serial.print("SpO2    : ");
  if      (spVal > 0)    { Serial.print(spVal);    Serial.println(" %"); }
  else if (lastSpO2 > 0) { Serial.print(lastSpO2); Serial.println(" % (last)"); }
  else                     Serial.println("Reading...");

  Serial.print("Posture : "); Serial.println(posture);

  Serial.println("--- GAS LEVELS ---");
  Serial.print("CH4(MQ4): ");
  if (gasWarming) Serial.println("Warming up...");
  else { Serial.print(mq4); Serial.println(" PPM"); }

  Serial.print("CO (MQ7): ");
  if (gasWarming) Serial.println("Warming up...");
  else { Serial.print(mq7); Serial.println(" PPM"); }

  Serial.println("--- ALERTS ---");
  if      (motionAlert == 4) Serial.println("!!! EMERGENCY !!!");
  else if (motionAlert == 1) Serial.println("!!! FALL DETECTED !!!");
  else if (motionAlert == 2) Serial.println("!!! WORKER INACTIVE !!!");
  else if (motionAlert == 3) Serial.println("! TILT WARNING !");
  else                       Serial.println("Motion  : Normal");

  if      (gasAlert == 5) Serial.println("!!! BOTH GASES CRITICAL !!!");
  else if (gasAlert == 4) Serial.println("!!! CO CRITICAL !!!");
  else if (gasAlert == 3) Serial.println("! CO WARNING !");
  else if (gasAlert == 2) Serial.println("!!! CH4 CRITICAL !!!");
  else if (gasAlert == 1) Serial.println("! CH4 WARNING !");
  else if (!gasWarming)   Serial.println("Gas     : Normal");
  else                    Serial.println("Gas     : Warming up...");

  if (hrToShow > 0) {
    if      (hrToShow < 40)  Serial.println("!!! CRITICAL: HR very low!");
    else if (hrToShow < 50)  Serial.println("! ALERT: HR low!");
    else if (hrToShow > 130) Serial.println("! ALERT: HR high!");
    else if (hrToShow > 120) Serial.println("! WARNING: HR elevated");
    else                     Serial.println("HR      : Normal");
  }

  if (spToShow > 0) {
    if      (spToShow < 90) Serial.println("!!! CRITICAL: SpO2 very low!");
    else if (spToShow < 95) Serial.println("! WARNING: SpO2 low");
    else                    Serial.println("SpO2    : Normal");
  }

  Serial.println("--- STATUS ---");
  Serial.println(status);
  Serial.println("==============================\n");
}

// =============================================
//   HELPERS
// =============================================
int extractValue(String data, String key) {
  int idx = data.indexOf(key + ":");
  if (idx == -1) return 0;
  int start = idx + key.length() + 1;
  int end   = data.indexOf(",", start);
  if (end == -1) end = data.length();
  return data.substring(start, end).toInt();
}

String extractString(String data, String key) {
  int idx = data.indexOf(key + ":");
  if (idx == -1) return "";
  int start = idx + key.length() + 1;
  int end   = data.indexOf(",", start);
  if (end == -1) end = data.length();
  return data.substring(start, end);
}
