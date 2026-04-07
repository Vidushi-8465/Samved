import { Platform } from 'react-native';
import { Alert } from './sensorService';

type AlertRecipient = string;

export interface EscalationContext {
  managerPhone?: string | null;
  workerPhone?: string | null;
  workerEmergencyContact?: string | null;
  extraRecipients?: string[];
  workerDisplayName?: string | null;
}

const CRITICAL_ALERT_TYPES = new Set<Alert['type']>(['SOS', 'FALL', 'CH4_CRITICAL', 'H2S_CRITICAL', 'SPO2_CRITICAL']);

function getBackendBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000';
  }

  return 'http://localhost:5000';
}

export function isCriticalAlert(alert: Alert) {
  return CRITICAL_ALERT_TYPES.has(alert.type);
}

function buildRecipients(context: EscalationContext): AlertRecipient[] {
  return Array.from(
    new Set(
      [
        context.managerPhone,
        context.workerPhone,
        context.workerEmergencyContact,
        ...(context.extraRecipients ?? []),
      ].filter((recipient): recipient is string => !!recipient && recipient.trim().length > 0)
    )
  );
}

function buildMessage(alert: Alert, context: EscalationContext): string {
  const workerName = context.workerDisplayName || alert.workerName || 'Worker';
  const zone = alert.zone || 'Unknown zone';
  const manholeId = alert.manholeId || 'Unknown manhole';

  return [
    `SMC LiveMonitor emergency alert`,
    `Type: ${alert.type}`,
    `Worker: ${workerName}`,
    `Zone: ${zone}`,
    `Manhole: ${manholeId}`,
    `Value: ${alert.value || 'N/A'}`,
    `Alert ID: ${alert.id}`,
  ].join('\n');
}

export async function sendCriticalAlertEscalation(alert: Alert, context: EscalationContext) {
  if (!isCriticalAlert(alert)) {
    return null;
  }

  const recipients = buildRecipients(context);
  if (recipients.length === 0) {
    return null;
  }

  const response = await fetch(`${getBackendBaseUrl()}/send-alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      alertId: alert.id,
      alertType: alert.type,
      message: buildMessage(alert, context),
      recipients,
      workerName: context.workerDisplayName || alert.workerName,
      zone: alert.zone,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Failed to send alert escalation (${response.status})`);
  }

  return response.json();
}