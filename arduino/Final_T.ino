#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <MPU6050_light.h>

// =============================================
//   PIN DEFINITIONS
// =============================================
#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2
#define MQ4_PIN    32
#define MQ7_PIN    33
#define BUTTON_PIN 15
#define BUZZER_PIN 25
#define LED_GREEN  26
#define LED_YELLOW 27
#define LED_RED    13

// =============================================
//   THRESHOLDS
// =============================================
#define MQ4_WARN         1000
#define MQ4_DANGER       5000
#define MQ7_WARN         50
#define MQ7_DANGER       200
#define FALL_THRESHOLD   3.5
#define INACTIVE_TIMEOUT 30000
#define TILT_THRESHOLD   75
#define WARMUP_TIME      180000

// =============================================
//   MODE DEFINITIONS
// =============================================
#define MODE_PRE        0
#define MODE_CONTINUOUS 1
int  currentMode  = MODE_PRE;
int  currentLevel = 0;
bool allLevels    = false;
String preResult  = "UNKNOWN";

struct GasSample {
  int mq4; int mq7; bool valid;
};
GasSample levels[3];

// Button timing
unsigned long btnPressTime  = 0;
bool          btnWasPressed = false;
unsigned long lastDebounce  = 0;
#define DEBOUNCE_MS   50
#define LONG_PRESS_MS 3000

// =============================================
//   MEDIAN FILTER
// =============================================
#define MEDIAN_SIZE 9
int spO2Window[MEDIAN_SIZE] = {0};
int spO2WinIdx = 0, spO2Count = 0;
int hrWindow[MEDIAN_SIZE]   = {0};
int hrWinIdx   = 0, hrCount   = 0;

void bubbleSort(int* arr, int n) {
  for (int i = 0; i < n-1; i++)
    for (int j = 0; j < n-i-1; j++)
      if (arr[j] > arr[j+1]) {
        int t = arr[j]; arr[j] = arr[j+1]; arr[j+1] = t;
      }
}

int medianFilterSpO2(int val) {
  if (val < 80 || val > 100)
    return (spO2Count > 0) ?
      spO2Window[(spO2WinIdx-1+MEDIAN_SIZE)%MEDIAN_SIZE] : 0;
  spO2Window[spO2WinIdx] = val;
  spO2WinIdx = (spO2WinIdx+1) % MEDIAN_SIZE;
  if (spO2Count < MEDIAN_SIZE) spO2Count++;
  int t[MEDIAN_SIZE];
  for (int i = 0; i < spO2Count; i++) t[i] = spO2Window[i];
  bubbleSort(t, spO2Count);
  return t[spO2Count/2];
}

int medianFilterHR(int val) {
  if (val < 30 || val > 180)
    return (hrCount > 0) ?
      hrWindow[(hrWinIdx-1+MEDIAN_SIZE)%MEDIAN_SIZE] : 0;
  hrWindow[hrWinIdx] = val;
  hrWinIdx = (hrWinIdx+1) % MEDIAN_SIZE;
  if (hrCount < MEDIAN_SIZE) hrCount++;
  int t[MEDIAN_SIZE];
  for (int i = 0; i < hrCount; i++) t[i] = hrWindow[i];
  bubbleSort(t, hrCount);
  return t[hrCount/2];
}

// =============================================
//   OBJECTS
// =============================================
bool warmedUp = false;
MAX30105 particleSensor;
MPU6050  mpu(Wire);

const byte RATE_SIZE = 4;
byte  rates[RATE_SIZE];
byte  rateSpot = 0;
long  lastBeat = 0;
float beatsPerMinute = 0;
int   beatAvg  = 0;
int   finalHR  = 0;

#define SPO2_WINDOW 200
uint32_t redBuf[SPO2_WINDOW];
uint32_t irBuf[SPO2_WINDOW];
int  bufIdx    = 0;
bool bufFull   = false;
int  finalSpO2 = 0;

bool fallDetected  = false;
bool inactiveAlert = false;
bool tiltAlert     = false;
unsigned long lastMotionTime = 0;
unsigned long fallAlertTime  = 0;
unsigned long lastMPURead    = 0;

int   postureCode   = 0;
float prevTotalG    = 1.0;
int   walkStepCount = 0;
unsigned long lastStepTime  = 0;
unsigned long lastStepReset = 0;

int mq4PPM   = 0;
int mq7PPM   = 0;
int gasAlert  = 0;

unsigned long lastGasRead  = 0;
unsigned long startTime    = 0;
unsigned long lastLoRaSend = 0;
unsigned long lastPrint    = 0;

// =============================================
//   GAS PPM CALCULATION
// =============================================
float getMQ4PPM(int rawADC) {
  float voltage = rawADC * (3.3 / 4095.0);
  if (voltage < 0.1) return 0;
  float Rs    = (3.3 - voltage) / voltage * 10.0;
  float ratio = Rs / 4.54;
  return constrain(1012.7 * pow(ratio, -2.786), 0, 9999);
}

float getMQ7PPM(int rawADC) {
  float voltage = rawADC * (3.3 / 4095.0);
  if (voltage < 0.1) return 0;
  float Rs    = (3.3 - voltage) / voltage * 10.0;
  float ratio = Rs / 8.62;
  return constrain(99.042 * pow(ratio, -1.518), 0, 9999);
}

// =============================================
//   SpO2 CALCULATION
// =============================================
int calculateSpO2(uint32_t* red, uint32_t* ir, int len) {
  float redDC = 0, irDC = 0;
  for (int i = 0; i < len; i++) {
    redDC += red[i]; irDC += ir[i];
  }
  redDC /= len; irDC /= len;
  float redAC = 0, irAC = 0;
  for (int i = 0; i < len; i++) {
    float rd = (float)red[i] - redDC;
    float id = (float)ir[i]  - irDC;
    redAC += rd*rd; irAC += id*id;
  }
  redAC = sqrt(redAC/len);
  irAC  = sqrt(irAC/len);
  float irPI  = irAC  / irDC;
  float redPI = redAC / redDC;
  if (irPI < 0.001 || redPI < 0.001) return 0;
  float R    = (redAC/redDC) / (irAC/irDC);
  int   spo2 = 110 - (25 * R);
  if (spo2 > 100) spo2 = 100;
  if (spo2 < 85)  return 0;
  return spo2;
}

// =============================================
//   LED + BUZZER
// =============================================
void setLED(String s) {
  digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    LOW);
  if      (s == "SAFE")    digitalWrite(LED_GREEN,  HIGH);
  else if (s == "WARNING") digitalWrite(LED_YELLOW, HIGH);
  else if (s == "UNSAFE")  digitalWrite(LED_RED,    HIGH);
}

void beep(int times, int duration) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(duration);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times-1) delay(150);
  }
}

// =============================================
//   FALL + POSTURE DETECTION
// =============================================
void checkFall() {
  if (millis() - lastMPURead < 20) return;
  lastMPURead = millis();
  mpu.update();

  float axG    = mpu.getAccX();
  float ayG    = mpu.getAccY();
  float azG    = mpu.getAccZ();
  float totalG = sqrt(axG*axG + ayG*ayG + azG*azG);

  float tiltAngle = abs(mpu.getAngleX());
  if (abs(mpu.getAngleY()) > tiltAngle)
    tiltAngle = abs(mpu.getAngleY());

  float gyroMag = sqrt(
    mpu.getGyroX()*mpu.getGyroX() +
    mpu.getGyroY()*mpu.getGyroY() +
    mpu.getGyroZ()*mpu.getGyroZ()
  );

  if (totalG > FALL_THRESHOLD && !fallDetected) {
    fallDetected  = true;
    fallAlertTime = millis();
    postureCode   = 1;
    Serial.println("!!! FALL DETECTED !!!");
    Serial.print("Impact: "); Serial.print(totalG,2); Serial.println("g");
    setLED("UNSAFE"); beep(3, 300);
  }
  if (fallDetected && millis() - fallAlertTime > 30000) {
    fallDetected = false;
    Serial.println("Fall alert cleared.");
  }
  if (gyroMag > 10.0 || abs(totalG - 1.0) > 0.15) {
    lastMotionTime = millis();
    inactiveAlert  = false;
  }
  if (millis()-lastMotionTime > INACTIVE_TIMEOUT && !inactiveAlert) {
    inactiveAlert = true;
    postureCode   = 2;
    Serial.println("!!! INACTIVITY ALERT !!!");
    setLED("UNSAFE"); beep(4, 400);
  }
  if (tiltAngle > TILT_THRESHOLD && !fallDetected) {
    if (!tiltAlert) {
      tiltAlert   = true;
      postureCode = 3;
      Serial.print("!!! TILT ALERT !!! Angle: ");
      Serial.println(tiltAngle, 1);
      setLED("WARNING"); beep(2, 200);
    }
  } else if (tiltAngle <= TILT_THRESHOLD) {
    tiltAlert = false;
  }

  float gDelta = abs(totalG - prevTotalG);
  if (gDelta > 0.15 && gDelta < 0.8) {
    unsigned long now = millis();
    if (now - lastStepTime > 300) {
      walkStepCount++;
      lastStepTime = now;
    }
  }
  prevTotalG = totalG;

  if (millis() - lastStepReset > 2000) {
    lastStepReset = millis();
    if (walkStepCount >= 2) {
      if (!fallDetected && !inactiveAlert && !tiltAlert)
        postureCode = 4;
    } else {
      if (!fallDetected && !inactiveAlert && !tiltAlert)
        postureCode = 0;
    }
    walkStepCount = 0;
  }
  if (fallDetected)  postureCode = 1;
  if (inactiveAlert) postureCode = 2;

  static unsigned long lastMPUPrint = 0;
  if (millis() - lastMPUPrint > 2000) {
    lastMPUPrint = millis();
    Serial.print("MPU G=");     Serial.print(totalG, 2);
    Serial.print("g Tilt=");    Serial.print(tiltAngle, 1);
    Serial.print("deg Steps="); Serial.print(walkStepCount);
    Serial.print(" Posture=");
    if      (postureCode == 0) Serial.println("STANDING");
    else if (postureCode == 1) Serial.println("FALLEN");
    else if (postureCode == 2) Serial.println("STATIONARY");
    else if (postureCode == 3) Serial.println("TILT");
    else if (postureCode == 4) Serial.println("WALKING");
  }
}

// =============================================
//   GAS READING
// =============================================
void checkGas() {
  if (millis() - lastGasRead < 2000) return;
  lastGasRead = millis();
  if (!warmedUp) {
    unsigned long elapsed = millis() - startTime;
    if (elapsed < WARMUP_TIME) {
      int remaining = (WARMUP_TIME - elapsed) / 1000;
      if (remaining % 10 == 0) {
        Serial.print("MQ warmup: ");
        Serial.print(remaining);
        Serial.println("s remaining...");
      }
      return;
    }
    warmedUp = true;
    Serial.println("MQ sensors ready!");
    if (currentMode == MODE_PRE) {
      Serial.println("Press button to sample Level 1");
      beep(2, 300);
    }
  }

  mq4PPM = (int)getMQ4PPM(analogRead(MQ4_PIN));
  mq7PPM = (int)getMQ7PPM(analogRead(MQ7_PIN));

  bool mq4D = mq4PPM >= MQ4_DANGER;
  bool mq4W = mq4PPM >= MQ4_WARN && !mq4D;
  bool mq7D = mq7PPM >= MQ7_DANGER;
  bool mq7W = mq7PPM >= MQ7_WARN  && !mq7D;

  if      (mq4D && mq7D) gasAlert = 5;
  else if (mq7D)         gasAlert = 4;
  else if (mq4D)         gasAlert = 2;
  else if (mq7W)         gasAlert = 3;
  else if (mq4W)         gasAlert = 1;
  else                   gasAlert = 0;

  static unsigned long lastGasPrint = 0;
  if (millis() - lastGasPrint > 5000) {
    lastGasPrint = millis();
    Serial.print("GAS CH4: "); Serial.print(mq4PPM);
    Serial.print(" PPM  CO: "); Serial.print(mq7PPM);
    Serial.print(" PPM  ");
    if      (gasAlert == 5) Serial.println("!!! BOTH DANGER !!!");
    else if (gasAlert == 4) Serial.println("!!! CO DANGER !!!");
    else if (gasAlert == 3) Serial.println("! CO WARNING !");
    else if (gasAlert == 2) Serial.println("!!! CH4 DANGER !!!");
    else if (gasAlert == 1) Serial.println("! CH4 WARNING !");
    else                    Serial.println("OK");
  }
}

// =============================================
//   PRE-MONITORING: TAKE LEVEL SAMPLE
// =============================================
void takeSample(int lvl) {
  Serial.print("\n=== SAMPLING LEVEL ");
  Serial.print(lvl); Serial.println(" ===");
  Serial.println("Hold still for 2.5 seconds...");

  digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    LOW);

  int s4 = 0, s7 = 0;
  for (int i = 0; i < 5; i++) {
    s4 += (int)getMQ4PPM(analogRead(MQ4_PIN));
    s7 += (int)getMQ7PPM(analogRead(MQ7_PIN));
    delay(500);
  }
  levels[lvl-1].mq4   = s4 / 5;
  levels[lvl-1].mq7   = s7 / 5;
  levels[lvl-1].valid = true;
  currentLevel = lvl;

  Serial.print("Level "); Serial.print(lvl);
  Serial.print(" — CH4: "); Serial.print(levels[lvl-1].mq4);
  Serial.print(" PPM  CO: "); Serial.print(levels[lvl-1].mq7);
  Serial.println(" PPM");

  if (levels[lvl-1].mq4 >= MQ4_DANGER ||
      levels[lvl-1].mq7 >= MQ7_DANGER) {
    Serial.println("Level result: UNSAFE");
    setLED("UNSAFE");  beep(3, 400);
  } else if (levels[lvl-1].mq4 >= MQ4_WARN ||
             levels[lvl-1].mq7 >= MQ7_WARN) {
    Serial.println("Level result: WARNING");
    setLED("WARNING"); beep(2, 300);
  } else {
    Serial.println("Level result: SAFE");
    setLED("SAFE");    beep(lvl, 200);
  }

  delay(2000);

  if (lvl == 3) {
    analyzeAll();
  } else {
    Serial.print("Press button for Level ");
    Serial.println(lvl+1);
  }
}

// =============================================
//   PRE-MONITORING: ANALYZE ALL 3 LEVELS
// =============================================
void analyzeAll() {
  Serial.println("\n============================");
  Serial.println("  PRE-MONITORING ANALYSIS");
  Serial.println("============================");

  bool danger = false, warn = false;
  int  wMQ4 = 0, wMQ7 = 0, wLvl = 0;

  for (int i = 0; i < 3; i++) {
    if (!levels[i].valid) continue;
    Serial.print("Level "); Serial.print(i+1);
    Serial.print(": CH4="); Serial.print(levels[i].mq4);
    Serial.print(" CO=");   Serial.println(levels[i].mq7);

    if (levels[i].mq4 > wMQ4) { wMQ4 = levels[i].mq4; wLvl = i+1; }
    if (levels[i].mq7 > wMQ7)   wMQ7 = levels[i].mq7;

    if (levels[i].mq4 >= MQ4_DANGER || levels[i].mq7 >= MQ7_DANGER)
      danger = true;
    else if (levels[i].mq4 >= MQ4_WARN || levels[i].mq7 >= MQ7_WARN)
      warn = true;
  }

  digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    LOW);
  delay(500);

  Serial.println("----------------------------");
  if (danger) {
    preResult = "UNSAFE";
    Serial.println("VERDICT: *** UNSAFE ***");
    Serial.println("DO NOT ENTER THE SEWER!");
    Serial.print("Danger at level: "); Serial.println(wLvl);
    setLED("UNSAFE");
    beep(5, 500);
  } else if (warn) {
    preResult = "WARNING";
    Serial.println("VERDICT: *** WARNING ***");
    Serial.println("Enter with extreme caution");
    setLED("WARNING");
    beep(3, 300);
  } else {
    preResult = "SAFE";
    Serial.println("VERDICT: *** SAFE ***");
    Serial.println("Conditions acceptable");
    setLED("SAFE");
    beep(1, 1000);
  }

  Serial.println("----------------------------");
  Serial.print("Worst CH4: "); Serial.println(wMQ4);
  Serial.print("Worst CO : "); Serial.println(wMQ7);
  Serial.println("Hold button 3sec → Continuous");
  Serial.println("============================\n");

  allLevels = true;

  String p =
    "MODE:PRE"
    ",L1M4:" + String(levels[0].mq4) +
    ",L1M7:" + String(levels[0].mq7) +
    ",L2M4:" + String(levels[1].mq4) +
    ",L2M7:" + String(levels[1].mq7) +
    ",L3M4:" + String(levels[2].mq4) +
    ",L3M7:" + String(levels[2].mq7) +
    ",RES:"  + preResult;

  Serial.println(">> Sending: " + p);
  LoRa.beginPacket(); LoRa.print(p); LoRa.endPacket();
}

// =============================================
//   SWITCH MODE
// =============================================
void switchMode() {
  if (currentMode == MODE_PRE) {
    currentMode = MODE_CONTINUOUS;
    Serial.println("\n============================");
    Serial.println(" CONTINUOUS MONITORING MODE");
    Serial.println(" Wear device on bicep now");
    Serial.println("============================\n");
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED,    LOW);
    beep(2, 400);
    lastMotionTime = millis();
    memset(spO2Window, 0, sizeof(spO2Window));
    memset(hrWindow,   0, sizeof(hrWindow));
    memset(rates,      0, sizeof(rates));
    spO2Count  = 0; hrCount    = 0;
    spO2WinIdx = 0; hrWinIdx   = 0;
    finalHR    = 0; finalSpO2  = 0;
    bufIdx     = 0; bufFull    = false;
  } else {
    currentMode   = MODE_PRE;
    currentLevel  = 0;
    allLevels     = false;
    preResult     = "UNKNOWN";
    memset(levels, 0, sizeof(levels));
    Serial.println("\n============================");
    Serial.println(" PRE-MONITORING MODE");
    Serial.println("============================\n");
    setLED("SAFE");
    beep(1, 200);
  }
}

// =============================================
//   SETUP
// =============================================
void setup() {
  Serial.begin(115200);
  delay(500);
  startTime = millis();

  Serial.println("============================");
  Serial.println(" IOTians - Wearable Node");
  Serial.println(" Full Safety System v4");
  Serial.println("============================");

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("ERROR: LoRa FAILED!");
    while (1);
  }
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  Serial.println("LoRa OK");

  Wire.begin(21, 22);
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("ERROR: MAX30102 FAILED!");
    while (1);
  }
  particleSensor.setup(0x1F, 1, 2, 100, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x40);
  particleSensor.setPulseAmplitudeIR(0x10);
  Serial.println("MAX30102 OK");

  byte status = mpu.begin();
  if (status != 0) {
    Serial.println("ERROR: MPU6050 FAILED!");
    while (1);
  }
  Serial.println("Calibrating MPU6050...");
  Serial.println("Keep STILL for 3 seconds!");
  delay(3000);
  mpu.calcOffsets();
  lastMotionTime = millis();
  lastStepReset  = millis();
  Serial.println("MPU6050 OK");

  pinMode(MQ4_PIN,    INPUT);
  pinMode(MQ7_PIN,    INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_GREEN,  OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_RED,    OUTPUT);

  digitalWrite(LED_RED,    HIGH); delay(300); digitalWrite(LED_RED,    LOW);
  digitalWrite(LED_YELLOW, HIGH); delay(300); digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN,  HIGH); delay(300); digitalWrite(LED_GREEN,  LOW);
  digitalWrite(BUZZER_PIN, HIGH); delay(200); digitalWrite(BUZZER_PIN, LOW);

  Serial.println("============================");
  Serial.println("MODE: PRE-MONITORING");
  Serial.println("MQ warming up (3 min)...");
  Serial.println("Then press button per level:");
  Serial.println("Press 1 = Level 1 sample");
  Serial.println("Press 2 = Level 2 sample");
  Serial.println("Press 3 = Level 3 sample");
  Serial.println("Hold 3sec = switch mode");
  Serial.println("============================\n");
}

// =============================================
//   LOOP
// =============================================
void loop() {

  // =============================================
  //   BUTTON HANDLER
  // =============================================
  bool curBtn = (digitalRead(BUTTON_PIN) == LOW);
  if (curBtn != btnWasPressed) {
    if (millis() - lastDebounce > DEBOUNCE_MS) {
      lastDebounce = millis();
      if (curBtn) {
        btnPressTime = millis();
      } else {
        unsigned long dur = millis() - btnPressTime;
        if (dur >= LONG_PRESS_MS) {
          switchMode();
        } else {
          if (currentMode == MODE_PRE) {
            if (!warmedUp) {
              Serial.println("Wait for MQ warmup!");
              beep(1, 100);
            } else if (currentLevel < 3) {
              takeSample(currentLevel + 1);
            } else {
              Serial.println("All 3 levels done!");
              Serial.println("Hold 3sec to switch mode");
              beep(1, 100);
            }
          }
        }
      }
      btnWasPressed = curBtn;
    }
  }

  // Blink yellow while holding for long press
  if (curBtn && allLevels) {
    unsigned long hold = millis() - btnPressTime;
    if (hold > 1000 && hold < LONG_PRESS_MS) {
      static unsigned long lastBlink = 0;
      if (millis() - lastBlink > 200) {
        lastBlink = millis();
        digitalWrite(LED_YELLOW, !digitalRead(LED_YELLOW));
      }
    }
  }

  // =============================================
  //   PRE-MONITORING MODE
  // =============================================
  if (currentMode == MODE_PRE) {

    // Warmup check
    if (!warmedUp && millis()-startTime >= WARMUP_TIME) {
      warmedUp = true;
      Serial.println("MQ sensors ready!");
      Serial.println("Press button to sample Level 1");
      beep(2, 300);
      setLED("SAFE");
    }

    // *** KEY FIX — Keep LED showing result after all levels done ***
    if (allLevels) {
      if      (preResult == "SAFE")    setLED("SAFE");
      else if (preResult == "WARNING") setLED("WARNING");
      else if (preResult == "UNSAFE")  setLED("UNSAFE");
    }

    // Status print every 5 seconds
    static unsigned long lastPrePrint = 0;
    if (millis() - lastPrePrint > 5000) {
      lastPrePrint = millis();
      Serial.print("PRE-MODE | Levels: ");
      Serial.print(currentLevel); Serial.print("/3 | ");
      if (!warmedUp) {
        int r = (WARMUP_TIME-(millis()-startTime))/1000;
        Serial.print("Warmup: "); Serial.print(max(0,r)); Serial.println("s");
      } else if (!allLevels) {
        Serial.print("Press button for Level ");
        Serial.println(currentLevel+1);
      } else {
        Serial.print("Result: "); Serial.println(preResult);
        Serial.println("Hold 3sec → Continuous mode");
      }
    }
    return;
  }

  // =============================================
  //   CONTINUOUS MONITORING MODE
  // =============================================
  checkFall();
  checkGas();

  long irValue  = particleSensor.getIR();
  long redValue = particleSensor.getRed();
  bool fingerOn = (irValue > 50000);

  if (!fingerOn) {
    beatAvg    = 0;
    finalHR    = 0;
    finalSpO2  = 0;
    bufIdx     = 0;
    bufFull    = false;
    memset(rates,      0, sizeof(rates));
    memset(spO2Window, 0, sizeof(spO2Window));
    memset(hrWindow,   0, sizeof(hrWindow));
    spO2Count  = 0; hrCount    = 0;
    spO2WinIdx = 0; hrWinIdx   = 0;
  } else {
    if (checkForBeat(irValue)) {
      long delta = millis() - lastBeat;
      lastBeat = millis();
      beatsPerMinute = 60 / (delta / 1000.0);
      if (beatsPerMinute > 20 && beatsPerMinute < 200) {
        rates[rateSpot++] = (byte)beatsPerMinute;
        rateSpot %= RATE_SIZE;
        beatAvg = 0;
        for (byte x = 0; x < RATE_SIZE; x++) beatAvg += rates[x];
        beatAvg /= RATE_SIZE;
        finalHR = medianFilterHR(beatAvg);
      }
    }

    redBuf[bufIdx] = redValue;
    irBuf[bufIdx]  = irValue;
    bufIdx++;
    if (bufIdx >= SPO2_WINDOW) {
      bufIdx  = 0;
      bufFull = true;
      int raw = calculateSpO2(redBuf, irBuf, SPO2_WINDOW);
      if (raw > 0) {
        int f = medianFilterSpO2(raw);
        if (f > 0) finalSpO2 = f;
      }
    }
  }

  // Print + update LED every second
  if (millis() - lastPrint > 1000) {
    lastPrint = millis();
    Serial.print("HR: ");
    Serial.print(finalHR   > 0 ? String(finalHR)   + " BPM" : "Reading...");
    Serial.print("  SpO2: ");
    Serial.print(finalSpO2 > 0 ? String(finalSpO2) + " %"   : "Reading...");
    Serial.print("  Finger: "); Serial.print(fingerOn ? "YES" : "NO");
    if (fallDetected)  Serial.print("  !FALL!");
    if (inactiveAlert) Serial.print("  !INACTIVE!");
    if (tiltAlert)     Serial.print("  !TILT!");
    if (gasAlert > 0)  Serial.print("  !GAS!");
    Serial.println();

    // Update LED based on current status
    bool anyDanger =
      fallDetected || inactiveAlert ||
      gasAlert >= 4 ||
      (finalSpO2 > 0 && finalSpO2 < 90) ||
      (finalHR   > 0 && (finalHR < 50 || finalHR > 130));

    bool anyWarning =
      tiltAlert || gasAlert > 0 ||
      (finalSpO2 > 0 && finalSpO2 < 95) ||
      (finalHR   > 0 && (finalHR < 60 || finalHR > 120));

    if      (anyDanger)  setLED("UNSAFE");
    else if (anyWarning) setLED("WARNING");
    else                 setLED("SAFE");
  }

  // LoRa every 3 seconds
  if (millis() - lastLoRaSend > 3000) {
    lastLoRaSend = millis();

    int motionAlert = 0;
    if (fallDetected  && !inactiveAlert) motionAlert = 1;
    if (inactiveAlert && !fallDetected)  motionAlert = 2;
    if (tiltAlert && !fallDetected
                  && !inactiveAlert)     motionAlert = 3;
    if ((fallDetected || inactiveAlert)
         && tiltAlert)                   motionAlert = 4;

    String payload =
      "MODE:CONT"
      ",HR:"  + String(finalHR)                  +
      ",SP:"  + String(finalSpO2)                 +
      ",FNG:" + String(fingerOn    ? 1    : 0)    +
      ",AL:"  + String(motionAlert)               +
      ",PC:"  + String(postureCode)               +
      ",M4:"  + String(warmedUp    ? mq4PPM : -1) +
      ",M7:"  + String(warmedUp    ? mq7PPM : -1) +
      ",GA:"  + String(gasAlert);

    Serial.println(">> Sending: " + payload);
    LoRa.beginPacket();
    LoRa.print(payload);
    LoRa.endPacket();
  }
}