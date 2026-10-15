"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const persistence_js_1 = require("./persistence.js");
const persistent_worker_js_1 = require("./persistent-worker.js");
const router = (0, express_1.Router)();
const authToken = (value) => value?.replace(/^Bearer\s+/i, "");
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
exports.default = router;
