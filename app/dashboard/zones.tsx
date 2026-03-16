// app/(dashboard)/zones.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { SOLAPUR_ZONES, getSafetyStatus } from '@/services/sensorService';

export default function ZonesScreen() {
  const { language, workers, sensors, alerts } = useStore();
  const T = getText(language);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{T.dashboard.zones}</Text>
        <Text style={styles.headerSub}>Solapur City — 5 Zones</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* City Map SVG Placeholder */}
        <View style={styles.mapCard}>
          <View style={styles.mapPlaceholder}>
            <MaterialCommunityIcons name="map" size={48} color={Colors.primary} style={{ opacity: 0.3 }} />
            <Text style={styles.mapTitle}>Solapur City Zone Map</Text>
            <Text style={styles.mapSub}>सोलापूर शहर क्षेत्र नकाशा</Text>
            {/* Zone Color Legend */}
            <View style={styles.mapLegend}>
              {SOLAPUR_ZONES.map(z => (
                <TouchableOpacity key={z.id} style={styles.legendItem} onPress={() => setSelectedZone(selectedZone === z.id ? null : z.id)}>
                  <View style={[styles.legendDot, { backgroundColor: z.color }]} />
                  <Text style={styles.legendText}>{z.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Zone Cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zone Details</Text>
          {SOLAPUR_ZONES.map(zone => {
            const zoneWorkers = workers.filter(w => w.zone === zone.id);
            const safeWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return !s || getSafetyStatus(s) === 'safe';
            });
            const dangerWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'danger';
            });
            const warningWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'warning';
            });
            const zoneAlerts = alerts.filter(a => a.zone === zone.id && !a.resolved);
            const isSelected = selectedZone === zone.id;

            return (
              <TouchableOpacity
                key={zone.id}
                style={[styles.zoneCard, isSelected && styles.zoneCardSelected, { borderLeftColor: zone.color }]}
                onPress={() => setSelectedZone(isSelected ? null : zone.id)}
              >
                <View style={styles.zoneCardHeader}>
                  <View style={[styles.zoneIconBg, { backgroundColor: zone.color + '18' }]}>
                    <MaterialCommunityIcons name="map-marker-radius" size={22} color={zone.color} />
                  </View>
                  <View style={styles.zoneCardInfo}>
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.zoneNameMr}>{zone.nameMarathi}</Text>
                  </View>
                  {zoneAlerts.length > 0 && (
                    <View style={[styles.alertBadge, { backgroundColor: Colors.danger }]}>
                      <Text style={styles.alertBadgeText}>{zoneAlerts.length} alert{zoneAlerts.length > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  <MaterialCommunityIcons name={isSelected ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textMuted} />
                </View>

                {/* Mini Status Row */}
                <View style={styles.statusRow}>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="account-group" size={16} color={Colors.primary} />
                    <Text style={styles.statusItemText}>{zoneWorkers.length} total</Text>
                  </View>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="shield-check" size={16} color={Colors.success} />
                    <Text style={[styles.statusItemText, { color: Colors.success }]}>{safeWorkers.length} safe</Text>
                  </View>
                  {warningWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alert" size={16} color={Colors.warning} />
                      <Text style={[styles.statusItemText, { color: Colors.warning }]}>{warningWorkers.length} warn</Text>
                    </View>
                  )}
                  {dangerWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alarm-light" size={16} color={Colors.danger} />
                      <Text style={[styles.statusItemText, { color: Colors.danger }]}>{dangerWorkers.length} danger</Text>
                    </View>
                  )}
                </View>

                {/* Expanded: Wards list */}
                {isSelected && (
                  <View style={styles.wardsSection}>
                    <Text style={styles.wardsTitle}>Coverage Areas:</Text>
                    <View style={styles.wardsList}>
                      {zone.wards.map(ward => (
                        <View key={ward} style={[styles.wardChip, { borderColor: zone.color }]}>
                          <Text style={[styles.wardChipText, { color: zone.color }]}>{ward}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Active workers in zone */}
                    {zoneWorkers.length > 0 && (
                      <>
                        <Text style={[styles.wardsTitle, { marginTop: Spacing.sm }]}>Active Workers:</Text>
                        {zoneWorkers.map(w => {
                          const s = sensors[w.id];
                          const st = s ? getSafetyStatus(s) : 'safe';
                          const stColor = st === 'safe' ? Colors.success : st === 'warning' ? Colors.warning : Colors.danger;
                          return (
                            <View key={w.id} style={styles.workerRow}>
                              <MaterialCommunityIcons name="account-hard-hat" size={16} color={Colors.textSecondary} />
                              <Text style={styles.workerRowName}>{w.name}</Text>
                              <View style={[styles.workerStatusDot, { backgroundColor: stColor }]} />
                              <Text style={[styles.workerStatusText, { color: stColor }]}>{st}</Text>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub: { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  mapCard: { margin: Spacing.md, borderRadius: BorderRadius.lg, overflow: 'hidden', ...Shadows.md },
  mapPlaceholder: { backgroundColor: Colors.white, padding: Spacing.xl, alignItems: 'center', gap: 8, minHeight: 200, justifyContent: 'center' },
  mapTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: Colors.primary },
  mapSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  mapLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  section: { padding: Spacing.md, paddingTop: 0, gap: Spacing.sm },
  sectionTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: Spacing.xs },
  zoneCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, borderLeftWidth: 4, ...Shadows.sm },
  zoneCardSelected: { ...Shadows.md },
  zoneCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  zoneIconBg: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  zoneCardInfo: { flex: 1 },
  zoneName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  zoneNameMr: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  alertBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  alertBadgeText: { color: Colors.white, fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
  statusRow: { flexDirection: 'row', gap: Spacing.md, paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.border },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusItemText: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  wardsSection: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  wardsTitle: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary, marginBottom: 6 },
  wardsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  wardChip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 3 },
  wardChipText: { fontSize: 11, fontFamily: 'Poppins_500Medium' },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  workerRowName: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary },
  workerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  workerStatusText: { fontSize: 12, fontFamily: 'Poppins_500Medium' },
});
