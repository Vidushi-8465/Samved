// app/(dashboard)/reports.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';

const { width } = Dimensions.get('window');

type Period = 'today' | 'week' | 'month';

// Simple bar chart rendered in pure React Native — no external chart lib needed
function SimpleBarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={chartStyles.container}>
      {data.map((item, i) => (
        <View key={i} style={chartStyles.barGroup}>
          <Text style={chartStyles.barValue}>{item.value}</Text>
          <View style={chartStyles.barTrack}>
            <View
              style={[
                chartStyles.bar,
                {
                  height: Math.max((item.value / max) * 80, item.value > 0 ? 4 : 0),
                  backgroundColor: color,
                },
              ]}
            />
          </View>
          <Text style={chartStyles.barLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 110, paddingTop: 16 },
  barGroup: { alignItems: 'center', gap: 4, flex: 1 },
  barTrack: { width: '60%', height: 80, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4 },
  barValue: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary },
  barLabel: { fontSize: 9, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, textAlign: 'center' },
});

export default function ReportsScreen() {
  const { language, workers, alerts, sensors, manager } = useStore();
  const T = getText(language);
  const [period, setPeriod] = useState<Period>('week');
  const [exporting, setExporting] = useState(false);

  const totalAlerts = alerts.length;
  const resolvedAlerts = alerts.filter(a => a.resolved).length;
  const sosAlerts = alerts.filter(a => a.type === 'SOS').length;
  const gasAlerts = alerts.filter(a => a.type.includes('GAS')).length;
  const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 100;

  const alertsByType = [
    { label: 'SOS', count: sosAlerts, color: Colors.danger, icon: 'alarm-light' },
    { label: 'Gas', count: gasAlerts, color: Colors.warning, icon: 'gas-cylinder' },
    { label: 'Temp', count: alerts.filter(a => a.type === 'SPO2_LOW' || a.type === 'SPO2_CRITICAL').length, color: Colors.accent, icon: 'thermometer-alert' },
    { label: 'Inactive', count: alerts.filter(a => a.type === 'INACTIVITY').length, color: Colors.info, icon: 'timer-off' },
    { label: 'Heart', count: alerts.filter(a => a.type === 'HEARTRATE').length, color: '#9B59B6', icon: 'heart-broken' },
  ];

  // Weekly mock trend data (in real app, query Firestore by date)
  const weeklyData = [
    { label: 'Mon', value: 2 },
    { label: 'Tue', value: 5 },
    { label: 'Wed', value: 1 },
    { label: 'Thu', value: 3 },
    { label: 'Fri', value: 7 },
    { label: 'Sat', value: 4 },
    { label: 'Sun', value: 2 },
  ];

  const handleExportPDF = async () => {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      Alert.alert('Export Ready', 'In production, integrate expo-print here to generate and share a PDF report.', [{ text: 'OK' }]);
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard.reports}</Text>
          <Text style={styles.headerSub}>Solapur Municipal Corporation</Text>
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={handleExportPDF} disabled={exporting}>
          <MaterialCommunityIcons name="download" size={18} color={Colors.white} />
          <Text style={styles.exportBtnText}>{exporting ? 'Generating...' : 'Export PDF'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 80 }}>
        {/* Period Selector */}
        <View style={styles.periodRow}>
          {(['today', 'week', 'month'] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>📊 Summary Report</Text>
          <Text style={styles.cardSub}>Period: This {period} • Manager: {manager?.name}</Text>
          <View style={styles.summaryGrid}>
            {[
              { label: 'Total Workers', value: String(workers.length), icon: 'account-hard-hat', color: Colors.primary },
              { label: 'Total Alerts', value: String(totalAlerts), icon: 'alarm-light', color: Colors.danger },
              { label: 'Resolved', value: String(resolvedAlerts), icon: 'check-circle', color: Colors.success },
              { label: 'Resolution Rate', value: `${resolutionRate}%`, icon: 'percent', color: Colors.accent },
            ].map(s => (
              <View key={s.label} style={styles.summaryItem}>
                <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Weekly Alert Trend Chart */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📈 Weekly Alert Trend</Text>
          <Text style={styles.cardSub}>Alerts per day this week</Text>
          <SimpleBarChart data={weeklyData} color={Colors.primary} />
        </View>

        {/* Alerts Breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🚨 Alert Breakdown</Text>
          {alertsByType.map(a => (
            <View key={a.label} style={styles.alertRow}>
              <MaterialCommunityIcons name={a.icon as any} size={18} color={a.color} />
              <Text style={styles.alertRowLabel}>{a.label}</Text>
              <View style={styles.alertBarTrack}>
                <View style={[styles.alertBar, { width: `${totalAlerts > 0 ? (a.count / totalAlerts) * 100 : 0}%`, backgroundColor: a.color }]} />
              </View>
              <Text style={[styles.alertRowCount, { color: a.color }]}>{a.count}</Text>
            </View>
          ))}
        </View>

        {/* Zone Report */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🗺️ Zone Performance</Text>
          {['north', 'south', 'east', 'west', 'central'].map(zoneId => {
            const zoneWorkers = workers.filter(w => w.zone === zoneId);
            const zoneAlerts = alerts.filter(a => a.zone === zoneId);
            const zoneResolved = zoneAlerts.filter(a => a.resolved).length;
            const rate = zoneAlerts.length > 0 ? Math.round((zoneResolved / zoneAlerts.length) * 100) : 100;
            return (
              <View key={zoneId} style={styles.zoneRow}>
                <View style={styles.zoneRowLeft}>
                  <Text style={styles.zoneRowName}>{zoneId.charAt(0).toUpperCase() + zoneId.slice(1)} Zone</Text>
                  <Text style={styles.zoneRowMeta}>{zoneWorkers.length} workers • {zoneAlerts.length} alerts</Text>
                </View>
                <View style={[styles.rateChip, { backgroundColor: rate === 100 ? Colors.successBg : rate > 70 ? Colors.warningBg : Colors.dangerBg }]}>
                  <Text style={[styles.rateText, { color: rate === 100 ? Colors.success : rate > 70 ? Colors.warning : Colors.danger }]}>{rate}%</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Safety Compliance */}
        <View style={[styles.card, { backgroundColor: Colors.primary }]}>
          <View style={styles.complianceHeader}>
            <MaterialCommunityIcons name="shield-check" size={24} color={Colors.accent} />
            <Text style={[styles.cardTitle, { color: Colors.white }]}>Safety Compliance</Text>
          </View>
          <Text style={[styles.complianceScore, { color: Colors.accent }]}>{resolutionRate}%</Text>
          <Text style={[styles.cardSub, { color: '#B8C8D8' }]}>Overall alert resolution rate this {period}</Text>
          <View style={styles.complianceBar}>
            <View style={[styles.complianceFill, { width: `${resolutionRate}%` }]} />
          </View>
          <Text style={[styles.complianceNote, { color: '#8899AA' }]}>
            {resolutionRate >= 90 ? '✅ Excellent compliance' : resolutionRate >= 70 ? '⚠️ Needs improvement' : '❌ Critical attention required'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub: { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accent, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.md },
  exportBtnText: { color: Colors.white, fontSize: 13, fontFamily: 'Poppins_600SemiBold' },
  periodRow: { flexDirection: 'row', backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: 4, ...Shadows.sm },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: BorderRadius.sm, alignItems: 'center' },
  periodBtnActive: { backgroundColor: Colors.primary },
  periodText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  periodTextActive: { color: Colors.white },
  summaryCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, ...Shadows.sm },
  card: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, ...Shadows.sm },
  cardTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  cardSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, marginBottom: Spacing.md },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  summaryItem: { width: '47%', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  summaryValue: { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  summaryLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  alertRowLabel: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary, width: 60 },
  alertBarTrack: { flex: 1, height: 6, backgroundColor: Colors.background, borderRadius: 3, overflow: 'hidden' },
  alertBar: { height: '100%', borderRadius: 3 },
  alertRowCount: { fontSize: 14, fontFamily: 'Poppins_700Bold', width: 28, textAlign: 'right' },
  zoneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  zoneRowLeft: { flex: 1 },
  zoneRowName: { fontSize: 14, fontFamily: 'Poppins_500Medium', color: Colors.textPrimary },
  zoneRowMeta: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  rateChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full },
  rateText: { fontSize: 13, fontFamily: 'Poppins_700Bold' },
  complianceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  complianceScore: { fontSize: 48, fontFamily: 'Poppins_700Bold' },
  complianceBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  complianceFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 4 },
  complianceNote: { fontSize: 13, fontFamily: 'Poppins_400Regular' },
});
