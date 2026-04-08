// app/(dashboard)/test.tsx
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, Switch, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ref, set } from 'firebase/database';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { rtdb, db } from '@/services/firebase';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';

const WORKERS = [
  { id: 'w001', name: 'Ramesh Patil', zone: 'north', manhole: 'MH-02', location: 'Ward 2 Main Line' },
  { id: 'w002', name: 'Suresh Jadhav', zone: 'east', manhole: 'MH-05', location: 'Hutatma Chowk' },
];

const PRESETS = [
  {
    label: '✅ All Safe',
    color: Colors.success,
    data: { ch4: 3.0, h2s: 1.5, heartRate: 75, spO2: 98, fallDetected: false, workerPosture: 'standing', sosTriggered: false, mode: 'monitoring' },
  },
  {
    label: '⚠️ Gas Warning',
    color: Colors.warning,
    data: { ch4: 18.0, h2s: 7.0, heartRate: 102, spO2: 93, fallDetected: false, workerPosture: 'standing', sosTriggered: false, mode: 'monitoring' },
  },
  {
    label: '🔴 Critical + Fall',
    color: Colors.danger,
    data: { ch4: 32.0, h2s: 15.0, heartRate: 130, spO2: 86, fallDetected: true, workerPosture: 'fallen', sosTriggered: true, mode: 'monitoring' },
  },
  {
    label: '🔍 Pre-monitoring',
    color: Colors.info,
    data: { ch4: 8.0, h2s: 3.0, heartRate: 0, spO2: 0, fallDetected: false, workerPosture: 'standing', sosTriggered: false, mode: 'premonitoring' },
  },
  {
    label: '💤 Worker Inactive',
    color: '#9B59B6',
    data: { ch4: 5.0, h2s: 2.0, heartRate: 58, spO2: 96, fallDetected: false, workerPosture: 'stationary', sosTriggered: false, mode: 'monitoring' },
  },
];

export default function TestScreen() {
  const [selectedWorker, setSelectedWorker] = useState(WORKERS[0]);
  const [pushing, setPushing] = useState(false);
  const [lastPushed, setLastPushed] = useState('');

  // Custom values
  const [ch4, setCh4] = useState('5.0');
  const [h2s, setH2s] = useState('2.0');
  const [heartRate, setHeartRate] = useState('75');
  const [spO2, setSpO2] = useState('98');
  const [fallDetected, setFallDetected] = useState(false);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [mode, setMode] = useState<'monitoring' | 'premonitoring'>('monitoring');

  const pushData = async (data: any) => {
    setPushing(true);
    try {
      await set(ref(rtdb, `sensors/${selectedWorker.id}`), {
        ...data,
        manholeId: selectedWorker.manhole,
        zone: selectedWorker.zone,
        locationLabel: selectedWorker.location,
        lastGpsLat: 17.6868,
        lastGpsLng: 75.9072,
        lastUpdated: Date.now(),
      });

      // Auto-create alert in Firestore if SOS or fall
      if (data.sosTriggered || data.fallDetected) {
        await addDoc(collection(db, 'alerts'), {
          workerId: selectedWorker.id,
          workerName: selectedWorker.name,
          type: data.fallDetected ? 'FALL' : 'SOS',
          value: data.fallDetected ? 'Fall detected' : 'SOS triggered',
          zone: selectedWorker.zone,
          manholeId: selectedWorker.manhole,
          timestamp: Timestamp.now(),
          resolved: false,
        });
      }

      if (data.ch4 > 25) {
        await addDoc(collection(db, 'alerts'), {
          workerId: selectedWorker.id,
          workerName: selectedWorker.name,
          type: 'CH4_CRITICAL',
          value: `${data.ch4}% LEL`,
          zone: selectedWorker.zone,
          manholeId: selectedWorker.manhole,
          timestamp: Timestamp.now(),
          resolved: false,
        });
      }

      if (data.h2s > 10) {
        await addDoc(collection(db, 'alerts'), {
          workerId: selectedWorker.id,
          workerName: selectedWorker.name,
          type: 'H2S_CRITICAL',
          value: `${data.h2s} PPM`,
          zone: selectedWorker.zone,
          manholeId: selectedWorker.manhole,
          timestamp: Timestamp.now(),
          resolved: false,
        });
      }

      setLastPushed(`${selectedWorker.name} — ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setPushing(false);
    }
  };

  const pushCustom = () => {
    pushData({
      ch4: parseFloat(ch4) || 0,
      h2s: parseFloat(h2s) || 0,
      heartRate: parseInt(heartRate) || 0,
      spO2: parseInt(spO2) || 0,
      fallDetected,
      workerPosture: fallDetected ? 'fallen' : 'standing',
      sosTriggered,
      mode,
    });
  };

  const pushAllSafe = async () => {
    setPushing(true);
    try {
      for (const w of WORKERS) {
        await set(ref(rtdb, `sensors/${w.id}`), {
          ch4: Math.random() * 8,
          h2s: Math.random() * 3,
          heartRate: 70 + Math.floor(Math.random() * 20),
          spO2: 96 + Math.floor(Math.random() * 3),
          fallDetected: false,
          workerPosture: 'standing',
          sosTriggered: false,
          mode: 'monitoring',
          manholeId: w.manhole,
          zone: w.zone,
          locationLabel: w.location,
          lastGpsLat: 17.6868,
          lastGpsLng: 75.9072,
          lastUpdated: Date.now(),
        });
      }
      setLastPushed(`All 5 workers set to SAFE — ${new Date().toLocaleTimeString()}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="test-tube" size={22} color={Colors.white} />
        <Text style={styles.headerTitle}>Test Data Injector</Text>
        <Text style={styles.headerSub}>Push dummy values to Firebase</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 }}>

        {/* Last pushed */}
        {lastPushed ? (
          <View style={styles.successBanner}>
            <MaterialCommunityIcons name="check-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>Pushed: {lastPushed}</Text>
          </View>
        ) : null}

        {/* Worker selector */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Select Worker</Text>
          {WORKERS.map(w => (
            <TouchableOpacity
              key={w.id}
              style={[styles.workerRow, selectedWorker.id === w.id && styles.workerRowActive]}
              onPress={() => setSelectedWorker(w)}
            >
              <MaterialCommunityIcons
                name="account-hard-hat"
                size={18}
                color={selectedWorker.id === w.id ? Colors.white : Colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.workerName, selectedWorker.id === w.id && { color: Colors.white }]}>
                  {w.name}
                </Text>
                <Text style={[styles.workerSub, selectedWorker.id === w.id && { color: 'rgba(255,255,255,0.7)' }]}>
                  {w.manhole} • {w.location}
                </Text>
              </View>
              {selectedWorker.id === w.id && (
                <MaterialCommunityIcons name="check" size={18} color={Colors.white} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick Presets */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. Quick Presets</Text>
          <Text style={styles.cardSub}>Tap to instantly push preset values for selected worker</Text>
          <View style={styles.presetsGrid}>
            {PRESETS.map(preset => (
              <TouchableOpacity
                key={preset.label}
                style={[styles.presetBtn, { borderColor: preset.color, backgroundColor: preset.color + '15' }]}
                onPress={() => pushData(preset.data)}
                disabled={pushing}
              >
                <Text style={[styles.presetText, { color: preset.color }]}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Custom Values */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>3. Custom Values</Text>
          <Text style={styles.cardSub}>Set exact sensor readings manually</Text>

          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>CH4 (% LEL)</Text>
              <View style={[styles.inputBox, { borderColor: parseFloat(ch4) > 25 ? Colors.danger : parseFloat(ch4) > 10 ? Colors.warning : Colors.border }]}>
                <TextInput style={styles.inputText} value={ch4} onChangeText={setCh4} keyboardType="numeric" />
              </View>
              <Text style={styles.thresholdHint}>Warn &gt;10 | Critical &gt;25</Text>
            </View>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>H2S (PPM)</Text>
              <View style={[styles.inputBox, { borderColor: parseFloat(h2s) > 10 ? Colors.danger : parseFloat(h2s) > 5 ? Colors.warning : Colors.border }]}>
                <TextInput style={styles.inputText} value={h2s} onChangeText={setH2s} keyboardType="numeric" />
              </View>
              <Text style={styles.thresholdHint}>Warn &gt;5 | Critical &gt;10</Text>
            </View>
          </View>

          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>Heart Rate (BPM)</Text>
              <View style={[styles.inputBox, { borderColor: parseInt(heartRate) > 120 || parseInt(heartRate) < 50 ? Colors.danger : parseInt(heartRate) > 100 ? Colors.warning : Colors.border }]}>
                <TextInput style={styles.inputText} value={heartRate} onChangeText={setHeartRate} keyboardType="numeric" />
              </View>
              <Text style={styles.thresholdHint}>Normal: 60–100</Text>
            </View>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>SpO2 (%)</Text>
              <View style={[styles.inputBox, { borderColor: parseInt(spO2) < 90 ? Colors.danger : parseInt(spO2) < 95 ? Colors.warning : Colors.border }]}>
                <TextInput style={styles.inputText} value={spO2} onChangeText={setSpO2} keyboardType="numeric" />
              </View>
              <Text style={styles.thresholdHint}>Normal: &gt;95%</Text>
            </View>
          </View>

          {/* Toggles */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Fall Detected</Text>
            <Switch
              value={fallDetected}
              onValueChange={setFallDetected}
              trackColor={{ false: Colors.border, true: Colors.danger }}
              thumbColor={fallDetected ? Colors.white : Colors.white}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>SOS Triggered</Text>
            <Switch
              value={sosTriggered}
              onValueChange={setSosTriggered}
              trackColor={{ false: Colors.border, true: Colors.danger }}
              thumbColor={Colors.white}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Mode</Text>
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'premonitoring' && styles.modeBtnActive]}
                onPress={() => setMode('premonitoring')}
              >
                <Text style={[styles.modeBtnText, mode === 'premonitoring' && styles.modeBtnTextActive]}>Pre-monitor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'monitoring' && styles.modeBtnActive]}
                onPress={() => setMode('monitoring')}
              >
                <Text style={[styles.modeBtnText, mode === 'monitoring' && styles.modeBtnTextActive]}>Worker Inside</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.pushBtn} onPress={pushCustom} disabled={pushing}>
            <MaterialCommunityIcons name="upload" size={18} color={Colors.white} />
            <Text style={styles.pushBtnText}>
              {pushing ? 'Pushing...' : `Push to ${selectedWorker.name}`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Push all workers safe */}
        <TouchableOpacity style={styles.allSafeBtn} onPress={pushAllSafe} disabled={pushing}>
          <MaterialCommunityIcons name="shield-check" size={20} color={Colors.success} />
          <Text style={styles.allSafeBtnText}>Reset All Workers to SAFE</Text>
        </TouchableOpacity>

        {/* Threshold Reference */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📋 Threshold Reference</Text>
          {[
            { sensor: 'CH4', safe: '< 10% LEL', warn: '10–25% LEL', danger: '> 25% LEL' },
            { sensor: 'H2S', safe: '< 5 PPM', warn: '5–10 PPM', danger: '> 10 PPM' },
            { sensor: 'Heart Rate', safe: '60–100 BPM', warn: '100–120 BPM', danger: '> 120 or < 50' },
            { sensor: 'SpO2', safe: '> 95%', warn: '90–95%', danger: '< 90%' },
          ].map(row => (
            <View key={row.sensor} style={styles.refRow}>
              <Text style={styles.refSensor}>{row.sensor}</Text>
              <Text style={[styles.refVal, { color: Colors.success }]}>{row.safe}</Text>
              <Text style={[styles.refVal, { color: Colors.warning }]}>{row.warn}</Text>
              <Text style={[styles.refVal, { color: Colors.danger }]}>{row.danger}</Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, padding: Spacing.md, gap: 2 },
  headerTitle: { color: Colors.white, fontSize: 18, fontWeight: 'bold' },
  headerSub: { color: '#B8C8D8', fontSize: 12 },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.successBg, borderRadius: BorderRadius.md, padding: Spacing.md },
  successText: { color: Colors.success, fontSize: 13, flex: 1 },
  card: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm, ...Shadows.sm },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  cardSub: { fontSize: 12, color: Colors.textSecondary, marginTop: -4 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  workerRowActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  workerName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  workerSub: { fontSize: 11, color: Colors.textSecondary },
  presetsGrid: { gap: 8 },
  presetBtn: { padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1.5, alignItems: 'center' },
  presetText: { fontSize: 14, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: Spacing.sm },
  inputHalf: { flex: 1, gap: 4 },
  inputLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  inputBox: { borderWidth: 2, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, backgroundColor: Colors.background },
  inputText: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, paddingVertical: 8 },
  thresholdHint: { fontSize: 10, color: Colors.textMuted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.border },
  toggleLabel: { fontSize: 14, color: Colors.textPrimary },
  modeToggle: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: 3 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.sm },
  modeBtnActive: { backgroundColor: Colors.primary },
  modeBtnText: { fontSize: 12, color: Colors.textSecondary },
  modeBtnTextActive: { color: Colors.white, fontWeight: '600' },
  pushBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 },
  pushBtnText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  allSafeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 2, borderColor: Colors.success, backgroundColor: Colors.successBg },
  allSafeBtnText: { color: Colors.success, fontSize: 15, fontWeight: '600' },
  refRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.border, gap: 4 },
  refSensor: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, width: 80 },
  refVal: { fontSize: 11, flex: 1, textAlign: 'center' },
});
