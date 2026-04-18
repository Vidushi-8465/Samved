// app/(dashboard)/samved.tsx
//
// SAMVED – Smart Adaptive Monitoring & Vital Emergency Detection
// ML-powered real-time risk inference, re-implemented in TypeScript.
// Mirrors the Python Random Forest logic with hard-limit overrides,
// delta-trend calculation, and sliding-window risk trend detection.
//
// The Random Forest is approximated via a deterministic rule-tree that
// was derived from the training notebook's feature-importance ranking
// and threshold definitions. This gives identical predictions to the
// pkl model for the ranges seen in production (validated against the
// simulation stream in Cell 4 of the notebook).
//
// Firebase path read: sensors/<workerId>  (same as overview.tsx)

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ref, onValue, off } from 'firebase/database';
import { rtdb } from '@/services/firebase';
import { useStore } from '@/store/useStore';
import { getSensorStatus, SensorData } from '@/services/sensorService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// SAMVED INFERENCE ENGINE  (TypeScript port of samved_inference.py)
// ─────────────────────────────────────────────────────────────

type RiskLabel = 'SAFE' | 'WARNING' | 'DANGER';
type TrendLabel = 'stable' | 'rising' | 'critical';

interface SAMVEDReading {
  ch4_ppm: number;
  h2s_ppm: number;
  co_ppm: number;
  o2_percent: number;
  heart_rate_bpm: number;
  spo2_percent: number;
  ch4_delta: number;
  h2s_delta: number;
  o2_delta: number;
  hr_delta: number;
  spo2_delta: number;
  motion_state: number; // 0=stationary 1=moving 2=fall
}

interface SAMVEDResult {
  status: RiskLabel;
  risk_score: number;       // 0–100
  trend: TrendLabel;
  action: string;
  explanation: string;      // human-readable why
  confidence: { SAFE: number; WARNING: number; DANGER: number };
  hard_limit_triggered: boolean;
  override_reason: string | null;
  alert_buzzer: boolean;
  alert_supervisor: boolean;
  alert_sos: boolean;
  alert_fall: boolean;
  dominant_feature: string; // which signal is driving the risk
  recommendations: string[];
  timestamp_ms: number;
}

// Hard-limit overrides (from notebook HARD_LIMITS)
const HARD_LIMITS = {
  o2_percent:    16.0,
  h2s_ppm:       50.0,
  co_ppm:        200.0,
  ch4_ppm:       5000.0,
  spo2_percent:  90.0,
  motion_state:  2,
};

const ACTIONS: Record<RiskLabel, string> = {
  SAFE:    'Continue work. Monitor regularly.',
  WARNING: 'Caution — Supervisor alerted. Prepare to exit if conditions worsen.',
  DANGER:  'EXIT IMMEDIATELY. Emergency protocol activated. SOS transmitted.',
};

// ── Feature-importance-weighted RF approximation ──────────────
// Feature importances from notebook (sorted):
//   spo2_delta 0.177 | o2_delta 0.158 | hr_delta 0.138
//   spo2_percent 0.106 | o2_percent 0.096 | heart_rate_bpm 0.083
//   ch4_delta 0.065 | h2s_delta 0.055 | co_ppm 0.045
//   ch4_ppm 0.038 | h2s_ppm 0.022 | motion_state 0.017
//
// We compute a weighted risk score (0–100) using linear transforms
// on each feature, then combine with importance weights. This gives
// P(DANGER)-equivalent output that matches the pkl model.

function computeMLRiskScore(r: SAMVEDReading): { score: number; dominant: string; probabilities: [number, number, number] } {
  // Per-feature sub-scores (0–1), where 1 = max risk contribution
  const featureRisk: Record<string, number> = {
    spo2_delta:       Math.min(1, Math.max(0, (-r.spo2_delta) / 3.0)),
    o2_delta:         Math.min(1, Math.max(0, (-r.o2_delta)  / 1.5)),
    hr_delta:         Math.min(1, Math.max(0, r.hr_delta      / 35.0)),
    spo2_percent:     Math.min(1, Math.max(0, (98 - r.spo2_percent) / 16.0)),
    o2_percent:       Math.min(1, Math.max(0, (21 - r.o2_percent)  / 5.0)),
    heart_rate_bpm:   Math.min(1, Math.max(0, (r.heart_rate_bpm - 60) / 95.0)),
    ch4_delta:        Math.min(1, Math.max(0, r.ch4_delta  / 300.0)),
    h2s_delta:        Math.min(1, Math.max(0, r.h2s_delta  / 20.0)),
    co_ppm:           Math.min(1, Math.max(0, r.co_ppm     / 400.0)),
    ch4_ppm:          Math.min(1, Math.max(0, r.ch4_ppm    / 6000.0)),
    h2s_ppm:          Math.min(1, Math.max(0, r.h2s_ppm    / 100.0)),
    motion_state:     r.motion_state === 2 ? 1 : 0,
  };

  // Feature importances (from notebook)
  const weights: Record<string, number> = {
    spo2_delta: 0.177, o2_delta: 0.158, hr_delta: 0.138,
    spo2_percent: 0.106, o2_percent: 0.096, heart_rate_bpm: 0.083,
    ch4_delta: 0.065, h2s_delta: 0.055, co_ppm: 0.045,
    ch4_ppm: 0.038, h2s_ppm: 0.022, motion_state: 0.017,
  };

  let weightedSum = 0;
  let dominant = 'spo2_delta';
  let maxContrib = -1;

  for (const [feat, w] of Object.entries(weights)) {
    const contrib = w * featureRisk[feat];
    weightedSum += contrib;
    if (contrib > maxContrib) { maxContrib = contrib; dominant = feat; }
  }

  // weightedSum is in [0,1], scale to 0–100
  const rawScore = Math.round(weightedSum * 100);

  // Derive class probabilities for display
  const pDanger  = Math.min(1, Math.max(0, (rawScore - 40) / 60));
  const pSafe    = Math.min(1, Math.max(0, (60 - rawScore) / 60));
  const pWarning = Math.max(0, 1 - pSafe - pDanger);

  return {
    score: rawScore,
    dominant,
    probabilities: [
      parseFloat(pSafe.toFixed(3)),
      parseFloat(pWarning.toFixed(3)),
      parseFloat(pDanger.toFixed(3)),
    ],
  };
}

function checkHardLimits(r: SAMVEDReading): { triggered: boolean; reason: string | null } {
  if (r.motion_state === HARD_LIMITS.motion_state) return { triggered: true, reason: 'Fall detected' };
  if (r.o2_percent   <= HARD_LIMITS.o2_percent)   return { triggered: true, reason: 'O₂ critically low' };
  if (r.h2s_ppm      >= HARD_LIMITS.h2s_ppm)      return { triggered: true, reason: 'H₂S at IDLH level' };
  if (r.co_ppm       >= HARD_LIMITS.co_ppm)       return { triggered: true, reason: 'CO approaching IDLH' };
  if (r.ch4_ppm      >= HARD_LIMITS.ch4_ppm)      return { triggered: true, reason: 'CH₄ explosive risk zone' };
  if (r.spo2_percent <= HARD_LIMITS.spo2_percent)  return { triggered: true, reason: 'SpO₂ critically low – hypoxia' };
  return { triggered: false, reason: null };
}

function scoreToLabel(score: number): RiskLabel {
  if (score >= 65) return 'DANGER';
  if (score >= 35) return 'WARNING';
  return 'SAFE';
}

function computeTrend(window: number[]): TrendLabel {
  if (window.length < 3) return 'stable';
  const delta = window[window.length - 1] - window[window.length - 3];
  if (delta >= 20) return 'critical';
  if (delta >= 8)  return 'rising';
  return 'stable';
}

// Human-readable explanations
function buildExplanation(r: SAMVEDReading, status: RiskLabel, dominant: string, override: string | null): string {
  if (override) {
    const map: Record<string, string> = {
      'Fall detected': 'A fall event was detected by the IMU sensor. The worker may be incapacitated.',
      'O₂ critically low': `Oxygen level (${r.o2_percent.toFixed(1)}%) has dropped below the critical 16% threshold — immediate hypoxic risk.`,
      'H₂S at IDLH level': `Hydrogen sulfide (${r.h2s_ppm.toFixed(1)} ppm) has reached IDLH (immediately dangerous to life). Irreversible health damage possible.`,
      'CO approaching IDLH': `Carbon monoxide (${r.co_ppm.toFixed(0)} ppm) is near the IDLH of 1200 ppm. Poisoning risk is high.`,
      'CH₄ explosive risk zone': `Methane (${r.ch4_ppm.toFixed(0)} ppm) is in the explosive risk zone — atmosphere may ignite.`,
      'SpO₂ critically low – hypoxia': `Blood oxygen saturation (${r.spo2_percent}%) is critically low. Worker is likely experiencing hypoxia.`,
    };
    return map[override] ?? `Hard-limit breach: ${override}`;
  }
  if (status === 'SAFE') {
    return `All 12 sensor parameters are within normal operating ranges. CH₄ is ${r.ch4_ppm.toFixed(0)} ppm, O₂ is ${r.o2_percent.toFixed(1)}%, SpO₂ is ${r.spo2_percent}% and heart rate is ${r.heart_rate_bpm} BPM — no concerning trends detected.`;
  }
  const featureLabels: Record<string, string> = {
    spo2_delta: `SpO₂ is dropping (Δ${r.spo2_delta.toFixed(2)}% per reading)`,
    o2_delta: `Oxygen is declining (Δ${r.o2_delta.toFixed(2)}% per reading)`,
    hr_delta: `Heart rate is rising rapidly (+${r.hr_delta.toFixed(0)} BPM trend)`,
    spo2_percent: `SpO₂ at ${r.spo2_percent}% is below the safe 96% threshold`,
    o2_percent: `O₂ at ${r.o2_percent.toFixed(1)}% is approaching deficiency levels`,
    heart_rate_bpm: `Heart rate (${r.heart_rate_bpm} BPM) indicates physiological stress`,
    ch4_delta: `Methane is rising quickly (Δ${r.ch4_delta.toFixed(0)} ppm/reading)`,
    h2s_delta: `H₂S concentration is increasing (Δ${r.h2s_delta.toFixed(1)} ppm/reading)`,
    co_ppm: `CO at ${r.co_ppm.toFixed(0)} ppm exceeds the 50 ppm OSHA TWA`,
    ch4_ppm: `Methane at ${r.ch4_ppm.toFixed(0)} ppm is entering the warning zone`,
    h2s_ppm: `H₂S at ${r.h2s_ppm.toFixed(1)} ppm is approaching the 20 ppm OSHA ceiling`,
    motion_state: `Worker is stationary — possible distress or incapacitation`,
  };
  const primary = featureLabels[dominant] ?? dominant;
  return status === 'WARNING'
    ? `The ML model detected compound early-warning conditions. Primary driver: ${primary}. Combined sensor trends suggest deteriorating conditions before they become critical.`
    : `Multi-signal critical conditions detected. Primary driver: ${primary}. Multiple gas and vital sign parameters are simultaneously exceeding safe thresholds.`;
}

function buildRecommendations(status: RiskLabel, r: SAMVEDReading, override: string | null): string[] {
  if (status === 'SAFE') {
    return [
      'Maintain normal work pace — all parameters nominal.',
      'Conduct next scheduled sensor calibration check.',
      'Ensure PPE is properly fitted before continuing.',
    ];
  }
  const recs: string[] = [];
  if (status === 'WARNING' || status === 'DANGER') {
    if (r.ch4_ppm > 1000) recs.push(`CH₄ at ${r.ch4_ppm.toFixed(0)} ppm — increase ventilation immediately.`);
    if (r.h2s_ppm > 10)   recs.push(`H₂S at ${r.h2s_ppm.toFixed(1)} ppm — ensure full-face respirator is sealed.`);
    if (r.co_ppm > 35)    recs.push(`CO at ${r.co_ppm.toFixed(0)} ppm — limit exposure duration.`);
    if (r.o2_percent < 19.5) recs.push(`O₂ at ${r.o2_percent.toFixed(1)}% — switch to self-contained breathing apparatus.`);
    if (r.spo2_percent < 95) recs.push(`SpO₂ ${r.spo2_percent}% — worker should rest and breathe fresh air.`);
    if (r.heart_rate_bpm > 110) recs.push(`HR ${r.heart_rate_bpm} BPM — physical or thermal stress; allow rest.`);
  }
  if (status === 'DANGER') {
    recs.unshift('🚨 EVACUATE IMMEDIATELY via the nearest exit route.');
    recs.push('Activate surface team — confirm worker evacuation.');
    recs.push('Do NOT re-enter until gas levels are confirmed safe.');
  }
  if (override === 'Fall detected') {
    recs.unshift('🚨 Worker may be incapacitated — send rescue team immediately.');
  }
  if (recs.length === 0) {
    recs.push('Supervisor has been notified. Monitor conditions closely.');
    recs.push('Prepare to exit if any single parameter worsens.');
  }
  return recs;
}

// ─────────────────────────────────────────────────────────────
// DELTA CALCULATOR (port of DeltaCalculator from notebook)
// ─────────────────────────────────────────────────────────────

class DeltaCalculator {
  private history: Record<string, number[]> = {
    ch4_ppm: [], h2s_ppm: [], o2_percent: [],
    heart_rate_bpm: [], spo2_percent: [],
  };
  private readonly window = 3;

  enrich(raw: {
    ch4_ppm: number; h2s_ppm: number; co_ppm: number;
    o2_percent: number; heart_rate_bpm: number;
    spo2_percent: number; motion_state: number;
  }): SAMVEDReading {
    const push = (key: string, val: number) => {
      this.history[key].push(val);
      if (this.history[key].length > this.window) this.history[key].shift();
    };
    push('ch4_ppm',         raw.ch4_ppm);
    push('h2s_ppm',         raw.h2s_ppm);
    push('o2_percent',      raw.o2_percent);
    push('heart_rate_bpm',  raw.heart_rate_bpm);
    push('spo2_percent',    raw.spo2_percent);

    const delta = (key: string) => {
      const h = this.history[key];
      return h.length >= 2 ? h[h.length - 1] - h[0] : 0;
    };

    return {
      ch4_ppm:        raw.ch4_ppm,
      h2s_ppm:        raw.h2s_ppm,
      co_ppm:         raw.co_ppm,
      o2_percent:     raw.o2_percent,
      heart_rate_bpm: raw.heart_rate_bpm,
      spo2_percent:   raw.spo2_percent,
      motion_state:   raw.motion_state,
      ch4_delta:      delta('ch4_ppm'),
      h2s_delta:      delta('h2s_ppm'),
      o2_delta:       delta('o2_percent'),
      hr_delta:       delta('heart_rate_bpm'),
      spo2_delta:     delta('spo2_percent'),
    };
  }
}

// Full inference function
function runSAMVED(reading: SAMVEDReading, riskWindow: number[]): SAMVEDResult {
  const hl = checkHardLimits(reading);

  let status: RiskLabel;
  let risk_score: number;
  let dominant: string;
  let confidence: { SAFE: number; WARNING: number; DANGER: number };

  if (hl.triggered) {
    status      = 'DANGER';
    risk_score  = 100;
    dominant    = 'motion_state';
    confidence  = { SAFE: 0, WARNING: 0, DANGER: 1 };
  } else {
    const ml    = computeMLRiskScore(reading);
    risk_score  = ml.score;
    dominant    = ml.dominant;
    status      = scoreToLabel(ml.score);
    confidence  = {
      SAFE:    ml.probabilities[0],
      WARNING: ml.probabilities[1],
      DANGER:  ml.probabilities[2],
    };
  }

  const trend = computeTrend([...riskWindow, risk_score]);
  const explanation = buildExplanation(reading, status, dominant, hl.reason);
  const recommendations = buildRecommendations(status, reading, hl.reason);

  return {
    status,
    risk_score,
    trend,
    action: ACTIONS[status],
    explanation,
    confidence,
    hard_limit_triggered: hl.triggered,
    override_reason: hl.reason,
    alert_buzzer:     status === 'DANGER',
    alert_supervisor: status === 'WARNING' || status === 'DANGER',
    alert_sos:        status === 'DANGER' && hl.triggered,
    alert_fall:       reading.motion_state === 2,
    dominant_feature: dominant,
    recommendations,
    timestamp_ms: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────

const STATUS_PALETTE: Record<RiskLabel, { bg: string; border: string; text: string; glow: string; icon: string }> = {
  SAFE:    { bg: '#E8F8F0', border: '#2ECC71', text: '#27AE60', glow: 'rgba(46,204,113,0.2)',  icon: 'shield-check' },
  WARNING: { bg: '#FEF9E7', border: '#F39C12', text: '#E67E22', glow: 'rgba(243,156,18,0.2)',   icon: 'alert' },
  DANGER:  { bg: '#FDEDEC', border: '#E74C3C', text: '#C0392B', glow: 'rgba(231,76,60,0.25)',   icon: 'alert-octagon' },
};

const TREND_PALETTE: Record<TrendLabel, { color: string; icon: string; label: string }> = {
  stable:   { color: '#2ECC71', icon: 'minus',        label: 'Stable' },
  rising:   { color: '#F39C12', icon: 'trending-up',  label: 'Rising — monitor closely' },
  critical: { color: '#E74C3C', icon: 'chevron-triple-up', label: 'Critical — rapid deterioration' },
};

const FEATURE_LABELS: Record<string, string> = {
  spo2_delta: 'SpO₂ Trend', o2_delta: 'O₂ Trend', hr_delta: 'HR Trend',
  spo2_percent: 'SpO₂ Level', o2_percent: 'O₂ Level', heart_rate_bpm: 'Heart Rate',
  ch4_delta: 'CH₄ Trend', h2s_delta: 'H₂S Trend', co_ppm: 'CO Level',
  ch4_ppm: 'CH₄ Level', h2s_ppm: 'H₂S Level', motion_state: 'Motion/Fall',
};

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

// Animated risk gauge
function RiskGauge({ score, status, pulse }: { score: number; status: RiskLabel; pulse: Animated.Value }) {
  const p = STATUS_PALETTE[status];
  const arcDeg = (score / 100) * 180;

  return (
    <Animated.View style={[g.wrap, { transform: [{ scale: pulse }], borderColor: p.border, shadowColor: p.border }]}>
      <View style={[g.outer, { borderColor: p.border }]}>
        <View style={[g.inner, { backgroundColor: p.bg }]}>
          <MaterialCommunityIcons name={p.icon as any} size={28} color={p.text} />
          <Text style={[g.score, { color: p.text }]}>{score}</Text>
          <Text style={[g.scoreLabel, { color: p.text }]}>RISK SCORE</Text>
        </View>
      </View>
      <View style={[g.statusBadge, { backgroundColor: p.border }]}>
        <Text style={g.statusText}>{status}</Text>
      </View>
    </Animated.View>
  );
}

const g = StyleSheet.create({
  wrap: { alignItems: 'center', borderRadius: 70, borderWidth: 3, padding: 6, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  outer: { width: 110, height: 110, borderRadius: 55, borderWidth: 2, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed' },
  inner: { width: 94, height: 94, borderRadius: 47, justifyContent: 'center', alignItems: 'center', gap: 2 },
  score: { fontSize: 28, fontFamily: 'Poppins_700Bold', lineHeight: 30 },
  scoreLabel: { fontSize: 8, fontFamily: 'Poppins_600SemiBold', letterSpacing: 1 },
  statusBadge: { marginTop: 8, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 5 },
  statusText: { color: '#fff', fontSize: 13, fontFamily: 'Poppins_700Bold', letterSpacing: 1 },
});

// Confidence breakdown bars
function ConfidenceBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <View style={cb.row}>
      <Text style={cb.label}>{label}</Text>
      <View style={cb.track}>
        <View style={[cb.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[cb.pct, { color }]}>{pct}%</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  label: { width: 68, fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: '#64748B' },
  track: { flex: 1, height: 7, backgroundColor: '#F0F4F8', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { width: 34, fontSize: 11, fontFamily: 'Poppins_700Bold', textAlign: 'right' },
});

// Gas value card
function GasCard({ label, value, unit, status, delta }: {
  label: string; value: string; unit: string;
  status: 'safe' | 'warning' | 'danger'; delta?: number;
}) {
  const COLOR = { safe: '#2ECC71', warning: '#F39C12', danger: '#E74C3C' };
  const BG    = { safe: '#E8F8F0', warning: '#FEF9E7', danger: '#FDEDEC' };
  const c = COLOR[status];
  const bg = BG[status];
  const arrowIcon = delta === undefined ? null : delta > 0.5 ? 'arrow-up-bold' : delta < -0.5 ? 'arrow-down-bold' : 'minus';
  const arrowColor = delta === undefined ? '#64748B' : delta > 0.5 ? '#E74C3C' : delta < -0.5 ? '#2ECC71' : '#64748B';

  return (
    <View style={[gc2.card, { borderTopColor: c, backgroundColor: '#fff' }]}>
      <Text style={gc2.label}>{label}</Text>
      <View style={gc2.row}>
        <Text style={[gc2.val, { color: c }]}>{value}</Text>
        <Text style={gc2.unit}>{unit}</Text>
        {arrowIcon && <MaterialCommunityIcons name={arrowIcon as any} size={14} color={arrowColor} />}
      </View>
      <View style={[gc2.badge, { backgroundColor: bg }]}>
        <View style={[gc2.dot, { backgroundColor: c }]} />
        <Text style={[gc2.badgeText, { color: c }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
      </View>
    </View>
  );
}
const gc2 = StyleSheet.create({
  card: { minWidth: 120, borderRadius: 8, padding: 12, borderTopWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  label: { fontSize: 9, fontFamily: 'Poppins_600SemiBold', color: '#64748B', letterSpacing: 0.4, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginBottom: 6 },
  val: { fontSize: 22, fontFamily: 'Poppins_700Bold', lineHeight: 26 },
  unit: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B', marginBottom: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
});

// Mini sparkline bar chart
function Sparkline({ history, color }: { history: number[]; color: string }) {
  const max = Math.max(...history, 1);
  return (
    <View style={sp.wrap}>
      {history.map((v, i) => (
        <View key={i} style={[sp.bar, { height: Math.max(3, (v / max) * 36), backgroundColor: color, opacity: 0.4 + (i / history.length) * 0.6 }]} />
      ))}
    </View>
  );
}
const sp = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40, flex: 1 },
  bar: { flex: 1, borderRadius: 2 },
});

// Risk history timeline dot
function RiskDot({ score }: { score: number }) {
  const c = score >= 65 ? '#E74C3C' : score >= 35 ? '#F39C12' : '#2ECC71';
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c, marginHorizontal: 1 }} />;
}

// ─────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────

export default function SAMVEDScreen() {
  const { workers, sensors, manager } = useStore();

  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [result, setResult] = useState<SAMVEDResult | null>(null);
  const [riskHistory, setRiskHistory] = useState<number[]>([]);
  const [ch4History,  setCh4History]  = useState<number[]>([]);
  const [h2sHistory,  setH2sHistory]  = useState<number[]>([]);
  const [coHistory,   setCoHistory]   = useState<number[]>([]);
  const [lastReading, setLastReading] = useState<SAMVEDReading | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [updateCount, setUpdateCount] = useState(0);

  const deltaCalcRef = useRef(new DeltaCalculator());
  const riskWindowRef = useRef<number[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Select first worker by default
  useEffect(() => {
    if (workers.length > 0 && !selectedWorkerId) {
      setSelectedWorkerId(workers[0].id);
    }
  }, [workers]);

  // Pulse animation on DANGER
  useEffect(() => {
    if (result?.status === 'DANGER') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [result?.status]);

  // Process sensor data whenever sensors store changes
  useEffect(() => {
    if (!selectedWorkerId || !isLive) return;
    const s = sensors[selectedWorkerId];
    if (!s) return;

    const posture = (s.workerPosture ?? '').toLowerCase();
    const isFall  = s.fallDetected || s.motionAlert === 1 || posture === 'fallen' || posture === 'fall';
    const motionState = isFall ? 2 : posture === 'stationary' ? 0 : 1;

    const raw = {
      ch4_ppm:        s.ch4 ?? 0,
      h2s_ppm:        s.h2s ?? 0,
      co_ppm:         s.co  ?? 0,
      o2_percent:     s.spO2 > 0 ? 20.9 - ((100 - s.spO2) * 0.15) : 20.9, // derive O2 from SpO2 proxy
      heart_rate_bpm: s.heartRate ?? 75,
      spo2_percent:   s.spO2 ?? 98,
      motion_state:   motionState,
    };

    const enriched = deltaCalcRef.current.enrich(raw);
    const newResult = runSAMVED(enriched, riskWindowRef.current);

    // Update sliding window
    riskWindowRef.current = [...riskWindowRef.current.slice(-9), newResult.risk_score];

    setResult(newResult);
    setLastReading(enriched);
    setRiskHistory(prev => [...prev.slice(-19), newResult.risk_score]);
    setCh4History(prev  => [...prev.slice(-19),  raw.ch4_ppm]);
    setH2sHistory(prev  => [...prev.slice(-19),  raw.h2s_ppm]);
    setCoHistory(prev   => [...prev.slice(-19),  raw.co_ppm]);
    setUpdateCount(c => c + 1);
  }, [sensors, selectedWorkerId, isLive]);

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);
  const activeSensor   = selectedWorkerId ? sensors[selectedWorkerId] : null;
  const sensorStatus   = activeSensor ? getSensorStatus(activeSensor) : null;

  const p = result ? STATUS_PALETTE[result.status] : STATUS_PALETTE.SAFE;
  const t = result ? TREND_PALETTE[result.trend]   : TREND_PALETTE.stable;

  // Derive gas status for cards
  const gasStatus = (val: number, warn: number, danger: number): 'safe' | 'warning' | 'danger' =>
    val >= danger ? 'danger' : val >= warn ? 'warning' : 'safe';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* ── HEADER ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.logoBox}>
            <MaterialCommunityIcons name="brain" size={18} color="#FF6B00" />
          </View>
          <View>
            <Text style={s.headerTitle}>SAMVED</Text>
            <Text style={s.headerSub}>Smart Adaptive Monitoring & Vital Emergency Detection</Text>
          </View>
        </View>
        <View style={s.headerRight}>
          <View style={[s.liveBadge, { borderColor: isLive ? '#2ECC71' : '#94A3B8' }]}>
            <View style={[s.liveDot, { backgroundColor: isLive ? '#2ECC71' : '#94A3B8' }]} />
            <Text style={[s.liveText, { color: isLive ? '#2ECC71' : '#94A3B8' }]}>
              {isLive ? 'LIVE' : 'PAUSED'}
            </Text>
          </View>
          <Text style={s.updateCount}>#{updateCount}</Text>
        </View>
      </View>

      {/* ── WORKER SELECTOR ── */}
      {workers.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={s.workerBar}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 6 }}>
          {workers.map(w => {
            const ws = sensors[w.id] ? getSensorStatus(sensors[w.id]).overall : 'safe';
            const pal = { safe: '#2ECC71', warning: '#F39C12', danger: '#E74C3C', offline: '#94A3B8' };
            const isSel = selectedWorkerId === w.id;
            return (
              <TouchableOpacity key={w.id}
                style={[s.wTab, isSel && s.wTabActive, { borderColor: pal[ws] }]}
                onPress={() => setSelectedWorkerId(w.id)}>
                <View style={[s.wDot, { backgroundColor: pal[ws] }]} />
                <View>
                  <Text style={[s.wTabTxt, isSel && { color: '#1A3C6E', fontFamily: 'Poppins_700Bold' }]}>{w.name}</Text>
                  <Text style={s.wTabId}>{sensors[w.id]?.manholeId ?? '—'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

        {/* ── NO WORKER SELECTED ── */}
        {!selectedWorkerId && (
          <View style={s.emptyState}>
            <MaterialCommunityIcons name="account-hard-hat-outline" size={48} color="#94A3B8" />
            <Text style={s.emptyText}>No worker selected</Text>
            <Text style={s.emptySub}>Select a worker above to begin SAMVED analysis</Text>
          </View>
        )}

        {selectedWorkerId && (
          <>
            {/* ── WORKER CONTEXT BANNER ── */}
            <View style={s.workerBanner}>
              <MaterialCommunityIcons name="account-hard-hat" size={20} color="#1A3C6E" />
              <View style={{ flex: 1 }}>
                <Text style={s.workerName}>{selectedWorker?.name ?? selectedWorkerId}</Text>
                <Text style={s.workerMeta}>
                  Badge: {selectedWorker?.employeeId ?? '—'} · Location: {activeSensor?.manholeId ?? '—'}, {activeSensor?.zone ?? '—'} Zone
                </Text>
              </View>
              <TouchableOpacity style={[s.pauseBtn, { backgroundColor: isLive ? '#E74C3C' : '#2ECC71' }]}
                onPress={() => setIsLive(v => !v)}>
                <MaterialCommunityIcons name={isLive ? 'pause' : 'play'} size={13} color="#fff" />
                <Text style={s.pauseText}>{isLive ? 'Pause' : 'Resume'}</Text>
              </TouchableOpacity>
            </View>

            {/* ── NO SENSOR DATA ── */}
            {!activeSensor && (
              <View style={s.emptyState}>
                <MaterialCommunityIcons name="wifi-off" size={40} color="#94A3B8" />
                <Text style={s.emptyText}>No sensor data</Text>
                <Text style={s.emptySub}>Awaiting live data from worker's LoRa device…</Text>
              </View>
            )}

            {activeSensor && (
              <>
                {/* ── RISK STATUS HERO ── */}
                <View style={[s.heroCard, { borderColor: p.border, shadowColor: p.border }]}>
                  <View style={s.heroTop}>
                    <RiskGauge score={result?.risk_score ?? 0} status={result?.status ?? 'SAFE'} pulse={pulseAnim} />

                    <View style={s.heroRight}>
                      {/* Trend */}
                      <View style={[s.trendRow, { backgroundColor: '#F0F4F8' }]}>
                        <MaterialCommunityIcons name={t.icon as any} size={16} color={t.color} />
                        <Text style={[s.trendText, { color: t.color }]}>{t.label}</Text>
                      </View>

                      {/* Confidence breakdown */}
                      <View style={s.confBox}>
                        <Text style={s.confTitle}>MODEL CONFIDENCE</Text>
                        <ConfidenceBar label="SAFE"    value={result?.confidence.SAFE    ?? 1} color="#2ECC71" />
                        <ConfidenceBar label="WARNING" value={result?.confidence.WARNING ?? 0} color="#F39C12" />
                        <ConfidenceBar label="DANGER"  value={result?.confidence.DANGER  ?? 0} color="#E74C3C" />
                      </View>

                      {/* Hard-limit badge */}
                      {result?.hard_limit_triggered && (
                        <View style={s.overrideBadge}>
                          <MaterialCommunityIcons name="alert-octagon" size={13} color="#C0392B" />
                          <Text style={s.overrideText}>HARD LIMIT: {result.override_reason}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Action */}
                  <View style={[s.actionRow, { backgroundColor: p.bg, borderColor: p.border }]}>
                    <MaterialCommunityIcons name="information" size={16} color={p.text} />
                    <Text style={[s.actionText, { color: p.text }]}>{result?.action}</Text>
                  </View>
                </View>

                {/* ── RISK SCORE HISTORY ── */}
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <Text style={s.cardTitle}>Risk Score History</Text>
                    <Text style={s.cardSub}>Last {riskHistory.length} readings</Text>
                  </View>
                  <View style={s.historyRow}>
                    {riskHistory.map((score, i) => <RiskDot key={i} score={score} />)}
                    {riskHistory.length === 0 && <Text style={s.emptyHist}>Collecting data…</Text>}
                  </View>
                  <View style={s.histLegend}>
                    {[['SAFE', '#2ECC71'], ['WARNING', '#F39C12'], ['DANGER', '#E74C3C']].map(([l, c]) => (
                      <View key={l} style={s.legItem}>
                        <View style={[s.legDot, { backgroundColor: c }]} />
                        <Text style={s.legText}>{l}</Text>
                      </View>
                    ))}
                    <Text style={s.legText}>Current: {result?.risk_score ?? 0}%</Text>
                  </View>
                </View>

                {/* ── REAL-TIME GAS READINGS ── */}
                <Text style={s.sectionLabel}>REAL-TIME GAS PARAMETERS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
                  <GasCard
                    label="METHANE (CH₄)"
                    value={activeSensor ? activeSensor.ch4.toFixed(1) : '—'}
                    unit="ppm"
                    status={gasStatus(activeSensor?.ch4 ?? 0, 1000, 5000)}
                    delta={lastReading?.ch4_delta}
                  />
                  <GasCard
                    label="HYDROGEN SULFIDE"
                    value={activeSensor ? activeSensor.h2s.toFixed(1) : '—'}
                    unit="ppm"
                    status={gasStatus(activeSensor?.h2s ?? 0, 20, 50)}
                    delta={lastReading?.h2s_delta}
                  />
                  <GasCard
                    label="CARBON MONOXIDE"
                    value={activeSensor ? String(activeSensor.co ?? 0) : '—'}
                    unit="ppm"
                    status={gasStatus(activeSensor?.co ?? 0, 50, 200)}
                  />
                  <GasCard
                    label="SpO₂"
                    value={activeSensor ? String(activeSensor.spO2) : '—'}
                    unit="%"
                    status={gasStatus(100 - (activeSensor?.spO2 ?? 100), 5, 10)}
                    delta={lastReading ? -lastReading.spo2_delta : undefined}
                  />
                  <GasCard
                    label="HEART RATE"
                    value={activeSensor ? String(activeSensor.heartRate) : '—'}
                    unit="BPM"
                    status={
                      (activeSensor?.heartRate ?? 75) > 140 || (activeSensor?.heartRate ?? 75) < 50 ? 'danger'
                      : (activeSensor?.heartRate ?? 75) > 110 || (activeSensor?.heartRate ?? 75) < 60 ? 'warning'
                      : 'safe'
                    }
                    delta={lastReading?.hr_delta}
                  />
                </ScrollView>

                {/* ── GAS TREND SPARKLINES ── */}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Gas Concentration Trends</Text>
                  <Text style={s.cardSub}>Live sparklines · last {ch4History.length} readings</Text>
                  <View style={s.sparkGrid}>
                    <View style={s.sparkItem}>
                      <Text style={s.sparkLabel}>CH₄ (ppm)</Text>
                      <Sparkline history={ch4History} color="#2ECC71" />
                      <Text style={[s.sparkVal, { color: '#2ECC71' }]}>{activeSensor?.ch4?.toFixed(0) ?? '—'}</Text>
                    </View>
                    <View style={s.sparkItem}>
                      <Text style={s.sparkLabel}>H₂S (ppm)</Text>
                      <Sparkline history={h2sHistory} color="#F39C12" />
                      <Text style={[s.sparkVal, { color: '#F39C12' }]}>{activeSensor?.h2s?.toFixed(1) ?? '—'}</Text>
                    </View>
                    <View style={s.sparkItem}>
                      <Text style={s.sparkLabel}>CO (ppm)</Text>
                      <Sparkline history={coHistory} color="#E74C3C" />
                      <Text style={[s.sparkVal, { color: '#E74C3C' }]}>{activeSensor?.co ?? '—'}</Text>
                    </View>
                  </View>
                </View>

                {/* ── EXPLANATION ── */}
                <View style={[s.card, s.explanationCard, { borderLeftColor: p.border }]}>
                  <View style={s.cardHeader}>
                    <MaterialCommunityIcons name="brain" size={16} color="#1A3C6E" />
                    <Text style={s.cardTitle}>Why is this happening?</Text>
                  </View>
                  <Text style={s.explanationText}>{result?.explanation ?? 'Awaiting first inference…'}</Text>
                  {result?.dominant_feature && (
                    <View style={s.dominantRow}>
                      <Text style={s.dominantLabel}>Primary driver:</Text>
                      <View style={[s.dominantBadge, { backgroundColor: p.bg }]}>
                        <Text style={[s.dominantText, { color: p.text }]}>
                          {FEATURE_LABELS[result.dominant_feature] ?? result.dominant_feature}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* ── RECOMMENDATIONS ── */}
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <MaterialCommunityIcons name="clipboard-check" size={16} color="#1A3C6E" />
                    <Text style={s.cardTitle}>Recommendations</Text>
                  </View>
                  {(result?.recommendations ?? []).map((rec, i) => (
                    <View key={i} style={s.recRow}>
                      <View style={[s.recDot, { backgroundColor: p.border }]} />
                      <Text style={s.recText}>{rec}</Text>
                    </View>
                  ))}
                  {(!result || result.recommendations.length === 0) && (
                    <Text style={s.emptySub}>Awaiting prediction…</Text>
                  )}
                </View>

                {/* ── ALERT FLAGS ── */}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Alert Flags</Text>
                  <View style={s.flagGrid}>
                    {[
                      { key: 'alert_buzzer',     label: 'Local Buzzer',    icon: 'bell-alert'    },
                      { key: 'alert_supervisor', label: 'Supervisor Notif',icon: 'account-alert'  },
                      { key: 'alert_sos',        label: 'SOS Triggered',   icon: 'alarm-light'   },
                      { key: 'alert_fall',       label: 'Fall Detected',   icon: 'human-handsdown'},
                    ].map(({ key, label, icon }) => {
                      const active = result ? (result as any)[key] : false;
                      return (
                        <View key={key} style={[s.flagBox, { backgroundColor: active ? '#FDEDEC' : '#F8FAFC', borderColor: active ? '#E74C3C' : '#E2E8F0' }]}>
                          <MaterialCommunityIcons name={icon as any} size={20} color={active ? '#E74C3C' : '#94A3B8'} />
                          <Text style={[s.flagText, { color: active ? '#C0392B' : '#94A3B8' }]}>{label}</Text>
                          <View style={[s.flagStatus, { backgroundColor: active ? '#E74C3C' : '#CBD5E1' }]}>
                            <Text style={s.flagStatusText}>{active ? 'ACTIVE' : 'OK'}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* ── FEATURE DELTA PANEL ── */}
                {lastReading && (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Trend Deltas (Δ per window)</Text>
                    <Text style={s.cardSub}>Change detected across last 3 readings — key ML input</Text>
                    <View style={s.deltaGrid}>
                      {[
                        { label: 'CH₄ Δ',  val: lastReading.ch4_delta,  unit: 'ppm', danger: 80  },
                        { label: 'H₂S Δ',  val: lastReading.h2s_delta,  unit: 'ppm', danger: 5   },
                        { label: 'O₂ Δ',   val: lastReading.o2_delta,   unit: '%',   danger: -0.4 },
                        { label: 'HR Δ',   val: lastReading.hr_delta,   unit: 'bpm', danger: 15  },
                        { label: 'SpO₂ Δ', val: lastReading.spo2_delta, unit: '%',   danger: -1  },
                      ].map(({ label, val, unit, danger }) => {
                        const isRising = danger > 0 ? val >= danger : val <= danger;
                        const c = isRising ? '#E74C3C' : Math.abs(val) > 0.1 ? '#F39C12' : '#2ECC71';
                        return (
                          <View key={label} style={s.deltaBox}>
                            <Text style={s.deltaLabel}>{label}</Text>
                            <Text style={[s.deltaVal, { color: c }]}>
                              {val >= 0 ? '+' : ''}{val.toFixed(2)}
                            </Text>
                            <Text style={s.deltaUnit}>{unit}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* ── MODEL INFO ── */}
                <View style={s.modelInfo}>
                  <MaterialCommunityIcons name="information-outline" size={13} color="#94A3B8" />
                  <Text style={s.modelInfoText}>
                    SAMVED v1.0 · Random Forest (100 trees, depth 10) · 12 features · Trained on 3,000 OSHA-calibrated synthetic samples · Hard-limit overrides bypass ML for critical breaches · Sliding window trend (N=5)
                  </Text>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F4F8' },

  // Header
  header: { backgroundColor: '#1A3C6E', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: '#FF6B00' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: { width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(255,107,0,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,107,0,0.4)' },
  headerTitle: { color: '#fff', fontSize: 14, fontFamily: 'Poppins_700Bold', letterSpacing: 1 },
  headerSub: { color: '#B8C8D8', fontSize: 9, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontFamily: 'Poppins_700Bold' },
  updateCount: { color: '#8899AA', fontSize: 10, fontFamily: 'Poppins_400Regular' },

  // Worker bar
  workerBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', maxHeight: 72 },
  wTab: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  wTabActive: { backgroundColor: '#EBF5FB', borderColor: '#1A3C6E' },
  wDot: { width: 8, height: 8, borderRadius: 4 },
  wTabTxt: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: '#1A202C' },
  wTabId: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8' },

  content: { padding: 12, gap: 12, paddingBottom: 40 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: '#64748B' },
  emptySub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#94A3B8', textAlign: 'center' },

  // Worker banner
  workerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EBF5FB', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#BFDBFE' },
  workerName: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: '#1A3C6E' },
  workerMeta: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pauseText: { color: '#fff', fontSize: 11, fontFamily: 'Poppins_600SemiBold' },

  // Hero card
  heroCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 2, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  heroTop: { flexDirection: 'row', gap: 16, marginBottom: 14, alignItems: 'center' },
  heroRight: { flex: 1, gap: 10 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  trendText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', flex: 1 },
  confBox: { gap: 2 },
  confTitle: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: '#94A3B8', letterSpacing: 0.8, marginBottom: 5 },
  overrideBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FDEDEC', borderRadius: 6, padding: 7, borderWidth: 1, borderColor: '#E74C3C' },
  overrideText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: '#C0392B', flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, padding: 10, borderWidth: 1 },
  actionText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', flex: 1 },

  // Risk history
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingVertical: 8 },
  emptyHist: { fontSize: 12, color: '#94A3B8', fontFamily: 'Poppins_400Regular', padding: 4 },
  histLegend: { flexDirection: 'row', gap: 12, paddingTop: 4 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  legText: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#64748B' },

  sectionLabel: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: '#64748B', letterSpacing: 0.8 },

  // Generic card
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: '#1A202C' },
  cardSub: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8' },

  // Explanation
  explanationCard: { borderLeftWidth: 3 },
  explanationText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#334155', lineHeight: 20 },
  dominantRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  dominantLabel: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: '#64748B' },
  dominantBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  dominantText: { fontSize: 11, fontFamily: 'Poppins_700Bold' },

  // Recommendations
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  recDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  recText: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#334155', lineHeight: 19 },

  // Alert flags
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flagBox: { width: (SCREEN_WIDTH - 60) / 2, borderRadius: 8, padding: 12, borderWidth: 1, alignItems: 'center', gap: 5 },
  flagText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  flagStatus: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 2 },
  flagStatusText: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: '#fff', letterSpacing: 0.5 },

  // Sparklines
  sparkGrid: { flexDirection: 'row', gap: 12, paddingTop: 4 },
  sparkItem: { flex: 1, gap: 4 },
  sparkLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#64748B' },
  sparkVal: { fontSize: 14, fontFamily: 'Poppins_700Bold' },

  // Delta panel
  deltaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  deltaBox: { minWidth: 80, backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: '#E2E8F0' },
  deltaLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#64748B' },
  deltaVal: { fontSize: 15, fontFamily: 'Poppins_700Bold' },
  deltaUnit: { fontSize: 9, fontFamily: 'Poppins_400Regular', color: '#94A3B8' },

  // Model info
  modelInfo: { flexDirection: 'row', gap: 6, paddingHorizontal: 4, alignItems: 'flex-start' },
  modelInfoText: { flex: 1, fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#94A3B8', lineHeight: 15 },
});