// app/(dashboard)/alerts.tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { resolveAlert, Alert as AlertType } from '@/services/sensorService';

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

  const filtered = alerts.filter(a => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'SOS') return a.type === 'SOS';
    if (activeFilter === 'Gas') return a.type.includes('GAS');
    if (activeFilter === 'Temperature') return a.type === 'TEMPERATURE';
    if (activeFilter === 'Unresolved') return !a.resolved;
    return true;
  });

  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  const handleResolve = (alert: AlertType) => {
    Alert.alert(
      'Resolve Alert',
      `Mark this ${T.alert[alert.type]} alert as resolved?`,
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
            <View style={[styles.alertCard, item.resolved && styles.alertCardResolved]}>
              <View style={[styles.alertIconBox, { backgroundColor: color + '18' }]}>
                <MaterialCommunityIcons name={icon as any} size={24} color={item.resolved ? Colors.textMuted : color} />
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
                {!item.resolved && (
                  <TouchableOpacity style={[styles.resolveBtn, { borderColor: color }]} onPress={() => handleResolve(item)}>
                    <MaterialCommunityIcons name="check" size={14} color={color} />
                    <Text style={[styles.resolveBtnText, { color }]}>{T.common.resolve}</Text>
                  </TouchableOpacity>
                )}
                {item.resolved && (
                  <View style={styles.resolvedBadge}>
                    <MaterialCommunityIcons name="check-circle" size={12} color={Colors.success} />
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
  header: { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub: { color: '#FFB8B8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  badge: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: Colors.white, fontSize: 14, fontFamily: 'Poppins_700Bold' },
  filtersRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: BorderRadius.full, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  filterTextActive: { color: Colors.white },
  alertCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm, ...Shadows.sm },
  alertCardResolved: { opacity: 0.65 },
  alertIconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  alertBody: { flex: 1, gap: 3 },
  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alertType: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  alertTextMuted: { color: Colors.textMuted },
  alertTime: { fontSize: 12, fontFamily: 'Poppins_500Medium' },
  alertWorker: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: Colors.textPrimary },
  alertMeta: { flexDirection: 'row', gap: 4 },
  alertMetaText: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  resolveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 4 },
  resolveBtnText: { fontSize: 12, fontFamily: 'Poppins_500Medium' },
  resolvedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  resolvedText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.success },
  empty: { alignItems: 'center', padding: 48, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  emptyText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
});
