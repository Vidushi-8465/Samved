// scripts/seedFirebase.js
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set } = require('firebase/database');
const { getAuth, createUserWithEmailAndPassword } = require('firebase/auth');
const { Timestamp } = require('firebase/firestore');
const admin = require('firebase-admin');


const firebaseConfig = {
  apiKey: "AIzaSyCUjpfnoTOSA1UugTBCtkhrB2a8f4h3vWA",
  authDomain: "surakshanet-smc.firebaseapp.com",
  databaseURL: "https://surakshanet-smc-default-rtdb.firebaseio.com",
  projectId: "surakshanet-smc",
  storageBucket: "surakshanet-smc.firebasestorage.app",
  messagingSenderId: "467586782312",
  appId: "1:467586782312:web:33b81f93b60cc61c9d57dd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const rtdb = getDatabase(app);
const auth = getAuth(app);

// Initialize Admin SDK (for Firestore writes that bypass security rules)
admin.initializeApp({
  projectId: firebaseConfig.projectId
});
const adminDb = admin.firestore();

const MANAGER_UID = 'mS3ZOxYDKOTZEUQ6xKrbcX9HxeM2'; // This will be replaced with actual UID

const WORKERS = [
  { id: 'w001', name: 'Ramesh Patil', nameMarathi: 'रमेश पाटील', employeeId: 'SMC-2024-001', zone: 'north', shift: 'morning', phone: '9876543210', managerId: MANAGER_UID, bloodGroup: 'B+', emergencyContact: '9876543211' },
  { id: 'w002', name: 'Suresh Jadhav', nameMarathi: 'सुरेश जाधव', employeeId: 'SMC-2024-002', zone: 'east', shift: 'morning', phone: '9876543212', managerId: MANAGER_UID, bloodGroup: 'O+', emergencyContact: '9876543213' },
  { id: 'w003', name: 'Priya Shinde', nameMarathi: 'प्रिया शिंदे', employeeId: 'SMC-2024-003', zone: 'south', shift: 'afternoon', phone: '9876543214', managerId: MANAGER_UID, bloodGroup: 'A+', emergencyContact: '9876543215' },
  { id: 'w004', name: 'Mahesh Kale', nameMarathi: 'महेश काळे', employeeId: 'SMC-2024-004', zone: 'west', shift: 'morning', phone: '9876543216', managerId: MANAGER_UID, bloodGroup: 'AB+', emergencyContact: '9876543217' },
  { id: 'w005', name: 'Anita More', nameMarathi: 'अनिता मोरे', employeeId: 'SMC-2024-005', zone: 'central', shift: 'night', phone: '9876543218', managerId: MANAGER_UID, bloodGroup: 'B-', emergencyContact: '9876543219' },
];

// ── Sensor data now includes CH4, H2S, SpO2, fall detection ──
const SENSOR_DATA = {
  w001: {
    ch4: 5.2, h2s: 2.1, heartRate: 78, spO2: 98,
    fallDetected: false, workerPosture: 'standing',
    manholeId: 'MH-02', zone: 'north',
    locationLabel: 'Ward 2 Main Line',
    lastGpsLat: 17.6980, lastGpsLng: 75.9080,
    sosTriggered: false, mode: 'monitoring', lastUpdated: Date.now()
  },
  w002: {
    ch4: 18.5, h2s: 7.4, heartRate: 105, spO2: 93,
    fallDetected: false, workerPosture: 'standing',
    manholeId: 'MH-05', zone: 'east',
    locationLabel: 'Hutatma Chowk',
    lastGpsLat: 17.6870, lastGpsLng: 75.9120,
    sosTriggered: false, mode: 'monitoring', lastUpdated: Date.now()
  },
  w003: {
    ch4: 2.1, h2s: 1.0, heartRate: 72, spO2: 99,
    fallDetected: false, workerPosture: 'standing',
    manholeId: 'MH-03', zone: 'south',
    locationLabel: 'Akkalkot Road Entry',
    lastGpsLat: 17.6820, lastGpsLng: 75.9050,
    sosTriggered: false, mode: 'premonitoring', lastUpdated: Date.now()
  },
  w004: {
    ch4: 30.8, h2s: 14.2, heartRate: 125, spO2: 88,
    fallDetected: true, workerPosture: 'fallen',
    manholeId: 'MH-07', zone: 'west',
    locationLabel: 'Pandharpur Road Main',
    lastGpsLat: 17.6910, lastGpsLng: 75.9000,
    sosTriggered: true, mode: 'monitoring', lastUpdated: Date.now()
  },
  w005: {
    ch4: 8.0, h2s: 3.5, heartRate: 82, spO2: 97,
    fallDetected: false, workerPosture: 'moving',
    manholeId: 'MH-09', zone: 'central',
    locationLabel: 'Mangalwar Peth Centre',
    lastGpsLat: 17.6890, lastGpsLng: 75.9070,
    sosTriggered: false, mode: 'monitoring', lastUpdated: Date.now()
  },
};

const SAMPLE_ALERTS = [
  {
    id: 'a001', workerId: 'w004', workerName: 'Mahesh Kale',
    type: 'FALL', value: 'Fall detected + SOS triggered',
    zone: 'west', manholeId: 'MH-07',
    timestamp: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
    resolved: false
  },
  {
    id: 'a002', workerId: 'w004', workerName: 'Mahesh Kale',
    type: 'CH4_CRITICAL', value: '30.8% LEL',
    zone: 'west', manholeId: 'MH-07',
    timestamp: Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000)),
    resolved: false
  },
  {
    id: 'a003', workerId: 'w002', workerName: 'Suresh Jadhav',
    type: 'H2S_HIGH', value: '7.4 PPM',
    zone: 'east', manholeId: 'MH-05',
    timestamp: Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000)),
    resolved: false
  },
  {
    id: 'a004', workerId: 'w002', workerName: 'Suresh Jadhav',
    type: 'SPO2_LOW', value: 'SpO2 93%',
    zone: 'east', manholeId: 'MH-05',
    timestamp: Timestamp.fromDate(new Date(Date.now() - 31 * 60 * 1000)),
    resolved: false
  },
  {
    id: 'a005', workerId: 'w001', workerName: 'Ramesh Patil',
    type: 'SOS', value: 'SOS Button Pressed',
    zone: 'north', manholeId: 'MH-02',
    timestamp: Timestamp.fromDate(new Date(Date.now() - 3 * 60 * 60 * 1000)),
    resolved: true, resolvedBy: 'Manager', resolvedAt: Timestamp.fromDate(new Date(Date.now() - 2.5 * 60 * 60 * 1000))
  },
];

const MANAGER = {
  uid: 'mS3ZOxYDKOTZEUQ6xKrbcX9HxeM2', 
  name: 'Vidushi Bhardwaj',
  employeeId: 'SMC-MGR-001',
  role: 'manager',
  zones: ['north', 'south', 'east', 'west', 'central'],
  phone: '9876500001',
  designation: 'Senior Sanitation Manager',
};

async function seed() {
  console.log('🌱 Seeding Firebase with updated sensor schema...\n');

  // Create Firebase Auth user for manager
  try {
    const email = `${MANAGER.employeeId}@gmail.com`;
    const password = 'manager123'; // Default password for demo
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log(`✅ Firebase Auth user created: ${email} (UID: ${userCredential.user.uid})`);
    
    // Update MANAGER object with actual UID
    MANAGER.uid = userCredential.user.uid;
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      console.log('ℹ️  Manager user already exists in Firebase Auth');
    } else {
      console.error('❌ Error creating manager user:', error.message);
      throw error;
    }
  }

  await adminDb.collection('users').doc(MANAGER.uid).set(MANAGER);
  console.log('✅ Manager profile seeded in Firestore');

  for (const worker of WORKERS) {
    const { id, ...data } = worker;
    // Update managerId to actual UID
    data.managerId = MANAGER.uid;
    await adminDb.collection('workers').doc(id).set(data);
  }
  console.log('✅ Workers seeded (5 workers)');

  for (const alert of SAMPLE_ALERTS) {
    const { id, ...data } = alert;
    await adminDb.collection('alerts').doc(id).set(data);
  }
  console.log('✅ Alerts seeded (includes FALL, CH4, H2S, SpO2 alerts)');

  for (const [workerId, data] of Object.entries(SENSOR_DATA)) {
    await set(ref(rtdb, `sensors/${workerId}`), data);
  }
  console.log('✅ Sensor data seeded to Realtime DB');
  console.log('   → w004 (Mahesh Kale) is in DANGER state with fall + SOS triggered');
  console.log('   → w002 (Suresh Jadhav) is in WARNING state');
  console.log('   → w001, w003, w005 are SAFE\n');

  console.log('🎉 Done! Firebase is ready with full sensor schema.');
  console.log('\n📡 Firebase Realtime DB structure:');
  console.log('sensors/');
  console.log('  {workerId}/');
  console.log('    ch4: number          (% LEL)');
  console.log('    h2s: number          (PPM)');
  console.log('    heartRate: number    (BPM)');
  console.log('    spO2: number         (%)');
  console.log('    fallDetected: bool');
  console.log('    workerPosture: standing|stationary|fallen');
  console.log('    manholeId: string    (e.g. MH-05)');
  console.log('    zone: string');
  console.log('    locationLabel: string');
  console.log('    lastGpsLat: number');
  console.log('    lastGpsLng: number');
  console.log('    sosTriggered: bool');
  console.log('    mode: premonitoring|monitoring');
  console.log('    lastUpdated: timestamp');
  process.exit(0);
}

seed().catch(console.error);
