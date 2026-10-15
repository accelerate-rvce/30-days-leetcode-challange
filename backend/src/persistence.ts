import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Challenge } from "./types.js";
import { pointsForCompletion } from "./store.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const persistenceEnabled = Boolean(url && serviceRoleKey);
export const db: SupabaseClient | null = persistenceEnabled ? createClient(url!, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

const configuredAdminEmails = new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));

export type ClaimedJob = {
  id: string;
  profile_id: string;
  challenge_id: string;
  leetcode_username: string | null;
  slug: string;
  published_at: string;
  deadline_at: string;
  attempts: number;
};

export async function userIdFromAccessToken(token?: string) {
  if (!db || !token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const user = data.user;
  const { data: existingProfile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isConfiguredAdmin = Boolean(user.email && configuredAdminEmails.has(user.email.toLowerCase()));
  if (isConfiguredAdmin && existingProfile && existingProfile.role !== "admin") await db.from("profiles").update({ role: "admin" }).eq("id", user.id);
  await db.from("profiles").upsert({ id: user.id, name: user.user_metadata?.full_name ?? user.email ?? "RVCE student", academic_year: user.user_metadata?.academic_year ?? "First Year", ...(isConfiguredAdmin ? { role: "admin" } : {}) }, { onConflict: "id", ignoreDuplicates: true });
  return user.id;
}

export async function adminIdFromAccessToken(token?: string) {
  const profileId = await userIdFromAccessToken(token);
  if (!profileId || !db) return null;
  const { data, error } = await db.from("profiles").select("role").eq("id", profileId).single();
  if (error || data?.role !== "admin") return null;
  return profileId;
}

export async function getPersistentProfile(profileId: string) {
  if (!db) return null;
  const { data, error } = await db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,longest_streak,role").eq("id", profileId).single();
  if (error) throw error;
  return data;
}

export async function updatePersistentProfile(profileId: string, updates: { name?: string; leetcode_username?: string; academic_year?: string }) {
  if (!db) return null;
  const { data, error } = await db.from("profiles").upsert({ id: profileId, ...updates }, { onConflict: "id" }).select("id,name,leetcode_username,academic_year,points,streak,longest_streak,role").single();
  if (error) throw error;
  return data;
}

export async function recordPersistentAttempt(profileId: string, challenge: Challenge) {
  if (!db) throw new Error("persistence_not_configured");
  const { error } = await db.from("completions").upsert(
    { profile_id: profileId, challenge_id: challenge.id, status: "pending" },
    { onConflict: "profile_id,challenge_id", ignoreDuplicates: true },
  );
  if (error) throw error;
  if (Date.now() >= Date.parse(challenge.deadlineAt)) await enqueuePersistentVerification(profileId, challenge.id);
  const { data } = await db.from("completions").select("attempted_at").eq("profile_id", profileId).eq("challenge_id", challenge.id).single();
  return { attemptedAt: data?.attempted_at ?? new Date().toISOString(), deadlineAt: challenge.deadlineAt };
}

export async function getPersistentCurrentChallenge() {
  if (!db) return null;
  const { data, error } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", new Date().toISOString()).order("day", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, day: data.day, title: data.title, slug: data.slug, difficulty: data.difficulty, topic: data.topic, points: data.points, publishedAt: data.published_at, deadlineAt: data.deadline_at, verificationQueuedAt: data.verification_queued_at } : null;
}

export async function getPersistentChallenge(challengeId: string) {
  if (!db) return null;
  const { data, error } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").eq("id", challengeId).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, day: data.day, title: data.title, slug: data.slug, difficulty: data.difficulty, topic: data.topic, points: data.points, publishedAt: data.published_at, deadlineAt: data.deadline_at, verificationQueuedAt: data.verification_queued_at } : null;
}

export async function getPersistentChallenges() {
  if (!db) return [];
  const { data, error } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", new Date().toISOString()).order("day", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => ({ id: item.id, day: item.day, title: item.title, slug: item.slug, difficulty: item.difficulty, topic: item.topic, points: item.points, publishedAt: item.published_at, deadlineAt: item.deadline_at, verificationQueuedAt: item.verification_queued_at }));
}

export async function getPersistentProgress(profileId: string) {
  if (!db) return null;
  const [{ data: profile, error: profileError }, { data: completions, error: completionError }] = await Promise.all([
    db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,role").eq("id", profileId).single(),
    db.from("completions").select("id,challenge_id,status,attempted_at,verified_at,submission_at,awarded_points,evidence").eq("profile_id", profileId).order("attempted_at", { ascending: false }),
  ]);
  if (profileError) throw profileError;
  if (completionError) throw completionError;
  const verified = (completions ?? []).filter((item) => item.status === "verified");
  return { profile, verifiedCompletions: verified.length, completionPercentage: Math.round((verified.length / 30) * 100), statuses: completions ?? [] };
}

export async function getPersistentLeaderboard(query: string) {
  if (!db) return null;
  let request = db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak").order("points", { ascending: false }).order("streak", { ascending: false });
  const safeQuery = query.replace(/[,%()]/g, "");
  if (safeQuery) request = request.or(`name.ilike.%${safeQuery}%,leetcode_username.ilike.%${safeQuery}%`);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map((profile, index) => ({ rank: index + 1, name: profile.name, handle: profile.leetcode_username ?? "", academicYear: profile.academic_year, points: profile.points, streak: profile.streak ?? 0, solved: profile.streak ?? 0 }));
}

export async function getPersistentJobMetrics() {
  if (!db) return null;
  const { data, error } = await db.from("verification_jobs").select("status");
  if (error) throw error;
  const rows = data ?? [];
  return { queued: rows.filter((row) => row.status === "queued").length, processing: rows.filter((row) => row.status === "processing").length, retrying: rows.filter((row) => row.status === "retry").length, terminalFailures: rows.filter((row) => row.status === "failed").length };
}

export async function getPersistentAdminMetrics() {
  if (!db) return null;
  const [{ count: participantCount, error: participantError }, { count: verifiedCount, error: verifiedError }, jobs] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }).neq("role", "admin"),
    db.from("completions").select("id", { count: "exact", head: true }).eq("status", "verified"),
    getPersistentJobMetrics(),
  ]);
  if (participantError) throw participantError;
  if (verifiedError) throw verifiedError;
  return { health: "Online", participants: participantCount ?? 0, verified: verifiedCount ?? 0, queued: (jobs?.queued ?? 0) + (jobs?.retrying ?? 0), failed: jobs?.terminalFailures ?? 0 };
}

export async function enqueuePersistentVerification(profileId: string, challengeId: string) {
  if (!db) return;
  const { error } = await db.rpc("enqueue_verification_job", { p_profile_id: profileId, p_challenge_id: challengeId });
  if (error) throw error;
}

export async function enqueueDuePersistentVerifications() {
  if (!db) return;
  const { error } = await db.rpc("enqueue_due_verification_jobs");
  if (error) throw error;
}

export async function claimPersistentJobs(limit = 50) {
  if (!db) return [] as ClaimedJob[];
  const { data, error } = await db.rpc("claim_verification_jobs", { p_limit: limit, p_lock_seconds: 300 });
  if (error) throw error;
  return (data ?? []) as ClaimedJob[];
}

export async function markPersistentRetry(job: ClaimedJob, errorMessage: string, maxRetries: number) {
  if (!db) return;
  const terminal = job.attempts >= maxRetries;
  await db.from("verification_jobs").update({
    status: terminal ? "failed" : "retry",
    available_at: new Date(Date.now() + (terminal ? 0 : 20 * 60_000)).toISOString(),
    last_error: errorMessage,
    locked_at: null,
  }).eq("id", job.id);
}

export async function markPersistentNotFound(job: ClaimedJob, maxRetries: number) {
  if (!db) return;
  const terminal = job.attempts >= maxRetries;
  await db.from("verification_jobs").update({
    status: terminal ? "failed" : "retry",
    available_at: new Date(Date.now() + (terminal ? 0 : 15 * 60_000)).toISOString(),
    last_error: terminal ? "no_matching_accepted_submission" : null,
    locked_at: null,
  }).eq("id", job.id);
}

export async function markPersistentVerified(job: ClaimedJob, submissionId: string, submissionAt: string, challenge: Challenge) {
  if (!db) return false;
  const awardedPoints = pointsForCompletion(submissionAt, challenge.deadlineAt);
  const { data, error } = await db.rpc("finalize_verified_completion", {
    p_job_id: job.id,
    p_profile_id: job.profile_id,
    p_challenge_id: job.challenge_id,
    p_submission_id: submissionId,
    p_submission_at: submissionAt,
    p_awarded_points: awardedPoints,
    p_evidence: { source: "leetcode_recent_ac_submission", slug: challenge.slug },
  });
  if (error) throw error;
  return Boolean(data);
}
