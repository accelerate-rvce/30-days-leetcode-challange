"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ParticleText from "../components/ParticleText";
import { supabase } from "../lib/supabase";

type View = "overview" | "challenge" | "progress" | "resources" | "leaderboard" | "support" | "admin";
type Role = "student" | "admin";
type OnboardingStage = "loading" | "welcome" | "briefing" | "signin" | "waitlist" | "success" | "app";

const runners = [
  { rank: 1, name: "Nisha Kapoor", handle: "@nisha.codes", branch: "CSE · B23", solved: 7, streak: 7, score: 262, trend: "+2", tier: "Gold" },
  { rank: 2, name: "Devansh Mehta", handle: "@devansh_m", branch: "CSE · B22", solved: 7, streak: 7, score: 248, trend: "−1", tier: "Silver" },
  { rank: 3, name: "Arjun Sharma", handle: "@arjun.builds", branch: "IT · A19", solved: 7, streak: 6, score: 231, trend: "+1", tier: "Bronze" },
  { rank: 4, name: "Maya Iyer", handle: "@maya_iyer", branch: "CSE · B27", solved: 6, streak: 6, score: 214, trend: "+4", tier: "" },
  { rank: 5, name: "Rohan Das", handle: "@rohan_d", branch: "ECE · A12", solved: 6, streak: 5, score: 207, trend: "−2", tier: "" },
  { rank: 6, name: "Aarav Singh", handle: "@aarav_s", branch: "CSE · B31", solved: 5, streak: 5, score: 188, trend: "+3", tier: "" },
  { rank: 7, name: "Ishita Rao", handle: "@ishita.codes", branch: "CSE · B14", solved: 5, streak: 4, score: 176, trend: "−1", tier: "" },
  { rank: 8, name: "Kabir Jain", handle: "@kabir_j", branch: "AI · B08", solved: 4, streak: 4, score: 161, trend: "+1", tier: "" },
];

const resources = [
  { category: "DSA Roadmaps & Problem Sheets", title: "Striver's A2Z DSA Sheet", detail: "A structured DSA course and practice sheet.", kind: "Roadmap", href: "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2" },
  { category: "DSA Roadmaps & Problem Sheets", title: "NeetCode Roadmap", detail: "Topic-by-topic problem roadmap for interview preparation.", kind: "Roadmap", href: "https://neetcode.io/roadmap" },
  { category: "DSA Roadmaps & Problem Sheets", title: "CSES Problem Set", detail: "A broad competitive programming problem collection.", kind: "Problem set", href: "https://cses.fi/problemset/" },
  { category: "YouTube Learning Resources", title: "CodeWithMik", detail: "YouTube channel for programming and DSA learning.", kind: "Channel", href: "https://www.youtube.com/@CodeWithMik" },
  { category: "YouTube Learning Resources", title: "Aditya Verma: Dynamic Programming", detail: "A focused dynamic programming playlist.", kind: "Playlist", href: "https://www.youtube.com/playlist?list=PL_z_8CaSLPWekqhdCPmFohncHwz8TY2Go" },
  { category: "YouTube Learning Resources", title: "TLE Eliminators: DP-1", detail: "Introduction to dynamic programming.", kind: "Video", href: "https://www.youtube.com/watch?v=_OPJaU2Xz7o" },
  { category: "YouTube Learning Resources", title: "TLE Eliminators: CSES solutions", detail: "Playlist link is pending source verification.", kind: "Pending", href: null },
] as const;

const postedQuestions = [
  { day: 25, title: "3Sum", href: "https://leetcode.com/problems/3sum/", complete: false },
  { day: 24, title: "Longest Consecutive Sequence", href: "https://leetcode.com/problems/longest-consecutive-sequence/", complete: true },
  { day: 23, title: "Product of Array Except Self", href: "https://leetcode.com/problems/product-of-array-except-self/", complete: true },
];

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function Metric({ label, value, detail, progress, accent = false }: { label: string; value: string; detail: string; progress?: number; accent?: boolean }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}<span className={accent ? "accent-dot" : "muted-dot"} /></div>
      <div className="metric-value">{value}</div>
      {progress !== undefined && <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>}
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

function Podium({ runner, place }: { runner: typeof runners[number]; place: "first" | "second" | "third" }) {
  return (
    <article className={`podium podium-${place}`}>
      <div className="podium-topline" />
      <div className="podium-rank">0{runner.rank}</div>
      <div className="podium-tier">{runner.tier.toUpperCase()} TIER</div>
      <div className="podium-person">
        <div className="avatar">{runner.name.split(" ").map((part) => part[0]).join("")}</div>
        <div><h3>{runner.name}</h3><p>{runner.branch} · {runner.handle}</p></div>
      </div>
      <div className="podium-stats"><span><b>{runner.solved}/7</b> SOLVED</span><span><b>{runner.streak}D</b> STREAK</span><span><b>{runner.score}</b> SCORE</span></div>
    </article>
  );
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const [onboarding, setOnboarding] = useState<OnboardingStage>("app");
  
  // Extract view from pathname, default to overview
  const getViewFromPathname = (pathname: string): View => {
    if (pathname === "/challenge") return "challenge";
    if (pathname === "/progress") return "progress";
    if (pathname === "/resources") return "resources";
    if (pathname === "/leaderboard") return "leaderboard";
    if (pathname === "/support") return "support";
    if (pathname === "/admin") return "admin";
    return "overview"; // default for "/" or unknown paths
  };
  
   // This is supplied by the authenticated profile in production.
   const [role] = useState<Role>((process.env.NEXT_PUBLIC_DEMO_ROLE === "admin" ? "admin" : "student"));
   const isAdmin = role === "admin";

   // Redirect non-admin users trying to access admin page to home
   useEffect(() => {
     if (pathname === "/admin" && !isAdmin) {
       router.push("/");
     }
   }, [pathname, isAdmin, router]);

   const view: View = getViewFromPathname(pathname);
   const [syncing, setSyncing] = useState(false);
   const [syncComplete, setSyncComplete] = useState(false);
   const [ticketSent, setTicketSent] = useState(false);
   const [query, setQuery] = useState("");
   const [category, setCategory] = useState("Submission not verified");
   const [message, setMessage] = useState("");
   const [openRecorded, setOpenRecorded] = useState(false);
   const [resourceQuery, setResourceQuery] = useState("");
   const [adminStats, setAdminStats] = useState({ health: "Checking", verified: "—", queued: "—", failed: "—" });
   const [rvceEmail, setRvceEmail] = useState("");
   const [signInError, setSignInError] = useState("");
   const [isSigningIn, setIsSigningIn] = useState(false);
   const [waitlistName, setWaitlistName] = useState("");
   const [leetcodeHandle, setLeetcodeHandle] = useState("");
   const [academicYear, setAcademicYear] = useState("Third Year");

    const navItems: { id: View; label: string; path: string }[] = [
      { id: "overview", label: "Home", path: "/" },
      { id: "challenge", label: "Challenge", path: "/challenge" },
      { id: "progress", label: "My progress", path: "/progress" },
      { id: "resources", label: "Resources", path: "/resources" },
      { id: "leaderboard", label: "Leaderboard", path: "/leaderboard" },
      { id: "support", label: "Support", path: "/support" },
      ...(isAdmin ? [{ id: "admin" as View, label: "Admin", path: "/admin" }] : []),
    ];

   const filteredRunners = runners.filter((runner) => `${runner.name} ${runner.handle} ${runner.branch}`.toLowerCase().includes(query.toLowerCase()));
   const filteredResources = resources.filter((resource) => `${resource.title} ${resource.detail} ${resource.category}`.toLowerCase().includes(resourceQuery.toLowerCase()));

  useEffect(() => {
    if (onboarding !== "loading") return;
    const timer = window.setTimeout(() => setOnboarding("welcome"), 2400);
    return () => window.clearTimeout(timer);
  }, [onboarding]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const applySession = async () => {
      const { data: { session } } = await client.auth.getSession();
      const email = session?.user.email?.toLowerCase();
      if (!email) return;
      if (!email.endsWith("@rvce.edu.in")) {
        await client.auth.signOut();
        return;
      }
      setRvceEmail(email);
    };
    void applySession();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const email = session?.user.email?.toLowerCase();
      if (email?.endsWith("@rvce.edu.in")) setRvceEmail(email);
      else if (email) void client.auth.signOut();
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (view !== "admin" || !isAdmin) return;
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    Promise.all([fetch(`${api}/api/jobs/metrics`), fetch(`${api}/api/leaderboard`)])
      .then(async ([jobsResponse, leaderboardResponse]) => {
        if (!jobsResponse.ok || !leaderboardResponse.ok) throw new Error("metrics_unavailable");
        const jobs = await jobsResponse.json() as { queued: number; retrying: number; terminalFailures: number; paused: boolean };
        const leaderboard = await leaderboardResponse.json() as { verifiedCompletions: number };
        setAdminStats({ health: jobs.paused ? "Paused" : "Online", verified: String(leaderboard.verifiedCompletions), queued: String(jobs.queued + jobs.retrying), failed: String(jobs.terminalFailures) });
      })
      .catch(() => setAdminStats({ health: "Unavailable", verified: "—", queued: "—", failed: "—" }));
  }, [isAdmin, view]);

  function runSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSyncing(true);
    setSyncComplete(false);
    window.setTimeout(() => { setSyncing(false); setSyncComplete(true); }, 900);
  }

  function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTicketSent(true);
  }

  async function continueWithGoogle() {
    if (!supabase) {
      setSignInError("Google sign-in is not configured yet. Add the Supabase URL and anon key to .env.local.");
      return;
    }
    setIsSigningIn(true);
    setSignInError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { hd: "rvce.edu.in", prompt: "select_account" },
      },
    });
    if (error) { setSignInError("Couldn’t start Google sign-in. Please try again."); setIsSigningIn(false); }
  }

  function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOnboarding("success");
  }

  async function solveOnLeetCode() {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/events/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: "challenge-07" }) });
      if (response.ok) setOpenRecorded(true);
    } finally {
      window.open("https://leetcode.com/problems/two-sum/", "_blank", "noopener,noreferrer");
    }
  }

  if (onboarding === "loading") {
    return <main className="entry-splash" aria-label="Accelerate Club introduction"><div className="onboarding-grid" aria-hidden="true" /><div className="entry-splash-content"><ParticleText text="WELCOME, RVIANS" color="#f3f5ef" highlightColor="#c6ff4d" scatter={135} gatherDuration={1400} stagger={320} pointerRepel={28} repelRadius={110} idleDrift={0.4} fontSize="clamp(2.2rem, 7.4vw, 5rem)" fontWeight={800} /><p>ACCELERATE CLUB INITIATIVE</p></div></main>;
  }

  if (onboarding !== "app") {
    return <main className="onboarding-shell">
      <div className="onboarding-grid" aria-hidden="true" />
      <section className="onboarding-card">
        <div className="onboarding-brand"><span>30</span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div>
        {onboarding === "welcome" && <div className="onboarding-content welcome-content"><p className="onboarding-kicker">WELCOME, RVIANS</p><h1>Make a habit of solving.</h1><p className="onboarding-copy">Accelerate Club invites you to a focused 30-day LeetCode challenge for RVCE students.</p><button className="primary-button onboarding-action" onClick={() => setOnboarding("briefing")}>See how the challenge works <span>→</span></button></div>}
        {onboarding === "briefing" && <div className="onboarding-content"><p className="onboarding-kicker">THE FORMAT</p><h1>One question. Every day.</h1><div className="briefing-list"><div><b>01</b><p>A new LeetCode question is published daily at 6:00 PM IST.</p></div><div><b>02</b><p>Record your attempt, solve on LeetCode, and let the worker verify it after the deadline.</p></div><div><b>03</b><p>Verified solves earn points and build your streak.</p></div></div><div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboarding("welcome")}>Back</button><button className="primary-button" onClick={() => setOnboarding("signin")}>Continue <span>→</span></button></div></div>}
        {onboarding === "signin" && <div className="onboarding-content"><p className="onboarding-kicker">RVCE STUDENTS ONLY</p><h1>Use your college Google account.</h1><p className="onboarding-copy">Sign in with Google using your <code>@rvce.edu.in</code> account to join the waitlist.</p><div className="onboarding-form">{signInError && <p className="form-error" role="alert">{signInError}</p>}<button className="google-button" type="button" onClick={continueWithGoogle} disabled={isSigningIn}><span aria-hidden="true">G</span> {isSigningIn ? "Opening Google…" : "Continue with Google"}</button></div><button className="text-button onboarding-back" onClick={() => setOnboarding("briefing")}>Back to challenge details</button></div>}
        {onboarding === "waitlist" && <div className="onboarding-content"><p className="onboarding-kicker">JOIN THE WAITLIST</p><h1>Tell us where you are starting.</h1><form className="onboarding-form" onSubmit={joinWaitlist}><label>Name<input value={waitlistName} onChange={(event) => setWaitlistName(event.target.value)} autoComplete="name" placeholder="Your full name" required /></label><label>RVCE email<input value={rvceEmail} type="email" readOnly /></label><label>LeetCode username<input value={leetcodeHandle} onChange={(event) => setLeetcodeHandle(event.target.value)} autoComplete="username" placeholder="Your public username" required /></label><label>Academic year<select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)}><option>First Year</option><option>Second Year</option><option>Third Year</option><option>Fourth Year</option></select></label><button className="primary-button onboarding-action" type="submit">Join waitlist <span>→</span></button></form></div>}
        {onboarding === "success" && <div className="onboarding-content success-content"><span className="success-check">✓</span><p className="onboarding-kicker">YOU&apos;RE ON THE LIST</p><h1>We&apos;ll be in touch soon.</h1><p className="onboarding-copy">Next steps will be sent to <strong>{rvceEmail}</strong>. Keep an eye on your inbox and stay tuned.</p><button className="secondary-button" onClick={() => setOnboarding("app")}>Explore challenge preview <span>→</span></button></div>}
      </section>
    </main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">30</span><div><strong>30DAYS</strong><small>COLLEGE SPRINT</small></div></div>
        <div className="live-pill"><span className="pulse" /> DAY 07 <span className="divider" /> LIVE</div>
        <nav className="nav-tabs" aria-label="Primary navigation">
          {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => router.push(item.path)}>{item.label}</button>)}
        </nav>
        <div className="top-actions"><div className="user-avatar">AS</div></div>
      </header>

      <main className="page-wrap">
        <section className="hero-row">
          <div><div className="eyebrow"><span className="accent-dot" /> PLACEMENT READINESS INDEX <span className="muted">· SEASON 02</span></div><h1>{view === "leaderboard" ? "THE LEADERBOARD" : view === "support" ? "SUPPORT" : view === "challenge" ? "TODAY'S QUESTION" : view === "progress" ? "YOUR PROGRESS" : view === "resources" ? "STUDY RESOURCES" : view === "admin" ? "ADMIN MONITORING" : "COMMAND CENTER"}</h1><p>{view === "leaderboard" ? "Consistency wins. Every solved question counts." : view === "support" ? "Get help with your challenge account or verification status." : view === "challenge" ? "Today’s problem is ready when you are." : view === "progress" ? "A clear record of the work you have actually verified." : view === "resources" ? "A curated library for planning practice and filling the gaps." : view === "admin" ? "Live worker health and verification totals." : "A sharp view of your 30-day algorithm sprint."}</p></div>
        </section>

        {view === "overview" && <>
          <section className="metrics-grid"><Metric label="CAMPAIGN CADENCE" value="DAY 07 / 30" detail="23 days remaining in this cohort" progress={23.3} /><Metric label="ACTIVE CHALLENGERS" value="428" detail="98.4% submission rate this week" /><Metric label="YOUR SCORE" value="210 PTS" detail="Rank #03 · top 1% of cohort" accent /><Metric label="CURRENT STREAK" value="07 DAYS" detail="Best streak in your cohort" progress={70} accent /></section>
          <section className="overview-grid">
            <article className="panel challenge-panel"><div className="panel-heading"><div><div className="eyebrow">TODAY&apos;S QUESTION <span className="muted">· DAY 07</span></div><h2>Two Sum</h2></div><span className="difficulty easy">EASY</span></div><div className="problem-meta"><span><b>LC-001</b> PROBLEM ID</span><span><b>20 PTS</b> AVAILABLE</span><span><b>18:00 IST</b> DEADLINE</span></div><button className="primary-button" onClick={() => router.push("/challenge")}>Open question <span>→</span></button></article>
            <article className="panel tracker-panel"><div className="panel-heading"><div><div className="eyebrow">STREAK TRACKER</div><h2>30 days in motion</h2></div><span className="tracker-count">7 <small>/ 30</small></span></div><div className="day-grid">{Array.from({ length: 30 }, (_, index) => <span key={index} className={index < 7 ? "complete" : index === 7 ? "today" : ""}>{String(index + 1).padStart(2, "0")}</span>)}</div><div className="tracker-foot"><span><span className="legend complete" /> completed</span><span><span className="legend today" /> today</span><span>next reset in 04:32:18</span></div></article>
          </section>
          <section className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">POSTED QUESTIONS</div><h2>Continue where you left off</h2></div><button className="text-button" onClick={() => router.push("/challenge")}>Open today&apos;s question →</button></div><div className="activity-list">{postedQuestions.map((question) => <div className="activity-row posted-question" key={question.day}><span className="question-day">DAY {String(question.day).padStart(2, "0")}</span><div><strong>{question.title}</strong><p><a href={question.href} target="_blank" rel="noreferrer">Open on LeetCode ↗</a></p></div><span className={question.complete ? "verified" : "question-pending"}>{question.complete ? "✓ DONE" : "PENDING"}</span></div>)}</div></section>
        </>}

        {view === "challenge" && <section className="challenge-detail-layout"><article className="panel challenge-detail"><div className="eyebrow"><span className="accent-dot" /> DAY 07 · PUBLISHED 18:00 IST</div><div className="detail-title-row"><div><h2>Two Sum</h2><p className="slug">leetcode.com/problems/two-sum</p></div><span className="difficulty easy">EASY · 20 PTS</span></div><div className="detail-actions"><button className="primary-button" onClick={solveOnLeetCode}>Solve on LeetCode <span>↗</span></button><span className={openRecorded ? "verification recorded" : "verification"}>{openRecorded ? "✓ ATTEMPT RECORDED" : "○ NOT ATTEMPTED"}</span></div></article><aside className="panel deadline-card"><div className="eyebrow">VERIFICATION WINDOW</div><div className="countdown">04:32:18</div><p>Deadline · tomorrow at 18:00 IST</p><div className="status-list"><div><span className="status-dot" /> Attempt recorded <b>{openRecorded ? "yes" : "pending"}</b></div><div><span className="muted-dot" /> Submission check <b>after deadline</b></div><div><span className="muted-dot" /> Points <b>20 pts</b></div></div></aside></section>}

        {view === "progress" && <section className="progress-layout"><div className="progress-main"><article className="panel progress-hero"><div><div className="eyebrow">YOUR VERIFIED RECORD</div><h2>7 of 30 days complete</h2><p>Keep showing up. Your streak is based on verified solutions, not clicks.</p></div><div className="big-progress">23<span>%</span></div></article><section className="metrics-grid progress-metrics"><Metric label="VERIFIED COMPLETIONS" value="07" detail="No duplicate points awarded" accent /><Metric label="CURRENT STREAK" value="07 DAYS" detail="Longest streak: 07 days" accent /><Metric label="TOTAL POINTS" value="210" detail="Rank #03 in cohort" /><Metric label="DIFFICULTY MIX" value="4 · 2 · 1" detail="Easy · medium · hard" /></section><article className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">CHALLENGE CALENDAR</div><h2>Consistency at a glance</h2></div><span className="mini-tag">ASIA / KOLKATA</span></div><div className="day-grid large-day-grid">{Array.from({ length: 30 }, (_, index) => <span key={index} className={index < 7 ? "complete" : index === 7 ? "today" : ""}>{String(index + 1).padStart(2, "0")}</span>)}</div></article></div><aside className="progress-side"><article className="panel"><div className="eyebrow">RECENT ACTIVITY</div>{["Two Sum", "Valid Parentheses", "Best Time to Buy and Sell Stock"].map((item, i) => <div className="history-row" key={item}><span className="history-day">0{i + 5}</span><div><strong>{item}</strong><small>Verified · +{[20, 25, 30][i]} pts</small></div><span className="verified">✓</span></div>)}</article><article className="panel"><div className="eyebrow">RULES THAT COUNT</div><p className="rule-copy">A streak day is earned only when the backend verifies an accepted submission inside that challenge&apos;s eligibility window.</p></article></aside></section>}

        {view === "resources" && <section className="resources-page"><div className="resource-controls"><div><span className="resource-count">{filteredResources.length} resources</span><p>Each link opens in a new tab. Save the paths that fit your current weak spot.</p></div><label className="search-box resource-search"><Icon>⌕</Icon><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="Search topics or source" aria-label="Search resources" /></label></div>{["DSA Roadmaps & Problem Sheets", "YouTube Learning Resources"].map((category) => { const items = filteredResources.filter((resource) => resource.category === category); return <section className="resource-section" key={category}><div className="resource-section-heading"><h2>{category}</h2><span>{items.length} listed</span></div>{items.length ? <div className="resource-grid">{items.map((resource) => <article className="resource-card" key={resource.title}><div className="resource-card-top"><span className={`resource-kind ${resource.href ? "" : "pending"}`}>{resource.kind}</span><span aria-hidden="true">{resource.href ? "↗" : "· · ·"}</span></div><h3>{resource.title}</h3><p>{resource.detail}</p>{resource.href ? <a href={resource.href} target="_blank" rel="noreferrer" className="resource-link">Open resource <span>↗</span></a> : <span className="resource-unavailable">Link pending verification</span>}</article>)}</div> : <div className="resource-empty"><strong>No resources match “{resourceQuery}”.</strong><button className="text-button" onClick={() => setResourceQuery("")}>Clear search</button></div>}</section>; })}</section>}

        {view === "admin" && isAdmin && <section className="admin-page"><section className="leaderboard-metrics"><Metric label="BACKEND HEALTH" value={adminStats.health} detail="API and worker availability" accent /><Metric label="VERIFIED COMPLETIONS" value={adminStats.verified} detail="Persisted verification results" accent /><Metric label="WAITING / RETRYING" value={adminStats.queued} detail="Jobs that need worker attention" /><Metric label="TERMINAL FAILURES" value={adminStats.failed} detail="Review before retrying" /></section><article className="panel admin-explainer"><div><div className="eyebrow">OPERATIONS VIEW</div><h2>Verification is asynchronous</h2><p>Students never need to wait for a verification request. These totals refresh whenever an admin opens this page.</p></div><button className="secondary-button" onClick={() => router.push("/")}>Return to dashboard</button></article></section>}

        {view === "leaderboard" && <>
          <section className="leaderboard-metrics"><Metric label="VERIFIED SOLUTIONS" value="1,984" detail="+12.8% since yesterday" accent /><Metric label="AVG. COHORT SCORE" value="146 PTS" detail="Across 428 challengers" /><Metric label="SYNC POLLER" value="ACTIVE" detail="Last run 18 seconds ago" accent /></section>
          <section className="podium-grid"><Podium runner={runners[1]} place="second" /><Podium runner={runners[0]} place="first" /><Podium runner={runners[2]} place="third" /></section>
          <section className="panel ranking-panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT SPLIT · 428 STUDENTS</div><h2>All challengers</h2></div><label className="search-box"><Icon>⌕</Icon><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or handle" /></label></div><div className="table-wrap"><table><thead><tr><th>RANK</th><th>CHALLENGER</th><th>BRANCH</th><th>SOLVED</th><th>STREAK</th><th>SCORE</th><th>TREND</th></tr></thead><tbody>{filteredRunners.map((runner) => <tr key={runner.rank} className={runner.rank <= 3 ? "top-row" : ""}><td className="rank-cell">{String(runner.rank).padStart(2, "0")}</td><td><div className="table-person"><div className="avatar small">{runner.name.split(" ").map((part) => part[0]).join("")}</div><div><strong>{runner.name}</strong><small>{runner.handle}</small></div></div></td><td>{runner.branch}</td><td>{runner.solved} / 7</td><td>{runner.streak} days</td><td className="score-cell">{runner.score} pts</td><td className={runner.trend.startsWith("+") ? "trend-up" : "trend-down"}>{runner.trend}</td></tr>)}</tbody></table></div></section>
        </>}

        {view === "support" && <>
          <section className="support-layout">
            <div className="support-main">
              {isAdmin ? <>
                <article className="panel support-card"><div className="panel-heading"><div><div className="eyebrow">01 // ON-DEMAND VERIFICATION PING</div><h2>Check a submission</h2></div><span className="mini-tag">INSTANT RUNNER</span></div><p>Poll the public LeetCode feed directly and award a streak point when a submission is found.</p><form className="sync-form" onSubmit={runSync}><input aria-label="LeetCode handle" placeholder="LeetCode handle" required /><input aria-label="Problem ID" placeholder="LC # / slug" defaultValue="LC-001" required /><button className="primary-button" type="submit">{syncing ? "Checking..." : "Verify sync"} <span>{syncing ? "↻" : "→"}</span></button></form>{syncComplete && <div className="console"><span>&gt; connecting to graph.leetcode.com...</span><span>&gt; querying recent acceptance stamps...</span><strong>&gt; [OK] solution acknowledged. +1 streak point awarded.</strong></div>}</article>
                <article className="panel support-card"><div className="panel-heading"><div><div className="eyebrow">02 // COHORT SUPPORT TICKET</div><h2>Contact the support desk</h2></div><span className="mini-tag">EST. SLA &lt; 20M</span></div><div className="chip-row">{["Submission not verified", "Changed handle", "Question clarification", "Account error"].map((item) => <button type="button" className={category === item ? "chip selected" : "chip"} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><form className="ticket-form" onSubmit={submitTicket}><div className="input-row"><input aria-label="College email" type="email" placeholder="College email" required /><input aria-label="Cohort tag" placeholder="Cohort ID / team tag" /></div><textarea aria-label="Diagnostic message" maxLength={600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the issue and include a submission timestamp or problem link." required /><div className="form-foot"><span>⌁ end-to-end verified via HMAC signature</span><button className="primary-button" type="submit">Dispatch ticket <span>→</span></button></div></form>{ticketSent && <div className="success-banner"><strong>TICKET DISPATCHED · #TK-88210</strong><span>A direct dispatch webhook was broadcast to cohort mentors.</span></div>}</article>
               </> : <article className="panel access-card"><div className="lock-mark">⌁</div><div><div className="eyebrow">SUPPORT CONTACT</div><h2>Get in touch</h2><p>Just contact us via email and we&apos;ll redirect your inquiry to the appropriate team members.</p></div></article>}
            </div>
            <aside className="support-side"><article className="panel health-card"><div className="panel-heading"><div><div className="eyebrow">LIVE INFRASTRUCTURE</div><h2>Operational</h2></div><span className="health-badge"><span className="status-dot" /> 99.98%</span></div><div className="sparkline"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="health-row"><span>LeetCode sync daemon</span><strong>12ms</strong></div><div className="health-row"><span>Ticket delivery queue</span><strong>0 pending</strong></div><div className="health-row"><span>Mentor relay</span><strong>online</strong></div></article><article className="panel contact-card"><div className="eyebrow">SELECTED ADMIN PEOPLE</div><h2>Live relay contacts</h2><p>Available to the cohort operations group during the active sprint window.</p><div className="contact-person"><div className="avatar small">RK</div><div><strong>Rhea Kapoor</strong><small>Program operations · online</small></div><span className="status-dot" /></div><div className="contact-person"><div className="avatar small">AM</div><div><strong>Aditya Menon</strong><small>Technical mentor · 4 min avg</small></div><span className="status-dot" /></div></article></aside>
          </section>
        </>}
      </main>
      <footer><span>30DAYS // COLLEGE SPRINT</span><span>SYNC STATUS: NOMINAL · LAST UPDATED 18 SEC AGO</span></footer>
    </div>
  );
}
