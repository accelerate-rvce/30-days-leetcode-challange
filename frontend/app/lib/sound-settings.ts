// Sound preferences.
//
// One master switch silences every effect in the app; each channel can still be
// switched off on its own, and the volume scales every clip. Preferences are
// stored per signed-in student, so a shared lab machine does not carry one
// student's settings into another's session. A guest key covers the landing
// page before the session is known.
//
// The store is deliberately tiny and dependency-free: the sound modules ask
// `isSoundEnabled` / `getSoundVolume` at play time (never at import time), and
// the header control subscribes so every open tab UI stays in sync.
export type SoundChannel = "interface" | "handoff" | "entrance" | "celebration";

export type SoundSettings = {
  master: boolean;
  volume: number;
  channels: Record<SoundChannel, boolean>;
};

export const SOUND_CHANNELS: SoundChannel[] = ["interface", "handoff", "entrance", "celebration"];

const guestKey = "guest";

const defaults: SoundSettings = {
  master: true,
  volume: 1,
  channels: { interface: true, handoff: true, entrance: true, celebration: true },
};

let activeUser = guestKey;
let state: SoundSettings = copy(defaults);
let loaded = false;
let storageListening = false;
const listeners = new Set<(settings: SoundSettings) => void>();

function copy(settings: SoundSettings): SoundSettings {
  return { master: settings.master, volume: settings.volume, channels: { ...settings.channels } };
}

function storageKeyFor(user: string) {
  return `30days:sound-settings:v2:${user || guestKey}`;
}

function clampVolume(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return defaults.volume;
  return Math.min(1, Math.max(0, Math.round(numeric * 100) / 100));
}

function read(user: string): SoundSettings {
  if (typeof window === "undefined") return copy(defaults);
  try {
    const raw = window.localStorage.getItem(storageKeyFor(user));
    if (!raw) return copy(defaults);
    const parsed = JSON.parse(raw) as Partial<SoundSettings> | null;
    if (!parsed || typeof parsed !== "object") return copy(defaults);
    const channels = { ...defaults.channels };
    for (const channel of SOUND_CHANNELS) {
      if (typeof parsed.channels?.[channel] === "boolean") channels[channel] = parsed.channels[channel];
    }
    return {
      master: typeof parsed.master === "boolean" ? parsed.master : defaults.master,
      volume: clampVolume(parsed.volume ?? defaults.volume),
      channels,
    };
  } catch {
    // A corrupted entry (private mode, an older build) just falls back to sound on.
    return copy(defaults);
  }
}

function emit() {
  listeners.forEach((listener) => listener(copy(state)));
}

function listenForOtherTabs() {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  // Keep a second tab of the dashboard honest when settings change there.
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKeyFor(activeUser)) return;
    state = read(activeUser);
    emit();
  });
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  state = read(activeUser);
  listenForOtherTabs();
}

/**
 * Switches the preference scope to the signed-in profile. Called once the
 * dashboard knows who is looking; re-reads that student's saved settings.
 */
export function setSoundUser(userId: string | null | undefined) {
  const next = userId?.trim() || guestKey;
  if (next === activeUser) return;
  activeUser = next;
  loaded = false;
  state = copy(defaults);
  ensureLoaded();
  emit();
}

function commit(next: SoundSettings) {
  state = next;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(storageKeyFor(activeUser), JSON.stringify(next)); } catch { /* private mode: keep the session value */ }
  }
  emit();
}

export function getSoundSettings(): SoundSettings {
  ensureLoaded();
  return copy(state);
}

/** Stable reference for useSyncExternalStore; never mutate the returned object. */
export function getSoundSettingsSnapshot(): SoundSettings {
  ensureLoaded();
  return state;
}

/** The server cannot read localStorage, so it renders the defaults. */
export function getServerSoundSettingsSnapshot(): SoundSettings {
  return defaults;
}

/** True only when the master switch, the channel, and an audible volume are on. */
export function isSoundEnabled(channel: SoundChannel): boolean {
  ensureLoaded();
  return state.master && state.channels[channel] && state.volume > 0;
}

/** Current volume multiplier (0–1) for every clip. */
export function getSoundVolume(): number {
  ensureLoaded();
  return state.volume;
}

export function setMasterSoundEnabled(enabled: boolean) {
  ensureLoaded();
  if (state.master === enabled) return;
  commit({ ...state, master: enabled });
}

export function setChannelSoundEnabled(channel: SoundChannel, enabled: boolean) {
  ensureLoaded();
  if (state.channels[channel] === enabled) return;
  commit({ ...state, channels: { ...state.channels, [channel]: enabled } });
}

export function setSoundVolume(value: number) {
  ensureLoaded();
  const volume = clampVolume(value);
  if (state.volume === volume) return;
  commit({ ...state, volume });
}

export function subscribeSoundSettings(listener: (settings: SoundSettings) => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
