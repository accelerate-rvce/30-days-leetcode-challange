import { Router } from "express";
import { z } from "zod";
import { getPersistentChallenge, getPersistentChallenges, getPersistentCurrentChallenge, getPersistentJobMetrics, getPersistentLeaderboard, getPersistentProgress, getPersistentProfile, enqueuePersistentVerification, persistenceEnabled, recordPersistentAttempt, updatePersistentProfile, userIdFromAccessToken } from "./persistence.js";
import { runPersistentVerificationCycle } from "./persistent-worker.js";

const router = Router();
const authToken = (value?: string) => value?.replace(/^Bearer\s+/i, "");
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

router.get("/challenges/current", async (_req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  return res.json({ challenge: await getPersistentCurrentChallenge() });
});
router.get("/challenges", async (_req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  return res.json({ challenges: await getPersistentChallenges() });
});

router.post("/events/open", async (req, res) => {
  const parsed = z.object({ challengeId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "challengeId is required" });
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
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
  const profileId = await userIdFromAccessToken(authToken(req.header("authorization")));
  if (!profileId) return res.status(401).json({ error: "authentication_required" });
  await enqueuePersistentVerification(profileId, parsed.data.challengeId);
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

router.get("/jobs/metrics", async (_req, res) => {
  if (!persistenceEnabled) return res.status(503).json({ error: "persistence_not_configured" });
  return res.json({ ...(await getPersistentJobMetrics()), paused: false, pausedUntil: null, recentAlerts: [] });
});

export default router;
