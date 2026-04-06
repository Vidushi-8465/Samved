import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';

type ModelStatus = 'SAFE' | 'WARNING' | 'DANGER';

type InferenceResponse = {
  status: ModelStatus;
  risk_score: number;
  trend: string;
  action: string;
  confidence?: {
    SAFE?: number;
    WARNING?: number;
    DANGER?: number;
  };
  hard_limit_triggered?: boolean;
  override_reason?: string | null;
};

type ModelInput = {
  ch4_ppm: string;
  h2s_ppm: string;
  co_ppm: string;
  o2_percent: string;
  heart_rate_bpm: string;
  spo2_percent: string;
  ch4_delta: string;
  h2s_delta: string;
  o2_delta: string;
  hr_delta: string;
  spo2_delta: string;
  motion_state: string;
};

const INFERENCE_URL =
  process.env.EXPO_PUBLIC_SAMVED_INFERENCE_URL?.trim() ||
  process.env.EXPO_PUBLIC_ML_INFERENCE_URL?.trim() ||
  (Platform.OS === 'android'
    ? 'http://10.0.2.2:5000/samved/predict'
    : 'http://localhost:5000/samved/predict');

const DEFAULT_INPUT: ModelInput = {
  ch4_ppm: '150',
  h2s_ppm: '1.2',
  co_ppm: '8',
  o2_percent: '20.7',
  heart_rate_bpm: '74',
  spo2_percent: '98',
  ch4_delta: '3',
  h2s_delta: '0.05',
  o2_delta: '0.02',
  hr_delta: '1',
  spo2_delta: '0',
  motion_state: '1',
};

const SAFE_SAMPLE: ModelInput = { ...DEFAULT_INPUT };

const WARNING_SAMPLE: ModelInput = {
  ch4_ppm: '1400',
  h2s_ppm: '10',
  co_ppm: '45',
  o2_percent: '19.2',
  heart_rate_bpm: '96',
  spo2_percent: '95',
  ch4_delta: '55',
  h2s_delta: '1.8',
  o2_delta: '-0.18',
  hr_delta: '5',
  spo2_delta: '-0.4',
  motion_state: '1',
};

const DANGER_SAMPLE: ModelInput = {
  ch4_ppm: '3200',
  h2s_ppm: '35',
  co_ppm: '150',
  o2_percent: '16.5',
  heart_rate_bpm: '140',
  spo2_percent: '88',
  ch4_delta: '180',
  h2s_delta: '12',
  o2_delta: '-1.1',
  hr_delta: '22',
  spo2_delta: '-2.5',
  motion_state: '2',
};

const FIELDS: Array<{ key: keyof ModelInput; label: string; unit?: string }> = [
  { key: 'ch4_ppm', label: 'CH4', unit: 'ppm' },
  { key: 'h2s_ppm', label: 'H2S', unit: 'ppm' },
  { key: 'co_ppm', label: 'CO', unit: 'ppm' },
  { key: 'o2_percent', label: 'O2', unit: '%' },
  { key: 'heart_rate_bpm', label: 'Heart Rate', unit: 'bpm' },
  { key: 'spo2_percent', label: 'SpO2', unit: '%' },
  { key: 'ch4_delta', label: 'CH4 Delta' },
  { key: 'h2s_delta', label: 'H2S Delta' },
  { key: 'o2_delta', label: 'O2 Delta' },
  { key: 'hr_delta', label: 'HR Delta' },
  { key: 'spo2_delta', label: 'SpO2 Delta' },
  { key: 'motion_state', label: 'Motion (0/1/2)' },
];

function getStatusColors(status: ModelStatus) {
  if (status === 'SAFE') return { fg: Colors.success, bg: Colors.successBg, icon: 'shield-check' as const };
  if (status === 'WARNING') return { fg: Colors.warning, bg: Colors.warningBg, icon: 'alert' as const };
  return { fg: Colors.danger, bg: Colors.dangerBg, icon: 'alert-octagon' as const };
}

function toNumericPayload(input: ModelInput): Record<string, number> {
  const payload: Record<string, number> = {};
  FIELDS.forEach((f) => {
    const raw = input[f.key].trim();
    const n = Number(raw);
    if (Number.isNaN(n)) {
      throw new Error(`Invalid value for ${f.label}`);
    }
    payload[f.key] = n;
  });
  return payload;
}

export default function SamvedScreen() {
  const { language } = useStore();
  const T = getText(language);

  const [input, setInput] = useState<ModelInput>(DEFAULT_INPUT);
  const [predicting, setPredicting] = useState(false);
  const [result, setResult] = useState<InferenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confidencePercent = useMemo(() => {
    if (!result?.confidence) return null;
    return {
      safe: Math.round((result.confidence.SAFE ?? 0) * 100),
      warning: Math.round((result.confidence.WARNING ?? 0) * 100),
      danger: Math.round((result.confidence.DANGER ?? 0) * 100),
    };
  }, [result]);

  const runPrediction = async () => {
    setPredicting(true);
    setError(null);

    try {
      const payload = toNumericPayload(input);
      const res = await fetch(INFERENCE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Inference API error (${res.status})`);
      }

      const data = (await res.json()) as InferenceResponse;
      if (!data?.status) {
        throw new Error('Invalid inference response');
      }
      setResult(data);
    } catch (e: any) {
      const msg = e?.message ?? 'Prediction failed';
      setError(msg);
      if (Platform.OS !== 'web') {
        Alert.alert('Prediction failed', msg);
      }
    } finally {
      setPredicting(false);
    }
  };

  const applySample = (sample: ModelInput) => {
    setInput(sample);
    setResult(null);
    setError(null);
  };

  const statusUi = result ? getStatusColors(result.status) : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard.samved}</Text>
          <Text style={styles.headerSub}>ML Safety Predictor (SAFE / WARNING / DANGER)</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollWrap}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick Samples</Text>
          <View style={styles.sampleRow}>
            <TouchableOpacity style={[styles.sampleBtn, { backgroundColor: Colors.successBg }]} onPress={() => applySample(SAFE_SAMPLE)}>
              <Text style={[styles.sampleBtnText, { color: Colors.success }]}>SAFE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sampleBtn, { backgroundColor: Colors.warningBg }]} onPress={() => applySample(WARNING_SAMPLE)}>
              <Text style={[styles.sampleBtnText, { color: Colors.warning }]}>WARNING</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sampleBtn, { backgroundColor: Colors.dangerBg }]} onPress={() => applySample(DANGER_SAMPLE)}>
              <Text style={[styles.sampleBtnText, { color: Colors.danger }]}>DANGER</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sensor Inputs</Text>
          <View style={styles.grid}>
            {FIELDS.map((f) => (
              <View key={f.key} style={styles.inputWrap}>
                <Text style={styles.inputLabel}>{f.label}{f.unit ? ` (${f.unit})` : ''}</Text>
                <TextInput
                  value={input[f.key]}
                  onChangeText={(value) => setInput((prev) => ({ ...prev, [f.key]: value }))}
                  keyboardType="numeric"
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            ))}
          </View>

          <TouchableOpacity style={[styles.predictBtn, predicting && { opacity: 0.7 }]} onPress={runPrediction} disabled={predicting}>
            {predicting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <MaterialCommunityIcons name="brain" size={18} color={Colors.white} />
            )}
            <Text style={styles.predictBtnText}>{predicting ? 'Predicting...' : 'Run SAMVED Prediction'}</Text>
          </TouchableOpacity>

          <Text style={styles.endpointNote}>Endpoint: {INFERENCE_URL}</Text>
        </View>

        {error && (
          <View style={[styles.card, { borderColor: Colors.danger, borderWidth: 1 }]}>
            <Text style={[styles.cardTitle, { color: Colors.danger }]}>Inference Error</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {result && statusUi && (
          <View style={[styles.card, { backgroundColor: statusUi.bg }]}>
            <View style={styles.resultHeader}>
              <MaterialCommunityIcons name={statusUi.icon} size={22} color={statusUi.fg} />
              <Text style={[styles.resultStatus, { color: statusUi.fg }]}>{result.status}</Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultKey}>Risk Score</Text>
              <Text style={[styles.resultValue, { color: statusUi.fg }]}>{result.risk_score}%</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultKey}>Trend</Text>
              <Text style={styles.resultValue}>{result.trend}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultKey}>Action</Text>
              <Text style={styles.resultValue}>{result.action}</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultKey}>Hard Limit Triggered</Text>
              <Text style={styles.resultValue}>{result.hard_limit_triggered ? 'Yes' : 'No'}</Text>
            </View>
            {!!result.override_reason && (
              <View style={styles.resultRow}>
                <Text style={styles.resultKey}>Override Reason</Text>
                <Text style={styles.resultValue}>{result.override_reason}</Text>
              </View>
            )}

            {confidencePercent && (
              <View style={styles.confidenceBox}>
                <Text style={styles.confidenceTitle}>Confidence</Text>
                <Text style={styles.confidenceText}>SAFE: {confidencePercent.safe}%</Text>
                <Text style={styles.confidenceText}>WARNING: {confidencePercent.warning}%</Text>
                <Text style={styles.confidenceText}>DANGER: {confidencePercent.danger}%</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub: { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  scrollWrap: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 90 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    ...Shadows.sm,
  },
  cardTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: 10 },
  sampleRow: { flexDirection: 'row', gap: 8 },
  sampleBtn: {
    flex: 1,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    paddingVertical: 10,
  },
  sampleBtnText: { fontSize: 12, fontFamily: 'Poppins_700Bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  inputWrap: { width: '48%' },
  inputLabel: { fontSize: 11, color: Colors.textSecondary, marginBottom: 4, fontFamily: 'Poppins_500Medium' },
  input: {
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
  },
  predictBtn: {
    marginTop: 14,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  predictBtnText: { color: Colors.white, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  endpointNote: { marginTop: 10, color: Colors.textMuted, fontSize: 10, fontFamily: 'Poppins_400Regular' },
  errorText: { color: Colors.danger, fontSize: 13, lineHeight: 20, fontFamily: 'Poppins_400Regular' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  resultStatus: { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  resultKey: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'Poppins_500Medium', flex: 1 },
  resultValue: { color: Colors.textPrimary, fontSize: 12, fontFamily: 'Poppins_600SemiBold', flex: 1, textAlign: 'right' },
  confidenceBox: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderRadius: BorderRadius.sm,
    padding: 10,
  },
  confidenceTitle: { fontSize: 12, color: Colors.textPrimary, fontFamily: 'Poppins_600SemiBold', marginBottom: 4 },
  confidenceText: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Poppins_500Medium' },
});
