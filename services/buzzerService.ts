// services/buzzerService.ts
// Two-way communication service
// Writes commands to Firebase RTDB → Receiver ESP32 reads → LoRa downlink → Device acts
//
// Commands written to: /commands/{workerId}/
//   warn      : boolean  → Red LED on device glows (warning)
//   buzzer    : boolean  → Device buzzer beeps
//   evacuate  : boolean  → Continuous alarm on device
//   durationMs: number   → How long to run the command

import { ref, set, get } from 'firebase/database';
import { rtdb } from '@/services/firebase';

// ── How long each command stays active before auto-reset ──
const WARN_DURATION_MS     = 8000;   // red LED glows for 8 sec
const BUZZER_DURATION_MS   = 5000;   // buzzer for 5 sec
const EVACUATE_DURATION_MS = 15000;  // evacuation alarm for 15 sec
const AUTO_RESET_DELAY_MS  = 12000;  // app-side reset after sending

// ── Send WARN command → Red LED glows on device ───────────────────────────────
// Called when manager taps "Warn Worker" on the warning/danger banner
export async function sendWarnCommand(workerId: string): Promise<void> {
  const path = `/commands/${workerId}`;
  try {
    await set(ref(rtdb, path), {
      warn:       true,
      buzzer:     false,
      evacuate:   false,
      durationMs: WARN_DURATION_MS,
      sentAt:     Date.now(),
    });
    console.log(`[CMD] WARN sent to ${workerId} — red LED will glow`);

    // Auto-reset after delay so receiver doesn't keep re-triggering
    setTimeout(async () => {
      try {
        await set(ref(rtdb, `${path}/warn`), false);
        console.log(`[CMD] WARN auto-reset for ${workerId}`);
      } catch (_) {}
    }, AUTO_RESET_DELAY_MS);

  } catch (error) {
    console.error('[CMD] Failed to send WARN:', error);
    throw error;
  }
}

// ── Send BUZZER command → Device buzzes ───────────────────────────────────────
// Called when manager taps "Buzzer" button
export async function triggerBuzzer(workerId: string, durationMs?: number): Promise<void> {
  const path = `/commands/${workerId}`;
  const duration = durationMs ?? BUZZER_DURATION_MS;
  try {
    await set(ref(rtdb, path), {
      warn:       false,
      buzzer:     true,
      evacuate:   false,
      durationMs: duration,
      sentAt:     Date.now(),
    });
    console.log(`[CMD] BUZZER sent to ${workerId} for ${duration}ms`);

    setTimeout(async () => {
      try {
        await set(ref(rtdb, `${path}/buzzer`), false);
        console.log(`[CMD] BUZZER auto-reset for ${workerId}`);
      } catch (_) {}
    }, AUTO_RESET_DELAY_MS);

  } catch (error) {
    console.error('[CMD] Failed to trigger buzzer:', error);
    throw error;
  }
}

// ── Send EVACUATE command → Continuous alarm on device ───────────────────────
// Called when manager taps "Evacuate" button
export async function sendEvacuateCommand(workerId: string): Promise<void> {
  const path = `/commands/${workerId}`;
  try {
    await set(ref(rtdb, path), {
      warn:       false,
      buzzer:     false,
      evacuate:   true,
      durationMs: EVACUATE_DURATION_MS,
      sentAt:     Date.now(),
    });
    console.log(`[CMD] EVACUATE sent to ${workerId}`);

    setTimeout(async () => {
      try {
        await set(ref(rtdb, `${path}/evacuate`), false);
        console.log(`[CMD] EVACUATE auto-reset for ${workerId}`);
      } catch (_) {}
    }, AUTO_RESET_DELAY_MS + 5000);

  } catch (error) {
    console.error('[CMD] Failed to send EVACUATE:', error);
    throw error;
  }
}

// ── Reset all commands for a worker ───────────────────────────────────────────
export async function resetCommands(workerId: string): Promise<void> {
  try {
    await set(ref(rtdb, `/commands/${workerId}`), {
      warn:     false,
      buzzer:   false,
      evacuate: false,
    });
  } catch (_) {}
}