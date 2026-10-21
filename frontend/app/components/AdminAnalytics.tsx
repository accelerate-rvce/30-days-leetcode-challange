"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminAnalytics as AdminAnalyticsData, AdminAnalyticsRegistration } from "./dashboard-types";
import { formatDate } from "./format";
import { Metric } from "./Metric";

const REGISTRATION_PAGE_SIZE = 25;
const dayFormatter = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const numberFormatter = new Intl.NumberFormat("en-IN");

function formatDay(value: string) {
  return dayFormatter.format(new Date(`${value}T12:00:00+05:30`));
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(rows: AdminAnalyticsRegistration[]) {
  const headers = ["Name", "LeetCode", "Academic year", "Role", "Registered", "Points", "Streak", "Solved", "Attempts", "Last activity"];
  const lines = rows.map((row) => [
    row.name,
    row.leetcode_username ?? "",
    row.academic_year,
    row.role,
    row.created_at,
    row.points,
    row.streak,
    row.solved,
    row.attempts,
    row.last_activity_at ?? "",
  ].map(csvCell).join(","));
  const blob = new Blob([[headers.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `30days-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdminAnalytics({ api, token }: { api: string; token: string }) {
  const [data, setData] = useState<AdminAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [role, setRole] = useState("all");
  const [progress, setProgress] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${api}/api/admin/analytics`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? "Admin access is required." : "Couldn’t load analytics.");
        setData(await response.json() as AdminAnalyticsData);
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Couldn’t load analytics.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [api, token, reloadKey]);

  const filteredRegistrations = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return (data?.registrations ?? []).filter((registration) => {
      const haystack = `${registration.name} ${registration.leetcode_username ?? ""} ${registration.academic_year}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (year !== "all" && registration.academic_year !== year) return false;
      if (role !== "all" && registration.role !== role) return false;
      if (progress === "active" && registration.solved === 0) return false;
      if (progress === "zero" && registration.solved > 0) return false;
      return true;
    });
  }, [data, query, year, role, progress]);

  const pageCount = Math.max(1, Math.ceil(filteredRegistrations.length / REGISTRATION_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRegistrations.slice((currentPage - 1) * REGISTRATION_PAGE_SIZE, currentPage * REGISTRATION_PAGE_SIZE);

  if (loading && !data) {
    return <section className="panel admin-analytics-panel"><p className="empty-copy">Loading analytics…</p></section>;
  }

  if (error && !data) {
    return <section className="panel admin-analytics-panel"><p className="empty-copy">{error}</p><div className="admin-row-actions"><button className="primary-button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></div></section>;
  }

  if (!data) return null;

  const { totals, daily, byAcademicYear, byStatus, registrations } = data;
  const chartMax = Math.max(1, ...daily.flatMap((day) => [day.registrations, day.activeUsers, day.verified]));
  const activeRate = totals.registrations ? Math.round((totals.activeChallengers / totals.registrations) * 100) : 0;
  const handleRate = totals.registrations ? Math.round((totals.withLeetcode / totals.registrations) * 100) : 0;
  const today = daily[daily.length - 1];
  const dailyTotals = daily.reduce((total, day) => ({
    registrations: total.registrations + day.registrations,
    activeUsers: total.activeUsers + day.activeUsers,
    attempts: total.attempts + day.attempts,
    verified: total.verified + day.verified,
    pointsAwarded: total.pointsAwarded + day.pointsAwarded,
  }), { registrations: 0, activeUsers: 0, attempts: 0, verified: 0, pointsAwarded: 0 });

  return <section className="admin-analytics-panel">
    <div className="panel-heading admin-analytics-heading">
      <div><div className="eyebrow">COHORT ANALYTICS</div><h2>Registrations, activity, and progress</h2><p className="empty-copy">App activity is based on challenge attempts and verified solves. Page-view traffic lives in Cloudflare Web Analytics.</p></div>
      <div className="admin-analytics-actions"><span className="mini-tag">{registrations.length} PROFILES</span><button className="secondary-button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button><a className="secondary-button" href="https://dash.cloudflare.com/?to=/:account/web-analytics" target="_blank" rel="noreferrer">Cloudflare traffic ↗</a></div>
    </div>
    {error && <div className="admin-message" role="status">{error}</div>}

    <section className="leaderboard-metrics admin-analytics-metrics">
      <Metric label="REGISTRATIONS" value={numberFormatter.format(totals.registrations)} detail={`+ ${totals.admins} admin profile${totals.admins === 1 ? "" : "s"} in the table`} accent />
      <Metric label="ACTIVE CHALLENGERS" value={numberFormatter.format(totals.activeChallengers)} detail={`${activeRate}% have at least one verified solve`} accent progress={activeRate} />
      <Metric label="VERIFIED SOLVES" value={numberFormatter.format(totals.verifiedCompletions)} detail={`${numberFormatter.format(totals.attempts)} total attempts recorded`} accent />
      <Metric label="POINTS AWARDED" value={numberFormatter.format(totals.pointsAwarded)} detail={`Average ${totals.averagePoints} · median ${totals.medianPoints}`} accent />
      <Metric label="LEETCODE CONNECTED" value={`${handleRate}%`} detail={`${totals.withoutLeetcode} registration${totals.withoutLeetcode === 1 ? "" : "s"} missing a handle`} progress={handleRate} />
      <Metric label="ZERO PROGRESS" value={numberFormatter.format(totals.zeroProgress)} detail="Registered, no verified solve yet" />
      <Metric label="LONGEST STREAK" value={`${totals.longestStreak} days`} detail={`Average current streak ${totals.averageStreak} days`} />
      <Metric label="TODAY (IST)" value={`${numberFormatter.format(today?.activeUsers ?? 0)} active`} detail={`${today?.verified ?? 0} solves · ${today?.registrations ?? 0} joined · ${today?.attempts ?? 0} attempts`} accent={Boolean(today?.activeUsers)} />
    </section>

    <article className="panel admin-analytics-chart-panel">
      <div className="panel-heading"><div><div className="eyebrow">DAILY ACTIVITY · LAST 30 DAYS</div><h2>Registrations and challenge usage</h2></div><span className="mini-tag">{numberFormatter.format(dailyTotals.verified)} SOLVES IN WINDOW</span></div>
      <div className="analytics-chart" role="img" aria-label="Daily registrations, active students, and verified solves for the last 30 days">
        {daily.map((day, index) => <div className="analytics-day" key={day.date}>
          <div className="analytics-bars">
            <span className="analytics-bar registration" style={{ height: `${day.registrations ? Math.max(3, (day.registrations / chartMax) * 100) : 0}%` }} title={`${formatDay(day.date)}: ${day.registrations} registrations`} />
            <span className="analytics-bar active" style={{ height: `${day.activeUsers ? Math.max(3, (day.activeUsers / chartMax) * 100) : 0}%` }} title={`${formatDay(day.date)}: ${day.activeUsers} active students`} />
            <span className="analytics-bar verified" style={{ height: `${day.verified ? Math.max(3, (day.verified / chartMax) * 100) : 0}%` }} title={`${formatDay(day.date)}: ${day.verified} verified solves`} />
          </div>
          <small>{index % 5 === 0 || index === daily.length - 1 ? formatDay(day.date) : ""}</small>
        </div>)}
      </div>
      <div className="analytics-legend"><span><i className="analytics-dot registration" />Registrations</span><span><i className="analytics-dot active" />Active students</span><span><i className="analytics-dot verified" />Verified solves</span></div>
    </article>

    <div className="admin-analytics-split">
      <article className="panel">
        <div className="panel-heading"><div><div className="eyebrow">ACADEMIC YEAR</div><h2>Where the cohort comes from</h2></div></div>
        <div className="table-wrap"><table className="analytics-breakdown-table"><thead><tr><th>YEAR</th><th>REGISTRATIONS</th><th>VERIFIED</th><th>POINTS</th></tr></thead><tbody>{byAcademicYear.map((row) => <tr key={row.academicYear}><td>{row.academicYear}</td><td>{numberFormatter.format(row.registrations)}</td><td>{numberFormatter.format(row.verified)}</td><td>{numberFormatter.format(row.points)}</td></tr>)}</tbody></table></div>
      </article>
      <article className="panel">
        <div className="panel-heading"><div><div className="eyebrow">COMPLETION STATUS</div><h2>Verification pipeline</h2></div></div>
        <div className="analytics-status-list">{byStatus.length ? byStatus.map((row) => <div key={row.status}><span className={`job-status ${row.status}`}>{row.status.replace(/_/g, " ")}</span><strong>{numberFormatter.format(row.count)}</strong></div>) : <p className="empty-copy">No attempts recorded yet.</p>}</div>
      </article>
    </div>

    <article className="panel">
      <div className="panel-heading"><div><div className="eyebrow">DAILY BREAKDOWN</div><h2>Every day in the window</h2></div><span className="mini-tag">{numberFormatter.format(dailyTotals.registrations)} JOINED · {numberFormatter.format(dailyTotals.attempts)} ATTEMPTS</span></div>
      <div className="table-wrap"><table className="analytics-breakdown-table analytics-daily-table"><thead><tr><th>DATE</th><th>REGISTRATIONS</th><th>ACTIVE STUDENTS</th><th>ATTEMPTS</th><th>VERIFIED</th><th>POINTS</th></tr></thead><tbody>{daily.map((day) => <tr key={day.date}><td>{formatDay(day.date)}</td><td>{day.registrations}</td><td>{day.activeUsers}</td><td>{day.attempts}</td><td>{day.verified}</td><td>{numberFormatter.format(day.pointsAwarded)}</td></tr>)}</tbody></table></div>
    </article>

    <article className="panel ranking-panel admin-registrations-panel">
      <div className="panel-heading"><div><div className="eyebrow">ALL REGISTRATIONS</div><h2>Every registered profile</h2></div><span className="mini-tag">{filteredRegistrations.length} SHOWN</span></div>
      <p className="empty-copy">Search every student or admin, check their LeetCode handle, registration date, progress, and last challenge activity. Export the current filter to CSV for offline analysis.</p>
      <div className="admin-form-grid admin-registration-filters">
        <label>Search student<input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Name, handle, or year" /></label>
        <label>Academic year<select value={year} onChange={(event) => { setPage(1); setYear(event.target.value); }}><option value="all">All years</option><option>First Year</option><option>Second Year</option><option>Third Year</option><option>Fourth Year</option></select></label>
        <label>Role<select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}><option value="all">All roles</option><option value="student">Students</option><option value="admin">Admins</option></select></label>
        <label>Progress<select value={progress} onChange={(event) => { setPage(1); setProgress(event.target.value); }}><option value="all">All progress</option><option value="active">At least one solve</option><option value="zero">Zero solves</option></select></label>
      </div>
      <div className="admin-completion-summary"><span>{totals.registrations} students</span><span>{totals.activeChallengers} active</span><span>{totals.withLeetcode} with LeetCode</span><span>{totals.withoutLeetcode} missing handle</span><button className="text-button" onClick={() => { setPage(1); setQuery(""); setYear("all"); setRole("all"); setProgress("all"); }}>Clear filters</button><button className="text-button" onClick={() => downloadCsv(filteredRegistrations)}>Export CSV</button></div>
      {filteredRegistrations.length ? <><div className="table-wrap"><table className="admin-registration-table"><thead><tr><th>STUDENT</th><th>YEAR</th><th>ROLE</th><th>REGISTERED</th><th>SOLVED</th><th>ATTEMPTS</th><th>POINTS</th><th>STREAK</th><th>LAST ACTIVITY</th></tr></thead><tbody>{pageRows.map((registration) => <tr key={registration.id}><td><div className="table-person"><div className="avatar small">{initials(registration.name)}</div><div><strong>{registration.name}</strong><small>{registration.leetcode_username ? `@${registration.leetcode_username}` : "No LeetCode handle"}</small></div></div></td><td>{registration.academic_year}</td><td><span className={`job-status ${registration.role === "admin" ? "success" : "pending"}`}>{registration.role}</span></td><td>{formatDate(registration.created_at)}</td><td>{registration.solved}</td><td>{registration.attempts}</td><td>{numberFormatter.format(registration.points)}</td><td>{registration.streak} days</td><td>{registration.last_activity_at ? formatDate(registration.last_activity_at) : "—"}</td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(currentPage - 1) * REGISTRATION_PAGE_SIZE + 1}–{Math.min(currentPage * REGISTRATION_PAGE_SIZE, filteredRegistrations.length)} of {filteredRegistrations.length} registrations</span><div className="pagination-controls"><button className="secondary-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Previous registration page">← Previous</button><span aria-live="polite">Page {currentPage} of {pageCount}</span><button className="secondary-button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} aria-label="Next registration page">Next →</button></div></div></> : <p className="empty-copy">{registrations.length ? "No registrations match these filters." : "No registrations have been recorded yet."}</p>}
    </article>
    <p className="admin-analytics-footnote">Generated {formatDate(data.generatedAt)} · Daily buckets and today’s activity use Asia/Kolkata (IST).</p>
  </section>;
}
