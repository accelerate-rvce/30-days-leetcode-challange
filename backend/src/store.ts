import { AdminAlert, Challenge, Completion, Profile, VerificationJob } from "./types.js";

const istOffsetMs = 5.5 * 60 * 60 * 1000;
function activeWindow() {
  const localNow = new Date(Date.now() + istOffsetMs);
  let deadlineUtc = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 18, 0, 0) - istOffsetMs;
  if (deadlineUtc <= Date.now()) deadlineUtc += 24 * 60 * 60 * 1000;
  return { publishedAt: new Date(deadlineUtc - 24 * 60 * 60 * 1000).toISOString(), deadlineAt: new Date(deadlineUtc).toISOString() };
}

export const profiles = new Map<string, Profile>([
  ["demo-user", { id: "demo-user", name: "Arjun Sharma", handle: "arjun.builds", academicYear: "Third Year", points: 210, streak: 7, longestStreak: 7 }],
  ["nisha", { id: "nisha", name: "Nisha Kapoor", handle: "nisha.codes", academicYear: "Third Year", points: 262, streak: 7, longestStreak: 7 }],
  ["devansh", { id: "devansh", name: "Devansh Mehta", handle: "devansh_m", academicYear: "Second Year", points: 248, streak: 7, longestStreak: 7 }],
]);

export const challenges = new Map<string, Challenge>([["challenge-07", { id: "challenge-07", day: 7, title: "Two Sum", slug: "two-sum", difficulty: "Easy", topic: "Array · Hash Table", points: 20, ...activeWindow() }]]);
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
