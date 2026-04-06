import { create } from 'zustand';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '@/services/firebase';
import { ManagerProfile } from '@/services/authService';
import { SensorData, WorkerProfile, Alert } from '@/services/sensorService';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { playAlertSound } from '@/utils/alertSound';

let seenAlertIds = new Set<string>();

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

function handleNewAlerts(alerts: Alert[]) {
  if (alerts.length === 0) return;

  // First load: just mark all as seen
  if (seenAlertIds.size === 0) {
    seenAlertIds = new Set(alerts.map(a => a.id));
    return;
  }

  const newAlert = alerts.find(
    (a) => !a.resolved && !seenAlertIds.has(a.id)
  );

  if (newAlert) {
    if (AppState.currentState === 'active') {
      // App open → play sound
      playAlertSound(newAlert).catch(() => {});
    } else {
      // App background → notification
      triggerNotification(newAlert);
    }
  }

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

export const useStore = create<AppState>((set) => ({
  manager: null,
  setManager: (manager) => set({ manager }),

  workers: [],
  setWorkers: (workers) => set({ workers }),

  sensors: {},
  setSensors: (sensors) => set({ sensors }),

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
          rssi: s.rssi,
          lastGpsLat: s.gps_lat,
          lastGpsLng: s.gps_lng,
          fallDetected: s.fall,
          sosTriggered: s.sos,
          workerPosture: s.posture,
          mode: s.mode,
          manholeId: s.manhole_id,
          locationLabel: s.location_label,
          gasWarming: s.gasWarming,
          workerId: id,
          gasAlert: s.gasAlert || false,
          fingerOn: s.fingerOn || false,
          motionAlert: s.motionAlert || false,
          fallAlert: s.fallAlert || false,
          sosAlert: s.sosAlert || false,
          batteryLevel: s.batteryLevel || 100,
        };

        mapped[id] = sensor;

        // 🔥 GENERATE ALERTS FROM SENSOR
        if (sensor.gasAlert) {
          generatedAlerts.push({
            id: `${id}-gas-${Date.now()}`,
            type: 'GAS_CRITICAL',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            value: `${sensor.ch4} ppm`,
            resolved: false,
          } as Alert);
        }

        if (sensor.sosAlert) {
          generatedAlerts.push({
            id: `${id}-sos-${Date.now()}`,
            type: 'SOS',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            value: 'SOS Triggered',
            resolved: false,
          } as Alert);
        }

        if (sensor.fallAlert) {
          generatedAlerts.push({
            id: `${id}-fall-${Date.now()}`,
            type: 'INACTIVITY',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            value: 'Fall Detected',
            resolved: false,
          } as Alert);
        }
      }

      set({ sensors: mapped });

      if (generatedAlerts.length > 0) {
        set((state) => {
          const updatedAlerts = [...generatedAlerts, ...state.alerts];
          
          // 🔔 GLOBAL ALERT HANDLING
          handleNewAlerts(updatedAlerts);

          return { alerts: updatedAlerts };
        });
      }
    });
  },

  alerts: [],
  setAlerts: (alerts) => set({ alerts }),

  language: 'en',
  setLanguage: (language) => set({ language }),

  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
}));