"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPersistentVerificationCycle = runPersistentVerificationCycle;
const leetcode_js_1 = require("./leetcode.js");
const persistence_js_1 = require("./persistence.js");
const maxRetries = Number(process.env.LEETCODE_MAX_RETRIES ?? 6);
const concurrency = Math.max(1, Number(process.env.LEETCODE_MAX_CONCURRENCY ?? 5));
let running = false;
function challengeFor(job) {
    return { id: job.challenge_id, day: 0, title: job.slug, slug: job.slug, difficulty: "Easy", topic: "", points: 100, publishedAt: job.published_at, deadlineAt: job.deadline_at };
}
async function verifyUserJobs(jobs) {
    const handle = jobs[0]?.leetcode_username;
    if (!handle) {
        await Promise.all(jobs.map((job) => (0, persistence_js_1.markPersistentRetry)(job, "missing_leetcode_username", maxRetries)));
        return;
    }
    const result = await (0, leetcode_js_1.fetchRecentAcceptedSubmissions)(handle);
    if (result.kind === "unavailable") {
        await Promise.all(jobs.map((job) => (0, persistence_js_1.markPersistentRetry)(job, result.reason ?? "leetcode_unavailable", maxRetries)));
        return;
    }
    await Promise.all(jobs.map(async (job) => {
        const match = result.submissions.filter((submission) => submission.titleSlug === job.slug && submission.statusDisplay === "Accepted")
            .filter((submission) => typeof submission.timestamp === "number" && submission.timestamp * 1000 >= Date.parse(job.published_at))
            .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
        if (!match || typeof match.timestamp !== "number") {
            await (0, persistence_js_1.markPersistentNotFound)(job, maxRetries);
            return;
        }
        await (0, persistence_js_1.markPersistentVerified)(job, match.id ?? `${job.slug}:${match.timestamp}`, new Date(match.timestamp * 1000).toISOString(), challengeFor(job));
    }));
}
async function runPersistentVerificationCycle(batchSize = 50) {
    if (!persistence_js_1.persistenceEnabled || running)
        return { claimed: 0, users: 0, skipped: !persistence_js_1.persistenceEnabled, running };
    running = true;
    try {
        await (0, persistence_js_1.enqueueDuePersistentVerifications)();
        const jobs = await (0, persistence_js_1.claimPersistentJobs)(batchSize);
        const byUser = new Map();
        jobs.forEach((job) => byUser.set(job.profile_id, [...(byUser.get(job.profile_id) ?? []), job]));
        const groups = [...byUser.values()];
        for (let index = 0; index < groups.length; index += concurrency)
            await Promise.all(groups.slice(index, index + concurrency).map(verifyUserJobs));
        return { claimed: jobs.length, users: groups.length, skipped: false, running: false };
    }
    finally {
        running = false;
    }
}
