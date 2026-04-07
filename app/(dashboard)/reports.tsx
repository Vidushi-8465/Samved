// app/(dashboard)/reports.tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Line, Text as SvgText, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { listenToWorkers, listenToAlerts, listenToAllSensors, SOLAPUR_ZONES, SensorData, WorkerProfile, Alert as LiveAlert } from '@/services/sensorService';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

const SCREEN_W = Dimensions.get('window').width;

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month';

type ReportAlert = {
  workerName: string;
  zone: string;
  type: string;
  value: string;
  resolved: boolean;
  timestamp: any;
};

type PremonitoringReading = {
  workerId: string;
  workerName?: string;
  zone?: string;
  heartRate?: number | null;
  spo2?: number | null;
  temperature?: number | null;
  timestamp: any;
};

type GasReading = {
  zone: string;
  sewerLine?: string;
  ch4?: number | null;
  h2s?: number | null;
  co?: number | null;
  o2?: number | null;
  nh3?: number | null;
  timestamp: any;
};

// ─── Gas config ───────────────────────────────────────────────────────────────

const GAS_CONFIG = [
  { key: 'ch4', label: 'CH\u2084', unit: 'ppm', color: '#F97316', safeMax: 1000,  dangerAt: 5000 },
  { key: 'h2s', label: 'H\u2082S', unit: 'ppm', color: '#DC2626', safeMax: 1,     dangerAt: 5    },
  { key: 'co',  label: 'CO',       unit: 'ppm', color: '#6B7280', safeMax: 25,    dangerAt: 200  },
  { key: 'o2',  label: 'O\u2082',  unit: '%',   color: '#16A34A', safeMax: 23.5,  dangerAt: 19.5 },
  { key: 'nh3', label: 'NH\u2083', unit: 'ppm', color: '#7C3AED', safeMax: 25,    dangerAt: 300  },
] as const;

type GasKey = typeof GAS_CONFIG[number]['key'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timestampToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') {
    // Some devices can emit epoch seconds, while Firebase snapshots use epoch ms.
    return new Date(ts < 1_000_000_000_000 ? ts * 1000 : ts);
  }
  return new Date(ts);
}

function getPeriodStart(period: Period): Date {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') {
    const s = new Date(now);
    s.setDate(now.getDate() - 6);
    s.setHours(0, 0, 0, 0);
    return s;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isInPeriod(ts: any, period: Period): boolean {
  // If no timestamp, treat as current (live sensor data) — always include
  if (ts == null) return true;
  const d = timestampToDate(ts);
  if (!d || isNaN(d.getTime())) return true;
  return d >= getPeriodStart(period);
}

function avg(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && !isNaN(x) && x > 0);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

function formatVal(val: number | null | undefined, unit: string): string {
  return val == null ? 'N/A' : `${val}${unit}`;
}

// ─── Trend helpers ────────────────────────────────────────────────────────────

function getPeriodBuckets(period: Period): string[] {
  if (period === 'today') return ['12a', '4a', '8a', '12p', '4p', '8p'];
  if (period === 'month') return ['W1', 'W2', 'W3', 'W4'];
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

function getBucketIndex(date: Date, period: Period): number {
  if (period === 'today') return Math.min(Math.floor(date.getHours() / 4), 5);
  if (period === 'month') return Math.min(Math.floor((date.getDate() - 1) / 7), 3);
  return (date.getDay() + 6) % 7;
}

function getAlertTrend(alerts: ReportAlert[], period: Period) {
  const labels = getPeriodBuckets(period);
  const buckets = new Array(labels.length).fill(0);
  const now = new Date();
  alerts.forEach((a) => {
    const d = timestampToDate(a.timestamp) ?? now;
    buckets[getBucketIndex(d, period)] += 1;
  });
  return labels.map((label, i) => ({ label, value: buckets[i] }));
}

function getGasTrend(readings: GasReading[], gasKey: GasKey, period: Period) {
  const labels = getPeriodBuckets(period);
  const buckets: number[][] = labels.map(() => []);
  const now = new Date();
  readings.forEach((r) => {
    const d = timestampToDate(r.timestamp) ?? now;
    const val = r[gasKey];
    if (val != null && val > 0) buckets[getBucketIndex(d, period)].push(val as number);
  });
  return labels.map((label, i) => ({
    label,
    value: buckets[i].length
      ? Math.round((buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length) * 10) / 10
      : null,
  }));
}

// ─── CSV / HTML helpers ───────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const t = String(v ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function BarChart({ data, color, height = 120 }: { data: { label: string; value: number }[]; color: string; height?: number }) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 20, bottom: 28, left: 28, right: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(chartW / data.length - 6, 4);

  return (
    <Svg width={W} height={height}>
      <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="#E2E8F0" strokeWidth={1} />
      <Line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="#E2E8F0" strokeWidth={1} />
      {data.map((d, i) => {
        const x = PAD.left + (i * chartW) / data.length + (chartW / data.length - barW) / 2;
        const barH = Math.max((d.value / max) * chartH, d.value > 0 ? 3 : 0);
        const y = PAD.top + chartH - barH;
        return (
          <React.Fragment key={d.label}>
            <Rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />
            {d.value > 0 && <SvgText x={x + barW / 2} y={y - 4} fontSize={8} fill="#64748B" textAnchor="middle">{d.value}</SvgText>}
            <SvgText x={x + barW / 2} y={PAD.top + chartH + 14} fontSize={8} fill="#94A3B8" textAnchor="middle">{d.label}</SvgText>
          </React.Fragment>
        );
      })}
      <SvgText x={PAD.left - 2} y={PAD.top + 4} fontSize={8} fill="#94A3B8" textAnchor="end">{max}</SvgText>
    </Svg>
  );
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────

function LineChart({
  data, color, safeMax, dangerAt, height = 130,
}: {
  data: { label: string; value: number | null }[];
  color: string;
  unit: string;
  safeMax: number;
  dangerAt: number;
  height?: number;
}) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 24, bottom: 28, left: 36, right: 12 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  const validVals = data.map((d) => d.value).filter((v): v is number => v != null);
  if (!validVals.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'Poppins_400Regular' }}>No data this period</Text>
      </View>
    );
  }

  const rawMax = Math.max(...validVals, safeMax * 1.1);
  const rawMin = Math.min(...validVals, 0);
  const range = rawMax - rawMin || 1;
  const toY = (v: number) => PAD.top + chartH - ((v - rawMin) / range) * chartH;
  const toX = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * chartW;

  const points = data.map((d, i) => d.value != null ? { x: toX(i), y: toY(d.value) } : null).filter(Boolean) as { x: number; y: number }[];
  let pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + (points.length ? ` L ${points[points.length - 1].x} ${PAD.top + chartH} L ${points[0].x} ${PAD.top + chartH} Z` : '');

  const safeY = toY(Math.min(safeMax, rawMax));
  const dangerY = toY(Math.min(dangerAt, rawMax));
  const gradId = `grad${color.replace('#', '')}`;

  return (
    <Svg width={W} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.25" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = PAD.top + t * chartH;
        return (
          <React.Fragment key={t}>
            <Line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#F1F5F9" strokeWidth={1} />
            <SvgText x={PAD.left - 3} y={y + 3} fontSize={7} fill="#CBD5E1" textAnchor="end">{Math.round(rawMax - t * range)}</SvgText>
          </React.Fragment>
        );
      })}
      {safeY > PAD.top && safeY < PAD.top + chartH && (
        <Line x1={PAD.left} y1={safeY} x2={PAD.left + chartW} y2={safeY} stroke="#16A34A" strokeWidth={1} strokeDasharray="4,3" />
      )}
      {dangerY > PAD.top && dangerY < PAD.top + chartH && (
        <Line x1={PAD.left} y1={dangerY} x2={PAD.left + chartW} y2={dangerY} stroke="#DC2626" strokeWidth={1} strokeDasharray="4,3" />
      )}
      <Path d={areaD} fill={`url(#${gradId})`} />
      <Path d={pathD} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={3} fill={color} stroke="white" strokeWidth={1.5} />)}
      {data.map((d, i) => (
        <SvgText key={d.label} x={toX(i)} y={PAD.top + chartH + 14} fontSize={8} fill="#94A3B8" textAnchor="middle">{d.label}</SvgText>
      ))}
      {safeY > PAD.top && safeY < PAD.top + chartH && <SvgText x={PAD.left + chartW} y={safeY - 3} fontSize={7} fill="#16A34A" textAnchor="end">safe</SvgText>}
      {dangerY > PAD.top && dangerY < PAD.top + chartH && <SvgText x={PAD.left + chartW} y={dangerY - 3} fontSize={7} fill="#DC2626" textAnchor="end">danger</SvgText>}
    </Svg>
  );
}

// ─── Radial Gauge ─────────────────────────────────────────────────────────────

function GaugeChart({ value, max, color, label, unit }: { value: number | null; max: number; color: string; label: string; unit: string }) {
  const SIZE = 84, R = 30, cx = SIZE / 2, cy = SIZE / 2;
  const pct = value != null ? Math.min(Math.max(value / max, 0), 1) : 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcPath = (from: number, to: number) => {
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${cx + R * Math.cos(toRad(from))} ${cy + R * Math.sin(toRad(from))} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(toRad(to))} ${cy + R * Math.sin(toRad(to))}`;
  };
  const fillEnd = -210 + 240 * pct;
  return (
    <View style={{ alignItems: 'center', width: SIZE + 8 }}>
      <Svg width={SIZE} height={SIZE}>
        <Path d={arcPath(-210, 30)} stroke="#E2E8F0" strokeWidth={6} fill="none" strokeLinecap="round" />
        {value != null && pct > 0 && <Path d={arcPath(-210, fillEnd)} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" />}
        <SvgText x={cx} y={cy + 4} fontSize={11} fontWeight="bold" fill={value != null ? color : '#CBD5E1'} textAnchor="middle">{value ?? '—'}</SvgText>
        <SvgText x={cx} y={cy + 14} fontSize={7} fill="#94A3B8" textAnchor="middle">{unit}</SvgText>
      </Svg>
      <Text style={{ fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#64748B', marginTop: -4 }}>{label}</Text>
    </View>
  );
}


// ─── AI Analysis ─────────────────────────────────────────────────────────────
const AI_ANALYSIS_URL =
  process.env.EXPO_PUBLIC_AI_ANALYSIS_URL?.trim() ||
  (Platform.OS === 'android'
    ? 'http://10.0.2.2:5000/ai-analysis'
    : 'http://localhost:5000/ai-analysis');

async function fetchAiAnalysis(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(AI_ANALYSIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`AI server error (${res.status})`);

    const data = await res.json();
    const text = typeof data?.result === 'string' ? data.result.trim() : '';
    if (!text) throw new Error('AI server returned an empty response');
    return text;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('AI request timed out. Please try again.');
    if (error instanceof TypeError) throw new Error(`Cannot reach AI server at ${AI_ANALYSIS_URL}. Check backend URL/network.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAnalysisPrompt(p: {
  period: string;
  totalAlerts: number;
  resolvedAlerts: number;
  resolutionRate: number;
  alertsByType: { label: string; count: number }[];
  premonitoringStats: {
    avgHeartRate: number | null;
    avgSpo2: number | null;
    avgTemperature: number | null;
    readingsCount: number;
  };
  overallGas: {
    avgCh4: number | null;
    avgH2s: number | null;
    avgCo: number | null;
    avgO2: number | null;
    avgNh3: number | null;
  };
  gasStats: {
    zone: string;
    sewerLine: string;
    avgCh4: number | null;
    avgH2s: number | null;
    avgCo: number | null;
    avgO2: number | null;
    avgNh3: number | null;
    readingsCount: number;
  }[];
  workersCount: number;
}): string {
  const g = p.overallGas;
  const pm = p.premonitoringStats;

  return `
You are a safety analyst for sewer workers. Provide concise, actionable insights.

Analyze this sewer safety report — period: ${p.period.toUpperCase()}

WORKFORCE: ${p.workersCount} workers

ALERTS:
Total=${p.totalAlerts}
Resolved=${p.resolvedAlerts}
Resolution=${p.resolutionRate}%
Breakdown: ${p.alertsByType.map(a => `${a.label}:${a.count}`).join(", ")}

VITALS (${pm.readingsCount} readings):
Heart Rate: ${pm.avgHeartRate ?? "N/A"} bpm (safe 60-100)
SpO2: ${pm.avgSpo2 ?? "N/A"}% (safe >95%)
Temperature: ${pm.avgTemperature ?? "N/A"}°C (safe 36-37.5)

GAS CONCENTRATIONS:
CH4: ${g.avgCh4 ?? "N/A"} ppm (>200 danger)
H2S: ${g.avgH2s ?? "N/A"} ppm (>1 TWA, 50 IDLH)
CO: ${g.avgCo ?? "N/A"} ppm (>25 TWA)
O2: ${g.avgO2 ?? "N/A"}% (safe 19.5–23.5)
NH3: ${g.avgNh3 ?? "N/A"} ppm (>25 TWA)

BY ZONE:
${p.gasStats
  .map(z => `${z.zone}/${z.sewerLine}: CH4=${z.avgCh4 ?? "N/A"}, H2S=${z.avgH2s ?? "N/A"}, CO=${z.avgCo ?? "N/A"}, O2=${z.avgO2 ?? "N/A"}%, NH3=${z.avgNh3 ?? "N/A"} (${z.readingsCount})`)
  .join("\n")}

Provide sections:
OVERALL SAFETY ASSESSMENT
CRITICAL RISKS
WORKER HEALTH OBSERVATIONS
ZONE CONCERNS
RECOMMENDED ACTIONS (top 3)
TREND OUTLOOK

Keep under 300 words. Be specific with numbers.
`;
}

// ─── Report builders ──────────────────────────────────────────────────────────

interface ReportParams {
  period: Period; managerName: string; workersCount: number;
  totalAlerts: number; resolvedAlerts: number; resolutionRate: number;
  alertsByType: { label: string; count: number }[];
  zoneRows: { name: string; workers: number; alerts: number; resolvedRate: number }[];
  recentAlerts: ReportAlert[];
  premonitoringStats: { avgHeartRate: number | null; avgSpo2: number | null; avgTemperature: number | null; readingsCount: number };
  gasStats: { zone: string; sewerLine: string; avgCh4: number | null; avgH2s: number | null; avgCo: number | null; avgO2: number | null; avgNh3: number | null; readingsCount: number }[];
  overallGas: { avgCh4: number | null; avgH2s: number | null; avgCo: number | null; avgO2: number | null; avgNh3: number | null };
  aiAnalysis?: string;
}

function buildReportHtml(p: ReportParams): string {
  const now = new Date().toLocaleString('en-IN');
  const pl = p.period.charAt(0).toUpperCase() + p.period.slice(1);
  const g = p.overallGas;
  const pm = p.premonitoringStats;

  const summaryCards = [
    { label: 'Total Workers', value: p.workersCount },
    { label: 'Total Alerts', value: p.totalAlerts },
    { label: 'Resolved', value: p.resolvedAlerts },
    { label: 'Resolution Rate', value: `${p.resolutionRate}%` },
  ].map((c) => `<div class="card"><div class="cardLabel">${c.label}</div><div class="cardValue">${c.value}</div></div>`).join('');

  const alertRows = p.recentAlerts.length
    ? p.recentAlerts.map((a) => `<tr><td>${esc(timestampToDate(a.timestamp)?.toLocaleString('en-IN') ?? '--')}</td><td>${esc(a.workerName)}</td><td>${esc(a.zone)}</td><td>${esc(a.type)}</td><td>${esc(a.value)}</td><td>${a.resolved ? '<span style="color:#16a34a">Resolved</span>' : '<span style="color:#dc2626">Open</span>'}</td></tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:#64748B">No alerts</td></tr>';

  const gasZoneRows = p.gasStats.length
    ? p.gasStats.map((z) => `<tr><td>${esc(z.zone)}</td><td>${esc(z.sewerLine)}</td><td>${z.avgCh4 ?? 'N/A'}</td><td>${z.avgH2s ?? 'N/A'}</td><td>${z.avgCo ?? 'N/A'}</td><td>${z.avgO2 ?? 'N/A'}</td><td>${z.avgNh3 ?? 'N/A'}</td><td>${z.readingsCount}</td></tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:#64748B">No gas data</td></tr>';

  const aiSection = p.aiAnalysis
    ? `<h2>AI Safety Analysis</h2><div class="ai-box">${esc(p.aiAnalysis).replace(/\n/g, '<br/>')}</div>` : '';

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:Arial,sans-serif;color:#1A202C;padding:24px;max-width:900px;margin:0 auto;}
h1{margin:0 0 6px;color:#1A3C6E;font-size:22px;}h2{font-size:15px;margin:24px 0 10px;color:#1A3C6E;border-bottom:2px solid #E2E8F0;padding-bottom:4px;}
.meta{color:#64748B;font-size:12px;margin-bottom:20px;}.grid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
.card{border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;min-width:130px;}.cardLabel{font-size:10px;color:#64748B;text-transform:uppercase;}.cardValue{font-size:20px;font-weight:700;color:#1A202C;margin-top:4px;}
ul{padding:0;list-style:none;}ul li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F1F5F9;font-size:13px;}
table{width:100%;border-collapse:collapse;font-size:12px;}th,td{border-bottom:1px solid #E2E8F0;text-align:left;padding:8px 6px;}th{color:#64748B;font-size:10px;text-transform:uppercase;background:#F8FAFC;}
.ai-box{background:#F0F7FF;border-left:4px solid #1A3C6E;padding:16px;font-size:13px;line-height:1.8;border-radius:0 8px 8px 0;}
.footer{margin-top:32px;font-size:11px;color:#94A3B8;text-align:center;}
</style></head><body>
<h1>SMC LiveMonitor Safety Report</h1>
<div class="meta">Period: <strong>${pl}</strong> &nbsp;|&nbsp; Manager: <strong>${esc(p.managerName)}</strong> &nbsp;|&nbsp; Generated: <strong>${now}</strong></div>
<h2>Summary</h2><div class="grid">${summaryCards}</div>
<h2>Alert Breakdown</h2><ul>${p.alertsByType.map((a) => `<li><span>${esc(a.label)}</span><strong>${a.count}</strong></li>`).join('')}</ul>
<h2>Zone Performance</h2><ul>${p.zoneRows.map((z) => `<li><span>${esc(z.name)}</span><span>${z.workers} workers · ${z.alerts} alerts · ${z.resolvedRate}% resolved</span></li>`).join('')}</ul>
<h2>Pre-Monitoring Vitals (${pm.readingsCount} readings)</h2>
<div class="grid">
  <div class="card"><div class="cardLabel">Avg Heart Rate</div><div class="cardValue">${formatVal(pm.avgHeartRate, ' bpm')}</div></div>
  <div class="card"><div class="cardLabel">Avg SpO\u2082</div><div class="cardValue">${formatVal(pm.avgSpo2, '%')}</div></div>
  <div class="card"><div class="cardLabel">Avg Temperature</div><div class="cardValue">${formatVal(pm.avgTemperature, '\u00b0C')}</div></div>
</div>
<h2>Overall Gas Concentration</h2>
<div class="grid">
  <div class="card"><div class="cardLabel">CH\u2084</div><div class="cardValue">${formatVal(g.avgCh4, ' ppm')}</div></div>
  <div class="card"><div class="cardLabel">H\u2082S</div><div class="cardValue">${formatVal(g.avgH2s, ' ppm')}</div></div>
  <div class="card"><div class="cardLabel">CO</div><div class="cardValue">${formatVal(g.avgCo, ' ppm')}</div></div>
  <div class="card"><div class="cardLabel">O\u2082</div><div class="cardValue">${formatVal(g.avgO2, '%')}</div></div>
  <div class="card"><div class="cardLabel">NH\u2083</div><div class="cardValue">${formatVal(g.avgNh3, ' ppm')}</div></div>
</div>
<h2>Gas by Zone / Sewer Line (ppm, O\u2082 in %)</h2>
<table><thead><tr><th>Zone</th><th>Sewer Line</th><th>CH\u2084</th><th>H\u2082S</th><th>CO</th><th>O\u2082</th><th>NH\u2083</th><th>Readings</th></tr></thead><tbody>${gasZoneRows}</tbody></table>
${aiSection}
<h2>Recent Alerts (up to 20)</h2>
<table><thead><tr><th>Time</th><th>Worker</th><th>Zone</th><th>Type</th><th>Value</th><th>Status</th></tr></thead><tbody>${alertRows}</tbody></table>
<div class="footer">SMC LiveMonitor &copy; ${new Date().getFullYear()} \u2014 Solapur Municipal Corporation</div>
</body></html>`;
}

function buildReportCsv(p: ReportParams): string {
  const lines: string[] = [];
  const now = new Date().toLocaleString('en-IN');
  lines.push('SMC LiveMonitor Safety Report');
  lines.push(`Period,${csvCell(p.period)}`);
  lines.push(`Manager,${csvCell(p.managerName)}`);
  lines.push(`Generated,${csvCell(now)}`);
  lines.push('');
  lines.push('SUMMARY');
  lines.push(`Total Workers,${p.workersCount}`);
  lines.push(`Total Alerts,${p.totalAlerts}`);
  lines.push(`Resolved,${p.resolvedAlerts}`);
  lines.push(`Resolution Rate,${p.resolutionRate}%`);
  lines.push('');
  lines.push('ALERT BREAKDOWN');
  lines.push('Type,Count');
  p.alertsByType.forEach((a) => lines.push(`${csvCell(a.label)},${a.count}`));
  lines.push('');
  lines.push('ZONE PERFORMANCE');
  lines.push('Zone,Workers,Alerts,Resolution Rate');
  p.zoneRows.forEach((z) => lines.push(`${csvCell(z.name)},${z.workers},${z.alerts},${z.resolvedRate}%`));
  lines.push('');
  lines.push('PRE-MONITORING VITALS');
  lines.push(`Heart Rate (bpm),${p.premonitoringStats.avgHeartRate ?? 'N/A'}`);
  lines.push(`SpO2 (%),${p.premonitoringStats.avgSpo2 ?? 'N/A'}`);
  lines.push(`Temperature (C),${p.premonitoringStats.avgTemperature ?? 'N/A'}`);
  lines.push(`Readings Count,${p.premonitoringStats.readingsCount}`);
  lines.push('');
  lines.push('OVERALL GAS');
  lines.push(`CH4 (ppm),${p.overallGas.avgCh4 ?? 'N/A'}`);
  lines.push(`H2S (ppm),${p.overallGas.avgH2s ?? 'N/A'}`);
  lines.push(`CO (ppm),${p.overallGas.avgCo ?? 'N/A'}`);
  lines.push(`O2 (%),${p.overallGas.avgO2 ?? 'N/A'}`);
  lines.push(`NH3 (ppm),${p.overallGas.avgNh3 ?? 'N/A'}`);
  lines.push('');
  lines.push('GAS BY ZONE');
  lines.push('Zone,Sewer Line,CH4 (ppm),H2S (ppm),CO (ppm),O2 (%),NH3 (ppm),Readings');
  p.gasStats.forEach((z) =>
    lines.push([csvCell(z.zone), csvCell(z.sewerLine), z.avgCh4 ?? 'N/A', z.avgH2s ?? 'N/A', z.avgCo ?? 'N/A', z.avgO2 ?? 'N/A', z.avgNh3 ?? 'N/A', z.readingsCount].join(','))
  );
  if (p.aiAnalysis) {
    lines.push('');
    lines.push('AI SAFETY ANALYSIS');
    lines.push(csvCell(p.aiAnalysis));
  }
  lines.push('');
  lines.push('RECENT ALERTS');
  lines.push('Time,Worker,Zone,Type,Value,Status');
  p.recentAlerts.forEach((a) => {
    lines.push([
      csvCell(timestampToDate(a.timestamp)?.toLocaleString('en-IN') ?? '--'),
      csvCell(a.workerName), csvCell(a.zone), csvCell(a.type), csvCell(a.value),
      a.resolved ? 'Resolved' : 'Open',
    ].join(','));
  });
  return lines.join('\n');
}

// ─── Web helpers ──────────────────────────────────────────────────────────────

function downloadCsvWeb(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function openPdfWeb(html: string) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup blocked — please allow popups for this site.');
  win.document.open(); win.document.write(html); win.document.close();
  win.onload = () => { win.focus(); win.print(); setTimeout(() => win.close(), 1000); };
  setTimeout(() => { if (!win.closed) { win.focus(); win.print(); } }, 800);
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  // ── Pull everything from store ───────────────────────────────────────────
  const { language, workers, alerts, manager, sensors } = useStore();
  const T = getText(language);
  const [period, setPeriod] = useState<Period>('week');
  const [exporting, setExporting] = useState<false | 'pdf' | 'csv' | 'both'>(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedGas, setSelectedGas] = useState<GasKey>('h2s');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [liveWorkers, setLiveWorkers] = useState<WorkerProfile[]>([]);
  const [liveSensors, setLiveSensors] = useState<Record<string, SensorData>>({});
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);

  useEffect(() => {
    if (!manager) return;

    let sensorUnsub: (() => void) | null = null;

    const unsubWorkers = listenToWorkers(manager.uid, (nextWorkers) => {
      setLiveWorkers(nextWorkers);

      if (sensorUnsub) {
        sensorUnsub();
        sensorUnsub = null;
      }

      if (nextWorkers.length > 0) {
        sensorUnsub = listenToAllSensors(nextWorkers.map((worker) => worker.id), setLiveSensors);
      } else {
        setLiveSensors({});
      }
    });

    const zones = manager.zones.length > 0 ? manager.zones : SOLAPUR_ZONES.map((zone) => zone.id);
    const unsubAlerts = listenToAlerts(zones, setLiveAlerts);

    return () => {
      if (sensorUnsub) {
        sensorUnsub();
      }
      unsubWorkers();
      unsubAlerts();
    };
  }, [manager]);

  const effectiveWorkers = liveWorkers.length > 0 ? liveWorkers : workers;
  const effectiveSensors = Object.keys(liveSensors).length > 0 ? liveSensors : sensors;
  const effectiveAlerts = liveAlerts.length > 0 ? liveAlerts : alerts;

  // ── Derive premonitoringReadings from sensors store ──────────────────────
  // sensors/{workerId} has: heartRate, spO2, mode, zone, locationLabel, lastUpdated
  // We use ALL sensor entries as pre-monitoring readings (live snapshot).
  // Timestamps: use sensor.lastUpdated (unix ms) if available, else now.
  const premonitoringReadings = useMemo((): PremonitoringReading[] => {
    return Object.entries(effectiveSensors).map(([workerId, s]) => ({
      workerId,
      workerName: effectiveWorkers.find((w: any) => w.id === workerId)?.name ?? workerId,
      zone: s.zone ?? s.locationLabel ?? 'Unknown',
      heartRate: s.heartRate && s.heartRate > 0 ? s.heartRate : null,
      spo2: s.spO2 && s.spO2 > 0 ? s.spO2 : null,
      temperature: null, // not available in your sensor schema
      // Use lastUpdated (RTDB epoch ms), fall back to now so period filter always passes
      timestamp: s.lastUpdated && s.lastUpdated > 0 ? s.lastUpdated : Date.now(),
    }));
  }, [effectiveSensors, effectiveWorkers]);

  // ── Derive gasReadings from sensors store ────────────────────────────────
  // sensors/{workerId} has: ch4 (mq4_ppm), h2s (mq7_ppm), zone, manholeId, lastUpdated
  // co, o2, nh3 not available in current hardware — will show as null
  const gasReadings = useMemo((): GasReading[] => {
    return Object.entries(effectiveSensors).map(([, s]) => ({
      zone: s.zone ?? s.locationLabel ?? 'Unknown',
      sewerLine: s.manholeId ?? s.locationLabel ?? 'Unknown',
      ch4: s.ch4 && s.ch4 > 0 ? s.ch4 : null,
      h2s: s.h2s && s.h2s > 0 ? s.h2s : null,
      co: null,  // MQ7 maps to H2S in your schema — CO sensor not wired separately
      o2: null,  // No O2 sensor in current hardware
      nh3: null, // No NH3 sensor in current hardware
      timestamp: s.lastUpdated && s.lastUpdated > 0 ? s.lastUpdated : Date.now(),
    }));
  }, [effectiveSensors]);

  // ── Alerts ──────────────────────────────────────────────────────────────────
  // Alerts generated in useStore have no timestamp field — add Date.now() fallback
  const periodAlerts = useMemo(
    () => (effectiveAlerts as ReportAlert[]).filter((a) => isInPeriod(a.timestamp ?? Date.now(), period)),
    [effectiveAlerts, period]
  );
  const totalAlerts = periodAlerts.length;
  const resolvedAlerts = periodAlerts.filter((a) => a.resolved).length;
  const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 100;

  const alertsByType = useMemo(() => [
    { label: 'SOS',        color: Colors.danger,  icon: 'alarm-light',       match: (t: string) => t === 'SOS' },
    { label: 'Gas',        color: Colors.warning, icon: 'gas-cylinder',      match: (t: string) => ['GAS', 'GAS_CRITICAL', 'CH4', 'H2S', 'CO', 'O2', 'NH3'].some((k) => t.includes(k)) },
    { label: 'SpO\u2082', color: Colors.accent,  icon: 'thermometer-alert', match: (t: string) => t.startsWith('SPO2') },
    { label: 'Inactivity', color: Colors.info,    icon: 'timer-off',         match: (t: string) => t === 'INACTIVITY' },
    { label: 'Heart Rate', color: '#9B59B6',      icon: 'heart-broken',      match: (t: string) => t === 'HEARTRATE' },
  ].map((type) => ({ ...type, count: periodAlerts.filter((a) => type.match(a.type)).length })), [periodAlerts]);

  // ── Premonitoring stats ─────────────────────────────────────────────────────
  const premonitoringStats = useMemo(() => {
    const r = premonitoringReadings.filter((x) => isInPeriod(x.timestamp, period));
    return {
      readingsCount: r.length,
      avgHeartRate: avg(r.map((x) => x.heartRate ?? null)),
      avgSpo2: avg(r.map((x) => x.spo2 ?? null)),
      avgTemperature: avg(r.map((x) => x.temperature ?? null)),
    };
  }, [premonitoringReadings, period]);

  // ── Gas ─────────────────────────────────────────────────────────────────────
  const periodGasReadings = useMemo(
    () => gasReadings.filter((r) => isInPeriod(r.timestamp, period)),
    [gasReadings, period]
  );

  const overallGas = useMemo(() => ({
    avgCh4: avg(periodGasReadings.map((r) => r.ch4 ?? null)),
    avgH2s: avg(periodGasReadings.map((r) => r.h2s ?? null)),
    avgCo:  avg(periodGasReadings.map((r) => r.co  ?? null)),
    avgO2:  avg(periodGasReadings.map((r) => r.o2  ?? null)),
    avgNh3: avg(periodGasReadings.map((r) => r.nh3 ?? null)),
  }), [periodGasReadings]);

  const gasStats = useMemo(() => {
    const map = new Map<string, GasReading[]>();
    periodGasReadings.forEach((r) => {
      const key = `${r.zone}||${r.sewerLine ?? 'Unknown'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).map(([key, recs]) => {
      const [zone, sewerLine] = key.split('||');
      return {
        zone, sewerLine,
        avgCh4: avg(recs.map((r) => r.ch4 ?? null)),
        avgH2s: avg(recs.map((r) => r.h2s ?? null)),
        avgCo:  avg(recs.map((r) => r.co  ?? null)),
        avgO2:  avg(recs.map((r) => r.o2  ?? null)),
        avgNh3: avg(recs.map((r) => r.nh3 ?? null)),
        readingsCount: recs.length,
      };
    });
  }, [periodGasReadings]);

  const gasTrendData = useMemo(() => getGasTrend(periodGasReadings, selectedGas, period), [periodGasReadings, selectedGas, period]);
  const alertTrendData = useMemo(() => getAlertTrend(periodAlerts, period), [periodAlerts, period]);

  // ── Zone rows ───────────────────────────────────────────────────────────────
  const zoneRows = useMemo(() => {
    const zones = [...new Set([
      ...effectiveWorkers.map((w: any) => w.zone),
      ...periodAlerts.map((a) => a.zone),
      ...Object.values(effectiveSensors).map((s) => s.zone ?? s.locationLabel),
    ].filter(Boolean))];
    return zones.map((zoneId: string) => {
      const za = periodAlerts.filter((a) => a.zone === zoneId);
      return {
        name: `${zoneId.charAt(0).toUpperCase() + zoneId.slice(1)} Zone`,
        workers: effectiveWorkers.filter((w: any) => w.zone === zoneId).length,
        alerts: za.length,
        resolvedRate: za.length ? Math.round((za.filter((a) => a.resolved).length / za.length) * 100) : 100,
      };
    });
  }, [effectiveWorkers, periodAlerts, effectiveSensors]);

  const recentAlerts = useMemo(
    () => [...periodAlerts]
      .sort((a, b) => (timestampToDate(b.timestamp ?? 0)?.getTime() ?? 0) - (timestampToDate(a.timestamp ?? 0)?.getTime() ?? 0))
      .slice(0, 20),
    [periodAlerts]
  );

  // ── AI Analysis ─────────────────────────────────────────────────────────────
  const requestAiAnalysis = useCallback(async () => {
    setAiLoading(true); setAiError(null); setAiAnalysis(null);
    try {
      const result = await fetchAiAnalysis(buildAnalysisPrompt({
        period, totalAlerts, resolvedAlerts, resolutionRate,
        alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
        premonitoringStats, overallGas, gasStats, workersCount: effectiveWorkers.length,
      }));
      setAiAnalysis(result);
    } catch (e: any) {
      setAiError(e?.message ?? 'AI analysis failed.');
    } finally {
      setAiLoading(false);
    }
  }, [period, totalAlerts, resolvedAlerts, resolutionRate, alertsByType, premonitoringStats, overallGas, gasStats, effectiveWorkers.length]);

  // ── Report params ───────────────────────────────────────────────────────────
  const reportParams: ReportParams = {
    period, managerName: manager?.name || 'Manager',
    workersCount: effectiveWorkers.length, totalAlerts, resolvedAlerts, resolutionRate,
    alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
    zoneRows, recentAlerts, premonitoringStats, gasStats, overallGas,
    aiAnalysis: aiAnalysis ?? undefined,
  };
  const fileName = `smc-livemonitor-${period}-report`;

  // ── Exports ─────────────────────────────────────────────────────────────────
  const exportPdf = async () => {
    const html = buildReportHtml(reportParams);
    if (Platform.OS === 'web') {
      await openPdfWeb(html);
    } else {
      const r = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(r.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF Report' });
      } else Alert.alert('PDF ready', r.uri);
    }
  };

  const exportCsv = async () => {
    const csv = buildReportCsv(reportParams);
    if (Platform.OS === 'web') {
      downloadCsvWeb(csv, `${fileName}.csv`);
    } else {
      const uri = `${FileSystem.documentDirectory}${fileName}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Share CSV Report' });
      } else Alert.alert('CSV ready', uri);
    }
  };

  const runExport = async (format: 'pdf' | 'csv' | 'both') => {
    setShowExportModal(false);
    setExporting(format);
    try {
      if (format === 'pdf'  || format === 'both') await exportPdf();
      if (format === 'csv'  || format === 'both') await exportCsv();
    } catch (e: any) {
      const msg = e?.message ?? 'Could not generate report.';
      Platform.OS === 'web' ? window.alert(`Export failed: ${msg}`) : Alert.alert('Export failed', msg);
    } finally {
      setExporting(false);
    }
  };

  const showExportMenu = () => {
    if (exporting) return;
    if (Platform.OS === 'web') {
      setShowExportModal(true);
    } else {
      Alert.alert('Export Report', `Choose a format for the ${period} report.`, [
        { text: 'PDF',    onPress: () => { void runExport('pdf');  } },
        { text: 'CSV',    onPress: () => { void runExport('csv');  } },
        { text: 'Both',   onPress: () => { void runExport('both'); } },
        { text: 'Cancel', style: 'cancel' },
      ], { cancelable: true });
    }
  };

  const selectedGasCfg = GAS_CONFIG.find((g) => g.key === selectedGas)!;

  // ──────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard?.reports ?? 'Reports'}</Text>
          <Text style={styles.headerSub}>Solapur Municipal Corporation</Text>
        </View>
        <TouchableOpacity style={[styles.exportBtn, !!exporting && styles.exportBtnDisabled]} onPress={showExportMenu} disabled={!!exporting}>
          {exporting ? <ActivityIndicator size="small" color={Colors.white} /> : <MaterialCommunityIcons name="download" size={18} color={Colors.white} />}
          <Text style={styles.exportBtnText}>{exporting ? 'Exporting\u2026' : 'Export'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 80 }}>

        {/* Period selector */}
        <View style={styles.periodRow}>
          {(['today', 'week', 'month'] as Period[]).map((v) => (
            <TouchableOpacity key={v} style={[styles.periodBtn, period === v && styles.periodBtnActive]} onPress={() => setPeriod(v)}>
              <Text style={[styles.periodText, period === v && styles.periodTextActive]}>{v.charAt(0).toUpperCase() + v.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Live data notice */}
        {Object.keys(effectiveSensors).length > 0 && (
          <View style={styles.liveNotice}>
            <MaterialCommunityIcons name="access-point" size={14} color={Colors.success} />
            <Text style={styles.liveNoticeText}>
              Live data from {Object.keys(effectiveSensors).length} sensor{Object.keys(effectiveSensors).length !== 1 ? 's' : ''} · Updates in real-time
            </Text>
          </View>
        )}

        {/* Summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 Summary</Text>
          <Text style={styles.cardSub}>Period: This {period} · Manager: {manager?.name ?? '—'}</Text>
          <View style={styles.summaryGrid}>
            {[
              { label: 'Total Workers',   value: String(effectiveWorkers.length),  icon: 'account-hard-hat', color: Colors.primary },
              { label: 'Total Alerts',    value: String(totalAlerts),      icon: 'alarm-light',      color: Colors.danger  },
              { label: 'Resolved',        value: String(resolvedAlerts),   icon: 'check-circle',     color: Colors.success },
              { label: 'Resolution Rate', value: `${resolutionRate}%`,     icon: 'percent',          color: Colors.accent  },
            ].map((s) => (
              <View key={s.label} style={styles.summaryItem}>
                <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Alert Trend */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📈 Alert Trend</Text>
          <Text style={styles.cardSub}>Alerts per {period === 'today' ? '4-hour slot' : period === 'week' ? 'day' : 'week'}</Text>
          <BarChart data={alertTrendData} color={Colors.primary} />
        </View>

        {/* Alert Breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🚨 Alert Breakdown</Text>
          {alertsByType.every(a => a.count === 0) && (
            <Text style={styles.cardSub}>No alerts recorded this {period}.</Text>
          )}
          {alertsByType.map((item) => (
            <View key={item.label} style={styles.alertRow}>
              <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
              <Text style={styles.alertRowLabel}>{item.label}</Text>
              <View style={styles.alertBarTrack}>
                <View style={[styles.alertBar, { width: `${totalAlerts > 0 ? (item.count / totalAlerts) * 100 : 0}%`, backgroundColor: item.color }]} />
              </View>
              <Text style={[styles.alertRowCount, { color: item.color }]}>{item.count}</Text>
            </View>
          ))}
        </View>

        {/* Pre-monitoring vitals */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🩺 Pre-monitoring Vitals</Text>
          <Text style={styles.cardSub}>{premonitoringStats.readingsCount} worker{premonitoringStats.readingsCount !== 1 ? 's' : ''} reporting vitals</Text>
          <View style={styles.summaryGrid}>
            {[
              { label: 'Avg Heart Rate', value: formatVal(premonitoringStats.avgHeartRate, ' bpm'), icon: 'heart-pulse',  color: Colors.danger  },
              { label: 'Avg SpO\u2082',  value: formatVal(premonitoringStats.avgSpo2, '%'),          icon: 'lungs',        color: Colors.info    },
              { label: 'Avg Temp',       value: formatVal(premonitoringStats.avgTemperature, '\u00b0C'), icon: 'thermometer', color: Colors.warning },
            ].map((s) => (
              <View key={s.label} style={[styles.summaryItem, { width: '30%' }]}>
                <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.summaryValue, { color: s.color, fontSize: 15 }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Overall Gas — Gauges */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>☁️ Overall Gas Concentration</Text>
          <Text style={styles.cardSub}>
            Averaged across all sewer lines · {periodGasReadings.length} sensor{periodGasReadings.length !== 1 ? 's' : ''}
            {'\n'}
            <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>
              CO, O₂, NH₃ — not available in current hardware
            </Text>
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
            {GAS_CONFIG.map((g) => {
              const val = (overallGas as any)[`avg${g.key.charAt(0).toUpperCase() + g.key.slice(1)}`] as number | null;
              return <GaugeChart key={g.key} value={val} max={g.dangerAt * 1.5} color={g.color} label={g.label} unit={g.unit} />;
            })}
          </ScrollView>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#16A34A' }]} /><Text style={styles.legendText}>Safe</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#F97316' }]} /><Text style={styles.legendText}>Caution</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} /><Text style={styles.legendText}>Danger</Text></View>
          </View>
        </View>

        {/* Gas Trend Line Chart */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📉 Gas Concentration Trend</Text>
          <Text style={styles.cardSub}>Select a gas to view its trend over the period</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
            {GAS_CONFIG.map((g) => {
              const active = selectedGas === g.key;
              return (
                <TouchableOpacity key={g.key} onPress={() => setSelectedGas(g.key)} style={[styles.gasTab, active && { backgroundColor: g.color, borderColor: g.color }]}>
                  <Text style={[styles.gasTabText, active && { color: '#fff' }]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <LineChart data={gasTrendData} color={selectedGasCfg.color} unit={selectedGasCfg.unit} safeMax={selectedGasCfg.safeMax} dangerAt={selectedGasCfg.dangerAt} />
          <View style={styles.thresholdRow}>
            <Text style={styles.thresholdText}><Text style={{ color: '#16A34A' }}>● </Text>Safe ≤ {selectedGasCfg.safeMax}{selectedGasCfg.unit}</Text>
            <Text style={styles.thresholdText}><Text style={{ color: '#DC2626' }}>● </Text>Danger ≥ {selectedGasCfg.dangerAt}{selectedGasCfg.unit}</Text>
          </View>
        </View>

        {/* Gas by Zone */}
        {gasStats.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🔬 Continuous Monitoring — By Sewer Line</Text>
            <Text style={styles.cardSub}>Avg concentrations per zone (ppm, O\u2082 in %)</Text>
            {gasStats.map((g, idx) => (
              <View key={`${g.zone}-${g.sewerLine}-${idx}`} style={styles.gasZoneRow}>
                <View style={styles.gasZoneHeader}>
                  <Text style={styles.gasZoneName}>{g.zone} Zone</Text>
                  <Text style={styles.gasZoneLine}>{g.sewerLine} · {g.readingsCount} reading{g.readingsCount !== 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.gasGrid}>
                  {GAS_CONFIG.map((cfg) => {
                    const val = (g as any)[`avg${cfg.key.charAt(0).toUpperCase() + cfg.key.slice(1)}`] as number | null;
                    const isDanger = val != null && (cfg.key === 'o2' ? val < cfg.dangerAt : val >= cfg.dangerAt);
                    return (
                      <View key={cfg.key} style={[styles.gasChip, isDanger && { backgroundColor: '#FEF2F2' }]}>
                        <Text style={[styles.gasChipLabel, { color: isDanger ? '#DC2626' : cfg.color }]}>{cfg.label}</Text>
                        <Text style={[styles.gasChipValue, isDanger && { color: '#DC2626' }]}>{val ?? '—'}</Text>
                        {isDanger && <MaterialCommunityIcons name="alert" size={10} color="#DC2626" />}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Zone Performance */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🗺️ Zone Performance</Text>
          {zoneRows.length === 0 && <Text style={styles.cardSub}>No zone data available.</Text>}
          {zoneRows.map((zone) => (
            <View key={zone.name} style={styles.zoneRow}>
              <View style={styles.zoneRowLeft}>
                <Text style={styles.zoneRowName}>{zone.name}</Text>
                <Text style={styles.zoneRowMeta}>{zone.workers} workers · {zone.alerts} alerts</Text>
              </View>
              <View style={[styles.rateChip, { backgroundColor: zone.resolvedRate === 100 ? Colors.successBg : zone.resolvedRate > 70 ? Colors.warningBg : Colors.dangerBg }]}>
                <Text style={[styles.rateText, { color: zone.resolvedRate === 100 ? Colors.success : zone.resolvedRate > 70 ? Colors.warning : Colors.danger }]}>{zone.resolvedRate}%</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Safety Compliance */}
        <View style={[styles.card, { backgroundColor: Colors.primary }]}>
          <View style={styles.complianceHeader}>
            <MaterialCommunityIcons name="shield-check" size={24} color={Colors.accent} />
            <Text style={[styles.cardTitle, { color: Colors.white }]}>Safety Compliance</Text>
          </View>
          <Text style={[styles.complianceScore, { color: Colors.accent }]}>{resolutionRate}%</Text>
          <Text style={[styles.cardSub, { color: '#B8C8D8' }]}>Overall alert resolution rate this {period}</Text>
          <View style={styles.complianceBar}>
            <View style={[styles.complianceFill, { width: `${resolutionRate}%` }]} />
          </View>
          <Text style={[styles.complianceNote, { color: '#8899AA' }]}>
            {resolutionRate >= 90 ? '✅ Excellent compliance' : resolutionRate >= 70 ? '⚠️ Needs improvement' : '❌ Critical attention required'}
          </Text>
        </View>

        {/* AI Analysis */}
        <View style={styles.card}>
          <View style={styles.aiHeader}>
            <MaterialCommunityIcons name="robot" size={22} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>🤖 AI Safety Analysis</Text>
              <Text style={styles.cardSub}>Powered by Claude · Analyzes live sensor data</Text>
            </View>
          </View>

          {!aiAnalysis && !aiLoading && !aiError && (
            <TouchableOpacity style={styles.aiBtn} onPress={requestAiAnalysis}>
              <MaterialCommunityIcons name="lightning-bolt" size={18} color={Colors.white} />
              <Text style={styles.aiBtnText}>Generate AI Analysis</Text>
            </TouchableOpacity>
          )}

          {aiLoading && (
            <View style={styles.aiLoading}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.aiLoadingText}>Analyzing sensor data\u2026</Text>
            </View>
          )}

          {aiError && (
            <View style={styles.aiError}>
              <MaterialCommunityIcons name="alert-circle" size={18} color={Colors.danger} />
              <Text style={styles.aiErrorText}>{aiError}</Text>
              <TouchableOpacity onPress={requestAiAnalysis} style={{ marginTop: 8 }}>
                <Text style={{ color: Colors.primary, fontSize: 13, fontFamily: 'Poppins_600SemiBold' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiAnalysis && (
            <View style={styles.aiResult}>
              <Text style={styles.aiResultText}>{aiAnalysis}</Text>
              <TouchableOpacity style={[styles.aiBtn, { marginTop: 12, backgroundColor: Colors.background }]} onPress={requestAiAnalysis}>
                <MaterialCommunityIcons name="refresh" size={16} color={Colors.primary} />
                <Text style={[styles.aiBtnText, { color: Colors.primary }]}>Refresh Analysis</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

      </ScrollView>

      {/* Web export modal */}
      <Modal visible={showExportModal} transparent animationType="fade" onRequestClose={() => setShowExportModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowExportModal(false)}>
          <Pressable style={styles.modalBox} onPress={() => {}}>
            <Text style={styles.modalTitle}>Export Report</Text>
            <Text style={styles.modalSub}>Choose a format for the {period} report</Text>
            {([
              { format: 'pdf',  icon: 'file-pdf-box',      color: Colors.danger,  label: 'PDF',  hint: 'Opens print / save dialog'   },
              { format: 'csv',  icon: 'file-delimited',    color: Colors.success, label: 'CSV',  hint: 'Downloads spreadsheet file'  },
              { format: 'both', icon: 'download-multiple', color: Colors.primary, label: 'Both', hint: 'PDF + CSV together'          },
            ] as const).map((item) => (
              <TouchableOpacity key={item.format} style={styles.modalBtn} onPress={() => { void runExport(item.format); }}>
                <MaterialCommunityIcons name={item.icon as any} size={22} color={item.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalBtnText}>{item.label}</Text>
                  <Text style={styles.modalBtnHint}>{item.hint}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowExportModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: Colors.background },
  header:            { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle:       { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub:         { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  exportBtn:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.md },
  exportBtnDisabled: { opacity: 0.65 },
  exportBtnText:     { color: Colors.white, fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  periodRow:         { flexDirection: 'row', backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: 4, ...Shadows.sm },
  periodBtn:         { flex: 1, paddingVertical: 8, borderRadius: BorderRadius.sm, alignItems: 'center' },
  periodBtnActive:   { backgroundColor: Colors.primary },
  periodText:        { fontSize: 13, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  periodTextActive:  { color: Colors.white },
  card:              { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, ...Shadows.sm },
  cardTitle:         { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  cardSub:           { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, marginBottom: Spacing.md },
  summaryGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  summaryItem:       { width: '47%', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  summaryValue:      { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  summaryLabel:      { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  alertRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  alertRowLabel:     { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary, width: 72 },
  alertBarTrack:     { flex: 1, height: 6, backgroundColor: Colors.background, borderRadius: 3, overflow: 'hidden' },
  alertBar:          { height: '100%', borderRadius: 3 },
  alertRowCount:     { fontSize: 14, fontFamily: 'Poppins_700Bold', width: 28, textAlign: 'right' },
  gasTab:            { paddingHorizontal: 14, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white },
  gasTabText:        { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary },
  thresholdRow:      { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  thresholdText:     { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  gasZoneRow:        { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 10 },
  gasZoneHeader:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  gasZoneName:       { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  gasZoneLine:       { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  gasGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gasChip:           { backgroundColor: Colors.background, borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', minWidth: 52 },
  gasChipLabel:      { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
  gasChipValue:      { fontSize: 12, fontFamily: 'Poppins_700Bold', color: Colors.textPrimary },
  legendRow:         { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 8 },
  legendItem:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:         { width: 8, height: 8, borderRadius: 4 },
  legendText:        { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  zoneRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  zoneRowLeft:       { flex: 1 },
  zoneRowName:       { fontSize: 14, fontFamily: 'Poppins_500Medium', color: Colors.textPrimary },
  zoneRowMeta:       { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  rateChip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full },
  rateText:          { fontSize: 13, fontFamily: 'Poppins_700Bold' },
  complianceHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  complianceScore:   { fontSize: 48, fontFamily: 'Poppins_700Bold' },
  complianceBar:     { height: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  complianceFill:    { height: '100%', backgroundColor: Colors.accent, borderRadius: 4 },
  complianceNote:    { fontSize: 13, fontFamily: 'Poppins_400Regular' },
  aiHeader:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  aiBtn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 12, paddingHorizontal: 20 },
  aiBtnText:         { color: Colors.white, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },
  aiLoading:         { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', paddingVertical: 16 },
  aiLoadingText:     { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  aiError:           { backgroundColor: '#FEF2F2', borderRadius: BorderRadius.md, padding: 12, alignItems: 'center', gap: 4 },
  aiErrorText:       { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.danger, textAlign: 'center' },
  aiResult:          { backgroundColor: '#F0F7FF', borderRadius: BorderRadius.md, padding: 14, borderLeftWidth: 3, borderLeftColor: Colors.primary },
  aiResultText:      { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary, lineHeight: 22 },
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: Spacing.md },
  modalBox:          { backgroundColor: Colors.white, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, ...Shadows.md },
  modalTitle:        { fontSize: 17, fontFamily: 'Poppins_700Bold', color: Colors.textPrimary, marginBottom: 4 },
  modalSub:          { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, marginBottom: 16 },
  modalBtn:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalBtnText:      { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  modalBtnHint:      { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  modalCancelBtn:    { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  modalCancelText:   { fontSize: 14, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  liveNotice:        { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.successBg ?? '#F0FDF4', borderRadius: BorderRadius.md, paddingHorizontal: 12, paddingVertical: 8 },
  liveNoticeText:    { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.success },
});