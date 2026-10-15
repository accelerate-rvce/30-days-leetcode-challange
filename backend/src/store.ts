import { AdminAlert, Challenge, Completion, Profile, VerificationJob } from "./types.js";

const istOffsetMs = 5.5 * 60 * 60 * 1000;
export const ON_TIME_POINTS = 100;
export const LATE_POINTS = 70;

export function pointsForCompletion(timestamp: string, deadlineAt: string) {
  return Date.parse(timestamp) <= Date.parse(deadlineAt) ? ON_TIME_POINTS : LATE_POINTS;
}

function activeWindow() {
  const localNow = new Date(Date.now() + istOffsetMs);
  let deadlineUtc = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 18, 0, 0) - istOffsetMs;
  if (deadlineUtc <= Date.now()) deadlineUtc += 24 * 60 * 60 * 1000;
  return { publishedAt: new Date(deadlineUtc - 24 * 60 * 60 * 1000).toISOString(), deadlineAt: new Date(deadlineUtc).toISOString() };
}

export const profiles = new Map<string, Profile>();

export const challenges = new Map<string, Challenge>();
export const completions = new Map<string, Completion>();
export const jobs = new Map<string, VerificationJob>();
export const adminAlerts: AdminAlert[] = [];
export let verificationPausedUntil = 0;

export function completionKey(profileId: string, challengeId: string) { return `${profileId}:${challengeId}`; }
export function findOrCreateCompletion(profileId: string, challengeId: string): Completion {
  const key = completionKey(profileId, challengeId);
  const existing = completions.get(key);
  if (existing) return existing;
  const completion: Completion = { id: key, profileId, challengeId, status: "pending", attemptedAt: new Date().toISOString() };
  completions.set(key, completion);
  return completion;
}
export function enqueueVerification(profileId: string, challengeId: string) {
  const key = completionKey(profileId, challengeId);
  if ([...jobs.values()].some((job) => job.id === key && !["complete", "failed"].includes(job.status))) return jobs.get(key)!;
  const job: VerificationJob = { id: key, profileId, challengeId, status: "queued", attempts: 0, availableAt: Date.now() };
  jobs.set(key, job);
  return job;
}
export function pauseVerification(message: string, challengeId?: string) {
  verificationPausedUntil = Date.now() + 20 * 60_000;
  adminAlerts.unshift({ id: `alert-${Date.now()}`, createdAt: new Date().toISOString(), severity: "warning", message, challengeId });
}
export function verificationIsPaused() { return verificationPausedUntil > Date.now(); }
