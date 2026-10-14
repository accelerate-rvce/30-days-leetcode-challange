"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecentAccepted = fetchRecentAccepted;
const endpoint = process.env.LEETCODE_GRAPHQL_URL ?? "https://leetcode.com/graphql";
async function fetchRecentAccepted(handle, challenge) {
    if (!handle)
        return { kind: "unavailable", reason: "missing_handle" };
    const query = { query: `query recentAcSubmissions($username: String!) { recentAcSubmissionList(username: $username, limit: 20) { titleSlug statusDisplay timestamp } }`, variables: { username: handle } };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "30days-challenge-worker/1.0" }, body: JSON.stringify(query), signal: controller.signal });
        if (response.status === 429 || response.status === 403)
            return { kind: "unavailable", reason: `http_${response.status}` };
        if (!response.ok)
            return { kind: "unavailable", reason: `http_${response.status}` };
        const body = await response.json();
        if (body.errors)
            return { kind: "unavailable", reason: "graphql_error" };
        const matches = (body.data?.recentAcSubmissionList ?? []).filter((item) => item.titleSlug === challenge.slug && item.statusDisplay === "Accepted");
        const eligible = matches.find((item) => typeof item.timestamp === "number" && item.timestamp * 1000 >= Date.parse(challenge.publishedAt) && item.timestamp * 1000 <= Date.parse(challenge.deadlineAt));
        return eligible ? { kind: "verified", submission: eligible } : { kind: "not_found", reason: "no_eligible_submission_in_available_feed" };
    }
    catch (error) {
        return { kind: "unavailable", reason: error instanceof Error ? error.name : "network_error" };
    }
    finally {
        clearTimeout(timeout);
    }
}
