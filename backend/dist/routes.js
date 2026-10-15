"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const persistence_js_1 = require("./persistence.js");
const persistent_worker_js_1 = require("./persistent-worker.js");
const router = (0, express_1.Router)();
const authToken = (value) => value?.replace(/^Bearer\s+/i, "");
async function requireAdmin(req, res) {
    if (!persistence_js_1.persistenceEnabled) {
        res.status(503).json({ error: "persistence_not_configured" });
        return null;
    }
    const adminId = await (0, persistence_js_1.adminIdFromAccessToken)(authToken(req.header("authorization")));
    if (!adminId) {
        res.status(403).json({ error: "admin_access_required" });
        return null;
    }
    return adminId;
}
function normalizeLeetCodeUsername(value) {
    const input = value.trim().replace(/[\])}>]+$/, "");
    try {
        const parsed = new URL(input);
        if (parsed.hostname === "leetcode.com" || parsed.hostname === "www.leetcode.com") {
            const match = parsed.pathname.match(/^\/u\/([^/]+)\/?$/i);
            if (match)
                return decodeURIComponent(match[1]);
        }
    }
    catch { /* raw username */ }
    return input.replace(/^@+/, "");
}
router.get("/challenges/current", async (_req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    return res.json({ challenge: await (0, persistence_js_1.getPersistentCurrentChallenge)() });
});
router.get("/challenges", async (_req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    return res.json({ challenges: await (0, persistence_js_1.getPersistentChallenges)() });
});
router.post("/events/open", async (req, res) => {
    const parsed = zod_1.z.object({ challengeId: zod_1.z.string() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "challengeId is required" });
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const profileId = await (0, persistence_js_1.userIdFromAccessToken)(authToken(req.header("authorization")));
    if (!profileId)
        return res.status(401).json({ error: "authentication_required" });
    const challenge = await (0, persistence_js_1.getPersistentChallenge)(parsed.data.challengeId);
    if (!challenge)
        return res.status(404).json({ error: "challenge_not_found" });
    const attempt = await (0, persistence_js_1.recordPersistentAttempt)(profileId, challenge);
    return res.status(202).json({ recorded: true, persisted: true, status: "attempt_recorded", attemptedAt: attempt.attemptedAt, verificationStartsAfter: challenge.deadlineAt, scoring: { onTimePoints: 100, latePoints: 70, deadlineAt: challenge.deadlineAt } });
});
router.post("/verification/request", async (req, res) => {
    const parsed = zod_1.z.object({ challengeId: zod_1.z.string() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "challengeId is required" });
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const profileId = await (0, persistence_js_1.userIdFromAccessToken)(authToken(req.header("authorization")));
    if (!profileId)
        return res.status(401).json({ error: "authentication_required" });
    await (0, persistence_js_1.enqueuePersistentVerification)(profileId, parsed.data.challengeId);
    return res.status(202).json({ queued: true, persisted: true });
});
router.post("/cron/verify", async (req, res) => {
    const expected = process.env.CRON_SECRET;
    if (!expected || req.header("x-cron-secret") !== expected)
        return res.status(401).json({ error: "unauthorized" });
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    return res.status(202).json({ accepted: true, ...(await (0, persistent_worker_js_1.runPersistentVerificationCycle)()) });
});
router.get("/progress", async (req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const profileId = await (0, persistence_js_1.userIdFromAccessToken)(authToken(req.header("authorization")));
    if (!profileId)
        return res.status(401).json({ error: "authentication_required" });
    return res.json(await (0, persistence_js_1.getPersistentProgress)(profileId));
});
router.get("/profile", async (req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const profileId = await (0, persistence_js_1.userIdFromAccessToken)(authToken(req.header("authorization")));
    if (!profileId)
        return res.status(401).json({ error: "authentication_required" });
    return res.json({ profile: await (0, persistence_js_1.getPersistentProfile)(profileId) });
});
router.patch("/profile", async (req, res) => {
    const parsed = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(120).optional(), leetcode_username: zod_1.z.string().trim().min(1).max(300).optional(), academic_year: zod_1.z.enum(["First Year", "Second Year", "Third Year", "Fourth Year"]).optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_profile" });
    const updates = { ...parsed.data, ...(parsed.data.leetcode_username ? { leetcode_username: normalizeLeetCodeUsername(parsed.data.leetcode_username) } : {}) };
    if (updates.leetcode_username && !/^[A-Za-z0-9_-]+$/.test(updates.leetcode_username))
        return res.status(400).json({ error: "invalid_leetcode_username" });
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const profileId = await (0, persistence_js_1.userIdFromAccessToken)(authToken(req.header("authorization")));
    if (!profileId)
        return res.status(401).json({ error: "authentication_required" });
    return res.json({ profile: await (0, persistence_js_1.updatePersistentProfile)(profileId, updates) });
});
router.get("/leaderboard", async (req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    const rows = (await (0, persistence_js_1.getPersistentLeaderboard)(String(req.query.search ?? "").toLowerCase())) ?? [];
    return res.json({ currentDay: rows.length ? 0 : null, totalParticipants: rows.length, verifiedCompletions: 0, updatedAt: new Date().toISOString(), rows });
});
router.get("/jobs/metrics", async (req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    if (!await (0, persistence_js_1.adminIdFromAccessToken)(authToken(req.header("authorization"))))
        return res.status(403).json({ error: "admin_access_required" });
    return res.json({ ...(await (0, persistence_js_1.getPersistentJobMetrics)()), paused: false, pausedUntil: null, recentAlerts: [] });
});
router.get("/admin/metrics", async (req, res) => {
    if (!persistence_js_1.persistenceEnabled)
        return res.status(503).json({ error: "persistence_not_configured" });
    if (!await (0, persistence_js_1.adminIdFromAccessToken)(authToken(req.header("authorization"))))
        return res.status(403).json({ error: "admin_access_required" });
    return res.json(await (0, persistence_js_1.getPersistentAdminMetrics)());
});
router.get("/admin/overview", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    const [metrics, challenges, users, jobs, logs] = await Promise.all([(0, persistence_js_1.getPersistentAdminMetrics)(), (0, persistence_js_1.getAdminChallenges)(), (0, persistence_js_1.getAdminUsers)(String(req.query.search ?? "")), (0, persistence_js_1.getAdminVerificationJobs)(), (0, persistence_js_1.getAdminAuditLogs)()]);
    return res.json({ metrics, challenges, users, jobs, logs });
});
router.patch("/admin/challenges/:challengeId", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    const parsed = zod_1.z.object({ title: zod_1.z.string().trim().min(1).max(160).optional(), slug: zod_1.z.string().trim().regex(/^[a-z0-9-]+$/).optional(), difficulty: zod_1.z.enum(["Easy", "Medium", "Hard"]).optional(), topic: zod_1.z.string().trim().min(1).max(80).optional(), points: zod_1.z.number().int().positive().max(100).optional(), published_at: zod_1.z.string().datetime({ offset: true }).optional(), deadline_at: zod_1.z.string().datetime({ offset: true }).optional() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_challenge_update" });
    try {
        const challenge = await (0, persistence_js_1.updateAdminChallenge)(req.params.challengeId, parsed.data);
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "edit_challenge", status: "success", message: `Updated challenge ${challenge?.title ?? req.params.challengeId}`, targetChallengeId: req.params.challengeId, metadata: parsed.data });
        return res.json({ challenge });
    }
    catch (error) {
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "edit_challenge", status: "error", message: error instanceof Error ? error.message : "challenge_update_failed", targetChallengeId: req.params.challengeId });
        return res.status(400).json({ error: "challenge_update_failed" });
    }
});
router.post("/admin/challenges/reorder", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    const parsed = zod_1.z.object({ order: zod_1.z.array(zod_1.z.string().uuid()).min(1).max(30) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "invalid_challenge_order" });
    try {
        await (0, persistence_js_1.reorderAdminChallenges)(parsed.data.order);
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "reorder_challenges", status: "success", message: `Reordered ${parsed.data.order.length} challenges`, metadata: { order: parsed.data.order } });
        return res.json({ updated: true, challenges: await (0, persistence_js_1.getAdminChallenges)() });
    }
    catch (error) {
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "reorder_challenges", status: "error", message: error instanceof Error ? error.message : "challenge_reorder_failed" });
        return res.status(400).json({ error: "challenge_reorder_failed" });
    }
});
router.post("/admin/verification/start", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    const parsed = zod_1.z.object({ profileId: zod_1.z.string().uuid(), challengeId: zod_1.z.string().uuid() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "profileId_and_challengeId_are_required" });
    try {
        const job = await (0, persistence_js_1.preparePersistentVerification)(parsed.data.profileId, parsed.data.challengeId);
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "queue_verification", status: "success", message: "Verification job queued", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId, metadata: { jobId: job.id } });
        return res.status(202).json({ queued: true, job });
    }
    catch (error) {
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "queue_verification", status: "error", message: error instanceof Error ? error.message : "verification_queue_failed", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId });
        return res.status(400).json({ error: "verification_queue_failed" });
    }
});
router.post("/admin/verification/manual", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    const parsed = zod_1.z.object({ profileId: zod_1.z.string().uuid(), challengeId: zod_1.z.string().uuid(), submissionId: zod_1.z.string().trim().min(1).max(200), submissionAt: zod_1.z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.submissionAt)))
        return res.status(400).json({ error: "valid_submission_details_are_required" });
    try {
        const result = await (0, persistence_js_1.manuallyVerifyPersistentCompletion)(parsed.data.profileId, parsed.data.challengeId, parsed.data.submissionId, new Date(parsed.data.submissionAt).toISOString());
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "manual_verification", status: "success", message: result.changed ? `Manually verified and awarded ${result.awardedPoints} points` : "Already verified; no duplicate points awarded", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId, metadata: { submissionId: parsed.data.submissionId, changed: result.changed, awardedPoints: result.awardedPoints } });
        return res.json({ verified: result.changed, duplicate: !result.changed, awardedPoints: result.changed ? result.awardedPoints : 0 });
    }
    catch (error) {
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "manual_verification", status: "error", message: error instanceof Error ? error.message : "manual_verification_failed", targetProfileId: parsed.data.profileId, targetChallengeId: parsed.data.challengeId });
        return res.status(400).json({ error: "manual_verification_failed" });
    }
});
router.post("/admin/verification/run", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    try {
        const result = await (0, persistent_worker_js_1.runPersistentVerificationCycle)();
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "run_verification_cycle", status: "success", message: result.running ? "Verification cycle is already running" : `Verification cycle processed ${result.claimed} jobs`, metadata: result });
        return res.status(202).json(result);
    }
    catch (error) {
        await (0, persistence_js_1.writeAdminAuditLog)(adminId, { action: "run_verification_cycle", status: "error", message: error instanceof Error ? error.message : "verification_cycle_failed" });
        return res.status(500).json({ error: "verification_cycle_failed" });
    }
});
router.get("/admin/logs", async (req, res) => {
    const adminId = await requireAdmin(req, res);
    if (!adminId)
        return;
    return res.json({ logs: await (0, persistence_js_1.getAdminAuditLogs)(Number(req.query.limit ?? 100)) });
});
exports.default = router;
