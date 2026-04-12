import { create } from 'zustand';
import { ref, onValue } from 'firebase/database';
import { Timestamp } from 'firebase/firestore';
import { rtdb } from '@/services/firebase';
import { ManagerProfile } from '@/services/authService';
import { SensorData, WorkerProfile, Alert } from '@/services/sensorService';
import * as Notifications from 'expo-notifications';
import { AppState as RNAppState } from 'react-native';
import { playAlertSound } from '@/utils/alertSound';
import { isCriticalAlert, sendCriticalAlertEscalation } from '@/services/emergencyService';
import { isHiddenWorker } from '@/constants/hiddenWorkers';

let seenAlertIds = new Set<string>();
let escalatedAlertIds = new Set<string>();

const toBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

const readSosTriggered = (raw: any): boolean =>
  toBool(raw?.sos) ||
  toBool(raw?.sos_button) ||
  toBool(raw?.sos_pressed) ||
  toBool(raw?.sos_triggered) ||
  toBool(raw?.panic) ||
  toBool(raw?.panic_button);

async function triggerNotification(alert: Alert) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚨 ${alert.type}`,
      body: `${alert.workerName} in ${alert.zone}`,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
}

function handleNewAlerts(alerts: Alert[], manager: ManagerProfile | null, workers: WorkerProfile[]) {
  if (alerts.length === 0) return;

  // First load: just mark all as seen
  if (seenAlertIds.size === 0) {
    seenAlertIds = new Set(alerts.map(a => a.id));
    return;
  }

  const newAlerts = alerts.filter((a) => !a.resolved && !seenAlertIds.has(a.id));
  const newAlert = newAlerts[0];

  if (newAlert) {
    if (RNAppState.currentState === 'active') {
      // App open → play sound
      playAlertSound(newAlert).catch(() => {});
    } else {
      // App background → notification
      triggerNotification(newAlert);
    }
  }

  newAlerts.forEach((alert) => {
    if (!isCriticalAlert(alert) || escalatedAlertIds.has(alert.id)) return;

    const worker = workers.find((entry) => entry.id === alert.workerId);
    void sendCriticalAlertEscalation(alert, {
      managerPhone: manager?.phone,
      workerPhone: worker?.phone,
      workerEmergencyContact: worker?.emergencyContact,
      workerDisplayName: worker?.name || alert.workerName,
    }).catch((error) => {
      console.warn('Failed to send SMS escalation:', error);
    });

    escalatedAlertIds.add(alert.id);
  });

  seenAlertIds = new Set(alerts.map(a => a.id));
}

interface AppState {
  manager: ManagerProfile | null;
  setManager: (manager: ManagerProfile | null) => void;

  workers: WorkerProfile[];
  setWorkers: (workers: WorkerProfile[]) => void;

  sensors: Record<string, SensorData>;
  setSensors: (sensors: Record<string, SensorData>) => void;
  updateSensor: (workerId: string, data: SensorData) => void;

  listenToSensors: () => void;

  alerts: Alert[];
  setAlerts: (alerts: Alert[]) => void;

  language: 'en' | 'mr';
  setLanguage: (lang: 'en' | 'mr') => void;

  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  manager: null,
  setManager: (manager) => set({ manager }),

  workers: [],
  setWorkers: (workers) => set({ workers: workers.filter((worker) => !isHiddenWorker(worker.id, worker.name)) }),

  sensors: {},
  setSensors: (sensors) => {
    const visibleSensors = Object.fromEntries(
      Object.entries(sensors).filter(([workerId]) => !isHiddenWorker(workerId))
    );
    set({ sensors: visibleSensors });
  },

  updateSensor: (workerId, data) =>
    set((state) => ({
      sensors: { ...state.sensors, [workerId]: data }
    })),

  // 🔥 REALTIME SENSOR LISTENER
  listenToSensors: () => {
    const sensorsRef = ref(rtdb, 'workers');

    onValue(sensorsRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const data = snapshot.val();

      const mapped: Record<string, SensorData> = {};
      const generatedAlerts: Alert[] = [];

      for (const id in data) {
        const s = data[id];

        const sensor: SensorData = {
          heartRate: s.hr,
          spO2: s.spo2,
          ch4: s.mq4_ppm,
          h2s: s.mq7_ppm,
          waterLevel: s.water_level,
          rssi: s.rssi,
          lastGpsLat: s.gps_lat,
          lastGpsLng: s.gps_lng,
          fallDetected: s.fall,
          sosTriggered: readSosTriggered(s),
          workerPosture: s.posture,
          mode: s.mode,
          manholeId: s.manhole_id,
          zone: s.zone || '—',
          locationLabel: s.location_label,
          gasWarming: s.gasWarming,
          workerId: id,
          gasAlert: s.gasAlert || false,
          fingerOn: s.fingerOn || false,
          motionAlert: s.motionAlert || false,
          fallAlert: s.fallAlert || false,
          sosAlert: toBool(s.sosAlert) || readSosTriggered(s),
          batteryLevel: s.batteryLevel || 100,
          safetyStatus: s.status || 'NORMAL',
          lastUpdated: s.last_seen || Date.now(),
        };

        if (isHiddenWorker(id)) {
          continue;
        }

        mapped[id] = sensor;

        // 🔥 GENERATE ALERTS FROM SENSOR
        if (sensor.gasAlert) {
          generatedAlerts.push({
            id: `${id}-gas-${Date.now()}`,
            workerId: id,
            type: 'CH4_CRITICAL',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: `${sensor.ch4} ppm`,
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        }

        const posture = (sensor.workerPosture ?? '').toLowerCase();
        const hasFallEmergency = !!sensor.fallAlert || !!sensor.fallDetected || sensor.motionAlert === 1 || sensor.motionAlert === 4 || posture === 'fallen' || posture === 'fall';
        const hasSosEmergency = !!sensor.sosAlert || !!sensor.sosTriggered;
        const combinedEmergencyValue = hasFallEmergency && hasSosEmergency ? 'SOS+fall detected' : null;

        if (hasFallEmergency) {
          generatedAlerts.push({
            id: `${id}-fall-${Date.now()}`,
            workerId: id,
            type: 'FALL',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: combinedEmergencyValue || 'Fall Detected',
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        } else if (hasSosEmergency) {
          generatedAlerts.push({
            id: `${id}-sos-${Date.now()}`,
            workerId: id,
            type: 'SOS',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: 'SOS Pressed',
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        }
      }

      set({ sensors: mapped });

      if (generatedAlerts.length > 0) {
        set((state) => {
          const updatedAlerts = [...generatedAlerts, ...state.alerts];
          
          // 🔔 GLOBAL ALERT HANDLING
          handleNewAlerts(updatedAlerts, get().manager, get().workers);

          return { alerts: updatedAlerts };
        });
      }
    });
  },

  alerts: [],
  setAlerts: (alerts) => set({ alerts: alerts.filter((alert) => !isHiddenWorker(alert.workerId, alert.workerName)) }),

  language: 'en',
  setLanguage: (language) => set({ language }),

  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
}));