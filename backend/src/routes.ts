import { Router } from "express";
import { z } from "zod";
import { adminAlerts, challenges, completions, findOrCreateCompletion, jobs, profiles, verificationIsPaused, verificationPausedUntil } from "./store.js";

const router = Router();
const demoProfile = () => profiles.get("demo-user")!;

router.get("/challenges/current", (_req, res) => res.json({ challenge: [...challenges.values()].sort((a, b) => b.day - a.day)[0] }));
router.post("/events/open", (req, res) => {
  const parsed = z.object({ challengeId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "challengeId is required" });
  if (!challenges.has(parsed.data.challengeId)) return res.status(404).json({ error: "challenge_not_found" });
  const completion = findOrCreateCompletion(demoProfile().id, parsed.data.challengeId);
  return res.status(202).json({ recorded: true, status: "attempt_recorded", attemptedAt: completion.attemptedAt, verificationStartsAfter: challenges.get(parsed.data.challengeId)?.deadlineAt });
});
router.get("/progress", (_req, res) => {
  const profile = demoProfile(); const mine = [...completions.values()].filter((item) => item.profileId === profile.id); const verified = mine.filter((item) => item.status === "verified");
  res.json({ profile, verifiedCompletions: verified.length, completionPercentage: Math.round((verified.length / 30) * 100), statuses: mine });
});
router.get("/leaderboard", (req, res) => {
  const query = String(req.query.search ?? "").toLowerCase();
  const rows = [...profiles.values()].filter((profile) => `${profile.name} ${profile.handle}`.toLowerCase().includes(query)).sort((a, b) => b.points - a.points || b.streak - a.streak || a.name.localeCompare(b.name)).map((profile, index) => ({ rank: index + 1, name: profile.name, handle: profile.handle, academicYear: profile.academicYear, points: profile.points, streak: profile.streak, solved: profile.streak }));
  res.json({ currentDay: 7, totalParticipants: profiles.size, verifiedCompletions: [...completions.values()].filter((item) => item.status === "verified").length, updatedAt: new Date().toISOString(), rows });
});
router.get("/jobs/metrics", (_req, res) => {
  const all = [...jobs.values()];
  res.json({
    queued: all.filter((job) => job.status === "queued").length,
    processing: all.filter((job) => job.status === "processing").length,
    retrying: all.filter((job) => job.status === "retry").length,
    terminalFailures: all.filter((job) => job.status === "failed").length,
    paused: verificationIsPaused(),
    pausedUntil: verificationIsPaused() ? new Date(verificationPausedUntil).toISOString() : null,
    recentAlerts: adminAlerts.slice(0, 10),
  });
});

export default router;
