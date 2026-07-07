import {
  MAX_WAKE_INTERVAL_SECONDS,
  MIN_WAKE_INTERVAL_SECONDS,
  readWakeState,
  updateWakeState
} from "./memoryStore.js";
import { addSecondsIso, nowIso } from "../utils/time.js";

let timer = null;
let onWake = null;
let wakeInProgress = false;

function validateInterval(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < MIN_WAKE_INTERVAL_SECONDS || value > MAX_WAKE_INTERVAL_SECONDS) {
    throw new Error(`Wake interval must be between ${MIN_WAKE_INTERVAL_SECONDS} and ${MAX_WAKE_INTERVAL_SECONDS} seconds.`);
  }

  return Math.round(value);
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function scheduleNext(seconds) {
  clearTimer();
  timer = setTimeout(async () => {
    let didStartWake = false;
    try {
      if (onWake && !wakeInProgress) {
        didStartWake = true;
        wakeInProgress = true;
        await onWake({ source: "scheduler" });
      }
    } catch (error) {
      console.error("[continuity-lab] Scheduled wake failed:", error);
    } finally {
      if (didStartWake) {
        wakeInProgress = false;
      }
      const wakeState = await readWakeState();
      if (wakeState.is_running && wakeState.wake_interval_seconds !== null) {
        await scheduleNext(wakeState.wake_interval_seconds);
      }
    }
  }, seconds * 1000);
}

export async function startScheduler({ intervalSeconds, wakeCallback }) {
  const seconds = validateInterval(intervalSeconds);
  onWake = wakeCallback;
  const timestamp = nowIso();
  const nextWakeTime = addSecondsIso(timestamp, seconds);

  const wakeState = await updateWakeState((state) => ({
    ...state,
    mode: "scheduled",
    is_running: true,
    wake_interval_seconds: seconds,
    wake_interval_source: "human",
    wake_interval_updated_at: timestamp,
    next_wake_time: nextWakeTime
  }));

  await scheduleNext(seconds);
  return wakeState;
}

export async function stopScheduler() {
  clearTimer();
  const wakeState = await updateWakeState((state) => ({
    ...state,
    mode: "manual",
    is_running: false,
    next_wake_time: null
  }));

  return wakeState;
}

export async function rescheduleFromStoredWakeState() {
  const wakeState = await readWakeState();
  if (wakeState.is_running && wakeState.wake_interval_seconds !== null && onWake) {
    await scheduleNext(wakeState.wake_interval_seconds);
  }
}

export function getSchedulerRuntimeState() {
  return {
    has_timer: Boolean(timer),
    wake_in_progress: wakeInProgress
  };
}
