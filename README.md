# 🛡️ SMC LiveMonitor — Solapur Sanitation Worker Safety App

Real-time IoT safety monitoring app for sanitation workers of **Solapur Municipal Corporation**.

---

## COMPLETE SETUP GUIDE (Start to End)

---

## STEP 1 — Install Requirements on Your Laptop

### A) Node.js (Required)
1. Go to https://nodejs.org
2. Download **LTS version** (e.g. v20.x)
3. Install it. Verify with:
```
node --version    → should show v20.x.x
npm --version     → should show 10.x.x
```

### B) Expo CLI
```bash
npm install -g expo-cli eas-cli
```

### C) Git (for version control)
- Windows: https://git-scm.com/download/win
- Mac: `brew install git`

### D) Code Editor
- Download VS Code: https://code.visualstudio.com
- Install extensions: ESLint, Prettier, React Native Tools

### E) Expo Go App (for testing on your phone)
- Android: Search "Expo Go" on Play Store
- iOS: Search "Expo Go" on App Store

### F) Android Studio (Optional — for Android emulator)
- https://developer.android.com/studio
- After install, open AVD Manager and create a device

---

## STEP 2 — Firebase Setup

### A) Create Firebase Project
1. Go to https://console.firebase.google.com
2. Click **"Create a project"**
3. Name it: `surakshanet-smc`
4. Disable Google Analytics (optional for dev)
5. Click **Create**

### B) Enable Firebase Services

**Authentication:**
1. Go to **Authentication → Sign-in method**
2. Enable **Email/Password**
3. Click Save

**Create Manager Account:**
1. Go to **Authentication → Users → Add User**
2. Email: `smc-mgr-001@smc.solapur.gov.in`
3. Password: Choose a strong password
4. Copy the UID shown (you'll need it for seeding)

**Firestore Database:**
1. Go to **Firestore Database → Create database**
2. Select **Start in production mode**
3. Choose region: **asia-south1 (Mumbai)**
4. Click Enable

**Realtime Database:**
1. Go to **Realtime Database → Create database**
2. Choose **Start in locked mode**
3. Location: United States (default) or asia-southeast1

### C) Get Firebase Config
1. Go to **Project Settings** (⚙️ icon)
2. Under "Your apps" → Click **</>** (Web app icon)
3. App nickname: `smc-livemonitor-web`
4. Click "Register app"
5. **Copy the firebaseConfig object**

---

## STEP 3 — Project Setup

### A) Download/Clone the project
Place all these files in a folder called `smc-livemonitor`.

### B) Install dependencies
```bash
cd smc-livemonitor
npm install
```
Also install Google Fonts:
```bash
npx expo install @expo-google-fonts/poppins
```

### C) Add Firebase Config
Open `services/firebase.ts` and replace with your actual values:
```typescript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "surakshanet-smc.firebaseapp.com",
  databaseURL: "https://surakshanet-smc-default-rtdb.firebaseio.com",
  projectId: "surakshanet-smc",
  storageBucket: "surakshanet-smc.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef",
};
```

---

## STEP 4 — Seed Firebase with Test Data

### A) Update seed script
Open `scripts/seedFirebase.js`:
1. Add your `firebaseConfig`
2. Replace `mS3ZOxYDKOTZEUQ6xKrbcX9HxeM2` with the UID from Step 2C

### B) Run seed
```bash
node scripts/seedFirebase.js
```

You should see:
```
Manager seeded
 Workers seeded  
 Alerts seeded
 Sensor data seeded to Realtime DB
 Done!
```

### C) Apply Security Rules
1. Go to **Firestore → Rules** tab
2. Paste the Firestore rules from `firebase.rules`
3. Click Publish

4. Go to **Realtime Database → Rules** tab
5. Paste the Realtime DB rules from `firebase.rules`
6. Click Publish

---

## STEP 5 — Run the App

### On your phone (easiest):
```bash
npx expo start
```
- Scan QR code with **Expo Go** app
- App loads live on your phone!

### On Android Emulator:
```bash
npx expo start --android
```

### On iOS Simulator (Mac only):
```bash
npx expo start --ios
```

---

## STEP 6 — Test Login
- Employee ID: `SMC-MGR-001`
- Password: whatever you set in Step 2B

---

## STEP 7 — Connect Real Sensors (IoT)

Your Arduino/ESP32 should push data to Firebase like this:

```cpp
// Arduino sketch pseudocode
#include <WiFi.h>
#include <Firebase_ESP_Client.h>

void loop() {
  float gasLevel = analogRead(GAS_PIN) * 0.1;
  float temperature = dht.readTemperature();
  int heartRate = readHeartRate();
  bool sos = digitalRead(SOS_PIN) == HIGH;

  // Push to Firebase Realtime DB
  Firebase.RTDB.setFloat(&fbdo, "/sensors/w001/gasLevel", gasLevel);
  Firebase.RTDB.setFloat(&fbdo, "/sensors/w001/temperature", temperature);
  Firebase.RTDB.setInt(&fbdo, "/sensors/w001/heartRate", heartRate);
  Firebase.RTDB.setBool(&fbdo, "/sensors/w001/sosTriggered", sos);
  Firebase.RTDB.setInt(&fbdo, "/sensors/w001/lastUpdated", millis());

  // If gas > 100 OR SOS pressed → write alert to Firestore
  if (gasLevel > 100 || sos) {
    // Use Firebase Admin SDK (Node.js server) to write alerts
    // to Firestore /alerts collection
  }

  delay(5000); // Update every 5 seconds
}
```

The app will **automatically** update when new sensor data arrives.

---

##  Project File Structure

```
smc-livemonitor/
│
├── app/                          # All screens (Expo Router)
│   ├── _layout.tsx               # Root layout (fonts, splash)
│   ├── index.tsx                 # Home page (SMC-inspired)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx             # Manager login
│   └── (dashboard)/
│       ├── _layout.tsx           # Bottom tab navigator
│       ├── overview.tsx          # Main dashboard
│       ├── workers.tsx           # Workers list + details
│       ├── alerts.tsx            # Alerts management
│       ├── zones.tsx             # Zone overview
│       └── reports.tsx           # Analytics & export
│
├── components/
│   ├── StatCard.tsx              # Reusable stat widget
│   └── AlertItem.tsx             # Alert list item
│
├── constants/
│   ├── theme.ts                  # Colors, fonts, spacing
│   └── translations.ts           # English + Marathi strings
│
├── services/
│   ├── firebase.ts               # Firebase init (ADD YOUR CONFIG)
│   ├── authService.ts            # Login, logout, biometric
│   └── sensorService.ts          # Firebase listeners, types
│
├── store/
│   └── useStore.ts               # Zustand global state
│
├── scripts/
│   └── seedFirebase.js           # One-time DB seeder
│
├── assets/images/                # App icons, splash (add PNG files)
├── app.json                      # Expo config
├── babel.config.js
├── tsconfig.json
├── package.json                  # All dependencies
└── firebase.rules                # Security rules
```

---

##  Key Dependencies

| Package | Purpose |
|---------|---------|
| `expo-router` | File-based navigation |
| `firebase` | Firestore + Realtime DB + Auth |
| `zustand` | Global state management |
| `expo-local-authentication` | Fingerprint/Face ID login |
| `expo-secure-store` | Secure credential storage |
| `expo-notifications` | Push alerts for SOS |
| `@expo-google-fonts/poppins` | Typography |
| `react-native-reanimated` | Smooth animations |

---

##  Build for Production (APK)

```bash
# Login to Expo
eas login

# Configure build
eas build:configure

# Build Android APK
eas build --platform android --profile preview

# Build for Play Store (AAB)
eas build --platform android --profile production
```

---

##  Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails | Delete `node_modules`, run again |
| Firebase Auth error | Check email format: `id@smc.solapur.gov.in` |
| Fonts not loading | Run `npx expo install @expo-google-fonts/poppins` |
| Metro bundler crash | Run `npx expo start --clear` |
| Biometric not showing | Only shows after first successful password login |
| Sensor data not updating | Check Realtime DB rules allow read for authenticated users |

---

##  Support
Built for **Solapur Municipal Corporation** — Sanitation Worker Safety Initiative 2025
