"use client";

import { useEffect, useMemo, useState } from "react";
import AdminAnalytics from "./AdminAnalytics";
import type { AdminChallenge, AdminCompletion, AdminJob, AdminLog, AdminMetrics, AdminOverview, AdminUser, CohortResetResult, DeleteChallengeResult, SettingsResponse, SiteSettings } from "./dashboard-types";
import { formatDate } from "./format";
import { Metric } from "./Metric";

const ADMIN_COMPLETIONS_PAGE_SIZE = 25;

function localDateTimeInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function editDateTimeValue(value: string | undefined, fallback: string) {
  if (value === undefined) return localDateTimeInput(new Date(fallback));
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDateTimeInput(date) : "";
}

function localInputToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function nextAvailableDay(challenges: { day: number }[]) {
  for (let day = 1; day <= 30; day += 1) {
    if (!challenges.some((challenge) => challenge.day === day)) return String(day);
  }
  return "";
}

function CohortResetPanel({ api, token, onReset }: { api: string; token: string; onReset: (result: CohortResetResult) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  async function startCohort() {
    if (confirmation !== "START DAY 1" || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`${api}/api/admin/cohort/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmation }),
      });
      const body = await response.json().catch(() => ({})) as CohortResetResult & { error?: string };
      if (!response.ok) {
        if (response.status === 404) throw new Error("The backend hasn’t been deployed with cohort reset yet. Deploy the latest backend, then try again.");
        if (response.status === 401 || response.status === 403) throw new Error("Your admin session has expired. Sign in again, then retry.");
        if (body.error === "reset_cohort_migration_required") throw new Error("Apply migration 009_reset_cohort.sql in Supabase, then try again.");
        if (body.error === "day_one_missing") throw new Error("Add a Day 1 question before starting a new cohort.");
        if (body.error === "confirmation_required") throw new Error("Type START DAY 1 exactly to confirm.");
        throw new Error("Couldn’t reset the cohort. Check the audit log and try again.");
      }
      setConfirmation("");
      setStatus({ kind: "success", text: `Day 1 is live until ${formatDate(body.deadlineAt)}. Kept ${body.challengesKept ?? body.challengesShifted} questions; deleted ${body.completionsDeleted} completions and ${body.jobsDeleted} verification jobs; reset ${body.profilesReset} profiles.` });
      onReset(body);
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Couldn’t reset the cohort." });
    } finally {
      setBusy(false);
    }
  }
  return <article className="panel cohort-reset-panel"><div className="panel-heading"><div><div className="eyebrow">NEW COHORT</div><h2>Start again from Day 1</h2></div><span className="mini-tag cohort-reset-tag">DESTRUCTIVE</span></div><p className="empty-copy">This keeps every account, profile, LeetCode handle, email, academic year, and existing question in the bank. It permanently clears all completions, verification jobs, points, streaks, and verification alerts, then reschedules the existing questions onto a new Day 1 and turns waitlist mode OFF.</p><div className="admin-form-grid cohort-reset-form"><label>Type START DAY 1 to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="START DAY 1" autoComplete="off" spellCheck={false} /></label></div><div className="admin-row-actions"><button className="danger-button" onClick={startCohort} disabled={busy || confirmation !== "START DAY 1"}>{busy ? "Resetting…" : "Start new cohort"}</button></div>{status && <p className={`cohort-reset-status ${status.kind}`} role="status">{status.text}</p>}</article>;
}

function AdminDashboard({ api, token, metrics, challenges, users, jobs, logs, completions, onReturn, onRefresh, onSettingsSaved }: { api: string; token: string; metrics: AdminMetrics | null; challenges: AdminChallenge[]; users: AdminUser[]; jobs: AdminJob[]; logs: AdminLog[]; completions: AdminCompletion[]; onReturn: () => void; onRefresh: (overview: AdminOverview) => void; onSettingsSaved: (settings: SiteSettings) => void }) {
  const [tab, setTab] = useState<"analytics" | "questions" | "completions" | "verification" | "logs" | "settings">("analytics");
  const [completionQuery, setCompletionQuery] = useState("");
  const [completionStatus, setCompletionStatus] = useState("all");
  const [completionChallenge, setCompletionChallenge] = useState("all");
  const [completionYear, setCompletionYear] = useState("all");
  const [completionPoints, setCompletionPoints] = useState("all");
  const [completionPage, setCompletionPage] = useState(1);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<Partial<AdminChallenge>>({});
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedChallenge, setSelectedChallenge] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [submissionAt, setSubmissionAt] = useState(() => localDateTimeInput(new Date()));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newDay, setNewDay] = useState(() => nextAvailableDay(challenges));
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDifficulty, setNewDifficulty] = useState("Easy");
  const [newTopic, setNewTopic] = useState("");
  const [newPoints, setNewPoints] = useState(100);
  const [newPublishedAt, setNewPublishedAt] = useState(() => localDateTimeInput(new Date()));
  const [newDeadlineAt, setNewDeadlineAt] = useState(() => localDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const headers = { "content-type": "application/json", Authorization: `Bearer ${token}` };
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<{ waitlistEnabled: boolean; message: string; launchAt: string }>({ waitlistEnabled: true, message: "", launchAt: "" });
  useEffect(() => {
    const requestHeaders = { "content-type": "application/json", Authorization: `Bearer ${token}` };
    void (async () => {
      const response = await fetch(`${api}/api/admin/settings`, { headers: requestHeaders });
      if (response.ok) {
        const body = await response.json() as SiteSettings;
        setSettings(body);
        setSettingsDraft({ waitlistEnabled: body.waitlistEnabled, message: body.message, launchAt: body.launchAt ? localDateTimeInput(new Date(body.launchAt)) : "" });
      }
    })().catch(() => {});
  }, [api, token]);
  async function saveSettings() { setBusy("settings"); setMessage(""); try { const response = await fetch(`${api}/api/admin/settings`, { method: "PATCH", headers, body: JSON.stringify({ waitlistEnabled: settingsDraft.waitlistEnabled, message: settingsDraft.message, launchAt: settingsDraft.launchAt ? new Date(settingsDraft.launchAt).toISOString() : null }) }); const body = await response.json().catch(() => ({})) as SettingsResponse & { error?: string }; if (!response.ok) throw new Error(body.error === "launch_start_failed" ? "Day 1 could not start, so the waitlist was restored. Check the audit log and retry." : "Couldn’t save settings. Apply migration 005_site_settings.sql in Supabase first."); const nextSettings: SiteSettings = { waitlistEnabled: body.waitlistEnabled, message: body.message, launchAt: body.launchAt, sprintStartedAt: body.sprintStartedAt }; setSettings(nextSettings); onSettingsSaved(nextSettings); const launch = body.launch; setMessage(body.waitlistEnabled ? "Waitlist mode is ON. Students can register but not reach the dashboard." : launch?.started ? `Waitlist OFF. Day ${launch.day} is live until ${launch.deadlineAt ? formatDate(launch.deadlineAt) : "the next deadline"}.` : launch?.reason === "no_challenge" ? "Waitlist OFF, but no challenge exists yet. Add Day 1 through ADD QUESTION." : "Waitlist mode is OFF. Dashboard is live for everyone."); } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t save settings."); } finally { setBusy(""); } }
  async function refresh() { const response = await fetch(`${api}/api/admin/overview`, { headers }); if (!response.ok) throw new Error("Couldn’t refresh admin data."); onRefresh(await response.json() as AdminOverview); }
  async function handleCohortReset(result: CohortResetResult) { setMessage(`Cohort reset. Day 1 is live until ${formatDate(result.deadlineAt)}. Kept ${result.challengesKept ?? result.challengesShifted} questions; deleted ${result.completionsDeleted} completions and ${result.jobsDeleted} verification jobs; reset ${result.profilesReset} profiles.`); try { await refresh(); const response = await fetch(`${api}/api/admin/settings`, { headers }); if (response.ok) { const next = await response.json() as SiteSettings; setSettings(next); setSettingsDraft({ waitlistEnabled: next.waitlistEnabled, message: next.message, launchAt: next.launchAt ? localDateTimeInput(new Date(next.launchAt)) : "" }); onSettingsSaved(next); } } catch (error) { setMessage(error instanceof Error ? `${error.message} Reload the page to see the reset state.` : "Cohort reset, but the admin view couldn’t refresh. Reload the page."); } }
  async function saveChallenge(challenge: AdminChallenge) {
    const payload = {
      day: Number(draft.day ?? challenge.day),
      title: String(draft.title ?? challenge.title).trim(),
      slug: String(draft.slug ?? challenge.slug).trim().toLowerCase(),
      difficulty: String(draft.difficulty ?? challenge.difficulty),
      topic: String(draft.topic ?? challenge.topic).trim(),
      points: Number(draft.points ?? challenge.points),
      published_at: draft.published_at ?? challenge.published_at,
      deadline_at: draft.deadline_at ?? challenge.deadline_at,
    };
    if (!Number.isInteger(payload.day) || payload.day < 1 || payload.day > 30) return setMessage("Day must be between 1 and 30.");
    if (!payload.title) return setMessage("Title is required.");
    if (!/^[a-z0-9-]+$/.test(payload.slug)) return setMessage("Slug can only contain lowercase letters, numbers, and hyphens.");
    if (!payload.topic) return setMessage("Topic is required.");
    if (!Number.isInteger(payload.points) || payload.points < 1 || payload.points > 100) return setMessage("Points must be between 1 and 100.");
    if (!payload.published_at || !payload.deadline_at || !Number.isFinite(Date.parse(payload.published_at)) || !Number.isFinite(Date.parse(payload.deadline_at))) return setMessage("Choose valid publish and deadline times.");
    if (Date.parse(payload.deadline_at) <= Date.parse(payload.published_at)) return setMessage("Deadline must be after the publish time.");
    setBusy(`save-${challenge.id}`);
    setMessage("");
    try {
      const response = await fetch(`${api}/api/admin/challenges/${challenge.id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (response.status === 403) throw new Error("Your admin session has expired. Sign in again, then retry.");
        if (body.error === "day_taken") throw new Error(`Day ${payload.day} already has a question. Only one question per day is allowed.`);
        if (body.error === "slug_taken") throw new Error("That LeetCode slug is already used by another day.");
        if (body.error === "deadline_must_be_after_publish") throw new Error("Deadline must be after the publish time.");
        if (body.error === "challenge_not_found") throw new Error("This question no longer exists. Refresh the list.");
        if (body.error === "invalid_challenge_update") throw new Error("Check the question fields and try again.");
        throw new Error("Couldn’t save the question.");
      }
      setEditingId("");
      setDraft({});
      await refresh();
      setMessage("Question updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn’t save the question.");
    } finally {
      setBusy("");
    }
  }
  async function deleteChallenge(challenge: AdminChallenge) {
    const confirmed = window.confirm(`Delete Day ${challenge.day} · ${challenge.title}?\n\nThis removes the question and any completions or verification jobs attached to it. This cannot be undone.`);
    if (!confirmed) return;
    setBusy(`delete-${challenge.id}`);
    setMessage("");
    try {
      const response = await fetch(`${api}/api/admin/challenges/${challenge.id}`, { method: "DELETE", headers });
      const body = await response.json().catch(() => ({})) as Partial<DeleteChallengeResult> & { error?: string };
      if (!response.ok) {
        if (response.status === 404) throw new Error(body.error === "challenge_not_found" ? "This question no longer exists. Refresh the list." : "The backend hasn’t been deployed with question deletion yet.");
        if (response.status === 403) throw new Error("Your admin session has expired. Sign in again, then retry.");
        throw new Error("Couldn’t delete the question.");
      }
      if (editingId === challenge.id) {
        setEditingId("");
        setDraft({});
      }
      await refresh();
      const details = [
        body.completionsDeleted ? `${body.completionsDeleted} completion records removed` : "",
        body.profilesRecalculated ? `${body.profilesRecalculated} profiles recalculated` : "",
        body.profilesRecalculationFailed ? `${body.profilesRecalculationFailed} profiles need a manual refresh` : "",
      ].filter(Boolean).join(" · ");
      setMessage(`Deleted Day ${challenge.day} · ${challenge.title}.${details ? ` ${details}.` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn’t delete the question.");
    } finally {
      setBusy("");
    }
  }
  function toggleCreate() { if (!showCreate) { setNewDay(nextAvailableDay(challenges)); setNewPublishedAt(localDateTimeInput(new Date())); setNewDeadlineAt(localDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000))); } setShowCreate(!showCreate); }
  async function createChallenge() { const day = Number(newDay); if (!Number.isInteger(day) || day < 1 || day > 30) return setMessage("Day must be between 1 and 30."); if (challenges.some((challenge) => challenge.day === day)) return setMessage(`Day ${day} already has a question. Only one question per day is allowed.`); if (!newDay.trim() || !newTitle.trim() || !newSlug.trim() || !newTopic.trim() || !newPublishedAt || !newDeadlineAt) return setMessage("Fill day, title, slug, topic, publish and deadline times."); if (Date.parse(newDeadlineAt) <= Date.parse(newPublishedAt)) return setMessage("Deadline must be after the publish time."); setBusy("create"); setMessage(""); try { const response = await fetch(`${api}/api/admin/challenges`, { method: "POST", headers, body: JSON.stringify({ day, title: newTitle.trim(), slug: newSlug.trim().toLowerCase(), difficulty: newDifficulty, topic: newTopic.trim(), points: Number(newPoints), published_at: new Date(newPublishedAt).toISOString(), deadline_at: new Date(newDeadlineAt).toISOString() }) }); const body = await response.json().catch(() => ({})) as { error?: string; challenge?: AdminChallenge }; if (!response.ok) { const errorMessage = body.error === "day_taken" ? `Day ${day} already has a question. Only one question per day is allowed.` : body.error === "slug_taken" ? "That LeetCode slug is already used by another day." : body.error === "day_or_slug_taken" ? "That day or slug is already taken. Pick another day/slug." : "Couldn’t add the question."; throw new Error(errorMessage); } setNewDay(""); setNewTitle(""); setNewSlug(""); setNewTopic(""); setNewPublishedAt(""); setNewDeadlineAt(""); setShowCreate(false); await refresh(); setMessage(`Day ${body.challenge?.day} added.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t add the question."); } finally { setBusy(""); } }
  async function moveChallenge(index: number, direction: -1 | 1) { const next = [...challenges]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setBusy("reorder"); setMessage(""); try { const response = await fetch(`${api}/api/admin/challenges/reorder`, { method: "POST", headers, body: JSON.stringify({ order: next.map((challenge) => challenge.id) }) }); if (!response.ok) throw new Error("Couldn’t reorder questions."); await refresh(); setMessage("Question order saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t reorder questions."); } finally { setBusy(""); } }
  async function queueVerification() { if (!selectedUser || !selectedChallenge) return setMessage("Choose a user and question first."); setBusy("queue"); setMessage(""); try { const response = await fetch(`${api}/api/admin/verification/start`, { method: "POST", headers, body: JSON.stringify({ profileId: selectedUser, challengeId: selectedChallenge }) }); if (!response.ok) throw new Error("Couldn’t queue verification."); await refresh(); setMessage("Verification job queued."); } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t queue verification."); } finally { setBusy(""); } }
  async function manualVerify() { if (!selectedUser || !selectedChallenge || !submissionId.trim() || !submissionAt) return setMessage("Enter the user, question, submission ID, and submission time."); setBusy("manual"); setMessage(""); try { const response = await fetch(`${api}/api/admin/verification/manual`, { method: "POST", headers, body: JSON.stringify({ profileId: selectedUser, challengeId: selectedChallenge, submissionId: submissionId.trim(), submissionAt: new Date(submissionAt).toISOString() }) }); const body = await response.json().catch(() => ({})) as { error?: string; duplicate?: boolean; awardedPoints?: number }; if (!response.ok) throw new Error(body.error ?? "Manual verification failed."); await refresh(); setMessage(body.duplicate ? "Already verified. No duplicate points awarded." : `Verified. ${body.awardedPoints} points awarded.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Manual verification failed."); } finally { setBusy(""); } }
  async function runWorker() { setBusy("run"); setMessage(""); try { const response = await fetch(`${api}/api/admin/verification/run`, { method: "POST", headers }); const body = await response.json().catch(() => ({})) as { error?: string; claimed?: number; users?: number; running?: boolean }; if (!response.ok) throw new Error(body.error ?? "Couldn’t start verification."); await refresh(); setMessage(body.running ? "A verification cycle is already running." : `Verification started for ${body.claimed ?? 0} jobs across ${body.users ?? 0} users.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t start verification."); } finally { setBusy(""); } }
  const filteredCompletions = useMemo(() => {
    const query = completionQuery.toLowerCase().trim();
    return completions.filter((completion) => {
      const haystack = `${completion.profile?.name ?? ""} ${completion.profile?.leetcode_username ?? ""} ${completion.challenge?.title ?? ""} day ${completion.challenge?.day ?? ""}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (completionStatus !== "all" && completion.status !== completionStatus) return false;
      if (completionChallenge !== "all" && completion.challenge_id !== completionChallenge) return false;
      if (completionYear !== "all" && completion.profile?.academic_year !== completionYear) return false;
      if (completionPoints === "unset" && completion.awarded_points !== null) return false;
      if (completionPoints !== "all" && completionPoints !== "unset" && completion.awarded_points !== Number(completionPoints)) return false;
      return true;
    });
  }, [completions, completionQuery, completionStatus, completionChallenge, completionYear, completionPoints]);
  const completionSummary = useMemo(() => ({
    verified: completions.filter((completion) => completion.status === "verified").length,
    onTime: completions.filter((completion) => completion.awarded_points === 100).length,
    pending: completions.filter((completion) => completion.status !== "verified").length,
  }), [completions]);
  const completionTotalPages = Math.max(1, Math.ceil(filteredCompletions.length / ADMIN_COMPLETIONS_PAGE_SIZE));
  const completionCurrentPage = Math.min(completionPage, completionTotalPages);
  const completionPageRows = filteredCompletions.slice((completionCurrentPage - 1) * ADMIN_COMPLETIONS_PAGE_SIZE, completionCurrentPage * ADMIN_COMPLETIONS_PAGE_SIZE);
  return <section className="admin-dashboard"><section className="leaderboard-metrics"><Metric label="BACKEND HEALTH" value={metrics?.health ?? "Checking"} detail="API and worker availability" accent /><Metric label="ACTIVE PARTICIPANTS" value={String(metrics?.participants ?? "—")} detail="Persisted student profiles" accent /><Metric label="VERIFIED COMPLETIONS" value={String(metrics?.verified ?? "—")} detail="Persisted verification results" accent /><Metric label="WAITING / RETRYING" value={String(metrics?.queued ?? "—")} detail="Jobs needing worker attention" /></section><article className="panel admin-explainer"><div><div className="eyebrow">ADMIN OPERATIONS</div><h2>Control the sprint safely.</h2><p>Add, edit, reorder, or delete questions, run verification, inspect failures, and manually resolve exceptional submissions. Every action is logged.</p><div className="admin-status-row"><span><span className="status-dot" /> {metrics?.failed ?? "—"} terminal failures</span><span>Admin-only data</span></div></div><div className="admin-explainer-actions"><button className="secondary-button" onClick={runWorker} disabled={busy === "run"}>{busy === "run" ? "Starting…" : "Run verification now"}</button><button className="text-button" onClick={onReturn}>Return to dashboard</button></div></article><div className="admin-tabs" role="tablist"><button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}>Analytics</button><button className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")}>Questions <span>{challenges.length}</span></button><button className={tab === "completions" ? "active" : ""} onClick={() => setTab("completions")}>Completions <span>{completions.length}</span></button><button className={tab === "verification" ? "active" : ""} onClick={() => setTab("verification")}>Verification <span>{jobs.filter((job) => ["queued", "processing", "retry"].includes(job.status)).length}</span></button><button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>Logs <span>{logs.length}</span></button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings{settings && <span>{settings.waitlistEnabled ? "ON" : "OFF"}</span>}</button></div>{message && <div className="admin-message" role="status">{message}</div>}{tab === "analytics" && <AdminAnalytics api={api} token={token} />}{tab === "questions" && <section className="admin-columns"><article className="panel"><div className="panel-heading"><div><div className="eyebrow">ADD QUESTION</div><h2>Publish a new challenge</h2></div><button className="text-button" onClick={toggleCreate}>{showCreate ? "Hide" : "+ Add"}</button></div>{showCreate && <><div className="admin-form-grid"><label>Day (1-30)<input type="number" min="1" max="30" value={newDay} onChange={(event) => setNewDay(event.target.value)} placeholder="e.g. 2" /></label><label>Title<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Two Sum" /></label><label>Slug (leetcode id)<input value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="two-sum" /></label><label>Difficulty<select value={newDifficulty} onChange={(event) => setNewDifficulty(event.target.value)}><option>Easy</option><option>Medium</option><option>Hard</option></select></label><label>Topic<input value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="Arrays" /></label><label>Points<input type="number" min="1" max="100" value={newPoints} onChange={(event) => setNewPoints(Number(event.target.value))} /></label><label>Publish at<input type="datetime-local" value={newPublishedAt} onChange={(event) => setNewPublishedAt(event.target.value)} /></label><label>Deadline at<input type="datetime-local" value={newDeadlineAt} onChange={(event) => setNewDeadlineAt(event.target.value)} /></label></div><p className="empty-copy">Only one question can exist per day. Day 1 starts automatically when the waitlist is turned OFF.</p><div className="admin-row-actions"><button className="primary-button" onClick={createChallenge} disabled={busy === "create"}>{busy === "create" ? "Adding…" : "Add question"}</button></div></>}</article><article className="panel"><div className="panel-heading"><div><div className="eyebrow">QUESTION SEQUENCE</div><h2>Order and edit questions</h2></div><span className="mini-tag">DRAG-FREE SAFE ORDER</span></div>{challenges.length ? <div className="admin-question-list">{challenges.map((challenge, index) => editingId === challenge.id ? <div className="admin-question-row editing" key={challenge.id}><span className="question-day">DAY {String(challenge.day).padStart(2, "0")}</span><div className="admin-form-grid"><label>Day (1-30)<input type="number" min="1" max="30" value={Number(draft.day ?? challenge.day)} onChange={(event) => setDraft({ ...draft, day: Number(event.target.value) })} /></label><label>Title<input value={String(draft.title ?? challenge.title)} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Slug<input value={String(draft.slug ?? challenge.slug)} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label><label>Difficulty<select value={String(draft.difficulty ?? challenge.difficulty)} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></label><label>Topic<input value={String(draft.topic ?? challenge.topic)} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label><label>Points<input type="number" min="1" max="100" value={Number(draft.points ?? challenge.points)} onChange={(event) => setDraft({ ...draft, points: Number(event.target.value) })} /></label><label>Publish at<input type="datetime-local" value={editDateTimeValue(draft.published_at, challenge.published_at)} onChange={(event) => setDraft({ ...draft, published_at: localInputToIso(event.target.value) })} /></label><label>Deadline at<input type="datetime-local" value={editDateTimeValue(draft.deadline_at, challenge.deadline_at)} onChange={(event) => setDraft({ ...draft, deadline_at: localInputToIso(event.target.value) })} /></label></div><div className="admin-row-actions"><button className="primary-button" onClick={() => saveChallenge(challenge)} disabled={busy === `save-${challenge.id}`}>{busy === `save-${challenge.id}` ? "Saving…" : "Save question"}</button><button className="secondary-button" onClick={() => { setEditingId(""); setDraft({}); }}>Cancel</button></div></div> : <div className="admin-question-row" key={challenge.id}><span className="question-day">DAY {String(challenge.day).padStart(2, "0")}</span><div className="admin-question-copy"><strong>{challenge.title}</strong><small>{challenge.slug} · {challenge.difficulty} · {challenge.points} pts</small></div><button className="admin-icon-button" onClick={() => moveChallenge(index, -1)} disabled={index === 0 || busy === "reorder"} aria-label={`Move ${challenge.title} up`}>↑</button><button className="admin-icon-button" onClick={() => moveChallenge(index, 1)} disabled={index === challenges.length - 1 || busy === "reorder"} aria-label={`Move ${challenge.title} down`}>↓</button><button className="text-button" onClick={() => { setEditingId(challenge.id); setDraft({ ...challenge }); }}>Edit</button><button className="text-button danger-text" onClick={() => deleteChallenge(challenge)} disabled={busy === `delete-${challenge.id}`}>{busy === `delete-${challenge.id}` ? "Deleting…" : "Delete"}</button></div>)}</div> : <p className="empty-copy">No questions are available yet. Use ADD QUESTION to publish the first challenge.</p>}</article></section>}{tab === "completions" && <section className="panel ranking-panel admin-completions-panel">
    <div className="panel-heading"><div><div className="eyebrow">USER COMPLETIONS</div><h2>Who solved what</h2></div><span className="mini-tag">{filteredCompletions.length} SHOWN</span></div>
    <p className="empty-copy">Filter the persisted records by student, question, status, academic year, or points. The backend returns the 500 most recent completion records, shown {ADMIN_COMPLETIONS_PAGE_SIZE} per page.</p>
    <div className="admin-form-grid admin-completion-filters">
      <label>Search student or question<input value={completionQuery} onChange={(event) => { setCompletionPage(1); setCompletionQuery(event.target.value); }} placeholder="Name, handle, or question" /></label>
      <label>Status<select value={completionStatus} onChange={(event) => { setCompletionPage(1); setCompletionStatus(event.target.value); }}><option value="all">All statuses</option><option value="verified">Verified</option><option value="pending">Pending</option><option value="not_verified">Not verified</option><option value="delayed">Delayed</option><option value="error">Error</option></select></label>
      <label>Question<select value={completionChallenge} onChange={(event) => { setCompletionPage(1); setCompletionChallenge(event.target.value); }}><option value="all">All questions</option>{challenges.map((challenge) => <option value={challenge.id} key={challenge.id}>Day {challenge.day} · {challenge.title}</option>)}</select></label>
      <label>Academic year<select value={completionYear} onChange={(event) => { setCompletionPage(1); setCompletionYear(event.target.value); }}><option value="all">All years</option><option>Second Year</option><option>Third Year</option><option>Fourth Year</option><option>First Year</option></select></label>
      <label>Points<select value={completionPoints} onChange={(event) => { setCompletionPage(1); setCompletionPoints(event.target.value); }}><option value="all">All points</option><option value="100">100 · on time</option><option value="70">70 · late</option><option value="unset">Not awarded</option></select></label>
    </div>
    <div className="admin-completion-summary"><span>{completionSummary.verified} verified</span><span>{completionSummary.onTime} on-time</span><span>{completionSummary.pending} awaiting / failed</span><span>{completions.length} total records</span><button className="text-button" onClick={() => { setCompletionPage(1); setCompletionQuery(""); setCompletionStatus("all"); setCompletionChallenge("all"); setCompletionYear("all"); setCompletionPoints("all"); }}>Clear filters</button></div>
    {filteredCompletions.length ? <><div className="table-wrap"><table className="admin-completion-table"><thead><tr><th>STUDENT</th><th>YEAR</th><th>DAY</th><th>QUESTION</th><th>STATUS</th><th>POINTS</th><th>SUBMITTED</th><th>VERIFIED</th></tr></thead><tbody>{completionPageRows.map((completion) => <tr key={completion.id}><td><div className="table-person"><div className="avatar small">{(completion.profile?.name ?? "?").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div><strong>{completion.profile?.name ?? "Unknown user"}</strong><small>{completion.profile?.leetcode_username ? `@${completion.profile.leetcode_username}` : "No LeetCode handle"}</small></div></div></td><td>{completion.profile?.academic_year ?? "—"}</td><td>{completion.challenge ? String(completion.challenge.day).padStart(2, "0") : "—"}</td><td><div className="admin-completion-question"><strong>{completion.challenge?.title ?? completion.challenge_id}</strong><small>{completion.challenge?.slug ?? "Challenge removed"}</small></div></td><td><span className={`job-status ${completion.status}`}>{completion.status.replace(/_/g, " ")}</span></td><td>{completion.awarded_points !== null ? `${completion.awarded_points} pts` : "—"}</td><td>{completion.submission_at ? formatDate(completion.submission_at) : "—"}</td><td>{completion.verified_at ? formatDate(completion.verified_at) : "—"}</td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(completionCurrentPage - 1) * ADMIN_COMPLETIONS_PAGE_SIZE + 1}–{Math.min(completionCurrentPage * ADMIN_COMPLETIONS_PAGE_SIZE, filteredCompletions.length)} of {filteredCompletions.length} records</span><div className="pagination-controls"><button className="secondary-button" onClick={() => setCompletionPage((page) => Math.max(1, page - 1))} disabled={completionCurrentPage === 1} aria-label="Previous completion page">← Previous</button><span aria-live="polite">Page {completionCurrentPage} of {completionTotalPages}</span><button className="secondary-button" onClick={() => setCompletionPage((page) => Math.min(completionTotalPages, page + 1))} disabled={completionCurrentPage === completionTotalPages} aria-label="Next completion page">Next →</button></div></div></> : <p className="empty-copy">{completions.length ? "No completions match these filters." : "No student completions have been recorded yet."}</p>}
  </section>}{tab === "verification" && <section className="admin-columns"><article className="panel"><div className="eyebrow">MANUAL VERIFICATION</div><h2>Resolve an exceptional submission</h2><p>Use this only when you have confirmed the accepted submission. The backend still applies the 100/70 point rule and prevents duplicate awards.</p><div className="admin-form-grid"><label>User<select value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose a user</option>{users.map((user) => <option value={user.id} key={user.id}>{user.name} · @{user.leetcode_username ?? "no handle"}</option>)}</select></label><label>Question<select value={selectedChallenge} onChange={(event) => setSelectedChallenge(event.target.value)}><option value="">Choose a question</option>{challenges.map((challenge) => <option value={challenge.id} key={challenge.id}>Day {challenge.day} · {challenge.title}</option>)}</select></label><label>Submission ID / URL<input value={submissionId} onChange={(event) => setSubmissionId(event.target.value)} placeholder="LeetCode submission ID or URL" /></label><label>Accepted at<input type="datetime-local" value={submissionAt} onChange={(event) => setSubmissionAt(event.target.value)} /></label></div><div className="admin-row-actions"><button className="secondary-button" onClick={queueVerification} disabled={busy === "queue"}>{busy === "queue" ? "Queueing…" : "Start verification for user"}</button><button className="primary-button" onClick={manualVerify} disabled={busy === "manual"}>{busy === "manual" ? "Verifying…" : "Manually verify"}</button></div></article><article className="panel"><div className="panel-heading"><div><div className="eyebrow">WORKER STATUS</div><h2>Verification jobs</h2></div><button className="text-button" onClick={refresh}>Refresh</button></div>{jobs.length ? <div className="admin-job-list">{jobs.map((job) => <div className="admin-job-row" key={job.id}><div><strong>{job.profile?.name ?? "Unknown user"}</strong><small>Day {job.challenge?.day ?? "—"} · {job.challenge?.title ?? job.challenge_id}</small></div><span className={`job-status ${job.status}`}>{job.status}</span><span className="job-error">{job.last_error ?? `${job.attempts} attempts`}</span></div>)}</div> : <p className="empty-copy">No verification jobs yet.</p>}</article></section>}{tab === "settings" && <><section className="panel"><div className="panel-heading"><div><div className="eyebrow">LAUNCH CONTROL</div><h2>Waitlist mode</h2></div><span className="mini-tag">{settingsDraft.waitlistEnabled ? "WAITLIST ON" : "LIVE"}</span></div><p className="empty-copy">When ON, students can sign in and register (name, LeetCode handle, year) but cannot reach the dashboard, see questions, or trigger verification. Admins always bypass the gate. Turning it OFF starts Day 1 automatically at that moment.</p><div className="admin-form-grid"><label>Waitlist mode<select value={settingsDraft.waitlistEnabled ? "on" : "off"} onChange={(event) => setSettingsDraft({ ...settingsDraft, waitlistEnabled: event.target.value === "on" })}><option value="on">ON — registration only</option><option value="off">OFF — dashboard live</option></select></label><label>Launch date & time<input type="datetime-local" value={settingsDraft.launchAt} onChange={(event) => setSettingsDraft({ ...settingsDraft, launchAt: event.target.value })} /></label><label>Waitlist message<input value={settingsDraft.message} onChange={(event) => setSettingsDraft({ ...settingsDraft, message: event.target.value })} placeholder="Day 1 drops Sunday at 12:00 AM IST…" /></label></div><div className="admin-row-actions"><button className="primary-button" onClick={saveSettings} disabled={busy === "settings"}>{busy === "settings" ? "Saving…" : "Save settings"}</button></div></section><CohortResetPanel api={api} token={token} onReset={handleCohortReset} /></>}{tab === "logs" && <section className="panel"><div className="panel-heading"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Admin actions and worker outcomes</h2></div><button className="text-button" onClick={refresh}>Refresh logs</button></div>{logs.length ? <div className="admin-log-list">{logs.map((log) => <div className="admin-log" key={log.id}><span className={`job-status ${log.status}`}>{log.status}</span><div><strong>{log.action}</strong><p>{log.message}</p><small>{formatDate(log.created_at)}</small></div></div>)}</div> : <p className="empty-copy">No admin actions have been recorded yet.</p>}</section>}</section>;
}


export default AdminDashboard;
