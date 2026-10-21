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
  const email = user.email?.toLowerCase();
  const isConfiguredAdmin = Boolean(email && configuredAdminEmails.has(email));
  // The browser check is UX; enforce the college domain at the API boundary
  // too so a token from another Google account cannot read or write data.
  if (!isConfiguredAdmin && !email?.endsWith("@rvce.edu.in")) return null;
  const { data: existingProfile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (isConfiguredAdmin && existingProfile && existingProfile.role !== "admin") await db.from("profiles").update({ role: "admin" }).eq("id", user.id);
  await db.from("profiles").upsert({ id: user.id, name: user.user_metadata?.full_name ?? user.email ?? "RVCE student", academic_year: user.user_metadata?.academic_year ?? "Second Year", ...(isConfiguredAdmin ? { role: "admin" } : {}) }, { onConflict: "id", ignoreDuplicates: true });
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

export async function getLeetCodeUsernameOwner(handle: string, profileId: string) {
  if (!db) return null;
  const { data, error } = await db.from("profiles").select("id,name,leetcode_username").not("leetcode_username", "is", null).limit(5_000);
  if (error) throw error;
  const normalized = handle.trim().toLowerCase();
  return (data ?? []).find((profile) => profile.id !== profileId && profile.leetcode_username?.trim().toLowerCase() === normalized) ?? null;
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

function mapChallenge(data: { id: string; day: number; title: string; slug: string; difficulty: string; topic: string; points: number; published_at: string; deadline_at: string; verification_queued_at: string | null }) {
  return { id: data.id, day: data.day, title: data.title, slug: data.slug, difficulty: data.difficulty, topic: data.topic, points: data.points, publishedAt: data.published_at, deadlineAt: data.deadline_at, verificationQueuedAt: data.verification_queued_at };
}

export async function getPersistentCurrentChallenge() {
  if (!db) return null;
  const now = new Date().toISOString();
  // Prefer the lowest-numbered day that is currently inside its window. This
  // keeps Day 1 active even if a later question was pre-published, and moves
  // to the next day only after the current deadline has passed.
  const { data: active, error: activeError } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", now).gt("deadline_at", now).order("day", { ascending: true }).limit(1).maybeSingle();
  if (activeError) throw activeError;
  if (active) return mapChallenge(active);
  // Late mode: if every published window has closed, expose the most recent
  // published day so students can still complete a missed challenge.
  const { data: latest, error: latestError } = await db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", now).order("day", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  return latest ? mapChallenge(latest) : null;
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

async function getActiveChallengeDay() {
  if (!db) return null;
  const now = new Date().toISOString();
  const { data: active, error: activeError } = await db.from("challenges").select("day").lte("published_at", now).gt("deadline_at", now).order("day", { ascending: true }).limit(1).maybeSingle();
  if (activeError) throw activeError;
  if (active) return active.day as number;
  const { data: latest, error: latestError } = await db.from("challenges").select("day").lte("published_at", now).order("day", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  return (latest?.day as number | undefined) ?? null;
}

function summarizeStreakDays(days: number[], activeDay: number | null) {
  const uniqueDays = [...new Set(days)].sort((left, right) => left - right);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of uniqueDays) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const last = uniqueDays.length ? uniqueDays[uniqueDays.length - 1] : null;
  // A streak stays alive while the next challenge is still in progress. If
  // the student has already missed a closed day, the current run is broken.
  const current = activeDay === null
    ? run
    : last !== null && (last === activeDay || last === activeDay - 1)
      ? run
      : 0;
  return { current, longest };
}

export async function recalculateProfileStreak(profileId: string) {
  if (!db) return null;
  const [{ data: completions, error: completionError }, activeDay] = await Promise.all([
    db.from("completions").select("challenge_id,awarded_points").eq("profile_id", profileId).eq("status", "verified").eq("awarded_points", 100),
    getActiveChallengeDay(),
  ]);
  if (completionError) throw completionError;

  const challengeIds = [...new Set((completions ?? []).map((completion) => completion.challenge_id as string))];
  const dayByChallenge = new Map<string, number>();
  if (challengeIds.length) {
    const { data: challenges, error: challengeError } = await db.from("challenges").select("id,day").in("id", challengeIds);
    if (challengeError) throw challengeError;
    for (const challenge of challenges ?? []) dayByChallenge.set(challenge.id, challenge.day);
  }

  const days = (completions ?? []).map((completion) => dayByChallenge.get(completion.challenge_id)).filter((day): day is number => typeof day === "number");
  const { current, longest } = summarizeStreakDays(days, activeDay);
  const { error: updateError } = await db.from("profiles").update({ streak: current, longest_streak: longest }).eq("id", profileId);
  if (updateError) throw updateError;
  return { current, longest };
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

type AdminAnalyticsProfileRow = {
  id: string;
  name: string;
  email: string | null;
  leetcode_username: string | null;
  academic_year: string;
  points: number | null;
  streak: number | null;
  role: string | null;
  created_at: string;
};

type AdminAnalyticsCompletionRow = {
  id: string;
  profile_id: string;
  status: string;
  attempted_at: string | null;
  verified_at: string | null;
  created_at: string;
  awarded_points: number | null;
};

const analyticsDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function analyticsDateKey(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Map(analyticsDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

async function selectAllAnalyticsRows<T>(table: "profiles" | "completions", columns: string, order: { column: string; ascending: boolean }) {
  if (!db) return [] as T[];
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(order.column, { ascending: order.ascending })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

export async function getAdminAnalytics() {
  if (!db) return null;
  const [profiles, completions] = await Promise.all([
    selectAllAnalyticsRows<AdminAnalyticsProfileRow>("profiles", "id,name,email,leetcode_username,academic_year,points,streak,role,created_at", { column: "created_at", ascending: false }),
    selectAllAnalyticsRows<AdminAnalyticsCompletionRow>("completions", "id,profile_id,status,attempted_at,verified_at,created_at,awarded_points", { column: "created_at", ascending: true }),
  ]);

  const participants = profiles.filter((profile) => profile.role !== "admin");
  const participantIds = new Set(participants.map((profile) => profile.id));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const participantCompletions = completions.filter((completion) => participantIds.has(completion.profile_id));

  const daily = new Map<string, { registrations: number; activeUsers: Set<string>; attempts: number; verified: number; pointsAwarded: number }>();
  const now = new Date();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const key = analyticsDateKey(new Date(now.getTime() - offset * 86_400_000));
    if (key) daily.set(key, { registrations: 0, activeUsers: new Set(), attempts: 0, verified: 0, pointsAwarded: 0 });
  }

  for (const profile of participants) {
    const key = analyticsDateKey(profile.created_at);
    const bucket = key ? daily.get(key) : undefined;
    if (bucket) bucket.registrations += 1;
  }

  const completionStats = new Map<string, { solved: number; attempts: number; lastActivityAt: string | null }>();
  for (const completion of completions) {
    const stats = completionStats.get(completion.profile_id) ?? { solved: 0, attempts: 0, lastActivityAt: null };
    stats.attempts += 1;
    if (completion.status === "verified") stats.solved += 1;
    const activityAt = completion.attempted_at ?? completion.created_at;
    if (activityAt && (!stats.lastActivityAt || Date.parse(activityAt) > Date.parse(stats.lastActivityAt))) stats.lastActivityAt = activityAt;
    completionStats.set(completion.profile_id, stats);

    if (!participantIds.has(completion.profile_id)) continue;
    const attemptKey = analyticsDateKey(completion.attempted_at ?? completion.created_at);
    const attemptBucket = attemptKey ? daily.get(attemptKey) : undefined;
    if (attemptBucket) {
      attemptBucket.attempts += 1;
      attemptBucket.activeUsers.add(completion.profile_id);
    }
    if (completion.status === "verified") {
      const verifiedKey = analyticsDateKey(completion.verified_at ?? completion.created_at);
      const verifiedBucket = verifiedKey ? daily.get(verifiedKey) : undefined;
      if (verifiedBucket) {
        verifiedBucket.verified += 1;
        verifiedBucket.pointsAwarded += completion.awarded_points ?? 0;
      }
    }
  }

  const verifiedCompletions = participantCompletions.filter((completion) => completion.status === "verified");
  const pointsAwarded = verifiedCompletions.reduce((total, completion) => total + (completion.awarded_points ?? 0), 0);
  const totalPoints = participants.reduce((total, profile) => total + (profile.points ?? 0), 0);
  const sortedPoints = participants.map((profile) => profile.points ?? 0).sort((left, right) => left - right);
  const midline = Math.floor(sortedPoints.length / 2);
  const medianPoints = sortedPoints.length === 0
    ? 0
    : sortedPoints.length % 2 === 0
      ? Math.round((sortedPoints[midline - 1] + sortedPoints[midline]) / 2)
      : sortedPoints[midline];
  const activeChallengers = participants.filter((profile) => (completionStats.get(profile.id)?.solved ?? 0) > 0).length;
  const withLeetcode = participants.filter((profile) => Boolean(profile.leetcode_username?.trim())).length;
  const streaks = participants.map((profile) => profile.streak ?? 0);

  const yearOrder = ["First Year", "Second Year", "Third Year", "Fourth Year"];
  const yearMap = new Map<string, { registrations: number; verified: number; points: number }>();
  for (const profile of participants) yearMap.set(profile.academic_year, { registrations: 0, verified: 0, points: 0 });
  for (const profile of participants) {
    const bucket = yearMap.get(profile.academic_year);
    if (bucket) {
      bucket.registrations += 1;
      bucket.points += profile.points ?? 0;
    }
  }
  for (const completion of verifiedCompletions) {
    const profile = profileById.get(completion.profile_id);
    if (!profile) continue;
    const bucket = yearMap.get(profile.academic_year);
    if (bucket) bucket.verified += 1;
  }
  const byAcademicYear = [...yearMap.entries()]
    .sort(([left], [right]) => {
      const leftIndex = yearOrder.indexOf(left);
      const rightIndex = yearOrder.indexOf(right);
      return (leftIndex === -1 ? yearOrder.length : leftIndex) - (rightIndex === -1 ? yearOrder.length : rightIndex);
    })
    .map(([academicYear, value]) => ({ academicYear, ...value }));

  const statusOrder = ["pending", "verified", "not_verified", "delayed", "error"];
  const statusMap = new Map<string, number>();
  for (const completion of participantCompletions) statusMap.set(completion.status, (statusMap.get(completion.status) ?? 0) + 1);
  const byStatus = [...statusMap.entries()]
    .sort(([left], [right]) => {
      const leftIndex = statusOrder.indexOf(left);
      const rightIndex = statusOrder.indexOf(right);
      return (leftIndex === -1 ? statusOrder.length : leftIndex) - (rightIndex === -1 ? statusOrder.length : rightIndex);
    })
    .map(([status, count]) => ({ status, count }));

  const registrations = profiles
    .map((profile) => {
      const stats = completionStats.get(profile.id);
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        leetcode_username: profile.leetcode_username,
        academic_year: profile.academic_year,
        points: profile.points ?? 0,
        streak: profile.streak ?? 0,
        role: profile.role === "admin" ? "admin" : "student",
        created_at: profile.created_at,
        solved: stats?.solved ?? 0,
        attempts: stats?.attempts ?? 0,
        last_activity_at: stats?.lastActivityAt ?? null,
      };
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      registrations: participants.length,
      admins: profiles.length - participants.length,
      activeChallengers,
      zeroProgress: participants.length - activeChallengers,
      verifiedCompletions: verifiedCompletions.length,
      attempts: participantCompletions.length,
      pointsAwarded,
      averagePoints: participants.length ? Math.round(totalPoints / participants.length) : 0,
      medianPoints,
      averageStreak: participants.length ? Math.round(streaks.reduce((total, streak) => total + streak, 0) / participants.length) : 0,
      longestStreak: streaks.length ? Math.max(...streaks) : 0,
      withLeetcode,
      withoutLeetcode: participants.length - withLeetcode,
    },
    byAcademicYear,
    byStatus,
    daily: [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({
      date,
      registrations: value.registrations,
      activeUsers: value.activeUsers.size,
      attempts: value.attempts,
      verified: value.verified,
      pointsAwarded: value.pointsAwarded,
    })),
    registrations,
  };
}

export async function getAdminCompletions(limit = 500) {
  if (!db) return [];
  const { data, error } = await db.from("completions").select("id,profile_id,challenge_id,status,attempted_at,verified_at,submission_at,awarded_points,created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const profileIds = [...new Set((data ?? []).map((completion) => completion.profile_id as string))];
  const challengeIds = [...new Set((data ?? []).map((completion) => completion.challenge_id as string))];
  const [{ data: profiles }, { data: challenges }] = await Promise.all([
    profileIds.length ? db.from("profiles").select("id,name,leetcode_username,academic_year").in("id", profileIds) : Promise.resolve({ data: [] }),
    challengeIds.length ? db.from("challenges").select("id,day,title,slug").in("id", challengeIds) : Promise.resolve({ data: [] }),
  ]);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const challengeMap = new Map((challenges ?? []).map((challenge) => [challenge.id, challenge]));
  return (data ?? []).map((completion) => ({ ...completion, profile: profileMap.get(completion.profile_id) ?? null, challenge: challengeMap.get(completion.challenge_id) ?? null }));
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
  // The database enforces one challenge per day. Check both constraints up
  // front so the admin UI can explain exactly what needs to change instead of
  // surfacing a generic Postgres duplicate-key error.
  const [{ data: dayTaken, error: dayError }, { data: slugTaken, error: slugError }] = await Promise.all([
    db.from("challenges").select("id").eq("day", input.day).maybeSingle(),
    db.from("challenges").select("id").eq("slug", input.slug).maybeSingle(),
  ]);
  if (dayError) throw dayError;
  if (slugError) throw slugError;
  if (dayTaken) throw new Error("day_taken");
  if (slugTaken) throw new Error("slug_taken");
  const { data, error } = await db.from("challenges").insert(input).select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").single();
  if (error) throw error;
  return data;
}

export type SiteSettings = { waitlistEnabled: boolean; message: string; launchAt: string | null; sprintStartedAt: string | null };

export type LaunchResult = { started: boolean; reason?: string; challengeId?: string; day?: number; publishedAt?: string; deadlineAt?: string; updatedCompletions?: number; updatedProfiles?: number };

export async function getSiteSettings(): Promise<SiteSettings> {
  const defaults: SiteSettings = { waitlistEnabled: false, message: "", launchAt: null, sprintStartedAt: null };
  if (!db) return defaults;
  const { data, error } = await db.from("site_settings").select("key,value");
  if (error) throw error;
  const map = new Map((data ?? []).map((row) => [row.key as string, row.value]));
  const message = map.get("waitlist_message");
  const launchAt = map.get("launch_at");
  const sprintStartedAt = map.get("sprint_started_at");
  return {
    waitlistEnabled: map.get("waitlist_enabled") === true,
    message: typeof message === "string" ? message : "",
    launchAt: typeof launchAt === "string" ? launchAt : null,
    sprintStartedAt: typeof sprintStartedAt === "string" ? sprintStartedAt : null,
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

export async function launchFirstChallenge(): Promise<LaunchResult> {
  if (!db) throw new Error("persistence_not_configured");
  const settings = await getSiteSettings();
  if (settings.sprintStartedAt) return { started: false, reason: "sprint_already_started" };

  const { data: challenge, error: challengeError } = await db.from("challenges").select("id,day").order("day", { ascending: true }).limit(1).maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) return { started: false, reason: "no_challenge" };

  const startedAt = new Date();
  const publishedAt = startedAt.toISOString();
  const deadlineAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: completions, error: completionError } = await db.from("completions").select("id,profile_id,status,submission_at,awarded_points").eq("challenge_id", challenge.id);
  if (completionError) throw completionError;
  const profileIds = [...new Set((completions ?? []).map((completion) => completion.profile_id as string))];

  const { error: challengeUpdateError } = await db.from("challenges").update({ published_at: publishedAt, deadline_at: deadlineAt }).eq("id", challenge.id);
  if (challengeUpdateError) throw challengeUpdateError;

  // Re-score anything that was verified while the waitlist was still on. A
  // Day 1 submission made during that preview is on time once the actual
  // launch clock starts, rather than being treated as a late submission
  // against the old scheduled deadline.
  let updatedCompletions = 0;
  for (const completion of completions ?? []) {
    if (completion.status !== "verified" || !completion.submission_at) continue;
    const nextPoints = pointsForCompletion(completion.submission_at, deadlineAt);
    if (completion.awarded_points === nextPoints) continue;
    const { error } = await db.from("completions").update({ awarded_points: nextPoints }).eq("id", completion.id);
    if (error) throw error;
    updatedCompletions += 1;
  }

  // Rebuild each affected profile's score from its verified completions so
  // the 70 -> 100 correction is reflected immediately and remains idempotent.
  for (const profileId of profileIds) {
    const { data: verified, error: verifiedError } = await db.from("completions").select("awarded_points").eq("profile_id", profileId).eq("status", "verified");
    if (verifiedError) throw verifiedError;
    const points = (verified ?? []).reduce((total, completion) => total + (completion.awarded_points ?? 0), 0);
    const { error: profileError } = await db.from("profiles").update({ points }).eq("id", profileId);
    if (profileError) throw profileError;
    await recalculateProfileStreak(profileId).catch((error) => console.error("streak_recalculation_failed", profileId, error));
  }

  // Record the actual launch time. Checking this marker makes repeated
  // waitlist toggles safe: they never silently extend Day 1 again.
  const { error: markerError } = await db.from("site_settings").upsert([
    { key: "sprint_started_at", value: publishedAt, updated_at: publishedAt },
    { key: "launch_at", value: publishedAt, updated_at: publishedAt },
  ], { onConflict: "key" });
  if (markerError) throw markerError;

  return { started: true, challengeId: challenge.id, day: challenge.day, publishedAt, deadlineAt, updatedCompletions, updatedProfiles: profileIds.length };
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
  if (data) await recalculateProfileStreak(profileId).catch((streakError) => console.error("streak_recalculation_failed", profileId, streakError));
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

function withJitter(delayMs: number) {
  // Long delays (daily-budget reset or a long Retry-After) should never be
  // shortened by jitter, or a job can wake before the budget actually resets.
  if (delayMs > 60 * 60_000) return delayMs + Math.round(Math.random() * 15 * 60_000);
  return Math.round(delayMs * (0.85 + Math.random() * 0.3));
}

export async function markPersistentRetry(job: ClaimedJob, errorMessage: string, maxRetries: number, delayMs = 20 * 60_000, countsAsAttempt = true) {
  if (!db) return;
  const terminal = countsAsAttempt && job.attempts >= maxRetries;
  await db.from("verification_jobs").update({
    status: terminal ? "failed" : "retry",
    // Infrastructure failures (429/cooldown/network) should not consume the
    // small not-found retry budget. The claim increased attempts; undo it.
    attempts: countsAsAttempt ? job.attempts : Math.max(0, job.attempts - 1),
    available_at: new Date(Date.now() + (terminal ? 0 : withJitter(delayMs))).toISOString(),
    last_error: errorMessage,
    locked_at: null,
  }).eq("id", job.id);
}

export async function markPersistentNotFound(job: ClaimedJob, maxRetries: number) {
  if (!db) return;
  const terminal = job.attempts >= maxRetries;
  await db.from("verification_jobs").update({
    status: terminal ? "failed" : "retry",
    available_at: new Date(Date.now() + (terminal ? 0 : withJitter(15 * 60_000))).toISOString(),
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
  if (data) await recalculateProfileStreak(job.profile_id).catch((streakError) => console.error("streak_recalculation_failed", job.profile_id, streakError));
  return Boolean(data);
}
