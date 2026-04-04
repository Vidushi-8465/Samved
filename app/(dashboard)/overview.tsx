// app/(dashboard)/overview.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Modal, Animated, Platform, PanResponder, GestureResponderEvent
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import {
  listenToWorkers, listenToAlerts, listenToAllSensors,
  getSensorStatus, SOLAPUR_ZONES, SENSOR_THRESHOLDS, SensorData, Alert, SafetyStatus
} from '@/services/sensorService';
import { logoutManager } from '@/services/authService';
import { ref, onValue, off } from 'firebase/database';
import { rtdb } from '@/services/firebase';
import { playAlertSound } from '@/utils/alertSound';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH > 768;

const STATUS_COLOR: Record<SafetyStatus, string> = {
  safe: '#2ECC71',
  warning: '#F39C12',
  danger: '#E74C3C',
  offline: '#94A3B8',
};
const STATUS_BG: Record<SafetyStatus, string> = {
  safe: '#E8F8F0',
  warning: '#FEF9E7',
  danger: '#FDEDEC',
  offline: '#F1F5F9',
};
const STATUS_TEXT: Record<SafetyStatus, string> = {
  safe: '#27AE60',
  warning: '#E67E22',
  danger: '#C0392B',
  offline: '#64748B',
};

function useRealTimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// SOS Modal
function SOSModal({ alerts, visible, onDismiss }: { alerts: Alert[]; visible: boolean; onDismiss: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const active = alerts.filter((alert) => (alert.type === 'SOS' || alert.type === 'FALL') && !alert.resolved);
  useEffect(() => {
    if (active.length === 0) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 350, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 350, useNativeDriver: true }),
      ])
    ).start();
  }, [active.length]);
  if (active.length === 0 || !visible) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={ss.overlay}>
        <Animated.View style={[ss.card, { transform: [{ scale: pulse }] }]}>
          <MaterialCommunityIcons name="alarm-light" size={52} color="#fff" />
          <Text style={ss.title}>EMERGENCY ALERT</Text>
          <Text style={ss.sub}>{active.length} worker{active.length > 1 ? 's require' : ' requires'} immediate response</Text>
          {active.map((alert) => (
            <View key={alert.id} style={ss.row}>
              <MaterialCommunityIcons name="account-hard-hat" size={18} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={ss.wName}>{alert.workerName}</Text>
                <Text style={ss.wSub}>{alert.manholeId} · {alert.zone} · {alert.type === 'FALL' ? 'Fall Detected' : 'SOS Pressed'}</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity style={ss.btn} onPress={onDismiss}>
            <Text style={ss.btnText}>Acknowledge & Go to Alerts</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}
const ss = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#C0392B', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420, alignItems: 'center', gap: 14, borderWidth: 2, borderColor: '#E74C3C' },
  title: { color: '#fff', fontSize: 20, fontFamily: 'Poppins_700Bold', textAlign: 'center' },
  sub: { color: '#FFCCCC', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 12, width: '100%' },
  wName: { color: '#fff', fontSize: 14, fontFamily: 'Poppins_600SemiBold' },
  wSub: { color: '#FFCCCC', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  btn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 4 },
  btnText: { color: '#C0392B', fontSize: 14, fontFamily: 'Poppins_700Bold' },
});

// Env Parameter Card
function EnvCard({ label, value, unit, status }: { label: string; value: string | number; unit: string; status: SafetyStatus }) {
  const s = status || 'safe';
  return (
    <View style={[ec.card, { borderTopColor: STATUS_COLOR[s], borderTopWidth: 2 }]}>
      <Text style={ec.label}>{label}</Text>
      <View style={ec.valueRow}>
        <Text style={[ec.value, { color: STATUS_COLOR[s] }]}>{value}</Text>
        <Text style={ec.unit}>{unit}</Text>
      </View>
      <View style={[ec.badge, { backgroundColor: STATUS_BG[s] }]}>
        <View style={[ec.dot, { backgroundColor: STATUS_COLOR[s] }]} />
        <Text style={[ec.badgeText, { color: STATUS_TEXT[s] }]}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </Text>
      </View>
    </View>
  );
}
const ec = StyleSheet.create({
  card: { flex: 1, minWidth: 130, backgroundColor: '#fff', borderRadius: 8, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  label: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#64748B', letterSpacing: 0.3, marginBottom: 6 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginBottom: 8 },
  value: { fontSize: 28, fontFamily: 'Poppins_700Bold', lineHeight: 32 },
  unit: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#64748B', marginBottom: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
});

// Worker Condition Card
function WorkerConditionCard({ sensor, workerEmployeeId }: { sensor?: SensorData | null; workerEmployeeId: string }) {
  const status = sensor ? getSensorStatus(sensor) : null;
  const isActive = !!sensor;
  const isFall = sensor?.fallDetected;
  const isSOS = sensor?.sosTriggered;
  return (
    <View style={wc.card}>
      <View style={wc.header}>
        <Text style={wc.title}>Worker Condition</Text>
        <Text style={wc.badge}>MPU6050 · Badge: {workerEmployeeId}</Text>
      </View>
      <View style={wc.row}>
        <Text style={wc.rowLabel}>Worker Status</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={[wc.dot, { backgroundColor: isActive ? '#2ECC71' : '#94A3B8' }]} />
          <Text style={[wc.rowVal, { color: isActive ? '#2ECC71' : '#94A3B8' }]}>
            {isActive ? 'Active' : 'Offline'}
          </Text>
        </View>
      </View>
      <View style={wc.row}>
        <Text style={wc.rowLabel}>Motion</Text>
        <Text style={[wc.rowVal, { color: '#1A3C6E', fontFamily: 'Poppins_600SemiBold' }]}>
          {sensor?.workerPosture === 'standing' ? 'Movement Detected'
            : sensor?.workerPosture === 'stationary' ? 'Stationary'
            : sensor?.workerPosture === 'fallen' ? 'FALLEN'
            : '—'}
        </Text>
      </View>
      {/* Heart Rate + SpO2 vitals */}
      <View style={wc.vitalsRow}>
        <View style={wc.vitalBox}>
          <MaterialCommunityIcons name="heart-pulse" size={18}
            color={status?.heartRate === 'danger' ? '#E74C3C' : status?.heartRate === 'warning' ? '#F39C12' : '#2ECC71'} />
          <Text style={[wc.vitalVal,
            { color: status?.heartRate === 'danger' ? '#E74C3C' : status?.heartRate === 'warning' ? '#F39C12' : '#1A202C' }]}>
            {sensor?.heartRate ?? '—'}
          </Text>
          <Text style={wc.vitalUnit}>BPM</Text>
        </View>
        <View style={wc.vitalDivider} />
        <View style={wc.vitalBox}>
          <MaterialCommunityIcons name="lungs" size={18}
            color={status?.spO2 === 'danger' ? '#E74C3C' : status?.spO2 === 'warning' ? '#F39C12' : '#2ECC71'} />
          <Text style={[wc.vitalVal,
            { color: status?.spO2 === 'danger' ? '#E74C3C' : status?.spO2 === 'warning' ? '#F39C12' : '#1A202C' }]}>
            {sensor?.spO2 ?? '—'}
          </Text>
          <Text style={wc.vitalUnit}>SpO2 %</Text>
        </View>
      </View>
      <View style={[wc.fallBox, { backgroundColor: isFall ? '#FDEDEC' : '#E8F8F0', borderColor: isFall ? '#E74C3C' : '#2ECC71' }]}>
        <View style={[wc.dot, { backgroundColor: isFall ? '#E74C3C' : '#2ECC71' }]} />
        <Text style={[wc.fallText, { color: isFall ? '#C0392B' : '#27AE60' }]}>
          {isFall ? 'Fall Detected — SOS Active' : 'No Fall Detected'}
        </Text>
      </View>
      <View style={[wc.sysBox, { backgroundColor: isSOS ? '#FDEDEC' : '#F0F4F8' }]}>
        <View style={[wc.dot, { backgroundColor: isSOS ? '#E74C3C' : '#2ECC71' }]} />
        <View>
          <Text style={[wc.sysTitle, { color: isSOS ? '#C0392B' : '#1A202C' }]}>
            {isSOS ? 'EMERGENCY — SOS TRIGGERED' : 'System Standby'}
          </Text>
          <Text style={wc.sysSub}>
            {sensor?.mode === 'premonitoring'
              ? 'Pre-monitoring Mode · LoRa Active'
              : 'Monitoring Mode · LoRa Active'}
          </Text>
        </View>
      </View>
    </View>
  );
}
const wc = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  badge: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F4F8' },
  rowLabel: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  rowVal: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: '#1A202C' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  vitalsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F4F8', paddingVertical: 12 },
  vitalBox: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  vitalDivider: { width: 1, backgroundColor: '#E2E8F0' },
  vitalVal: { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  vitalUnit: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  fallBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, padding: 12, marginTop: 10, borderWidth: 1 },
  fallText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  sysBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, padding: 12, marginTop: 6 },
  sysTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  sysSub: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B' },
});

// System Status Card
function SystemStatusCard({ sensor, managerName }: { sensor?: SensorData | null; managerName: string }) {
  const [uptime, setUptime] = useState('00:00:00');
  const startRef = useRef(Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const e = Math.floor((Date.now() - startRef.current) / 1000);
      const h = String(Math.floor(e / 3600)).padStart(2, '0');
      const m = String(Math.floor((e % 3600) / 60)).padStart(2, '0');
      const s = String(e % 60).padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const rows = [
    { label: 'Battery Level', value: '78%', color: '#2ECC71' },
    { label: 'LoRa Signal (RSSI)', value: sensor?.rssi ? `${sensor.rssi} dBm` : 'Waiting...', color: sensor?.rssi ? '#3498DB' : '#94A3B8' },
    { label: 'WiFi Gateway', value: 'Connected', color: '#2ECC71' },
    { label: 'Operating Mode', value: sensor?.mode === 'premonitoring' ? 'Pre-monitoring' : 'Continuous Monitoring', color: '#1A3C6E' },
    { label: 'Session Uptime', value: uptime, color: '#1A202C' },
    { label: 'Logged In As', value: managerName || 'Manager', color: '#64748B' },
  ];

  return (
    <View style={sys.card}>
      <View style={sys.header}>
        <Text style={sys.title}>System Status</Text>
        <Text style={sys.badge}>Device: GW-NODE-{sensor?.manholeId?.replace('MH-', '') ?? '00'}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={r.label} style={[sys.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={sys.label}>{r.label}</Text>
          <Text style={[sys.val, { color: r.color }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}
const sys = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  badge: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0F4F8' },
  label: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  val: { fontSize: 13, fontFamily: 'Poppins_500Medium' },
});

// Alerts & Logs Card
function AlertsLogCard({ alerts }: { alerts: Alert[] }) {
  const ALERT_COLOR = {
    SOS:'#C0392B', FALL:'#C0392B', CH4_CRITICAL:'#C0392B', H2S_CRITICAL:'#C0392B',
    CO_HIGH:'#C0392B', SPO2_CRITICAL:'#C0392B', CH4_HIGH:'#E67E22', H2S_HIGH:'#E67E22',
    CO_WARNING:'#E67E22', SPO2_LOW:'#E67E22', HEARTRATE:'#E67E22', INACTIVITY:'#3498DB',
  };
  const ALERT_BG = {
    SOS:'#FDEDEC', FALL:'#FDEDEC', CH4_CRITICAL:'#FDEDEC', H2S_CRITICAL:'#FDEDEC',
    CO_HIGH:'#FDEDEC', SPO2_CRITICAL:'#FDEDEC', CH4_HIGH:'#FEF9E7', H2S_HIGH:'#FEF9E7',
    CO_WARNING:'#FEF9E7', SPO2_LOW:'#FEF9E7', HEARTRATE:'#FEF9E7', INACTIVITY:'#EBF5FB',
  };
  const LABEL = {
    SOS:'SOS emergency triggered.', FALL:'Fall detected — worker down.',
    CH4_CRITICAL:'CH₄ critical level.', CH4_HIGH:'CH₄ near threshold.',
    H2S_CRITICAL:'H₂S critical level.', H2S_HIGH:'H₂S detected near threshold.',
    CO_HIGH:'CO high concentration.', CO_WARNING:'CO warning level.',
    SPO2_LOW:'SpO₂ below safe level.', SPO2_CRITICAL:'SpO₂ critically low.',
    HEARTRATE:'Heart rate abnormal.', INACTIVITY:'Worker inactive > 30s.',
  };
  type AlertTypeKey = keyof typeof ALERT_COLOR;
  const fmtTime = (ts: any) => {
    if (!ts) return '--:--:--';
    const d = ts.toDate?.() || new Date(ts);
    return d.toTimeString().slice(0, 8);
  };
  return (
    <View style={al.card}>
      <View style={al.header}>
        <Text style={al.title}>Alerts & Logs</Text>
        <Text style={al.count}>{alerts.length} Events</Text>
      </View>
      <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
        {alerts.slice(0, 12).map((alert) => (
          <View key={alert.id} style={[al.row, { borderLeftColor: ALERT_COLOR[alert.type as AlertTypeKey] || '#E67E22', backgroundColor: ALERT_BG[alert.type as AlertTypeKey] || '#FEF9E7' }]}>
            <Text style={[al.time, { color: ALERT_COLOR[alert.type as AlertTypeKey] || '#E67E22' }]}>{fmtTime(alert.timestamp)}</Text>
            <Text style={al.msg}>{LABEL[alert.type as AlertTypeKey] || alert.type}</Text>
          </View>
        ))}
        {alerts.length === 0 && (
          <View style={al.empty}>
            <MaterialCommunityIcons name="check-all" size={24} color="#2ECC71" />
            <Text style={al.emptyText}>No alerts — all clear</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const al = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  count: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: '#64748B' },
  row: { borderLeftWidth: 3, padding: 8, marginBottom: 4, borderRadius: 4 },
  time: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', marginBottom: 2 },
  msg: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: '#1A202C' },
  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { fontSize: 13, color: '#64748B', fontFamily: 'Poppins_400Regular' },
});

// Threshold Status Card
function ThresholdCard({ sensor }: { sensor?: SensorData | null }) {
  const status = sensor ? getSensorStatus(sensor) : null;
  const coValue = sensor?.co ?? sensor?.h2s ?? 0;
  const hasFall = !!sensor?.fallDetected || !!sensor?.sosTriggered;

  const rows: Array<{
    label: string;
    current: string;
    statusLabel: string;
    limits: string;
    st: SafetyStatus;
  }> = [
    {
      label: 'Methane (CH₄)',
      current: sensor ? `${sensor.ch4.toFixed(1)} % LEL` : 'No data',
      statusLabel: !sensor ? 'No Data' : status?.ch4 === 'danger' ? 'Critical' : status?.ch4 === 'warning' ? 'Warning' : 'Safe',
      limits: `Safe: < ${SENSOR_THRESHOLDS.ch4.warningMin} ppm  |  Warning: ${SENSOR_THRESHOLDS.ch4.warningMin}-${SENSOR_THRESHOLDS.ch4.dangerMin - 1} ppm  |  Danger: ≥ ${SENSOR_THRESHOLDS.ch4.dangerMin} ppm`,
      st: status?.ch4 ?? 'safe',
    },
    {
      label: 'CO (MQ7)',
      current: sensor ? `${coValue.toFixed(1)} ppm` : 'No data',
      statusLabel: !sensor ? 'No Data' : status?.h2s === 'danger' ? 'Critical' : status?.h2s === 'warning' ? 'Warning' : 'Safe',
      limits: `Safe: < ${SENSOR_THRESHOLDS.co.warningMin} ppm  |  Warning: ${SENSOR_THRESHOLDS.co.warningMin}-${SENSOR_THRESHOLDS.co.dangerMin - 1} ppm  |  Danger: ≥ ${SENSOR_THRESHOLDS.co.dangerMin} ppm`,
      st: status?.h2s ?? 'safe',
    },
    {
      label: 'SpO₂',
      current: sensor ? `${sensor.spO2}%` : 'No data',
      statusLabel: !sensor ? 'No Data' : status?.spO2 === 'danger' ? 'Critical' : status?.spO2 === 'warning' ? 'Warning' : 'Safe',
      limits: `Safe: ≥ ${SENSOR_THRESHOLDS.spO2.warningMin}%  |  Warning: ${SENSOR_THRESHOLDS.spO2.dangerMin}-${SENSOR_THRESHOLDS.spO2.warningMin - 1}%  |  Danger: < ${SENSOR_THRESHOLDS.spO2.dangerMin}%`,
      st: status?.spO2 ?? 'safe',
    },
    {
      label: 'Heart Rate',
      current: sensor ? `${sensor.heartRate} BPM` : 'No data',
      statusLabel: !sensor ? 'No Data' : status?.heartRate === 'danger' ? 'Critical' : status?.heartRate === 'warning' ? 'Warning' : 'Safe',
      limits: `Safe: ${SENSOR_THRESHOLDS.heartRate.warningLow}-${SENSOR_THRESHOLDS.heartRate.warningHigh} BPM  |  Warning: ${SENSOR_THRESHOLDS.heartRate.dangerLow}-${SENSOR_THRESHOLDS.heartRate.warningLow - 1} or ${SENSOR_THRESHOLDS.heartRate.warningHigh + 1}-${SENSOR_THRESHOLDS.heartRate.dangerHigh} BPM  |  Danger: < ${SENSOR_THRESHOLDS.heartRate.dangerLow} or > ${SENSOR_THRESHOLDS.heartRate.dangerHigh} BPM`,
      st: status?.heartRate ?? 'safe',
    },
    {
      label: 'Fall / SOS',
      current: hasFall ? 'Triggered' : 'Normal',
      statusLabel: hasFall ? 'Danger' : 'Safe',
      limits: 'Safe: no fall and no SOS  |  Danger: fall detected or SOS pressed',
      st: hasFall ? 'danger' : 'safe',
    },
  ];

  const statusText = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Safe');

  return (
    <View style={th.card}>
      <Text style={th.title}>Threshold Status</Text>
      {rows.map((r, i) => (
        <View key={r.label} style={[th.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={th.rowTop}>
            <View style={th.rowLabelWrap}>
              <Text style={th.label}>{r.label}</Text>
              <Text style={th.current}>{r.current}</Text>
            </View>
            <View style={[th.badge, { backgroundColor: STATUS_BG[r.st] }]}>
              <Text style={[th.badgeText, { color: STATUS_TEXT[r.st] }]}>{statusText(r.statusLabel)}</Text>
            </View>
          </View>
          <Text style={th.limitText}>{r.limits}</Text>
        </View>
      ))}
    </View>
  );
}
const th = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C', marginBottom: 10 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0F4F8', gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  rowLabelWrap: { flex: 1, gap: 2 },
  label: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  current: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
  limitText: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B', lineHeight: 15 },
});

// Gas Trend Chart
function GasTrendCard({ sensor }: { sensor?: SensorData | null }) {
  const [history, setHistory] = useState(Array(20).fill({ ch4: 0, h2s: 0, co: 0 }));
  useEffect(() => {
    if (!sensor) return;
    setHistory(prev => [...prev.slice(1), { ch4: sensor.ch4 || 0, h2s: sensor.h2s || 0, co: sensor.co || 0 }]);
  }, [sensor?.lastUpdated]);

  const chartW = Math.min(SCREEN_WIDTH - 80, 400);
  const chartH = 90;
  const maxVal = 50;

  const polyline = (key: 'ch4' | 'h2s' | 'co', color: string) => {
    const pts = history.map((d, i) => {
      const x = (i / (history.length - 1)) * chartW;
      const y = chartH - (Math.min(d[key] || 0, maxVal) / maxVal) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
  };

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}">
    <line x1="0" y1="${chartH * 0.5}" x2="${chartW}" y2="${chartH * 0.5}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
    <line x1="0" y1="0" x2="${chartW}" y2="0" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
    ${polyline('ch4','#2ECC71')}
    ${polyline('h2s','#E67E22')}
    ${polyline('co','#E74C3C')}
  </svg>`;

  return (
    <View style={gc.card}>
      <View style={gc.header}>
        <Text style={gc.title}>Gas Level Trends</Text>
        <Text style={gc.sub}>Last 20 readings · CH₄ · H₂S · CO</Text>
      </View>
      <View style={gc.legend}>
        {[['CH₄','#2ECC71'],['H₂S','#E67E22'],['CO','#E74C3C']].map(([l,c]) => (
          <View key={l} style={gc.legendItem}>
            <View style={[gc.legendDot, { backgroundColor: c }]} />
            <Text style={gc.legendText}>{l}</Text>
          </View>
        ))}
      </View>
      <View style={[gc.chartArea, { height: chartH + 8 }]}>
        <View style={gc.yLabels}>
          <Text style={gc.yLabel}>50</Text>
          <Text style={gc.yLabel}>25</Text>
          <Text style={gc.yLabel}>0</Text>
        </View>
        <View style={{ flex: 1, height: chartH, backgroundColor: '#FAFAFA', borderRadius: 4, overflow: 'hidden' }}>
          {/* Render chart as simple bars since SVG in RN requires react-native-svg */}
          {history.map((d, i) => (
            <View key={i} style={{ position: 'absolute', left: (i / (history.length - 1)) * (chartW - 8), bottom: 0, width: 2, flexDirection: 'column', justifyContent: 'flex-end', height: chartH }}>
              <View style={{ width: 2, height: Math.max(1, (d.ch4 / maxVal) * chartH), backgroundColor: '#2ECC7180', borderRadius: 1 }} />
            </View>
          ))}
        </View>
      </View>
      <Text style={gc.note}>Live data updates every 5 seconds via LoRa</Text>
    </View>
  );
}
const gc = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  sub: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  legend: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  chartArea: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  yLabels: { width: 24, justifyContent: 'space-between', paddingVertical: 2 },
  yLabel: { fontSize: 9, color: '#94A3B8', fontFamily: 'Poppins_400Regular', textAlign: 'right' },
  note: { fontSize: 10, color: '#94A3B8', fontFamily: 'Poppins_400Regular', marginTop: 4 },
});

// ── PRE-MONITORING CARD ───────────────────────────────────────
function PreMonitoringCard({ workerId }: { workerId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!workerId) return;
    const r = ref(rtdb, `sensors/${workerId}/pre_monitor`);
    onValue(r, snap => { setData(snap.exists() ? snap.val() : null); });
    return () => off(r);
  }, [workerId]);

  const verdict = data?.result ?? null;
  const vColor  = verdict === 'SAFE' ? '#2ECC71' : verdict === 'WARNING' ? '#F39C12' : verdict === 'UNSAFE' ? '#E74C3C' : '#94A3B8';
  const vBg     = verdict === 'SAFE' ? '#E8F8F0' : verdict === 'WARNING' ? '#FEF9E7' : verdict === 'UNSAFE' ? '#FDEDEC' : '#F0F4F8';
  const vIcon   = verdict === 'SAFE' ? 'check-circle' : verdict === 'WARNING' ? 'alert-circle' : verdict === 'UNSAFE' ? 'close-circle' : 'radar';
  const vLabel  = verdict === 'SAFE' ? 'SAFE — Entry Permitted' : verdict === 'WARNING' ? 'WARNING — Enter with Caution' : verdict === 'UNSAFE' ? 'UNSAFE — DO NOT ENTER!' : 'Awaiting scan...';
  const vSub    = verdict === 'SAFE' ? 'Normal precautions apply.' : verdict === 'WARNING' ? 'Full protective gear required.' : verdict === 'UNSAFE' ? 'Dangerous gas levels detected.' : 'Switch device to PRE mode and lower into sewer.';

  const levels = data ? [
    { label: 'Level 1', ch4: data.level1_ch4 ?? 0, co: data.level1_co ?? 0 },
    { label: 'Level 2', ch4: data.level2_ch4 ?? 0, co: data.level2_co ?? 0 },
    { label: 'Level 3', ch4: data.level3_ch4 ?? 0, co: data.level3_co ?? 0 },
  ] : [];

  const ch4Status = (v: number) => v >= 5000 ? 'danger' : v >= 1000 ? 'warning' : 'safe';
  const coStatus  = (v: number) => v >= 200  ? 'danger' : v >= 50   ? 'warning' : 'safe';

  return (
    <View style={pm.card}>
      <View style={pm.header}>
        <Text style={pm.title}>PRE-MONITORING</Text>
        <Text style={pm.sub}>3-Level Sewer Gas Sample</Text>
      </View>

      {/* Verdict banner */}
      <View style={[pm.verdict, { backgroundColor: vBg, borderColor: vColor }]}>
        <MaterialCommunityIcons name={vIcon as any} size={26} color={vColor} />
        <View style={{ flex: 1 }}>
          <Text style={[pm.vLabel, { color: vColor }]}>{vLabel}</Text>
          <Text style={pm.vSub}>{vSub}</Text>
        </View>
      </View>

      {/* 3-Level gas table */}
      {levels.length > 0 ? (
        <View style={pm.table}>
          <View style={pm.tableHead}>
            <Text style={[pm.th, { flex: 1 }]}>DEPTH</Text>
            <Text style={[pm.th, { flex: 1, textAlign: 'center' }]}>CH₄ (PPM)</Text>
            <Text style={[pm.th, { flex: 1, textAlign: 'center' }]}>CO (PPM)</Text>
          </View>
          {levels.map((lv, i) => (
            <View key={i} style={[pm.tableRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
              <Text style={[pm.td, { flex: 1, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' }]}>{lv.label}</Text>
              <View style={[pm.cell, { flex: 1 }]}>
                <View style={[pm.dot, { backgroundColor: STATUS_COLOR[ch4Status(lv.ch4)] }]} />
                <Text style={[pm.td, { color: STATUS_COLOR[ch4Status(lv.ch4)] }]}>{lv.ch4}</Text>
              </View>
              <View style={[pm.cell, { flex: 1 }]}>
                <View style={[pm.dot, { backgroundColor: STATUS_COLOR[coStatus(lv.co)] }]} />
                <Text style={[pm.td, { color: STATUS_COLOR[coStatus(lv.co)] }]}>{lv.co}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={pm.noData}>
          <MaterialCommunityIcons name="radar" size={26} color="#94A3B8" />
          <Text style={pm.noDataText}>No pre-monitor data yet</Text>
          <Text style={pm.noDataSub}>Device must be in PRE mode</Text>
        </View>
      )}

      {data?.rssi != null && (
        <Text style={pm.signal}>LoRa Signal: {data.rssi} dBm</Text>
      )}
    </View>
  );
}
const pm = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  sub: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 8, padding: 12, borderWidth: 1.5, marginBottom: 12 },
  vLabel: { fontSize: 13, fontFamily: 'Poppins_700Bold' },
  vSub: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B', marginTop: 2 },
  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' },
  tableHead: { flexDirection: 'row', backgroundColor: '#1A3C6E', paddingVertical: 8, paddingHorizontal: 10 },
  th: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#B8C8D8', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: '#F0F4F8' },
  cell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  td: { fontSize: 13, fontFamily: 'Poppins_500Medium', textAlign: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  noData: { alignItems: 'center', paddingVertical: 18, gap: 5 },
  noDataText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: '#94A3B8' },
  noDataSub: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#B0BEC5' },
  signal: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8', marginTop: 8 },
});

// ── MAIN SCREEN ───────────────────────────────────────────────
export default function OverviewScreen() {
  const { manager, language, setManager, setWorkers, setAlerts, setSensors, workers, alerts, sensors } = useStore();
  const T = getText(language);
  const now = useRealTimeClock();
  const [showSOS, setShowSOS] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const workerScrollRef = useRef<ScrollView | null>(null);
  const panResponder = useRef<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    if (!manager) return;
    const unsubWorkers = listenToWorkers(manager.uid, (w) => {
      setWorkers(w);
      if (w.length > 0) {
        listenToAllSensors(w.map(wk => wk.id), setSensors);
        setSelectedWorkerId(prev => prev || w[0].id);
      }
    });
    const zones = manager.zones.length > 0 ? manager.zones : SOLAPUR_ZONES.map(z => z.id);
    const unsubAlerts = listenToAlerts(zones, (a) => {
      setAlerts(a);
      if (a.some(al => (al.type === 'SOS' || al.type === 'FALL') && !al.resolved)) setShowSOS(true);
    });
    return () => { unsubWorkers(); unsubAlerts(); };
  }, [manager]);

  const seenAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('📊 Alerts changed, count:', alerts.length);
    if (alerts.length === 0) return;

    if (seenAlertIds.current.size === 0) {
      console.log('🆕 First load, marking all alerts as seen');
      seenAlertIds.current = new Set(alerts.map((alert) => alert.id));
      return;
    }

    const newestUnresolved = alerts
      .filter((alert) => !alert.resolved && !seenAlertIds.current.has(alert.id))
      .sort((left, right) => {
        const leftTs = (left.timestamp as any)?.toMillis?.() ?? 0;
        const rightTs = (right.timestamp as any)?.toMillis?.() ?? 0;
        return rightTs - leftTs;
      })[0];

    if (newestUnresolved) {
      console.log('🔔 NEW ALERT DETECTED:', newestUnresolved.id, newestUnresolved.type);
      // Play alert sound asynchronously
      playAlertSound(newestUnresolved).catch((error) => {
        console.warn('Failed to play alert sound:', error);
      });
      if (newestUnresolved.type === 'SOS' || newestUnresolved.type === 'FALL') {
        setShowSOS(true);
      }
    } else {
      console.log('ℹ️ No new unresolved alerts');
    }

    seenAlertIds.current = new Set(alerts.map((alert) => alert.id));
  }, [alerts]);

  // Setup pan responder for swipe gestures
  useEffect(() => {
    panResponder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dx) > 5,
      onPanResponderRelease: (evt, gestureState) => {
        const threshold = 50;
        const currentIdx = workers.findIndex(w => w.id === selectedWorkerId);
        if (currentIdx === -1) return;

        if (gestureState.dx > threshold && currentIdx > 0) {
          // Swipe right -> go to previous worker
          setSelectedWorkerId(workers[currentIdx - 1].id);
        } else if (gestureState.dx < -threshold && currentIdx < workers.length - 1) {
          // Swipe left -> go to next worker
          setSelectedWorkerId(workers[currentIdx + 1].id);
        }
      },
    });
  }, [workers, selectedWorkerId]);

  const activeSensor = selectedWorkerId ? sensors[selectedWorkerId] : Object.values(sensors)[0];
  const selectedWorker = workers.find(w => w.id === selectedWorkerId) || workers[0];
  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toTimeString().slice(0, 8);

  const s = activeSensor;
  const st = s ? getSensorStatus(s) : null;

  const handleLogout = async () => {
    await logoutManager();
    setManager(null);
    router.replace('/');
  };

  const isMobile = SCREEN_WIDTH < 768;

  return (
    <SafeAreaView style={main.safe} edges={['top']}>
      <SOSModal alerts={alerts} visible={showSOS} onDismiss={() => { setShowSOS(false); router.push('/(dashboard)/alerts'); }} />

      {/* TOP BAR - Improved for mobile */}
      <View style={main.topBar}>
        {isMobile ? (
          // Mobile layout - compact and worker-focused
          <View style={main.mobileTopContainer}>
            <View style={main.mobileTopTop}>
              <View style={main.logoBox}>
                <MaterialCommunityIcons name="shield-check" size={18} color="#FF6B00" />
              </View>
              <View style={main.mobileTopInfo}>
                <Text style={main.mobileOrgName}>Solapur Municipal Corporation</Text>
                <Text style={main.mobileOrgSub}>Smart Sewer Safety Monitoring</Text>
              </View>
              <TouchableOpacity style={main.logoutBtn} onPress={handleLogout}>
                <MaterialCommunityIcons name="logout" size={13} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Worker info section */}
            <View style={main.mobileWorkerInfo}>
              <View style={main.mobileWorkerLeft}>
                <Text style={main.mobileWorkerLabel}>CURRENT WORKER</Text>
                <Text style={main.mobileWorkerName}>
                  {selectedWorker?.name || 'Select Worker'}
                </Text>
                <Text style={main.mobileWorkerDetail}>
                  {selectedWorker?.employeeId || '—'} · {s?.manholeId ?? '—'}
                </Text>
              </View>
              <View style={main.mobileWorkerRight}>
                <View style={main.dtBox}>
                  <Text style={main.dtLabel}>TIME</Text>
                  <Text style={main.dtVal}>{timeStr}</Text>
                </View>
                <View style={main.liveBadge}>
                  <View style={main.liveDot} />
                  <Text style={main.liveText}>LIVE</Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          // Desktop layout
          <>
            <View style={main.topLeft}>
              <View style={main.logoBox}>
                <MaterialCommunityIcons name="shield-check" size={20} color="#FF6B00" />
              </View>
              <View>
                <Text style={main.topTitle}>Solapur Municipal Corporation</Text>
                <Text style={main.topSub}>
                  Smart Sewer Safety Monitoring · {s?.manholeId ?? '—'}, {s?.zone ? s.zone.charAt(0).toUpperCase() + s.zone.slice(1) + ' Zone' : '—'}
                </Text>
              </View>
            </View>
            <View style={main.topRight}>
              <View style={main.dtBox}>
                <Text style={main.dtLabel}>DATE</Text>
                <Text style={main.dtVal}>{dateStr}</Text>
              </View>
              <View style={main.dtBox}>
                <Text style={main.dtLabel}>TIME</Text>
                <Text style={main.dtVal}>{timeStr}</Text>
              </View>
              <View style={main.liveBadge}>
                <View style={main.liveDot} />
                <Text style={main.liveText}>LIVE</Text>
              </View>
              <TouchableOpacity style={main.logoutBtn} onPress={handleLogout}>
                <MaterialCommunityIcons name="logout" size={13} color="#fff" />
                <Text style={main.logoutText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* SOS BANNER */}
      {unresolvedCount > 0 && (
        <TouchableOpacity style={main.sosBanner} onPress={() => setShowSOS(true)}>
          <MaterialCommunityIcons name="alarm-light" size={15} color="#fff" />
          <Text style={main.sosBannerText}>
            {unresolvedCount} UNRESOLVED ALERT{unresolvedCount > 1 ? 'S' : ''} — TAP TO VIEW
          </Text>
        </TouchableOpacity>
      )}

      {/* TEST SOUND BUTTON - Temporary for debugging */}
      <TouchableOpacity 
        style={{
          position: 'absolute',
          top: 100,
          right: 20,
          backgroundColor: '#9C27B0',
          padding: 12,
          borderRadius: 8,
          zIndex: 9999,
        }}
        onPress={() => {
          console.log('🧪 TEST BUTTON CLICKED');
          playAlertSound({ id: 'test-' + Date.now(), type: 'SOS' }).catch(console.error);
        }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>🔊 TEST SOUND</Text>
      </TouchableOpacity>

      {/* WORKER SELECTOR - With swipe support */}
      {workers.length > 0 && (
        <View {...panResponder.current?.panHandlers} style={main.workerBar}>
          <ScrollView
            ref={workerScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 5 }}
            scrollEventThrottle={16}
          >
            {workers.map(w => {
              const ws = sensors[w.id] ? getSensorStatus(sensors[w.id]).overall : 'safe';
              const isSel = selectedWorkerId === w.id;
              return (
                <TouchableOpacity key={w.id}
                  style={[main.wTab, isSel && main.wTabActive, { borderColor: STATUS_COLOR[ws] }]}
                  onPress={() => setSelectedWorkerId(w.id)}>
                  <View style={[main.wDot, { backgroundColor: STATUS_COLOR[ws] }]} />
                  <View>
                    <Text style={[main.wTabTxt, isSel && { color: '#1A3C6E', fontFamily: 'Poppins_600SemiBold' }]}>
                      {w.name}
                    </Text>
                    <Text style={main.wTabId}>{sensors[w.id]?.manholeId ?? '—'}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={main.content}>
        <Text style={main.secLabel}>ENVIRONMENTAL PARAMETERS — REAL-TIME</Text>

        {/* ENV CARDS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
          <EnvCard label="METHANE (CH₄)" value={s ? s.ch4.toFixed(1) : '—'} unit="% LEL" status={st?.ch4 ?? 'safe'} />
          <EnvCard label="CARBON MONOXIDE (CO)" value={s ? s.h2s.toFixed(1) : '—'} unit="ppm" status={st?.h2s ?? 'safe'} />
          <EnvCard label="HYDROGEN SULFIDE (H₂S)" value={s ? String(s.co ?? 0) : '—'} unit="ppm" status={(s?.co ?? 0) > 50 ? 'danger' : (s?.co ?? 0) > 25 ? 'warning' : 'safe'} />
          <EnvCard label="OXYGEN (SpO₂)" value={s ? String(s.spO2) : '—'} unit="%" status={st?.spO2 ?? 'safe'} />
          <EnvCard label="HEART RATE" value={s ? String(s.heartRate) : '—'} unit="bpm" status={st?.heartRate ?? 'safe'} />
        </ScrollView>

        {/* 3-COLUMN GRID */}
        {isTablet ? (
          <View style={main.grid3}>
            <View style={main.col1}>
              <PreMonitoringCard workerId={selectedWorkerId ?? workers[0]?.id ?? 'w001'} />
              <GasTrendCard sensor={activeSensor} />
            </View>
            <View style={main.col2}>
              <WorkerConditionCard sensor={activeSensor} workerEmployeeId={selectedWorker?.employeeId ?? 'WRK-001'} />
              <SystemStatusCard sensor={activeSensor} managerName={manager?.name ?? 'Manager'} />
            </View>
            <View style={main.col3}>
              <AlertsLogCard alerts={alerts} />
              <ThresholdCard sensor={activeSensor} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <WorkerConditionCard sensor={activeSensor} workerEmployeeId={selectedWorker?.employeeId ?? 'WRK-001'} />
            <PreMonitoringCard workerId={selectedWorkerId ?? workers[0]?.id ?? 'w001'} />
            <GasTrendCard sensor={activeSensor} />
            <AlertsLogCard alerts={alerts} />
            <ThresholdCard sensor={activeSensor} />
            <SystemStatusCard sensor={activeSensor} managerName={manager?.name ?? 'Manager'} />
          </View>
        )}

        <Text style={main.footer}>
          Solapur Municipal Corporation · Smart Infrastructure Monitoring · {s?.manholeId ?? '—'}, {s?.zone ? s.zone.charAt(0).toUpperCase() + s.zone.slice(1) + ' Zone' : '—'}, Solapur
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const main = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F4F8' },
  topBar: { backgroundColor: '#1A3C6E', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: '#FF6B00', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Desktop layout
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // Mobile layout
  mobileTopContainer: { gap: 10 , width: '100%'},
  mobileTopTop: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', width: '100%',    },
  mobileTopInfo: { flex: 1 ,minWidth: 0},
  mobileOrgName: { color: '#fff', fontSize: 13, fontFamily: 'Poppins_700Bold', flexShrink: 1},
  mobileOrgSub: { color: '#B8C8D8', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 2 },

  mobileWorkerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  mobileWorkerLeft: { flex: 1 },
  mobileWorkerLabel: { color: '#8899AA', fontSize: 9, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.5 },
  mobileWorkerName: { color: '#fff', fontSize: 15, fontFamily: 'Poppins_700Bold', marginTop: 3 },
  mobileWorkerDetail: { color: '#B8C8D8', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  mobileWorkerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  logoBox: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,107,0,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,107,0,0.4)' },
  topTitle: { color: '#fff', fontSize: 12, fontFamily: 'Poppins_700Bold' },
  topSub: { color: '#B8C8D8', fontSize: 10, fontFamily: 'Poppins_400Regular' },
  dtBox: { alignItems: 'center' },
  dtLabel: { color: '#8899AA', fontSize: 8, fontFamily: 'Poppins_400Regular', letterSpacing: 0.5 },
  dtVal: { color: '#fff', fontSize: 12, fontFamily: 'Poppins_700Bold' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(46,204,113,0.15)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(46,204,113,0.4)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2ECC71' },
  liveText: { color: '#2ECC71', fontSize: 10, fontFamily: 'Poppins_700Bold' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  logoutText: { color: '#fff', fontSize: 11, fontFamily: 'Poppins_500Medium' },
  sosBanner: { backgroundColor: '#E74C3C', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 7 },
  sosBannerText: { color: '#fff', fontSize: 12, fontFamily: 'Poppins_700Bold', flex: 1 },
  workerBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', maxHeight: 80 },
  wTab: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  wTabActive: { backgroundColor: '#EBF5FB', borderColor: '#1A3C6E' },
  wDot: { width: 8, height: 8, borderRadius: 4 },
  wTabTxt: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  wTabId: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#94A3B8', marginTop: 2 },
  content: { padding: 12, paddingBottom: 40, gap: 12 },
  secLabel: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: '#64748B', letterSpacing: 0.8 },
  grid3: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  col1: { flex: 1.1, gap: 10 },
  col2: { flex: 1.2, gap: 10 },
  col3: { flex: 1, gap: 10 },
  footer: { textAlign: 'center', fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8', marginTop: 8 },
});
