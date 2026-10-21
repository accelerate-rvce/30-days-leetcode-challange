import { Challenge } from "./types.js";

export type Submission = { id?: string; titleSlug?: string; statusDisplay?: string; timestamp?: number | string };
export type FeedResult = { kind: "ok" | "unavailable"; submissions: Submission[]; reason?: string };

type GraphqlBody = { data?: Record<string, unknown>; errors?: unknown[] };
type GraphqlResult = { ok: boolean; status: number; body?: GraphqlBody; reason?: string };

const endpoint = process.env.LEETCODE_GRAPHQL_URL ?? "https://leetcode.com/graphql";

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// LeetCode's public feed caps recentAcSubmissionList at 20 entries even when
// a larger limit is requested, so there is no benefit in asking for more.
const feedLimit = clamp(envInt("LEETCODE_FEED_LIMIT", 20), 1, 20);
export const usersPerRequest = clamp(envInt("LEETCODE_USERS_PER_REQUEST", 8), 1, 10);

// Pace every outbound request globally. Even with multiple concurrent workers
// the start times stay at least this far apart.
const minRequestIntervalMs = clamp(
  envInt("LEETCODE_MIN_REQUEST_INTERVAL_MS", envInt("LEETCODE_MIN_DELAY_MS", 1_500)),
  250,
  60_000,
);
const maxConcurrency = clamp(envInt("LEETCODE_MAX_CONCURRENCY", 1), 1, 4);
const dailyRequestLimit = Math.max(0, envInt("LEETCODE_DAILY_REQUEST_LIMIT", 5_000));
const rateLimitCooldownMs = clamp(envInt("LEETCODE_RATE_LIMIT_COOLDOWN_MS", 15 * 60_000), 30_000, 60 * 60_000);

let lastRequestAt = 0;
let activeRequests = 0;
const waitingForSlot: Array<() => void> = [];
let pausedUntil = 0;
let consecutiveRateLimits = 0;
let dailyKey = new Date().toISOString().slice(0, 10);
let dailyRequests = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function hasDailyBudget() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyKey) {
    dailyKey = today;
    dailyRequests = 0;
  }
  return dailyRequestLimit === 0 || dailyRequests < dailyRequestLimit;
}

function takeDailyBudget() {
  if (!hasDailyBudget()) return false;
  dailyRequests += 1;
  return true;
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function nextRateLimitPause(headerMs: number | null) {
  consecutiveRateLimits += 1;
  if (headerMs !== null) return clamp(headerMs, 30_000, 60 * 60_000);
  const base = Math.min(60 * 60_000, rateLimitCooldownMs * 2 ** Math.min(consecutiveRateLimits - 1, 4));
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

function describeErrors(errors: unknown) {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0] as { message?: unknown } | undefined;
  const message = typeof first?.message === "string" ? first.message.slice(0, 120) : "graphql_error";
  return `graphql:${message}`;
}

async function withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests >= maxConcurrency) await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  activeRequests += 1;
  try {
    const now = Date.now();
    const waitUntil = lastRequestAt + minRequestIntervalMs;
    if (waitUntil > now) await sleep(waitUntil - now);
    lastRequestAt = Date.now();
    return await task();
  } finally {
    activeRequests -= 1;
    waitingForSlot.shift()?.();
  }
}

async function graphqlRequest(payload: { query: string; variables: Record<string, unknown> }): Promise<GraphqlResult> {
  // Do not sleep through a long rate-limit cooldown. Return unavailable so the
  // current worker cycle finishes and persists a retry after the cooldown.
  if (Date.now() < pausedUntil) return { ok: false, status: 0, reason: "cooldown_active" };
  if (!hasDailyBudget()) return { ok: false, status: 0, reason: "daily_budget_exhausted" };
  return withRequestSlot(async () => {
    if (Date.now() < pausedUntil) return { ok: false, status: 0, reason: "cooldown_active" };
    if (!takeDailyBudget()) return { ok: false, status: 0, reason: "daily_budget_exhausted" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "30days-challenge-worker/1.0" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status === 403 || response.status === 503) {
        const pause = nextRateLimitPause(parseRetryAfter(response));
        pausedUntil = Math.max(pausedUntil, Date.now() + pause);
        return { ok: false, status: response.status, reason: `http_${response.status}` };
      }
      if (!response.ok) {
        pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(60_000, minRequestIntervalMs * 2));
        return { ok: false, status: response.status, reason: `http_${response.status}` };
      }
      const body = await response.json() as GraphqlBody;
      const errorText = JSON.stringify(body.errors ?? "").toLowerCase();
      if (errorText.includes("rate limit") || errorText.includes("too many")) {
        pausedUntil = Math.max(pausedUntil, Date.now() + nextRateLimitPause(null));
      } else {
        consecutiveRateLimits = 0;
      }
      return { ok: true, status: response.status, body };
    } catch (error) {
      pausedUntil = Math.max(pausedUntil, Date.now() + 30_000);
      return { ok: false, status: 0, reason: error instanceof Error ? error.name : "network_error" };
    } finally {
      clearTimeout(timeout);
    }
  });
}

// LeetCode returns `timestamp` as a string of unix seconds (e.g. "1792093127").
// Coerce it — a strict `typeof === "number"` check silently discards every submission.
export function submissionTimeMs(value: unknown): number | null {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Fetch the recent accepted feed for several users in one GraphQL request
 * using aliases. One request per 8 users is dramatically safer for LeetCode
 * than one request per user, while the module-level scheduler guarantees that
 * even a 400-user cohort is spaced out instead of arriving as a burst.
 */
export async function fetchRecentAcceptedSubmissionsBatch(handles: string[]): Promise<Map<string, FeedResult>> {
  const unique = [...new Set(handles.map((handle) => handle.trim()).filter(Boolean))];
  const results = new Map<string, FeedResult>();
  if (unique.length === 0) return results;

  const variables: Record<string, unknown> = { limit: feedLimit };
  const definitions: string[] = [];
  const fields: string[] = [];
  unique.forEach((handle, index) => {
    variables[`u${index}`] = handle;
    definitions.push(`$u${index}: String!`);
    fields.push(`u${index}: recentAcSubmissionList(username: $u${index}, limit: $limit) { id titleSlug statusDisplay timestamp }`);
  });

  const response = await graphqlRequest({
    query: `query recentAcSubmissionBatch(${definitions.join(", ")}, $limit: Int!) { ${fields.join(" ")} }`,
    variables,
  });

  if (!response.ok) {
    unique.forEach((handle) => results.set(handle, { kind: "unavailable", submissions: [], reason: response.reason }));
    return results;
  }

  const data = response.body?.data ?? {};
  const errorReason = describeErrors(response.body?.errors);
  unique.forEach((handle, index) => {
    const value = data[`u${index}`];
    if (Array.isArray(value)) results.set(handle, { kind: "ok", submissions: value as Submission[] });
    else results.set(handle, { kind: "unavailable", submissions: [], reason: errorReason ?? "graphql_alias_missing" });
  });
  return results;
}

export async function fetchRecentAcceptedSubmissions(handle: string): Promise<FeedResult> {
  const batch = await fetchRecentAcceptedSubmissionsBatch([handle]);
  return batch.get(handle.trim()) ?? { kind: "unavailable", submissions: [], reason: "missing_handle" };
}

export type LeetCodeUserCheck = { kind: "exists" | "not_found" | "unavailable"; username?: string; reason?: string };
const userCheckCache = new Map<string, { result: LeetCodeUserCheck; expiresAt: number }>();
const USER_CHECK_POSITIVE_TTL_MS = 24 * 60 * 60_000;
const USER_CHECK_NEGATIVE_TTL_MS = 10 * 60_000;
const USER_CHECK_UNAVAILABLE_TTL_MS = 60_000;

// Registration calls this once for a new or changed handle. Successful checks
// are cached for a day and failures for ten minutes, so editing a name or year
// never causes another LeetCode request.
export async function checkLeetCodeUser(handle: string): Promise<LeetCodeUserCheck> {
  const username = handle.trim();
  if (!username) return { kind: "not_found", reason: "missing_handle" };
  const now = Date.now();
  const cached = userCheckCache.get(username);
  if (cached && cached.expiresAt > now) return cached.result;
  if (cached) userCheckCache.delete(username);

  const response = await graphqlRequest({
    query: "query userExists($username: String!) { matchedUser(username: $username) { username } }",
    variables: { username },
  });

  let result: LeetCodeUserCheck;
  if (!response.ok) {
    result = { kind: "unavailable", reason: response.reason ?? "leetcode_unavailable" };
  } else {
    const data = response.body?.data as { matchedUser?: { username?: unknown } | null } | undefined;
    const matched = data?.matchedUser;
    if (typeof matched?.username === "string" && matched.username) {
      result = { kind: "exists", username: matched.username };
    } else {
      const reason = describeErrors(response.body?.errors);
      result = reason && /rate limit|too many|forbidden|temporarily/i.test(reason)
        ? { kind: "unavailable", reason }
        : { kind: "not_found", reason: reason ?? "user_not_found" };
    }
  }

  const ttl = result.kind === "exists" ? USER_CHECK_POSITIVE_TTL_MS : result.kind === "not_found" ? USER_CHECK_NEGATIVE_TTL_MS : USER_CHECK_UNAVAILABLE_TTL_MS;
  userCheckCache.set(username, { result, expiresAt: now + ttl });
  if (userCheckCache.size > 5_000) {
    for (const [key, value] of userCheckCache) if (value.expiresAt <= now) userCheckCache.delete(key);
  }
  return result;
}

export async function fetchRecentAccepted(handle: string, challenge: Challenge): Promise<{ kind: "verified" | "not_found" | "unavailable"; submission?: Submission; reason?: string }> {
  const result = await fetchRecentAcceptedSubmissions(handle);
  if (result.kind === "unavailable") return { kind: "unavailable", reason: result.reason };
  const match = result.submissions
    .filter((item) => item.titleSlug === challenge.slug && item.statusDisplay === "Accepted")
    .filter((item) => { const timeMs = submissionTimeMs(item.timestamp); return timeMs !== null && timeMs >= Date.parse(challenge.publishedAt); })
    .sort((a, b) => (submissionTimeMs(a.timestamp) ?? 0) - (submissionTimeMs(b.timestamp) ?? 0))[0];
  return match ? { kind: "verified", submission: match } : { kind: "not_found", reason: "no_eligible_submission_in_available_feed" };
}

// Use this when persisting retries so a rate-limited job does not come back
// before LeetCode's cooldown has expired.
export function leetcodeRateLimitRemainingMs() {
  return Math.max(0, pausedUntil - Date.now());
}
