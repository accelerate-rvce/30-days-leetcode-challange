import { challenges, completions, enqueueVerification, jobs, pauseVerification, profiles, verificationIsPaused } from "./store.js";
import { fetchRecentAccepted } from "./leetcode.js";

const maxRetries = Number(process.env.LEETCODE_MAX_RETRIES ?? 3);
let running = false;

export function scheduleDueChallenges() {
  for (const challenge of challenges.values()) {
    if (challenge.verificationQueuedAt || Date.now() < Date.parse(challenge.deadlineAt)) continue;
    const eligibleAttempts = [...completions.values()].filter((completion) => completion.challengeId === challenge.id && completion.status === "pending" && Date.parse(completion.attemptedAt) <= Date.parse(challenge.deadlineAt));
    eligibleAttempts.forEach((completion) => enqueueVerification(completion.profileId, completion.challengeId));
    challenge.verificationQueuedAt = new Date().toISOString();
  }
}

export async function processNextJob() {
  if (running || verificationIsPaused()) return false;
  const job = [...jobs.values()].find((candidate) => ["queued", "retry"].includes(candidate.status) && candidate.availableAt <= Date.now());
  if (!job) return false;
  running = true; job.status = "processing"; job.lockedAt = Date.now(); job.attempts += 1;
  const completion = completions.get(job.id); const profile = profiles.get(job.profileId); const challenge = challenges.get(job.challengeId);
  try {
    if (!completion || !profile || !challenge) throw new Error("missing_job_reference");
    const result = await fetchRecentAccepted(profile.handle, challenge);
    if (result.kind === "verified") { completion.status = "verified"; completion.verifiedAt = new Date().toISOString(); completion.submissionAt = new Date((result.submission?.timestamp ?? 0) * 1000).toISOString(); completion.evidence = { source: "leetcode_recent_ac_submission", slug: challenge.slug }; }
    else if (result.kind === "not_found") completion.status = "not_verified";
    else { completion.status = "delayed"; throw new Error(result.reason ?? "verification_unavailable"); }
    job.status = "complete";
  } catch (error) {
    job.lastError = error instanceof Error ? error.message : "unknown_error";
    job.status = job.attempts >= maxRetries ? "failed" : "retry";
    job.availableAt = Date.now() + 20 * 60_000;
    pauseVerification(`Verification paused for 20 minutes: ${job.lastError}`, job.challengeId);
    if (completion && job.status === "failed") completion.status = "error";
  }
  finally { running = false; }
  return true;
}

export function recoverStaleJobs() {
  for (const job of jobs.values()) if (job.status === "processing" && job.lockedAt && Date.now() - job.lockedAt > 10 * 60_000) { job.status = "retry"; job.availableAt = Date.now(); job.lastError = "stale_worker_lock_recovered"; }
}

export function startWorker() {
  const scheduleTimer = setInterval(scheduleDueChallenges, 30_000);
  const jobTimer = setInterval(() => { scheduleDueChallenges(); recoverStaleJobs(); void processNextJob(); }, 1_000);
  scheduleDueChallenges();
  return () => { clearInterval(scheduleTimer); clearInterval(jobTimer); };
}
