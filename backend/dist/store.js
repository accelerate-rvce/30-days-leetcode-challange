"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationPausedUntil = exports.adminAlerts = exports.jobs = exports.completions = exports.challenges = exports.profiles = void 0;
exports.completionKey = completionKey;
exports.findOrCreateCompletion = findOrCreateCompletion;
exports.enqueueVerification = enqueueVerification;
exports.pauseVerification = pauseVerification;
exports.verificationIsPaused = verificationIsPaused;
const istOffsetMs = 5.5 * 60 * 60 * 1000;
function activeWindow() {
    const localNow = new Date(Date.now() + istOffsetMs);
    let deadlineUtc = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 18, 0, 0) - istOffsetMs;
    if (deadlineUtc <= Date.now())
        deadlineUtc += 24 * 60 * 60 * 1000;
    return { publishedAt: new Date(deadlineUtc - 24 * 60 * 60 * 1000).toISOString(), deadlineAt: new Date(deadlineUtc).toISOString() };
}
exports.profiles = new Map([
    ["demo-user", { id: "demo-user", name: "Arjun Sharma", handle: "arjun.builds", academicYear: "Third Year", points: 210, streak: 7, longestStreak: 7 }],
    ["nisha", { id: "nisha", name: "Nisha Kapoor", handle: "nisha.codes", academicYear: "Third Year", points: 262, streak: 7, longestStreak: 7 }],
    ["devansh", { id: "devansh", name: "Devansh Mehta", handle: "devansh_m", academicYear: "Second Year", points: 248, streak: 7, longestStreak: 7 }],
]);
exports.challenges = new Map([["challenge-07", { id: "challenge-07", day: 7, title: "Two Sum", slug: "two-sum", difficulty: "Easy", topic: "Array · Hash Table", points: 20, ...activeWindow() }]]);
exports.completions = new Map();
exports.jobs = new Map();
exports.adminAlerts = [];
exports.verificationPausedUntil = 0;
function completionKey(profileId, challengeId) { return `${profileId}:${challengeId}`; }
function findOrCreateCompletion(profileId, challengeId) {
    const key = completionKey(profileId, challengeId);
    const existing = exports.completions.get(key);
    if (existing)
        return existing;
    const completion = { id: key, profileId, challengeId, status: "pending", attemptedAt: new Date().toISOString() };
    exports.completions.set(key, completion);
    return completion;
}
function enqueueVerification(profileId, challengeId) {
    const key = completionKey(profileId, challengeId);
    if ([...exports.jobs.values()].some((job) => job.id === key && !["complete", "failed"].includes(job.status)))
        return exports.jobs.get(key);
    const job = { id: key, profileId, challengeId, status: "queued", attempts: 0, availableAt: Date.now() };
    exports.jobs.set(key, job);
    return job;
}
function pauseVerification(message, challengeId) {
    exports.verificationPausedUntil = Date.now() + 20 * 60_000;
    exports.adminAlerts.unshift({ id: `alert-${Date.now()}`, createdAt: new Date().toISOString(), severity: "warning", message, challengeId });
}
function verificationIsPaused() { return exports.verificationPausedUntil > Date.now(); }
