// app/(dashboard)/alerts.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Animated, Dimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { resolveAlert, acknowledgeAlert, Alert as AlertType } from '@/services/sensorService';
import { playAlertSound } from '@/utils/alertSound';

const ALERT_ICONS: Record<string, string> = {
  SOS: 'alarm-light',
  GAS_HIGH: 'gas-cylinder',
  GAS_CRITICAL: 'gas-cylinder',
  TEMPERATURE: 'thermometer-alert',
  INACTIVITY: 'timer-off',
  HEARTRATE: 'heart-broken',
};

const ALERT_COLORS: Record<string, string> = {
  SOS: Colors.danger,
  GAS_CRITICAL: Colors.danger,
  GAS_HIGH: Colors.warning,
  TEMPERATURE: Colors.warning,
  INACTIVITY: Colors.info,
  HEARTRATE: Colors.danger,
};

const FILTERS = ['All', 'SOS', 'Gas', 'Temperature', 'Unresolved'];

export default function AlertsScreen() {
  const { language, alerts, manager, setAlerts } = useStore();
  const T = getText(language);
  const [activeFilter, setActiveFilter] = useState('All');
  const seenAlertIds = useRef<Set<string>>(new Set());

  // useEffect(() => {
  //   if (alerts.length === 0) return;

  //   if (seenAlertIds.current.size === 0) {
  //     seenAlertIds.current = new Set(alerts.map((alert) => alert.id));
  //     return;
  //   }

  //   const newAlert = [...alerts]
  //     .filter((alert) => !alert.resolved && !seenAlertIds.current.has(alert.id))
  //     .sort((left, right) => {
  //       const leftTs = (left.timestamp as any)?.toMillis?.() ?? 0;
  //       const rightTs = (right.timestamp as any)?.toMillis?.() ?? 0;
  //       return rightTs - leftTs;
  //     })[0];

  //   if (newAlert) {
  //     playAlertSound(newAlert).catch((error) => {
  //       console.warn('Failed to play alert sound:', error);
  //     });
  //   }

  //   seenAlertIds.current = new Set(alerts.map((alert) => alert.id));
  // }, [alerts]);

  const filtered = alerts.filter(a => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'SOS') return a.type === 'SOS';
    if (activeFilter === 'Gas') return a.type.includes('GAS');
    if (activeFilter === 'Temperature') return a.type === 'TEMPERATURE';
    if (activeFilter === 'Unresolved') return !a.resolved;
    return true;
  });

  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  const doAcknowledge = async (alert: AlertType) => {
    try {
      await acknowledgeAlert(alert.id, manager?.name || 'Manager');
    } catch (e) {
      Alert.alert('Error', 'Could not acknowledge alert. Check connection.');
    }
  };

  const doResolve = async (alert: AlertType) => {
    try {
      await resolveAlert(alert.id, manager?.name || 'Manager');
    } catch (e) {
      Alert.alert('Error', 'Could not resolve alert. Check connection.');
    }
  };

  const handleAcknowledge = (alert: AlertType) => {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Acknowledge that you are responding to this ${T.alert[alert.type]}?`);
      if (confirmed) {
        void doAcknowledge(alert);
      }
      return;
    }

    Alert.alert(
      'Acknowledge Alert',
      `Acknowledge that you are responding to this ${T.alert[alert.type]}?`,
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
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Mark this ${T.alert[alert.type]} alert as resolved?`);
      if (confirmed) {
        void doResolve(alert);
      }
      return;
    }

    Alert.alert(
      'Resolve Alert',
      `Mark this ${T.alert[alert.type]} alert as resolved?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          style: 'destructive',
          onPress: async () => {
            await doResolve(alert);
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
          return (
            <View style={[styles.alertCard, item.resolved && styles.alertCardResolved, { borderLeftColor: color }]}>
              <View style={[styles.alertIconBox, { backgroundColor: color + '18' }]}>
                <MaterialCommunityIcons name={icon as any} size={28} color={item.resolved ? Colors.textMuted : color} />
              </View>
              <View style={styles.alertBody}>
                <View style={styles.alertTop}>
                  <Text style={[styles.alertType, item.resolved && styles.alertTextMuted]}>
                    {T.alert[item.type]}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
