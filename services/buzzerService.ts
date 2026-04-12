// services/buzzerService.ts
import { ref, set } from 'firebase/database';
import { rtdb } from './firebase';

export const triggerBuzzer = async (workerId: string, duration: number = 5000): Promise<void> => {
  try {
    // Trigger buzzer command to Firebase RTDB
    const buzzerRef = ref(rtdb, `workers/${workerId}/buzzer`);
    await set(buzzerRef, {
      active: true,
      startTime: Date.now(),
      duration: duration,
    });

    // Auto-stop buzzer after duration
    setTimeout(async () => {
      try {
        await set(buzzerRef, {
          active: false,
          stopTime: Date.now(),
        });
      } catch (error) {
        console.warn('Failed to stop buzzer:', error);
      }
    }, duration);
  } catch (error) {
    console.error('Failed to trigger buzzer:', error);
    throw error;
  }
};
