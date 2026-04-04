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

// For web: create audio element
let webAudio: HTMLAudioElement | null = null;

// For mobile: lazy load expo-av only when needed
let Audio: any = null;
let soundObject: any = null;
let isAudioInitialized = false;

// Initialize audio mode for mobile
async function initMobileAudio() {
  if (isAudioInitialized || Platform.OS === 'web') return true;
  
  try {
    // Lazy load expo-av only on mobile
    if (!Audio) {
      const expoAv = await import('expo-av');
      Audio = expoAv.Audio;
    }
    
    console.log('🔊 Initializing mobile audio...');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
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

// Play alarm on mobile
async function playMobileAlarm() {
  try {
    console.log('📱 Playing alarm on mobile...');
    
    if (soundObject) {
      await soundObject.unloadAsync().catch(() => {});
      soundObject = null;
    }

    const { sound } = await Audio.Sound.createAsync(
      require('../assets/alarm.mp3'),
      { shouldPlay: false, volume: 1.0, isLooping: false }
    );
    
    soundObject = sound;
    await sound.playAsync();
    console.log('✅ Mobile alarm playing');
    
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Mobile alarm failed:', error);
    return false;
  }
}

// Play alarm on web using HTML5 Audio
function playWebAlarm() {
  try {
    console.log('🌐 Playing alarm on web...');

    if (webAudio) {
      webAudio.pause();
      webAudio.currentTime = 0;
    }

    webAudio = new Audio('/alarm.mp3');
    webAudio.volume = 1.0;

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

// Fallback: Generate alert tone using Web Audio API
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
    const steps = level === 'critical'
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
      try {
        context.close();
      } catch {}
    }, (duration + 0.2) * 1000);
    
    console.log('✅ Tone sequence started');
  } catch (error) {
    console.error('❌ Tone sequence failed:', error);
  }
}

// Vibration for mobile
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

export function resetPlayedAlertSound(alertId: string) {
  playedAlertIds.delete(alertId);
}

export async function cleanupAudio() {
  if (Platform.OS === 'web') {
    if (webAudio) {
      webAudio.pause();
      webAudio = null;
    }
  } else if (soundObject) {
    try {
      await soundObject.unloadAsync();
      soundObject = null;
    } catch {}
  }
}