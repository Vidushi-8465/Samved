// app/(dashboard)/reports.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystemModule from 'expo-file-system';

const FileSystem = FileSystemModule as any;

type Period = 'today' | 'week' | 'month';

type ReportAlert = {
  workerName: string;
  zone: string;
  type: string;
  value: string;
  resolved: boolean;
  timestamp: any;
};

function SimpleBarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map((item) => item.value), 1);

  return (
    <View style={chartStyles.container}>
      {data.map((item) => (
        <View key={item.label} style={chartStyles.barGroup}>
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

function getPeriodStart(period: Period) {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function timestampToDate(timestamp: any) {
  if (!timestamp) return null;
  if (timestamp?.toDate) return timestamp.toDate();
  return new Date(timestamp);
}

function isAlertInPeriod(timestamp: any, period: Period) {
  const date = timestampToDate(timestamp);
  if (!date) return false;
  return date >= getPeriodStart(period);
}

function formatCsvCell(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTrendData(alerts: ReportAlert[], period: Period) {
  if (period === 'today') {
    const labels = ['12a', '4a', '8a', '12p', '4p', '8p'];
    const buckets = new Array(labels.length).fill(0);
    alerts.forEach((alert) => {
      const date = timestampToDate(alert.timestamp);
      if (!date) return;
      const bucket = Math.min(Math.floor(date.getHours() / 4), buckets.length - 1);
      buckets[bucket] += 1;
    });
    return labels.map((label, index) => ({ label, value: buckets[index] }));
  }

  if (period === 'month') {
    const labels = ['W1', 'W2', 'W3', 'W4'];
    const buckets = new Array(labels.length).fill(0);
    alerts.forEach((alert) => {
      const date = timestampToDate(alert.timestamp);
      if (!date) return;
      const bucket = Math.min(Math.floor((date.getDate() - 1) / 7), buckets.length - 1);
      buckets[bucket] += 1;
    });
    return labels.map((label, index) => ({ label, value: buckets[index] }));
  }

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets = new Array(labels.length).fill(0);
  alerts.forEach((alert) => {
    const date = timestampToDate(alert.timestamp);
    if (!date) return;
    const index = (date.getDay() + 6) % 7;
    buckets[index] += 1;
  });
  return labels.map((label, index) => ({ label, value: buckets[index] }));
}

function buildReportHtml(params: {
  period: Period;
  managerName: string;
  workersCount: number;
  totalAlerts: number;
  resolvedAlerts: number;
  resolutionRate: number;
  alertsByType: { label: string; count: number }[];
  zoneRows: { name: string; workers: number; alerts: number; resolvedRate: number }[];
  recentAlerts: ReportAlert[];
}) {
  const rowsHtml = params.recentAlerts.length > 0
    ? params.recentAlerts.map((alert) => `
        <tr>
          <td>${escapeHtml(timestampToDate(alert.timestamp)?.toLocaleString('en-IN') ?? '--')}</td>
          <td>${escapeHtml(alert.workerName)}</td>
          <td>${escapeHtml(alert.zone)}</td>
          <td>${escapeHtml(alert.type)}</td>
          <td>${escapeHtml(alert.value)}</td>
          <td>${alert.resolved ? 'Resolved' : 'Open'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="6">No alerts in this period</td></tr>';

  const summaryCards = [
    { label: 'Total Workers', value: params.workersCount },
    { label: 'Total Alerts', value: params.totalAlerts },
    { label: 'Resolved', value: params.resolvedAlerts },
    { label: 'Resolution Rate', value: `${params.resolutionRate}%` },
  ].map((item) => `<div class="card"><div class="cardLabel">${item.label}</div><div class="cardValue">${item.value}</div></div>`).join('');

  const alertBreakdown = params.alertsByType.map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></li>`).join('');
  const zoneBreakdown = params.zoneRows.map((item) => `<li><span>${escapeHtml(item.name)}</span><span>${item.workers} workers · ${item.alerts} alerts · ${item.resolvedRate}% resolved</span></li>`).join('');

  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: Arial, sans-serif; color: #1A202C; padding: 24px; }
          h1 { margin: 0 0 6px; color: #1A3C6E; }
          h2 { font-size: 16px; margin: 24px 0 10px; color: #1A3C6E; }
          .meta { color: #64748B; font-size: 12px; margin-bottom: 16px; }
          .grid { display: flex; gap: 10px; flex-wrap: wrap; }
          .card { border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; min-width: 140px; }
          .cardLabel { font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: .04em; }
          .cardValue { font-size: 22px; font-weight: 700; color: #1A202C; margin-top: 6px; }
          ul { padding-left: 18px; }
          li { margin-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border-bottom: 1px solid #E2E8F0; text-align: left; padding: 8px 6px; font-size: 12px; }
          th { color: #64748B; font-size: 11px; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <h1>SMC LiveMonitor Report</h1>
        <div class="meta">Period: ${params.period} | Manager: ${escapeHtml(params.managerName)}</div>
        <div class="grid">${summaryCards}</div>
        <h2>Alert Breakdown</h2>
        <ul>${alertBreakdown}</ul>
        <h2>Zone Performance</h2>
        <ul>${zoneBreakdown}</ul>
        <h2>Recent Alerts</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Worker</th>
              <th>Zone</th>
              <th>Type</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
}

function buildReportCsv(params: {
  period: Period;
  managerName: string;
  workersCount: number;
  totalAlerts: number;
  resolvedAlerts: number;
  resolutionRate: number;
  alertsByType: { label: string; count: number }[];
  zoneRows: { name: string; workers: number; alerts: number; resolvedRate: number }[];
  recentAlerts: ReportAlert[];
}) {
  const lines: string[] = [];
  lines.push('SMC LiveMonitor Report');
  lines.push(`Period,${formatCsvCell(params.period)}`);
  lines.push(`Manager,${formatCsvCell(params.managerName)}`);
  lines.push(`Total Workers,${params.workersCount}`);
  lines.push(`Total Alerts,${params.totalAlerts}`);
  lines.push(`Resolved Alerts,${params.resolvedAlerts}`);
  lines.push(`Resolution Rate,${params.resolutionRate}%`);
  lines.push('');
  lines.push('Alert Breakdown');
  lines.push('Type,Count');
  params.alertsByType.forEach((item) => {
    lines.push(`${formatCsvCell(item.label)},${item.count}`);
  });
  lines.push('');
  lines.push('Zone Performance');
  lines.push('Zone,Workers,Alerts,Resolved Rate');
  params.zoneRows.forEach((item) => {
    lines.push(`${formatCsvCell(item.name)},${item.workers},${item.alerts},${item.resolvedRate}%`);
  });
  lines.push('');
  lines.push('Recent Alerts');
  lines.push('Time,Worker,Zone,Type,Value,Status');
  params.recentAlerts.forEach((alert) => {
    const time = timestampToDate(alert.timestamp)?.toLocaleString('en-IN') ?? '--';
    lines.push([
      formatCsvCell(time),
      formatCsvCell(alert.workerName),
      formatCsvCell(alert.zone),
      formatCsvCell(alert.type),
      formatCsvCell(alert.value),
      alert.resolved ? 'Resolved' : 'Open',
    ].join(','));
  });

  return lines.join('\n');
}

function downloadCsvWeb(csv: string, filename: string) {
  try {
    if (typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.warn('CSV download failed:', error);
    throw new Error('Could not download CSV file');
  }
}

export default function ReportsScreen() {
  const { language, workers, alerts, manager } = useStore();
  const T = getText(language);
  const [period, setPeriod] = useState<Period>('week');
  const [exporting, setExporting] = useState(false);

  const periodAlerts = alerts.filter((alert) => isAlertInPeriod(alert.timestamp, period)) as ReportAlert[];
  const totalAlerts = periodAlerts.length;
  const resolvedAlerts = periodAlerts.filter((alert) => alert.resolved).length;
  const sosAlerts = periodAlerts.filter((alert) => alert.type === 'SOS').length;
  const gasAlerts = periodAlerts.filter((alert) =>
    alert.type.includes('GAS') || alert.type.includes('CH4') || alert.type.includes('H2S')
  ).length;
  const tempAlerts = periodAlerts.filter((alert) => alert.type === 'SPO2_LOW' || alert.type === 'SPO2_CRITICAL').length;
  const inactiveAlerts = periodAlerts.filter((alert) => alert.type === 'INACTIVITY').length;
  const heartAlerts = periodAlerts.filter((alert) => alert.type === 'HEARTRATE').length;
  const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 100;

  const alertsByType = [
    { label: 'SOS', count: sosAlerts, color: Colors.danger, icon: 'alarm-light' },
    { label: 'Gas', count: gasAlerts, color: Colors.warning, icon: 'gas-cylinder' },
    { label: 'Temp', count: tempAlerts, color: Colors.accent, icon: 'thermometer-alert' },
    { label: 'Inactive', count: inactiveAlerts, color: Colors.info, icon: 'timer-off' },
    { label: 'Heart', count: heartAlerts, color: '#9B59B6', icon: 'heart-broken' },
  ];

  const trendData = getTrendData(periodAlerts, period);

  const zoneRows = ['north', 'south', 'east', 'west', 'central'].map((zoneId) => {
    const zoneWorkers = workers.filter((worker) => worker.zone === zoneId);
    const zoneAlerts = periodAlerts.filter((alert) => alert.zone === zoneId);
    const zoneResolved = zoneAlerts.filter((alert) => alert.resolved).length;
    return {
      name: `${zoneId.charAt(0).toUpperCase() + zoneId.slice(1)} Zone`,
      workers: zoneWorkers.length,
      alerts: zoneAlerts.length,
      resolvedRate: zoneAlerts.length > 0 ? Math.round((zoneResolved / zoneAlerts.length) * 100) : 100,
    };
  });

  const recentAlerts = [...periodAlerts]
    .sort((left, right) => (timestampToDate(right.timestamp)?.getTime() ?? 0) - (timestampToDate(left.timestamp)?.getTime() ?? 0))
    .slice(0, 20);

  const pdfHtml = buildReportHtml({
    period,
    managerName: manager?.name || 'Manager',
    workersCount: workers.length,
    totalAlerts,
    resolvedAlerts,
    resolutionRate,
    alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
    zoneRows,
    recentAlerts,
  });

  const csvText = buildReportCsv({
    period,
    managerName: manager?.name || 'Manager',
    workersCount: workers.length,
    totalAlerts,
    resolvedAlerts,
    resolutionRate,
    alertsByType: alertsByType.map(({ label, count }) => ({ label, count })),
    zoneRows,
    recentAlerts,
  });

  const exportPdf = async () => {
    setExporting(true);
    try {
      const result = await Print.printToFileAsync({ html: pdfHtml });
      
      if (Platform.OS === 'web') {
        // On web, download the PDF file
        const blob = await fetch(result.uri).then(res => res.blob());
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `smc-livemonitor-${period}-report.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        Alert.alert('Success', 'PDF downloaded successfully');
      } else {
        // On native, share the file if available
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: 'Share report PDF' });
        } else {
          Alert.alert('PDF ready', result.uri);
        }
      }
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Could not generate the PDF report.');
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const fileName = `smc-livemonitor-${period}-report.csv`;
      if (Platform.OS === 'web') {
        downloadCsvWeb(csvText, fileName);
        Alert.alert('Success', 'CSV downloaded successfully');
      } else {
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csvText, { encoding: 'utf8' });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Share report CSV' });
        } else {
          Alert.alert('CSV ready', fileUri);
        }
      }
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Could not generate the CSV report.');
    } finally {
      setExporting(false);
    }
  };

  const showExportMenu = () => {
    Alert.alert('Export report', 'Choose a format to generate.', [
      { text: 'PDF', onPress: () => { void exportPdf(); } },
      { text: 'CSV', onPress: () => { void exportCsv(); } },
      { text: 'Both', onPress: () => { void exportPdf(); void exportCsv(); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{T.dashboard.reports}</Text>
          <Text style={styles.headerSub}>Solapur Municipal Corporation</Text>
        </View>
        <TouchableOpacity style={styles.exportBtn} onPress={showExportMenu} disabled={exporting}>
          <MaterialCommunityIcons name="download" size={18} color={Colors.white} />
          <Text style={styles.exportBtnText}>{exporting ? 'Working...' : 'Export'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 80 }}>
        <View style={styles.periodRow}>
          {(['today', 'week', 'month'] as Period[]).map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.periodBtn, period === value && styles.periodBtnActive]}
              onPress={() => setPeriod(value)}
            >
              <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>📊 Summary Report</Text>
          <Text style={styles.cardSub}>Period: This {period} • Manager: {manager?.name}</Text>
          <View style={styles.summaryGrid}>
            {[
              { label: 'Total Workers', value: String(workers.length), icon: 'account-hard-hat', color: Colors.primary },
              { label: 'Total Alerts', value: String(totalAlerts), icon: 'alarm-light', color: Colors.danger },
              { label: 'Resolved', value: String(resolvedAlerts), icon: 'check-circle', color: Colors.success },
              { label: 'Resolution Rate', value: `${resolutionRate}%`, icon: 'percent', color: Colors.accent },
            ].map((summary) => (
              <View key={summary.label} style={styles.summaryItem}>
                <MaterialCommunityIcons name={summary.icon as any} size={20} color={summary.color} />
                <Text style={[styles.summaryValue, { color: summary.color }]}>{summary.value}</Text>
                <Text style={styles.summaryLabel}>{summary.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📈 Alert Trend</Text>
          <Text style={styles.cardSub}>Alerts during the selected period</Text>
          <SimpleBarChart data={trendData} color={Colors.primary} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🚨 Alert Breakdown</Text>
          {alertsByType.map((item) => (
            <View key={item.label} style={styles.alertRow}>
              <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
              <Text style={styles.alertRowLabel}>{item.label}</Text>
              <View style={styles.alertBarTrack}>
                <View style={[styles.alertBar, { width: `${totalAlerts > 0 ? (item.count / totalAlerts) * 100 : 0}%`, backgroundColor: item.color }]} />
              </View>
              <Text style={[styles.alertRowCount, { color: item.color }]}>{item.count}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🗺️ Zone Performance</Text>
          {zoneRows.map((zone) => (
            <View key={zone.name} style={styles.zoneRow}>
              <View style={styles.zoneRowLeft}>
                <Text style={styles.zoneRowName}>{zone.name}</Text>
                <Text style={styles.zoneRowMeta}>{zone.workers} workers • {zone.alerts} alerts</Text>
              </View>
              <View style={[styles.rateChip, { backgroundColor: zone.resolvedRate === 100 ? Colors.successBg : zone.resolvedRate > 70 ? Colors.warningBg : Colors.dangerBg }]}>
                <Text style={[styles.rateText, { color: zone.resolvedRate === 100 ? Colors.success : zone.resolvedRate > 70 ? Colors.warning : Colors.danger }]}>{zone.resolvedRate}%</Text>
              </View>
            </View>
          ))}
        </View>

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