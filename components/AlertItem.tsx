// components/AlertItem.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { Alert } from '@/services/sensorService';

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

const ALERT_LABELS: Record<string, string> = {
  SOS: 'SOS Emergency',
  GAS_HIGH: 'Gas High',
  GAS_CRITICAL: 'Gas Critical',
  TEMPERATURE: 'High Temp',
  INACTIVITY: 'Inactive',
  HEARTRATE: 'Heart Rate',
};

interface Props {
  alert: Alert;
}

export default function AlertItem({ alert }: Props) {
  const color = ALERT_COLORS[alert.type] || Colors.warning;
  const icon = ALERT_ICONS[alert.type] || 'alert';

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '--';
    const date = timestamp.toDate?.() || new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };

  return (
    <View style={[styles.container, alert.resolved && styles.resolved]}>
      <View style={[styles.iconBox, { backgroundColor: color + '18' }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={alert.resolved ? Colors.textMuted : color} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.type, alert.resolved && styles.mutedText]}>{ALERT_LABELS[alert.type]}</Text>
        <Text style={[styles.worker, alert.resolved && styles.mutedText]}>👷 {alert.workerName} • {alert.zone}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.time, { color: alert.resolved ? Colors.textMuted : color }]}>{formatTime(alert.timestamp)}</Text>
        {alert.resolved && <MaterialCommunityIcons name="check-circle" size={14} color={Colors.success} />}
        {!alert.resolved && alert.type === 'SOS' && (
          <View style={[styles.urgentDot, { backgroundColor: Colors.danger }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 6,
    ...Shadows.sm,
  },
  resolved: { opacity: 0.6 },
  iconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1, gap: 3 },
  type: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  worker: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  mutedText: { color: Colors.textMuted },
  right: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: 11, fontFamily: 'Poppins_500Medium' },
  urgentDot: { width: 8, height: 8, borderRadius: 4 },
});
