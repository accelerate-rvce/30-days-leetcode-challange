"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const store_js_1 = require("./store.js");
const router = (0, express_1.Router)();
const demoProfile = () => store_js_1.profiles.get("demo-user");
router.get("/challenges/current", (_req, res) => res.json({ challenge: [...store_js_1.challenges.values()].sort((a, b) => b.day - a.day)[0] }));
router.post("/events/open", (req, res) => {
    const parsed = zod_1.z.object({ challengeId: zod_1.z.string() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "challengeId is required" });
    if (!store_js_1.challenges.has(parsed.data.challengeId))
        return res.status(404).json({ error: "challenge_not_found" });
    const completion = (0, store_js_1.findOrCreateCompletion)(demoProfile().id, parsed.data.challengeId);
    return res.status(202).json({ recorded: true, status: "attempt_recorded", attemptedAt: completion.attemptedAt, verificationStartsAfter: store_js_1.challenges.get(parsed.data.challengeId)?.deadlineAt });
});
router.get("/progress", (_req, res) => {
    const profile = demoProfile();
    const mine = [...store_js_1.completions.values()].filter((item) => item.profileId === profile.id);
    const verified = mine.filter((item) => item.status === "verified");
    res.json({ profile, verifiedCompletions: verified.length, completionPercentage: Math.round((verified.length / 30) * 100), statuses: mine });
});
router.get("/leaderboard", (req, res) => {
    const query = String(req.query.search ?? "").toLowerCase();
    const rows = [...store_js_1.profiles.values()].filter((profile) => `${profile.name} ${profile.handle}`.toLowerCase().includes(query)).sort((a, b) => b.points - a.points || b.streak - a.streak || a.name.localeCompare(b.name)).map((profile, index) => ({ rank: index + 1, name: profile.name, handle: profile.handle, academicYear: profile.academicYear, points: profile.points, streak: profile.streak, solved: profile.streak }));
    res.json({ currentDay: 7, totalParticipants: store_js_1.profiles.size, verifiedCompletions: [...store_js_1.completions.values()].filter((item) => item.status === "verified").length, updatedAt: new Date().toISOString(), rows });
});
router.get("/jobs/metrics", (_req, res) => {
    const all = [...store_js_1.jobs.values()];
    res.json({
        queued: all.filter((job) => job.status === "queued").length,
        processing: all.filter((job) => job.status === "processing").length,
        retrying: all.filter((job) => job.status === "retry").length,
        terminalFailures: all.filter((job) => job.status === "failed").length,
        paused: (0, store_js_1.verificationIsPaused)(),
        pausedUntil: (0, store_js_1.verificationIsPaused)() ? new Date(store_js_1.verificationPausedUntil).toISOString() : null,
        recentAlerts: store_js_1.adminAlerts.slice(0, 10),
    });
});
exports.default = router;
