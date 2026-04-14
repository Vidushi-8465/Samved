// app/(dashboard)/alerts.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { resolveAlert, acknowledgeAlert, Alert as AlertType, SENSOR_THRESHOLDS } from '@/services/sensorService';
import { stopAlertSound } from '@/utils/alertSound';
import { triggerBuzzer } from '@/services/buzzerService';

const ALERT_ICONS: Record<string, string> = {
  SOS: 'alarm-light',
  GAS_HIGH: 'gas-cylinder',
  GAS_CRITICAL: 'gas-cylinder',
  CH4_HIGH: 'gas-cylinder',
  CH4_CRITICAL: 'gas-cylinder',
  H2S_HIGH: 'gas-cylinder',
  H2S_CRITICAL: 'gas-cylinder',
  CO_CRITICAL: 'gas-cylinder',
  TEMPERATURE: 'thermometer-alert',
  INACTIVITY: 'timer-off',
  HEARTRATE: 'heart-broken',
  SPO2_LOW: 'water-percent-alert',
  SPO2_CRITICAL: 'water-alert',
};

const ALERT_COLORS: Record<string, string> = {
  SOS: Colors.danger,
  GAS_CRITICAL: Colors.danger,
  CH4_CRITICAL: Colors.danger,
  H2S_CRITICAL: Colors.danger,
  CO_CRITICAL: Colors.danger,
  GAS_HIGH: Colors.warning,
  CH4_HIGH: Colors.warning,
  H2S_HIGH: Colors.warning,
  TEMPERATURE: Colors.warning,
  INACTIVITY: Colors.info,
  HEARTRATE: Colors.danger,
  SPO2_LOW: Colors.warning,
  SPO2_CRITICAL: Colors.danger,
};

const FILTERS = ['All', 'SOS', 'Gas', 'Temperature', 'Unresolved'];

function WarningBanner({ alerts, resetKey }: { alerts: AlertType[]; resetKey: number }) {
  const [dismissed, setDismissed] = useState(false);
  const dangerTypes = ['GAS_CRITICAL', 'CH4_CRITICAL', 'CO_CRITICAL', 'H2S_CRITICAL', 'HEARTRATE', 'SPO2_CRITICAL'];
  const warningTypes = ['GAS_HIGH', 'CH4_HIGH', 'H2S_HIGH', 'TEMPERATURE', 'SPO2_LOW'];

  useEffect(() => {
    setDismissed(false);
  }, [resetKey]);

  const warningAlerts = alerts.filter(
    (a) => !a.resolved && [...warningTypes, ...dangerTypes].includes(a.type)
  );
  const hasDanger = warningAlerts.some((a) => dangerTypes.includes(a.type));

  if (warningAlerts.length === 0 || dismissed) return null;

  return (
    <View style={[bannerStyles.container, hasDanger && bannerStyles.containerDanger]}>
      {warningAlerts.map((alert, index) => (
        <View
          key={alert.id}
          style={[
            bannerStyles.row,
            hasDanger && bannerStyles.rowDanger,
            index < warningAlerts.length - 1 && bannerStyles.rowBorder,
            index < warningAlerts.length - 1 && hasDanger && bannerStyles.rowBorderDanger,
          ]}
        >
          <View style={[bannerStyles.dot, hasDanger && bannerStyles.dotDanger]} />
          <MaterialCommunityIcons
            name={
              alert.type === 'TEMPERATURE'
                ? 'thermometer-alert'
                : alert.type === 'HEARTRATE'
                  ? 'heart-broken'
                  : alert.type === 'SPO2_LOW' || alert.type === 'SPO2_CRITICAL'
                    ? 'water-percent-alert'
                    : 'gas-cylinder'
            }
            size={16}
            color={hasDanger ? '#FECACA' : '#BA7517'}
          />
          <Text style={[bannerStyles.text, hasDanger && bannerStyles.textDanger]} numberOfLines={1}>
            {dangerTypes.includes(alert.type)
              ? alert.type === 'HEARTRATE'
                ? 'Danger heart rate'
                : alert.type === 'SPO2_CRITICAL'
                  ? 'Critical SpO2'
                  : 'Danger gas levels'
              : ['GAS_HIGH', 'CH4_HIGH', 'H2S_HIGH'].includes(alert.type)
                ? 'High gas levels'
                : alert.type === 'SPO2_LOW'
                  ? 'Low SpO2'
                : 'Temperature warning'} — {alert.zone}, {alert.workerName}
          </Text>
          <View style={[bannerStyles.label, hasDanger && bannerStyles.labelDanger]}>
            <Text style={[bannerStyles.labelText, hasDanger && bannerStyles.labelTextDanger]}>{alert.type.replace(/_/g, ' ')}</Text>
          </View>
          {index === warningAlerts.length - 1 && (
            <TouchableOpacity onPress={() => setDismissed(true)} style={bannerStyles.close}>
              <Text style={[bannerStyles.closeText, hasDanger && bannerStyles.closeTextDanger]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

export default function AlertsScreen() {
  const { language, alerts, manager, sensors, workers } = useStore();
  const T = getText(language);
  const [activeFilter, setActiveFilter] = useState('All');
  const [simulatedBannerAlerts, setSimulatedBannerAlerts] = useState<AlertType[]>([]);
  const [bannerResetKey, setBannerResetKey] = useState(0);
  const [thresholdBannerDismissed, setThresholdBannerDismissed] = useState(false);
  const [warningWorkerBusy, setWarningWorkerBusy] = useState(false);

  const bannerAlerts = [...simulatedBannerAlerts, ...alerts];

  const thresholdBreaches = useMemo(() => {
    return Object.entries(sensors)
      .map(([workerId, sensor]) => {
        const worker = workers.find((entry) => entry.id === workerId);
        const workerName = worker?.name || workerId;
        const zone = sensor.locationLabel || sensor.zone || 'Unknown';
        const reasons: string[] = [];

        const ch4 = Number(sensor.ch4 ?? 0);
        if (ch4 >= SENSOR_THRESHOLDS.ch4.warningMin) {
          const level = ch4 >= SENSOR_THRESHOLDS.ch4.dangerMin ? 'danger' : 'warning';
          reasons.push(`CH4 ${level} (${ch4} ppm)`);
        }

        const coValue = Number(sensor.co ?? sensor.h2s ?? 0);
        if (coValue >= SENSOR_THRESHOLDS.co.warningMin) {
          const level = coValue >= SENSOR_THRESHOLDS.co.dangerMin ? 'danger' : 'warning';
          reasons.push(`CO ${level} (${coValue} ppm)`);
        }

        const heartRate = Number(sensor.heartRate ?? 0);
        if (heartRate > 0) {
          const isHrDanger = heartRate < SENSOR_THRESHOLDS.heartRate.dangerLow || heartRate > SENSOR_THRESHOLDS.heartRate.dangerHigh;
          const isHrWarning = heartRate < SENSOR_THRESHOLDS.heartRate.warningLow || heartRate > SENSOR_THRESHOLDS.heartRate.warningHigh;
          if (isHrDanger || isHrWarning) {
            reasons.push(`HR ${isHrDanger ? 'danger' : 'warning'} (${heartRate} BPM)`);
          }
        }

        const spO2 = Number(sensor.spO2 ?? 0);
        if (spO2 > 0) {
          const isSpO2Danger = spO2 < SENSOR_THRESHOLDS.spO2.dangerMin;
          const isSpO2Warning = spO2 < SENSOR_THRESHOLDS.spO2.warningMin;
          if (isSpO2Danger || isSpO2Warning) {
            reasons.push(`SpO2 ${isSpO2Danger ? 'danger' : 'warning'} (${spO2})`);
          }
        }

        return reasons.length > 0 ? { workerId, workerName, zone, reasons } : null;
      })
      .filter((entry): entry is { workerId: string; workerName: string; zone: string; reasons: string[] } => Boolean(entry));
  }, [sensors, workers]);

  const thresholdSignature = useMemo(
    () => thresholdBreaches.map((entry) => `${entry.workerId}:${entry.reasons.join(',')}`).join('|'),
    [thresholdBreaches]
  );

  useEffect(() => {
    setThresholdBannerDismissed(false);
  }, [thresholdSignature]);

  const createSimulatedAlert = (type: AlertType['type'], value: string, workerName: string): AlertType => ({
    id: `sim-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workerId: 'simulated-worker',
    workerName,
    type,
    value,
    zone: 'Simulation Zone',
    manholeId: 'SIM-01',
    timestamp: new Date() as any,
    resolved: false,
    acknowledged: false,
    escalationLevel: 'manager',
  });

  const simulateWarningBanner = () => {
    setSimulatedBannerAlerts([
      createSimulatedAlert('CH4_HIGH', '5200 ppm', 'Sim Worker Warning'),
      createSimulatedAlert('SPO2_LOW', '92', 'Sim Worker Warning'),
    ]);
    setBannerResetKey((key) => key + 1);
  };

  const simulateDangerBanner = () => {
    setSimulatedBannerAlerts([
      createSimulatedAlert('CH4_CRITICAL', '11000 ppm', 'Sim Worker Danger'),
      createSimulatedAlert('HEARTRATE', '128 BPM', 'Sim Worker Danger'),
    ]);
    setBannerResetKey((key) => key + 1);
  };

  const clearBannerSimulation = () => {
    setSimulatedBannerAlerts([]);
    setBannerResetKey((key) => key + 1);
  };

  const handleWarnWorker = async () => {
    if (thresholdBreaches.length === 0 || warningWorkerBusy) return;

    setWarningWorkerBusy(true);
    try {
      const workerIds = Array.from(new Set(thresholdBreaches.map((entry) => entry.workerId)));
      await Promise.all(workerIds.map((workerId) => triggerBuzzer(workerId, 7000)));
      Alert.alert('Warn Worker', `Triggered buzzer for 7 seconds on ${workerIds.length} worker device${workerIds.length > 1 ? 's' : ''}.`);
    } catch (error) {
      Alert.alert('Warn Worker', 'Could not trigger hardware buzzer. Check receiver/device connection.');
    } finally {
      setWarningWorkerBusy(false);
    }
  };

  const filtered = alerts.filter(a => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'SOS') return a.type === 'SOS';
    if (activeFilter === 'Gas') return a.type.includes('GAS') || a.type.includes('CH4') || a.type.includes('CO');
    if (activeFilter === 'Temperature') return a.type === 'TEMPERATURE';
    if (activeFilter === 'Unresolved') return !a.resolved;
    return true;
  });

  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  const doAcknowledge = async (alert: AlertType) => {
    try {
      await stopAlertSound();
      await acknowledgeAlert(alert.id, manager?.name || 'Manager');
    } catch (e) {
      Alert.alert('Error', 'Could not acknowledge alert. Check connection.');
    }
  };

  const doResolve = async (alert: AlertType) => {
    try {
      await stopAlertSound();
      await resolveAlert(alert.id, manager?.name || 'Manager');
    } catch (e) {
      Alert.alert('Error', 'Could not resolve alert. Check connection.');
    }
  };

  const handleAcknowledge = (alert: AlertType) => {
    const alertLabel = T.alert[alert.type as keyof typeof T.alert] || alert.type.replace(/_/g, ' ');
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Acknowledge that you are responding to this ${alertLabel}?`);
      if (confirmed) {
        void doAcknowledge(alert);
      }
      return;
    }

    Alert.alert(
      'Acknowledge Alert',
      `Acknowledge that you are responding to this ${alertLabel}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Acknowledge',
          style: 'default',
          onPress: async () => {
            await doAcknowledge(alert);
          },
        },
      ]
    );
  };

  const handleResolve = (alert: AlertType) => {
    const alertLabel = T.alert[alert.type as keyof typeof T.alert] || alert.type.replace(/_/g, ' ');
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Mark this ${alertLabel} alert as resolved?`);
      if (confirmed) {
        void doResolve(alert);
      }
      return;
    }

    Alert.alert(
      'Resolve Alert',
      `Mark this ${alertLabel} alert as resolved?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          style: 'destructive',
          onPress: async () => {
            try {
              await resolveAlert(alert.id, manager?.name || 'Manager');
            } catch (e) {
              Alert.alert('Error', 'Could not resolve alert. Check connection.');
            }
          },
        },
      ]
    );
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '--';
    const date = timestamp.toDate?.() || new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return date.toLocaleDateString('en-IN');
  };

  return (
    <SafeAreaView style={styles.container}>
      {thresholdBreaches.length > 0 && !thresholdBannerDismissed && (
        <View style={styles.thresholdBanner}>
          <View style={styles.thresholdBannerHeader}>
            <MaterialCommunityIcons name="alert" size={16} color="#7C5D00" />
            <Text style={styles.thresholdBannerTitle}>Worker Threshold Warning</Text>
          </View>
          <Text style={styles.thresholdBannerText} numberOfLines={2}>
            {thresholdBreaches
              .slice(0, 2)
              .map((entry) => `${entry.workerName} (${entry.zone}): ${entry.reasons.join(', ')}`)
              .join('  •  ')}
            {thresholdBreaches.length > 2 ? `  •  +${thresholdBreaches.length - 2} more` : ''}
          </Text>
          <View style={styles.thresholdBannerActions}>
            <TouchableOpacity style={[styles.thresholdActionBtn, styles.thresholdOkBtn]} onPress={() => setThresholdBannerDismissed(true)}>
              <Text style={styles.thresholdActionText}>OK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.thresholdActionBtn, styles.thresholdWarnBtn, warningWorkerBusy && styles.thresholdWarnBtnDisabled]}
              onPress={() => void handleWarnWorker()}
              disabled={warningWorkerBusy}
            >
              <Text style={styles.thresholdActionText}>{warningWorkerBusy ? 'Sending...' : 'Warn Worker'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <WarningBanner alerts={bannerAlerts} resetKey={bannerResetKey} />
      {/* your existing red SOS banner goes here */}

      <View style={styles.simulatorRow}>
        <Text style={styles.simulatorLabel}>Banner test</Text>
        <TouchableOpacity style={[styles.simulatorChip, styles.simulatorWarningChip]} onPress={simulateWarningBanner}>
          <Text style={styles.simulatorChipText}>Simulate Warning</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.simulatorChip, styles.simulatorDangerChip]} onPress={simulateDangerBanner}>
          <Text style={styles.simulatorChipText}>Simulate Danger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.simulatorChip, styles.simulatorClearChip]} onPress={clearBannerSimulation}>
          <Text style={styles.simulatorChipText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard.alerts}</Text>
          {unresolvedCount > 0 && (
            <Text style={styles.headerSub}>{unresolvedCount} unresolved alert{unresolvedCount > 1 ? 's' : ''}</Text>
          )}
        </View>
        <View style={[styles.badge, { backgroundColor: unresolvedCount > 0 ? Colors.danger : Colors.success }]}>
          <Text style={styles.badgeText}>{unresolvedCount}</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>{f}</Text>
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
            <MaterialCommunityIcons name="check-all" size={48} color={Colors.success} />
            <Text style={styles.emptyTitle}>All Clear!</Text>
            <Text style={styles.emptyText}>No alerts for this filter</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = ALERT_COLORS[item.type] || Colors.warning;
          const icon = ALERT_ICONS[item.type] || 'alert';
          const alertLabel = T.alert[item.type as keyof typeof T.alert] || item.type.replace(/_/g, ' ');
          return (
            <View style={[styles.alertCard, item.resolved && styles.alertCardResolved, { borderLeftColor: color }]}>
              <View style={[styles.alertIconBox, { backgroundColor: color + '18' }]}>
                <MaterialCommunityIcons name={icon as any} size={28} color={item.resolved ? Colors.textMuted : color} />
              </View>
              <View style={styles.alertBody}>
                <View style={styles.alertTop}>
                  <Text style={[styles.alertType, item.resolved && styles.alertTextMuted]}>
                    {alertLabel}
                  </Text>
                  <Text style={[styles.alertTime, { color: item.resolved ? Colors.textMuted : color }]}>
                    {formatTime(item.timestamp)}
                  </Text>
                </View>
                <Text style={[styles.alertWorker, item.resolved && styles.alertTextMuted]}>
                  👷 {item.workerName}
                </Text>
                <View style={styles.alertMeta}>
                  <Text style={styles.alertMetaText}>📍 {item.zone}</Text>
                  <Text style={styles.alertMetaText}>• {item.value}</Text>
                </View>
                {item.acknowledged && !item.resolved && (
                  <View style={styles.acknowledgedBadge}>
                    <MaterialCommunityIcons name="check-circle" size={13} color={Colors.info} />
                    <Text style={styles.acknowledgedText}>Acknowledged by {item.acknowledgedBy}</Text>
                  </View>
                )}
                {!item.resolved && (
                  <View style={styles.actionButtons}>
                    {!item.acknowledged && (
                      <TouchableOpacity style={[styles.actionBtn, styles.acknowledgeBtn]} onPress={() => handleAcknowledge(item)}>
                        <MaterialCommunityIcons name="bell-check" size={14} color={Colors.white} />
                        <Text style={styles.actionBtnText}>Acknowledge</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn, { borderColor: color }]} onPress={() => handleResolve(item)}>
                      <MaterialCommunityIcons name="check" size={14} color={color} />
                      <Text style={[styles.actionBtnText, { color }]}>Resolve</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {item.resolved && (
                  <View style={styles.resolvedBadge}>
                    <MaterialCommunityIcons name="check-circle" size={13} color={Colors.success} />
                    <Text style={styles.resolvedText}>Resolved by {item.resolvedBy}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    backgroundColor: '#FAEEDA',
    borderBottomWidth: 1.5,
    borderBottomColor: '#EF9F27',
  },
  containerDanger: {
    backgroundColor: '#7F1D1D',
    borderBottomColor: '#DC2626',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDanger: {
    backgroundColor: '#991B1B',
  },
  rowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#FAC775',
  },
  rowBorderDanger: {
    borderBottomColor: '#DC2626',
  },
  dot: {  
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#BA7517',
    flexShrink: 0,
  },
  dotDanger: {
    backgroundColor: '#FCA5A5',
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: '#633806',
  },
  textDanger: {
    color: '#FEE2E2',
  },
  label: {
    backgroundColor: '#FAC775',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexShrink: 0,
  },
  labelDanger: {
    backgroundColor: '#B91C1C',
  },
  labelText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: '#854F0B',
  },
  labelTextDanger: {
    color: '#FEE2E2',
  },
  close: {
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  closeText: {
    fontSize: 16,
    color: '#854F0B',
    lineHeight: 20,
  },
  closeTextDanger: {
    color: '#FEE2E2',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  thresholdBanner: {
    backgroundColor: '#FEF3C7',
    borderBottomColor: '#F59E0B',
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    gap: 6,
  },
  thresholdBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thresholdBannerTitle: {
    fontSize: 13,
    fontFamily: 'Poppins_700Bold',
    color: '#7C5D00',
  },
  thresholdBannerText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: '#7C5D00',
  },
  thresholdBannerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  thresholdActionBtn: {
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  thresholdOkBtn: {
    backgroundColor: '#FCD34D',
  },
  thresholdWarnBtn: {
    backgroundColor: '#F59E0B',
  },
  thresholdWarnBtnDisabled: {
    opacity: 0.6,
  },
  thresholdActionText: {
    color: '#111827',
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
  },
  simulatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexWrap: 'wrap',
  },
  simulatorLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.textSecondary,
    marginRight: 2,
  },
  simulatorChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  simulatorWarningChip: {
    backgroundColor: '#FDE68A',
  },
  simulatorDangerChip: {
    backgroundColor: '#FCA5A5',
  },
  simulatorClearChip: {
    backgroundColor: '#CBD5E1',
  },
  simulatorChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: '#1F2937',
  },
  header: { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md + 2, ...Shadows.md },
  headerTitle: { color: Colors.white, fontSize: 20, fontFamily: 'Poppins_700Bold', letterSpacing: -0.5 },
  headerSub: { color: 'rgba(255, 184, 184, 0.9)', fontSize: 13, fontFamily: 'Poppins_500Medium', marginTop: 2 },
  badge: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.2)', ...Shadows.sm },
  badgeText: { color: Colors.white, fontSize: 16, fontFamily: 'Poppins_700Bold' },
  filtersRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: 8, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BorderRadius.full, backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary },
  filterTextActive: { color: Colors.white, fontFamily: 'Poppins_600SemiBold' },
  alertCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.lg, padding: Spacing.md, flexDirection: 'row', gap: Spacing.md, marginHorizontal: Spacing.xs, ...Shadows.md, borderLeftWidth: 4 },
  alertCardResolved: { opacity: 0.6, borderLeftColor: Colors.textMuted },
  alertIconBox: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  alertBody: { flex: 1, gap: 4 },
  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alertType: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, letterSpacing: -0.3 },
  alertTextMuted: { color: Colors.textMuted },
  alertTime: { fontSize: 13, fontFamily: 'Poppins_500Medium' },
  alertWorker: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  alertMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  alertMetaText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  actionButtons: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: BorderRadius.md, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start', ...Shadows.sm },
  acknowledgeBtn: { backgroundColor: Colors.info, borderWidth: 0 },
  resolveBtn: { borderWidth: 1.5 },
  actionBtnText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  acknowledgedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: Colors.infoBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm },
  acknowledgedText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.info },
  resolvedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: Colors.successBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm },
  resolvedText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.success },
  empty: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: Colors.textPrimary },
  emptyText: { fontSize: 14, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
});