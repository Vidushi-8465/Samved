import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { getSafetyStatus, getSensorStatus, SOLAPUR_ZONES, WorkerProfile, SensorData } from '@/services/sensorService';
import { db, rtdb } from '@/services/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { ref, set, onValue, off } from 'firebase/database';

// ─── Types ────────────────────────────────────────────────────────────────────

type SobrietyState = 'sober' | 'alcohol';

interface WorkerSobrietyInfo {
  state: SobrietyState;
  setAt: number;
}

// ─── Threshold Definitions ────────────────────────────────────────────────────

export const THRESHOLDS = {
  sober: {
    hrLow: 60,
    hrHigh: 100,
    spO2Min: 95,
    checkInMinutes: 15,
    buddyRequired: false,
    label: 'Standard monitoring',
  },
  alcohol: {
    hrLow: 60,
    hrHigh: 105,
    spO2Min: 94,
    checkInMinutes: 8,
    buddyRequired: true,
    label: 'Elevated vigilance',
  },
} as const;

// ─── Sobriety Badge ───────────────────────────────────────────────────────────

function SobrietyBadge({ state }: { state?: SobrietyState }) {
  if (!state) return null;
  const isSober = state === 'sober';
  return (
    <View style={[
      styles.sobrietyBadge,
      { backgroundColor: isSober ? Colors.successBg : Colors.warningBg },
    ]}>
      <MaterialCommunityIcons
        name={isSober ? 'shield-check' : 'alert-circle-outline'}
        size={12}
        color={isSober ? Colors.success : Colors.warning}
      />
      <Text style={[styles.sobrietyBadgeText, { color: isSober ? Colors.success : Colors.warning }]}>
        {isSober ? 'Sober' : 'Alcohol consumed'}
      </Text>
    </View>
  );
}

// ─── Threshold Info Panel ─────────────────────────────────────────────────────

function ThresholdPanel({ state }: { state: SobrietyState }) {
  const t = THRESHOLDS[state];
  const isSober = state === 'sober';
  const accent = isSober ? Colors.success : Colors.warning;
  const bg = isSober ? Colors.successBg : Colors.warningBg;

  return (
    <View style={[styles.thresholdPanel, { borderColor: accent, backgroundColor: bg }]}>
      <View style={styles.thresholdHeader}>
        <MaterialCommunityIcons
          name={isSober ? 'shield-check' : 'alert-circle-outline'}
          size={15}
          color={accent}
        />
        <Text style={[styles.thresholdTitle, { color: accent }]}>{t.label}</Text>
      </View>

      <View style={styles.thresholdGrid}>
        <View style={styles.thresholdItem}>
          <Text style={styles.thresholdItemLabel}>HR alert (low)</Text>
          <Text style={[styles.thresholdItemValue, { color: accent }]}>below {t.hrLow} bpm</Text>
        </View>
        <View style={styles.thresholdItem}>
          <Text style={styles.thresholdItemLabel}>HR alert (high)</Text>
          <Text style={[styles.thresholdItemValue, { color: accent }]}>above {t.hrHigh} bpm</Text>
        </View>
        <View style={styles.thresholdItem}>
          <Text style={styles.thresholdItemLabel}>SpO2 alert</Text>
          <Text style={[styles.thresholdItemValue, { color: accent }]}>below {t.spO2Min}%</Text>
        </View>
        <View style={styles.thresholdItem}>
          <Text style={styles.thresholdItemLabel}>Check-in</Text>
          <Text style={[styles.thresholdItemValue, { color: accent }]}>every {t.checkInMinutes} min</Text>
        </View>
      </View>

      {!isSober && (
        <View style={styles.thresholdNote}>
          <MaterialCommunityIcons name="information-outline" size={12} color={Colors.warning} />
          <Text style={styles.thresholdNoteText}>
            Buddy assignment mandatory. Supervisor is auto-notified at entry.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Sobriety Selector (FIXED) ────────────────────────────────────────────────

function SobrietySelector({
  value,
  onChange,
}: {
  value: SobrietyState;
  onChange: (s: SobrietyState) => void;
}) {
  const [pendingAlcohol, setPendingAlcohol] = useState(false);

  const handleAlcohol = () => {
    if (value === 'alcohol') return;
    setPendingAlcohol(true);
  };

  const confirmAlcohol = () => {
    onChange('alcohol');
    setPendingAlcohol(false);
  };

  const cancelAlcohol = () => {
    setPendingAlcohol(false);
  };

  return (
    <View>
      <View style={styles.sobrietySelector}>
        {/* Sober */}
        <TouchableOpacity
          style={[
            styles.sobrietyOption,
            value === 'sober' && styles.sobrietyOptionActiveSober,
          ]}
          onPress={() => {
            setPendingAlcohol(false);
            onChange('sober');
          }}
          activeOpacity={0.8}
        >
          {value === 'sober' && (
            <View style={styles.sobrietyCheck}>
              <MaterialCommunityIcons name="check-circle" size={15} color={Colors.success} />
            </View>
          )}
          <MaterialCommunityIcons
            name="shield-check"
            size={22}
            color={value === 'sober' ? Colors.success : Colors.textMuted}
          />
          <Text style={[
            styles.sobrietyOptionTitle,
            { color: value === 'sober' ? Colors.success : Colors.textPrimary },
          ]}>
            Sober
          </Text>
          <Text style={styles.sobrietyOptionSub}>Standard thresholds</Text>
        </TouchableOpacity>

        {/* Alcohol */}
        <TouchableOpacity
          style={[
            styles.sobrietyOption,
            value === 'alcohol' && styles.sobrietyOptionActiveAlcohol,
            pendingAlcohol && { borderColor: Colors.warning, borderWidth: 2 },
          ]}
          onPress={handleAlcohol}
          activeOpacity={0.8}
        >
          {value === 'alcohol' && (
            <View style={styles.sobrietyCheck}>
              <MaterialCommunityIcons name="check-circle" size={15} color={Colors.warning} />
            </View>
          )}
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={22}
            color={value === 'alcohol' || pendingAlcohol ? Colors.warning : Colors.textMuted}
          />
          <Text style={[
            styles.sobrietyOptionTitle,
            { color: value === 'alcohol' || pendingAlcohol ? Colors.warning : Colors.textPrimary },
          ]}>
            Alcohol consumed
          </Text>
          <Text style={styles.sobrietyOptionSub}>Tighter thresholds + buddy</Text>
        </TouchableOpacity>
      </View>

      {/* Inline confirmation — no Alert.alert */}
      {pendingAlcohol && (
        <View style={styles.alcoholConfirmBox}>
          <MaterialCommunityIcons name="information-outline" size={16} color={Colors.warning} />
          <Text style={styles.alcoholConfirmText}>
            This activates tighter safety thresholds and assigns a buddy.
            Confidential — used only for worker safety.
          </Text>
          <View style={styles.alcoholConfirmActions}>
            <TouchableOpacity style={styles.alcoholCancelBtn} onPress={cancelAlcohol}>
              <Text style={styles.alcoholCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.alcoholConfirmBtn} onPress={confirmAlcohol}>
              <Text style={styles.alcoholConfirmBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── STATUS helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS = { safe: Colors.success, warning: Colors.warning, danger: Colors.danger, offline: Colors.textMuted };
const STATUS_BG = { safe: Colors.successBg, warning: Colors.warningBg, danger: Colors.dangerBg, offline: Colors.border };

const SHIFT_OPTIONS: WorkerProfile['shift'][] = ['morning', 'afternoon', 'night'];

const createEmptyForm = () => ({
  name: '',
  employeeId: '',
  phone: '',
  bloodGroup: '',
  emergencyContact: '',
  zone: SOLAPUR_ZONES[0]?.id ?? 'north',
  shift: 'morning' as WorkerProfile['shift'],
  sobrietyState: 'sober' as SobrietyState,
});

// ─── Worker Detail Modal ──────────────────────────────────────────────────────

function WorkerDetailModal({
  worker, sensor, onClose, sobrietyMap, onSobrietyChange,
}: {
  worker: WorkerProfile;
  sensor?: SensorData;
  onClose: () => void;
  sobrietyMap: Record<string, WorkerSobrietyInfo>;
  onSobrietyChange: (workerId: string, state: SobrietyState) => void;
}) {
  const status = sensor ? getSafetyStatus(sensor) : 'safe';
  const sensorStatus = sensor ? getSensorStatus(sensor) : null;
  const sobriety = sobrietyMap[worker.id];
  const currentState: SobrietyState = sobriety?.state ?? 'sober';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={[styles.modalHeader, { backgroundColor: STATUS_COLORS[status] || Colors.success }]}>
            <View style={styles.modalAvatar}>
              <MaterialCommunityIcons name="account-hard-hat" size={32} color={Colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalName}>{worker.name}</Text>
              <Text style={styles.modalId}>ID: {worker.employeeId}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <MaterialCommunityIcons name="close" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 520 }}>
            <View style={styles.modalBody}>
              {/* Worker info */}
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="map-marker" size={16} color={Colors.textSecondary} />
                <Text style={styles.infoText}>Zone: {SOLAPUR_ZONES.find(z => z.id === worker.zone)?.name || worker.zone}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="clock-outline" size={16} color={Colors.textSecondary} />
                <Text style={styles.infoText}>Shift: {worker.shift}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="phone" size={16} color={Colors.textSecondary} />
                <Text style={styles.infoText}>{worker.phone}</Text>
              </View>

              {/* PRE-ENTRY STATE */}
              <View style={styles.sensorDivider}>
                <Text style={styles.sensorDividerText}>PRE-ENTRY STATE</Text>
              </View>

              <SobrietySelector
                value={currentState}
                onChange={(s) => onSobrietyChange(worker.id, s)}
              />
              <ThresholdPanel state={currentState} />

              {sobriety?.setAt ? (
                <Text style={styles.sobrietyTimestamp}>
                  State recorded at{' '}
                  {new Date(sobriety.setAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              ) : null}

              {sensor ? (
                <>
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={Colors.textSecondary} />
                    <Text style={styles.infoText}>{sensor.manholeId} — {sensor.locationLabel}</Text>
                  </View>

                  <View style={styles.sensorDivider}>
                    <Text style={styles.sensorDividerText}>LIVE SENSOR DATA</Text>
                  </View>

                  {/* HR + SpO2 */}
                  <View style={styles.vitalsRow}>
                    <View style={[styles.vitalBox, { borderColor: STATUS_COLORS[sensorStatus?.heartRate || 'safe'] }]}>
                      <MaterialCommunityIcons name="heart-pulse" size={22} color={STATUS_COLORS[sensorStatus?.heartRate || 'safe']} />
                      <Text style={[styles.vitalValue, { color: STATUS_COLORS[sensorStatus?.heartRate || 'safe'] }]}>
                        {sensor.heartRate > 0 ? sensor.heartRate : '—'}
                      </Text>
                      <Text style={styles.vitalUnit}>BPM</Text>
                      <Text style={styles.vitalThresholdHint}>
                        limit: {THRESHOLDS[currentState].hrLow}–{THRESHOLDS[currentState].hrHigh}
                      </Text>
                    </View>
                    <View style={[styles.vitalBox, { borderColor: STATUS_COLORS[sensorStatus?.spO2 || 'safe'] }]}>
                      <MaterialCommunityIcons name="lungs" size={22} color={STATUS_COLORS[sensorStatus?.spO2 || 'safe']} />
                      <Text style={[styles.vitalValue, { color: STATUS_COLORS[sensorStatus?.spO2 || 'safe'] }]}>
                        {sensor.spO2 > 0 ? sensor.spO2 : '—'}
                      </Text>
                      <Text style={styles.vitalUnit}>SpO2 %</Text>
                      <Text style={styles.vitalThresholdHint}>
                        min: {THRESHOLDS[currentState].spO2Min}%
                      </Text>
                    </View>
                  </View>

                  {/* Gas sensors */}
                  <View style={styles.sensorsGrid}>
                    <View style={styles.sensorBox}>
                      <MaterialCommunityIcons name="fire" size={20} color={STATUS_COLORS[sensorStatus?.ch4 || 'safe']} />
                      <Text style={[styles.sensorValue, { color: STATUS_COLORS[sensorStatus?.ch4 || 'safe'] }]}>
                        {sensor.gasWarming ? '...' : sensor.ch4}
                      </Text>
                      <Text style={styles.sensorLabel}>CH4 PPM</Text>
                    </View>
                    <View style={styles.sensorBox}>
                      <MaterialCommunityIcons name="biohazard" size={20} color={STATUS_COLORS[sensorStatus?.h2s || 'safe']} />
                      <Text style={[styles.sensorValue, { color: STATUS_COLORS[sensorStatus?.h2s || 'safe'] }]}>
                        {sensor.gasWarming ? '...' : sensor.h2s}
                      </Text>
                      <Text style={styles.sensorLabel}>CO PPM</Text>
                    </View>
                    <View style={styles.sensorBox}>
                      <MaterialCommunityIcons name="wifi" size={20} color={sensor.rssi > -80 ? Colors.success : Colors.warning} />
                      <Text style={[styles.sensorValue, { color: sensor.rssi > -80 ? Colors.success : Colors.warning }]}>
                        {sensor.rssi} dBm
                      </Text>
                      <Text style={styles.sensorLabel}>LoRa Signal</Text>
                    </View>
                    <View style={styles.sensorBox}>
                      <MaterialCommunityIcons name="map-marker" size={20} color={Colors.primary} />
                      <Text style={[styles.sensorValue, { color: Colors.primary, fontSize: 11 }]}>
                        {sensor.lastGpsLat?.toFixed(4)}, {sensor.lastGpsLng?.toFixed(4)}
                      </Text>
                      <Text style={styles.sensorLabel}>Last GPS</Text>
                    </View>
                  </View>

                  {/* Posture + SOS */}
                  <View style={[styles.postureBox, {
                    backgroundColor: sensor.fallDetected ? Colors.dangerBg : Colors.successBg,
                    borderColor: sensor.fallDetected ? Colors.danger : Colors.success,
                  }]}>
                    <MaterialCommunityIcons
                      name={sensor.fallDetected ? 'human-handsdown' : 'human-greeting'}
                      size={20}
                      color={sensor.fallDetected ? Colors.danger : Colors.success}
                    />
                    <Text style={[styles.postureText, { color: sensor.fallDetected ? Colors.danger : Colors.success }]}>
                      {sensor.fallDetected ? 'FALL DETECTED' : `Posture: ${sensor.workerPosture || 'standing'}`}
                    </Text>
                  </View>

                  {sensor.sosTriggered && (
                    <View style={styles.sosActive}>
                      <MaterialCommunityIcons name="alarm-light" size={20} color={Colors.white} />
                      <Text style={styles.sosActiveText}>⚠️ SOS ALERT ACTIVE</Text>
                    </View>
                  )}

                  {/* Mode badge */}
                  <View style={[styles.modeBadge, {
                    backgroundColor: sensor.mode === 'premonitoring' ? Colors.infoBg : Colors.warningBg,
                  }]}>
                    <Text style={[styles.modeText, { color: sensor.mode === 'premonitoring' ? Colors.info : Colors.warning }]}>
                      {sensor.mode === 'premonitoring' ? '🔍 Pre-monitoring Mode' : '👷 Worker Inside — Monitoring'}
                    </Text>
                  </View>                
                </>
              ) : (
                <View style={styles.noSensor}>
                  <MaterialCommunityIcons name="wifi-off" size={32} color={Colors.textMuted} />
                  <Text style={styles.noSensorText}>No live sensor data</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WorkersScreen() {
  const { language, workers, sensors, manager, setWorkers } = useStore();
  const T = getText(language);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState<WorkerProfile | null>(null);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [savingWorker, setSavingWorker] = useState(false);
  const [form, setForm] = useState(createEmptyForm());
  const [sobrietyMap, setSobrietyMap] = useState<Record<string, WorkerSobrietyInfo>>({});

  // ── Load sobriety from Firebase ───────────────────────────────────────────
  useEffect(() => {
    if (!workers.length) return;
    const unsubscribers = workers.map(worker => {
      const sobrietyRef = ref(rtdb, `workers/${worker.id}/sobriety`);
      const unsub = onValue(sobrietyRef, snapshot => {
        const data = snapshot.val();
        if (data) setSobrietyMap(prev => ({ ...prev, [worker.id]: data as WorkerSobrietyInfo }));
      });
      return unsub;
    });
    return () => unsubscribers.forEach(u => u());
  }, [workers]);

  // ── Update sobriety & push thresholds to Firebase ────────────────────────
  const handleSobrietyChange = async (workerId: string, state: SobrietyState) => {
    const info: WorkerSobrietyInfo = { state, setAt: Date.now() };
    setSobrietyMap(prev => ({ ...prev, [workerId]: info }));
    try {
      await set(ref(rtdb, `workers/${workerId}/sobriety`), info);
      await set(ref(rtdb, `workers/${workerId}/thresholds`), THRESHOLDS[state]);
    } catch (error) {
      console.error('Failed to save sobriety state:', error);
      Alert.alert('Error', 'Could not save pre-entry state. Please try again.');
    }
  };

  const filtered = workers.filter(w => {
    const matchSearch =
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.employeeId.toLowerCase().includes(search.toLowerCase());
    const sensor = sensors[w.id];
    const status = sensor ? getSafetyStatus(sensor) : 'safe';
    const matchStatus = filterStatus === 'all' || status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleAddWorker = async () => {
    const trimmedName = form.name.trim();
    const trimmedEmployeeId = form.employeeId.trim();
    const trimmedPhone = form.phone.trim();
    const trimmedBloodGroup = form.bloodGroup.trim();
    const trimmedEmergencyContact = form.emergencyContact.trim();

    if (!trimmedName || !trimmedEmployeeId || !trimmedPhone || !trimmedBloodGroup || !trimmedEmergencyContact) {
      Alert.alert('Missing details', 'Please fill in all required worker fields.');
      return;
    }
    if (workers.some(w => w.employeeId.toLowerCase() === trimmedEmployeeId.toLowerCase())) {
      Alert.alert('Duplicate worker', 'A worker with this Employee ID already exists.');
      return;
    }
    if (!manager) {
      Alert.alert('Session expired', 'Please log in again and retry.');
      return;
    }

    setSavingWorker(true);
    try {
      const workerId = doc(collection(db, 'workers')).id;
      const newWorker: WorkerProfile = {
        id: workerId,
        name: trimmedName,
        nameMarathi: trimmedName,
        employeeId: trimmedEmployeeId,
        zone: form.zone,
        shift: form.shift,
        phone: trimmedPhone,
        managerId: manager.uid,
        bloodGroup: trimmedBloodGroup,
        emergencyContact: trimmedEmergencyContact,
      };

      await setDoc(doc(db, 'workers', workerId), newWorker);

      const sobrietyInfo: WorkerSobrietyInfo = { state: form.sobrietyState, setAt: Date.now() };
      await set(ref(rtdb, `workers/${workerId}/sobriety`), sobrietyInfo);
      await set(ref(rtdb, `workers/${workerId}/thresholds`), THRESHOLDS[form.sobrietyState]);

      setSobrietyMap(prev => ({ ...prev, [workerId]: sobrietyInfo }));
      setWorkers([...workers, newWorker]);
      setForm(createEmptyForm());
      setShowAddWorker(false);
      Alert.alert('Worker added', `${newWorker.name} was added successfully.`);
    } catch (error: any) {
      Alert.alert('Could not add worker', error?.message || 'Please try again.');
    } finally {
      setSavingWorker(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard.workers}</Text>
          <Text style={styles.headerCount}>{filtered.length} / {workers.length}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddWorker(true)}>
          <MaterialCommunityIcons name="account-plus" size={18} color={Colors.white} />
          <Text style={styles.addBtnText}>{T.dashboard.addWorker}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={20} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={T.common.search}
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialCommunityIcons name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filters}>
        {[
          { key: 'all', label: 'All' },
          { key: 'safe', label: '🟢 Safe' },
          { key: 'warning', label: '🟡 Warning' },
          { key: 'danger', label: '🔴 Danger' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filterStatus === f.key && styles.filterChipActive]}
            onPress={() => setFilterStatus(f.key)}
          >
            <Text style={[styles.filterChipText, filterStatus === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="account-search" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No workers found</Text>
          </View>
        }
        renderItem={({ item }) => {
          const sensor = sensors[item.id];
          const status = sensor ? getSafetyStatus(sensor) : 'safe';
          const zone = SOLAPUR_ZONES.find(z => z.id === item.zone);
          const sensorStatus = sensor ? getSensorStatus(sensor) : null;
          const sobriety = sobrietyMap[item.id];

          return (
            <TouchableOpacity style={styles.workerCard} onPress={() => setSelectedWorker(item)}>
              <View style={[styles.workerAvatar, { backgroundColor: STATUS_BG[status] || Colors.border }]}>
                <MaterialCommunityIcons name="account-hard-hat" size={24} color={STATUS_COLORS[status] || Colors.textMuted} />
              </View>

              <View style={styles.workerInfo}>
                <Text style={styles.workerName}>{item.name}</Text>
                <Text style={styles.workerMeta}>{item.employeeId} • {item.shift} shift</Text>
                <View style={styles.zoneBadge}>
                  <View style={[styles.zoneColorDot, { backgroundColor: zone?.color || Colors.textMuted }]} />
                  <Text style={styles.zoneText}>{zone?.name || item.zone}</Text>
                  {sensor?.manholeId ? <Text style={styles.manholeText}>• {sensor.manholeId}</Text> : null}
                </View>
                <SobrietyBadge state={sobriety?.state} />
              </View>

              <View style={styles.workerRight}>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[status] || Colors.border }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[status] || Colors.textMuted }]}>
                    {status.toUpperCase()}
                  </Text>
                </View>
                {sensor && sensor.heartRate > 0 && (
                  <View style={styles.vitalMini}>
                    <MaterialCommunityIcons name="heart-pulse" size={12} color={STATUS_COLORS[sensorStatus?.heartRate || 'safe']} />
                    <Text style={[styles.vitalMiniText, { color: STATUS_COLORS[sensorStatus?.heartRate || 'safe'] }]}>
                      {sensor.heartRate}
                    </Text>
                  </View>
                )}
                {sensor && sensor.spO2 > 0 && (
                  <View style={styles.vitalMini}>
                    <MaterialCommunityIcons name="lungs" size={12} color={STATUS_COLORS[sensorStatus?.spO2 || 'safe']} />
                    <Text style={[styles.vitalMiniText, { color: STATUS_COLORS[sensorStatus?.spO2 || 'safe'] }]}>
                      {sensor.spO2}%
                    </Text>
                  </View>
                )}
                <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selectedWorker && (
        <WorkerDetailModal
          worker={selectedWorker}
          sensor={sensors[selectedWorker.id]}
          onClose={() => setSelectedWorker(null)}
          sobrietyMap={sobrietyMap}
          onSobrietyChange={handleSobrietyChange}
        />
      )}

      {/* Add Worker Modal */}
      <Modal visible={showAddWorker} transparent animationType="slide" onRequestClose={() => setShowAddWorker(false)}>
        <View style={styles.formOverlay}>
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <View>
                <Text style={styles.formTitle}>{T.dashboard.addWorker}</Text>
                <Text style={styles.formSub}>Enter the required worker details</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAddWorker(false)}>
                <MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput style={styles.fieldInput} value={form.name} onChangeText={v => setForm(p => ({ ...p, name: v }))} placeholder="Worker name" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Employee ID</Text>
                <TextInput style={styles.fieldInput} value={form.employeeId} onChangeText={v => setForm(p => ({ ...p, employeeId: v }))} placeholder="SMC-2026-001" autoCapitalize="characters" />
              </View>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Phone</Text>
                  <TextInput style={styles.fieldInput} value={form.phone} onChangeText={v => setForm(p => ({ ...p, phone: v }))} placeholder="Mobile number" keyboardType="phone-pad" />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Blood Group</Text>
                  <TextInput style={styles.fieldInput} value={form.bloodGroup} onChangeText={v => setForm(p => ({ ...p, bloodGroup: v }))} placeholder="B+" autoCapitalize="characters" />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Emergency Contact</Text>
                <TextInput style={styles.fieldInput} value={form.emergencyContact} onChangeText={v => setForm(p => ({ ...p, emergencyContact: v }))} placeholder="Emergency phone" keyboardType="phone-pad" />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Zone</Text>
                <View style={styles.chipWrap}>
                  {SOLAPUR_ZONES.map(zone => (
                    <TouchableOpacity
                      key={zone.id}
                      style={[styles.chip, form.zone === zone.id && styles.chipActive]}
                      onPress={() => setForm(p => ({ ...p, zone: zone.id }))}
                    >
                      <Text style={[styles.chipText, form.zone === zone.id && styles.chipTextActive]}>{zone.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Shift</Text>
                <View style={styles.chipWrap}>
                  {SHIFT_OPTIONS.map(shift => (
                    <TouchableOpacity
                      key={shift}
                      style={[styles.chip, form.shift === shift && styles.chipActive]}
                      onPress={() => setForm(p => ({ ...p, shift }))}
                    >
                      <Text style={[styles.chipText, form.shift === shift && styles.chipTextActive]}>{shift}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Pre-entry state</Text>
                <Text style={styles.fieldSubLabel}>
                  Selecting "Alcohol consumed" tightens safety thresholds and auto-assigns a buddy.
                  This is confidential — used only for safety.
                </Text>
                <SobrietySelector
                  value={form.sobrietyState}
                  onChange={s => setForm(p => ({ ...p, sobrietyState: s }))}
                />
                <ThresholdPanel state={form.sobrietyState} />
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddWorker(false)} disabled={savingWorker}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddWorker} disabled={savingWorker}>
                {savingWorker
                  ? <ActivityIndicator color={Colors.white} />
                  : <Text style={styles.saveBtnText}>Save Worker</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerCount: { color: '#B8C8D8', fontSize: 13, fontFamily: 'Poppins_400Regular' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: BorderRadius.full },
  addBtnText: { color: Colors.white, fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, margin: Spacing.md, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, gap: 8, ...Shadows.sm },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary },
  filters: { flexDirection: 'row', paddingHorizontal: Spacing.md, gap: 8, marginBottom: Spacing.sm },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.white },
  workerCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, ...Shadows.sm },
  workerAvatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  workerInfo: { flex: 1, gap: 2 },
  workerName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  workerMeta: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  zoneBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  zoneColorDot: { width: 8, height: 8, borderRadius: 4 },
  zoneText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  manholeText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textMuted },
  workerRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: 10, fontFamily: 'Poppins_700Bold' },
  vitalMini: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  vitalMiniText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { color: Colors.textSecondary, fontFamily: 'Poppins_400Regular' },

  // Sobriety badge
  sobrietyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: BorderRadius.full, marginTop: 3, alignSelf: 'flex-start' },
  sobrietyBadgeText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // Sobriety selector
  sobrietySelector: { flexDirection: 'row', gap: 10, marginTop: 4 },
  sobrietyOption: { flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: 12, alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceSecondary, position: 'relative' },
  sobrietyOptionActiveSober: { borderColor: Colors.success, backgroundColor: Colors.successBg },
  sobrietyOptionActiveAlcohol: { borderColor: Colors.warning, backgroundColor: Colors.warningBg },
  sobrietyOptionTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  sobrietyOptionSub: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: Colors.textMuted, textAlign: 'center' },
  sobrietyCheck: { position: 'absolute', top: 6, right: 6 },

  // Alcohol confirm box
  alcoholConfirmBox: { marginTop: 10, borderWidth: 1, borderColor: Colors.warning, backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md, padding: 12, gap: 8 },
  alcoholConfirmText: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, lineHeight: 18 },
  alcoholConfirmActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  alcoholCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border },
  alcoholCancelText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary },
  alcoholConfirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: BorderRadius.md, backgroundColor: Colors.warning },
  alcoholConfirmBtnText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.white },

  // Threshold panel
  thresholdPanel: { borderWidth: 1, borderRadius: BorderRadius.md, padding: 12, marginTop: 10, gap: 8 },
  thresholdHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thresholdTitle: { fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  thresholdGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thresholdItem: { width: '47%', gap: 2 },
  thresholdItemLabel: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: Colors.textMuted },
  thresholdItemValue: { fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  thresholdNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: Colors.border },
  thresholdNoteText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },

  // Sobriety timestamp
  sobrietyTimestamp: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textMuted, textAlign: 'right', marginTop: 2 },

  // Vitals threshold hint
  vitalThresholdHint: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: Colors.textMuted, textAlign: 'center' },

  // Sub label in form
  fieldSubLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, marginBottom: 2 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  modalAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  modalName: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  modalId: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontFamily: 'Poppins_400Regular' },
  modalClose: { padding: 4 },
  modalBody: { padding: Spacing.lg, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary },
  sensorDivider: { paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.sm },
  sensorDividerText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary, letterSpacing: 1 },
  vitalsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  vitalBox: { flex: 1, alignItems: 'center', padding: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.background, borderWidth: 1.5, gap: 4 },
  vitalValue: { fontSize: 28, fontFamily: 'Poppins_700Bold' },
  vitalUnit: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  sensorsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  sensorBox: { width: '47%', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  sensorValue: { fontSize: 16, fontFamily: 'Poppins_700Bold' },
  sensorLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  postureBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1 },
  postureText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  sosActive: { backgroundColor: Colors.danger, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sosActiveText: { color: Colors.white, fontSize: 15, fontFamily: 'Poppins_700Bold' },
  modeBadge: { borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
  modeText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  noSensor: { alignItems: 'center', padding: Spacing.xl, gap: 8 },
  noSensorText: { color: Colors.textMuted, fontFamily: 'Poppins_400Regular' },
  formOverlay: { flex: 1, backgroundColor: 'rgba(10, 31, 61, 0.55)', justifyContent: 'center', padding: Spacing.md },
  formCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.lg, padding: Spacing.md, maxHeight: '92%', ...Shadows.lg },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  formTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: Colors.textPrimary },
  formSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, marginTop: 4 },
  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldHalf: { flex: 1, gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  fieldInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary, backgroundColor: Colors.surfaceSecondary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.surfaceSecondary },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  chipTextActive: { color: Colors.white },
  formActions: { flexDirection: 'row', gap: 10, marginTop: Spacing.md },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  saveBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: BorderRadius.md, backgroundColor: Colors.accent },
  saveBtnText: { color: Colors.white, fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  buzzerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.primary, justifyContent: 'center', alignItems: 'center', ...Shadows.sm },
  buzzerBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modalBuzzerSection: { marginTop: Spacing.lg, paddingTop: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border },
  modalBuzzerLabel: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: Spacing.sm },
  modalBuzzerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceSecondary, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, ...Shadows.md },
  modalBuzzerBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modalBuzzerBtnText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: Colors.primary },
  modalBuzzerBtnTextActive: { color: Colors.white },
  modalBuzzerStatus: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
});
