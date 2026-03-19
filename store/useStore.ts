import { create } from 'zustand';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '@/services/firebase';
import { ManagerProfile } from '@/services/authService';
import { SensorData, WorkerProfile, Alert } from '@/services/sensorService';

interface AppState {
  manager: ManagerProfile | null;
  setManager: (manager: ManagerProfile | null) => void;

  workers: WorkerProfile[];
  setWorkers: (workers: WorkerProfile[]) => void;

  sensors: Record<string, SensorData>;
  setSensors: (sensors: Record<string, SensorData>) => void;
  updateSensor: (workerId: string, data: SensorData) => void;

  // 🔥 ADD THIS
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

  // 🔥 THIS IS THE MAIN FIX
  listenToSensors: () => {
    const sensorsRef = ref(rtdb, 'workers');

    onValue(sensorsRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const data = snapshot.val();

      console.log("🔥 REALTIME UPDATE:", data);

      const mapped: Record<string, SensorData> = {};

      for (const id in data) {
        const s = data[id];

        mapped[id] = {
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
          // Add the remaining 3 missing properties with defaults (adjust based on SensorData interface)
          fallAlert: s.fallAlert || false,
          sosAlert: s.sosAlert || false,
          batteryLevel: s.batteryLevel || 100,
        };
      }

      set({ sensors: mapped });
    });
  },

  alerts: [],
  setAlerts: (alerts) => set({ alerts }),

  language: 'en',
  setLanguage: (language) => set({ language }),

  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
}));