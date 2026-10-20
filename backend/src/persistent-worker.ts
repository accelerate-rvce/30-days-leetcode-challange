import { fetchRecentAcceptedSubmissionsBatch, leetcodeRateLimitRemainingMs, Submission, submissionTimeMs, usersPerRequest } from "./leetcode.js";
import { ClaimedJob, claimPersistentJobs, enqueueDuePersistentVerifications, markPersistentNotFound, markPersistentRetry, markPersistentVerified, persistenceEnabled } from "./persistence.js";
import { Challenge } from "./types.js";

const maxRetries = Number(process.env.LEETCODE_MAX_RETRIES ?? 6);
const defaultBatchSize = Math.max(1, Number(process.env.VERIFY_BATCH_SIZE ?? 50));
let running = false;

function challengeFor(job: ClaimedJob): Challenge {
  return { id: job.challenge_id, day: 0, title: job.slug, slug: job.slug, difficulty: "Easy", topic: "", points: 100, publishedAt: job.published_at, deadlineAt: job.deadline_at };
}

function msUntilNextUtcDay() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60_000, next - now.getTime());
}

// A rate-limit retry should not come back before LeetCode's cooldown has
// expired. A daily-budget retry waits for the UTC budget reset instead.
function retryDelayFor(reason?: string) {
  if (reason === "daily_budget_exhausted") return msUntilNextUtcDay();
  const cooldown = leetcodeRateLimitRemainingMs();
  return cooldown > 0 ? cooldown + 30_000 : undefined;
}

function isTransient(reason?: string) {
  if (!reason) return true;
  return reason === "daily_budget_exhausted"
    || reason === "cooldown_active"
    || reason === "network_error"
    || reason === "AbortError"
    || reason.endsWith("Error")
    || reason.startsWith("http_")
    || reason.startsWith("graphql:")
    || reason === "graphql_alias_missing"
    || /rate limit|too many/i.test(reason);
}

async function retryJobs(jobs: ClaimedJob[], reason: string) {
  const delay = retryDelayFor(reason);
  const countsAsAttempt = !isTransient(reason);
  await Promise.all(jobs.map((job) => markPersistentRetry(job, reason, maxRetries, delay, countsAsAttempt)));
}

async function verifyUserJobs(jobs: ClaimedJob[], submissions: Submission[]) {
  await Promise.all(jobs.map(async (job) => {
    const match = submissions.filter((submission) => submission.titleSlug === job.slug && submission.statusDisplay === "Accepted")
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

    // Combine several users into one aliased GraphQL query. The LeetCode
    // client also enforces a global request interval, daily budget, and
    // cooldown, so 400 users never hit LeetCode as a single burst.
    for (let index = 0; index < groups.length; index += usersPerRequest) {
      const batch = groups.slice(index, index + usersPerRequest);
      const handles = batch.map((group) => group[0]?.leetcode_username ?? "").filter(Boolean);
      const feeds = await fetchRecentAcceptedSubmissionsBatch(handles);
      await Promise.all(batch.map(async (group) => {
        const handle = group[0]?.leetcode_username;
        if (!handle) { await retryJobs(group, "missing_leetcode_username"); return; }
        const feed = feeds.get(handle);
        if (!feed || feed.kind === "unavailable") { await retryJobs(group, feed?.reason ?? "leetcode_unavailable"); return; }
        await verifyUserJobs(group, feed.submissions);
      }));
    }
    return { claimed: jobs.length, users: groups.length, skipped: false, running: false };
  } finally { running = false; }
}
