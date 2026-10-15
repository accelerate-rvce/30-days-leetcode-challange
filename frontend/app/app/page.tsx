"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type View = "overview" | "challenge" | "progress" | "leaderboard" | "resources" | "support";
type Challenge = { id: string; day: number; title: string; slug: string; difficulty: string; topic: string; points: number; publishedAt: string; deadlineAt: string };
type Progress = { profile: { name: string; points: number; streak?: number; leetcode_username?: string; academic_year?: string; academicYear?: string }; verifiedCompletions: number; completionPercentage: number; statuses: { challenge_id: string; status: string; awarded_points?: number }[] };
type LeaderboardRow = { rank: number; name: string; handle: string; academicYear: string; points: number; streak: number; solved: number };

function viewFor(pathname: string): View {
  if (pathname === "/challenge") return "challenge";
  if (pathname === "/progress") return "progress";
  if (pathname === "/leaderboard") return "leaderboard";
  if (pathname === "/resources") return "resources";
  if (pathname === "/support") return "support";
  return "overview";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const view = viewFor(pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedChallengeId, setSelectedChallengeId] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [attemptRecorded, setAttemptRecorded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [leetcodeHandle, setLeetcodeHandle] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const token = session?.access_token;

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    const client = supabase;
    void client.auth.getSession().then(async ({ data }) => { const email = data.session?.user.email?.toLowerCase(); if (email && !email.endsWith("@rvce.edu.in")) { await client.auth.signOut(); setError("Use your @rvce.edu.in Google account."); setSession(null); } else setSession(data.session); setAuthLoading(false); });
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authLoading || !token) { setLoading(false); return; }
    const load = async () => {
      setLoading(true); setError("");
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const challengeResponse = await fetch(`${api}/api/challenges/current`);
        if (!challengeResponse.ok) throw new Error("challenge_unavailable");
        const challengeBody = await challengeResponse.json() as { challenge: Challenge | null };
        setChallenge(challengeBody.challenge);
        const [progressResponse, leaderboardResponse, challengesResponse] = await Promise.all([fetch(`${api}/api/progress`, { headers }), fetch(`${api}/api/leaderboard`), fetch(`${api}/api/challenges`)]);
        if (progressResponse.ok) {
          const nextProgress = await progressResponse.json() as Progress;
          setProgress(nextProgress);
          setLeetcodeHandle(nextProgress.profile.leetcode_username ?? "");
          setAttemptRecorded(nextProgress.statuses.some((item) => item.challenge_id === challengeBody.challenge?.id));
        }
        if (leaderboardResponse.ok) setLeaderboard((await leaderboardResponse.json() as { rows: LeaderboardRow[] }).rows ?? []);
        if (challengesResponse.ok) { const list = (await challengesResponse.json() as { challenges: Challenge[] }).challenges ?? []; setChallenges(list); setSelectedChallengeId(challengeBody.challenge?.id ?? list[0]?.id ?? ""); }
      } catch { setError("We couldn’t load the live challenge data. Try again shortly."); }
      finally { setLoading(false); }
    };
    void load();
  }, [api, authLoading, token]);

  async function signIn() {
    if (!supabase) { setError("Authentication is not configured."); return; }
    const { error: signInError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/`, queryParams: { hd: "rvce.edu.in", prompt: "select_account" } } });
    if (signInError) setError("Couldn’t start sign-in. Try again.");
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError("Couldn’t sign you out. Please try again.");
    else { setSession(null); setProgress(null); setChallenge(null); }
  }

  async function recordAndSolve() {
    const selectedChallenge = challenges.find((item) => item.id === selectedChallengeId) ?? challenge;
    if (!selectedChallenge || !token || recording || attemptRecorded) return;
    setRecording(true); setError("");
    try {
      const response = await fetch(`${api}/api/events/open`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ challengeId: selectedChallenge.id }) });
      if (!response.ok) throw new Error("attempt_record_failed");
      setAttemptRecorded(true);
      window.location.href = `https://leetcode.com/problems/${selectedChallenge.slug}/`;
    } catch { setError("We couldn’t record this attempt. Please try again."); }
    finally { setRecording(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || savingProfile) return;
    setSavingProfile(true); setError("");
    try {
      const response = await fetch(`${api}/api/profile`, { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ leetcode_username: leetcodeHandle.trim() }) });
      if (!response.ok) throw new Error("profile_update_failed");
      setProgress((current) => current ? { ...current, profile: { ...current.profile, leetcode_username: leetcodeHandle.trim() } } : current);
    } catch { setError("We couldn’t save your LeetCode username. Please check it and try again."); }
    finally { setSavingProfile(false); }
  }

  const verified = useMemo(() => progress?.statuses.filter((item) => item.status === "verified") ?? [], [progress]);
  const selectedChallenge = challenges.find((item) => item.id === selectedChallengeId) ?? challenge;

  if (authLoading || loading) return <main className="onboarding-shell"><section className="onboarding-card"><p className="onboarding-kicker">30DAYS</p><h1>Loading your challenge data…</h1></section></main>;
  if (!session) return <main className="onboarding-shell"><section className="onboarding-card"><div className="onboarding-brand"><span>30</span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">RVCE STUDENTS ONLY</p><h1>Sign in to enter the sprint.</h1><p className="onboarding-copy">Your challenges, verification status, and score come from the live database.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-action" onClick={signIn}>Continue with Google <span>→</span></button></div></section></main>;

  const nav: { id: View; label: string; path: string }[] = [{ id: "overview", label: "Home", path: "/" }, { id: "challenge", label: "Challenge", path: "/challenge" }, { id: "progress", label: "My progress", path: "/progress" }, { id: "leaderboard", label: "Leaderboard", path: "/leaderboard" }, { id: "resources", label: "Resources", path: "/resources" }, { id: "support", label: "Support", path: "/support" }];
  const title = view === "leaderboard" ? "THE LEADERBOARD" : view === "progress" ? "YOUR PROGRESS" : view === "challenge" ? "TODAY’S QUESTION" : view === "resources" ? "STUDY RESOURCES" : view === "support" ? "SUPPORT" : "COMMAND CENTER";

  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">30</span><div><strong>30DAYS</strong><small>COLLEGE SPRINT</small></div></div><div className="live-pill"><span className="pulse" /> LIVE</div><nav className="nav-tabs" aria-label="Primary navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => router.push(item.path)}>{item.label}</button>)}</nav><div className="top-actions"><div className="user-avatar">{(progress?.profile.name ?? session.user.email ?? "U").slice(0, 2).toUpperCase()}</div><button className="logout-button" onClick={signOut}>Log out</button></div></header><main className="page-wrap"><section className="hero-row"><div><div className="eyebrow"><span className="accent-dot" /> 30-DAY LEETCODE SPRINT</div><h1>{title}</h1><p>Live data only. Verification may take a few minutes after submission.</p></div></section>{error && <div className="error-banner" role="alert">{error}</div>}{!progress?.profile.leetcode_username && <ProfileSetup handle={leetcodeHandle} setHandle={setLeetcodeHandle} saving={savingProfile} onSave={saveProfile} />}
    {view === "overview" && <><section className="metrics-grid"><Metric label="CURRENT CHALLENGE" value={challenge ? `DAY ${String(challenge.day).padStart(2, "0")}` : "—"} detail={challenge?.title ?? "No challenge published"} /><Metric label="YOUR SCORE" value={`${progress?.profile.points ?? 0} PTS`} detail="Awarded after verification" accent /><Metric label="VERIFIED SOLVES" value={String(progress?.verifiedCompletions ?? 0)} detail="Across this sprint" accent /><Metric label="CURRENT STREAK" value={`${progress?.profile.streak ?? 0} DAYS`} detail="Verified solves only" /></section><ChallengeCard challenge={challenge} onOpen={() => { setSelectedChallengeId(challenge?.id ?? ""); router.push("/challenge"); }} /><ChallengeHistory challenges={challenges} onSelect={(id) => { setSelectedChallengeId(id); setAttemptRecorded(progress?.statuses.some((item) => item.challenge_id === id) ?? false); router.push("/challenge"); }} /></>}
    {view === "challenge" && <ChallengeDetail challenge={selectedChallenge} attemptRecorded={attemptRecorded} recording={recording} onSolve={recordAndSolve} />}
    {view === "progress" && <ProgressView progress={progress} verifiedCount={verified.length} />}
    {view === "leaderboard" && <Leaderboard rows={leaderboard} />}
    {view === "resources" && <EmptyPanel title="Resources are not connected yet" copy="This area will appear when the live resource catalog is configured." />}
    {view === "support" && <EmptyPanel title="Need help?" copy="Contact the challenge administrator with your LeetCode username and submission link. Verification support will be connected here." />}
  </main><footer><span>30DAYS // COLLEGE SPRINT</span><span>LIVE DATABASE</span></footer></div>;
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) { return <article className="metric-card"><div className="metric-label">{label}<span className={accent ? "accent-dot" : "muted-dot"} /></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></article>; }
function ChallengeCard({ challenge, onOpen }: { challenge: Challenge | null; onOpen: () => void }) { return <article className="panel challenge-panel"><div className="panel-heading"><div><div className="eyebrow">TODAY’S QUESTION</div><h2>{challenge?.title ?? "No challenge published"}</h2></div>{challenge && <span className="difficulty easy">{challenge.difficulty.toUpperCase()}</span>}</div>{challenge ? <><div className="problem-meta"><span><b>DAY {String(challenge.day).padStart(2, "0")}</b> CHALLENGE</span><span><b>100 PTS</b> ON TIME</span><span><b>70 PTS</b> LATE</span></div><button className="primary-button" onClick={onOpen}>Open question <span>→</span></button></> : <p className="empty-copy">The next challenge will appear here when it is published.</p>}</article>; }
function ChallengeHistory({ challenges, onSelect }: { challenges: Challenge[]; onSelect: (id: string) => void }) { const past = challenges.slice(1); return <article className="panel activity-panel"><div className="eyebrow">CHALLENGE HISTORY</div><h2>Complete a missed challenge</h2>{past.length === 0 ? <p className="empty-copy">No earlier challenges are available.</p> : <div className="activity-list">{past.map((item) => <div className="activity-row" key={item.id}><span className="question-day">DAY {String(item.day).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>Late completion · 70 points</p></div><button className="text-button" onClick={() => onSelect(item.id)}>Open →</button></div>)}</div>}</article>; }
function ChallengeDetail({ challenge, attemptRecorded, recording, onSolve }: { challenge: Challenge | null; attemptRecorded: boolean; recording: boolean; onSolve: () => void }) { if (!challenge) return <EmptyPanel title="No challenge published" copy="There is no active challenge in the live database." />; return <section className="challenge-detail-layout"><article className="panel challenge-detail"><div className="eyebrow"><span className="accent-dot" /> DAY {String(challenge.day).padStart(2, "0")}</div><div className="detail-title-row"><div><h2>{challenge.title}</h2><p className="slug">leetcode.com/problems/{challenge.slug}</p></div><span className="difficulty easy">{challenge.difficulty.toUpperCase()} · UP TO 100 PTS</span></div><div className="detail-actions"><button className="primary-button" onClick={onSolve} disabled={recording || attemptRecorded}>{recording ? "Recording…" : attemptRecorded ? "Attempt recorded" : "Solve on LeetCode"} <span>↗</span></button><span className={attemptRecorded ? "verification recorded" : "verification"}>{attemptRecorded ? "✓ ATTEMPT RECORDED" : "○ NOT ATTEMPTED"}</span></div></article><aside className="panel deadline-card"><div className="eyebrow">DEADLINE · ASIA/KOLKATA</div><p>{formatDate(challenge.deadlineAt)}</p><div className="status-list"><div><span className="status-dot" /> On time <b>100 pts</b></div><div><span className="muted-dot" /> Late <b>70 pts</b></div><div><span className="muted-dot" /> Verification <b>after submission</b></div></div></aside></section>; }
function ProgressView({ progress, verifiedCount }: { progress: Progress | null; verifiedCount: number }) { return <section className="progress-layout"><div className="progress-main"><article className="panel progress-hero"><div><div className="eyebrow">YOUR VERIFIED RECORD</div><h2>{verifiedCount} verified challenge{verifiedCount === 1 ? "" : "s"}</h2><p>Points are added only after the backend verifies an accepted LeetCode submission.</p></div><div className="big-progress">{progress?.completionPercentage ?? 0}<span>%</span></div></article><section className="metrics-grid progress-metrics"><Metric label="VERIFIED COMPLETIONS" value={String(verifiedCount)} detail="No duplicate points" accent /><Metric label="TOTAL POINTS" value={`${progress?.profile.points ?? 0}`} detail="Database-backed score" /></section></div><aside className="progress-side"><article className="panel"><div className="eyebrow">RULES THAT COUNT</div><p className="rule-copy">Accepted by the challenge deadline earns 100 points. Accepted later earns 70 points. Repeated submissions never award duplicate points.</p></article></aside></section>; }
function Leaderboard({ rows }: { rows: LeaderboardRow[] }) { return <section className="panel ranking-panel"><div className="panel-heading"><div><div className="eyebrow">LIVE RANKINGS</div><h2>All challengers</h2></div></div>{rows.length === 0 ? <p className="empty-copy">No verified participants yet.</p> : <div className="table-wrap"><table><thead><tr><th>RANK</th><th>CHALLENGER</th><th>YEAR</th><th>SOLVED</th><th>STREAK</th><th>SCORE</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.rank}-${row.name}`}><td className="rank-cell">{String(row.rank).padStart(2, "0")}</td><td><strong>{row.name}</strong><small>{row.handle}</small></td><td>{row.academicYear}</td><td>{row.solved}</td><td>{row.streak} days</td><td className="score-cell">{row.points} pts</td></tr>)}</tbody></table></div>}</section>; }
function EmptyPanel({ title, copy }: { title: string; copy: string }) { return <article className="panel empty-state"><h2>{title}</h2><p className="empty-copy">{copy}</p></article>; }
function ProfileSetup({ handle, setHandle, saving, onSave }: { handle: string; setHandle: (value: string) => void; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) { return <article className="panel profile-setup"><div><div className="eyebrow">ONE-TIME SETUP</div><h2>Connect your LeetCode username</h2><p className="empty-copy">We use your public username to verify accepted submissions. We never ask for your LeetCode password.</p></div><form className="inline-form" onSubmit={onSave}><label htmlFor="leetcode-handle">LeetCode username</label><input id="leetcode-handle" value={handle} onChange={(event) => setHandle(event.target.value)} pattern="[A-Za-z0-9_-]+" required /><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save username"}</button></form></article>; }
