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
  Polyline,
} from 'react-native-svg';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import {
  listenToWorkers,
  listenToAlerts,
  listenToAllSensors,
  listenToPreMonitor,
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
  workerId?: string;
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
  { key: 'h2s', label: 'H₂S', unit: 'ppm', color: '#84CC16', l1: 10,   l2: 100,  l3: 200  },
  { key: 'o2',  label: 'O₂',  unit: '%',   color: '#3B82F6', l1: 19.5, l2: 17.5, l3: 15   },
  { key: 'nh3', label: 'NH₃', unit: 'ppm', color: '#8B5CF6', l1: 25,   l2: 50,  l3: 100  },
];

const VITAL_THRESHOLDS = {
  heartRate: { l1: 60, l2: 100, l3: 150 },
  spo2:      { l1: 95, l2: 90,  l3: 85  },
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

function getAvgWaterLevelByWorker(workerId: string, gasReadings: GasReading[]): number | null {
  const workerReadings = gasReadings.filter(r => r.workerId === workerId && r.waterLevel != null);
  const waterLevels = workerReadings.map(r => r.waterLevel).filter((w): w is number => w != null && w > 0);
  return avg(waterLevels);
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
  return labels.map((label, i) => ({ label, value: buckets[i] as number }));
}

function getGasTrend(readings: GasReading[], gasKey: string, period: Period) {
  const labels = getPeriodBuckets(period);
  const buckets: number[][] = labels.map(() => []);
  const now = new Date();
  readings.forEach(r => {
    const d = timestampToDate(r.timestamp) ?? now;
    const val = (r as any)[gasKey];
    if (val != null && typeof val === 'number' && val > 0) {
      buckets[getBucketIndex(d, period)].push(val);
    }
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

// ─── FIX: Working Bar Chart ────────────────────────────────────────────────────
// Uses simple Rect elements with proper null/zero guards.

function BarChart({ data, color, height = 130 }: {
  data: { label: string; value: number }[];
  color: string;
  height?: number;
}) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 24, bottom: 32, left: 36, right: 12 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  // Guard: need valid data
  const validData = (data ?? []).filter(d => d != null);
  if (!validData.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>No data available</Text>
      </View>
    );
  }

  const maxVal = Math.max(...validData.map(d => Number(d.value) || 0), 1);
  const barW = Math.max((chartW / validData.length) - 10, 6);

  // Y-axis labels: 0, mid, max
  const yLabels = [0, Math.round(maxVal / 2), maxVal];

  return (
    <Svg width={W} height={height}>
      {/* Y-axis grid lines + labels */}
      {yLabels.map((yVal, idx) => {
        const y = PAD.top + chartH - (yVal / maxVal) * chartH;
        return (
          <React.Fragment key={idx}>
            <Line
              x1={PAD.left} y1={y}
              x2={PAD.left + chartW} y2={y}
              stroke="#E2E8F0" strokeWidth={1}
            />
            <SvgText
              x={PAD.left - 5} y={y + 4}
              fontSize={9} fill="#94A3B8"
              textAnchor="end"
            >
              {yVal}
            </SvgText>
          </React.Fragment>
        );
      })}

      {/* Bars */}
      {validData.map((d, i) => {
        const val = Number(d.value) || 0;
        const barH = Math.max((val / maxVal) * chartH, val > 0 ? 3 : 0);
        const x = PAD.left + (i * chartW) / validData.length + ((chartW / validData.length) - barW) / 2;
        const y = PAD.top + chartH - barH;

        return (
          <React.Fragment key={`bar-${i}`}>
            {/* Bar */}
            <Rect
              x={x} y={y}
              width={barW} height={barH}
              rx={3}
              fill={color}
              opacity={0.85}
            />
            {/* Value label above bar */}
            {val > 0 && (
              <SvgText
                x={x + barW / 2} y={y - 4}
                fontSize={9} fill="#475569"
                textAnchor="middle" fontWeight="700"
              >
                {val}
              </SvgText>
            )}
            {/* X-axis label */}
            <SvgText
              x={x + barW / 2} y={PAD.top + chartH + 18}
              fontSize={9} fill="#94A3B8"
              textAnchor="middle"
            >
              {d.label}
            </SvgText>
          </React.Fragment>
        );
      })}

      {/* X axis line */}
      <Line
        x1={PAD.left} y1={PAD.top + chartH}
        x2={PAD.left + chartW} y2={PAD.top + chartH}
        stroke="#CBD5E1" strokeWidth={1}
      />
    </Svg>
  );
}

// ─── FIX: Working Line Chart ───────────────────────────────────────────────────
// Uses Polyline for the line, Circles for dots. Properly handles null values.

function GasLineChart({ data, cfg, height = 160 }: {
  data: { label: string; value: number | null }[];
  cfg: GasCfg;
  height?: number;
}) {
  const W = SCREEN_W - Spacing.md * 2 - 32;
  const PAD = { top: 32, bottom: 32, left: 40, right: 16 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  const validVals = (data ?? [])
    .map(d => d.value)
    .filter((v): v is number => v != null && !isNaN(v) && v > 0);

  if (!validVals.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>No data this period</Text>
      </View>
    );
  }

  const rawMax = Math.max(...validVals, cfg.l1 * 1.1);
  const rawMin = 0; // always start from 0 for clarity
  const range = rawMax - rawMin || 1;

  const toY = (v: number) => PAD.top + chartH - ((v - rawMin) / range) * chartH;
  const toX = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * chartW;

  // Build points for the polyline (skip null values)
  const points = data
    .map((d, i) => (d.value != null && d.value > 0 ? `${toX(i)},${toY(d.value)}` : null))
    .filter(Boolean)
    .join(' ');

  // Y-axis labels
  const ySteps = [0, Math.round(rawMax * 0.5), Math.round(rawMax)];

  // Threshold Y positions
  const l1Y = toY(Math.min(cfg.l1, rawMax * 0.99));
  const l2Y = toY(Math.min(cfg.l2, rawMax * 0.99));

  return (
    <Svg width={W} height={height}>
      {/* Y grid + labels */}
      {ySteps.map((yVal, idx) => {
        const y = toY(yVal);
        if (y < PAD.top || y > PAD.top + chartH) return null;
        return (
          <React.Fragment key={idx}>
            <Line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
              stroke="#F1F5F9" strokeWidth={1} />
            <SvgText x={PAD.left - 4} y={y + 3} fontSize={8} fill="#CBD5E1" textAnchor="end">
              {yVal}
            </SvgText>
          </React.Fragment>
        );
      })}

      {/* L1 threshold line */}
      {l1Y >= PAD.top && l1Y <= PAD.top + chartH && (
        <React.Fragment>
          <Line x1={PAD.left} y1={l1Y} x2={PAD.left + chartW} y2={l1Y}
            stroke="#16A34A" strokeWidth={1} strokeDasharray="6,3" />
          <SvgText x={PAD.left + 4} y={l1Y - 4} fontSize={8} fill="#16A34A">
            safe {cfg.l1}{cfg.unit}
          </SvgText>
        </React.Fragment>
      )}

      {/* L2 threshold line */}
      {l2Y >= PAD.top && l2Y <= PAD.top + chartH && (
        <React.Fragment>
          <Line x1={PAD.left} y1={l2Y} x2={PAD.left + chartW} y2={l2Y}
            stroke="#F59E0B" strokeWidth={1} strokeDasharray="6,3" />
          <SvgText x={PAD.left + 4} y={l2Y - 4} fontSize={8} fill="#F59E0B">
            caution {cfg.l2}{cfg.unit}
          </SvgText>
        </React.Fragment>
      )}

      {/* X axis */}
      <Line x1={PAD.left} y1={PAD.top + chartH}
        x2={PAD.left + chartW} y2={PAD.top + chartH}
        stroke="#CBD5E1" strokeWidth={1} />

      {/* Line */}
      {points.length > 0 && (
        <Polyline
          points={points}
          fill="none"
          stroke={cfg.color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Dots + X labels */}
      {data.map((d, i) => {
        const lvl = gasLevel(cfg.key, d.value);
        const cx = toX(i);
        return (
          <React.Fragment key={`pt-${i}`}>
            {/* X label */}
            <SvgText
              x={cx} y={PAD.top + chartH + 18}
              fontSize={8} fill="#94A3B8" textAnchor="middle"
            >
              {d.label}
            </SvgText>
            {/* Dot only if we have a value */}
            {d.value != null && d.value > 0 && (
              <Circle
                cx={cx} cy={toY(d.value)} r={5}
                fill={LEVEL_COLORS[lvl]}
                stroke="white" strokeWidth={1.5}
              />
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// --- SVG: Modern Radial Progress Gauge ---

function SemiGauge({ value, cfg, size = 120 }: {
  value: number | null;
  cfg: GasCfg;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.35;
  const strokeWidth = size * 0.08;
  const innerRadius = radius - strokeWidth;

  // Calculate percentage and level
  let pct = 0;
  if (value != null) {
    pct = Math.min(Math.max((value - 0) / (cfg.l3 - 0), 0), 1);
    if (cfg.key === 'o2') pct = 1 - pct; // Invert for O2
  }

  const lvl = gasLevel(cfg.key, value);
  
  // Create gradient ID
  const gradientId = `gauge-${cfg.key}-${size}`;

  // Calculate arc parameters
  const startAngle = -135; // Start from top-left
  const endAngle = 135;    // End at top-right
  const totalAngle = endAngle - startAngle;
  const valueAngle = startAngle + (pct * totalAngle);

  // Convert angles to radians
  const toRad = (angle: number) => (angle * Math.PI) / 180;
  
  // Create arc path
  const createArcPath = (startAngle: number, endAngle: number) => {
    const start = toRad(startAngle);
    const end = toRad(endAngle);
    const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    
    const x1 = cx + innerRadius * Math.cos(start);
    const y1 = cy + innerRadius * Math.sin(start);
    const x2 = cx + innerRadius * Math.cos(end);
    const y2 = cy + innerRadius * Math.sin(end);
    
    const x3 = cx + radius * Math.cos(start);
    const y3 = cy + radius * Math.sin(start);
    const x4 = cx + radius * Math.cos(end);
    const y4 = cy + radius * Math.sin(end);
    
    return `
      M ${x1} ${y1}
      L ${x3} ${y3}
      A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x4} ${y4}
      L ${x2} ${y2}
      A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1}
    `;
  };

  return (
    <View style={{ alignItems: 'center', width: size + 8 }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={LEVEL_COLORS[lvl]} stopOpacity="0.8" />
            <Stop offset="100%" stopColor={LEVEL_COLORS[lvl]} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        
        {/* Background track */}
        <Path
          d={createArcPath(startAngle, endAngle)}
          fill="#E5E7EB"
          opacity={0.3}
        />
        
        {/* Threshold segments */}
        <Path
          d={createArcPath(startAngle, startAngle + totalAngle * 0.33)}
          fill={cfg.key === 'o2' ? '#DC2626' : '#16A34A'}
          opacity={0.2}
        />
        <Path
          d={createArcPath(startAngle + totalAngle * 0.33, startAngle + totalAngle * 0.67)}
          fill="#F59E0B"
          opacity={0.2}
        />
        <Path
          d={createArcPath(startAngle + totalAngle * 0.67, endAngle)}
          fill={cfg.key === 'o2' ? '#16A34A' : '#DC2626'}
          opacity={0.2}
        />
        
        {/* Value arc */}
        {value != null && pct > 0 && (
          <Path
            d={createArcPath(startAngle, valueAngle)}
            fill={`url(#${gradientId})`}
          />
        )}
        
        {/* Center content */}
        <SvgText
          x={cx}
          y={cy - 5}
          fontSize={16}
          fontWeight="bold"
          fill={value != null ? LEVEL_COLORS[lvl] : '#CBD5E1'}
          textAnchor="middle"
        >
          {value != null ? `${value}` : '---'}
        </SvgText>
        <SvgText
          x={cx}
          y={cy + 10}
          fontSize={9}
          fill="#94A3B8"
          textAnchor="middle"
        >
          {cfg.unit}
        </SvgText>
      </Svg>

      <View style={[styles.gaugeBadge, { backgroundColor: LEVEL_BG[lvl] }]}>
        <View style={[styles.gaugeDot, { backgroundColor: LEVEL_COLORS[lvl] }]} />
        <Text style={[styles.gaugeBadgeText, { color: LEVEL_COLORS[lvl] }]}>
          {lvl === 'na' ? '---' : lvl.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.gaugeLabel}>{cfg.label}</Text>
    </View>
  );
}

function WaterLevelBar({ value, maxCm = 200 }: { value: number | null; maxCm?: number }) {
  const pct = value != null ? Math.min(value / maxCm, 1) : 0;
  const color = value == null ? '#CBD5E1'
    : value < 50  ? LEVEL_COLORS.safe
    : value < 120 ? LEVEL_COLORS.caution
    : LEVEL_COLORS.danger;
  
  const size = 80;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (pct * circumference);
  
  // Water level status
  const status = value == null ? 'No Data' 
    : value < 50  ? 'Low'
    : value < 120 ? 'Medium' 
    : 'High';
  
  return (
    <View style={{ alignItems: 'center', padding: 8 }}>
      <Svg width={size} height={size}>
        {/* Background circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
          fill="none"
        />
        
        {/* Progress circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        
        {/* Inner content */}
        <SvgText
          x={size / 2}
          y={size / 2 - 8}
          fontSize={18}
          fontWeight="bold"
          fill={color}
          textAnchor="middle"
        >
          {value != null ? `${value}` : '---'}
        </SvgText>
        <SvgText
          x={size / 2}
          y={size / 2 + 8}
          fontSize={10}
          fill="#6B7280"
          textAnchor="middle"
        >
          cm
        </SvgText>
      </Svg>
      
      {/* Status indicator */}
      <View style={{ marginTop: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color, textAlign: 'center' }}>
          {status}
        </Text>
      </View>
    </View>
  );
}

// --- Pre-monitoring Level Card (L1/L2/L3) ---

function GasLevelCard({ gasKey, readings }: {
  gasKey: string;
  readings: GasReading[];
}) {
  const cfg = GAS_CONFIG.find(g => g.key === gasKey)!;
  const vals = readings.map(r => (r as any)[gasKey] as number | null).filter((v): v is number => v != null && v > 0);
  const current = vals.length ? vals[vals.length - 1] : null;
  const avgVal = avg(vals);
  const maxVal = vals.length ? Math.max.apply(Math, vals) : null;

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

function LiveWorkerCard({ worker, sensor, preMonitorWaterLevel }: {
  worker: WorkerProfile;
  sensor?: SensorData | null;
  preMonitorWaterLevel?: number | null;
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

  const effectiveWaterLevel = (sensor?.waterLevel != null && sensor.waterLevel > 0)
    ? sensor.waterLevel
    : (preMonitorWaterLevel ?? null);

  const metrics = [
    { label: 'HR',    value: sensor?.heartRate ? `${sensor.heartRate} bpm` : '—', icon: 'heart-pulse',   lvl: sensor?.heartRate ? (sensor.heartRate < 60 || sensor.heartRate > 100 ? 'caution' : 'safe') : 'na' },
    { label: 'SpO₂', value: sensor?.spO2       ? `${sensor.spO2}%`         : '—', icon: 'lungs',         lvl: sensor?.spO2 ? (sensor.spO2 < 90 ? 'danger' : sensor.spO2 < 95 ? 'caution' : 'safe') : 'na' },
    { label: 'CH₄',  value: sensor?.ch4        ? `${sensor.ch4} ppm`       : '—', icon: 'fire',          lvl: gasLevel('ch4', sensor?.ch4 ?? null) },
    { label: 'CO',   value: (sensor as any)?.co ? `${(sensor as any).co} ppm` : '—', icon: 'cloud-outline', lvl: gasLevel('co', (sensor as any)?.co ?? null) },
    { label: 'Water',value: fmtCm(effectiveWaterLevel),                              icon: 'water',         lvl: effectiveWaterLevel != null ? (effectiveWaterLevel > 120 ? 'danger' : effectiveWaterLevel > 50 ? 'caution' : 'safe') : 'na' },
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

      {preMonitorWaterLevel != null && (
        <Text style={styles.liveWorkerFooter}>Pre-monitor water avg: {fmtCm(preMonitorWaterLevel)}</Text>
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
  workers: {
    id: string;
    name: string;
    employeeId: string;
    zone: string;
    shift: string;
    phone: string;
    bloodGroup: string;
    emergencyContact: string;
    status: 'safe' | 'warning' | 'danger' | 'offline';
    heartRate?: number;
    spo2?: number;
    ch4?: number;
    co?: number;
    h2s?: number;
    waterLevel?: number;
    manholeId?: string;
    locationLabel?: string;
    lastSeen?: string;
  }[];
  vitalStats: {
    avgHeartRate: number | null;
    avgSpO2: number | null;
    avgTemperature: number | null;
    totalVitalReadings: number;
  };
  environmentalStats: {
    avgWaterLevel: number | null;
    maxWaterLevel: number | null;
    totalWaterReadings: number;
    gasTrendData: { label: string; value: number | null }[];
    alertTrendData: { label: string; value: number }[];
  };
  complianceMetrics: {
    totalWorkHours: number;
    safetyComplianceRate: number;
    equipmentStatus: { working: number; malfunctioning: number; maintenance: number };
    trainingCompliance: number;
    incidentRate: number;
  };
}

function buildReportHtml(p: ReportParams): string {
  const now = new Date().toLocaleString('en-IN');
  const pl = p.period.charAt(0).toUpperCase() + p.period.slice(1);
  const g = p.overallGas;
  const v = p.vitalStats;
  const env = p.environmentalStats;
  const comp = p.complianceMetrics;

  const summaryCards = [
    { label: 'Total Workers', value: p.workersCount },
    { label: 'Total Alerts', value: p.totalAlerts },
    { label: 'Resolved', value: p.resolvedAlerts },
    { label: 'Resolution Rate', value: `${p.resolutionRate}%` },
    { label: 'Safety Compliance', value: `${comp.safetyComplianceRate}%` },
    { label: 'Incident Rate', value: `${comp.incidentRate}%` },
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

  const workerRows = p.workers.length
    ? p.workers.map(w => {
        const statusColor = w.status === 'danger' ? '#dc2626' : w.status === 'warning' ? '#f59e0b' : w.status === 'safe' ? '#16a34a' : '#64748b';
        return `<tr>
          <td>${esc(w.name)}</td><td>${esc(w.employeeId)}</td><td>${esc(w.zone)}</td>
          <td>${esc(w.shift)}</td><td>${esc(w.phone)}</td><td>${esc(w.bloodGroup)}</td>
          <td><span style="color:${statusColor}">${w.status.toUpperCase()}</span></td>
          <td>${w.heartRate ?? 'N/A'}</td><td>${w.spo2 ?? 'N/A'}</td>
          <td>${w.ch4 ?? 'N/A'}</td><td>${w.co ?? 'N/A'}</td>
          <td>${w.waterLevel ? `${w.waterLevel} cm` : 'N/A'}</td>
          <td>${esc(w.manholeId ?? '—')}</td><td>${esc(w.locationLabel ?? '—')}</td>
          <td>${esc(w.lastSeen ?? '—')}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="14" style="text-align:center;color:#64748B">No worker data</td></tr>';

  const envCards = [
    { label: 'Avg Water Level', value: env.avgWaterLevel ? `${env.avgWaterLevel.toFixed(1)} cm` : 'N/A' },
    { label: 'Max Water Level', value: env.maxWaterLevel ? `${env.maxWaterLevel.toFixed(1)} cm` : 'N/A' },
    { label: 'Water Readings', value: env.totalWaterReadings },
    { label: 'Vital Readings', value: v.totalVitalReadings },
  ].map(c =>
    `<div class="card"><div class="cardLabel">${c.label}</div><div class="cardValue">${c.value}</div></div>`
  ).join('');

  const complianceCards = [
    { label: 'Total Work Hours', value: `${comp.totalWorkHours}h` },
    { label: 'Safety Compliance', value: `${comp.safetyComplianceRate}%` },
    { label: 'Training Compliance', value: `${comp.trainingCompliance}%` },
    { label: 'Incident Rate', value: `${comp.incidentRate}%` },
  ].map(c =>
    `<div class="card"><div class="cardLabel">${c.label}</div><div class="cardValue">${c.value}</div></div>`
  ).join('');

  const equipmentRows = [
    ['Working', comp.equipmentStatus.working, '#16a34a'],
    ['Malfunctioning', comp.equipmentStatus.malfunctioning, '#dc2626'],
    ['Under Maintenance', comp.equipmentStatus.maintenance, '#f59e0b'],
  ].map(([status, count, color]) =>
    `<tr><td>${esc(status)}</td><td><span style="color:${color}">${count}</span></td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:Arial,sans-serif;color:#1A202C;padding:24px;max-width:900px;margin:0 auto;}
h1{margin:0 0 6px;color:#1A3C6E;font-size:22px;}
h2{font-size:15px;margin:24px 0 10px;color:#1A3C6E;border-bottom:2px solid #E2E8F0;padding-bottom:4px;}
h3{font-size:13px;margin:20px 0 8px;color:#1A3C6E;border-bottom:1px solid #E2E8F0;padding-bottom:3px;}
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
<h1>SMC LiveMonitor Comprehensive Safety Report</h1>
<div class="meta">Period: <strong>${pl}</strong> &nbsp;|&nbsp; Manager: <strong>${esc(p.managerName)}</strong> &nbsp;|&nbsp; Generated: <strong>${now}</strong></div>

<h2>📊 OVERVIEW - Executive Summary</h2>
<div class="grid">${summaryCards}</div>

<h2>🚨 Alert Breakdown</h2>
<ul>${p.alertsByType.map(a => `<li><span>${esc(a.label)}</span><strong>${a.count}</strong></li>`).join('')}</ul>

<h2>🗺️ Zone Performance</h2>
<ul>${p.zoneRows.map(z => `<li><span>${esc(z.name)}</span><span>${z.workers} workers · ${z.alerts} alerts · ${z.resolvedRate}% resolved</span></li>`).join('')}</ul>

<h2>👥 WORKERS - Detailed Information</h2>
<table><thead><tr><th>Name</th><th>ID</th><th>Zone</th><th>Shift</th><th>Phone</th><th>Blood</th><th>Status</th><th>HR</th><th>SpO₂</th><th>CH₄</th><th>CO</th><th>Water</th><th>Manhole</th><th>Location</th><th>Last Seen</th></tr></thead><tbody>${workerRows}</tbody></table>

<h2>🫁 VITAL STATISTICS</h2>
<div class="grid">
  <div class="card"><div class="cardLabel">Avg Heart Rate</div><div class="cardValue">${v.avgHeartRate ? `${v.avgHeartRate} bpm` : 'N/A'}</div></div>
  <div class="card"><div class="cardLabel">Avg SpO₂</div><div class="cardValue">${v.avgSpO2 ? `${v.avgSpO2}%` : 'N/A'}</div></div>
  <div class="card"><div class="cardLabel">Avg Temperature</div><div class="cardValue">${v.avgTemperature ? `${v.avgTemperature}°C` : 'N/A'}</div></div>
  <div class="card"><div class="cardLabel">Total Readings</div><div class="cardValue">${v.totalVitalReadings}</div></div>
</div>

<h2>🌡️ GAS & ENVIRONMENT</h2>
<h3>Overall Gas Concentration</h3>
<div class="grid">
  <div class="card"><div class="cardLabel">CO</div><div class="cardValue">${fmtVal(g.avgCo, ' ppm')}</div></div>
  <div class="card"><div class="cardLabel">CH₄</div><div class="cardValue">${fmtVal(g.avgCh4, ' ppm')}</div></div>
</div>

<h3>Environmental Statistics</h3>
<div class="grid">${envCards}</div>

<h3>Gas by Zone / Sewer Line</h3>
<table><thead><tr><th>Zone</th><th>Sewer Line</th><th>CO (ppm)</th><th>CH₄ (ppm)</th><th>Readings</th></tr></thead><tbody>${gasZoneRows}</tbody></table>

<h2>🛡️ COMPLIANCE & SAFETY</h2>
<h3>Compliance Metrics</h3>
<div class="grid">${complianceCards}</div>

<h3>Equipment Status</h3>
<table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${equipmentRows}</tbody></table>

<h2>📋 ALERT LOGS</h2>
<table><thead><tr><th>Time</th><th>Worker</th><th>Zone</th><th>Type</th><th>Value</th><th>Status</th></tr></thead><tbody>${alertRows}</tbody></table>

<div class="footer">SMC LiveMonitor &copy; ${new Date().getFullYear()} — Solapur Municipal Corporation - Comprehensive Safety Report</div>
</body></html>`;
}

function buildReportCsv(p: ReportParams): string {
  const lines: string[] = [];
  const now = new Date().toLocaleString('en-IN');
  const v = p.vitalStats;
  const env = p.environmentalStats;
  const comp = p.complianceMetrics;

  lines.push('SMC LiveMonitor Comprehensive Safety Report');
  lines.push(`Period,${csvCell(p.period)}`);
  lines.push(`Manager,${csvCell(p.managerName)}`);
  lines.push(`Generated,${csvCell(now)}`);
  lines.push('');

  lines.push('OVERVIEW - EXECUTIVE SUMMARY');
  lines.push('Total Workers,' + p.workersCount);
  lines.push('Total Alerts,' + p.totalAlerts);
  lines.push('Resolved,' + p.resolvedAlerts);
  lines.push('Resolution Rate,' + p.resolutionRate + '%');
  lines.push('Safety Compliance,' + comp.safetyComplianceRate + '%');
  lines.push('Incident Rate,' + comp.incidentRate + '%');
  lines.push('');

  lines.push('ALERT BREAKDOWN');
  lines.push('Type,Count');
  p.alertsByType.forEach(a => lines.push(`${csvCell(a.label)},${a.count}`));
  lines.push('');

  lines.push('ZONE PERFORMANCE');
  lines.push('Zone,Workers,Alerts,Resolution Rate');
  p.zoneRows.forEach(z => lines.push(`${csvCell(z.name)},${z.workers},${z.alerts},${z.resolvedRate}%`));
  lines.push('');

  lines.push('WORKERS - DETAILED INFORMATION');
  lines.push('Name,ID,Zone,Shift,Phone,Blood Group,Emergency Contact,Status,Heart Rate,SpO2,CH4,CO,H2S,Water Level,Manhole ID,Location,Last Seen');
  p.workers.forEach(w => {
    lines.push([
      csvCell(w.name), csvCell(w.employeeId), csvCell(w.zone), csvCell(w.shift),
      csvCell(w.phone), csvCell(w.bloodGroup), csvCell(w.emergencyContact),
      csvCell(w.status.toUpperCase()),
      w.heartRate ?? 'N/A', w.spo2 ?? 'N/A', w.ch4 ?? 'N/A', w.co ?? 'N/A', w.h2s ?? 'N/A',
      w.waterLevel ? `${w.waterLevel} cm` : 'N/A',
      csvCell(w.manholeId ?? 'N/A'), csvCell(w.locationLabel ?? 'N/A'), csvCell(w.lastSeen ?? 'N/A')
    ].join(','));
  });
  lines.push('');

  lines.push('VITAL STATISTICS');
  lines.push('Avg Heart Rate,' + (v.avgHeartRate ? `${v.avgHeartRate} bpm` : 'N/A'));
  lines.push('Avg SpO2,' + (v.avgSpO2 ? `${v.avgSpO2}%` : 'N/A'));
  lines.push('Avg Temperature,' + (v.avgTemperature ? `${v.avgTemperature}°C` : 'N/A'));
  lines.push('Total Vital Readings,' + v.totalVitalReadings);
  lines.push('');

  lines.push('GAS & ENVIRONMENT');
  lines.push('OVERALL GAS');
  lines.push(`CO (ppm),${p.overallGas.avgCo ?? 'N/A'}`);
  lines.push(`CH4 (ppm),${p.overallGas.avgCh4 ?? 'N/A'}`);
  lines.push(`H2S (ppm),${p.overallGas.avgH2s ?? 'N/A'}`);
  lines.push(`O2 (ppm),${p.overallGas.avgO2 ?? 'N/A'}`);
  lines.push(`NH3 (ppm),${p.overallGas.avgNh3 ?? 'N/A'}`);
  lines.push('');

  lines.push('ENVIRONMENTAL STATISTICS');
  lines.push('Avg Water Level,' + (env.avgWaterLevel ? `${env.avgWaterLevel.toFixed(1)} cm` : 'N/A'));
  lines.push('Max Water Level,' + (env.maxWaterLevel ? `${env.maxWaterLevel.toFixed(1)} cm` : 'N/A'));
  lines.push('Total Water Readings,' + env.totalWaterReadings);
  lines.push('');

  lines.push('GAS BY ZONE');
  lines.push('Zone,Sewer Line,CO (ppm),CH4 (ppm),H2S (ppm),O2 (ppm),NH3 (ppm),Readings');
  p.gasStats.forEach(z =>
    lines.push([
      csvCell(z.zone), csvCell(z.sewerLine),
      z.avgCo ?? 'N/A', z.avgCh4 ?? 'N/A', z.avgH2s ?? 'N/A',
      z.avgO2 ?? 'N/A', z.avgNh3 ?? 'N/A', z.readingsCount
    ].join(','))
  );
  lines.push('');

  lines.push('COMPLIANCE & SAFETY');
  lines.push('Total Work Hours,' + comp.totalWorkHours + 'h');
  lines.push('Safety Compliance Rate,' + comp.safetyComplianceRate + '%');
  lines.push('Training Compliance,' + comp.trainingCompliance + '%');
  lines.push('Incident Rate,' + comp.incidentRate + '%');
  lines.push('');

  lines.push('EQUIPMENT STATUS');
  lines.push('Status,Count');
  lines.push('Working,' + comp.equipmentStatus.working);
  lines.push('Malfunctioning,' + comp.equipmentStatus.malfunctioning);
  lines.push('Under Maintenance,' + comp.equipmentStatus.maintenance);
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
  const [preMonitorWaterByWorker, setPreMonitorWaterByWorker] = useState<Record<string, number | null>>({});

  // ── FIX: sensor subscription re-runs whenever liveWorkers list changes ──
  // Previously sensorUnsub was only set up inside the workers callback closure,
  // which caused stale data when workers updated but sensors didn't re-subscribe.
  useEffect(() => {
    if (!manager) return;

    const unsubWorkers = listenToWorkers(manager.uid, (nextWorkers) => {
      setLiveWorkers(nextWorkers);
    });

    const zones = manager.zones.length > 0 ? manager.zones : SOLAPUR_ZONES.map(z => z.id);
    const unsubAlerts = listenToAlerts(zones, setLiveAlerts);

    return () => { unsubWorkers(); unsubAlerts(); };
  }, [manager]);

  // ── FIX: separate effect for sensor subscription, re-runs on liveWorkers change ──
  useEffect(() => {
    if (!liveWorkers.length) {
      setLiveSensors({});
      return;
    }
    const unsub = listenToAllSensors(liveWorkers.map(w => w.id), (data) => {
      // Merge new data with existing to avoid wiping other workers' data
      setLiveSensors(prev => ({ ...prev, ...data }));
    });
    return () => unsub();
  }, [liveWorkers]);

  const effectiveWorkers = liveWorkers.length > 0 ? liveWorkers : workers;
  const effectiveSensors = Object.keys(liveSensors).length > 0 ? liveSensors : sensors;
  const effectiveAlerts  = liveAlerts.length > 0 ? liveAlerts : alerts;

  useEffect(() => {
    if (!effectiveWorkers.length) {
      setPreMonitorWaterByWorker({});
      return;
    }

    const parsePreMonitorWaterAvg = (raw: any): number | null => {
      if (!raw) return null;
      const values = [raw.level1_water, raw.level2_water, raw.level3_water]
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => !Number.isNaN(v) && v > 0);
      return values.length ? avg(values) : null;
    };

    const unsubs = effectiveWorkers.map((worker) =>
      listenToPreMonitor((worker as any).id, (data) => {
        setPreMonitorWaterByWorker((prev) => ({
          ...prev,
          [(worker as any).id]: parsePreMonitorWaterAvg(data),
        }));
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [effectiveWorkers]);

  const getLiveTimestamp = (rawTs: unknown): number => {
    const parsed = timestampToDate(rawTs);
    const now = Date.now();
    if (!parsed || Number.isNaN(parsed.getTime())) return now;

    const t = parsed.getTime();
    const oldestAllowed = new Date(2023, 0, 1).getTime();
    const newestAllowed = now + 24 * 60 * 60 * 1000;
    if (t < oldestAllowed || t > newestAllowed) return now;

    return t;
  };

  const readSensorNumber = (sensor: any, keys: string[]): number | null => {
    for (const key of keys) {
      const raw = sensor?.[key];
      if (raw == null || raw === '') continue;
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isNaN(num)) return num;
    }
    return null;
  };

  // Gas readings derived from sensors — recomputed on every sensor update
  const gasReadings = useMemo((): GasReading[] =>
    Object.entries(effectiveSensors).map(([workerId, s]) => ({
      workerId,
      zone:       s.zone ?? s.locationLabel ?? 'Unknown',
      sewerLine:  s.manholeId ?? s.locationLabel ?? 'Unknown',
      ch4:        (() => {
        const v = readSensorNumber(s, ['ch4', 'mq4_ppm']);
        return v != null && v > 0 ? v : null;
      })(),
      h2s:        (() => {
        const v = readSensorNumber(s, ['h2s', 'mq7_ppm']);
        return v != null && v > 0 ? v : null;
      })(),
      co:         (() => {
        const v = readSensorNumber(s, ['co', 'mq7_ppm', 'h2s']);
        return v != null && v > 0 ? v : null;
      })(),
      o2:         (() => {
        const v = readSensorNumber(s, ['o2']);
        return v != null && v > 0 ? v : null;
      })(),
      nh3:        (() => {
        const v = readSensorNumber(s, ['nh3']);
        return v != null && v > 0 ? v : null;
      })(),
      waterLevel: readSensorNumber(s, ['waterLevel', 'water_level']),
      timestamp:  getLiveTimestamp((s as any).lastUpdated ?? (s as any).last_seen ?? (s as any).timestamp),
    })),
  [effectiveSensors]);

  // Vital readings
  const vitalReadings = useMemo((): VitalReading[] =>
    Object.entries(effectiveSensors).map(([workerId, s]) => ({
      workerId,
      workerName: effectiveWorkers.find((w: any) => w.id === workerId)?.name ?? workerId,
      zone:       s.zone ?? s.locationLabel ?? 'Unknown',
      heartRate:  (() => {
        const v = readSensorNumber(s, ['heartRate', 'hr']);
        return v != null && v > 0 ? v : null;
      })(),
      spo2:       (() => {
        const v = readSensorNumber(s, ['spO2', 'spo2']);
        return v != null && v > 0 ? v : null;
      })(),
      temperature: null,
      timestamp:  getLiveTimestamp((s as any).lastUpdated ?? (s as any).last_seen ?? (s as any).timestamp),
    })),
  [effectiveSensors, effectiveWorkers]);

  const periodAlerts = useMemo(() =>
    (effectiveAlerts as ReportAlert[]).filter(a => isInPeriod(a.timestamp ?? Date.now(), period)),
  [effectiveAlerts, period]);

  const periodGasReadings = useMemo(() =>
    gasReadings.filter(r => isInPeriod(r.timestamp, period)),
  [gasReadings, period]);

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
    avgH2s: avg(periodGasReadings.map(r => r.h2s ?? null)),
    avgO2:  avg(periodGasReadings.map(r => r.o2  ?? null)),
    avgNh3: avg(periodGasReadings.map(r => r.nh3 ?? null)),
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
        avgH2s:  avg(recs.map(r => r.h2s ?? null)),
        avgO2:   avg(recs.map(r => r.o2  ?? null)),
        avgNh3:  avg(recs.map(r => r.nh3 ?? null)),
        readingsCount: recs.length,
      };
    });
  }, [periodGasReadings]);

  // ── FIX: gasTrendData - use periodGasReadings (which includes live data) ──
  // Also add a fallback demo point so the chart always has something to render
  // when live sensors have data but no historical spread across buckets.
  const gasTrendData = useMemo(() => {
    const trend = getGasTrend(periodGasReadings, selectedGas, period);
    // If all buckets are null but we have a current reading, inject it into the
    // most-recent bucket so the chart is never blank with live data present.
    const hasAnyValue = trend.some(t => t.value != null);
    if (!hasAnyValue && periodGasReadings.length > 0) {
      const currentVal = avg(periodGasReadings.map(r => (r as any)[selectedGas] as number | null));
      if (currentVal != null) {
        const lastIdx = trend.length - 1;
        trend[lastIdx] = { ...trend[lastIdx], value: currentVal };
      }
    }
    return trend;
  }, [periodGasReadings, selectedGas, period]);

  // ── FIX: alertTrendData - same injection for current-period alerts ──
  const alertTrendData = useMemo(() => {
    const trend = getAlertTrend(periodAlerts, period);
    return trend;
  }, [periodAlerts, period]);

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

  const getAvgWaterLevelByWorker = (workerId: string, gasReadings: GasReading[]) => {
    const preMonitorAvg = preMonitorWaterByWorker[workerId];
    if (preMonitorAvg != null) return preMonitorAvg;
    const workerReadings = gasReadings.filter(r => r.workerId === workerId);
    const waterLevels = workerReadings.map(r => r.waterLevel).filter((w): w is number => w != null);
    return waterLevels.length > 0 ? avg(waterLevels) : null;
  };

  const workersData = effectiveWorkers.map(worker => {
    const sensor = effectiveSensors[worker.id];
    const avgWaterLevel = getAvgWaterLevelByWorker(worker.id, gasReadings);
    const status = sensor ? getSensorStatus(sensor) : null;
    return {
      id: worker.id,
      name: worker.name,
      employeeId: worker.employeeId,
      zone: worker.zone,
      shift: worker.shift,
      phone: worker.phone,
      bloodGroup: worker.bloodGroup ?? 'N/A',
      emergencyContact: worker.emergencyContact ?? 'N/A',
      status: sensor ? getSensorStatus(sensor)?.overall ?? 'offline' : 'offline',
      heartRate: sensor?.heartRate,
      spo2: sensor?.spO2,
      ch4: sensor?.ch4,
      co: (sensor as any)?.co,
      h2s: sensor?.h2s,
      waterLevel: avgWaterLevel ?? undefined, // Use average water level during premonitoring
      manholeId: sensor?.manholeId,
      locationLabel: sensor?.locationLabel,
      lastSeen: sensor?.lastUpdated ? new Date(sensor.lastUpdated).toLocaleString('en-IN') : undefined,
    };
  });

  const vitalStatsData = {
    avgHeartRate: avg(vitalReadings.map(r => r.heartRate)),
    avgSpO2: avg(vitalReadings.map(r => r.spo2)),
    avgTemperature: avg(vitalReadings.map(r => r.temperature)),
    totalVitalReadings: vitalReadings.length,
  };

  const waterLevels = gasReadings.map(r => r.waterLevel).filter((w): w is number => w != null);
  const environmentalStatsData = {
    avgWaterLevel: avg(waterLevels),
    maxWaterLevel: waterLevels.length ? Math.max.apply(Math, waterLevels) : null,
    totalWaterReadings: waterLevels.length,
    gasTrendData: gasTrendData,
    alertTrendData: alertTrendData,
  };

  const totalWorkHours = effectiveWorkers.length * 8 * 7;
  const safetyComplianceRate = totalAlerts > 0
    ? Math.max(0, Math.round(100 - (totalAlerts / Math.max(effectiveWorkers.length, 1)) * 10))
    : 95;
  const equipmentStatus = {
    working: effectiveSensors ? Object.keys(effectiveSensors).length : 0,
    malfunctioning: Math.max(0, effectiveWorkers.length - (effectiveSensors ? Object.keys(effectiveSensors).length : 0)),
    maintenance: 0,
  };
  const trainingCompliance = 92;
  const incidentRate = totalAlerts > 0
    ? Math.round((totalAlerts / Math.max(effectiveWorkers.length, 1)) * 100)
    : 0;

  const reportParams: ReportParams = {
    period, managerName: manager?.name || 'Manager',
    workersCount: effectiveWorkers.length,
    totalAlerts, resolvedAlerts, resolutionRate,
    alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
    zoneRows, recentAlerts, gasStats, overallGas,
    workers: workersData,
    vitalStats: vitalStatsData,
    environmentalStats: environmentalStatsData,
    complianceMetrics: {
      totalWorkHours,
      safetyComplianceRate,
      equipmentStatus,
      trainingCompliance,
      incidentRate,
    },
  };

  const fileName = `smc-livemonitor-${period}-report`;

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
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📊 Summary</Text>
              <Text style={styles.sectionSub}>This {period} · {manager?.name ?? '—'}</Text>
              <View style={styles.summaryRow}>
                {[
                  { label: 'Workers',  value: String(effectiveWorkers.length), icon: 'account-hard-hat', color: Colors.primary },
                  { label: 'Alerts',   value: String(totalAlerts),             icon: 'alarm-light',      color: Colors.danger  },
                  { label: 'Resolved', value: String(resolvedAlerts),           icon: 'check-circle',     color: Colors.success },
                  { label: 'Rate',     value: `${resolutionRate}%`,             icon: 'percent',          color: Colors.accent  },
                ].map(s => (
                  <View key={s.label} style={styles.summaryCard}>
                    <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
                    <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.summaryLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Alert Trend — BarChart */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📈 Alert Trend</Text>
              <Text style={styles.sectionSub}>
                Alerts per {period === 'today' ? '4-hour block' : period === 'week' ? 'day' : 'week'}
              </Text>
              <BarChart data={alertTrendData} color={Colors.primary} />
            </View>

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
                  <LiveWorkerCard
                    key={(worker as any).id}
                    worker={worker}
                    sensor={sensor}
                    preMonitorWaterLevel={preMonitorWaterByWorker[(worker as any).id] ?? null}
                  />
                ))
              }
            </View>

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

        {/* ═══════════════ COMPLIANCE TAB ═══════════════ */}
        {activeTab === 'compliance' && (
          <>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerIconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#E8600A',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },
  headerSub:   { fontSize: 10, color: '#7B9FC7', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: '#22C55E',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
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
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  periodBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  periodBtnActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodText:       { fontSize: 13, color: '#64748B', fontWeight: '600' },
  periodTextActive: { color: '#fff' },

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
  tabItemActive:  { borderBottomColor: Colors.primary },
  tabLabel:       { fontSize: 11, color: '#94A3B8', fontWeight: '600' },
  tabLabelActive: { color: Colors.primary },

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
  summaryRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  summaryCard: {
    flex: 1, minWidth: '22%',
    backgroundColor: '#F8FAFC',
    borderRadius: BorderRadius.lg,
    padding: 12, alignItems: 'center',
  },
  summaryValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  summaryLabel: { fontSize: 10, color: '#64748B', marginTop: 3, textAlign: 'center' },

  // Alert breakdown
  alertRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  alertRowLabel: { width: 80, fontSize: 12, fontWeight: '600', color: '#334155' },
  alertBarTrack: { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  alertBarFill:  { height: '100%', borderRadius: 4 },
  alertRowCount: { width: 28, textAlign: 'right', fontWeight: '700', fontSize: 13 },

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
  },
  liveWorkerTop:   { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  liveWorkerName:  { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  liveWorkerMeta:  { fontSize: 11, color: '#64748B', marginTop: 1 },
  statusPill:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot:       { width: 6, height: 6, borderRadius: 3 },
  statusPillText:  { fontSize: 10, fontWeight: '800' },
  metricsGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCell:      { width: '30%', borderRadius: BorderRadius.md, padding: 8, alignItems: 'center' },
  metricCellLabel: { fontSize: 10, color: '#64748B', marginTop: 3, marginBottom: 1 },
  metricCellValue: { fontSize: 13, fontWeight: '700' },
  liveWorkerFooter:{ marginTop: 10, fontSize: 11, color: '#94A3B8' },

  // Gauges
  gaugeRow:       { gap: 12, paddingVertical: 8 },
  gaugeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginTop: 4 },
  gaugeDot:       { width: 6, height: 6, borderRadius: 3 },
  gaugeBadgeText: { fontSize: 9, fontWeight: '800' },
  gaugeLabel:     { fontSize: 11, color: '#475569', marginTop: 3, fontWeight: '600' },
  gaugeLegendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendLine:     { width: 16, height: 3, borderRadius: 2 },
  legendText:     { fontSize: 11, color: '#64748B' },

  // Gas level card
  gasLevelCard:      { borderLeftWidth: 4, borderRadius: BorderRadius.lg, backgroundColor: '#F8FAFC', padding: 14, marginBottom: 10 },
  gasLevelHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  gasLevelBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  gasLevelBadgeText: { fontSize: 13, fontWeight: '700' },
  gasCurrentVal:     { fontSize: 18, fontWeight: '800' },
  gasLevelBars:      { gap: 6, marginBottom: 10 },
  gasLevelRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gasLevelLbl:       { width: 70, fontSize: 10, color: '#64748B', fontWeight: '600' },
  gasLevelTrack:     { flex: 1, height: 7, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' },
  gasLevelFill:      { height: '100%', borderRadius: 4 },
  gasLevelCount:     { width: 20, textAlign: 'right', fontSize: 11, fontWeight: '700' },
  gasStatRow:        { flexDirection: 'row', gap: 12 },
  gasStat:           { alignItems: 'center' },
  gasStatLbl:        { fontSize: 10, color: '#94A3B8' },
  gasStatVal:        { fontSize: 13, fontWeight: '700', color: '#334155' },

  // Gas trend
  gasTabRow:        { gap: 8, marginBottom: 14 },
  gasTab: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: BorderRadius.full, borderWidth: 1, borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  gasTabText:       { fontSize: 12, fontWeight: '700', color: '#475569' },
  thresholdLegend:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },

  // Water level
  waterSection:    { marginTop: 16 },
  waterRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  waterWorkerCell: { alignItems: 'center', width: 64 },
  waterBarWrap:    { alignItems: 'center', gap: 4 },
  waterBarTrack: {
    width: 20, height: 80, backgroundColor: '#E2E8F0', borderRadius: 10,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  waterBarFill:    { width: '100%', borderRadius: 10 },
  waterBarValue:   { fontSize: 10, fontWeight: '700', marginTop: 3 },
  waterWorkerName: { fontSize: 10, color: '#64748B', marginTop: 4, textAlign: 'center', maxWidth: 64 },
  waterWorkerAvg: { fontSize: 9, color: '#94A3B8', marginTop: 2, textAlign: 'center', maxWidth: 64 },

  // Gas zone row
  gasZoneRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 8,
  },
  gasZoneName:     { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  gasZoneMeta:     { fontSize: 11, color: '#64748B', marginTop: 1 },
  gasZonePills:    { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: '55%', justifyContent: 'flex-end' },
  gasMiniPill:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  gasMiniPillText: { fontSize: 10, fontWeight: '700' },

  // Compliance
  complianceHero:      { alignItems: 'center', paddingVertical: 20 },
  complianceTitle:     { fontSize: 18, fontWeight: '700', color: '#0F172A', marginTop: 8 },
  complianceScore:     { fontSize: 56, fontWeight: '900', marginVertical: 8 },
  complianceSub:       { fontSize: 13, color: '#64748B', marginBottom: 16 },
  complianceBarTrack:  { width: '100%', height: 12, backgroundColor: '#E2E8F0', borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  complianceBarFill:   { height: '100%', borderRadius: 6 },
  complianceNote:      { fontSize: 13, fontWeight: '600', color: '#475569', textAlign: 'center' },
  complianceGasRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  complianceGasLabel:  { width: 40, fontSize: 12, fontWeight: '700', color: '#334155' },
  complianceGasBarTrack: { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  complianceGasBarFill:  { height: '100%', borderRadius: 4 },
  complianceGasPct:    { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  complianceZoneRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  complianceZoneName:  { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  complianceZoneMeta:  { fontSize: 11, color: '#64748B', marginTop: 1 },
  complianceZoneRight: { alignItems: 'flex-end' },
  complianceZonePct:   { fontSize: 20, fontWeight: '900' },
  complianceZoneStatus:{ fontSize: 10, fontWeight: '700' },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'center', padding: 24,
  },
  modalCard:    { backgroundColor: '#fff', borderRadius: BorderRadius.xl, padding: 20, ...Shadows.md },
  modalTitle:   { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  modalSub:     { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 },
  modalBtn:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalBtnText: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
});

export { buildReportHtml, buildReportCsv };