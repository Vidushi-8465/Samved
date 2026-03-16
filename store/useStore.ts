// store/useStore.ts
import { create } from 'zustand';
import { ManagerProfile } from '@/services/authService';
import { SensorData, WorkerProfile, Alert } from '@/services/sensorService';

interface AppState {
  // Auth
  manager: ManagerProfile | null;
  setManager: (manager: ManagerProfile | null) => void;

  // Workers
  workers: WorkerProfile[];
  setWorkers: (workers: WorkerProfile[]) => void;

  // Sensors (live)
  sensors: Record<string, SensorData>;
  setSensors: (sensors: Record<string, SensorData>) => void;
  updateSensor: (workerId: string, data: SensorData) => void;

  // Alerts
  alerts: Alert[];
  setAlerts: (alerts: Alert[]) => void;

  // Language
  language: 'en' | 'mr';
  setLanguage: (lang: 'en' | 'mr') => void;

  // UI
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
    set((state) => ({ sensors: { ...state.sensors, [workerId]: data } })),

  alerts: [],
  setAlerts: (alerts) => set({ alerts }),

  language: 'en',
  setLanguage: (language) => set({ language }),

  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
}));
