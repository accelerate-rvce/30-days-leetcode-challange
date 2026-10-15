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
  const [{ data, error }, { data: verifiedCompletions, error: completionError }] = await Promise.all([
    request,
    db.from("completions").select("profile_id").eq("status", "verified"),
  ]);
  if (error) throw error;
  if (completionError) throw completionError;
  const solvedByProfile = new Map<string, number>();
  for (const completion of verifiedCompletions ?? []) solvedByProfile.set(completion.profile_id, (solvedByProfile.get(completion.profile_id) ?? 0) + 1);
  return (data ?? []).map((profile, index) => ({ rank: index + 1, name: profile.name, handle: profile.leetcode_username ?? "", academicYear: profile.academic_year, points: profile.points, streak: profile.streak ?? 0, solved: solvedByProfile.get(profile.id) ?? 0 }));
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

export async function getAdminChallenges() {
  if (!db) return [];
  const { data, error } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").order("day", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getAdminUsers(query = "") {
  if (!db) return [];
  let request = db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,role").neq("role", "admin").order("points", { ascending: false }).limit(200);
  const safeQuery = query.replace(/[,%()]/g, "");
  if (safeQuery) request = request.or(`name.ilike.%${safeQuery}%,leetcode_username.ilike.%${safeQuery}%`);
  const [{ data, error }, { data: completions, error: completionError }] = await Promise.all([
    request,
    db.from("completions").select("profile_id").eq("status", "verified"),
  ]);
  if (error) throw error;
  if (completionError) throw completionError;
  const solved = new Map<string, number>();
  for (const completion of completions ?? []) solved.set(completion.profile_id, (solved.get(completion.profile_id) ?? 0) + 1);
  return (data ?? []).map((profile) => ({ ...profile, solved: solved.get(profile.id) ?? 0 }));
}

export async function getAdminVerificationJobs(limit = 100) {
  if (!db) return [];
  const { data, error } = await db.from("verification_jobs").select("id,profile_id,challenge_id,status,attempts,available_at,locked_at,last_error,created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const profileIds = [...new Set((data ?? []).map((job) => job.profile_id))];
  const challengeIds = [...new Set((data ?? []).map((job) => job.challenge_id))];
  const [{ data: profiles }, { data: challenges }] = await Promise.all([
    profileIds.length ? db.from("profiles").select("id,name,leetcode_username").in("id", profileIds) : Promise.resolve({ data: [] }),
    challengeIds.length ? db.from("challenges").select("id,day,title,slug").in("id", challengeIds) : Promise.resolve({ data: [] }),
  ]);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const challengeMap = new Map((challenges ?? []).map((challenge) => [challenge.id, challenge]));
  return (data ?? []).map((job) => ({ ...job, profile: profileMap.get(job.profile_id) ?? null, challenge: challengeMap.get(job.challenge_id) ?? null }));
}

export async function getAdminAuditLogs(limit = 100) {
  if (!db) return [];
  const { data, error } = await db.from("admin_audit_logs").select("id,admin_profile_id,action,target_profile_id,target_challenge_id,status,message,metadata,created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function writeAdminAuditLog(adminProfileId: string, entry: { action: string; status: "success" | "error" | "info"; message: string; targetProfileId?: string; targetChallengeId?: string; metadata?: Record<string, unknown> }) {
  if (!db) return;
  const { error } = await db.from("admin_audit_logs").insert({ admin_profile_id: adminProfileId, action: entry.action, status: entry.status, message: entry.message, target_profile_id: entry.targetProfileId, target_challenge_id: entry.targetChallengeId, metadata: entry.metadata ?? {} });
  if (error) throw error;
}

export async function createAdminChallenge(input: { day: number; title: string; slug: string; difficulty: string; topic: string; points: number; published_at: string; deadline_at: string }) {
  if (!db) return null;
  const { data, error } = await db.from("challenges").insert(input).select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").single();
  if (error) throw error;
  return data;
}

export type SiteSettings = { waitlistEnabled: boolean; message: string; launchAt: string | null };

export async function getSiteSettings(): Promise<SiteSettings> {
  const defaults: SiteSettings = { waitlistEnabled: false, message: "", launchAt: null };
  if (!db) return defaults;
  const { data, error } = await db.from("site_settings").select("key,value");
  if (error) throw error;
  const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
  const message = map.get("waitlist_message");
  const launchAt = map.get("launch_at");
  return {
    waitlistEnabled: map.get("waitlist_enabled") === true,
    message: typeof message === "string" ? message : "",
    launchAt: typeof launchAt === "string" ? launchAt : null,
  };
}

export async function updateSiteSettings(patch: { waitlistEnabled?: boolean; message?: string; launchAt?: string | null }): Promise<SiteSettings> {
  if (!db) throw new Error("persistence_not_configured");
  const rows: { key: string; value: unknown }[] = [];
  if (patch.waitlistEnabled !== undefined) rows.push({ key: "waitlist_enabled", value: patch.waitlistEnabled });
  if (patch.message !== undefined) rows.push({ key: "waitlist_message", value: patch.message });
  if (patch.launchAt !== undefined) rows.push({ key: "launch_at", value: patch.launchAt });
  for (const row of rows) {
    const { error } = await db.from("site_settings").upsert({ key: row.key, value: row.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
  }
  return getSiteSettings();
}

export async function updateAdminChallenge(challengeId: string, updates: { title?: string; slug?: string; difficulty?: string; topic?: string; points?: number; published_at?: string; deadline_at?: string }) {
  if (!db) return null;
  const { data, error } = await db.from("challenges").update(updates).eq("id", challengeId).select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").single();
  if (error) throw error;
  return data;
}

export async function reorderAdminChallenges(order: string[]) {
  if (!db) return;
  const { error } = await db.rpc("admin_reorder_challenges", { p_order: order.map((id) => ({ id })) });
  if (error) throw error;
}

export async function preparePersistentVerification(profileId: string, challengeId: string) {
  if (!db) throw new Error("persistence_not_configured");
  const { error: completionError } = await db.from("completions").upsert({ profile_id: profileId, challenge_id: challengeId, status: "pending" }, { onConflict: "profile_id,challenge_id", ignoreDuplicates: true });
  if (completionError) throw completionError;
  await enqueuePersistentVerification(profileId, challengeId);
  const { data, error } = await db.from("verification_jobs").select("id,status").eq("profile_id", profileId).eq("challenge_id", challengeId).single();
  if (error) throw error;
  return data;
}

export async function manuallyVerifyPersistentCompletion(profileId: string, challengeId: string, submissionId: string, submissionAt: string) {
  if (!db) throw new Error("persistence_not_configured");
  const challenge = await getPersistentChallenge(challengeId);
  if (!challenge) throw new Error("challenge_not_found");
  const job = await preparePersistentVerification(profileId, challengeId);
  const awardedPoints = pointsForCompletion(submissionAt, challenge.deadlineAt);
  const { data, error } = await db.rpc("finalize_verified_completion", { p_job_id: job.id, p_profile_id: profileId, p_challenge_id: challengeId, p_submission_id: submissionId, p_submission_at: submissionAt, p_awarded_points: awardedPoints, p_evidence: { source: "admin_manual_verification", submissionId } });
  if (error) throw error;
  return { changed: Boolean(data), awardedPoints };
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
    last_error: "no_matching_accepted_submission",
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
