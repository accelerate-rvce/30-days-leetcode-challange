import { Request, Response, Router } from "express";
import { z } from "zod";
import { adminIdFromAccessToken, createAdminChallenge, deleteAdminChallenge, getAdminAnalytics, getAdminAuditLogs, getAdminChallenges, getAdminCompletions, getAdminUsers, getAdminVerificationJobs, getLeetCodeUsernameOwner, getNextChallengePublishAt, getPersistentAdminMetrics, getPersistentChallenge, getPersistentChallenges, getPersistentCurrentChallenge, getPersistentJobMetrics, getPersistentLeaderboard, getPersistentProgress, getPersistentProfile, enqueuePersistentVerification, getSiteSettings, launchFirstChallenge, manuallyVerifyPersistentCompletion, persistenceEnabled, preparePersistentVerification, recordPersistentAttempt, reorderAdminChallenges, resetCohort, updateAdminChallenge, updatePersistentProfile, updateSiteSettings, userIdFromAccessToken, writeAdminAuditLog } from "./persistence.js";
import { runPersistentVerificationCycle } from "./persistent-worker.js";
import { checkLeetCodeUser, leetcodeRateLimitRemainingMs } from "./leetcode.js";

const router = Router();
const authToken = (value?: string) => value?.replace(/^Bearer\s+/i, "");
const configuredKickCooldown = Number(process.env.VERIFICATION_KICK_COOLDOWN_MS ?? 15_000);
const verificationKickCooldownMs = Number.isFinite(configuredKickCooldown) ? Math.max(0, configuredKickCooldown) : 15_000;
const lastVerificationKick = new Map<string, number>();
async function requireAdmin(req: Request, res: Response) {
  if (!persistenceEnabled) { res.status(503).json({ error: "persistence_not_configured" }); return null; }
  const adminId = await adminIdFromAccessToken(authToken(req.header("authorization")));
  if (!adminId) { res.status(403).json({ error: "admin_access_required" }); return null; }
  return adminId;
}
const leetcodeUsernamePattern = /^[A-Za-z0-9._-]+$/;
const reservedLeetcodePaths = new Set(["accounts", "assessment", "contest", "discuss", "explore", "interview", "premium", "problems", "profile", "store", "studyplan", "submissions", "u"]);

// Accept both a bare LeetCode username (including dots, e.g. "a.b") and a
// pasted profile URL. URLs may omit the scheme and may use either the /u/
// form or the older single-segment form.
export function normalizeLeetCodeUsername(value: string) {
  let input = value.trim().replace(/^@+/, "").replace(/[\])}>]+$/, "");
  if (!input) return "";
  if (/^(?:www\.)?leetcode\.com(?:\/|$)/i.test(input)) input = `https://${input}`;
  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "leetcode.com") {
      const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
      if (segments[0]?.toLowerCase() === "u" && segments[1]) return segments[1];
      if (segments.length === 1 && !reservedLeetcodePaths.has(segments[0].toLowerCase())) return segments[0];
    }
  } catch { /* raw username */ }
  return input.replace(/\/+$/, "");
}

// Waitlist gate: when enabled, only admins may see challenges, attempt
// questions, or trigger verification. Registration (sign-in + PATCH
// /profile) always stays open. If settings cannot be read, fail closed rather
// than exposing student data or challenge content.
async function launchOpen(req: Request): Promise<boolean> {
  try {
    const settings = await getSiteSettings();
    if (!settings.waitlistEnabled) return true;
  } catch { return false; }
  try {
    return Boolean(await adminIdFromAccessToken(authToken(req.header("authorization"))));
  } catch { return false; }
}

router.get("/settings", async (_req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  try {
    return res.json(await getSiteSettings());
  } catch {
    return res.status(503).json({ error: "settings_unavailable" });
  }
});

// One request for everything the dashboard paints on first load. It replaces
// four separate calls, each of which paid for its own CORS preflight, token
// validation and database round trips. The pieces are fetched in parallel and
// the launch gate is applied to the response, so closed cohorts still receive
// no challenge content.
router.get("/bootstrap", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });

  try {
    const [settings, progress, leaderboard, challenge, challenges, nextPublishAt] = await Promise.all([
      getSiteSettings(),
      getPersistentProgress(profileId),
      getPersistentLeaderboard(""),
      getPersistentCurrentChallenge(),
      getPersistentChallenges(),
      getNextChallengePublishAt(),
    ]);
    const isAdmin = progress?.profile.role === "admin";
    const launchGated = Boolean(settings.waitlistEnabled && !isAdmin);

    const admin = isAdmin
      ? await Promise.all([getPersistentAdminMetrics(), getAdminChallenges(), getAdminUsers(), getAdminVerificationJobs(), getAdminAuditLogs(), getAdminCompletions()])
        .then(([metrics, adminChallenges, users, jobs, logs, completions]) => ({ metrics, challenges: adminChallenges, users, jobs, logs, completions }))
        .catch(() => null)
      : null;

    res.set("Cache-Control", "private, no-store");
    return res.json({
      settings,
      launchGated,
      challenge: launchGated ? null : challenge,
      challenges: launchGated ? [] : challenges,
      nextPublishAt: launchGated ? null : nextPublishAt,
      progress,
      // The leaderboard endpoint has always been closed with the gate; keep
      // that parity so a pre-launch response carries no cohort data.
      leaderboard: launchGated ? [] : leaderboard,
      admin,
    });
  } catch (bootstrapError) {
    console.error("bootstrap_failed", profileId, bootstrapError);
    return res.status(503).json({ error: "bootstrap_unavailable" });
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
  // 60s timer / 10min cron. A per-profile cooldown prevents a student from
  // turning repeated clicks into a stream of LeetCode requests.
  const now = Date.now();
  const lastKick = lastVerificationKick.get(profileId) ?? 0;
  const immediate = now - lastKick >= verificationKickCooldownMs;
  if (immediate) {
    lastVerificationKick.set(profileId, now);
    // Keep the fire-and-forget response fast; the cron/timer is the fallback.
    void runPersistentVerificationCycle().catch(() => {});
    if (lastVerificationKick.size > 5_000) {
      for (const [id, at] of lastVerificationKick) {
        if (now - at > 60 * 60_000) lastVerificationKick.delete(id);
      }
    }
  }
  return res.status(202).json({ queued: true, persisted: true, status: "pending", immediate });
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
  const normalizedHandle = parsed.data.leetcode_username ? normalizeLeetCodeUsername(parsed.data.leetcode_username) : undefined;
  if (normalizedHandle !== undefined && (normalizedHandle.length > 80 || !leetcodeUsernamePattern.test(normalizedHandle))) return res.status(400).json({ error: "invalid_leetcode_username" });
  const updates = { ...parsed.data, ...(normalizedHandle !== undefined ? { leetcode_username: normalizedHandle } : {}) };
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  const currentProfile = await getPersistentProfile(profileId);
  const currentHandle = currentProfile?.leetcode_username?.trim() ?? "";
  if (!currentHandle && normalizedHandle === undefined && currentProfile?.role !== "admin") return res.status(400).json({ error: "leetcode_username_required" });
  if (normalizedHandle !== undefined && normalizedHandle !== currentHandle) {
    const check = await checkLeetCodeUser(normalizedHandle);
    if (check.kind === "not_found") return res.status(400).json({ error: "leetcode_username_not_found" });
    // If LeetCode is unavailable or rate-limiting us, save the normalized
    // handle without the existence check. The verification worker will use it
    // later once submissions start arriving.
    if (check.username) updates.leetcode_username = check.username;
    const owner = await getLeetCodeUsernameOwner(updates.leetcode_username ?? normalizedHandle, profileId);
    if (owner) return res.status(409).json({ error: "leetcode_username_taken" });
  }
  return res.json({ profile: await updatePersistentProfile(profileId, updates) });
});

router.get("/leaderboard", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await launchOpen(req)) return res.status(403).json({ error: "launch_not_open" });
  const rows = (await getPersistentLeaderboard(String(req.query.search ?? "").toLowerCase())) ?? [];
  return res.json({ currentDay: rows.length ? 0 : null, totalParticipants: rows.length, verifiedCompletions: 0, updatedAt: new Date().toISOString(), rows });
});

router.get("/jobs/metrics", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await adminIdFromAccessToken(authToken(req.header("authorization")))) return res.status(403).json({ error: "admin_access_required" });
  const cooldownMs = leetcodeRateLimitRemainingMs();
  return res.json({ ...(await getPersistentJobMetrics()), paused: cooldownMs > 0, pausedUntil: cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null, recentAlerts: [] });
});

router.get("/admin/metrics", async (req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  if (!await adminIdFromAccessToken(authToken(req.header("authorization")))) return res.status(403).json({ error: "admin_access_required" });
  return res.json(await getPersistentAdminMetrics());
});

router.get("/admin/overview", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const [metrics, challenges, users, jobs, logs, completions] = await Promise.all([getPersistentAdminMetrics(), getAdminChallenges(), getAdminUsers(String(req.query.search ?? "")), getAdminVerificationJobs(), getAdminAuditLogs(), getAdminCompletions()]);
  return res.json({ metrics, challenges, users, jobs, logs, completions });
});

router.get("/admin/analytics", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  try {
    return res.json(await getAdminAnalytics());
  } catch {
    return res.status(503).json({ error: "analytics_unavailable" });
  }
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
    const errorCode = message === "day_taken" || message === "slug_taken"
      ? message
      : /duplicate|unique|already exists/i.test(message) ? "day_or_slug_taken" : "challenge_create_failed";
    return res.status(errorCode === "challenge_create_failed" ? 400 : 409).json({ error: errorCode });
  }
});

router.patch("/admin/challenges/:challengeId", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const challengeId = z.string().uuid().safeParse(req.params.challengeId);
  if (!challengeId.success) return res.status(400).json({ error: "invalid_challenge_id" });
  const parsed = z.object({
    day: z.number().int().min(1).max(30).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).optional(),
    difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
    topic: z.string().trim().min(1).max(80).optional(),
    points: z.number().int().positive().max(100).optional(),
    published_at: z.string().datetime({ offset: true }).optional(),
    deadline_at: z.string().datetime({ offset: true }).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    await writeAdminAuditLog(adminId, { action: "edit_challenge", status: "error", message: "invalid_challenge_update", targetChallengeId: challengeId.data, metadata: { details: parsed.error.flatten() } }).catch(() => {});
    return res.status(400).json({ error: "invalid_challenge_update", details: parsed.error.flatten() });
  }
  try {
    const challenge = await updateAdminChallenge(challengeId.data, parsed.data);
    await writeAdminAuditLog(adminId, { action: "edit_challenge", status: "success", message: `Updated Day ${challenge?.day} · ${challenge?.title ?? challengeId.data}`, targetChallengeId: challengeId.data, metadata: parsed.data });
    return res.json({ challenge });
  } catch (error) {
    const message = error instanceof Error ? error.message : "challenge_update_failed";
    await writeAdminAuditLog(adminId, { action: "edit_challenge", status: "error", message, targetChallengeId: challengeId.data }).catch(() => {});
    const errorCode = ["day_taken", "slug_taken", "deadline_must_be_after_publish", "challenge_not_found"].includes(message) ? message : "challenge_update_failed";
    return res.status(errorCode === "challenge_not_found" ? 404 : errorCode === "challenge_update_failed" ? 400 : 409).json({ error: errorCode });
  }
});

router.delete("/admin/challenges/:challengeId", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const challengeId = z.string().uuid().safeParse(req.params.challengeId);
  if (!challengeId.success) return res.status(400).json({ error: "invalid_challenge_id" });
  try {
    const result = await deleteAdminChallenge(challengeId.data);
    await writeAdminAuditLog(adminId, {
      action: "delete_challenge",
      status: "success",
      message: `Deleted Day ${result.challenge.day} · ${result.challenge.title}`,
      metadata: {
        challengeId: result.challenge.id,
        day: result.challenge.day,
        title: result.challenge.title,
        completionsDeleted: result.completionsDeleted,
        jobsDeleted: result.jobsDeleted,
        profilesRecalculated: result.profilesRecalculated,
        profilesRecalculationFailed: result.profilesRecalculationFailed,
      },
    }).catch(() => {});
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "challenge_delete_failed";
    await writeAdminAuditLog(adminId, { action: "delete_challenge", status: "error", message, targetChallengeId: challengeId.data }).catch(() => {});
    return res.status(message === "challenge_not_found" ? 404 : 400).json({ error: message === "challenge_not_found" ? message : "challenge_delete_failed" });
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
    const before = await getSiteSettings();
    const settings = await updateSiteSettings(patch);
    let launch = null;
    if (before.waitlistEnabled && !settings.waitlistEnabled) {
      try {
        launch = await launchFirstChallenge();
        await writeAdminAuditLog(adminId, {
          action: "launch_day_one",
          status: launch.started ? "success" : "info",
          message: launch.started
            ? `Waitlist disabled; Day ${launch.day} started at ${launch.publishedAt}`
            : `Waitlist disabled; launch skipped (${launch.reason ?? "already_started"})`,
          targetChallengeId: launch.challengeId,
          metadata: launch,
        });
      } catch (error) {
        // Do not leave the cohort live with a stale pre-launch challenge
        // window. Re-enable the waitlist and let the admin retry.
        await updateSiteSettings({ waitlistEnabled: true }).catch(() => {});
        await writeAdminAuditLog(adminId, { action: "launch_day_one", status: "error", message: error instanceof Error ? error.message : "launch_start_failed" }).catch(() => {});
        return res.status(500).json({ error: "launch_start_failed" });
      }
    }
    if (launch?.started && launch.publishedAt) {
      settings.launchAt = launch.publishedAt;
      settings.sprintStartedAt = launch.publishedAt;
    }
    await writeAdminAuditLog(adminId, { action: "update_settings", status: "success", message: `Waitlist ${settings.waitlistEnabled ? "enabled" : "disabled"}`, metadata: patch as Record<string, unknown> });
    return res.json({ ...settings, launch });
  } catch (error) {
    await writeAdminAuditLog(adminId, { action: "update_settings", status: "error", message: error instanceof Error ? error.message : "settings_update_failed" });
    return res.status(400).json({ error: "settings_update_failed_apply_migration_005" });
  }
});

router.post("/admin/cohort/reset", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  const parsed = z.object({ confirmation: z.literal("START DAY 1") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "confirmation_required" });
  try {
    const result = await resetCohort();
    await writeAdminAuditLog(adminId, {
      action: "reset_cohort",
      status: "success",
      message: `Cohort reset; Day 1 is live until ${result.deadlineAt}`,
      targetChallengeId: result.challengeId,
      metadata: result,
    }).catch((error) => console.error("reset_cohort_audit_failed", error));
    return res.json({ reset: true, ...result });
  } catch (error) {
    const message = typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : error instanceof Error ? error.message : "cohort_reset_failed";
    const code = message === "day_one_missing"
      ? "day_one_missing"
      : /reset_cohort/i.test(message) && /(does not exist|not find|schema cache)/i.test(message)
        ? "reset_cohort_migration_required"
        : "cohort_reset_failed";
    await writeAdminAuditLog(adminId, { action: "reset_cohort", status: "error", message, metadata: { code } }).catch(() => {});
    return res.status(code === "day_one_missing" ? 400 : 500).json({ error: code });
  }
});

router.get("/admin/logs", async (req, res) => {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;
  return res.json({ logs: await getAdminAuditLogs(Number(req.query.limit ?? 100)) });
});

export default router;
