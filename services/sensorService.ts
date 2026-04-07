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
  co?: number;            // Alias used by some dashboard cards
  gasAlert: number;       // 0=safe 1=ch4warn 2=ch4danger 3=cowarn 4=codanger 5=both
  gasWarming: boolean;    // true = sensors still warming up
  // Worker vitals
  heartRate: number;      // BPM (0 = no finger)
  spO2: number;           // % (0 = no finger)
  fingerOn: number;       // 1 = finger on sensor
  // Motion / fall
  motionAlert: number;    // 0=normal 1=fall 2=inactive 3=tilt 4=multiple
  fallDetected: boolean;
  fallAlert?: boolean;
  workerPosture: string;  // standing | stationary | tilted | fallen
  sosTriggered: boolean;
  sosAlert?: boolean;
  // Signal
  rssi: number;           // LoRa signal strength dBm
  // Location
  manholeId: string;
  zone: string;
  locationLabel: string;
  lastGpsLat: number;
  lastGpsLng: number;
  batteryLevel?: number;
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
  type: 'SOS' | 'FALL' | 'GAS_HIGH' | 'GAS_CRITICAL' | 'TEMPERATURE' | 'CH4_HIGH' | 'CH4_CRITICAL' | 'H2S_HIGH' |
        'H2S_CRITICAL' | 'SPO2_LOW' | 'SPO2_CRITICAL' | 'HEARTRATE' | 'INACTIVITY';
  value: string;
  zone: string;
  manholeId: string;
  timestamp: Timestamp;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Timestamp;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Timestamp;
  escalationLevel: 'manager' | 'supervisor' | 'emergency';
}

export type SafetyStatus = 'safe' | 'warning' | 'danger' | 'offline';

export const SENSOR_THRESHOLDS = {
  ch4: {
    warningMin: 100,
    dangerMin: 200,
    unit: 'ppm',
  },
  co: {
    warningMin: 50,
    dangerMin: 200,
    unit: 'ppm',
  },
  heartRate: {
    warningLow: 60,
    warningHigh: 120,
    dangerLow: 50,
    dangerHigh: 130,
    unit: 'BPM',
  },
  spO2: {
    warningMin: 95,
    dangerMin: 90,
    unit: '%',
  },
  signal: {
    warningBelow: -100,
    unit: 'dBm',
  },
} as const;

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
  const coValue = sensor.co ?? sensor.h2s;

  // CH4 (MQ4) thresholds — PPM based
  const ch4: SafetyStatus =
    sensor.ch4 >= SENSOR_THRESHOLDS.ch4.dangerMin ? 'danger' :
    sensor.ch4 >= SENSOR_THRESHOLDS.ch4.warningMin ? 'warning' : 'safe';

  // CO (MQ7) thresholds — PPM based
  const h2s: SafetyStatus =
    coValue >= SENSOR_THRESHOLDS.co.dangerMin ? 'danger' :
    coValue >= SENSOR_THRESHOLDS.co.warningMin ? 'warning' : 'safe';

  // Heart rate
  const heartRate: SafetyStatus =
    sensor.heartRate > 0 && (sensor.heartRate < SENSOR_THRESHOLDS.heartRate.dangerLow || sensor.heartRate > SENSOR_THRESHOLDS.heartRate.dangerHigh) ? 'danger' :
    sensor.heartRate > 0 && (sensor.heartRate < SENSOR_THRESHOLDS.heartRate.warningLow || sensor.heartRate > SENSOR_THRESHOLDS.heartRate.warningHigh) ? 'warning' : 'safe';

  // SpO2
  const spO2: SafetyStatus =
    sensor.spO2 > 0 && sensor.spO2 < SENSOR_THRESHOLDS.spO2.dangerMin ? 'danger' :
    sensor.spO2 > 0 && sensor.spO2 < SENSOR_THRESHOLDS.spO2.warningMin ? 'warning' : 'safe';

  // Fall / motion
  const fall: SafetyStatus =
    sensor.fallDetected || sensor.sosTriggered || sensor.motionAlert === 1 || sensor.motionAlert === 4 ? 'danger' :
    sensor.motionAlert === 2 || sensor.motionAlert === 3 ? 'warning' : 'safe';

  // LoRa signal
  const signal: SafetyStatus =
    sensor.rssi < SENSOR_THRESHOLDS.signal.warningBelow ? 'warning' : 'safe';

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
        co: raw.mq7_ppm ?? 0,
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
            co: raw.mq7_ppm ?? 0,
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

export const listenToPreMonitor = (
  workerId: string,
  callback: (data: any) => void
) => {
  const preRef = ref(rtdb, `sensors/${workerId}/pre_monitor`);
  onValue(preRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
  return () => off(preRef);
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

export const acknowledgeAlert = async (alertId: string, acknowledgedBy: string) => {
  await updateDoc(doc(db, 'alerts', alertId), {
    acknowledged: true,
    acknowledgedBy,
    acknowledgedAt: Timestamp.now(),
  });
};

export const resolveAlert = async (alertId: string, resolvedBy: string) => {
  await updateDoc(doc(db, 'alerts', alertId), {
    resolved: true,
    resolvedBy,
    resolvedAt: Timestamp.now(),
  });
};

export const predictSafeDuration = async (sensor: SensorData | null, worker: WorkerProfile | null): Promise<string | null> => {
  if (!sensor || !worker) return null;
  
  try {
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:5000';
    
    const prompt = `Given a sewer worker in zone "${sensor.zone}", provide a brief safety estimate:
- Current HR: ${sensor.heartRate} BPM
- Current SpO₂: ${sensor.spO2}%
- CH₄: ${sensor.ch4.toFixed(1)} ppm
- CO (MQ7): ${sensor.h2s.toFixed(1)} ppm
- Worker: ${worker.name}, Blood Group: ${worker.bloodGroup || 'Unknown'}

Based on these vitals and gas levels, estimate how long this worker can safely remain inside the sewer safely without risking health. Respond with ONLY a single line: "Safe Duration: X minutes" and 1-2 words reason (e.g., "Safe Duration: 45 minutes - moderate CH4").`;

    const response = await fetch(`${backendUrl}/ai-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      console.warn('AI analysis failed:', response.status);
      return null;
    }

    const data = await response.json();
    const result = data?.result || null;
    
    // Extract just the duration line if multiple lines returned
    if (result && typeof result === 'string') {
      return result.split('\n')[0].trim();
    }
    
    return result;
  } catch (error) {
    console.warn('Safe duration prediction error:', error);
    return null;
  }
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
  // ── NORTH ZONE (MH-01 to MH-20) ──
  { id: 'MH-01', zone: 'north',   label: 'Hotgi Road Junction',        lat: 17.7010, lng: 75.9100 },
  { id: 'MH-02', zone: 'north',   label: 'Ward 2 Main Line',           lat: 17.6980, lng: 75.9080 },
  { id: 'MH-03', zone: 'north',   label: 'Bale Nagar Colony',          lat: 17.7020, lng: 75.9120 },
  { id: 'MH-04', zone: 'north',   label: 'Kamgar Putala Circle',       lat: 17.7040, lng: 75.9090 },
  { id: 'MH-05', zone: 'north',   label: 'Ashoka Chowk North',         lat: 17.7000, lng: 75.9110 },
  { id: 'MH-06', zone: 'north',   label: 'MIDC Industrial Area',       lat: 17.7060, lng: 75.9140 },
  { id: 'MH-07', zone: 'north',   label: 'Navi Peth Entry',            lat: 17.7030, lng: 75.9070 },
  { id: 'MH-08', zone: 'north',   label: 'Bhagwat Hospital Road',      lat: 17.7050, lng: 75.9105 },
  { id: 'MH-09', zone: 'north',   label: 'Government Hospital Area',   lat: 17.7015, lng: 75.9125 },
  { id: 'MH-10', zone: 'north',   label: 'Textile Mill Junction',      lat: 17.6995, lng: 75.9095 },
  { id: 'MH-11', zone: 'north',   label: 'Railway Staff Colony',       lat: 17.7025, lng: 75.9085 },
  { id: 'MH-12', zone: 'north',   label: 'Deshpande Nagar Square',     lat: 17.7045, lng: 75.9115 },
  { id: 'MH-13', zone: 'north',   label: 'Ingle Mala Chowk',           lat: 17.7005, lng: 75.9130 },
  { id: 'MH-14', zone: 'north',   label: 'New Paccha Peth',            lat: 17.7035, lng: 75.9075 },
  { id: 'MH-15', zone: 'north',   label: 'Kasturba Nagar Main Road',   lat: 17.7055, lng: 75.9088 },
  { id: 'MH-16', zone: 'north',   label: 'Shelgi Phata Junction',      lat: 17.7065, lng: 75.9122 },
  { id: 'MH-17', zone: 'north',   label: 'Ambedkar Chowk North',       lat: 17.7018, lng: 75.9102 },
  { id: 'MH-18', zone: 'north',   label: 'Jyoti Colony Circle',        lat: 17.7038, lng: 75.9118 },
  { id: 'MH-19', zone: 'north',   label: 'Lokmanya Nagar Entry',       lat: 17.7012, lng: 75.9092 },
  { id: 'MH-20', zone: 'north',   label: 'Railway Overbridge North',   lat: 17.7048, lng: 75.9108 },

  // ── SOUTH ZONE (MH-21 to MH-40) ──
  { id: 'MH-21', zone: 'south',   label: 'Akkalkot Road Entry',        lat: 17.6820, lng: 75.9050 },
  { id: 'MH-22', zone: 'south',   label: 'Vijapur Road Crossing',      lat: 17.6790, lng: 75.9020 },
  { id: 'MH-23', zone: 'south',   label: 'Murarji Peth Main',          lat: 17.6810, lng: 75.9070 },
  { id: 'MH-24', zone: 'south',   label: 'Budhwar Peth South',         lat: 17.6800, lng: 75.9040 },
  { id: 'MH-25', zone: 'south',   label: 'Sakhar Peth Junction',       lat: 17.6780, lng: 75.9030 },
  { id: 'MH-26', zone: 'south',   label: 'Sidheshwar Temple Road',     lat: 17.6770, lng: 75.9060 },
  { id: 'MH-27', zone: 'south',   label: 'Railway Station South Gate', lat: 17.6795, lng: 75.9045 },
  { id: 'MH-28', zone: 'south',   label: 'Soregaon Phata',             lat: 17.6760, lng: 75.9025 },
  { id: 'MH-29', zone: 'south',   label: 'Shukrawar Peth Market',      lat: 17.6815, lng: 75.9055 },
  { id: 'MH-30', zone: 'south',   label: 'Hospital Chowk South',       lat: 17.6785, lng: 75.9035 },
  { id: 'MH-31', zone: 'south',   label: 'Ramling Temple Area',        lat: 17.6775, lng: 75.9048 },
  { id: 'MH-32', zone: 'south',   label: 'Janata Market Junction',     lat: 17.6805, lng: 75.9028 },
  { id: 'MH-33', zone: 'south',   label: 'Siddheshwar College Road',   lat: 17.6792, lng: 75.9062 },
  { id: 'MH-34', zone: 'south',   label: 'Solapur University Gate',    lat: 17.6765, lng: 75.9052 },
  { id: 'MH-35', zone: 'south',   label: 'Jule Solapur South Entry',   lat: 17.6788, lng: 75.9018 },
  { id: 'MH-36', zone: 'south',   label: 'Krantiveer Chowk',           lat: 17.6818, lng: 75.9038 },
  { id: 'MH-37', zone: 'south',   label: 'Damani Colony Square',       lat: 17.6778, lng: 75.9042 },
  { id: 'MH-38', zone: 'south',   label: 'Ashok Nagar South',          lat: 17.6798, lng: 75.9032 },
  { id: 'MH-39', zone: 'south',   label: 'Bhavani Peth Main Road',     lat: 17.6772, lng: 75.9058 },
  { id: 'MH-40', zone: 'south',   label: 'Vijapur Road Flyover',       lat: 17.6808, lng: 75.9022 },

  // ── EAST ZONE (MH-41 to MH-60) ──
  { id: 'MH-41', zone: 'east',    label: 'Hutatma Chowk',              lat: 17.6870, lng: 75.9120 },
  { id: 'MH-42', zone: 'east',    label: 'Osmanabad Naka',             lat: 17.6850, lng: 75.9150 },
  { id: 'MH-43', zone: 'east',    label: 'Ashok Chowk Main',           lat: 17.6880, lng: 75.9140 },
  { id: 'MH-44', zone: 'east',    label: 'Railway Station East Gate',  lat: 17.6860, lng: 75.9130 },
  { id: 'MH-45', zone: 'east',    label: 'Sakhar Peth East Entry',     lat: 17.6875, lng: 75.9160 },
  { id: 'MH-46', zone: 'east',    label: 'Barshi Road Junction',       lat: 17.6890, lng: 75.9170 },
  { id: 'MH-47', zone: 'east',    label: 'Hotgi Railway Crossing',     lat: 17.6865, lng: 75.9145 },
  { id: 'MH-48', zone: 'east',    label: 'Jath Road Circle',           lat: 17.6855, lng: 75.9155 },
  { id: 'MH-49', zone: 'east',    label: 'Market Yard East',           lat: 17.6885, lng: 75.9125 },
  { id: 'MH-50', zone: 'east',    label: 'APMC Main Gate',             lat: 17.6895, lng: 75.9165 },
  { id: 'MH-51', zone: 'east',    label: 'Gandhi Chowk East',          lat: 17.6868, lng: 75.9138 },
  { id: 'MH-52', zone: 'east',    label: 'Ramkrishna Nagar Square',    lat: 17.6878, lng: 75.9148 },
  { id: 'MH-53', zone: 'east',    label: 'New Paccha Peth East',       lat: 17.6888, lng: 75.9158 },
  { id: 'MH-54', zone: 'east',    label: 'Solapur-Pune Highway Exit',  lat: 17.6872, lng: 75.9168 },
  { id: 'MH-55', zone: 'east',    label: 'Industrial Estate Gate',     lat: 17.6882, lng: 75.9133 },
  { id: 'MH-56', zone: 'east',    label: 'Mangalwar Peth East',        lat: 17.6863, lng: 75.9143 },
  { id: 'MH-57', zone: 'east',    label: 'Bawachi Math Junction',      lat: 17.6892, lng: 75.9153 },
  { id: 'MH-58', zone: 'east',    label: 'Railway Goods Yard',         lat: 17.6858, lng: 75.9135 },
  { id: 'MH-59', zone: 'east',    label: 'Pandita Ramabai Chowk',      lat: 17.6873, lng: 75.9128 },
  { id: 'MH-60', zone: 'east',    label: 'City Bus Stand East',        lat: 17.6883, lng: 75.9163 },

  // ── WEST ZONE (MH-61 to MH-80) ──
  { id: 'MH-61', zone: 'west',    label: 'Pandharpur Road Main',       lat: 17.6910, lng: 75.9000 },
  { id: 'MH-62', zone: 'west',    label: 'Bijapur Road Junction',      lat: 17.6930, lng: 75.8970 },
  { id: 'MH-63', zone: 'west',    label: 'Jule Solapur Main',          lat: 17.6920, lng: 75.8990 },
  { id: 'MH-64', zone: 'west',    label: 'Shelagi Phata West',         lat: 17.6940, lng: 75.8980 },
  { id: 'MH-65', zone: 'west',    label: 'Kurduwadi Road Circle',      lat: 17.6900, lng: 75.9010 },
  { id: 'MH-66', zone: 'west',    label: 'Bhagwat Hospital West',      lat: 17.6925, lng: 75.8995 },
  { id: 'MH-67', zone: 'west',    label: 'Railway Overbridge West',    lat: 17.6915, lng: 75.8985 },
  { id: 'MH-68', zone: 'west',    label: 'Industrial Area West Gate',  lat: 17.6935, lng: 75.8975 },
  { id: 'MH-69', zone: 'west',    label: 'Kambar Talav Chowk',         lat: 17.6905, lng: 75.9005 },
  { id: 'MH-70', zone: 'west',    label: 'Solapur-Tuljapur Road',      lat: 17.6945, lng: 75.8965 },
  { id: 'MH-71', zone: 'west',    label: 'Civil Hospital West Wing',   lat: 17.6912, lng: 75.8992 },
  { id: 'MH-72', zone: 'west',    label: 'Saraswati Nagar Circle',     lat: 17.6922, lng: 75.8982 },
  { id: 'MH-73', zone: 'west',    label: 'Degaon Phata Junction',      lat: 17.6932, lng: 75.8972 },
  { id: 'MH-74', zone: 'west',    label: 'Modi Hospital Road',         lat: 17.6908, lng: 75.9002 },
  { id: 'MH-75', zone: 'west',    label: 'Ashok Nagar West Square',    lat: 17.6918, lng: 75.8988 },
  { id: 'MH-76', zone: 'west',    label: 'Rajiv Gandhi Nagar Entry',   lat: 17.6928, lng: 75.8978 },
  { id: 'MH-77', zone: 'west',    label: 'Bijapur Road Flyover',       lat: 17.6938, lng: 75.8968 },
  { id: 'MH-78', zone: 'west',    label: 'Agriculture College Gate',   lat: 17.6903, lng: 75.9008 },
  { id: 'MH-79', zone: 'west',    label: 'Maulana Azad Chowk',         lat: 17.6913, lng: 75.8998 },
  { id: 'MH-80', zone: 'west',    label: 'Wakf Board Office Area',     lat: 17.6923, lng: 75.8993 },

  // ── CENTRAL ZONE (MH-81 to MH-100) ──
  { id: 'MH-81', zone: 'central', label: 'Mangalwar Peth Centre',      lat: 17.6890, lng: 75.9070 },
  { id: 'MH-82', zone: 'central', label: 'Budhwar Peth Main',          lat: 17.6870, lng: 75.9060 },
  { id: 'MH-83', zone: 'central', label: 'Sadar Bazar Main Road',      lat: 17.6880, lng: 75.9080 },
  { id: 'MH-84', zone: 'central', label: 'Raviwar Peth Square',        lat: 17.6895, lng: 75.9065 },
  { id: 'MH-85', zone: 'central', label: 'Shaniwar Peth Centre',       lat: 17.6885, lng: 75.9075 },
  { id: 'MH-86', zone: 'central', label: 'Guruwar Peth Market',        lat: 17.6875, lng: 75.9055 },
  { id: 'MH-87', zone: 'central', label: 'SMC Head Office Circle',     lat: 17.6900, lng: 75.9085 },
  { id: 'MH-88', zone: 'central', label: 'District Collector Office',  lat: 17.6865, lng: 75.9050 },
  { id: 'MH-89', zone: 'central', label: 'Central Bus Stand',          lat: 17.6892, lng: 75.9072 },
  { id: 'MH-90', zone: 'central', label: 'City Police Station Chowk',  lat: 17.6888, lng: 75.9068 },
  { id: 'MH-91', zone: 'central', label: 'Gandhi Market Junction',     lat: 17.6878, lng: 75.9078 },
  { id: 'MH-92', zone: 'central', label: 'Maldhakka Chowk',            lat: 17.6898, lng: 75.9062 },
  { id: 'MH-93', zone: 'central', label: 'Jodbhavi Math Area',         lat: 17.6868, lng: 75.9082 },
  { id: 'MH-94', zone: 'central', label: 'Navi Peth Central',          lat: 17.6883, lng: 75.9058 },
  { id: 'MH-95', zone: 'central', label: 'Town Hall Square',           lat: 17.6893, lng: 75.9088 },
  { id: 'MH-96', zone: 'central', label: 'Subhash Chowk',              lat: 17.6872, lng: 75.9066 },
  { id: 'MH-97', zone: 'central', label: 'Zilla Parishad Office',      lat: 17.6887, lng: 75.9073 },
  { id: 'MH-98', zone: 'central', label: 'Main Post Office Junction',  lat: 17.6882, lng: 75.9063 },
  { id: 'MH-99', zone: 'central', label: 'City Court Complex',         lat: 17.6877, lng: 75.9077 },
  { id: 'MH-100', zone: 'central', label: 'Commercial Complex Circle', lat: 17.6896, lng: 75.9069 },
];