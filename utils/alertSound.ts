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

// ── Single persistent sound instance (mobile) ─────────────────────────────────
// Kept at module level so stopAlertSound() can always reach and stop it,
// regardless of how many times playAlertSound() has been called.
let _sound: any = null;
let _isPlaying = false;

// For web: persistent audio element so stop() can pause it
let webAudio: HTMLAudioElement | null = null;
const webAlarmSource = (() => {
  try {
    const moduleRef = require('../assets/alarm.mp3');
    return typeof moduleRef === 'string'
      ? moduleRef
      : moduleRef?.uri ?? moduleRef?.default ?? moduleRef;
  } catch {
    return '/alarm.mp3';
  }
})();

// For mobile: lazy-loaded expo-av
let Audio: any = null;
let isAudioInitialized = false;

// ── Mobile audio init ─────────────────────────────────────────────────────────
async function initMobileAudio() {
  if (isAudioInitialized || Platform.OS === 'web') return true;

  try {
    if (!Audio) {
      const expoAv = await import('expo-av');
      Audio = expoAv.Audio;
    }

    console.log('🔊 Initializing mobile audio...');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,   // keep alive in background
      shouldDuckAndroid: false,        // don't duck — alert must be heard
      playThroughEarpieceAndroid: false,
    });
    isAudioInitialized = true;
    console.log('✅ Mobile audio initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to init mobile audio:', error);
    return false;
  }
}

// ── Mobile alarm (persistent instance + looping) ──────────────────────────────
async function playMobileAlarm() {
  try {
    console.log('📱 Playing alarm on mobile...');

    // Stop and unload any previous instance before creating a new one
    await stopAlertSound();

    const { sound } = await Audio.Sound.createAsync(
      require('../assets/alarm.mp3'),
      {
        shouldPlay: true,
        isLooping: true,   // loop until stopAlertSound() is called
        volume: 1.0,
      }
    );

    _sound = sound;
    _isPlaying = true;
    console.log('✅ Mobile alarm playing (looping)');

    // Safety cleanup in case the sound finishes unexpectedly (non-looping fallback)
    _sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.isLoaded && status.didJustFinish) {
        _isPlaying = false;
        _sound = null;
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Mobile alarm failed:', error);
    return false;
  }
}

// ── Web alarm (persistent HTML5 Audio element) ────────────────────────────────
function playWebAlarm() {
  try {
    console.log('🌐 Playing alarm on web...');

    if (webAudio) {
      webAudio.pause();
      webAudio.currentTime = 0;
    }

    webAudio = new window.Audio(webAlarmSource);
    webAudio.volume = 1.0;
    webAudio.loop = true;    // loop until stopAlertSound() is called
    webAudio.preload = 'auto';

    webAudio.play()
      .then(() => console.log('✅ Playing alarm.mp3!'))
      .catch((err) => {
        console.error('❌ Play failed:', err);
        playWebToneSequence('critical');
      });

    return true;
  } catch (error) {
    console.error('❌ Web alarm error:', error);
    playWebToneSequence('critical');
    return false;
  }
}

// ── Fallback: Web Audio API tone sequence ─────────────────────────────────────
function playWebToneSequence(level: AlertSoundLevel) {
  try {
    console.log('🎵 Playing tone sequence...');
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) {
      console.error('❌ Web Audio API not supported');
      return;
    }

    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.connect(gain);

    const start = context.currentTime;
    const steps =
      level === 'critical'
        ? [
            { at: 0.00, freq: 880, gain: 0.3 },
            { at: 0.22, freq: 660, gain: 0.3 },
            { at: 0.44, freq: 880, gain: 0.3 },
            { at: 0.66, freq: 660, gain: 0.3 },
            { at: 0.88, freq: 880, gain: 0.3 },
          ]
        : [
            { at: 0.00, freq: 988, gain: 0.2 },
            { at: 0.16, freq: 988, gain: 0.0 },
          ];

    oscillator.frequency.setValueAtTime(steps[0].freq, start);
    gain.gain.setValueAtTime(0.0001, start);

    steps.forEach((step, index) => {
      oscillator.frequency.setValueAtTime(step.freq, start + step.at);
      gain.gain.setValueAtTime(step.gain, start + step.at);
      if (index < steps.length - 1) {
        gain.gain.setValueAtTime(step.gain, start + step.at + 0.12);
      }
    });

    const duration = level === 'critical' ? 1.1 : 0.22;
    gain.gain.setValueAtTime(0.0001, start + duration);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);

    setTimeout(() => {
      try { context.close(); } catch {}
    }, (duration + 0.2) * 1000);

    console.log('✅ Tone sequence started');
  } catch (error) {
    console.error('❌ Tone sequence failed:', error);
  }
}

// ── Vibration ─────────────────────────────────────────────────────────────────
function playNativeVibration(level: AlertSoundLevel) {
  try {
    if (level === 'critical') {
      Vibration.vibrate([100, 80, 100, 80, 100]);
    } else {
      Vibration.vibrate([80, 100]);
    }
  } catch (error) {
    console.warn('❌ Vibration failed:', error);
  }
}

// ── Public: play ──────────────────────────────────────────────────────────────
export async function playAlertSound(alert: { id: string; type: string }) {
  console.log('🚨 ALERT SOUND TRIGGERED:', alert.id, 'Type:', alert.type);
  console.log('📍 Platform:', Platform.OS);

  if (playedAlertIds.has(alert.id)) {
    console.log('⏭️ Already played this alert, skipping');
    return false;
  }

  playedAlertIds.add(alert.id);
  const level: AlertSoundLevel = CRITICAL_TYPES.has(alert.type) ? 'critical' : 'warning';
  console.log('📢 Alert level:', level);

  try {
    if (Platform.OS === 'web') {
      console.log('🌐 Web platform - playing web alarm');
      playWebAlarm();
    } else {
      console.log('📱 Mobile platform - playing mobile alarm');
      const initialized = await initMobileAudio();
      if (initialized) {
        await playMobileAlarm();
      }

      if (level === 'critical') {
        console.log('📳 Playing vibration...');
        playNativeVibration(level);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ ALERT SOUND FAILED:', error);
    return false;
  }
}

// ── Public: stop (call this from your Acknowledge button) ─────────────────────
export async function stopAlertSound(): Promise<void> {
  // Web
  if (Platform.OS === 'web') {
    if (webAudio) {
      webAudio.pause();
      webAudio.currentTime = 0;
      webAudio = null;
    }
    return;
  }

  // Mobile — unload the persistent sound instance
  if (!_sound) return;
  try {
    const status = await _sound.getStatusAsync();
    if (status.isLoaded) {
      await _sound.stopAsync();
      await _sound.unloadAsync();
    }
  } catch (error) {
    // Sound may already be unloaded — safe to ignore
    console.warn('[alertSound] stopAlertSound error (usually safe):', error);
  } finally {
    _sound = null;
    _isPlaying = false;
  }
}

// ── Public: query ─────────────────────────────────────────────────────────────
export function isAlertSoundPlaying(): boolean {
  return _isPlaying;
}

// ── Public: reset deduplication for a single alert ───────────────────────────
export function resetPlayedAlertSound(alertId: string) {
  playedAlertIds.delete(alertId);
}

// ── Public: full cleanup (e.g. on app unmount) ────────────────────────────────
export async function cleanupAudio() {
  await stopAlertSound();
}