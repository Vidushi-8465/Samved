// services/sensorService.ts
import { ref, onValue, off, DataSnapshot } from 'firebase/database';
import { collection, onSnapshot, query, where, orderBy, limit, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { rtdb, db } from './firebase';

// ── Sensor Data — matches exactly what receiver pushes ────────
export interface SensorData {
  workerId: string;
  // Gas sensors
  ch4: number;            // CH4 PPM (MQ4)
  h2s: number;            // CO PPM (MQ7) — your MQ7 reads CO
  gasAlert: number;       // 0=safe 1=ch4warn 2=ch4danger 3=cowarn 4=codanger 5=both
  gasWarming: boolean;    // true = sensors still warming up
  // Worker vitals
  heartRate: number;      // BPM (0 = no finger)
  spO2: number;           // % (0 = no finger)
  fingerOn: number;       // 1 = finger on sensor
  // Motion / fall
  motionAlert: number;    // 0=normal 1=fall 2=inactive 3=tilt 4=multiple
  fallDetected: boolean;
  workerPosture: string;  // standing | stationary | tilted | fallen
  sosTriggered: boolean;
  // Signal
  rssi: number;           // LoRa signal strength dBm
  // Location
  manholeId: string;
  zone: string;
  locationLabel: string;
  lastGpsLat: number;
  lastGpsLng: number;
  // Mode + status
  mode: 'premonitoring' | 'monitoring';
  safetyStatus: string;
  lastUpdated: number;
}

export interface WorkerProfile {
  id: string;
  name: string;
  nameMarathi: string;
  employeeId: string;
  zone: string;
  shift: 'morning' | 'afternoon' | 'night';
  phone: string;
  managerId: string;
  bloodGroup?: string;
  emergencyContact?: string;
}

export interface Alert {
  id: string;
  workerId: string;
  workerName: string;
  type: 'SOS' | 'FALL' | 'CH4_HIGH' | 'CH4_CRITICAL' | 'H2S_HIGH' |
        'H2S_CRITICAL' | 'SPO2_LOW' | 'SPO2_CRITICAL' | 'HEARTRATE' | 'INACTIVITY';
  value: string;
  zone: string;
  manholeId: string;
  timestamp: Timestamp;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Timestamp;
}

export type SafetyStatus = 'safe' | 'warning' | 'danger' | 'offline';

// ── Status from sensor data ───────────────────────────────────
export interface SensorStatus {
  overall: SafetyStatus;
  ch4: SafetyStatus;
  h2s: SafetyStatus;
  heartRate: SafetyStatus;
  spO2: SafetyStatus;
  fall: SafetyStatus;
  signal: SafetyStatus;
}

export const getSensorStatus = (sensor: SensorData): SensorStatus => {
  // CH4 (MQ4) thresholds — PPM based
  const ch4: SafetyStatus =
    sensor.ch4 >= 10000 ? 'danger' :
    sensor.ch4 >= 5000 ? 'warning' : 'safe';

  // CO (MQ7) thresholds — PPM based
  const h2s: SafetyStatus =
    sensor.h2s >= 50 ? 'danger' :
    sensor.h2s >= 30 ? 'warning' : 'safe';

  // Heart rate
  const heartRate: SafetyStatus =
    sensor.heartRate > 0 && (sensor.heartRate < 50 || sensor.heartRate > 120) ? 'danger' :
    sensor.heartRate > 0 && (sensor.heartRate < 60 || sensor.heartRate > 100) ? 'warning' : 'safe';

  // SpO2
  const spO2: SafetyStatus =
    sensor.spO2 > 0 && sensor.spO2 < 90 ? 'danger' :
    sensor.spO2 > 0 && sensor.spO2 < 95 ? 'warning' : 'safe';

  // Fall / motion
  const fall: SafetyStatus =
    sensor.fallDetected || sensor.sosTriggered || sensor.motionAlert === 1 || sensor.motionAlert === 4 ? 'danger' :
    sensor.motionAlert === 2 || sensor.motionAlert === 3 ? 'warning' : 'safe';

  // LoRa signal
  const signal: SafetyStatus =
    sensor.rssi < -100 ? 'warning' : 'safe';

  const statuses = [ch4, h2s, heartRate, spO2, fall];
  const overall: SafetyStatus =
    statuses.includes('danger') ? 'danger' :
    statuses.includes('warning') ? 'warning' : 'safe';

  return { overall, ch4, h2s, heartRate, spO2, fall, signal };
};

export const getSafetyStatus = (sensor: SensorData): SafetyStatus =>
  getSensorStatus(sensor).overall;

// ── Gas alert level to text ───────────────────────────────────
export const getGasAlertText = (gasAlert: number, gasWarming: boolean): string => {
  if (gasWarming) return 'Warming up...';
  switch (gasAlert) {
    case 5: return 'BOTH CRITICAL';
    case 4: return 'CO CRITICAL';
    case 3: return 'CO Warning';
    case 2: return 'CH4 CRITICAL';
    case 1: return 'CH4 Warning';
    default: return 'Normal';
  }
};

// ── Firebase Listeners ────────────────────────────────────────
export const listenToWorkerSensor = (
  workerId: string,
  callback: (data: SensorData | null) => void
) => {
  const sensorRef = ref(rtdb, `sensors/${workerId}`);
  onValue(sensorRef, (snapshot: DataSnapshot) => {
    if (snapshot.exists()) {
      const raw = snapshot.val();
      const sensor: SensorData = {
        workerId,
        ch4: raw.mq4_ppm ?? 0,
        h2s: raw.mq7_ppm ?? 0,
        gasAlert: raw.gas_alert ?? 0,
        gasWarming: raw.gasWarming ?? false,
        heartRate: raw.hr ?? 0,
        spO2: raw.spo2 ?? 0,
        fingerOn: raw.finger ?? 0,
        motionAlert: raw.motion_alert ?? 0,
        fallDetected: raw.fall ?? false,
        workerPosture: raw.posture ?? 'standing',
        sosTriggered: raw.sos ?? false,
        rssi: raw.rssi ?? -100,
        manholeId: raw.manhole_id ?? '—',
        zone: raw.zone ?? '—',
        locationLabel: raw.location_label ?? '—',
        lastGpsLat: raw.gps_lat ?? 0,
        lastGpsLng: raw.gps_lng ?? 0,
        mode: raw.mode ?? 'premonitoring',
        safetyStatus: raw.status ?? 'NORMAL',
        lastUpdated: raw.last_seen ?? 0,
      };
      callback(sensor);
    } else {
      callback(null);
    }
  });
  return () => off(sensorRef);
};

export const listenToAllSensors = (
  workerIds: string[],
  callback: (data: Record<string, SensorData>) => void
) => {
  const sensorsRef = ref(rtdb, 'sensors');
  onValue(sensorsRef, (snapshot: DataSnapshot) => {
    if (snapshot.exists()) {
      const all = snapshot.val();
      const filtered: Record<string, SensorData> = {};
      
      workerIds.forEach(id => {
        if (all[id]) {
          const raw = all[id];
          // Map Firebase field names to SensorData interface
          filtered[id] = {
            workerId: id,
            ch4: raw.mq4_ppm ?? 0,           // CH4 from MQ4
            h2s: raw.mq7_ppm ?? 0,           // H2S from MQ7
            gasAlert: raw.gas_alert ?? 0,
            gasWarming: raw.gasWarming ?? false,
            heartRate: raw.hr ?? 0,          // Heart rate
            spO2: raw.spo2 ?? 0,             // SpO2 percentage
            fingerOn: raw.finger ?? 0,       // Finger detection
            motionAlert: raw.motion_alert ?? 0,
            fallDetected: raw.fall ?? false,
            workerPosture: raw.posture ?? 'standing',
            sosTriggered: raw.sos ?? false,
            rssi: raw.rssi ?? -100,
            manholeId: raw.manhole_id ?? '—',
            zone: raw.zone ?? '—',
            locationLabel: raw.location_label ?? '—',
            lastGpsLat: raw.gps_lat ?? 0,
            lastGpsLng: raw.gps_lng ?? 0,
            mode: raw.mode ?? 'premonitoring',
            safetyStatus: raw.status ?? 'NORMAL',
            lastUpdated: raw.last_seen ?? 0,
          };
        }
      });
      
      console.log('Sensors loaded for workers:', Object.keys(filtered));
      callback(filtered);
    } else {
      console.log('No sensor data found in RTDB');
    }
  });
  return () => off(sensorsRef);
};

export const listenToWorkers = (
  managerId: string,
  callback: (workers: WorkerProfile[]) => void
) => {
  const q = query(collection(db, 'workers'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => {
    const workers = snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkerProfile));
    console.log('Workers from Firestore:', workers.length);
    callback(workers);
  });
};

export const listenToAlerts = (
  zones: string[],
  callback: (alerts: Alert[]) => void
) => {
  // Firestore requires a composite index for "in" + "orderBy" queries.
  // To avoid requiring manual index creation, we fetch the matching documents
  // without ordering and sort/limit on the client.
  const q = query(
    collection(db, 'alerts'),
    where('zone', 'in', zones.length > 0 ? zones : ['__none__'])
  );

  return onSnapshot(
    q,
    (snap) => {
      const alerts = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Alert))
        .sort((a, b) => {
          const aTs = (a.timestamp as any)?.toMillis?.() ?? 0;
          const bTs = (b.timestamp as any)?.toMillis?.() ?? 0;
          return bTs - aTs;
        })
        .slice(0, 50);
      console.log('Alerts from Firestore:', alerts.length);
      callback(alerts);
    },
    (error) => {
      // Swallow errors to avoid crashes on mobile; can be inspected in debug logs.
      console.warn('listenToAlerts error', error);
    }
  );
};

export const resolveAlert = async (alertId: string, resolvedBy: string) => {
  await updateDoc(doc(db, 'alerts', alertId), {
    resolved: true,
    resolvedBy,
    resolvedAt: Timestamp.now(),
  });
};

// ── Solapur Zones ─────────────────────────────────────────────
export const SOLAPUR_ZONES = [
  { id: 'north',   name: 'North Zone',   nameMarathi: 'उत्तर विभाग',  color: '#3498DB', wards: ['Ward 1', 'Ward 2', 'Ward 3', 'Hotgi Road'] },
  { id: 'south',   name: 'South Zone',   nameMarathi: 'दक्षिण विभाग', color: '#2ECC71', wards: ['Ward 4', 'Ward 5', 'Akkalkot Road', 'Vijapur Road'] },
  { id: 'east',    name: 'East Zone',    nameMarathi: 'पूर्व विभाग',   color: '#E67E22', wards: ['Ward 6', 'Ward 7', 'Hutatma Chowk', 'Osmanabad Naka'] },
  { id: 'west',    name: 'West Zone',    nameMarathi: 'पश्चिम विभाग',  color: '#9B59B6', wards: ['Ward 8', 'Ward 9', 'Pandharpur Road', 'Bijapur Road'] },
  { id: 'central', name: 'Central Zone', nameMarathi: 'मध्य विभाग',   color: '#E74C3C', wards: ['Ward 10', 'Ward 11', 'Mangalwar Peth', 'Budhwar Peth'] },
];

export const SOLAPUR_MANHOLES = [
  { id: 'MH-01', zone: 'north',   label: 'Hotgi Road Junction',   lat: 17.7010, lng: 75.9100 },
  { id: 'MH-02', zone: 'north',   label: 'Ward 2 Main Line',      lat: 17.6980, lng: 75.9080 },
  { id: 'MH-03', zone: 'south',   label: 'Akkalkot Road Entry',   lat: 17.6820, lng: 75.9050 },
  { id: 'MH-04', zone: 'south',   label: 'Vijapur Road Crossing', lat: 17.6790, lng: 75.9020 },
  { id: 'MH-05', zone: 'east',    label: 'Hutatma Chowk',         lat: 17.6870, lng: 75.9120 },
  { id: 'MH-06', zone: 'east',    label: 'Osmanabad Naka',        lat: 17.6850, lng: 75.9150 },
  { id: 'MH-07', zone: 'west',    label: 'Pandharpur Road Main',  lat: 17.6910, lng: 75.9000 },
  { id: 'MH-08', zone: 'west',    label: 'Bijapur Road Junction', lat: 17.6930, lng: 75.8970 },
  { id: 'MH-09', zone: 'central', label: 'Mangalwar Peth Centre', lat: 17.6890, lng: 75.9070 },
  { id: 'MH-10', zone: 'central', label: 'Budhwar Peth Main',     lat: 17.6870, lng: 75.9060 },
];