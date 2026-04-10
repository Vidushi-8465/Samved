// app/(dashboard)/reports.tsx
// SMC LiveMonitor — Reports Screen (complete rewrite)
// ─────────────────────────────────────────────────────

import React, { useState, useMemo, useEffect } from 'react';
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
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, {
  Rect,
  Line,
  Text as SvgText,
  Circle,
  Path,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import {
  listenToWorkers,
  listenToAlerts,
  listenToAllSensors,
  SOLAPUR_ZONES,
  SensorData,
  WorkerProfile,
  Alert as LiveAlert,
  getSensorStatus,
} from '@/services/sensorService';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Types ─────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month';

type ReportAlert = {
  workerName: string;
  zone: string;
  type: string;
  value: string;
  resolved: boolean;
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
  waterLevel?: number | null;
  timestamp: any;
};

type VitalReading = {
  workerId: string;
  workerName: string;
  zone: string;
  heartRate?: number | null;
  spo2?: number | null;
  temperature?: number | null;
  timestamp: any;
};

// Level 1–3 gas thresholds (safe / caution / danger)
type GasCfg = {
  key: string;
  label: string;
  unit: string;
  color: string;
  l1: number; // safe → caution threshold
  l2: number; // caution → danger threshold
  l3: number; // display max
};

const GAS_CONFIG: GasCfg[] = [
  { key: 'co',  label: 'CO',  unit: 'ppm', color: '#6B7280', l1: 25,   l2: 200,  l3: 400  },
  { key: 'ch4', label: 'CH₄', unit: 'ppm', color: '#F97316', l1: 1000, l2: 5000, l3: 8000 },
];

const VITAL_THRESHOLDS = {
  heartRate: { l1: 60, l2: 100, l3: 150 }, // normal 60-100 bpm
  spo2:      { l1: 95, l2: 90,  l3: 85  }, // normal ≥95%  (lower = worse)
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timestampToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts < 1_000_000_000_000 ? ts * 1000 : ts);
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
  if (ts == null) return true;
  const d = timestampToDate(ts);
  if (!d || isNaN(d.getTime())) return true;
  return d >= getPeriodStart(period);
}

function avg(vals: (number | null | undefined)[]): number | null {
  const v = vals.filter((x): x is number => x != null && !isNaN(x) && x > 0);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

function fmtVal(val: number | null | undefined, unit: string): string {
  return val == null ? 'N/A' : `${val}${unit}`;
}

function fmtCm(val: number | null | undefined): string {
  return val == null || isNaN(val as number) ? 'N/A' : `${(val as number).toFixed(1)} cm`;
}

/** Returns 'safe' | 'caution' | 'danger' for a gas value */
function gasLevel(key: string, val: number | null): 'safe' | 'caution' | 'danger' | 'na' {
  if (val == null) return 'na';
  const cfg = GAS_CONFIG.find(g => g.key === key);
  if (!cfg) return 'na';
  if (key === 'o2') {
    // O2: higher is safer
    if (val >= cfg.l1) return 'safe';
    if (val >= cfg.l2) return 'caution';
    return 'danger';
  }
  if (val <= cfg.l1) return 'safe';
  if (val <= cfg.l2) return 'caution';
  return 'danger';
}

const LEVEL_COLORS = {
  safe:    '#16A34A',
  caution: '#F59E0B',
  danger:  '#DC2626',
  na:      '#CBD5E1',
};

const LEVEL_BG = {
  safe:    '#F0FDF4',
  caution: '#FFFBEB',
  danger:  '#FEF2F2',
  na:      '#F8FAFC',
};

// ─── Trend helpers ─────────────────────────────────────────────────────────────

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
  alerts.forEach(a => {
    const d = timestampToDate(a.timestamp) ?? now;
    buckets[getBucketIndex(d, period)] += 1;
  });
  return labels.map((label, i) => ({ label, value: buckets[i] }));
}

function getGasTrend(readings: GasReading[], gasKey: string, period: Period) {
  const labels = getPeriodBuckets(period);
  const buckets: number[][] = labels.map(() => []);
  const now = new Date();
  readings.forEach(r => {
    const d = timestampToDate(r.timestamp) ?? now;
    const val = (r as any)[gasKey];
    if (val != null && val > 0) buckets[getBucketIndex(d, period)].push(val as number);
  });
  return labels.map((label, i) => ({
    label,
    value: buckets[i].length
      ? Math.round((buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length) * 10) / 10
      : null,
  }));
}

// ─── CSV / HTML helpers ────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const t = String(v ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── SVG: Animated Bar Chart ───────────────────────────────────────────────────

function BarChart({ data, color, height = 130 }: {
  data: { label: string; value: number }[];
  color: string;
  height?: number;
}) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 20, bottom: 30, left: 32, right: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(chartW / data.length - 8, 4);

  const gradId = `barGrad${color.replace('#', '')}`;

  return (
    <Svg width={W} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0.4" />
        </LinearGradient>
      </Defs>

      {/* Grid lines */}
      {[0, 0.5, 1].map(t => {
        const y = PAD.top + t * chartH;
        return (
          <React.Fragment key={t}>
            <Line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#F1F5F9" strokeWidth={1} />
            <SvgText x={PAD.left - 4} y={y + 3} fontSize={8} fill="#CBD5E1" textAnchor="end">
              {Math.round(max * (1 - t))}
            </SvgText>
          </React.Fragment>
        );
      })}

      {data.map((d, i) => {
        const x = PAD.left + (i * chartW) / data.length + (chartW / data.length - barW) / 2;
        const barH = Math.max((d.value / max) * chartH, d.value > 0 ? 4 : 0);
        const y = PAD.top + chartH - barH;
        return (
          <React.Fragment key={d.label}>
            <Rect x={x} y={y} width={barW} height={barH} rx={4} fill={`url(#${gradId})`} />
            {d.value > 0 && (
              <SvgText x={x + barW / 2} y={y - 5} fontSize={8} fill="#64748B" textAnchor="middle" fontWeight="600">
                {d.value}
              </SvgText>
            )}
            <SvgText x={x + barW / 2} y={PAD.top + chartH + 16} fontSize={8} fill="#94A3B8" textAnchor="middle">
              {d.label}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// ─── SVG: Colour-coded Line Chart (with threshold bands) ──────────────────────

function GasLineChart({ data, cfg, height = 150 }: {
  data: { label: string; value: number | null }[];
  cfg: GasCfg;
  height?: number;
}) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 28, bottom: 30, left: 38, right: 14 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  const validVals = data.map(d => d.value).filter((v): v is number => v != null);
  if (!validVals.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>No data this period</Text>
      </View>
    );
  }

  const rawMax = Math.max(...validVals, cfg.l2 * 1.2);
  const rawMin = Math.min(...validVals, 0);
  const range = rawMax - rawMin || 1;

  const toY = (v: number) => PAD.top + chartH - ((v - rawMin) / range) * chartH;
  const toX = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * chartW;

  const points = data
    .map((d, i) => (d.value != null ? { x: toX(i), y: toY(d.value), val: d.value } : null))
    .filter(Boolean) as { x: number; y: number; val: number }[];

  const l1Y = toY(Math.min(cfg.l1, rawMax));
  const l2Y = toY(Math.min(cfg.l2, rawMax));

  return (
    <Svg width={W} height={height}>
      <Defs>
        <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3B82F6" stopOpacity="0.15" />
          <Stop offset="1" stopColor="#3B82F6" stopOpacity="0.01" />
        </LinearGradient>
      </Defs>

      {/* Threshold bands */}
      {l1Y > PAD.top && l1Y < PAD.top + chartH && (
        <Rect x={PAD.left} y={l1Y} width={chartW} height={PAD.top + chartH - l1Y}
          fill="#F0FDF4" opacity={0.5} />
      )}
      {l2Y > PAD.top && l2Y < PAD.top + chartH && (
        <Rect x={PAD.left} y={l2Y} width={chartW}
          height={Math.max(0, l1Y - l2Y)} fill="#FFFBEB" opacity={0.5} />
      )}

      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = PAD.top + t * chartH;
        return (
          <React.Fragment key={t}>
            <Line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#F1F5F9" strokeWidth={1} />
            <SvgText x={PAD.left - 4} y={y + 3} fontSize={7} fill="#CBD5E1" textAnchor="end">
              {Math.round(rawMax - t * range)}
            </SvgText>
          </React.Fragment>
        );
      })}

      {/* Level lines */}
      {l1Y > PAD.top && l1Y < PAD.top + chartH && (
        <>
          <Line x1={PAD.left} y1={l1Y} x2={PAD.left + chartW} y2={l1Y}
            stroke="#16A34A" strokeWidth={1} strokeDasharray="5,3" />
          <SvgText x={PAD.left + chartW - 2} y={l1Y - 3} fontSize={7} fill="#16A34A" textAnchor="end">
            L1 safe
          </SvgText>
        </>
      )}
      {l2Y > PAD.top && l2Y < PAD.top + chartH && (
        <>
          <Line x1={PAD.left} y1={l2Y} x2={PAD.left + chartW} y2={l2Y}
            stroke="#F59E0B" strokeWidth={1} strokeDasharray="5,3" />
          <SvgText x={PAD.left + chartW - 2} y={l2Y - 3} fontSize={7} fill="#F59E0B" textAnchor="end">
            L2 caution
          </SvgText>
        </>
      )}

      {/* Segments coloured by level */}
      {points.map((p, i) => {
        if (i === 0) return null;
        const prev = points[i - 1];
        const lvl = gasLevel(cfg.key, p.val);
        return (
          <Line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
            stroke={LEVEL_COLORS[lvl]} strokeWidth={2.5} strokeLinecap="round" />
        );
      })}

      {/* Dots */}
      {points.map((p, i) => {
        const lvl = gasLevel(cfg.key, p.val);
        return (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={LEVEL_COLORS[lvl]}
            stroke="white" strokeWidth={1.5} />
        );
      })}

      {/* X labels */}
      {data.map((d, i) => (
        <SvgText key={d.label} x={toX(i)} y={PAD.top + chartH + 16}
          fontSize={8} fill="#94A3B8" textAnchor="middle">
          {d.label}
        </SvgText>
      ))}
    </Svg>
  );
}

// ─── SVG: Semi-circular Gauge with arrow ──────────────────────────────────────

function SemiGauge({ value, cfg, size = 120 }: {
  value: number | null;
  cfg: GasCfg;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size * 0.62;
  const R = size * 0.38;
  const strokeW = size * 0.09;

  // Arc helpers (from -180° to 0°, i.e. left to right semicircle)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcPt = (deg: number) => ({
    x: cx + R * Math.cos(toRad(deg)),
    y: cy + R * Math.sin(toRad(deg)),
  });

  const describeArc = (startDeg: number, endDeg: number) => {
    const s = arcPt(startDeg);
    const e = arcPt(endDeg);
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  // 3 colour segments: -180 → -120 (green), -120 → -60 (yellow), -60 → 0 (red)
  const START = -180;
  const MID1  = -120;
  const MID2  = -60;
  const END   = 0;

  // For O2 (inverted), map differently
  const isInverted = cfg.key === 'o2';

  // Map value to angle
  let pct = 0;
  if (value != null) {
    pct = Math.min(Math.max((value - 0) / (cfg.l3 - 0), 0), 1);
    if (isInverted) pct = 1 - pct;
  }
  const needleDeg = START + pct * 180;
  const needlePt = arcPt(needleDeg);

  const lvl = gasLevel(cfg.key, value);

  return (
    <View style={{ alignItems: 'center', width: size + 8 }}>
      <Svg width={size} height={size * 0.72}>
        {/* Background arc segments */}
        <Path d={describeArc(START, MID1)} stroke={isInverted ? '#DC2626' : '#16A34A'}
          strokeWidth={strokeW} fill="none" strokeLinecap="butt" opacity={0.25} />
        <Path d={describeArc(MID1, MID2)} stroke="#F59E0B"
          strokeWidth={strokeW} fill="none" strokeLinecap="butt" opacity={0.25} />
        <Path d={describeArc(MID2, END)} stroke={isInverted ? '#16A34A' : '#DC2626'}
          strokeWidth={strokeW} fill="none" strokeLinecap="butt" opacity={0.25} />

        {/* Filled portion */}
        {value != null && pct > 0 && (
          <Path d={describeArc(START, needleDeg)}
            stroke={LEVEL_COLORS[lvl]} strokeWidth={strokeW} fill="none" strokeLinecap="butt" />
        )}

        {/* Needle arrow */}
        {value != null && (
          <>
            <Line x1={cx} y1={cy} x2={needlePt.x} y2={needlePt.y}
              stroke={LEVEL_COLORS[lvl]} strokeWidth={2.5} strokeLinecap="round" />
            <Circle cx={cx} cy={cy} r={5} fill={LEVEL_COLORS[lvl]} />
            {/* Arrow head */}
            <Circle cx={needlePt.x} cy={needlePt.y} r={3.5} fill={LEVEL_COLORS[lvl]} />
          </>
        )}

        {/* Value text */}
        <SvgText x={cx} y={cy + 16} fontSize={13} fontWeight="bold"
          fill={value != null ? LEVEL_COLORS[lvl] : '#CBD5E1'} textAnchor="middle">
          {value != null ? `${value}` : '—'}
        </SvgText>
        <SvgText x={cx} y={cy + 27} fontSize={8} fill="#94A3B8" textAnchor="middle">
          {cfg.unit}
        </SvgText>
      </Svg>

      {/* Level badge */}
      <View style={[styles.gaugeBadge, { backgroundColor: LEVEL_BG[lvl] }]}>
        <View style={[styles.gaugeDot, { backgroundColor: LEVEL_COLORS[lvl] }]} />
        <Text style={[styles.gaugeBadgeText, { color: LEVEL_COLORS[lvl] }]}>
          {lvl === 'na' ? '—' : lvl.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.gaugeLabel}>{cfg.label}</Text>
    </View>
  );
}

// ─── Water Level indicator ─────────────────────────────────────────────────────

function WaterLevelBar({ value, maxCm = 200 }: { value: number | null; maxCm?: number }) {
  const pct = value != null ? Math.min(value / maxCm, 1) : 0;
  const color = value == null ? '#CBD5E1'
    : value < 50  ? LEVEL_COLORS.safe
    : value < 120 ? LEVEL_COLORS.caution
    : LEVEL_COLORS.danger;
  return (
    <View style={styles.waterBarWrap}>
      <View style={styles.waterBarTrack}>
        <View style={[styles.waterBarFill, { height: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.waterBarValue, { color }]}>{fmtCm(value)}</Text>
    </View>
  );
}

// ─── Pre-monitoring Level Card (L1/L2/L3) ─────────────────────────────────────

function GasLevelCard({ gasKey, readings }: {
  gasKey: string;
  readings: GasReading[];
}) {
  const cfg = GAS_CONFIG.find(g => g.key === gasKey)!;
  const vals = readings.map(r => (r as any)[gasKey] as number | null).filter((v): v is number => v != null && v > 0);
  const current = vals.length ? vals[vals.length - 1] : null;
  const avgVal = avg(vals);
  const maxVal = vals.length ? Math.max(...vals) : null;

  const l1Count = vals.filter(v => gasLevel(gasKey, v) === 'safe').length;
  const l2Count = vals.filter(v => gasLevel(gasKey, v) === 'caution').length;
  const l3Count = vals.filter(v => gasLevel(gasKey, v) === 'danger').length;
  const total = vals.length || 1;

  const currentLvl = gasLevel(gasKey, current);

  return (
    <View style={[styles.gasLevelCard, { borderLeftColor: LEVEL_COLORS[currentLvl] }]}>
      <View style={styles.gasLevelHeader}>
        <View style={[styles.gasLevelBadge, { backgroundColor: LEVEL_BG[currentLvl] }]}>
          <Text style={[styles.gasLevelBadgeText, { color: LEVEL_COLORS[currentLvl] }]}>
            {cfg.label}
          </Text>
        </View>
        <Text style={[styles.gasCurrentVal, { color: LEVEL_COLORS[currentLvl] }]}>
          {current != null ? `${current} ${cfg.unit}` : 'N/A'}
        </Text>
      </View>

      <View style={styles.gasLevelBars}>
        {/* L1 safe */}
        <View style={styles.gasLevelRow}>
          <Text style={styles.gasLevelLbl}>L1 Safe</Text>
          <View style={styles.gasLevelTrack}>
            <View style={[styles.gasLevelFill, {
              width: `${(l1Count / total) * 100}%`,
              backgroundColor: LEVEL_COLORS.safe,
            }]} />
          </View>
          <Text style={[styles.gasLevelCount, { color: LEVEL_COLORS.safe }]}>{l1Count}</Text>
        </View>
        {/* L2 caution */}
        <View style={styles.gasLevelRow}>
          <Text style={styles.gasLevelLbl}>L2 Caution</Text>
          <View style={styles.gasLevelTrack}>
            <View style={[styles.gasLevelFill, {
              width: `${(l2Count / total) * 100}%`,
              backgroundColor: LEVEL_COLORS.caution,
            }]} />
          </View>
          <Text style={[styles.gasLevelCount, { color: LEVEL_COLORS.caution }]}>{l2Count}</Text>
        </View>
        {/* L3 danger */}
        <View style={styles.gasLevelRow}>
          <Text style={styles.gasLevelLbl}>L3 Danger</Text>
          <View style={styles.gasLevelTrack}>
            <View style={[styles.gasLevelFill, {
              width: `${(l3Count / total) * 100}%`,
              backgroundColor: LEVEL_COLORS.danger,
            }]} />
          </View>
          <Text style={[styles.gasLevelCount, { color: LEVEL_COLORS.danger }]}>{l3Count}</Text>
        </View>
      </View>

      <View style={styles.gasStatRow}>
        <View style={styles.gasStat}>
          <Text style={styles.gasStatLbl}>Avg</Text>
          <Text style={styles.gasStatVal}>{avgVal != null ? `${avgVal}` : '—'}</Text>
        </View>
        <View style={styles.gasStat}>
          <Text style={styles.gasStatLbl}>Max</Text>
          <Text style={[styles.gasStatVal, maxVal != null && maxVal > cfg.l2 ? { color: LEVEL_COLORS.danger } : {}]}>
            {maxVal != null ? `${maxVal}` : '—'}
          </Text>
        </View>
        <View style={styles.gasStat}>
          <Text style={styles.gasStatLbl}>Unit</Text>
          <Text style={styles.gasStatVal}>{cfg.unit}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Live Worker Card ──────────────────────────────────────────────────────────

function LiveWorkerCard({ worker, sensor }: {
  worker: WorkerProfile;
  sensor?: SensorData | null;
}) {
  const status = sensor ? getSensorStatus(sensor) : null;
  const overall = status?.overall ?? 'offline';
  const isActive = !!sensor;

  const stateColor = overall === 'danger' ? Colors.danger
    : overall === 'warning' ? Colors.warning
    : overall === 'safe'    ? Colors.success
    : Colors.textMuted;

  const stateBg = overall === 'danger' ? Colors.dangerBg
    : overall === 'warning' ? Colors.warningBg
    : overall === 'safe'    ? Colors.successBg
    : Colors.background;

  const metrics = [
    { label: 'HR',    value: sensor?.heartRate ? `${sensor.heartRate} bpm` : '—', icon: 'heart-pulse',   lvl: sensor?.heartRate ? (sensor.heartRate < 60 || sensor.heartRate > 100 ? 'caution' : 'safe') : 'na' },
    { label: 'SpO₂', value: sensor?.spO2       ? `${sensor.spO2}%`         : '—', icon: 'lungs',         lvl: sensor?.spO2 ? (sensor.spO2 < 90 ? 'danger' : sensor.spO2 < 95 ? 'caution' : 'safe') : 'na' },
    { label: 'CH₄',  value: sensor?.ch4        ? `${sensor.ch4} ppm`       : '—', icon: 'fire',          lvl: gasLevel('ch4', sensor?.ch4 ?? null) },
    { label: 'CO',   value: (sensor as any)?.co ? `${(sensor as any).co} ppm` : '—', icon: 'cloud-outline', lvl: gasLevel('co', (sensor as any)?.co ?? null) },
    { label: 'Water',value: fmtCm(sensor?.waterLevel),                               icon: 'water',         lvl: sensor?.waterLevel != null ? (sensor.waterLevel > 120 ? 'danger' : sensor.waterLevel > 50 ? 'caution' : 'safe') : 'na' },
  ] as const;

  return (
    <View style={[styles.liveWorkerCard, { borderLeftColor: stateColor, borderLeftWidth: 3 }]}>
      <View style={styles.liveWorkerTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.liveWorkerName}>{worker.name}</Text>
          <Text style={styles.liveWorkerMeta}>{worker.employeeId} · {worker.zone}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: stateBg }]}>
          <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
          <Text style={[styles.statusPillText, { color: stateColor }]}>
            {isActive ? overall.toUpperCase() : 'OFFLINE'}
          </Text>
        </View>
      </View>

      <View style={styles.metricsGrid}>
        {metrics.map((m, i) => (
          <View key={i} style={[styles.metricCell, { backgroundColor: LEVEL_BG[m.lvl as keyof typeof LEVEL_BG] }]}>
            <MaterialCommunityIcons name={m.icon as any} size={14} color={LEVEL_COLORS[m.lvl as keyof typeof LEVEL_COLORS]} />
            <Text style={styles.metricCellLabel}>{m.label}</Text>
            <Text style={[styles.metricCellValue, { color: LEVEL_COLORS[m.lvl as keyof typeof LEVEL_COLORS] }]}>
              {m.value}
            </Text>
          </View>
        ))}
      </View>

      {sensor && (
        <Text style={styles.liveWorkerFooter}>
          📍 {sensor.manholeId ?? '—'} · {sensor.locationLabel ?? '—'}
          {'  '}RSSI: {sensor.rssi != null ? `${sensor.rssi} dBm` : '—'}
        </Text>
      )}
    </View>
  );
}

// ─── Report builders ───────────────────────────────────────────────────────────

interface ReportParams {
  period: Period;
  managerName: string;
  workersCount: number;
  totalAlerts: number;
  resolvedAlerts: number;
  resolutionRate: number;
  alertsByType: { label: string; count: number }[];
  zoneRows: { name: string; workers: number; alerts: number; resolvedRate: number }[];
  recentAlerts: ReportAlert[];
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
  overallGas: {
    avgCh4: number | null;
    avgH2s: number | null;
    avgCo: number | null;
    avgO2: number | null;
    avgNh3: number | null;
  };
}

function buildReportHtml(p: ReportParams): string {
  const now = new Date().toLocaleString('en-IN');
  const pl = p.period.charAt(0).toUpperCase() + p.period.slice(1);
  const g = p.overallGas;

  const summaryCards = [
    { label: 'Total Workers', value: p.workersCount },
    { label: 'Total Alerts', value: p.totalAlerts },
    { label: 'Resolved', value: p.resolvedAlerts },
    { label: 'Resolution Rate', value: `${p.resolutionRate}%` },
  ].map(c =>
    `<div class="card"><div class="cardLabel">${c.label}</div><div class="cardValue">${c.value}</div></div>`
  ).join('');

  const alertRows = p.recentAlerts.length
    ? p.recentAlerts.map(a =>
        `<tr>
          <td>${esc(timestampToDate(a.timestamp)?.toLocaleString('en-IN') ?? '--')}</td>
          <td>${esc(a.workerName)}</td><td>${esc(a.zone)}</td>
          <td>${esc(a.type)}</td><td>${esc(a.value)}</td>
          <td>${a.resolved ? '<span style="color:#16a34a">Resolved</span>' : '<span style="color:#dc2626">Open</span>'}</td>
        </tr>`
      ).join('')
    : '<tr><td colspan="6" style="text-align:center;color:#64748B">No alerts</td></tr>';

  const gasZoneRows = p.gasStats.length
    ? p.gasStats.map(z =>
        `<tr>
          <td>${esc(z.zone)}</td><td>${esc(z.sewerLine)}</td>
          <td>${z.avgCo ?? 'N/A'}</td><td>${z.avgCh4 ?? 'N/A'}</td>
          <td>${z.readingsCount}</td>
        </tr>`
      ).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#64748B">No gas data</td></tr>';

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:Arial,sans-serif;color:#1A202C;padding:24px;max-width:900px;margin:0 auto;}
h1{margin:0 0 6px;color:#1A3C6E;font-size:22px;}
h2{font-size:15px;margin:24px 0 10px;color:#1A3C6E;border-bottom:2px solid #E2E8F0;padding-bottom:4px;}
.meta{color:#64748B;font-size:12px;margin-bottom:20px;}
.grid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
.card{border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;min-width:130px;}
.cardLabel{font-size:10px;color:#64748B;text-transform:uppercase;}
.cardValue{font-size:20px;font-weight:700;color:#1A202C;margin-top:4px;}
ul{padding:0;list-style:none;}
ul li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F1F5F9;font-size:13px;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th,td{border-bottom:1px solid #E2E8F0;text-align:left;padding:8px 6px;}
th{color:#64748B;font-size:10px;text-transform:uppercase;background:#F8FAFC;}
.footer{margin-top:32px;font-size:11px;color:#94A3B8;text-align:center;}
</style></head><body>
<h1>SMC LiveMonitor Safety Report</h1>
<div class="meta">Period: <strong>${pl}</strong> &nbsp;|&nbsp; Manager: <strong>${esc(p.managerName)}</strong> &nbsp;|&nbsp; Generated: <strong>${now}</strong></div>
<h2>Summary</h2><div class="grid">${summaryCards}</div>
<h2>Alert Breakdown</h2><ul>${p.alertsByType.map(a => `<li><span>${esc(a.label)}</span><strong>${a.count}</strong></li>`).join('')}</ul>
<h2>Zone Performance</h2><ul>${p.zoneRows.map(z => `<li><span>${esc(z.name)}</span><span>${z.workers} workers · ${z.alerts} alerts · ${z.resolvedRate}% resolved</span></li>`).join('')}</ul>
<h2>Overall Gas Concentration</h2>
<div class="grid">
  <div class="card"><div class="cardLabel">CO</div><div class="cardValue">${fmtVal(g.avgCo, ' ppm')}</div></div>
  <div class="card"><div class="cardLabel">CH₄</div><div class="cardValue">${fmtVal(g.avgCh4, ' ppm')}</div></div>
</div>
<h2>Gas by Zone / Sewer Line</h2>
<table><thead><tr><th>Zone</th><th>Sewer Line</th><th>CO (ppm)</th><th>CH₄ (ppm)</th><th>Readings</th></tr></thead><tbody>${gasZoneRows}</tbody></table>
<div class="footer">SMC LiveMonitor &copy; ${new Date().getFullYear()} — Solapur Municipal Corporation</div>
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
  p.alertsByType.forEach(a => lines.push(`${csvCell(a.label)},${a.count}`));
  lines.push('');
  lines.push('ZONE PERFORMANCE');
  lines.push('Zone,Workers,Alerts,Resolution Rate');
  p.zoneRows.forEach(z => lines.push(`${csvCell(z.name)},${z.workers},${z.alerts},${z.resolvedRate}%`));
  lines.push('');
  lines.push('OVERALL GAS');
  lines.push(`CO (ppm),${p.overallGas.avgCo ?? 'N/A'}`);
  lines.push(`CH4 (ppm),${p.overallGas.avgCh4 ?? 'N/A'}`);
  lines.push('');
  lines.push('GAS BY ZONE');
  lines.push('Zone,Sewer Line,CO (ppm),CH4 (ppm),Readings');
  p.gasStats.forEach(z =>
    lines.push([csvCell(z.zone), csvCell(z.sewerLine),
      z.avgCo ?? 'N/A', z.avgCh4 ?? 'N/A', z.readingsCount].join(','))
  );
  lines.push('');
  lines.push('ALERT LOGS');
  lines.push('Time,Worker,Zone,Type,Value,Status');
  p.recentAlerts.forEach(a =>
    lines.push([
      csvCell(timestampToDate(a.timestamp)?.toLocaleString('en-IN') ?? '--'),
      csvCell(a.workerName), csvCell(a.zone), csvCell(a.type), csvCell(a.value),
      a.resolved ? 'Resolved' : 'Open',
    ].join(','))
  );
  return lines.join('\n');
}

// ─── Web export helpers ────────────────────────────────────────────────────────

function downloadCsvWeb(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function openPdfWeb(html: string) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup blocked — please allow popups for this site.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 800);
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

const ALERT_TYPES = [
  { label: 'SOS',        color: Colors.danger,  icon: 'alarm-light',   match: (t: string) => t === 'SOS' },
  { label: 'Gas',        color: '#F59E0B',       icon: 'gas-cylinder',  match: (t: string) => ['GAS', 'GAS_CRITICAL', 'CH4', 'H2S', 'CO', 'O2', 'NH3'].some(k => t.includes(k)) },
  { label: 'SpO₂',       color: Colors.accent,   icon: 'lungs',         match: (t: string) => t.startsWith('SPO2') },
  { label: 'Inactivity', color: Colors.info,     icon: 'timer-off',     match: (t: string) => t === 'INACTIVITY' },
  { label: 'Heart Rate', color: '#9B59B6',        icon: 'heart-broken',  match: (t: string) => t === 'HEARTRATE' },
];

export default function ReportsScreen() {
  const { language, workers, alerts, manager, sensors } = useStore();
  const T = getText(language);

  const [period, setPeriod] = useState<Period>('week');
  const [exporting, setExporting] = useState<false | 'pdf' | 'csv' | 'both'>(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedGas, setSelectedGas] = useState<string>('ch4');
  const [activeTab, setActiveTab] = useState<'overview' | 'workers' | 'gas' | 'compliance'>('overview');

  // Live state
  const [liveWorkers, setLiveWorkers] = useState<WorkerProfile[]>([]);
  const [liveSensors, setLiveSensors] = useState<Record<string, SensorData>>({});
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);

  // Subscribe to live data — automatically reflects new workers
  useEffect(() => {
    if (!manager) return;
    let sensorUnsub: (() => void) | null = null;

    const unsubWorkers = listenToWorkers(manager.uid, (nextWorkers) => {
      setLiveWorkers(nextWorkers);
      if (sensorUnsub) { sensorUnsub(); sensorUnsub = null; }
      if (nextWorkers.length > 0) {
        sensorUnsub = listenToAllSensors(nextWorkers.map(w => w.id), setLiveSensors);
      } else {
        setLiveSensors({});
      }
    });

    const zones = manager.zones.length > 0 ? manager.zones : SOLAPUR_ZONES.map(z => z.id);
    const unsubAlerts = listenToAlerts(zones, setLiveAlerts);

    return () => { sensorUnsub?.(); unsubWorkers(); unsubAlerts(); };
  }, [manager]);

  const effectiveWorkers = liveWorkers.length > 0 ? liveWorkers : workers;
  const effectiveSensors = Object.keys(liveSensors).length > 0 ? liveSensors : sensors;
  const effectiveAlerts  = liveAlerts.length > 0 ? liveAlerts : alerts;

  // Gas readings derived from sensors
  const gasReadings = useMemo((): GasReading[] =>
    Object.entries(effectiveSensors).map(([, s]) => ({
      zone:       s.zone ?? s.locationLabel ?? 'Unknown',
      sewerLine:  s.manholeId ?? s.locationLabel ?? 'Unknown',
      ch4:        s.ch4        && s.ch4 > 0        ? s.ch4        : null,
      h2s:        s.h2s        && s.h2s > 0        ? s.h2s        : null,
      co:         (s as any).co  && (s as any).co > 0   ? (s as any).co  : null,
      o2:         (s as any).o2  && (s as any).o2 > 0   ? (s as any).o2  : null,
      nh3:        (s as any).nh3 && (s as any).nh3 > 0  ? (s as any).nh3 : null,
      waterLevel: s.waterLevel,
      timestamp:  s.lastUpdated && s.lastUpdated > 0 ? s.lastUpdated : Date.now(),
    })),
  [effectiveSensors]);

  // Vital readings
  const vitalReadings = useMemo((): VitalReading[] =>
    Object.entries(effectiveSensors).map(([workerId, s]) => ({
      workerId,
      workerName: effectiveWorkers.find((w: any) => w.id === workerId)?.name ?? workerId,
      zone:       s.zone ?? s.locationLabel ?? 'Unknown',
      heartRate:  s.heartRate && s.heartRate > 0 ? s.heartRate : null,
      spo2:       s.spO2      && s.spO2 > 0      ? s.spO2      : null,
      temperature: null,
      timestamp:  s.lastUpdated && s.lastUpdated > 0 ? s.lastUpdated : Date.now(),
    })),
  [effectiveSensors, effectiveWorkers]);

  // Period-filtered data
  const periodAlerts = useMemo(() =>
    (effectiveAlerts as ReportAlert[]).filter(a => isInPeriod(a.timestamp ?? Date.now(), period)),
  [effectiveAlerts, period]);

  const periodGasReadings = useMemo(() =>
    gasReadings.filter(r => isInPeriod(r.timestamp, period)),
  [gasReadings, period]);

  // Summary stats
  const totalAlerts    = periodAlerts.length;
  const resolvedAlerts = periodAlerts.filter(a => a.resolved).length;
  const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 100;

  const alertsByType = useMemo(() =>
    ALERT_TYPES.map(type => ({
      ...type,
      count: periodAlerts.filter(a => type.match(a.type)).length,
    })),
  [periodAlerts]);

  const overallGas = useMemo(() => ({
    avgCo:  avg(periodGasReadings.map(r => r.co  ?? null)),
    avgCh4: avg(periodGasReadings.map(r => r.ch4 ?? null)),
    // kept in type for PDF builder compatibility
    avgH2s: null as number | null,
    avgO2:  null as number | null,
    avgNh3: null as number | null,
  }), [periodGasReadings]);

  const gasStats = useMemo(() => {
    const map = new Map<string, GasReading[]>();
    periodGasReadings.forEach(r => {
      const key = `${r.zone}||${r.sewerLine ?? 'Unknown'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).map(([key, recs]) => {
      const [zone, sewerLine] = key.split('||');
      return {
        zone, sewerLine,
        avgCo:   avg(recs.map(r => r.co  ?? null)),
        avgCh4:  avg(recs.map(r => r.ch4 ?? null)),
        avgH2s:  null as number | null,
        avgO2:   null as number | null,
        avgNh3:  null as number | null,
        readingsCount: recs.length,
      };
    });
  }, [periodGasReadings]);

  const gasTrendData = useMemo(() =>
    getGasTrend(periodGasReadings, selectedGas, period),
  [periodGasReadings, selectedGas, period]);

  const alertTrendData = useMemo(() =>
    getAlertTrend(periodAlerts, period),
  [periodAlerts, period]);

  const zoneRows = useMemo(() => {
    const zones = [...new Set([
      ...effectiveWorkers.map((w: any) => w.zone),
      ...periodAlerts.map(a => a.zone),
      ...Object.values(effectiveSensors).map(s => s.zone ?? s.locationLabel),
    ].filter(Boolean))];
    return zones.map((zoneId: string) => {
      const za = periodAlerts.filter(a => a.zone === zoneId);
      return {
        name: `${zoneId.charAt(0).toUpperCase() + zoneId.slice(1)} Zone`,
        workers: effectiveWorkers.filter((w: any) => w.zone === zoneId).length,
        alerts: za.length,
        resolvedRate: za.length ? Math.round((za.filter(a => a.resolved).length / za.length) * 100) : 100,
      };
    });
  }, [effectiveWorkers, periodAlerts, effectiveSensors]);

  const recentAlerts = useMemo(() =>
    [...periodAlerts]
      .sort((a, b) => (timestampToDate(b.timestamp ?? 0)?.getTime() ?? 0) - (timestampToDate(a.timestamp ?? 0)?.getTime() ?? 0))
      .slice(0, 25),
  [periodAlerts]);

  const liveWorkerRows = useMemo(() =>
    effectiveWorkers.map(worker => ({ worker, sensor: effectiveSensors[(worker as any).id] ?? null })),
  [effectiveWorkers, effectiveSensors]);

  const reportParams: ReportParams = {
    period, managerName: manager?.name || 'Manager',
    workersCount: effectiveWorkers.length,
    totalAlerts, resolvedAlerts, resolutionRate,
    alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
    zoneRows, recentAlerts, gasStats, overallGas,
  };

  const fileName = `smc-livemonitor-${period}-report`;

  // Export
  const exportPdf = async () => {
    const html = buildReportHtml(reportParams);
    if (Platform.OS === 'web') {
      await openPdfWeb(html);
    } else {
      const r = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(r.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF Report' });
      } else {
        Alert.alert('PDF ready', r.uri);
      }
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
      } else {
        Alert.alert('CSV ready', uri);
      }
    }
  };

  const runExport = async (format: 'pdf' | 'csv' | 'both') => {
    setShowExportModal(false);
    setExporting(format);
    try {
      if (format === 'pdf' || format === 'both') await exportPdf();
      if (format === 'csv' || format === 'both') await exportCsv();
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
        { text: 'PDF',    onPress: () => void runExport('pdf')  },
        { text: 'CSV',    onPress: () => void runExport('csv')  },
        { text: 'Both',   onPress: () => void runExport('both') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const selectedGasCfg = GAS_CONFIG.find(g => g.key === selectedGas) ?? GAS_CONFIG[0];
  const sensorCount = Object.keys(effectiveSensors).length;

  const TABS = [
    { key: 'overview',    label: 'Overview',   icon: 'view-dashboard-outline' },
    { key: 'workers',     label: 'Workers',    icon: 'account-hard-hat-outline' },
    { key: 'gas',         label: 'Gas & Env',  icon: 'gas-cylinder' },
    { key: 'compliance',  label: 'Compliance', icon: 'shield-check-outline' },
  ] as const;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ── SAMVED Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <MaterialCommunityIcons name="shield-account" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>SAMVED</Text>
            <Text style={styles.headerSub}>Smart Adaptive Monitoring &amp; Vital Emergency Detection</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.exportBtn, !!exporting && { opacity: 0.7 }]}
            onPress={showExportMenu}
            disabled={!!exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#fff" />
              : <MaterialCommunityIcons name="download" size={15} color="#fff" />
            }
            <Text style={styles.exportBtnText}>{exporting ? '…' : 'Export'}</Text>
          </TouchableOpacity>
          <View style={styles.liveBadge}>
            <View style={styles.liveBadgeDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
          {sensorCount > 0 && (
            <View style={styles.sensorCountBadge}>
              <Text style={styles.sensorCountText}>#{sensorCount}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Period Selector ── */}
      <View style={styles.periodRow}>
        {(['today', 'week', 'month'] as Period[]).map(v => (
          <TouchableOpacity
            key={v}
            style={[styles.periodBtn, period === v && styles.periodBtnActive]}
            onPress={() => setPeriod(v)}
          >
            <Text style={[styles.periodText, period === v && styles.periodTextActive]}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tab Bar ── */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={16}
              color={activeTab === tab.key ? Colors.primary : '#94A3B8'}
            />
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Summary Cards */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Summary</Text>
              <Text style={styles.sectionSub}>This {period} · {manager?.name ?? '—'}</Text>
              <View style={styles.summaryRow}>
                {[
                  { label: 'Workers',     value: String(effectiveWorkers.length), icon: 'account-hard-hat', color: Colors.primary },
                  { label: 'Alerts',      value: String(totalAlerts),             icon: 'alarm-light',      color: Colors.danger  },
                  { label: 'Resolved',    value: String(resolvedAlerts),           icon: 'check-circle',     color: Colors.success },
                  { label: 'Rate',        value: `${resolutionRate}%`,             icon: 'percent',          color: Colors.accent  },
                ].map(s => (
                  <View key={s.label} style={styles.summaryCard}>
                    <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
                    <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.summaryLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Alert Trend */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📈 Alert Trend</Text>
              <Text style={styles.sectionSub}>
                Alerts per {period === 'today' ? '4-hour block' : period === 'week' ? 'day' : 'week'}
              </Text>
              <BarChart data={alertTrendData} color={Colors.primary} />
            </View>

            {/* Alert Breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🚨 Alert Breakdown</Text>
              {alertsByType.every(a => a.count === 0)
                ? <Text style={styles.emptyText}>No alerts recorded this {period}.</Text>
                : alertsByType.map(item => (
                  <View key={item.label} style={styles.alertRow}>
                    <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
                    <Text style={styles.alertRowLabel}>{item.label}</Text>
                    <View style={styles.alertBarTrack}>
                      <View style={[styles.alertBarFill, {
                        width: `${totalAlerts > 0 ? (item.count / totalAlerts) * 100 : 0}%`,
                        backgroundColor: item.color,
                      }]} />
                    </View>
                    <Text style={[styles.alertRowCount, { color: item.color }]}>{item.count}</Text>
                  </View>
                ))
              }
            </View>

            {/* Zone Performance */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🗺️ Zone Performance</Text>
              {zoneRows.length === 0
                ? <Text style={styles.emptyText}>No zone data available.</Text>
                : zoneRows.map(zone => (
                  <View key={zone.name} style={styles.zoneRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.zoneRowName}>{zone.name}</Text>
                      <Text style={styles.zoneRowMeta}>{zone.workers} workers · {zone.alerts} alerts</Text>
                    </View>
                    <View style={[styles.rateChip, {
                      backgroundColor: zone.resolvedRate === 100 ? Colors.successBg
                        : zone.resolvedRate > 70 ? Colors.warningBg : Colors.dangerBg,
                    }]}>
                      <Text style={[styles.rateText, {
                        color: zone.resolvedRate === 100 ? Colors.success
                          : zone.resolvedRate > 70 ? Colors.warning : Colors.danger,
                      }]}>
                        {zone.resolvedRate}%
                      </Text>
                    </View>
                  </View>
                ))
              }
            </View>

          </>
        )}

        {/* ═══════════════ WORKERS TAB ═══════════════ */}
        {activeTab === 'workers' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>👷 Live Worker Values</Text>
              <Text style={styles.sectionSub}>
                {effectiveWorkers.length} worker{effectiveWorkers.length !== 1 ? 's' : ''} · Real-time sensor snapshot
              </Text>
              {liveWorkerRows.length === 0
                ? <Text style={styles.emptyText}>No workers assigned. Add workers to see live data here.</Text>
                : liveWorkerRows.map(({ worker, sensor }) => (
                  <LiveWorkerCard key={(worker as any).id} worker={worker} sensor={sensor} />
                ))
              }
            </View>

            {/* Pre-monitoring vitals summary */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🩺 Vitals Overview</Text>
              <Text style={styles.sectionSub}>Averaged from active workers</Text>
              <View style={styles.summaryRow}>
                {[
                  {
                    label: 'Avg Heart Rate',
                    value: fmtVal(avg(Object.values(effectiveSensors).map(s => s.heartRate && s.heartRate > 0 ? s.heartRate : null)), ' bpm'),
                    icon: 'heart-pulse', color: Colors.danger,
                  },
                  {
                    label: 'Avg SpO₂',
                    value: fmtVal(avg(Object.values(effectiveSensors).map(s => s.spO2 && s.spO2 > 0 ? s.spO2 : null)), '%'),
                    icon: 'lungs', color: Colors.info,
                  },
                ].map(s => (
                  <View key={s.label} style={[styles.summaryCard, { width: '47%' }]}>
                    <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
                    <Text style={[styles.summaryValue, { color: s.color, fontSize: 15 }]}>{s.value}</Text>
                    <Text style={styles.summaryLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {/* ═══════════════ GAS & ENV TAB ═══════════════ */}
        {activeTab === 'gas' && (
          <>
            {/* Overall Gauges */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>☁️ Overall Gas Concentration</Text>
              <Text style={styles.sectionSub}>
                {periodGasReadings.length} sensor reading{periodGasReadings.length !== 1 ? 's' : ''} · Colour coded by level
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.gaugeRow}>
                {GAS_CONFIG.map(g => {
                  const valKey = `avg${g.key.charAt(0).toUpperCase() + g.key.slice(1)}` as keyof typeof overallGas;
                  const val = overallGas[valKey] as number | null;
                  return <SemiGauge key={g.key} value={val} cfg={g} size={110} />;
                })}
              </ScrollView>

              {/* Legend */}
              <View style={styles.gaugeLegendRow}>
                {(['safe', 'caution', 'danger'] as const).map(lvl => (
                  <View key={lvl} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: LEVEL_COLORS[lvl] }]} />
                    <Text style={styles.legendText}>{lvl.charAt(0).toUpperCase() + lvl.slice(1)}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Pre-monitoring L1/L2/L3 cards */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔬 Pre-monitoring Gas Levels</Text>
              <Text style={styles.sectionSub}>L1 = Safe · L2 = Caution · L3 = Danger</Text>
              {GAS_CONFIG.map(g => (
                <GasLevelCard key={g.key} gasKey={g.key} readings={periodGasReadings} />
              ))}

              {/* Water level */}
              <View style={styles.waterSection}>
                <Text style={styles.sectionTitle}>💧 Water Level</Text>
                <View style={styles.waterRow}>
                  {Object.entries(effectiveSensors).map(([wid, s]) => {
                    const workerName = effectiveWorkers.find((w: any) => w.id === wid)?.name ?? wid;
                    return (
                      <View key={wid} style={styles.waterWorkerCell}>
                        <WaterLevelBar value={s.waterLevel ?? null} />
                        <Text style={styles.waterWorkerName} numberOfLines={1}>{workerName}</Text>
                      </View>
                    );
                  })}
                  {Object.keys(effectiveSensors).length === 0 && (
                    <Text style={styles.emptyText}>No water level data available.</Text>
                  )}
                </View>
              </View>
            </View>

            {/* Gas Trend */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📉 Gas Concentration Trend</Text>
              <Text style={styles.sectionSub}>Select gas · Colour-coded by threshold level</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.gasTabRow}>
                {GAS_CONFIG.map(g => {
                  const active = selectedGas === g.key;
                  return (
                    <TouchableOpacity
                      key={g.key}
                      onPress={() => setSelectedGas(g.key)}
                      style={[styles.gasTab, active && { backgroundColor: g.color, borderColor: g.color }]}
                    >
                      <Text style={[styles.gasTabText, active && { color: '#fff' }]}>{g.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <GasLineChart data={gasTrendData} cfg={selectedGasCfg} />

              {/* Threshold legend */}
              <View style={styles.thresholdLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: LEVEL_COLORS.safe }]} />
                  <Text style={styles.legendText}>L1 Safe ≤{selectedGasCfg.l1}{selectedGasCfg.unit}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: LEVEL_COLORS.caution }]} />
                  <Text style={styles.legendText}>L2 Caution ≤{selectedGasCfg.l2}{selectedGasCfg.unit}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: LEVEL_COLORS.danger }]} />
                  <Text style={styles.legendText}>L3 Danger >{selectedGasCfg.l2}{selectedGasCfg.unit}</Text>
                </View>
              </View>
            </View>

            {/* Gas by Zone */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📍 Gas by Zone / Sewer Line</Text>
              {gasStats.length === 0
                ? <Text style={styles.emptyText}>No gas readings for this period.</Text>
                : gasStats.map((z, i) => (
                  <View key={i} style={styles.gasZoneRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gasZoneName}>{z.zone}</Text>
                      <Text style={styles.gasZoneMeta}>{z.sewerLine} · {z.readingsCount} readings</Text>
                    </View>
                    <View style={styles.gasZonePills}>
                      {[
                        { key: 'co',  val: z.avgCo  },
                        { key: 'ch4', val: z.avgCh4 },
                      ].map(({ key, val }) => {
                        const lvl = gasLevel(key, val);
                        return val != null ? (
                          <View key={key} style={[styles.gasMiniPill, { backgroundColor: LEVEL_BG[lvl] }]}>
                            <Text style={[styles.gasMiniPillText, { color: LEVEL_COLORS[lvl] }]}>
                              {key.toUpperCase()} {val}
                            </Text>
                          </View>
                        ) : null;
                      })}
                    </View>
                  </View>
                ))
              }
            </View>
          </>
        )}

        {/* ═══════════════ COMPLIANCE TAB ═══════════════ */}
        {activeTab === 'compliance' && (
          <>
            {/* Main compliance score */}
            <View style={[styles.section, styles.complianceHero]}>
              <MaterialCommunityIcons name="shield-check" size={32} color={Colors.accent} />
              <Text style={styles.complianceTitle}>Safety Compliance</Text>
              <Text style={[styles.complianceScore, {
                color: resolutionRate >= 90 ? Colors.success
                  : resolutionRate >= 70 ? Colors.warning
                  : Colors.danger,
              }]}>
                {resolutionRate}%
              </Text>
              <Text style={styles.complianceSub}>Alert resolution rate this {period}</Text>

              <View style={styles.complianceBarTrack}>
                <View style={[styles.complianceBarFill, {
                  width: `${resolutionRate}%`,
                  backgroundColor: resolutionRate >= 90 ? Colors.success
                    : resolutionRate >= 70 ? Colors.warning
                    : Colors.danger,
                }]} />
              </View>

              <Text style={styles.complianceNote}>
                {resolutionRate >= 90 ? '✅ Excellent compliance — keep it up!'
                  : resolutionRate >= 70 ? '⚠️ Needs improvement — address open alerts'
                  : '❌ Critical — immediate attention required'}
              </Text>
            </View>

            {/* Gas compliance per type */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🧪 Gas Safety Compliance</Text>
              <Text style={styles.sectionSub}>% of readings within safe threshold (L1)</Text>
              {GAS_CONFIG.map(g => {
                const vals = periodGasReadings.map(r => (r as any)[g.key] as number | null).filter((v): v is number => v != null && v > 0);
                const safeCount = vals.filter(v => gasLevel(g.key, v) === 'safe').length;
                const pct = vals.length ? Math.round((safeCount / vals.length) * 100) : 100;
                const color = pct >= 90 ? Colors.success : pct >= 70 ? Colors.warning : Colors.danger;
                return (
                  <View key={g.key} style={styles.complianceGasRow}>
                    <Text style={styles.complianceGasLabel}>{g.label}</Text>
                    <View style={styles.complianceGasBarTrack}>
                      <View style={[styles.complianceGasBarFill, {
                        width: `${pct}%`,
                        backgroundColor: color,
                      }]} />
                    </View>
                    <Text style={[styles.complianceGasPct, { color }]}>{vals.length ? `${pct}%` : 'N/A'}</Text>
                  </View>
                );
              })}
            </View>

            {/* Zone compliance */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🗺️ Zone Compliance</Text>
              {zoneRows.length === 0
                ? <Text style={styles.emptyText}>No zone data available.</Text>
                : zoneRows.map(zone => {
                  const color = zone.resolvedRate === 100 ? Colors.success
                    : zone.resolvedRate > 70 ? Colors.warning : Colors.danger;
                  return (
                    <View key={zone.name} style={styles.complianceZoneRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.complianceZoneName}>{zone.name}</Text>
                        <Text style={styles.complianceZoneMeta}>{zone.workers} workers · {zone.alerts} alerts</Text>
                      </View>
                      <View style={styles.complianceZoneRight}>
                        <Text style={[styles.complianceZonePct, { color }]}>{zone.resolvedRate}%</Text>
                        <Text style={[styles.complianceZoneStatus, { color }]}>
                          {zone.resolvedRate === 100 ? 'Compliant' : zone.resolvedRate > 70 ? 'Partial' : 'Critical'}
                        </Text>
                      </View>
                    </View>
                  );
                })
              }
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Export Modal (web) ── */}
      <Modal visible={showExportModal} transparent animationType="fade" onRequestClose={() => setShowExportModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowExportModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Export Report</Text>
            <Text style={styles.modalSub}>Select format for the {period} report.</Text>
            {[
              { label: 'Export as PDF',  icon: 'file-pdf-box',     fmt: 'pdf'  as const },
              { label: 'Export as CSV',  icon: 'file-delimited',   fmt: 'csv'  as const },
              { label: 'Export Both',    icon: 'download-multiple', fmt: 'both' as const },
            ].map(o => (
              <TouchableOpacity key={o.fmt} style={styles.modalBtn} onPress={() => void runExport(o.fmt)}>
                <MaterialCommunityIcons name={o.icon as any} size={20} color={Colors.primary} />
                <Text style={styles.modalBtnText}>{o.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.modalBtn, { justifyContent: 'center', marginTop: 4 }]} onPress={() => setShowExportModal(false)}>
              <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F1F5F9' },

  // SAMVED Header
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#162A47',
  },
  headerLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1,
  },
  headerIconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#E8600A',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },
  headerSub:   { fontSize: 10, color: '#7B9FC7', marginTop: 1 },
  headerRight: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: '#22C55E',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  liveBadgeDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E',
  },
  liveBadgeText: { fontSize: 11, color: '#22C55E', fontWeight: '800', letterSpacing: 0.5 },
  sensorCountBadge: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  sensorCountText: { fontSize: 11, color: '#7B9FC7', fontWeight: '700' },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: '#2D5080',
  },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Period
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  periodBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  periodBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodText:      { fontSize: 13, color: '#64748B', fontWeight: '600' },
  periodTextActive:{ color: '#fff' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: Colors.primary },
  tabLabel:      { fontSize: 11, color: '#94A3B8', fontWeight: '600' },
  tabLabelActive:{ color: Colors.primary },

  // Scroll
  scrollContent: { padding: Spacing.md, gap: Spacing.md },

  // Section
  section: {
    backgroundColor: '#fff',
    borderRadius: BorderRadius.xl,
    padding: 16,
    ...Shadows.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  sectionSub:   { fontSize: 12, color: '#64748B', marginBottom: 12 },
  emptyText:    { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 12 },

  // Summary
  summaryRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4,
  },
  summaryCard: {
    flex: 1, minWidth: '22%',
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.lg,
    padding: 12, alignItems: 'center',
  },
  summaryValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  summaryLabel: { fontSize: 10, color: '#64748B', marginTop: 3, textAlign: 'center' },

  // Alert breakdown
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  alertRowLabel:  { width: 80, fontSize: 12, fontWeight: '600', color: '#334155' },
  alertBarTrack:  { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  alertBarFill:   { height: '100%', borderRadius: 4 },
  alertRowCount:  { width: 28, textAlign: 'right', fontWeight: '700', fontSize: 13 },

  // Zone
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  zoneRowName: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  zoneRowMeta: { fontSize: 11, color: '#64748B', marginTop: 1 },
  rateChip:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  rateText:    { fontSize: 12, fontWeight: '800' },

  // Live worker card
  liveWorkerCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.lg,
    padding: 14, marginBottom: 10,
    borderLeftWidth: 3,
  },
  liveWorkerTop:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  liveWorkerName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  liveWorkerMeta: { fontSize: 11, color: '#64748B', marginTop: 1 },
  statusPill:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot:      { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10, fontWeight: '800' },
  metricsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCell: {
    width: '30%', borderRadius: BorderRadius.md, padding: 8, alignItems: 'center',
  },
  metricCellLabel: { fontSize: 10, color: '#64748B', marginTop: 3, marginBottom: 1 },
  metricCellValue: { fontSize: 13, fontWeight: '700' },
  liveWorkerFooter:{ marginTop: 10, fontSize: 11, color: '#94A3B8' },

  // Gauges
  gaugeRow: { gap: 12, paddingVertical: 8 },
  gaugeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginTop: 4,
  },
  gaugeDot:       { width: 6, height: 6, borderRadius: 3 },
  gaugeBadgeText: { fontSize: 9, fontWeight: '800' },
  gaugeLabel:     { fontSize: 11, color: '#475569', marginTop: 3, fontWeight: '600' },
  gaugeLegendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendLine:     { width: 16, height: 3, borderRadius: 2 },
  legendText:     { fontSize: 11, color: '#64748B' },

  // Gas level card
  gasLevelCard: {
    borderLeftWidth: 4,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#F8FAFC',
    padding: 14, marginBottom: 10,
  },
  gasLevelHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  gasLevelBadge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  gasLevelBadgeText:   { fontSize: 13, fontWeight: '700' },
  gasCurrentVal:       { fontSize: 18, fontWeight: '800' },
  gasLevelBars:        { gap: 6, marginBottom: 10 },
  gasLevelRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gasLevelLbl:         { width: 70, fontSize: 10, color: '#64748B', fontWeight: '600' },
  gasLevelTrack:       { flex: 1, height: 7, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' },
  gasLevelFill:        { height: '100%', borderRadius: 4 },
  gasLevelCount:       { width: 20, textAlign: 'right', fontSize: 11, fontWeight: '700' },
  gasStatRow:          { flexDirection: 'row', gap: 12 },
  gasStat:             { alignItems: 'center' },
  gasStatLbl:          { fontSize: 10, color: '#94A3B8' },
  gasStatVal:          { fontSize: 13, fontWeight: '700', color: '#334155' },

  // Gas trend tabs
  gasTabRow:    { gap: 8, marginBottom: 14 },
  gasTab: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: BorderRadius.full, borderWidth: 1, borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  gasTabText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  thresholdLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },

  // Water level
  waterSection:   { marginTop: 16 },
  waterRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  waterWorkerCell:{ alignItems: 'center', width: 64 },
  waterBarWrap:   { alignItems: 'center', gap: 4 },
  waterBarTrack: {
    width: 20, height: 80, backgroundColor: '#E2E8F0', borderRadius: 10,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  waterBarFill:    { width: '100%', borderRadius: 10 },
  waterBarValue:   { fontSize: 10, fontWeight: '700', marginTop: 3 },
  waterWorkerName: { fontSize: 10, color: '#64748B', marginTop: 4, textAlign: 'center', maxWidth: 64 },

  // Gas zone row
  gasZoneRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 8,
  },
  gasZoneName:  { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  gasZoneMeta:  { fontSize: 11, color: '#64748B', marginTop: 1 },
  gasZonePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '55%', justifyContent: 'flex-end' },
  gasMiniPill:  { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  gasMiniPillText: { fontSize: 10, fontWeight: '700' },

  // Compliance
  complianceHero: { alignItems: 'center', paddingVertical: 20 },
  complianceTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginTop: 8 },
  complianceScore: { fontSize: 56, fontWeight: '900', marginVertical: 8 },
  complianceSub:   { fontSize: 13, color: '#64748B', marginBottom: 16 },
  complianceBarTrack: {
    width: '100%', height: 12, backgroundColor: '#E2E8F0',
    borderRadius: 6, overflow: 'hidden', marginBottom: 12,
  },
  complianceBarFill:  { height: '100%', borderRadius: 6 },
  complianceNote:     { fontSize: 13, fontWeight: '600', color: '#475569', textAlign: 'center' },

  complianceGasRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  complianceGasLabel:    { width: 40, fontSize: 12, fontWeight: '700', color: '#334155' },
  complianceGasBarTrack: { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  complianceGasBarFill:  { height: '100%', borderRadius: 4 },
  complianceGasPct:      { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '700' },

  complianceZoneRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  complianceZoneName:   { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  complianceZoneMeta:   { fontSize: 11, color: '#64748B', marginTop: 1 },
  complianceZoneRight:  { alignItems: 'flex-end' },
  complianceZonePct:    { fontSize: 20, fontWeight: '900' },
  complianceZoneStatus: { fontSize: 10, fontWeight: '700' },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'center', padding: 24,
  },
  modalCard:    { backgroundColor: '#fff', borderRadius: BorderRadius.xl, padding: 20, ...Shadows.md },
  modalTitle:   { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  modalSub:     { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 },
  modalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  modalBtnText: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
});

export { buildReportHtml, buildReportCsv };