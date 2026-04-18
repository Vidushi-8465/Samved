import { create } from 'zustand';
import { ref, onValue } from 'firebase/database';
import { Timestamp } from 'firebase/firestore';
import { rtdb } from '@/services/firebase';
import { ManagerProfile } from '@/services/authService';
import { SensorData, WorkerProfile, Alert, getSensorStatus } from '@/services/sensorService';
import * as Notifications from 'expo-notifications';
import { AppState as RNAppState } from 'react-native';
import { playAlertSound } from '@/utils/alertSound';
import { isCriticalAlert, sendCriticalAlertEscalation } from '@/services/emergencyService';
import { isHiddenWorker } from '@/constants/hiddenWorkers';

let seenAlertIds = new Set<string>();
let escalatedAlertIds = new Set<string>();
const SOS_FALL_GRACE_MS = 10_000;
const pendingSosSinceByWorker = new Map<string, number>();
const lastEmergencyStateByWorker = new Map<string, 'none' | 'sos' | 'fall'>();

const toBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

const readSosTriggered = (raw: any): boolean => {
  // Prefer explicit SOS state if present so stale alias fields do not keep SOS stuck ON.
  if (raw?.sos !== undefined && raw?.sos !== null) return toBool(raw.sos);
  if (raw?.sos_triggered !== undefined && raw?.sos_triggered !== null) return toBool(raw.sos_triggered);
  if (raw?.sosTriggered !== undefined && raw?.sosTriggered !== null) return toBool(raw.sosTriggered);

  return (
    toBool(raw?.sos_button) ||
    toBool(raw?.sos_pressed) ||
    toBool(raw?.panic) ||
    toBool(raw?.panic_button)
  );
};

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
        const nowMs = Date.now();
        const s = data[id];

        // ─── Read motionAlert from Firebase ───────────────────────────────────
        // Arduino sends:
        //   motionAlert 0 = normal
        //   motionAlert 1 = CONFIRMED fall
        //   motionAlert 2 = inactive
        //   motionAlert 3 = tilt
        //   motionAlert 4 = confirmed fall + tilt
        //   motionAlert 5 = PENDING fall (10-sec grace window — NO alert)
        //
        // Arduino writes `fall: true` only for motionAlert 1 or 4.
        // Arduino writes `fall_pending: true` only for motionAlert 5.
        // We use motionAlert directly so we can precisely gate alerts.
        const motionAlert = Number(s.motion_alert ?? 0);

        // A fall is CONFIRMED only when motionAlert is 1 or 4.
        // motionAlert 5 = PENDING (grace window still running) → must NOT trigger any alert.
        const isConfirmedFall = motionAlert === 1 || motionAlert === 4;

        // fall_pending is purely a UI indicator — never generates an alert.
        const isFallPending = motionAlert === 5 || toBool(s.fall_pending);

        const sensor: SensorData = {
          heartRate: s.hr,
          spO2: s.spo2,
          ch4: s.mq4_ppm,
          h2s: s.mq7_ppm,
          waterLevel: s.water_level,
          rssi: s.rssi,
          lastGpsLat: s.gps_lat,
          lastGpsLng: s.gps_lng,
          // fallDetected reflects CONFIRMED falls only — never the pending state
          fallDetected: isConfirmedFall,
          sosTriggered: readSosTriggered(s),
          workerPosture: s.posture,
          mode: s.mode,
          manholeId: s.manhole_id,
          zone: s.zone || '—',
          locationLabel: s.location_label,
          gasWarming: s.gasWarming,
          workerId: id,
          gasAlert: Number(s.gasAlert ?? 0),
          fingerOn: s.fingerOn || false,
          motionAlert: motionAlert,
          // fallAlert is true only for CONFIRMED falls — pending state is excluded
          fallAlert: isConfirmedFall,
          sosAlert: toBool(s.sosAlert) || readSosTriggered(s),
          batteryLevel: s.batteryLevel || 100,
          thresholds: s.thresholds || undefined,
          safetyStatus: s.status || 'NORMAL',
          lastUpdated: s.last_seen || Date.now(),
          // Expose pending state for dashboard UI indicator (no alert fires from this)
          fallPending: isFallPending,
        };

        if (isHiddenWorker(id)) {
          continue;
        }

        mapped[id] = sensor;

        // 🔥 GENERATE ALERTS FROM SENSOR

        // ── Gas alerts ────────────────────────────────────────────────────────
        const gasAlertLevel = Number(sensor.gasAlert ?? 0);
        if (gasAlertLevel === 1) {
          generatedAlerts.push({
            id: `${id}-ch4-high-${Date.now()}`,
            workerId: id,
            type: 'CH4_HIGH',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: `${sensor.ch4} ppm`,
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        } else if (gasAlertLevel === 2) {
          generatedAlerts.push({
            id: `${id}-ch4-critical-${Date.now()}`,
            workerId: id,
            type: 'CH4_CRITICAL',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: `${sensor.ch4} ppm`,
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        } else if (gasAlertLevel === 3) {
          generatedAlerts.push({
            id: `${id}-h2s-high-${Date.now()}`,
            workerId: id,
            type: 'H2S_HIGH',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: `${sensor.h2s} ppm`,
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        } else if (gasAlertLevel === 4) {
          generatedAlerts.push({
            id: `${id}-h2s-critical-${Date.now()}`,
            workerId: id,
            type: 'H2S_CRITICAL',
            workerName: id,
            zone: sensor.locationLabel || 'Unknown',
            manholeId: sensor.manholeId || '—',
            value: `${sensor.h2s} ppm`,
            resolved: false,
            timestamp: Timestamp.now(),
          } as Alert);
        } else if (gasAlertLevel === 5) {
          generatedAlerts.push(
            {
              id: `${id}-ch4-critical-${Date.now()}`,
              workerId: id,
              type: 'CH4_CRITICAL',
              workerName: id,
              zone: sensor.locationLabel || 'Unknown',
              manholeId: sensor.manholeId || '—',
              value: `${sensor.ch4} ppm`,
              resolved: false,
              timestamp: Timestamp.now(),
            } as Alert,
            {
              id: `${id}-h2s-critical-${Date.now() + 1}`,
              workerId: id,
              type: 'H2S_CRITICAL',
              workerName: id,
              zone: sensor.locationLabel || 'Unknown',
              manholeId: sensor.manholeId || '—',
              value: `${sensor.h2s} ppm`,
              resolved: false,
              timestamp: Timestamp.now(),
            } as Alert
          );
        }

        // ── Heart rate alerts ─────────────────────────────────────────────────
        const sensorStatus = getSensorStatus(sensor);

        const heartRate = Number(sensor.heartRate ?? 0);
        if (heartRate > 0) {
          const heartRateType = sensorStatus.heartRate === 'danger' ? 'HEARTRATE' : null;

          if (heartRateType) {
            generatedAlerts.push({
              id: `${id}-hr-${Date.now()}`,
              workerId: id,
              type: heartRateType,
              workerName: id,
              zone: sensor.locationLabel || 'Unknown',
              manholeId: sensor.manholeId || '—',
              value: `${heartRate} BPM`,
              resolved: false,
              timestamp: Timestamp.now(),
            } as Alert);
          }
        }

        // ── SpO2 alerts ───────────────────────────────────────────────────────
        const spO2 = Number(sensor.spO2 ?? 0);
        if (spO2 > 0) {
          const spO2Type =
            sensorStatus.spO2 === 'danger'
              ? 'SPO2_CRITICAL'
              : sensorStatus.spO2 === 'warning'
                ? 'SPO2_LOW'
                : null;

          if (spO2Type) {
            generatedAlerts.push({
              id: `${id}-spo2-${Date.now()}`,
              workerId: id,
              type: spO2Type,
              workerName: id,
              zone: sensor.locationLabel || 'Unknown',
              manholeId: sensor.manholeId || '—',
              value: `${spO2}%`,
              resolved: false,
              timestamp: Timestamp.now(),
            } as Alert);
          }
        }

        // ── Fall / SOS emergency state machine ───────────────────────────────
        //
        // FALL STATE RULES (mirrors Arduino logic exactly):
        //   motionAlert 5  → PENDING (grace window active)  → no alert, no state change
        //   motionAlert 1/4 → CONFIRMED fall               → fire FALL alert once
        //
        // We deliberately do NOT use fallDetected / fallAlert booleans here because
        // those were previously set from `s.fall` which could be stale.
        // We drive everything from `motionAlert` (s.motion_alert) instead.

        // isFallPending (motionAlert 5): skip entirely — don't update emergency state,
        // don't push any alert. The 10-sec grace window is handled on the Arduino side;
        // we just wait for it to resolve to confirmed (1/4) or cleared (0).
        //
        // Only process SOS or confirmed fall:
        const hasFallEmergency = isConfirmedFall;
        const hasSosEmergency  = !!sensor.sosAlert || !!sensor.sosTriggered;

        // During a pending fall we freeze the emergency state — no transitions allowed.
        if (!isFallPending) {
          let effectiveEmergencyState: 'none' | 'sos' | 'fall' = 'none';

          if (hasFallEmergency) {
            effectiveEmergencyState = 'fall';
            pendingSosSinceByWorker.delete(id);
          } else if (hasSosEmergency) {
            const pendingSince = pendingSosSinceByWorker.get(id) ?? nowMs;
            pendingSosSinceByWorker.set(id, pendingSince);
            if (nowMs - pendingSince >= SOS_FALL_GRACE_MS) {
              effectiveEmergencyState = 'sos';
            }
          } else {
            pendingSosSinceByWorker.delete(id);
          }

          const previousEmergencyState = lastEmergencyStateByWorker.get(id) ?? 'none';
          lastEmergencyStateByWorker.set(id, effectiveEmergencyState);

          if (effectiveEmergencyState === 'fall' && previousEmergencyState !== 'fall') {
            generatedAlerts.push({
              id: `${id}-fall-${nowMs}`,
              workerId: id,
              type: 'FALL',
              workerName: id,
              zone: sensor.locationLabel || 'Unknown',
              manholeId: sensor.manholeId || '—',
              value: 'Fall Detected',
              resolved: false,
              timestamp: Timestamp.now(),
            } as Alert);
          } else if (effectiveEmergencyState === 'sos' && previousEmergencyState !== 'sos') {
            generatedAlerts.push({
              id: `${id}-sos-${nowMs}`,
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
        // else: motionAlert == 5 (pending) → do nothing, wait silently
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
  setAlerts: (alerts) => set((state) => {
    const visibleIncoming = alerts.filter((alert) => !isHiddenWorker(alert.workerId, alert.workerName));
    const incomingIds = new Set(visibleIncoming.map((alert) => alert.id));
    const preserved = state.alerts.filter((alert) => !incomingIds.has(alert.id));

    return { alerts: [...visibleIncoming, ...preserved] };
  }),

  language: 'en',
  setLanguage: (language) => set({ language }),

  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
}));