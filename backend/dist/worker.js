"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleDueChallenges = scheduleDueChallenges;
exports.processNextJob = processNextJob;
exports.recoverStaleJobs = recoverStaleJobs;
exports.startWorker = startWorker;
const store_js_1 = require("./store.js");
const leetcode_js_1 = require("./leetcode.js");
const maxRetries = Number(process.env.LEETCODE_MAX_RETRIES ?? 3);
let running = false;
function scheduleDueChallenges() {
    for (const challenge of store_js_1.challenges.values()) {
        if (challenge.verificationQueuedAt || Date.now() < Date.parse(challenge.deadlineAt))
            continue;
        const eligibleAttempts = [...store_js_1.completions.values()].filter((completion) => completion.challengeId === challenge.id && completion.status === "pending" && Date.parse(completion.attemptedAt) <= Date.parse(challenge.deadlineAt));
        eligibleAttempts.forEach((completion) => (0, store_js_1.enqueueVerification)(completion.profileId, completion.challengeId));
        challenge.verificationQueuedAt = new Date().toISOString();
    }
}
async function processNextJob() {
    if (running || (0, store_js_1.verificationIsPaused)())
        return false;
    const job = [...store_js_1.jobs.values()].find((candidate) => ["queued", "retry"].includes(candidate.status) && candidate.availableAt <= Date.now());
    if (!job)
        return false;
    running = true;
    job.status = "processing";
    job.lockedAt = Date.now();
    job.attempts += 1;
    const completion = store_js_1.completions.get(job.id);
    const profile = store_js_1.profiles.get(job.profileId);
    const challenge = store_js_1.challenges.get(job.challengeId);
    try {
        if (!completion || !profile || !challenge)
            throw new Error("missing_job_reference");
        const result = await (0, leetcode_js_1.fetchRecentAccepted)(profile.handle, challenge);
        if (result.kind === "verified") {
            completion.status = "verified";
            completion.verifiedAt = new Date().toISOString();
            completion.submissionAt = new Date((result.submission?.timestamp ?? 0) * 1000).toISOString();
            completion.evidence = { source: "leetcode_recent_ac_submission", slug: challenge.slug };
        }
        else if (result.kind === "not_found")
            completion.status = "not_verified";
        else {
            completion.status = "delayed";
            throw new Error(result.reason ?? "verification_unavailable");
        }
        job.status = "complete";
    }
    catch (error) {
        job.lastError = error instanceof Error ? error.message : "unknown_error";
        job.status = job.attempts >= maxRetries ? "failed" : "retry";
        job.availableAt = Date.now() + 20 * 60_000;
        (0, store_js_1.pauseVerification)(`Verification paused for 20 minutes: ${job.lastError}`, job.challengeId);
        if (completion && job.status === "failed")
            completion.status = "error";
    }
    finally {
        running = false;
    }
    return true;
}
function recoverStaleJobs() {
    for (const job of store_js_1.jobs.values())
        if (job.status === "processing" && job.lockedAt && Date.now() - job.lockedAt > 10 * 60_000) {
            job.status = "retry";
            job.availableAt = Date.now();
            job.lastError = "stale_worker_lock_recovered";
        }
}
function startWorker() {
    const scheduleTimer = setInterval(scheduleDueChallenges, 30_000);
    const jobTimer = setInterval(() => { scheduleDueChallenges(); recoverStaleJobs(); void processNextJob(); }, 1_000);
    scheduleDueChallenges();
    return () => { clearInterval(scheduleTimer); clearInterval(jobTimer); };
}
