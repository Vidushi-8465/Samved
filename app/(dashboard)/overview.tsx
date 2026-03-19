// app/(dashboard)/overview.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Modal, Animated, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import {
  listenToWorkers, listenToAlerts, listenToAllSensors,
  getSensorStatus, SOLAPUR_ZONES, SensorData, Alert
} from '@/services/sensorService';
import { logoutManager } from '@/services/authService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH > 768;

const STATUS_COLOR = { safe: '#2ECC71', warning: '#F39C12', danger: '#E74C3C' };
const STATUS_BG    = { safe: '#E8F8F0', warning: '#FEF9E7', danger: '#FDEDEC' };
const STATUS_TEXT  = { safe: '#27AE60', warning: '#E67E22', danger: '#C0392B' };

function useRealTimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// SOS Modal
function SOSModal({ alerts, onDismiss }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const active = alerts.filter(a => (a.type === 'SOS' || a.type === 'FALL') && !a.resolved);
  useEffect(() => {
    if (active.length === 0) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 350, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 350, useNativeDriver: true }),
      ])
    ).start();
  }, [active.length]);
  if (active.length === 0) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={ss.overlay}>
        <Animated.View style={[ss.card, { transform: [{ scale: pulse }] }]}>
          <MaterialCommunityIcons name="alarm-light" size={52} color="#fff" />
          <Text style={ss.title}>EMERGENCY ALERT</Text>
          <Text style={ss.sub}>{active.length} worker{active.length > 1 ? 's require' : ' requires'} immediate response</Text>
          {active.map(a => (
            <View key={a.id} style={ss.row}>
              <MaterialCommunityIcons name="account-hard-hat" size={18} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={ss.wName}>{a.workerName}</Text>
                <Text style={ss.wSub}>{a.manholeId} · {a.zone} · {a.type === 'FALL' ? 'Fall Detected' : 'SOS Pressed'}</Text>
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
function EnvCard({ label, value, unit, status }) {
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
function WorkerConditionCard({ sensor, workerEmployeeId }) {
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
function SystemStatusCard({ sensor, managerName }) {
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
function AlertsLogCard({ alerts }) {
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
  const fmtTime = (ts) => {
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
        {alerts.slice(0, 12).map(a => (
          <View key={a.id} style={[al.row, { borderLeftColor: ALERT_COLOR[a.type] || '#E67E22', backgroundColor: ALERT_BG[a.type] || '#FEF9E7' }]}>
            <Text style={[al.time, { color: ALERT_COLOR[a.type] || '#E67E22' }]}>{fmtTime(a.timestamp)}</Text>
            <Text style={al.msg}>{LABEL[a.type] || a.type}</Text>
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
function ThresholdCard({ sensor }) {
  const status = sensor ? getSensorStatus(sensor) : null;
  const rows = [
    { label: 'CH₄ Gas Breach', badge: !sensor ? 'No Data' : status?.ch4 === 'danger' ? `Critical — ${sensor.ch4.toFixed(1)}% LEL` : status?.ch4 === 'warning' ? `Elevated — ${sensor.ch4.toFixed(1)}% LEL` : 'Within Limit', st: status?.ch4 ?? 'safe' },
    { label: 'H₂S Level', badge: !sensor ? 'No Data' : status?.h2s === 'danger' ? `Critical — ${sensor.h2s.toFixed(1)} PPM` : status?.h2s === 'warning' ? `Elevated — ${sensor.h2s.toFixed(1)} PPM` : 'Within Limit', st: status?.h2s ?? 'safe' },
    { label: 'CO Warning', badge: !sensor ? 'No Data' : (sensor.co ?? 0) > 50 ? `High — ${sensor.co} PPM` : (sensor.co ?? 0) > 25 ? `Elevated — ${sensor.co} PPM` : 'Within Limit', st: (sensor?.co ?? 0) > 50 ? 'danger' : (sensor?.co ?? 0) > 25 ? 'warning' : 'safe' },
    { label: 'SpO₂ Level', badge: !sensor ? 'No Data' : status?.spO2 === 'danger' ? `Critical — ${sensor.spO2}%` : status?.spO2 === 'warning' ? `Low — ${sensor.spO2}%` : `Adequate — ${sensor.spO2}%`, st: status?.spO2 ?? 'safe' },
    { label: 'Heart Rate', badge: !sensor ? 'No Data' : status?.heartRate === 'danger' ? `Critical — ${sensor.heartRate} BPM` : status?.heartRate === 'warning' ? `Elevated — ${sensor.heartRate} BPM` : `Normal — ${sensor.heartRate} BPM`, st: status?.heartRate ?? 'safe' },
    { label: 'Fall Detection', badge: sensor?.fallDetected ? 'FALL DETECTED' : 'No Event', st: sensor?.fallDetected ? 'danger' : 'safe' },
  ];
  return (
    <View style={th.card}>
      <Text style={th.title}>Threshold Status</Text>
      {rows.map((r, i) => (
        <View key={r.label} style={[th.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={th.label}>{r.label}</Text>
          <View style={[th.badge, { backgroundColor: STATUS_BG[r.st] }]}>
            <Text style={[th.badgeText, { color: STATUS_TEXT[r.st] }]}>{r.badge}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
const th = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#1A202C', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F4F8' },
  label: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: '#64748B', flex: 1 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
});

// Gas Trend Chart
function GasTrendCard({ sensor }) {
  const [history, setHistory] = useState(Array(20).fill({ ch4: 0, h2s: 0, co: 0 }));
  useEffect(() => {
    if (!sensor) return;
    setHistory(prev => [...prev.slice(1), { ch4: sensor.ch4 || 0, h2s: sensor.h2s || 0, co: sensor.co || 0 }]);
  }, [sensor?.lastUpdated]);

  const chartW = Math.min(SCREEN_WIDTH - 80, 400);
  const chartH = 90;
  const maxVal = 50;

  const polyline = (key, color) => {
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

// ── MAIN SCREEN ───────────────────────────────────────────────
export default function OverviewScreen() {
  const { manager, language, setManager, setWorkers, setAlerts, setSensors, workers, alerts, sensors } = useStore();
  const T = getText(language);
  const now = useRealTimeClock();
  const [showSOS, setShowSOS] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);

  useEffect(() => {
    if (!manager) return;
    const unsubWorkers = listenToWorkers(manager.uid, (w) => {
      console.log('Workers loaded:', w.length);
      setWorkers(w);
      if (w.length > 0) {
        listenToAllSensors(w.map(wk => wk.id), setSensors);
        setSelectedWorkerId(prev => prev || w[0].id);
      }
    });
    const zones = manager.zones.length > 0 ? manager.zones : SOLAPUR_ZONES.map(z => z.id);
    const unsubAlerts = listenToAlerts(zones, (a) => {
      console.log('Alerts loaded:', a.length);
      setAlerts(a);
      if (a.some(al => (al.type === 'SOS' || al.type === 'FALL') && !al.resolved)) setShowSOS(true);
    });
    return () => { unsubWorkers(); unsubAlerts(); };
  }, [manager]);

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

  return (
    <SafeAreaView style={main.safe} edges={['top']}>
      <SOSModal alerts={alerts} onDismiss={() => { setShowSOS(false); router.push('/(dashboard)/alerts'); }} />

      {/* TOP BAR */}
      <View style={[main.topBar, isTablet ? main.topBarRow : main.topBarCol]}>
        <View style={main.topLeft}>
          <View style={main.logoBox}>
            <MaterialCommunityIcons name="shield-check" size={20} color="#FF6B00" />
          </View>
          <View style={main.topLeftText}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={main.topTitle}>Solapur Municipal Corporation</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={main.topSub}>
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
          <View style={[main.liveBadge, main.topRightItem]}>
            <View style={main.liveDot} />
            <Text style={main.liveText}>LIVE</Text>
          </View>
          <TouchableOpacity style={[main.logoutBtn, main.topRightItem]} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={13} color="#fff" />
            <Text style={main.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
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

      {/* WORKER SELECTOR */}
      {workers.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={main.workerBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 5 }}>
          {workers.map(w => {
            const ws = sensors[w.id] ? getSensorStatus(sensors[w.id]).overall : 'safe';
            const isSel = selectedWorkerId === w.id;
            return (
              <TouchableOpacity key={w.id}
                style={[main.wTab, isSel && main.wTabActive, { borderColor: STATUS_COLOR[ws] }]}
                onPress={() => setSelectedWorkerId(w.id)}>
                <View style={[main.wDot, { backgroundColor: STATUS_COLOR[ws] }]} />
                <Text numberOfLines={1} ellipsizeMode="tail" style={[main.wTabTxt, isSel && { color: '#1A3C6E', fontFamily: 'Poppins_600SemiBold' }] }>
                  {w.name.split(' ')[0]}
                </Text>
                <Text style={main.wTabId}>{sensors[w.id]?.manholeId ?? '—'}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={main.content}>
        <Text style={main.secLabel}>ENVIRONMENTAL PARAMETERS — REAL-TIME</Text>

        {/* ENV CARDS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
          <EnvCard label="METHANE (CH₄)" value={s ? s.ch4.toFixed(1) : '—'} unit="% LEL" status={st?.ch4 ?? 'safe'} />
          <EnvCard label="HYDROGEN SULFIDE (H₂S)" value={s ? s.h2s.toFixed(1) : '—'} unit="ppm" status={st?.h2s ?? 'safe'} />
          <EnvCard label="CARBON MONOXIDE (CO)" value={s ? String(s.co ?? 0) : '—'} unit="ppm" status={(s?.co ?? 0) > 50 ? 'danger' : (s?.co ?? 0) > 25 ? 'warning' : 'safe'} />
          <EnvCard label="OXYGEN (SpO₂)" value={s ? String(s.spO2) : '—'} unit="%" status={st?.spO2 ?? 'safe'} />
          <EnvCard label="HEART RATE" value={s ? String(s.heartRate) : '—'} unit="bpm" status={st?.heartRate ?? 'safe'} />
        </ScrollView>

        {/* 3-COLUMN GRID */}
        {isTablet ? (
          <View style={main.grid3}>
            <View style={main.col1}>
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
  topBar: { backgroundColor: '#1A3C6E', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: '#FF6B00' },
  topBarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarCol: { flexDirection: 'column', gap: 10 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' },
  topLeftText: { flex: 1, minWidth: 0 },
  logoBox: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,107,0,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,107,0,0.4)' },
  topTitle: { color: '#fff', fontSize: 12, fontFamily: 'Poppins_700Bold', flexShrink: 1 },
  topSub: { color: '#B8C8D8', fontSize: 10, fontFamily: 'Poppins_400Regular', flexShrink: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  topRightItem: { marginLeft: 10 },
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
  workerBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', maxHeight: 50 },
  wTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', minWidth: 90, maxWidth: 120 },
  wTabActive: { backgroundColor: '#EBF5FB', borderColor: '#1A3C6E' },
  wDot: { width: 7, height: 7, borderRadius: 4 },
  wTabTxt: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: '#64748B', flexShrink: 1 },
  wTabId: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8' },
  content: { padding: 12, paddingBottom: 40, gap: 12 },
  secLabel: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: '#64748B', letterSpacing: 0.8 },
  grid3: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  col1: { flex: 1.1, gap: 10 },
  col2: { flex: 1.2, gap: 10 },
  col3: { flex: 1, gap: 10 },
  footer: { textAlign: 'center', fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8', marginTop: 8 },
});
