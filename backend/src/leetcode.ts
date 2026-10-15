import { Challenge } from "./types.js";

export type Submission = { id?: string; titleSlug?: string; statusDisplay?: string; timestamp?: number };
const endpoint = process.env.LEETCODE_GRAPHQL_URL ?? "https://leetcode.com/graphql";

export async function fetchRecentAcceptedSubmissions(handle: string): Promise<{ kind: "ok" | "unavailable"; submissions: Submission[]; reason?: string }> {
  if (!handle) return { kind: "unavailable", submissions: [], reason: "missing_handle" };
  const query = { query: `query recentAcSubmissions($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { id titleSlug statusDisplay timestamp } }`, variables: { username: handle, limit: 20 } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "30days-challenge-worker/1.0" }, body: JSON.stringify(query), signal: controller.signal });
    if (response.status === 429 || response.status === 403) return { kind: "unavailable", submissions: [], reason: `http_${response.status}` };
    if (!response.ok) return { kind: "unavailable", submissions: [], reason: `http_${response.status}` };
    const body = await response.json() as { data?: { recentAcSubmissionList?: Submission[] }; errors?: unknown[] };
    if (body.errors) return { kind: "unavailable", submissions: [], reason: "graphql_error" };
    return { kind: "ok", submissions: body.data?.recentAcSubmissionList ?? [] };
  } catch (error) { return { kind: "unavailable", submissions: [], reason: error instanceof Error ? error.name : "network_error" }; }
  finally { clearTimeout(timeout); }
}

export async function fetchRecentAccepted(handle: string, challenge: Challenge): Promise<{ kind: "verified" | "not_found" | "unavailable"; submission?: Submission; reason?: string }> {
  const result = await fetchRecentAcceptedSubmissions(handle);
  if (result.kind === "unavailable") return { kind: "unavailable", reason: result.reason };
  const match = result.submissions
    .filter((item) => item.titleSlug === challenge.slug && item.statusDisplay === "Accepted")
    .filter((item) => typeof item.timestamp === "number" && item.timestamp * 1000 >= Date.parse(challenge.publishedAt))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
  return match ? { kind: "verified", submission: match } : { kind: "not_found", reason: "no_eligible_submission_in_available_feed" };
}
