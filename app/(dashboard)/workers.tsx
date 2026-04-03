// app/(dashboard)/workers.tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { getSafetyStatus, getSensorStatus, SOLAPUR_ZONES, WorkerProfile, SensorData } from '@/services/sensorService';
import { db } from '@/services/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';

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
});

function WorkerDetailModal({ worker, sensor, onClose }: { worker: WorkerProfile; sensor?: SensorData; onClose: () => void }) {
  const status = sensor ? getSafetyStatus(sensor) : 'safe';
  const sensorStatus = sensor ? getSensorStatus(sensor) : null;

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

          <ScrollView style={{ maxHeight: 480 }}>
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

              {sensor ? (
                <>
                  {/* Manhole info */}
                  <View style={styles.infoRow}>
                    <MaterialCommunityIcons name="manhole" size={16} color={Colors.textSecondary} />
                    <Text style={styles.infoText}>{sensor.manholeId} — {sensor.locationLabel}</Text>
                  </View>

                  <View style={styles.sensorDivider}>
                    <Text style={styles.sensorDividerText}>LIVE SENSOR DATA</Text>
                  </View>

                  {/* Heart Rate + SpO2 prominently */}
                  <View style={styles.vitalsRow}>
                    <View style={[styles.vitalBox, { borderColor: STATUS_COLORS[sensorStatus?.heartRate || 'safe'] }]}>
                      <MaterialCommunityIcons name="heart-pulse" size={22} color={STATUS_COLORS[sensorStatus?.heartRate || 'safe']} />
                      <Text style={[styles.vitalValue, { color: STATUS_COLORS[sensorStatus?.heartRate || 'safe'] }]}>
                        {sensor.heartRate > 0 ? sensor.heartRate : '—'}
                      </Text>
                      <Text style={styles.vitalUnit}>BPM</Text>
                    </View>
                    <View style={[styles.vitalBox, { borderColor: STATUS_COLORS[sensorStatus?.spO2 || 'safe'] }]}>
                      <MaterialCommunityIcons name="lungs" size={22} color={STATUS_COLORS[sensorStatus?.spO2 || 'safe']} />
                      <Text style={[styles.vitalValue, { color: STATUS_COLORS[sensorStatus?.spO2 || 'safe'] }]}>
                        {sensor.spO2 > 0 ? sensor.spO2 : '—'}
                      </Text>
                      <Text style={styles.vitalUnit}>SpO2 %</Text>
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
                  <View style={[styles.postureBox, { backgroundColor: sensor.fallDetected ? Colors.dangerBg : Colors.successBg, borderColor: sensor.fallDetected ? Colors.danger : Colors.success }]}>
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
                  <View style={[styles.modeBadge, { backgroundColor: sensor.mode === 'premonitoring' ? Colors.infoBg : Colors.warningBg }]}>
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

export default function WorkersScreen() {
  const { language, workers, sensors, manager, setWorkers } = useStore();
  const T = getText(language);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState<WorkerProfile | null>(null);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [savingWorker, setSavingWorker] = useState(false);
  const [form, setForm] = useState(createEmptyForm());

  const filtered = workers.filter(w => {
    const matchSearch = w.name.toLowerCase().includes(search.toLowerCase()) ||
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

    if (workers.some((worker) => worker.employeeId.toLowerCase() === trimmedEmployeeId.toLowerCase())) {
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
              </View>

              {/* Right side — status + vitals */}
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
        />
      )}

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
                <TextInput style={styles.fieldInput} value={form.name} onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))} placeholder="Worker name" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Employee ID</Text>
                <TextInput style={styles.fieldInput} value={form.employeeId} onChangeText={(value) => setForm((prev) => ({ ...prev, employeeId: value }))} placeholder="SMC-2026-001" autoCapitalize="characters" />
              </View>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Phone</Text>
                  <TextInput style={styles.fieldInput} value={form.phone} onChangeText={(value) => setForm((prev) => ({ ...prev, phone: value }))} placeholder="Mobile number" keyboardType="phone-pad" />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Blood Group</Text>
                  <TextInput style={styles.fieldInput} value={form.bloodGroup} onChangeText={(value) => setForm((prev) => ({ ...prev, bloodGroup: value }))} placeholder="B+" autoCapitalize="characters" />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Emergency Contact</Text>
                <TextInput style={styles.fieldInput} value={form.emergencyContact} onChangeText={(value) => setForm((prev) => ({ ...prev, emergencyContact: value }))} placeholder="Emergency phone" keyboardType="phone-pad" />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Zone</Text>
                <View style={styles.chipWrap}>
                  {SOLAPUR_ZONES.map((zone) => (
                    <TouchableOpacity
                      key={zone.id}
                      style={[styles.chip, form.zone === zone.id && styles.chipActive]}
                      onPress={() => setForm((prev) => ({ ...prev, zone: zone.id }))}
                    >
                      <Text style={[styles.chipText, form.zone === zone.id && styles.chipTextActive]}>{zone.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Shift</Text>
                <View style={styles.chipWrap}>
                  {SHIFT_OPTIONS.map((shift) => (
                    <TouchableOpacity
                      key={shift}
                      style={[styles.chip, form.shift === shift && styles.chipActive]}
                      onPress={() => setForm((prev) => ({ ...prev, shift }))}
                    >
                      <Text style={[styles.chipText, form.shift === shift && styles.chipTextActive]}>{shift}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddWorker(false)} disabled={savingWorker}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddWorker} disabled={savingWorker}>
                {savingWorker ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>Save Worker</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

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
  formCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.lg, padding: Spacing.md, maxHeight: '88%', ...Shadows.lg },
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
});
