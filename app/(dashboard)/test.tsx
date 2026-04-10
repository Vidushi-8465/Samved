// app/(dashboard)/test.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Test Data Injector — uses REAL worker IDs from the store so the Reports
// screen picks up sensor data, alerts, and gas readings correctly.
//
// ROOT CAUSE FIX:
//   The old test screen used hardcoded w001/w002 IDs that never existed in
//   Firestore, so listenToWorkers() returned nothing, listenToAllSensors()
//   never subscribed, and Reports showed blank data even though alerts arrived.
//   This version reads workers from useStore() and uses their real IDs.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, Switch, Alert as RNAlert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ref, set, remove } from 'firebase/database';
import { collection, addDoc, setDoc, doc, Timestamp } from 'firebase/firestore';
import { rtdb, db } from '@/services/firebase';
import { useStore } from '@/store/useStore';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';

// ─── Types ─────────────────────────────────────────────────────────────────────

type WorkerInfo = {
  id: string;
  name: string;
  zone: string;
  manhole: string;
  location: string;
};

type SensorData = Record<string, unknown>;
type PushFn  = (w: WorkerInfo, data: SensorData) => Promise<void>;
type AlertFn = (w: WorkerInfo, type: string, value: string, resolved?: boolean) => Promise<void>;

type Scenario = {
  label: string;
  desc:  string;
  icon:  string;
  color: string;
  what:  string[];
  run:   (workers: WorkerInfo[], push: PushFn, alert: AlertFn) => Promise<void>;
};

// ─── Fallback worker templates (only used if store has no workers yet) ─────────

const FALLBACK_TEMPLATES = [
  { name: 'Test Worker A', zone: 'north', manhole: 'MH-01', location: 'Ward 1 North Line' },
  { name: 'Test Worker B', zone: 'east',  manhole: 'MH-02', location: 'Ward 2 East Line'  },
];

// ─── Presets ───────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '✅ All Safe',        color: Colors.success,  data: { ch4: 400,  co: 10,  h2s: 0.5, heartRate: 75,  spO2: 98, waterLevel: 20,  fallDetected: false, sosTriggered: false, mode: 'monitoring',    workerPosture: 'standing'   } },
  { label: '⚠️ Gas Warning',     color: Colors.warning,  data: { ch4: 1800, co: 80,  h2s: 3.0, heartRate: 102, spO2: 93, waterLevel: 60,  fallDetected: false, sosTriggered: false, mode: 'monitoring',    workerPosture: 'standing'   } },
  { label: '🔴 Critical + Fall', color: Colors.danger,   data: { ch4: 5800, co: 220, h2s: 8.0, heartRate: 130, spO2: 86, waterLevel: 145, fallDetected: true,  sosTriggered: true,  mode: 'monitoring',    workerPosture: 'fallen'     } },
  { label: '🔍 Pre-monitoring',  color: Colors.info,     data: { ch4: 300,  co: 8,   h2s: 0.5, heartRate: 0,   spO2: 0,  waterLevel: 10,  fallDetected: false, sosTriggered: false, mode: 'premonitoring', workerPosture: 'standing'   } },
  { label: '💤 Inactive',        color: '#9B59B6',       data: { ch4: 500,  co: 12,  h2s: 1.0, heartRate: 58,  spO2: 96, waterLevel: 35,  fallDetected: false, sosTriggered: false, mode: 'monitoring',    workerPosture: 'stationary' } },
];

// ─── Reports scenarios ─────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    label: 'Populate All Gauges',
    desc:  'Fills CO + CH₄ sensor readings so all gauges show real values with arrows',
    icon:  'gauge',
    color: '#3B82F6',
    what:  [
      'Gas & Env → CO gauge green (18 ppm < L1 25)',
      'Gas & Env → CH₄ gauge yellow (1200 ppm > L1 1000)',
      'Workers tab → HR + SpO₂ cells filled',
      'Gas & Env → Water bars show 45 cm / 30 cm',
    ],
    run: async ([w0, w1], push) => {
      await push(w0, { ch4: 1200, co: 18, h2s: 1, heartRate: 72, spO2: 97, waterLevel: 45, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 950, co: 22, h2s: 2, heartRate: 80, spO2: 96, waterLevel: 30, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
    },
  },
  {
    label: 'CO Caution (Yellow Gauge)',
    desc:  'CO in the 25–200 ppm caution band → yellow needle and yellow trend segment',
    icon:  'cloud-alert',
    color: '#F59E0B',
    what:  [
      'Gas & Env → CO gauge arrow points into yellow zone',
      'Gas & Env → CO gauge badge shows CAUTION',
      'Gas & Env → CO L2 Caution bar gets a count',
      'Gas & Env → Trend: select CO → yellow segment visible',
    ],
    run: async ([w0, w1], push) => {
      await push(w0, { ch4: 500, co: 80, h2s: 1, heartRate: 88, spO2: 97, waterLevel: 40, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 600, co: 95, h2s: 1, heartRate: 76, spO2: 98, waterLevel: 25, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
    },
  },
  {
    label: 'CH₄ Danger (Red Gauge)',
    desc:  'CH₄ above 5000 ppm L2 → red gauge + L3 bar fills + alerts created in Firestore',
    icon:  'fire-alert',
    color: '#DC2626',
    what:  [
      'Gas & Env → CH₄ gauge needle in red zone, badge = DANGER',
      'Gas & Env → CH₄ L3 Danger bar count increases',
      'Gas & Env → Trend: select CH₄ → segment is red',
      'Overview → Alert breakdown: Gas bar increments',
    ],
    run: async ([w0, w1], push, alert) => {
      await push(w0, { ch4: 5500, co: 30, h2s: 3, heartRate: 105, spO2: 94, waterLevel: 80, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 6200, co: 28, h2s: 4, heartRate: 110, spO2: 93, waterLevel: 90, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      await alert(w0, 'CH4_CRITICAL', '5500 ppm', false);
      if (w1) await alert(w1, 'CH4_CRITICAL', '6200 ppm', false);
    },
  },
  {
    label: 'Mixed Alert Types',
    desc:  'Pushes SOS + Gas + SpO₂ alerts across zones — tests breakdown bars and zone table',
    icon:  'chart-bar',
    color: '#8B5CF6',
    what:  [
      'Overview → Alert breakdown: SOS, Gas, SpO₂ bars all non-zero',
      'Overview → Zone performance: zones show different resolved rates',
      'Compliance → score reflects partial resolution (one resolved)',
    ],
    run: async ([w0, w1], push, alert) => {
      await push(w0, { ch4: 400, co: 15, h2s: 1, heartRate: 95, spO2: 91, waterLevel: 50, mode: 'monitoring', fallDetected: false, sosTriggered: true,  workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 2500, co: 60, h2s: 2, heartRate: 70, spO2: 97, waterLevel: 20, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      await alert(w0, 'SOS',      'SOS triggered', false);
      await alert(w0, 'SPO2_LOW', '91%',           true);   // resolved — raises compliance
      if (w1) await alert(w1, 'GAS', '2500 ppm CH₄', false);
    },
  },
  {
    label: '100% Compliance',
    desc:  'All alerts resolved → compliance score = 100%, all bars green',
    icon:  'shield-check',
    color: '#16A34A',
    what:  [
      'Compliance → Score shows 100% in green',
      'Compliance → "Excellent compliance" message',
      'Compliance → All gas bars at 100% green',
      'Compliance → Zone chips show Compliant',
    ],
    run: async ([w0, w1], push, alert) => {
      await push(w0, { ch4: 200, co: 8,  h2s: 0.5, heartRate: 72, spO2: 98, waterLevel: 15, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 150, co: 5,  h2s: 0.5, heartRate: 68, spO2: 99, waterLevel: 10, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      await alert(w0, 'GAS',      '200 ppm', true);
      if (w1) await alert(w1, 'GAS', '150 ppm', true);
      await alert(w0, 'SPO2_LOW', '92%',     true);
    },
  },
  {
    label: 'Low Compliance',
    desc:  'Multiple unresolved critical alerts → score <50%, red bar, critical message',
    icon:  'shield-alert',
    color: '#DC2626',
    what:  [
      'Compliance → Score below 50%, bar is red',
      'Compliance → "Critical — immediate attention required"',
      'Compliance → Zone chips show Critical in red',
      'Workers tab → Live cards show DANGER status',
    ],
    run: async ([w0, w1], push, alert) => {
      await push(w0, { ch4: 5800, co: 210, h2s: 8, heartRate: 128, spO2: 87, waterLevel: 160, mode: 'monitoring', fallDetected: true, sosTriggered: true, workerPosture: 'fallen' });
      if (w1) await push(w1, { ch4: 6100, co: 190, h2s: 7, heartRate: 135, spO2: 85, waterLevel: 155, mode: 'monitoring', fallDetected: false, sosTriggered: true, workerPosture: 'standing' });
      await alert(w0, 'SOS',          'SOS triggered', false);
      await alert(w0, 'CH4_CRITICAL', '5800 ppm',      false);
      if (w1) await alert(w1, 'SOS',          'SOS triggered', false);
      if (w1) await alert(w1, 'CH4_CRITICAL', '6100 ppm',      false);
    },
  },
  {
    label: 'Water Level Stress',
    desc:  'Sets extreme water levels to test colour-coded water bars in Gas & Env tab',
    icon:  'water-alert',
    color: '#0EA5E9',
    what:  [
      'Gas & Env → Worker A water bar tall and RED (145 cm > 120)',
      'Gas & Env → Worker B water bar medium YELLOW (65 cm > 50)',
      'Workers tab → Water cell shows DANGER / CAUTION colour',
    ],
    run: async ([w0, w1], push) => {
      await push(w0, { ch4: 300, co: 12, h2s: 1, heartRate: 74, spO2: 97, waterLevel: 145, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
      if (w1) await push(w1, { ch4: 200, co: 10, h2s: 1, heartRate: 78, spO2: 98, waterLevel: 65, mode: 'monitoring', fallDetected: false, sosTriggered: false, workerPosture: 'standing' });
    },
  },
  {
    label: 'Clear All Sensor Data',
    desc:  'Removes sensor nodes from RTDB — workers go OFFLINE, gauges show —',
    icon:  'delete-sweep',
    color: '#64748B',
    what:  [
      'Workers tab → all cards show OFFLINE grey status',
      'Gas & Env → all gauge values show — (no data)',
      'Gas & Env → water bars empty',
      'Summary → worker count unchanged (Firestore not affected)',
    ],
    run: async (workers) => {
      for (const w of workers) {
        await remove(ref(rtdb, `sensors/${w.id}`));
      }
    },
  },
];

// ─── Sensor payload builder ────────────────────────────────────────────────────

function buildPayload(w: WorkerInfo, data: SensorData): SensorData {
  return {
    ...data,
    manholeId:     w.manhole,
    zone:          w.zone,
    locationLabel: w.location,
    lastGpsLat:    17.6868,
    lastGpsLng:    75.9072,
    rssi:          -62,
    lastUpdated:   Date.now(),
  };
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function TestScreen() {
  const { workers: storeWorkers, manager } = useStore();

  // Convert store workers to WorkerInfo (real Firestore-backed IDs)
  const realWorkers = useMemo<WorkerInfo[]>(() =>
    (storeWorkers as any[]).map(w => ({
      id:       w.id,
      name:     w.name          ?? 'Worker',
      zone:     w.zone          ?? 'north',
      manhole:  w.manholeId     ?? w.manhole  ?? 'MH-00',
      location: w.locationLabel ?? w.location ?? 'Unknown location',
    })),
  [storeWorkers]);

  // Seeded fallback workers (created by this screen into Firestore)
  const [seededIds, setSeededIds]   = useState<string[]>([]);
  const [seeding, setSeeding]       = useState(false);

  const seededWorkers = useMemo<WorkerInfo[]>(() =>
    seededIds.map((id, i) => ({
      id,
      ...FALLBACK_TEMPLATES[i % FALLBACK_TEMPLATES.length],
    })),
  [seededIds]);

  // Prefer real workers; fall back to seeded test workers
  const workers: WorkerInfo[] = realWorkers.length > 0 ? realWorkers : seededWorkers;
  const hasWorkers = workers.length > 0;

  // UI state
  const [section,  setSection]  = useState<'sensor' | 'reports'>('sensor');
  const [selected, setSelected] = useState<WorkerInfo | null>(null);
  const [pushing,  setPushing]  = useState(false);
  const [running,  setRunning]  = useState<string | null>(null);
  const [lastMsg,  setLastMsg]  = useState('');

  // Custom inputs
  const [co,         setCo]         = useState('10');
  const [ch4,        setCh4]        = useState('400');
  const [h2s,        setH2s]        = useState('1');
  const [waterLvl,   setWaterLvl]   = useState('30');
  const [hr,         setHr]         = useState('75');
  const [spo2,       setSpo2]       = useState('98');
  const [fall,       setFall]       = useState(false);
  const [sos,        setSos]        = useState(false);
  const [mode,       setMode]       = useState<'monitoring' | 'premonitoring'>('monitoring');

  const activeWorker = selected ?? workers[0] ?? null;

  // ── Push helpers ─────────────────────────────────────────────────────────

  const pushSensor: PushFn = async (w, data) => {
    await set(ref(rtdb, `sensors/${w.id}`), buildPayload(w, data));
  };

  const pushAlert: AlertFn = async (w, type, value, resolved = false) => {
    await addDoc(collection(db, 'alerts'), {
      workerId:   w.id,
      workerName: w.name,
      type,
      value,
      zone:      w.zone,
      manholeId: w.manhole,
      resolved,
      timestamp: Timestamp.now(),
    });
  };

  // ── Seed test workers into Firestore ──────────────────────────────────────
  // Creates real worker docs under the manager's subcollection so
  // listenToWorkers() picks them up and Reports works correctly.

  const seedWorkers = async () => {
    if (!manager?.uid) {
      RNAlert.alert('No manager', 'Please log in as a manager first.');
      return;
    }
    setSeeding(true);
    try {
      const ids: string[] = [];
      for (const tmpl of FALLBACK_TEMPLATES) {
        const d = doc(collection(db, 'managers', manager.uid, 'workers'));
        await setDoc(d, {
          name:          tmpl.name,
          zone:          tmpl.zone,
          manholeId:     tmpl.manhole,
          locationLabel: tmpl.location,
          employeeId:    `T-${d.id.slice(0, 6).toUpperCase()}`,
          createdAt:     Timestamp.now(),
        });
        ids.push(d.id);
      }
      setSeededIds(ids);
      setLastMsg(`Seeded ${ids.length} test workers into Firestore`);
      RNAlert.alert('✅ Workers Created', `${ids.length} test workers added to Firestore under your manager account.\n\nThey will now appear in the Reports screen automatically.`);
    } catch (e: any) {
      RNAlert.alert('Seed Error', e.message);
    } finally {
      setSeeding(false);
    }
  };

  // ── Push single worker ───────────────────────────────────────────────────

  const pushToWorker = async (w: WorkerInfo, data: SensorData) => {
    setPushing(true);
    try {
      await pushSensor(w, data);
      if (data.sosTriggered)               await pushAlert(w, 'SOS',          'SOS triggered');
      if (data.fallDetected)               await pushAlert(w, 'FALL',         'Fall detected');
      if ((data.ch4 as number) > 5000)     await pushAlert(w, 'CH4_CRITICAL', `${data.ch4} ppm`);
      if ((data.co  as number) > 200)      await pushAlert(w, 'CO_CRITICAL',  `${data.co} ppm`);
      setLastMsg(`${w.name} updated — ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      RNAlert.alert('Push Error', e.message);
    } finally {
      setPushing(false);
    }
  };

  const pushCustom = () => {
    if (!activeWorker) return;
    pushToWorker(activeWorker, {
      ch4:          parseFloat(ch4)      || 0,
      co:           parseFloat(co)       || 0,
      h2s:          parseFloat(h2s)      || 0,
      heartRate:    parseInt(hr)         || 0,
      spO2:         parseInt(spo2)       || 0,
      waterLevel:   parseFloat(waterLvl) || 0,
      fallDetected: fall,
      sosTriggered: sos,
      mode,
      workerPosture: fall ? 'fallen' : 'standing',
    });
  };

  const pushAllSafe = async () => {
    if (!hasWorkers) return;
    setPushing(true);
    try {
      for (const w of workers) {
        await pushSensor(w, {
          ch4:          Math.round(Math.random() * 800  + 100),
          co:           Math.round(Math.random() * 20   + 2),
          h2s:          +(Math.random() * 1.5).toFixed(1),
          heartRate:    70  + Math.floor(Math.random() * 20),
          spO2:         96  + Math.floor(Math.random() * 3),
          waterLevel:   Math.round(Math.random() * 40 + 5),
          fallDetected: false,
          sosTriggered: false,
          mode:         'monitoring',
          workerPosture:'standing',
        });
      }
      setLastMsg(`All ${workers.length} workers set to SAFE — ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      RNAlert.alert('Error', e.message);
    } finally {
      setPushing(false);
    }
  };

  // ── Run scenario ─────────────────────────────────────────────────────────

  const runScenario = async (s: Scenario) => {
    if (!hasWorkers) {
      RNAlert.alert('No workers', 'Add a real worker via the Workers screen, or tap "Seed Test Workers" at the top of the Reports Tester tab.');
      return;
    }
    setRunning(s.label);
    try {
      await s.run(workers, pushSensor, pushAlert);
      setLastMsg(`"${s.label}" done — ${new Date().toLocaleTimeString()}`);
      RNAlert.alert('✅ Done', `"${s.label}" pushed.\n\nVerify in Reports tab:\n• ${s.what.join('\n• ')}`);
    } catch (e: any) {
      RNAlert.alert('Scenario Error', e.message);
    } finally {
      setRunning(null);
    }
  };

  // Input border colours
  const bCo  = parseFloat(co)  > 200  ? Colors.danger : parseFloat(co)  > 25   ? Colors.warning : Colors.border;
  const bCh4 = parseFloat(ch4) > 5000 ? Colors.danger : parseFloat(ch4) > 1000 ? Colors.warning : Colors.border;
  const bHr  = parseInt(hr) > 120 || parseInt(hr) < 50 ? Colors.danger : parseInt(hr) > 100 ? Colors.warning : Colors.border;
  const bSpo = parseInt(spo2)    < 90  ? Colors.danger : parseInt(spo2) < 95    ? Colors.warning : Colors.border;
  const bWat = parseFloat(waterLvl) > 120 ? Colors.danger : parseFloat(waterLvl) > 50 ? Colors.warning : Colors.border;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <MaterialCommunityIcons name="test-tube" size={20} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Test Data Injector</Text>
          <Text style={styles.headerSub}>Uses your real worker IDs — Reports will reflect data instantly</Text>
        </View>
        <View style={[styles.badge, hasWorkers ? styles.badgeGreen : styles.badgeRed]}>
          <Text style={[styles.badgeText, { color: hasWorkers ? Colors.success : Colors.danger }]}>
            {workers.length} workers
          </Text>
        </View>
      </View>

      {/* Section toggle */}
      <View style={styles.toggle}>
        {(['sensor', 'reports'] as const).map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.toggleBtn, section === s && styles.toggleBtnActive]}
            onPress={() => setSection(s)}
          >
            <MaterialCommunityIcons
              name={s === 'sensor' ? 'broadcast' : 'chart-box-outline'}
              size={15}
              color={section === s ? '#fff' : Colors.textSecondary}
            />
            <Text style={[styles.toggleBtnText, section === s && { color: '#fff' }]}>
              {s === 'sensor' ? 'Sensor Injector' : 'Reports Tester'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Status banner */}
        {!!lastMsg && (
          <View style={styles.banner}>
            <MaterialCommunityIcons name="check-circle" size={15} color={Colors.success} />
            <Text style={styles.bannerText}>{lastMsg}</Text>
          </View>
        )}

        {/* ══════════════ SENSOR INJECTOR ══════════════ */}
        {section === 'sensor' && (
          <>
            {/* No-worker state */}
            {!hasWorkers && (
              <View style={styles.warnCard}>
                <MaterialCommunityIcons name="alert-circle-outline" size={22} color="#F59E0B" />
                <Text style={styles.warnTitle}>No workers found</Text>
                <Text style={styles.warnBody}>Add a worker via the Workers screen, or switch to the Reports Tester tab and use "Seed Test Workers".</Text>
              </View>
            )}

            {hasWorkers && (
              <>
                {/* Worker selector */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>1. Select Worker</Text>
                  <Text style={styles.cardSub}>Real Firestore workers — Reports subscribes to these same IDs</Text>
                  {workers.map(w => (
                    <TouchableOpacity
                      key={w.id}
                      style={[styles.workerRow, activeWorker?.id === w.id && styles.workerRowActive]}
                      onPress={() => setSelected(w)}
                    >
                      <MaterialCommunityIcons
                        name="account-hard-hat"
                        size={18}
                        color={activeWorker?.id === w.id ? '#fff' : Colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.workerName, activeWorker?.id === w.id && { color: '#fff' }]}>{w.name}</Text>
                        <Text style={[styles.workerSub,  activeWorker?.id === w.id && { color: 'rgba(255,255,255,0.7)' }]}>
                          ID: {w.id} · {w.zone} · {w.manhole}
                        </Text>
                      </View>
                      {activeWorker?.id === w.id && <MaterialCommunityIcons name="check" size={16} color="#fff" />}
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Quick presets */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>2. Quick Presets</Text>
                  <Text style={styles.cardSub}>Pushes to selected worker instantly</Text>
                  {PRESETS.map(p => (
                    <TouchableOpacity
                      key={p.label}
                      style={[styles.presetBtn, { borderColor: p.color, backgroundColor: p.color + '18' }]}
                      onPress={() => activeWorker && pushToWorker(activeWorker, p.data as SensorData)}
                      disabled={pushing}
                    >
                      {pushing
                        ? <ActivityIndicator size="small" color={p.color} />
                        : <Text style={[styles.presetText, { color: p.color }]}>{p.label}</Text>
                      }
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom values */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>3. Custom Values</Text>
                  <Text style={styles.cardSub}>Push exact readings → {activeWorker?.name ?? '—'}</Text>

                  <View style={styles.row}>
                    <Field label="CO (ppm)"   val={co}       set={setCo}       border={bCo}  hint="Warn >25 | Danger >200" />
                    <Field label="CH₄ (ppm)"  val={ch4}      set={setCh4}      border={bCh4} hint="Warn >1000 | Danger >5000" />
                  </View>
                  <View style={styles.row}>
                    <Field label="H₂S (ppm)"  val={h2s}      set={setH2s}      border={parseFloat(h2s) > 5 ? Colors.danger : Colors.border} hint="Critical >5 ppm" />
                    <Field label="Water (cm)"  val={waterLvl} set={setWaterLvl} border={bWat} hint="Warn >50 | Danger >120" />
                  </View>
                  <View style={styles.row}>
                    <Field label="Heart Rate"  val={hr}       set={setHr}       border={bHr}  hint="Normal 60–100 bpm" />
                    <Field label="SpO₂ (%)"    val={spo2}     set={setSpo2}     border={bSpo} hint="Normal >95%" />
                  </View>

                  <Tog label="Fall Detected" val={fall} set={setFall} />
                  <Tog label="SOS Triggered" val={sos}  set={setSos}  />

                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Mode</Text>
                    <View style={styles.modeWrap}>
                      {(['premonitoring', 'monitoring'] as const).map(m => (
                        <TouchableOpacity
                          key={m}
                          style={[styles.modeBtn, mode === m && styles.modeBtnOn]}
                          onPress={() => setMode(m)}
                        >
                          <Text style={[styles.modeBtnTxt, mode === m && { color: '#fff', fontWeight: '700' }]}>
                            {m === 'premonitoring' ? 'Pre-monitor' : 'Worker Inside'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <TouchableOpacity style={styles.pushBtn} onPress={pushCustom} disabled={pushing || !activeWorker}>
                    {pushing ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="upload" size={17} color="#fff" />}
                    <Text style={styles.pushBtnTxt}>{pushing ? 'Pushing…' : `Push to ${activeWorker?.name ?? 'Worker'}`}</Text>
                  </TouchableOpacity>
                </View>

                {/* Reset all safe */}
                <TouchableOpacity style={styles.safeBtn} onPress={pushAllSafe} disabled={pushing}>
                  <MaterialCommunityIcons name="shield-check" size={19} color={Colors.success} />
                  <Text style={styles.safeBtnTxt}>Reset All {workers.length} Workers to SAFE</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Threshold reference */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📋 Threshold Reference</Text>
              {[
                { s: 'CO',    safe: '<25 ppm',    warn: '25–200',    danger: '>200 ppm'  },
                { s: 'CH₄',   safe: '<1000 ppm',  warn: '1000–5000', danger: '>5000 ppm' },
                { s: 'HR',    safe: '60–100 bpm', warn: '100–120',   danger: '>120/<50'  },
                { s: 'SpO₂',  safe: '>95%',       warn: '90–95%',    danger: '<90%'      },
                { s: 'Water', safe: '<50 cm',      warn: '50–120',    danger: '>120 cm'   },
              ].map(r => (
                <View key={r.s} style={styles.refRow}>
                  <Text style={styles.refLabel}>{r.s}</Text>
                  <Text style={[styles.refVal, { color: Colors.success }]}>{r.safe}</Text>
                  <Text style={[styles.refVal, { color: Colors.warning }]}>{r.warn}</Text>
                  <Text style={[styles.refVal, { color: Colors.danger  }]}>{r.danger}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ══════════════ REPORTS TESTER ══════════════ */}
        {section === 'reports' && (
          <>
            {/* Explanation + seed button */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: '#3B82F6' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="link-variant" size={18} color="#3B82F6" />
                <Text style={[styles.cardTitle, { color: '#1D4ED8' }]}>How Reports Tester is Linked</Text>
              </View>
              <Text style={styles.cardSub}>
                Each scenario pushes sensor values to{' '}
                <Text style={{ fontWeight: '700' }}>Firebase RTDB</Text> at{' '}
                <Text style={{ fontFamily: 'monospace' }}>sensors/{'<'}real-worker-id{'>'}</Text> and
                writes alerts to{' '}
                <Text style={{ fontWeight: '700' }}>Firestore</Text>. The Reports screen
                subscribes to the exact same paths, so data appears immediately.
              </Text>

              {/* Workers in use */}
              {hasWorkers ? (
                <>
                  <Text style={[styles.cardSub, { fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 }]}>
                    Workers that will receive data:
                  </Text>
                  {workers.map(w => (
                    <View key={w.id} style={styles.workerPill}>
                      <MaterialCommunityIcons name="account-hard-hat" size={13} color="#1D4ED8" />
                      <Text style={styles.workerPillTxt}>{w.name}</Text>
                      <Text style={styles.workerPillId}>({w.zone} · {w.id.slice(0, 8)}…)</Text>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <View style={styles.warnRow}>
                    <MaterialCommunityIcons name="alert" size={14} color="#F59E0B" />
                    <Text style={styles.warnRowTxt}>No workers found — create test workers below or add via Workers screen.</Text>
                  </View>
                  <TouchableOpacity style={styles.seedBtn} onPress={seedWorkers} disabled={seeding}>
                    {seeding
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <MaterialCommunityIcons name="database-plus" size={16} color="#fff" />
                    }
                    <Text style={styles.seedBtnTxt}>
                      {seeding ? 'Creating workers…' : 'Seed 2 Test Workers into Firestore'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Scenario cards */}
            {SCENARIOS.map(s => {
              const isRunning = running === s.label;
              const disabled  = !hasWorkers || !!running;
              return (
                <View key={s.label} style={[styles.card, { padding: 0, overflow: 'hidden', flexDirection: 'row' }]}>
                  <View style={{ width: 5, backgroundColor: s.color }} />
                  <View style={{ flex: 1, padding: 14, gap: 10 }}>

                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={[styles.scenIcon, { backgroundColor: s.color + '22' }]}>
                        <MaterialCommunityIcons name={s.icon as any} size={17} color={s.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scenTitle}>{s.label}</Text>
                        <Text style={styles.scenDesc}>{s.desc}</Text>
                      </View>
                    </View>

                    <View style={styles.checklist}>
                      <Text style={styles.checklistHdr}>✓ Verify in Reports after running:</Text>
                      {s.what.map((item, i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                          <View style={[styles.dot, { backgroundColor: s.color }]} />
                          <Text style={styles.dotTxt}>{item}</Text>
                        </View>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.runBtn, { backgroundColor: s.color }, disabled && { opacity: 0.5 }]}
                      onPress={() => runScenario(s)}
                      disabled={disabled}
                    >
                      {isRunning
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <MaterialCommunityIcons name="play" size={15} color="#fff" />
                      }
                      <Text style={styles.runBtnTxt}>{isRunning ? 'Running…' : 'Run Scenario'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {/* Tab-by-tab checklist */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🗂️ Reports Tab Checklist</Text>
              <Text style={styles.cardSub}>Manually verify each tab after running a scenario</Text>
              {[
                { tab: 'Overview',    items: ['Summary counts correct', 'Alert trend bars non-zero', 'Breakdown bars fill proportionally (SOS/Gas/SpO₂)', 'Zone performance chips colour-coded'] },
                { tab: 'Workers',     items: ['Live cards show pushed values', 'Status pill GREEN/YELLOW/RED matches data', 'CO + CH₄ + HR + SpO₂ cells colour-coded', 'Water bar height reflects cm'] },
                { tab: 'Gas & Env',   items: ['Gauge needle in correct zone', 'Badge shows SAFE/CAUTION/DANGER', 'L1/L2/L3 bars count readings', 'Trend segments colour-coded', 'Water bars per worker'] },
                { tab: 'Compliance',  items: ['Score = resolved/total × 100', 'Bar: green ≥90%, yellow ≥70%, red <70%', 'Gas compliance bars per gas', 'Zone chips: Compliant/Partial/Critical'] },
              ].map(item => (
                <View key={item.tab} style={styles.tabSect}>
                  <Text style={styles.tabSectTitle}>{item.tab}</Text>
                  {item.items.map((c, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 7, marginBottom: 3 }}>
                      <Text style={{ color: '#94A3B8', fontSize: 14, width: 18 }}>☐</Text>
                      <Text style={styles.tabCheck}>{c}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Tiny helpers ──────────────────────────────────────────────────────────────

function Field({ label, val, set, border, hint }: { label: string; val: string; set: (v: string) => void; border: string; hint: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldBox, { borderColor: border }]}>
        <TextInput style={styles.fieldTxt} value={val} onChangeText={set} keyboardType="numeric" />
      </View>
      <Text style={styles.fieldHint}>{hint}</Text>
    </View>
  );
}

function Tog({ label, val, set }: { label: string; val: boolean; set: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={val} onValueChange={set} trackColor={{ false: Colors.border, true: Colors.danger }} thumbColor="#fff" />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 },

  header: { backgroundColor: Colors.primary, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub:   { color: '#B8C8D8', fontSize: 10, marginTop: 1 },
  badge:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeGreen:  { backgroundColor: '#16A34A22' },
  badgeRed:    { backgroundColor: '#DC262622' },
  badgeText:   { fontSize: 11, fontWeight: '700' },

  toggle:        { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, padding: 6, gap: 6 },
  toggleBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },

  banner:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.successBg, borderRadius: BorderRadius.md, padding: 12 },
  bannerText: { color: Colors.success, fontSize: 12, flex: 1 },

  warnCard:  { backgroundColor: '#FFFBEB', borderRadius: BorderRadius.md, borderWidth: 1, borderColor: '#FCD34D', padding: Spacing.md, alignItems: 'center', gap: 6 },
  warnTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  warnBody:  { fontSize: 12, color: '#78350F', textAlign: 'center', lineHeight: 18 },

  card:      { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm, ...Shadows.sm },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  cardSub:   { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  workerRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  workerRowActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  workerName:      { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  workerSub:       { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },

  workerPill:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  workerPillTxt: { fontSize: 12, color: '#1D4ED8', fontWeight: '600' },
  workerPillId:  { fontSize: 10, color: '#6B7280' },

  presetBtn:  { padding: 12, borderRadius: BorderRadius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  presetText: { fontSize: 14, fontWeight: '600' },

  row:       { flexDirection: 'row', gap: Spacing.sm },
  fieldWrap: { flex: 1, gap: 3 },
  fieldLabel:{ fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  fieldBox:  { borderWidth: 2, borderRadius: BorderRadius.md, paddingHorizontal: 10, backgroundColor: Colors.background },
  fieldTxt:  { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, paddingVertical: 8 },
  fieldHint: { fontSize: 9, color: Colors.textMuted },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: Colors.border },
  toggleLabel: { fontSize: 14, color: Colors.textPrimary },
  modeWrap:    { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: 3 },
  modeBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.sm },
  modeBtnOn:   { backgroundColor: Colors.primary },
  modeBtnTxt:  { fontSize: 12, color: Colors.textSecondary },

  pushBtn:    { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: 13, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 },
  pushBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },

  safeBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: BorderRadius.md, borderWidth: 2, borderColor: Colors.success, backgroundColor: Colors.successBg },
  safeBtnTxt: { color: Colors.success, fontSize: 14, fontWeight: '700' },

  refRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.border, gap: 4 },
  refLabel: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary, width: 55 },
  refVal:   { fontSize: 11, flex: 1, textAlign: 'center' },

  warnRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFBEB', padding: 8, borderRadius: 8 },
  warnRowTxt: { fontSize: 12, color: '#92400E', flex: 1 },

  seedBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: 12, marginTop: 4 },
  seedBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  scenIcon:   { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  scenTitle:  { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  scenDesc:   { fontSize: 12, color: Colors.textSecondary, marginTop: 1, lineHeight: 17 },
  checklist:  { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, gap: 5 },
  checklistHdr: { fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 3 },
  dot:        { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  dotTxt:     { fontSize: 12, color: '#475569', flex: 1, lineHeight: 18 },

  runBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: BorderRadius.md },
  runBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  tabSect:      { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, gap: 2, marginTop: 2 },
  tabSectTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 5 },
  tabCheck:     { fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
});