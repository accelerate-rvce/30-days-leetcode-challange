import { Request, Response, Router } from "express";
import { z } from "zod";
import { adminIdFromAccessToken, createAdminChallenge, getAdminAuditLogs, getAdminChallenges, getAdminUsers, getAdminVerificationJobs, getPersistentAdminMetrics, getPersistentChallenge, getPersistentChallenges, getPersistentCurrentChallenge, getPersistentJobMetrics, getPersistentLeaderboard, getPersistentProgress, getPersistentProfile, enqueuePersistentVerification, getSiteSettings, manuallyVerifyPersistentCompletion, persistenceEnabled, preparePersistentVerification, recordPersistentAttempt, reorderAdminChallenges, updateAdminChallenge, updatePersistentProfile, updateSiteSettings, userIdFromAccessToken, writeAdminAuditLog } from "./persistence.js";
import { runPersistentVerificationCycle } from "./persistent-worker.js";

const router = Router();
const authToken = (value?: string) => value?.replace(/^Bearer\s+/i, "");
async function requireAdmin(req: Request, res: Response) {
  if (!persistenceEnabled) { res.status(503).json({ error: "persistence_not_configured" }); return null; }
  const adminId = await adminIdFromAccessToken(authToken(req.header("authorization")));
  if (!adminId) { res.status(403).json({ error: "admin_access_required" }); return null; }
  return adminId;
}
function normalizeLeetCodeUsername(value: string) {
  const input = value.trim().replace(/[\])}>]+$/, "");
  try {
    const parsed = new URL(input);
    if (parsed.hostname === "leetcode.com" || parsed.hostname === "www.leetcode.com") {
      const match = parsed.pathname.match(/^\/u\/([^/]+)\/?$/i);
      if (match) return decodeURIComponent(match[1]);
    }
  } catch { /* raw username */ }
  return input.replace(/^@+/, "");
}

// Waitlist gate: when enabled, only admins may see challenges, attempt
// questions, or trigger verification. Registration (sign-in + PATCH
// /profile) always stays open. Missing table = gate open (pre-migration).
async function launchOpen(req: Request): Promise<boolean> {
  try {
    const settings = await getSiteSettings();
    if (!settings.waitlistEnabled) return true;
  } catch { return true; }
  try {
    return Boolean(await adminIdFromAccessToken(authToken(req.header("authorization"))));
  } catch { return false; }
}

router.get("/settings", async (_req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  try {
    return res.json(await getSiteSettings());
  } catch {
    return res.json({ waitlistEnabled: false, message: "", launchAt: null });
  }
});

router.get("/challenges/current", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await launchOpen(req)) return res.status(403).json({ error: "launch_not_open" });
  return res.json({ challenge: await getPersistentCurrentChallenge() });
});
router.get("/challenges", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await launchOpen(req)) return res.status(403).json({ error: "launch_not_open" });
  return res.json({ challenges: await getPersistentChallenges() });
});

router.post("/events/open", async (req, res) => {
  const parsed = z.object({ challengeId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "challengeId is required" });
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await launchOpen(req)) return res.status(403).json({ error: "launch_not_open" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  const challenge = await getPersistentChallenge(parsed.data.challengeId);
  if (!challenge) return res.status(404).json({ error: "challenge_not_found" });
  const attempt = await recordPersistentAttempt(profileId, challenge);
  return res.status(202).json({ recorded: true, persisted: true, status: "attempt_recorded", attemptedAt: attempt.attemptedAt, verificationStartsAfter: challenge.deadlineAt, scoring: { onTimePoints: 100, latePoints: 70, deadlineAt: challenge.deadlineAt } });
});

router.post("/verification/request", async (req, res) => {
  const parsed = z.object({ challengeId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "challengeId is required" });
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await launchOpen(req)) return res.status(403).json({ error: "launch_not_open" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  await enqueuePersistentVerification(profileId, parsed.data.challengeId);
  // Kick off a verification cycle immediately so 1 accepted LeetCode
  // submission awards points within seconds instead of waiting for the
  // 60s timer / 10min cron. Fire-and-forget: response stays fast.
  void runPersistentVerificationCycle().catch(() => {});
  return res.status(202).json({ queued: true, persisted: true });
});

router.post("/cron/verify", async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.header("x-cron-secret") !== expected) return res.status(401).json({ error: "unauthorized" });
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  return res.status(202).json({ accepted: true, ...(await runPersistentVerificationCycle()) });
});

router.get("/progress", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  return res.json(await getPersistentProgress(profileId));
});
router.get("/profile", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  return res.json({ profile: await getPersistentProfile(profileId) });
});
router.patch("/profile", async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120).optional(), leetcode_username: z.string().trim().min(1).max(300).optional(), academic_year: z.enum(["First Year", "Second Year", "Third Year", "Fourth Year"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_profile" });
  const updates = { ...parsed.data, ...(parsed.data.leetcode_username ? { leetcode_username: normalizeLeetCodeUsername(parsed.data.leetcode_username) } : {}) };
  if (updates.leetcode_username && !/^[A-Za-z0-9_-]+$/.test(updates.leetcode_username)) return res.status(400).json({ error: "invalid_leetcode_username" });
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  return res.json({ profile: await updatePersistentProfile(profileId, updates) });
});

router.get("/leaderboard", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const rows = (await getPersistentLeaderboard(String(req.query.search ?? "").toLowerCase())) ?? [];
  return res.json({ currentDay: rows.length ? 0 : null, totalParticipants: rows.length, verifiedCompletions: 0, updatedAt: new Date().toISOString(), rows });
});

router.get("/jobs/metrics", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await adminIdFromAccessToken(authToken(req.header("authorization")))) return res.status(403).json({ error: "admin_access_required" });
  return res.json({ ...(await getPersistentJobMetrics()), paused: false, pausedUntil: null, recentAlerts: [] });
});

router.get("/admin/metrics", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await adminIdFromAccessToken(authToken(req.header("authorization")))) return res.status(403).json({ error: "admin_access_required" });
  return res.json(await getPersistentAdminMetrics());
});

router.get("/admin/overview", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const [metrics, challenges, users, jobs, logs] = await Promise.all([getPersistentAdminMetrics(), getAdminChallenges(), getAdminUsers(String(req.query.search ?? "")), getAdminVerificationJobs(), getAdminAuditLogs()]);
  return res.json({ metrics, challenges, users, jobs, logs });
});

router.post("/admin/challenges", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({
    day: z.number().int().min(1).max(30),
    title: z.string().trim().min(1).max(160),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/),
    difficulty: z.enum(["Easy", "Medium", "Hard"]),
    topic: z.string().trim().min(1).max(80),
    points: z.number().int().min(1).max(100),
    published_at: z.string().datetime({ offset: true }),
    deadline_at: z.string().datetime({ offset: true }),
  }).refine((value) => Date.parse(value.deadline_at) > Date.parse(value.published_at), { message: "deadline_must_be_after_publish" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_challenge", details: parsed.error.flatten() });
  try {
    const challenge = await createAdminChallenge(parsed.data);
    await writeAdminAuditLog(adminId, { action: "create_challenge", status: "success", message: `Added Day ${challenge?.day} · ${challenge?.title}`, targetChallengeId: challenge?.id, metadata: parsed.data });
    return res.status(201).json({ challenge });
  } catch (error) {
    const message = error instanceof Error ? error.message : "challenge_create_failed";
    await writeAdminAuditLog(adminId, { action: "create_challenge", status: "error", message, metadata: parsed.data });
    const conflict = /duplicate|unique|already exists/i.test(message);
    return res.status(conflict ? 409 : 400).json({ error: conflict ? "day_or_slug_taken" : "challenge_create_failed" });
  }
});

router.patch("/admin/challenges/:challengeId", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({ title: z.string().trim().min(1).max(160).optional(), slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(), difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(), topic: z.string().trim().min(1).max(80).optional(), points: z.number().int().positive().max(100).optional(), published_at: z.string().datetime({ offset: true }).optional(), deadline_at: z.string().datetime({ offset: true }).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_challenge_update" });
  try {
    const challenge = await updateAdminChallenge(req.params.challengeId, parsed.data);
    await writeAdminAuditLog(adminId, { action: "edit_challenge", status: "success", message: `Updated challenge ${challenge?.title ?? req.params.challengeId}`, targetChallengeId: req.params.challengeId, metadata: parsed.data });
    return res.json({ challenge });
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "edit_challenge", status: "error", message: error instanceof Error ? error.message : "challenge_update_failed", targetChallengeId: req.params.challengeId });
    return res.status(400).json({ error: "challenge_update_failed" });
  }
});

router.post("/admin/challenges/reorder", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({ order: z.array(z.string().uuid()).min(1).max(30) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_challenge_order" });
  try {
    await reorderAdminChallenges(parsed.data.order);
    await writeAdminAuditLog(adminId, { action: "reorder_challenges", status: "success", message: `Reordered ${parsed.data.order.length} challenges`, metadata: { order: parsed.data.order } });
    return res.json({ updated: true, challenges: await getAdminChallenges() });
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "reorder_challenges", status: "error", message: error instanceof Error ? error.message : "challenge_reorder_failed" });
    return res.status(400).json({ error: "challenge_reorder_failed" });
  }
});

router.post("/admin/verification/start", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({ profileId: z.string().uuid(), challengeId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "profileId_and_challengeId_are_required" });
  try {
    const job = await preparePersistentVerification(parsed.data.profileId, parsed.data.challengeId);
    await writeAdminAuditLog(adminId, { action: "queue_verification", status: "success", message: "Verification job queued", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId, metadata: { jobId: job.id } });
    return res.status(202).json({ queued: true, job });
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "queue_verification", status: "error", message: error instanceof Error ? error.message : "verification_queue_failed", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId });
    return res.status(400).json({ error: "verification_queue_failed" });
  }
});

router.post("/admin/verification/manual", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({ profileId: z.string().uuid(), challengeId: z.string().uuid(), submissionId: z.string().trim().min(1).max(200), submissionAt: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.submissionAt))) return res.status(400).json({ error: "valid_submission_details_are_required" });
  try {
    const result = await manuallyVerifyPersistentCompletion(parsed.data.profileId, parsed.data.challengeId, parsed.data.submissionId, new Date(parsed.data.submissionAt).toISOString());
    await writeAdminAuditLog(adminId, { action: "manual_verification", status: "success", message: result.changed ? `Manually verified and awarded ${result.awardedPoints} points` : "Already verified; no duplicate points awarded", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId, metadata: { submissionId: parsed.data.submissionId, changed: result.changed, awardedPoints: result.awardedPoints } });
    return res.json({ verified: result.changed, duplicate: !result.changed, awardedPoints: result.changed ? result.awardedPoints : 0 });
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "manual_verification", status: "error", message: error instanceof Error ? error.message : "manual_verification_failed", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId });
    return res.status(400).json({ error: "manual_verification_failed" });
  }
});

router.post("/admin/verification/run", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  try {
    const result = await runPersistentVerificationCycle();
    await writeAdminAuditLog(adminId, { action: "run_verification_cycle", status: "success", message: result.running ? "Verification cycle is already running" : `Verification cycle processed ${result.claimed} jobs`, metadata: result });
    return res.status(202).json(result);
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "run_verification_cycle", status: "error", message: error instanceof Error ? error.message : "verification_cycle_failed" });
    return res.status(500).json({ error: "verification_cycle_failed" });
  }
});

router.get("/admin/settings", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  try {
    return res.json(await getSiteSettings());
  } catch (error) {
    return res.status(400).json({ error: "settings_unavailable_apply_migration_005" });
  }
});

router.patch("/admin/settings", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({
    waitlistEnabled: z.boolean().optional(),
    message: z.string().trim().max(500).optional(),
    launchAt: z.string().trim().max(64).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_settings" });
  const patch: { waitlistEnabled?: boolean; message?: string; launchAt?: string | null } = {};
  if (parsed.data.waitlistEnabled !== undefined) patch.waitlistEnabled = parsed.data.waitlistEnabled;
  if (parsed.data.message !== undefined) patch.message = parsed.data.message;
  if (parsed.data.launchAt !== undefined) {
    if (parsed.data.launchAt && !Number.isFinite(Date.parse(parsed.data.launchAt))) return res.status(400).json({ error: "invalid_launch_at" });
    patch.launchAt = parsed.data.launchAt ? new Date(parsed.data.launchAt).toISOString() : null;
  }
  try {
    const settings = await updateSiteSettings(patch);
    await writeAdminAuditLog(adminId, { action: "update_settings", status: "success", message: `Waitlist ${settings.waitlistEnabled ? "enabled" : "disabled"}`, metadata: patch as Record<string, unknown> });
    return res.json(settings);
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "update_settings", status: "error", message: error instanceof Error ? error.message : "settings_update_failed" });
    return res.status(400).json({ error: "settings_update_failed_apply_migration_005" });
  }
});

router.get("/admin/logs", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  return res.json({ logs: await getAdminAuditLogs(Number(req.query.limit ?? 100)) });
});

export default router;
