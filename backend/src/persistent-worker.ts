import { fetchRecentAcceptedSubmissions, submissionTimeMs } from "./leetcode.js";
import { ClaimedJob, claimPersistentJobs, enqueueDuePersistentVerifications, markPersistentNotFound, markPersistentRetry, markPersistentVerified, persistenceEnabled } from "./persistence.js";
import { Challenge } from "./types.js";

const maxRetries = Number(process.env.LEETCODE_MAX_RETRIES ?? 6);
const concurrency = Math.max(1, Number(process.env.LEETCODE_MAX_CONCURRENCY ?? 5));
const defaultBatchSize = Math.max(1, Number(process.env.VERIFY_BATCH_SIZE ?? 50));
const minDelayMs = Math.max(0, Number(process.env.LEETCODE_MIN_DELAY_MS ?? 1500));
let running = false;

function challengeFor(job: ClaimedJob): Challenge {
  return { id: job.challenge_id, day: 0, title: job.slug, slug: job.slug, difficulty: "Easy", topic: "", points: 100, publishedAt: job.published_at, deadlineAt: job.deadline_at };
}

async function verifyUserJobs(jobs: ClaimedJob[]) {
  const handle = jobs[0]?.leetcode_username;
  if (!handle) { await Promise.all(jobs.map((job) => markPersistentRetry(job, "missing_leetcode_username", maxRetries))); return; }
  const result = await fetchRecentAcceptedSubmissions(handle);
  if (result.kind === "unavailable") { await Promise.all(jobs.map((job) => markPersistentRetry(job, result.reason ?? "leetcode_unavailable", maxRetries))); return; }
  await Promise.all(jobs.map(async (job) => {
    const match = result.submissions.filter((submission) => submission.titleSlug === job.slug && submission.statusDisplay === "Accepted")
      .filter((submission) => { const timeMs = submissionTimeMs(submission.timestamp); return timeMs !== null && timeMs >= Date.parse(job.published_at); })
      .sort((a, b) => (submissionTimeMs(a.timestamp) ?? 0) - (submissionTimeMs(b.timestamp) ?? 0))[0];
    const matchTimeMs = match ? submissionTimeMs(match.timestamp) : null;
    if (!match || matchTimeMs === null) { await markPersistentNotFound(job, maxRetries); return; }
    await markPersistentVerified(job, match.id ?? `${job.slug}:${match.timestamp}`, new Date(matchTimeMs).toISOString(), challengeFor(job));
  }));
}

export async function runPersistentVerificationCycle(batchSize = defaultBatchSize) {
  if (!persistenceEnabled || running) return { claimed: 0, users: 0, skipped: !persistenceEnabled, running };
  running = true;
  try {
    await enqueueDuePersistentVerifications();
    const jobs = await claimPersistentJobs(batchSize);
    const byUser = new Map<string, ClaimedJob[]>();
    jobs.forEach((job) => byUser.set(job.profile_id, [...(byUser.get(job.profile_id) ?? []), job]));
    const groups = [...byUser.values()];
    // Stagger batches of LeetCode fetches so a 200-user burst doesn't
    // trip LeetCode rate limits (429s become 20-min retries).
    for (let index = 0; index < groups.length; index += concurrency) {
      await Promise.all(groups.slice(index, index + concurrency).map(verifyUserJobs));
      if (minDelayMs > 0 && index + concurrency < groups.length) await new Promise((resolve) => setTimeout(resolve, minDelayMs));
    }
    return { claimed: jobs.length, users: groups.length, skipped: false, running: false };
  } finally { running = false; }
}
