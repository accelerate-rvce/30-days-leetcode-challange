"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.persistenceEnabled = void 0;
exports.userIdFromAccessToken = userIdFromAccessToken;
exports.adminIdFromAccessToken = adminIdFromAccessToken;
exports.getPersistentProfile = getPersistentProfile;
exports.updatePersistentProfile = updatePersistentProfile;
exports.recordPersistentAttempt = recordPersistentAttempt;
exports.getPersistentCurrentChallenge = getPersistentCurrentChallenge;
exports.getPersistentChallenge = getPersistentChallenge;
exports.getPersistentChallenges = getPersistentChallenges;
exports.getPersistentProgress = getPersistentProgress;
exports.getPersistentLeaderboard = getPersistentLeaderboard;
exports.getPersistentJobMetrics = getPersistentJobMetrics;
exports.getPersistentAdminMetrics = getPersistentAdminMetrics;
exports.getAdminChallenges = getAdminChallenges;
exports.getAdminUsers = getAdminUsers;
exports.getAdminVerificationJobs = getAdminVerificationJobs;
exports.getAdminAuditLogs = getAdminAuditLogs;
exports.writeAdminAuditLog = writeAdminAuditLog;
exports.updateAdminChallenge = updateAdminChallenge;
exports.reorderAdminChallenges = reorderAdminChallenges;
exports.preparePersistentVerification = preparePersistentVerification;
exports.manuallyVerifyPersistentCompletion = manuallyVerifyPersistentCompletion;
exports.enqueuePersistentVerification = enqueuePersistentVerification;
exports.enqueueDuePersistentVerifications = enqueueDuePersistentVerifications;
exports.claimPersistentJobs = claimPersistentJobs;
exports.markPersistentRetry = markPersistentRetry;
exports.markPersistentNotFound = markPersistentNotFound;
exports.markPersistentVerified = markPersistentVerified;
const supabase_js_1 = require("@supabase/supabase-js");
const store_js_1 = require("./store.js");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
exports.persistenceEnabled = Boolean(url && serviceRoleKey);
exports.db = exports.persistenceEnabled ? (0, supabase_js_1.createClient)(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const configuredAdminEmails = new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
async function userIdFromAccessToken(token) {
    if (!exports.db || !token)
        return null;
    const { data, error } = await exports.db.auth.getUser(token);
    if (error || !data.user)
        return null;
    const user = data.user;
    const { data: existingProfile } = await exports.db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const isConfiguredAdmin = Boolean(user.email && configuredAdminEmails.has(user.email.toLowerCase()));
    if (isConfiguredAdmin && existingProfile && existingProfile.role !== "admin")
        await exports.db.from("profiles").update({ role: "admin" }).eq("id", user.id);
    await exports.db.from("profiles").upsert({ id: user.id, name: user.user_metadata?.full_name ?? user.email ?? "RVCE student", academic_year: user.user_metadata?.academic_year ?? "First Year", ...(isConfiguredAdmin ? { role: "admin" } : {}) }, { onConflict: "id", ignoreDuplicates: true });
    return user.id;
}
async function adminIdFromAccessToken(token) {
    const profileId = await userIdFromAccessToken(token);
    if (!profileId || !exports.db)
        return null;
    const { data, error } = await exports.db.from("profiles").select("role").eq("id", profileId).single();
    if (error || data?.role !== "admin")
        return null;
    return profileId;
}
async function getPersistentProfile(profileId) {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,longest_streak,role").eq("id", profileId).single();
    if (error)
        throw error;
    return data;
}
async function updatePersistentProfile(profileId, updates) {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("profiles").upsert({ id: profileId, ...updates }, { onConflict: "id" }).select("id,name,leetcode_username,academic_year,points,streak,longest_streak,role").single();
    if (error)
        throw error;
    return data;
}
async function recordPersistentAttempt(profileId, challenge) {
    if (!exports.db)
        throw new Error("persistence_not_configured");
    const { error } = await exports.db.from("completions").upsert({ profile_id: profileId, challenge_id: challenge.id, status: "pending" }, { onConflict: "profile_id,challenge_id", ignoreDuplicates: true });
    if (error)
        throw error;
    if (Date.now() >= Date.parse(challenge.deadlineAt))
        await enqueuePersistentVerification(profileId, challenge.id);
    const { data } = await exports.db.from("completions").select("attempted_at").eq("profile_id", profileId).eq("challenge_id", challenge.id).single();
    return { attemptedAt: data?.attempted_at ?? new Date().toISOString(), deadlineAt: challenge.deadlineAt };
}
async function getPersistentCurrentChallenge() {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", new Date().toISOString()).order("day", { ascending: false }).limit(1).maybeSingle();
    if (error)
        throw error;
    return data ? { id: data.id, day: data.day, title: data.title, slug: data.slug, difficulty: data.difficulty, topic: data.topic, points: data.points, publishedAt: data.published_at, deadlineAt: data.deadline_at, verificationQueuedAt: data.verification_queued_at } : null;
}
async function getPersistentChallenge(challengeId) {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").eq("id", challengeId).maybeSingle();
    if (error)
        throw error;
    return data ? { id: data.id, day: data.day, title: data.title, slug: data.slug, difficulty: data.difficulty, topic: data.topic, points: data.points, publishedAt: data.published_at, deadlineAt: data.deadline_at, verificationQueuedAt: data.verification_queued_at } : null;
}
async function getPersistentChallenges() {
    if (!exports.db)
        return [];
    const { data, error } = await exports.db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").lte("published_at", new Date().toISOString()).order("day", { ascending: false });
    if (error)
        throw error;
    return (data ?? []).map((item) => ({ id: item.id, day: item.day, title: item.title, slug: item.slug, difficulty: item.difficulty, topic: item.topic, points: item.points, publishedAt: item.published_at, deadlineAt: item.deadline_at, verificationQueuedAt: item.verification_queued_at }));
}
async function getPersistentProgress(profileId) {
    if (!exports.db)
        return null;
    const [{ data: profile, error: profileError }, { data: completions, error: completionError }] = await Promise.all([
        exports.db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,role").eq("id", profileId).single(),
        exports.db.from("completions").select("id,challenge_id,status,attempted_at,verified_at,submission_at,awarded_points,evidence").eq("profile_id", profileId).order("attempted_at", { ascending: false }),
    ]);
    if (profileError)
        throw profileError;
    if (completionError)
        throw completionError;
    const verified = (completions ?? []).filter((item) => item.status === "verified");
    return { profile, verifiedCompletions: verified.length, completionPercentage: Math.round((verified.length / 30) * 100), statuses: completions ?? [] };
}
async function getPersistentLeaderboard(query) {
    if (!exports.db)
        return null;
    let request = exports.db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak").order("points", { ascending: false }).order("streak", { ascending: false });
    const safeQuery = query.replace(/[,%()]/g, "");
    if (safeQuery)
        request = request.or(`name.ilike.%${safeQuery}%,leetcode_username.ilike.%${safeQuery}%`);
    const [{ data, error }, { data: verifiedCompletions, error: completionError }] = await Promise.all([
        request,
        exports.db.from("completions").select("profile_id").eq("status", "verified"),
    ]);
    if (error)
        throw error;
    if (completionError)
        throw completionError;
    const solvedByProfile = new Map();
    for (const completion of verifiedCompletions ?? [])
        solvedByProfile.set(completion.profile_id, (solvedByProfile.get(completion.profile_id) ?? 0) + 1);
    return (data ?? []).map((profile, index) => ({ rank: index + 1, name: profile.name, handle: profile.leetcode_username ?? "", academicYear: profile.academic_year, points: profile.points, streak: profile.streak ?? 0, solved: solvedByProfile.get(profile.id) ?? 0 }));
}
async function getPersistentJobMetrics() {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("verification_jobs").select("status");
    if (error)
        throw error;
    const rows = data ?? [];
    return { queued: rows.filter((row) => row.status === "queued").length, processing: rows.filter((row) => row.status === "processing").length, retrying: rows.filter((row) => row.status === "retry").length, terminalFailures: rows.filter((row) => row.status === "failed").length };
}
async function getPersistentAdminMetrics() {
    if (!exports.db)
        return null;
    const [{ count: participantCount, error: participantError }, { count: verifiedCount, error: verifiedError }, jobs] = await Promise.all([
        exports.db.from("profiles").select("id", { count: "exact", head: true }).neq("role", "admin"),
        exports.db.from("completions").select("id", { count: "exact", head: true }).eq("status", "verified"),
        getPersistentJobMetrics(),
    ]);
    if (participantError)
        throw participantError;
    if (verifiedError)
        throw verifiedError;
    return { health: "Online", participants: participantCount ?? 0, verified: verifiedCount ?? 0, queued: (jobs?.queued ?? 0) + (jobs?.retrying ?? 0), failed: jobs?.terminalFailures ?? 0 };
}
async function getAdminChallenges() {
    if (!exports.db)
        return [];
    const { data, error } = await exports.db.from("challenges").select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").order("day", { ascending: true });
    if (error)
        throw error;
    return data ?? [];
}
async function getAdminUsers(query = "") {
    if (!exports.db)
        return [];
    let request = exports.db.from("profiles").select("id,name,leetcode_username,academic_year,points,streak,role").neq("role", "admin").order("points", { ascending: false }).limit(200);
    const safeQuery = query.replace(/[,%()]/g, "");
    if (safeQuery)
        request = request.or(`name.ilike.%${safeQuery}%,leetcode_username.ilike.%${safeQuery}%`);
    const [{ data, error }, { data: completions, error: completionError }] = await Promise.all([
        request,
        exports.db.from("completions").select("profile_id").eq("status", "verified"),
    ]);
    if (error)
        throw error;
    if (completionError)
        throw completionError;
    const solved = new Map();
    for (const completion of completions ?? [])
        solved.set(completion.profile_id, (solved.get(completion.profile_id) ?? 0) + 1);
    return (data ?? []).map((profile) => ({ ...profile, solved: solved.get(profile.id) ?? 0 }));
}
async function getAdminVerificationJobs(limit = 100) {
    if (!exports.db)
        return [];
    const { data, error } = await exports.db.from("verification_jobs").select("id,profile_id,challenge_id,status,attempts,available_at,locked_at,last_error,created_at").order("created_at", { ascending: false }).limit(limit);
    if (error)
        throw error;
    const profileIds = [...new Set((data ?? []).map((job) => job.profile_id))];
    const challengeIds = [...new Set((data ?? []).map((job) => job.challenge_id))];
    const [{ data: profiles }, { data: challenges }] = await Promise.all([
        profileIds.length ? exports.db.from("profiles").select("id,name,leetcode_username").in("id", profileIds) : Promise.resolve({ data: [] }),
        challengeIds.length ? exports.db.from("challenges").select("id,day,title,slug").in("id", challengeIds) : Promise.resolve({ data: [] }),
    ]);
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const challengeMap = new Map((challenges ?? []).map((challenge) => [challenge.id, challenge]));
    return (data ?? []).map((job) => ({ ...job, profile: profileMap.get(job.profile_id) ?? null, challenge: challengeMap.get(job.challenge_id) ?? null }));
}
async function getAdminAuditLogs(limit = 100) {
    if (!exports.db)
        return [];
    const { data, error } = await exports.db.from("admin_audit_logs").select("id,admin_profile_id,action,target_profile_id,target_challenge_id,status,message,metadata,created_at").order("created_at", { ascending: false }).limit(limit);
    if (error)
        throw error;
    return data ?? [];
}
async function writeAdminAuditLog(adminProfileId, entry) {
    if (!exports.db)
        return;
    const { error } = await exports.db.from("admin_audit_logs").insert({ admin_profile_id: adminProfileId, action: entry.action, status: entry.status, message: entry.message, target_profile_id: entry.targetProfileId, target_challenge_id: entry.targetChallengeId, metadata: entry.metadata ?? {} });
    if (error)
        throw error;
}
async function updateAdminChallenge(challengeId, updates) {
    if (!exports.db)
        return null;
    const { data, error } = await exports.db.from("challenges").update(updates).eq("id", challengeId).select("id,day,title,slug,difficulty,topic,points,published_at,deadline_at,verification_queued_at").single();
    if (error)
        throw error;
    return data;
}
async function reorderAdminChallenges(order) {
    if (!exports.db)
        return;
    const { error } = await exports.db.rpc("admin_reorder_challenges", { p_order: order.map((id) => ({ id })) });
    if (error)
        throw error;
}
async function preparePersistentVerification(profileId, challengeId) {
    if (!exports.db)
        throw new Error("persistence_not_configured");
    const { error: completionError } = await exports.db.from("completions").upsert({ profile_id: profileId, challenge_id: challengeId, status: "pending" }, { onConflict: "profile_id,challenge_id", ignoreDuplicates: true });
    if (completionError)
        throw completionError;
    await enqueuePersistentVerification(profileId, challengeId);
    const { data, error } = await exports.db.from("verification_jobs").select("id,status").eq("profile_id", profileId).eq("challenge_id", challengeId).single();
    if (error)
        throw error;
    return data;
}
async function manuallyVerifyPersistentCompletion(profileId, challengeId, submissionId, submissionAt) {
    if (!exports.db)
        throw new Error("persistence_not_configured");
    const challenge = await getPersistentChallenge(challengeId);
    if (!challenge)
        throw new Error("challenge_not_found");
    const job = await preparePersistentVerification(profileId, challengeId);
    const awardedPoints = (0, store_js_1.pointsForCompletion)(submissionAt, challenge.deadlineAt);
    const { data, error } = await exports.db.rpc("finalize_verified_completion", { p_job_id: job.id, p_profile_id: profileId, p_challenge_id: challengeId, p_submission_id: submissionId, p_submission_at: submissionAt, p_awarded_points: awardedPoints, p_evidence: { source: "admin_manual_verification", submissionId } });
    if (error)
        throw error;
    return { changed: Boolean(data), awardedPoints };
}
async function enqueuePersistentVerification(profileId, challengeId) {
    if (!exports.db)
        return;
    const { error } = await exports.db.rpc("enqueue_verification_job", { p_profile_id: profileId, p_challenge_id: challengeId });
    if (error)
        throw error;
}
async function enqueueDuePersistentVerifications() {
    if (!exports.db)
        return;
    const { error } = await exports.db.rpc("enqueue_due_verification_jobs");
    if (error)
        throw error;
}
async function claimPersistentJobs(limit = 50) {
    if (!exports.db)
        return [];
    const { data, error } = await exports.db.rpc("claim_verification_jobs", { p_limit: limit, p_lock_seconds: 300 });
    if (error)
        throw error;
    return (data ?? []);
}
async function markPersistentRetry(job, errorMessage, maxRetries) {
    if (!exports.db)
        return;
    const terminal = job.attempts >= maxRetries;
    await exports.db.from("verification_jobs").update({
        status: terminal ? "failed" : "retry",
        available_at: new Date(Date.now() + (terminal ? 0 : 20 * 60_000)).toISOString(),
        last_error: errorMessage,
        locked_at: null,
    }).eq("id", job.id);
}
async function markPersistentNotFound(job, maxRetries) {
    if (!exports.db)
        return;
    const terminal = job.attempts >= maxRetries;
    await exports.db.from("verification_jobs").update({
        status: terminal ? "failed" : "retry",
        available_at: new Date(Date.now() + (terminal ? 0 : 15 * 60_000)).toISOString(),
        last_error: "no_matching_accepted_submission",
        locked_at: null,
    }).eq("id", job.id);
}
async function markPersistentVerified(job, submissionId, submissionAt, challenge) {
    if (!exports.db)
        return false;
    const awardedPoints = (0, store_js_1.pointsForCompletion)(submissionAt, challenge.deadlineAt);
    const { data, error } = await exports.db.rpc("finalize_verified_completion", {
        p_job_id: job.id,
        p_profile_id: job.profile_id,
        p_challenge_id: job.challenge_id,
        p_submission_id: submissionId,
        p_submission_at: submissionAt,
        p_awarded_points: awardedPoints,
        p_evidence: { source: "leetcode_recent_ac_submission", slug: challenge.slug },
    });
    if (error)
        throw error;
    return Boolean(data);
}
