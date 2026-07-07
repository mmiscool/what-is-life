export function nowIso() {
  return new Date().toISOString();
}

export function addMinutesIso(isoValue, minutes) {
  const base = isoValue ? new Date(isoValue) : new Date();
  return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

export function addSecondsIso(isoValue, seconds) {
  const base = isoValue ? new Date(isoValue) : new Date();
  return new Date(base.getTime() + seconds * 1000).toISOString();
}

export function minutesUntil(isoValue) {
  if (!isoValue) {
    return null;
  }

  return Math.max(0, Math.round((new Date(isoValue).getTime() - Date.now()) / 60000));
}

export function makeId(prefix = "item") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
