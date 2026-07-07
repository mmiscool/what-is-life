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
let scheduledWakeTime = null;

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
  scheduledWakeTime = null;
}

function timestampMs(isoValue) {
  if (typeof isoValue !== "string" || !isoValue.trim()) {
    return null;
  }

  const ms = new Date(isoValue).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function delayUntil(timestamp) {
  const ms = timestampMs(timestamp);
  return ms === null ? null : Math.max(0, ms - Date.now());
}

function nextWakeFromInterval(baseTimestamp, seconds) {
  return addSecondsIso(baseTimestamp, validateInterval(seconds));
}

async function ensureScheduledTimestamp(wakeState) {
  if (!wakeState.is_running || wakeState.wake_interval_seconds === null) {
    return wakeState;
  }

  if (timestampMs(wakeState.next_wake_time) !== null) {
    return wakeState;
  }

  const nextWakeTime = nextWakeFromInterval(nowIso(), wakeState.wake_interval_seconds);
  return updateWakeState((state) => ({
    ...state,
    next_wake_time: timestampMs(state.next_wake_time) === null ? nextWakeTime : state.next_wake_time
  }));
}

async function advanceStaleWakeTime(firedWakeTime) {
  const firedMs = timestampMs(firedWakeTime) ?? Date.now();
  const wakeState = await readWakeState();
  if (!wakeState.is_running || wakeState.wake_interval_seconds === null) {
    return;
  }

  const currentNextMs = timestampMs(wakeState.next_wake_time);
  if (currentNextMs !== null && currentNextMs > firedMs) {
    return;
  }

  const nextWakeTime = nextWakeFromInterval(nowIso(), wakeState.wake_interval_seconds);
  await updateWakeState((state) => {
    const stateNextMs = timestampMs(state.next_wake_time);
    if (!state.is_running || state.wake_interval_seconds === null || (stateNextMs !== null && stateNextMs > firedMs)) {
      return state;
    }

    return {
      ...state,
      next_wake_time: nextWakeTime
    };
  });
}

async function scheduleAt(nextWakeTime) {
  const delayMs = delayUntil(nextWakeTime);
  if (delayMs === null) {
    clearTimer();
    return;
  }

  clearTimer();
  scheduledWakeTime = nextWakeTime;
  timer = setTimeout(async () => {
    let didStartWake = false;
    const firedWakeTime = nextWakeTime;
    try {
      if (onWake && !wakeInProgress) {
        didStartWake = true;
        wakeInProgress = true;
        await onWake({ source: "scheduler", scheduled_wake_time: firedWakeTime });
      }
    } catch (error) {
      console.error("[continuity-lab] Scheduled wake failed:", error);
    } finally {
      if (didStartWake) {
        wakeInProgress = false;
      }
      await advanceStaleWakeTime(firedWakeTime);
      await rescheduleFromStoredWakeState();
    }
  }, delayMs);
}

export async function startScheduler({ intervalSeconds, wakeCallback }) {
  const seconds = validateInterval(intervalSeconds);
  onWake = wakeCallback;
  const timestamp = nowIso();
  const nextWakeTime = nextWakeFromInterval(timestamp, seconds);

  const wakeState = await updateWakeState((state) => ({
    ...state,
    mode: "scheduled",
    is_running: true,
    wake_interval_seconds: seconds,
    wake_interval_source: "human",
    wake_interval_updated_at: timestamp,
    next_wake_time: nextWakeTime
  }));

  await scheduleAt(nextWakeTime);
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
  let wakeState = await readWakeState();
  if (!wakeState.is_running || !onWake) {
    clearTimer();
    return wakeState;
  }

  wakeState = await ensureScheduledTimestamp(wakeState);
  if (timestampMs(wakeState.next_wake_time) === null) {
    clearTimer();
    return wakeState;
  }

  await scheduleAt(wakeState.next_wake_time);
  return wakeState;
}

export async function restoreSchedulerFromWakeState({ wakeCallback }) {
  onWake = wakeCallback;
  return rescheduleFromStoredWakeState();
}

export function getSchedulerRuntimeState() {
  return {
    has_timer: Boolean(timer),
    wake_in_progress: wakeInProgress,
    scheduled_wake_time: scheduledWakeTime,
    scheduled_delay_ms: scheduledWakeTime ? delayUntil(scheduledWakeTime) : null
  };
}
