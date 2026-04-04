// scripts/seedFirebase.js
// NO admin SDK — uses client SDK only, no credentials needed
// Run: node scripts/seedFirebase.js

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, collection, addDoc, Timestamp } = require('firebase/firestore');
const { getDatabase, ref, set } = require('firebase/database');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// ── SMC-DEVICE PROJECT CONFIG ─────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBWy5cFJErABW_p59DHQkWIwLonQAtJtms",
  authDomain: "smc-device.firebaseapp.com",
  databaseURL: "https://smc-device-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smc-device",
  storageBucket: "smc-device.firebasestorage.app",
  messagingSenderId: "206492309326",
  appId: "1:206492309326:web:a909ae02a076c10331301f"
};

// ── YOUR LOGIN ────────────────────────────────────────────────
const MANAGER_EMAIL    = "vidushi.1023108@gmail.com";
const MANAGER_PASSWORD = "VIDUSHI@2005";   // ← fill this in
// ──────────────────────────────────────────────────────────────

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const rtdb = getDatabase(app);

const WORKERS = [
  { id: 'w001', name: 'Ramesh Patil',  nameMarathi: 'रमेश पाटील',  employeeId: 'SMC-2024-001', zone: 'north',   shift: 'morning',   phone: '9876543210', bloodGroup: 'B+',  emergencyContact: '9876543211' },
  { id: 'w002', name: 'Suresh Jadhav', nameMarathi: 'सुरेश जाधव',  employeeId: 'SMC-2024-002', zone: 'east',    shift: 'morning',   phone: '9876543212', bloodGroup: 'O+',  emergencyContact: '9876543213' },
  { id: 'w003', name: 'Priya Shinde',  nameMarathi: 'प्रिया शिंदे', employeeId: 'SMC-2024-003', zone: 'south',   shift: 'afternoon', phone: '9876543214', bloodGroup: 'A+',  emergencyContact: '9876543215' },
  { id: 'w004', name: 'Mahesh Kale',   nameMarathi: 'महेश काळे',    employeeId: 'SMC-2024-004', zone: 'west',    shift: 'morning',   phone: '9876543216', bloodGroup: 'AB+', emergencyContact: '9876543217' },
  { id: 'w005', name: 'Anita More',    nameMarathi: 'अनिता मोरे',   employeeId: 'SMC-2024-005', zone: 'central', shift: 'night',     phone: '9876543218', bloodGroup: 'B-',  emergencyContact: '9876543219' },
];

// ── SENSOR DATA — field names match EXACTLY what ESP32 pushes ──
// These match what your real w001 device already sends to Firebase
// (fall, finger, gas_alert, hr, last_seen, motion_alert, mq4_ppm, mq7_ppm, rssi, spo2, status)
const SENSOR_DATA = {
  w001: {
    mq4_ppm: 5,  mq7_ppm: 2,  hr: 78,  spo2: 98,
    fall: false, finger: 1,   gas_alert: 0, motion_alert: 0,
    sos: false,  rssi: -45,   posture: 'standing',
    status: 'SAFE',           mode: 'monitoring',
    manhole_id: 'MH-12',      zone: 'north',
    location_label: 'Deshpande Nagar Square',
    gps_lat: 17.7045,         gps_lng: 75.9115,
    last_seen: Date.now(),    gasWarming: false,
  },
  w002: {
    mq4_ppm: 18, mq7_ppm: 7,  hr: 105, spo2: 93,
    fall: false, finger: 1,   gas_alert: 3, motion_alert: 0,
    sos: false,  rssi: -78,   posture: 'standing',
    status: 'WARNING',        mode: 'monitoring',
    manhole_id: 'MH-48',      zone: 'east',
    location_label: 'Jath Road Circle',
    gps_lat: 17.6855,         gps_lng: 75.9155,
    last_seen: Date.now(),    gasWarming: false,
  },
  w003: {
    mq4_ppm: 2,  mq7_ppm: 1,  hr: 0,   spo2: 0,
    fall: false, finger: 0,   gas_alert: 0, motion_alert: 0,
    sos: false,  rssi: -55,   posture: 'standing',
    status: 'SAFE',           mode: 'premonitoring',
    manhole_id: 'MH-27',      zone: 'south',
    location_label: 'Railway Station South Gate',
    gps_lat: 17.6795,         gps_lng: 75.9045,
    last_seen: Date.now(),    gasWarming: false,
  },
  w004: {
    mq4_ppm: 30, mq7_ppm: 14, hr: 125, spo2: 88,
    fall: true,  finger: 1,   gas_alert: 5, motion_alert: 1,
    sos: true,   rssi: -82,   posture: 'fallen',
    status: 'DANGER',         mode: 'monitoring',
    manhole_id: 'MH-68',      zone: 'west',
    location_label: 'Industrial Area West Gate',
    gps_lat: 17.6935,         gps_lng: 75.8975,
    last_seen: Date.now(),    gasWarming: false,
  },
  w005: {
    mq4_ppm: 8,  mq7_ppm: 3,  hr: 82,  spo2: 97,
    fall: false, finger: 1,   gas_alert: 0, motion_alert: 0,
    sos: false,  rssi: -70,   posture: 'standing',
    status: 'SAFE',           mode: 'monitoring',
    manhole_id: 'MH-89',      zone: 'central',
    location_label: 'Central Bus Stand',
    gps_lat: 17.6892,         gps_lng: 75.9072,
    last_seen: Date.now(),    gasWarming: false,
  },
};

const ALERTS = [
  { workerId: 'w004', workerName: 'Mahesh Kale',   type: 'FALL',         value: 'Fall detected + SOS triggered', zone: 'west',    manholeId: 'MH-68', resolved: false },
  { workerId: 'w004', workerName: 'Mahesh Kale',   type: 'CH4_CRITICAL', value: '30 PPM',                        zone: 'west',    manholeId: 'MH-68', resolved: false },
  { workerId: 'w002', workerName: 'Suresh Jadhav', type: 'H2S_HIGH',     value: '7 PPM',                         zone: 'east',    manholeId: 'MH-48', resolved: false },
  { workerId: 'w002', workerName: 'Suresh Jadhav', type: 'SPO2_LOW',     value: 'SpO2 93%',                      zone: 'east',    manholeId: 'MH-48', resolved: false },
  { workerId: 'w001', workerName: 'Vidushi Bhardwaj',  type: 'SOS',          value: 'SOS Button Pressed',            zone: 'north', manholeId: 'MH-12', resolved: true, resolvedBy: 'Vidushi Bhardwaj' },
];

async function seed() {
  console.log('🌱 Seeding SMC-DEVICE Firebase...\n');

  // Step 1 — login to get UID
  console.log('🔐 Logging in...');
  let uid;
  try {
    const cred = await signInWithEmailAndPassword(auth, MANAGER_EMAIL, MANAGER_PASSWORD);
    uid = cred.user.uid;
    console.log(`✅ Logged in. UID: ${uid}\n`);
  } catch (e) {
    console.error('❌ Login failed:', e.message);
    console.log('   Make sure MANAGER_PASSWORD is correct in this script.');
    process.exit(1);
  }

  // Step 2 — manager profile in Firestore
  console.log('📝 Seeding manager profile...');
  await setDoc(doc(db, 'users', uid), {
    name: 'Vidushi Bhardwaj',
    employeeId: 'SMC-MGR-001',
    role: 'manager',
    zones: ['north', 'south', 'east', 'west', 'central'],
    phone: '9876500001',
    designation: 'Senior Sanitation Manager',
  });
  console.log('✅ Manager seeded\n');

  // Step 3 — workers in Firestore
  console.log('👷 Seeding workers...');
  for (const worker of WORKERS) {
    const { id, ...data } = worker;
    await setDoc(doc(db, 'workers', id), { ...data, managerId: uid });
    console.log(`   ✅ ${worker.name} (${id})`);
  }
  console.log('');

  // Step 4 — alerts in Firestore
  console.log('🚨 Seeding alerts...');
  for (const alert of ALERTS) {
    await addDoc(collection(db, 'alerts'), {
      ...alert,
      timestamp: Timestamp.now(),
      ...(alert.resolvedBy ? { resolvedAt: Timestamp.now() } : {}),
    });
    console.log(`   ✅ ${alert.type} — ${alert.workerName}`);
  }
  console.log('');

  // Step 5 — sensor data in Realtime DB
  console.log('📡 Seeding sensor data to Realtime Database...');
  for (const [workerId, data] of Object.entries(SENSOR_DATA)) {
    await set(ref(rtdb, `workers/${workerId}`), data);
    console.log(`   ✅ ${workerId} → ${data.status}`);
  }

  console.log('\n🎉 All done! SMC-DEVICE is fully seeded.');
  console.log('\n📊 Dashboard will show:');
  console.log('   🔴 w004 Mahesh Kale   → DANGER (fall + SOS + gas critical)');
  console.log('   🟡 w002 Suresh Jadhav → WARNING (gas + SpO2 low)');
  console.log('   🟢 w001 Ramesh Patil  → SAFE (your real ESP32 device)');
  console.log('   🟢 w003 Priya Shinde  → SAFE (pre-monitoring)');
  console.log('   🟢 w005 Anita More    → SAFE\n');
  process.exit(0);
}

seed().catch(e => {
  console.error('\n❌ Seed failed:', e.message);
  process.exit(1);
});
