import { Platform, Vibration } from 'react-native';

type AlertSoundLevel = 'warning' | 'critical';

const playedAlertIds = new Set<string>();

const CRITICAL_TYPES = new Set([
  'SOS',
  'FALL',
  'CH4_CRITICAL',
  'H2S_CRITICAL',
  'CO_CRITICAL',
  'SPO2_CRITICAL',
  'HEARTRATE_CRITICAL',
  'CRITICAL',
  'GAS_CRITICAL',
]);

// Web Audio API for web platform
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  return new AudioContextClass();
}

function playWebToneSequence(context: AudioContext, level: AlertSoundLevel) {
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.connect(gain);

  const start = context.currentTime;
  const steps = level === 'critical'
    ? [
        { at: 0.00, freq: 880, gain: 0.18 },
        { at: 0.22, freq: 660, gain: 0.18 },
        { at: 0.44, freq: 880, gain: 0.18 },
        { at: 0.66, freq: 660, gain: 0.18 },
        { at: 0.88, freq: 880, gain: 0.18 },
      ]
    : [
        { at: 0.00, freq: 988, gain: 0.14 },
        { at: 0.16, freq: 988, gain: 0.0 },
      ];

  oscillator.frequency.setValueAtTime(steps[0].freq, start);
  gain.gain.setValueAtTime(0.0001, start);

  steps.forEach((step, index) => {
    oscillator.frequency.setValueAtTime(step.freq, start + step.at);
    gain.gain.setValueAtTime(step.gain, start + step.at);
    gain.gain.linearRampToValueAtTime(step.gain, start + step.at + 0.01);
    if (index < steps.length - 1) {
      gain.gain.setValueAtTime(step.gain, start + step.at + 0.12);
    }
  });

  const duration = level === 'critical' ? 1.1 : 0.22;
  gain.gain.setValueAtTime(0.0001, start + duration);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);

  setTimeout(() => {
    try {
      context.close();
    } catch {
      // ignore
    }
  }, (duration + 0.2) * 1000);
}

// Native vibration for mobile platforms
function playNativeVibration(level: AlertSoundLevel) {
  try {
    if (level === 'critical') {
      // 3-pattern vibration for critical alerts: long-short-long-short-long
      Vibration.vibrate([100, 80, 100, 80, 100]);
    } else {
      // 2-pattern vibration for warnings: medium-short
      Vibration.vibrate([80, 100]);
    }
  } catch (error) {
    console.warn('Native vibration failed:', error);
  }
}

export function playAlertSound(alert: { id: string; type: string }) {
  if (playedAlertIds.has(alert.id)) return false;

  playedAlertIds.add(alert.id);
  const level: AlertSoundLevel = CRITICAL_TYPES.has(alert.type) ? 'critical' : 'warning';

  try {
    if (Platform.OS === 'web') {
      // Web: Use Web Audio API
      const context = getAudioContext();
      if (!context) return false;

      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }

      playWebToneSequence(context, level);
    } else {
      // Native: Use vibration API
      playNativeVibration(level);
    }

    return true;
  } catch (error) {
    console.warn('Alert sound playback failed:', error);
    return false;
  }
}

export function resetPlayedAlertSound(alertId: string) {
  playedAlertIds.delete(alertId);
}