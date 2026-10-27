// Client-side snapshot of the dashboard bootstrap response.
//
// The API is fast, but a cold backend or a slow mobile link still leaves the
// student staring at a loader for a second or two. Painting the previous
// snapshot immediately and revalidating in the background makes repeat visits
// feel instant, while short TTLs keep it honest: anything older than the TTL
// is ignored and fetched fresh.
import type { AdminChallenge, AdminCompletion, AdminJob, AdminLog, AdminMetrics, AdminUser, Challenge, LeaderboardRow, Progress, SiteSettings } from "../components/dashboard-types";

export type DashboardSnapshot = {
  savedAt: number;
  challenge: Challenge | null;
  challenges: Challenge[];
  nextPublishAt: string | null;
  progress: Progress | null;
  leaderboard: LeaderboardRow[];
  admin: {
    metrics: AdminMetrics;
    challenges: AdminChallenge[];
    users: AdminUser[];
    jobs: AdminJob[];
    logs: AdminLog[];
    completions: AdminCompletion[];
  } | null;
};

const SNAPSHOT_VERSION = 2;
const SNAPSHOT_TTL_MS = 15 * 60_000;
const SETTINGS_KEY = `30days:settings:v${SNAPSHOT_VERSION}`;
const SETTINGS_TTL_MS = 5 * 60_000;

function snapshotKey(userId: string) {
  return `30days:dashboard:${userId}:v${SNAPSHOT_VERSION}`;
}

function readJson<T>(key: string): { savedAt: number; value: T } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; value?: unknown };
    if (typeof parsed.savedAt !== "number" || parsed.value === undefined) return null;
    return { savedAt: parsed.savedAt, value: parsed.value as T };
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Private mode or a full quota: the cache is an optimization, never a
    // requirement.
  }
}

export function readDashboardSnapshot(userId: string): DashboardSnapshot | null {
  const entry = readJson<DashboardSnapshot>(snapshotKey(userId));
  if (!entry || Date.now() - entry.savedAt > SNAPSHOT_TTL_MS) return null;
  if (!entry.value || !Array.isArray(entry.value.challenges) || !Array.isArray(entry.value.leaderboard)) return null;
  return { ...entry.value, savedAt: entry.savedAt };
}

export function writeDashboardSnapshot(userId: string, snapshot: DashboardSnapshot) {
  writeJson(snapshotKey(userId), { ...snapshot, savedAt: Date.now() });
}

export function clearDashboardSnapshot(userId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(snapshotKey(userId));
  } catch {
    // ignore
  }
}

/** Settings are public, so they can be cached without a user id. */
export function readSettingsCache(): SiteSettings | null {
  const entry = readJson<SiteSettings>(SETTINGS_KEY);
  if (!entry || Date.now() - entry.savedAt > SETTINGS_TTL_MS) return null;
  return typeof entry.value?.waitlistEnabled === "boolean" ? entry.value : null;
}

export function writeSettingsCache(settings: SiteSettings) {
  writeJson(SETTINGS_KEY, settings);
}
