"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { formatDate, formatTime } from "./format";
import { Metric } from "./Metric";
import type { AdminChallenge, AdminCompletion, AdminJob, AdminLog, AdminMetrics, AdminOverview, AdminUser, Challenge, LeaderboardRow, Progress, SiteSettings } from "./dashboard-types";
import ParticleText from "./ParticleText";
import { playVerifiedSound, unlockVerifiedSound } from "../lib/verified-sound";
import { playWhoosh, primeWhoosh } from "../lib/whoosh-sound";
import { playClickSound, primeClickSound } from "../lib/click-sound";
import { playSiteEntrance } from "../lib/site-sound";
import { clearDashboardSnapshot, readDashboardSnapshot, readSettingsCache, writeDashboardSnapshot, writeSettingsCache } from "../lib/dashboard-cache";

const AdminDashboard = dynamic(() => import("./AdminDashboard"), {
  ssr: false,
  loading: () => <section className="panel"><p className="empty-copy">Loading admin controls…</p></section>,
});

// Rive touches canvas/wasm at import time, so keep it out of the server render.
const VerifiedCelebration = dynamic(() => import("./VerifiedCelebration"), { ssr: false });

type View = "overview" | "challenge" | "progress" | "profile" | "leaderboard" | "resources" | "support" | "admin";
type OnboardingStage = "welcome" | "briefing" | "signin" | "waitlist" | "ready";

const resources = [
  { category: "DSA Roadmaps & Problem Sheets", title: "Striver's A2Z DSA Sheet", detail: "A structured DSA course and practice sheet.", kind: "Roadmap", href: "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2" },
  { category: "DSA Roadmaps & Problem Sheets", title: "NeetCode Roadmap", detail: "Topic-by-topic problem roadmap for interview preparation.", kind: "Roadmap", href: "https://neetcode.io/roadmap" },
  { category: "DSA Roadmaps & Problem Sheets", title: "CSES Problem Set", detail: "A broad competitive programming problem collection.", kind: "Problem set", href: "https://cses.fi/problemset/" },
  { category: "YouTube Learning Resources", title: "CodeWithMik", detail: "YouTube channel for programming and DSA learning.", kind: "Channel", href: "https://www.youtube.com/@CodeWithMik" },
  { category: "YouTube Learning Resources", title: "Aditya Verma: Dynamic Programming", detail: "A focused dynamic programming playlist.", kind: "Playlist", href: "https://www.youtube.com/playlist?list=PL_z_8CaSLPWekqhdCPmFohncHwz8TY2Go" },
  { category: "YouTube Learning Resources", title: "TLE Eliminators: DP-1", detail: "Introduction to dynamic programming.", kind: "Video", href: "https://www.youtube.com/watch?v=_OPJaU2Xz7o" },
] as const;

const supportEmails = [process.env.NEXT_PUBLIC_SUPPORT_EMAIL_ONE, process.env.NEXT_PUBLIC_SUPPORT_EMAIL_TWO].filter((email): email is string => Boolean(email));
const whatsappGroupUrl = "https://chat.whatsapp.com/BkepWkoH1ftLOI58e9EPq3?s=cl&p=a&mlu=4&ilr=4";
const statusPageUrl = "https://stats.uptimerobot.com/O9xAk33KUL";
const statusApiUrl = "https://stats.uptimerobot.com/api/getMonitorList/O9xAk33KUL";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

// The intro is a one-per-tab experience. Keeping the flag in sessionStorage
// means a reload (or any hard navigation the router falls back to) reuses the
// dashboard instead of replaying "WELCOME, RVIANS", while a fresh tab still
// gets the intro.
const introSeenKey = "30days:intro-seen";
function hasSeenIntro() {
  try { return window.sessionStorage.getItem(introSeenKey) === "1"; } catch { return false; }
}
function rememberIntro() {
  try { window.sessionStorage.setItem(introSeenKey, "1"); } catch { /* private mode: replay is harmless */ }
}
const noopSubscribe = () => () => {};

function viewFor(pathname: string): View {
  const route = pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
  if (route === "/challenge") return "challenge";
  if (route === "/progress") return "progress";
  if (route === "/profile") return "profile";
  if (route === "/leaderboard") return "leaderboard";
  if (route === "/resources") return "resources";
  if (route === "/support") return "support";
  if (route === "/admin") return "admin";
  return "overview";
}

// Read the day straight from the address bar. Doing this without
// `useSearchParams` keeps the dashboard out of a client-render bailout, so a
// tab or a history link paints on the same click instead of waiting for the
// route payload to arrive.
function requestedDayFromLocation(): number | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("day");
  return value && /^\d{1,2}$/.test(value) ? Number(value) : null;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

async function fetchSiteSettings(api: string, signal?: AbortSignal): Promise<SiteSettings> {
  const response = await fetch(`${api}/api/settings`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`settings_${response.status}`);
  const body = await response.json() as Partial<SiteSettings>;
  if (typeof body.waitlistEnabled !== "boolean" || typeof body.message !== "string" || (body.launchAt !== null && typeof body.launchAt !== "string") || (body.sprintStartedAt !== undefined && body.sprintStartedAt !== null && typeof body.sprintStartedAt !== "string")) {
    throw new Error("invalid_settings");
  }
  return { waitlistEnabled: body.waitlistEnabled, message: body.message, launchAt: body.launchAt ?? null, sprintStartedAt: body.sprintStartedAt ?? null };
}

type DashboardPayload = {
  settings?: SiteSettings | null;
  challenge: Challenge | null;
  challenges: Challenge[];
  nextPublishAt?: string | null;
  progress: Progress | null;
  leaderboard: LeaderboardRow[];
  admin?: AdminOverview | null;
};

// Everything the dashboard needs in one round trip: settings, the challenge
// window, progress, the leaderboard, and (for admins) the monitoring panels.
async function fetchDashboard(api: string, token: string): Promise<DashboardPayload> {
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${api}/api/bootstrap`, { headers, cache: "no-store" });
  // A rolling deploy can leave the new frontend talking to an older backend.
  // Fall back to the per-resource endpoints rather than breaking the page.
  if (response.status === 404 || response.status === 405) return fetchDashboardLegacy(api, token);
  if (!response.ok) throw new Error(`bootstrap_${response.status}`);
  return await response.json() as DashboardPayload;
}

async function fetchDashboardLegacy(api: string, token: string): Promise<DashboardPayload> {
  const headers = { Authorization: `Bearer ${token}` };
  const [challengeResponse, progressResponse, leaderboardResponse, challengesResponse] = await Promise.all([
    fetch(`${api}/api/challenges/current`, { headers }),
    fetch(`${api}/api/progress`, { headers }),
    fetch(`${api}/api/leaderboard`, { headers }),
    fetch(`${api}/api/challenges`, { headers }),
  ]);
  const launchGated = challengeResponse.status === 403;
  if (!challengeResponse.ok && !launchGated) throw new Error("challenge_unavailable");
  const challengeBody = launchGated ? { challenge: null } : await challengeResponse.json() as { challenge: Challenge | null };
  const progress = progressResponse.ok ? await progressResponse.json() as Progress : null;
  const leaderboard = leaderboardResponse.ok ? (await leaderboardResponse.json() as { rows: LeaderboardRow[] }).rows ?? [] : [];
  const challenges = challengesResponse.ok ? (await challengesResponse.json() as { challenges: Challenge[] }).challenges ?? [] : [];
  let admin: AdminOverview | null = null;
  if (progress?.profile.role === "admin") {
    const adminResponse = await fetch(`${api}/api/admin/overview`, { headers });
    if (adminResponse.ok) admin = await adminResponse.json() as AdminOverview;
  }
  return { challenge: challengeBody.challenge ?? null, challenges: launchGated ? [] : challenges, progress, leaderboard, admin, settings: null, nextPublishAt: null };
}

function useGridSpotlight() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let x = 0;
    let y = 0;
    let active = false;

    const paint = () => {
      frame = 0;
      root.style.setProperty("--pointer-x", `${x}px`);
      root.style.setProperty("--pointer-y", `${y}px`);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      x = event.clientX;
      y = event.clientY;
      if (!active) {
        active = true;
        root.style.setProperty("--grid-glow-opacity", "1");
      }
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const hideSpotlight = () => {
      active = false;
      root.style.setProperty("--grid-glow-opacity", "0");
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", hideSpotlight);
    window.addEventListener("blur", hideSpotlight);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", hideSpotlight);
      window.removeEventListener("blur", hideSpotlight);
      root.style.removeProperty("--pointer-x");
      root.style.removeProperty("--pointer-y");
      root.style.removeProperty("--grid-glow-opacity");
    };
  }, []);
}

function AccelerateMark() {
  const gradientId = `accelerate-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="accelerate-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="5" y1="5" x2="35" y2="35" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset=".48" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradientId})`} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25">
        <path d="M20 5 L33 12.5 L33 27.5 L20 35 L7 27.5 L7 12.5 Z" />
        <path d="M23.5 13.5 L23.5 26.5 L12 20 Z" />
        <path d="M20 5 L23.5 13.5 M20 5 L12 20 M33 12.5 L23.5 13.5 M33 12.5 L23.5 26.5 M33 27.5 L23.5 26.5 M20 35 L23.5 26.5 M20 35 L12 20 M7 27.5 L12 20 M7 12.5 L12 20 M7 12.5 L23.5 13.5" opacity=".7" />
      </g>
      <g fill="#e0f2fe">
        <circle cx="20" cy="5" r="1.5" /><circle cx="33" cy="12.5" r="1.5" /><circle cx="33" cy="27.5" r="1.5" />
        <circle cx="20" cy="35" r="1.5" /><circle cx="7" cy="27.5" r="1.5" /><circle cx="7" cy="12.5" r="1.5" />
      </g>
      <g fill="#c4b5fd">
        <circle cx="23.5" cy="13.5" r="1.5" /><circle cx="23.5" cy="26.5" r="1.5" /><circle cx="12" cy="20" r="1.5" />
      </g>
    </svg>
  );
}

export default function ChallengeApp() {
  const router = useRouter();
  const pathname = usePathname();
  // The active view and the day are local state so navigation paints on click;
  // the URL is kept in sync in the background for reloads and sharing.
  const [view, setView] = useState<View>(() => viewFor(pathname));
  // /challenge?day=7 opens that day. Without it the page means "today", which
  // is also what the Challenge tab does.
  const [requestedDay, setRequestedDay] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [introDone, setIntroDone] = useState(false);
  // `useSyncExternalStore` lets the server keep rendering the intro markup
  // while the client reads sessionStorage after hydration, without a mismatch.
  const introSeen = useSyncExternalStore(noopSubscribe, hasSeenIntro, () => false);
  const introComplete = introSeen || introDone;
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>("welcome");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedChallengeId, setSelectedChallengeId] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardQuery, setLeaderboardQuery] = useState("");
  const [attemptRecorded, setAttemptRecorded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState("");
  const [leetcodeHandle, setLeetcodeHandle] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [waitlistName, setWaitlistName] = useState("");
  const [academicYear, setAcademicYear] = useState("Second Year");
  const [resourceQuery, setResourceQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics | null>(null);
  const [adminChallenges, setAdminChallenges] = useState<AdminChallenge[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminJobs, setAdminJobs] = useState<AdminJob[]>([]);
  const [adminCompletions, setAdminCompletions] = useState<AdminCompletion[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [settingsRetry, setSettingsRetry] = useState(0);
  // The check a student just triggered, if any. The Realtime listener (not a
  // timer) is what resolves it; the marker only survives long enough to stop a
  // stale response from overwriting a newer check.
  const pendingCheck = useRef<{ challengeId: string; settled: boolean } | null>(null);
  const [celebration, setCelebration] = useState<{ challengeId: string; points: number } | null>(null);
  const celebrationSequence = useRef(0);
  const dismissCelebration = useCallback(() => setCelebration(null), []);
  const celebrate = useCallback((challengeId: string, points: number) => {
    // The hit is the notification: play it first, then reveal the mascot with
    // its looping music. A newer verdict supersedes one still waiting.
    const sequence = ++celebrationSequence.current;
    void playVerifiedSound().then(() => {
      if (sequence !== celebrationSequence.current) return;
      setCelebration({ challengeId, points });
    });
  }, []);
  const api = (process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000").replace(/\/+$/, "");
  const token = session?.access_token;
  const currentUserId = session?.user.id ?? null;
  // The next scheduled publish (or the current deadline), so the tab can
  // refresh exactly when the question changes instead of polling.
  const [nextPublishAt, setNextPublishAt] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const lastLoadedAt = useRef(0);
  const selectedChallengeRef = useRef("");
  // Bumped by every in-app navigation so a delayed LeetCode hand-off is dropped
  // if the student moves on while the whoosh is still playing.
  const navigationEpoch = useRef(0);
  // Attempts written from this tab that the next progress read may not have
  // seen yet. They keep "Check Now" enabled right after pressing the button.
  const pendingAttempts = useRef<Set<string>>(new Set());
  useGridSpotlight();

  useEffect(() => { selectedChallengeRef.current = selectedChallengeId; }, [selectedChallengeId]);

  useEffect(() => {
    // Follow the address bar (back/forward, external links). The click path is
    // already optimistic in `navigateTo`, so this is a no-op after a push.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(viewFor(pathname));
  }, [pathname]);

  useEffect(() => {
    const sync = () => setRequestedDay(requestedDayFromLocation());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // Paint the destination on the click, then update the address bar directly.
  // Every dashboard route renders this same shell, so a router navigation only
  // exists to change the URL — and an RSC fetch that fails makes the app router
  // fall back to a hard reload (losing the session and replaying the intro).
  const navigateTo = (target: View, path: string, day: number | null = null) => {
    navigationEpoch.current += 1;
    setView(target);
    setRequestedDay(day);
    if (typeof window === "undefined") return;
    const next = `${basePath}${path}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.pushState(null, "", next);
  };

  // One place turns an API payload into state, so the cached snapshot and a
  // live response render identically.
  const applyDashboard = useCallback((payload: DashboardPayload) => {
    if (payload.settings) {
      setSiteSettings(payload.settings);
      writeSettingsCache(payload.settings);
      setSettingsLoading(false);
      setSettingsError("");
    }
    if (payload.progress) {
      setProgress(payload.progress);
      setIsAdmin(payload.progress.profile.role === "admin");
      setLeetcodeHandle(payload.progress.profile.leetcode_username ?? "");
      setWaitlistName(payload.progress.profile.name ?? "");
      setAcademicYear(payload.progress.profile.academic_year && payload.progress.profile.academic_year !== "First Year" ? payload.progress.profile.academic_year : "Second Year");
    }
    setChallenge(payload.challenge ?? null);
    const list = payload.challenges ?? [];
    setChallenges(list);
    setNextPublishAt(payload.nextPublishAt ?? null);
    if (payload.leaderboard) setLeaderboard(payload.leaderboard);
    if (payload.admin) {
      setAdminMetrics(payload.admin.metrics);
      setAdminChallenges(payload.admin.challenges);
      setAdminUsers(payload.admin.users);
      setAdminJobs(payload.admin.jobs);
      setAdminCompletions(payload.admin.completions ?? []);
      setAdminLogs(payload.admin.logs);
    }
    // Keep the student on the question they are looking at, but recover if it
    // no longer exists.
    const current = selectedChallengeRef.current;
    const nextSelected = current && list.some((item) => item.id === current) ? current : (payload.challenge?.id ?? list[0]?.id ?? "");
    setSelectedChallengeId(nextSelected);
    if (nextSelected && payload.progress) {
      // The flag follows the selected question, so opening an older challenge
      // never inherits another one's state. A just-recorded attempt survives
      // the read that has not caught up with the write yet.
      const hasAttempt = pendingAttempts.current.has(nextSelected) || payload.progress.statuses.some((item) => item.challenge_id === nextSelected);
      setAttemptRecorded(hasAttempt);
    }
  }, []);

  const loadDashboard = useCallback(async (mode: "initial" | "background" = "background") => {
    if (!token || !currentUserId) return;
    const request = ++loadRequest.current;
    if (mode === "initial") { setLoading(true); setError(""); }
    try {
      const payload = await fetchDashboard(api, token);
      if (request !== loadRequest.current) return;
      applyDashboard(payload);
      lastLoadedAt.current = Date.now();
      writeDashboardSnapshot(currentUserId, {
        savedAt: Date.now(),
        challenge: payload.challenge ?? null,
        challenges: payload.challenges ?? [],
        nextPublishAt: payload.nextPublishAt ?? null,
        progress: payload.progress,
        leaderboard: payload.leaderboard ?? [],
        admin: payload.admin ?? null,
      });
      setError("");
      setLoading(false);
    } catch {
      if (request !== loadRequest.current) return;
      // With a cached dashboard already on screen a failed revalidation is
      // silent; only a cold load needs the error screen.
      if (mode === "initial") setError("We couldn’t load the live challenge data. Try again shortly.");
      setLoading(false);
    }
  }, [api, applyDashboard, currentUserId, token]);

  useEffect(() => {
    if (introSeen) return;
    const timer = window.setTimeout(() => { rememberIntro(); setIntroDone(true); }, 2400);
    return () => window.clearTimeout(timer);
  }, [introSeen]);

  // Prime the hand-off clip and play the site entrance ident. Autoplay is often
  // blocked until the first gesture; the ident handles that by itself.
  useEffect(() => { primeWhoosh(); playSiteEntrance(); }, []);

  // One capture-phase listener covers every button, link, tab and card in the
  // app (including keyboard activation) without touching each handler.
  useEffect(() => {
    primeClickSound();
    const onClick = () => playClickSound();
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let disposed = false;
    let rejecting = false;

    const rejectNonCollegeAccount = () => {
      if (rejecting) return;
      rejecting = true;
      setError("Use your @rvce.edu.in Google account.");
      setSession(null);
      // Defer signOut outside the auth callback. Supabase warns that calling
      // auth methods while its callback is running can deadlock the client.
      window.setTimeout(() => {
        void client.auth.signOut().finally(() => { rejecting = false; });
      }, 0);
    };

    const acceptSession = (next: Session | null) => {
      if (disposed) return;
      const email = next?.user.email?.toLowerCase();
      if (email && !email.endsWith("@rvce.edu.in")) {
        rejectNonCollegeAccount();
        return;
      }
      setSession(next);
    };

    void client.auth.getSession()
      .then(({ data }) => acceptSession(data.session))
      .catch(() => { /* surfaced by the normal connection error state */ })
      .finally(() => { if (!disposed) setAuthLoading(false); });

    const { data: listener } = client.auth.onAuthStateChange((event, next) => {
      if (disposed) return;
      if (event === "SIGNED_OUT") { setSession(null); return; }
      acceptSession(next);
    });
    return () => { disposed = true; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    // The gate is public data and almost never changes; a cached copy lets a
    // repeat visit render the dashboard before the network answers.
    const cached = readSettingsCache();
    if (cached) {
      // Same external-store exception as the dashboard snapshot below: paint
      // the cached gate once, then correct it from the network.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSiteSettings(cached);
      setSettingsLoading(false);
    }
    const loadSettings = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const next = await fetchSiteSettings(api, controller.signal);
        if (!active) return;
        setSiteSettings(next);
        writeSettingsCache(next);
        setSettingsError("");
      } catch {
        // Keep the last known settings during a transient poll failure, but
        // show a hard error if we have never confirmed the launch gate.
        if (active) setSettingsError("We couldn’t confirm the launch status. Check your connection and try again.");
      } finally {
        inFlight = false;
        window.clearTimeout(timeout);
        if (active) setSettingsLoading(false);
      }
    };
    void loadSettings();
    // Refresh the waitlist gate on return and occasionally while visible.
    // Five minutes is plenty for an admin toggle; the bootstrap response also
    // carries a fresh copy, so this is only a backstop.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSettings();
    }, 5 * 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadSettings();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [api, settingsRetry]);

  // Initial paint: a cached snapshot renders instantly, then a single
  // /bootstrap request revalidates it. Without a snapshot the same call is the
  // first load. Note there is deliberately no dependency on the settings value
  // here — that used to re-run this effect and double the initial fetches.
  useEffect(() => {
    if (authLoading || !token || !currentUserId) return;
    const snapshot = readDashboardSnapshot(currentUserId);
    if (snapshot) {
      // Hydrating from the local snapshot is the point of an effect here: the
      // cache is an external store, it is read once on mount, and the live
      // request immediately corrects it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      applyDashboard(snapshot);
      setLoading(false);
      void loadDashboard("background");
      return;
    }
    void loadDashboard("initial");
  }, [applyDashboard, authLoading, currentUserId, loadDashboard, token]);

  // Selecting a history row navigates to /challenge?day=N, so the choice
  // survives a reload and any dashboard refresh that lands after the click.
  // With no day in the URL, show the current question.
  //
  // `challengeForSelection` is the single source of truth for "which question
  // is on screen": the URL wins, then the day in it, then today. Handlers and
  // the detail card both use it so they can never disagree.
  const challengeForSelection = useCallback(() => {
    if (requestedDay !== null) return challenges.find((item) => item.day === requestedDay) ?? challenge;
    return challenge;
  }, [challenge, challenges, requestedDay]);

  useEffect(() => {
    if (view !== "challenge") return;
    const next = challengeForSelection();
    if (!next) return;
    selectedChallengeRef.current = next.id;
    // The URL, not the cached ref, decides the selection here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedChallengeId(next.id);
    setAttemptRecorded(pendingAttempts.current.has(next.id) || Boolean(progress?.statuses.some((item) => item.challenge_id === next.id)));
  }, [challengeForSelection, progress, view]);

  const realtimeProfileId = session?.user.id ?? null;

  // One long-lived channel per signed-in student. RLS already limits
  // `completions` to the caller's own rows, and the filter narrows the stream to
  // this profile, so the browser never receives another student's writes.
  // `challenges` is public data: a new publish (or an admin edit) is pushed to
  // every open tab, which is what removes polling around the publish time.
  useEffect(() => {
    if (!supabase || !realtimeProfileId || !token) return;
    const client = supabase;
    // A burst of rows (admin edits, a verification writing a job and then a
    // completion) should produce one refresh, not one per row.
    let pendingRefresh = 0;
    const refreshSoon = () => {
      if (pendingRefresh) return;
      pendingRefresh = window.setTimeout(() => {
        pendingRefresh = 0;
        void loadDashboard("background");
      }, 350);
    };

    const channel = client
      .channel(`dashboard:${realtimeProfileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "completions", filter: `profile_id=eq.${realtimeProfileId}` }, (payload) => {
        const row = payload.new as { challenge_id?: string; status?: string; awarded_points?: number | null } | undefined;
        if (!row?.challenge_id || !row.status) return;
        // Paint the verdict immediately; the refetch below reconciles the
        // profile points/streak the worker writes just after the completion.
        setProgress((current) => current ? { ...current, statuses: mergeCompletionStatus(current.statuses, { challenge_id: row.challenge_id!, status: row.status!, awarded_points: row.awarded_points ?? undefined }) } : current);
        const pending = pendingCheck.current;
        if (pending && !pending.settled && pending.challengeId === row.challenge_id) {
          if (row.status === "verified") {
            pending.settled = true;
            setVerifying(false);
            setVerifyMessage(row.awarded_points ? `Verified! +${row.awarded_points} points awarded.` : "Verified! Points awarded.");
            celebrate(row.challenge_id!, row.awarded_points ?? 0);
          } else if (row.status === "not_verified") {
            pending.settled = true;
            setVerifying(false);
            setVerifyMessage("No accepted submission found for this problem yet. Solve it on LeetCode, then press Check Now again.");
          }
        }
        refreshSoon();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "challenges" }, refreshSoon)
      .subscribe((status) => {
        // Fires on first connect and again after every reconnect. Re-reading
        // here recovers anything missed while the socket was down.
        if (status === "SUBSCRIBED") void loadDashboard("background");
      });

    return () => {
      if (pendingRefresh) window.clearTimeout(pendingRefresh);
      // Leave pendingCheck alone: a token refresh re-runs this effect, and the
      // in-flight check should still be resolved by the reconnected channel.
      void client.removeChannel(channel);
    };
  }, [celebrate, loadDashboard, realtimeProfileId, token]);

  // Refresh exactly when the question window changes: at the current
  // deadline, or when the next challenge is scheduled to publish. The timer is
  // clamped to six hours and re-armed on every refresh, so a laptop waking
  // from sleep still catches up without a polling loop.
  useEffect(() => {
    if (!token) return;
    const now = Date.now();
    const boundary = [challenge?.deadlineAt, nextPublishAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((value) => Number.isFinite(value) && value > now)
      .sort((left, right) => left - right)[0];
    if (!boundary) return;
    const delay = Math.min(Math.max(boundary - Date.now() + 2_000, 5_000), 6 * 60 * 60_000);
    const timer = window.setTimeout(() => void loadDashboard("background"), delay);
    return () => window.clearTimeout(timer);
  }, [challenge?.deadlineAt, loadDashboard, nextPublishAt, token]);

  // Coming back to a stale tab (phone unlocked, laptop reopened) should show
  // the current question without a manual reload.
  useEffect(() => {
    if (!token) return;
    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadedAt.current < 60_000) return;
      void loadDashboard("background");
    };
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
    window.addEventListener("online", refreshIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
      window.removeEventListener("online", refreshIfStale);
    };
  }, [loadDashboard, token]);

  useEffect(() => {
    if (session && progress && view === "admin" && progress.profile.role !== "admin") router.replace("/");
  }, [view, progress, router, session]);

  async function signIn() {
    if (!supabase) { setError("Authentication is not configured."); return; }
    setOnboardingStage("signin");
    const { error: signInError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${basePath}/`, queryParams: { hd: "rvce.edu.in", prompt: "select_account" } } });
    if (signInError) setError("Couldn’t start sign-in. Try again.");
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError("Couldn’t sign you out. Please try again.");
    else { if (currentUserId) clearDashboardSnapshot(currentUserId); pendingAttempts.current.clear(); setSession(null); setProgress(null); setChallenge(null); setChallenges([]); setNextPublishAt(null); setAdminMetrics(null); setAdminChallenges([]); setAdminUsers([]); setAdminJobs([]); setAdminCompletions([]); setAdminLogs([]); setIsAdmin(false); setOnboardingStage("welcome"); }
  }

  function openLeetcode(url: string) {
    // A delay for the whoosh outlives the click's transient activation in some
    // browsers, so fall back to the current tab instead of doing nothing when
    // the popup is refused.
    const tab = window.open(url, "_blank");
    if (!tab) { window.location.assign(url); return; }
    try { tab.opener = null; } catch { /* cross-origin handoff */ }
  }

  async function recordAndSolve() {
    const selectedChallenge = challengeForSelection();
    if (!selectedChallenge || !token || recording || opening) return;
    const leetcodeUrl = `https://leetcode.com/problems/${selectedChallenge.slug}/`;
    const epoch = navigationEpoch.current;
    // The clip starts inside the click gesture so the browser allows audio.
    // Recording runs alongside it, and LeetCode opens once the whoosh lands.
    const whoosh = playWhoosh();
    if (attemptRecorded) {
      setOpening(true);
      await whoosh;
      if (navigationEpoch.current === epoch) openLeetcode(leetcodeUrl);
      setOpening(false);
      return;
    }
    setRecording(true); setError(""); setVerifyMessage("");
    try {
      const response = await fetch(`${api}/api/events/open`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ challengeId: selectedChallenge.id }) });
      if (!response.ok) throw new Error("attempt_record_failed");
      pendingAttempts.current.add(selectedChallenge.id);
      setAttemptRecorded(true);
      setOpening(true);
      await whoosh;
      if (navigationEpoch.current === epoch) openLeetcode(leetcodeUrl);
    } catch {
      setError("We couldn’t record this attempt. Please try again.");
    }
    finally { setRecording(false); setOpening(false); }
  }

  async function checkSubmission() {
    const target = challengeForSelection();
    if (!target || !token || verifying) return;
    setVerifying(true); setVerifyMessage("Verification request recorded. We’ll check your recent accepted submissions in the background and update your score automatically."); setError("");
    // Browsers only allow audio after a gesture; the verdict arrives later, so
    // prime the context on this click.
    unlockVerifiedSound();
    const headers = { Authorization: `Bearer ${token}` };
    try {
      // The API only writes a job row and answers Pending; it never waits on
      // LeetCode. The worker resolves it and the channel above reports back.
      const queueResponse = await fetch(`${api}/api/verification/request`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ challengeId: target.id }) });
      if (!queueResponse.ok) throw new Error("verification_queue_failed");
    } catch {
      setError("We couldn’t check your submission. Please try again.");
      setVerifyMessage(""); setVerifying(false);
      return;
    }

    const pending: { challengeId: string; settled: boolean } = { challengeId: target.id, settled: false };
    pendingCheck.current = pending;
    const isCurrent = () => !pending.settled && pendingCheck.current === pending;

    // One delayed read covers a dropped socket. It is not a poll: normal
    // resolution comes from the subscription, and the channel re-syncs itself
    // on reconnect.
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20_000));
      if (!isCurrent()) return;
      const progressResponse = await fetch(`${api}/api/progress`, { headers }).catch(() => null);
      if (!isCurrent()) return;
      if (!progressResponse?.ok) {
        setVerifying(false);
        setVerifyMessage("Verification is still in progress in the background. You don’t need to press anything — your score will update automatically once it’s found.");
        return;
      }
      const next = await progressResponse.json() as Progress;
      setProgress(next);
      const entry = next.statuses.find((item) => item.challenge_id === target.id);
      if (entry?.status === "verified") {
        pending.settled = true;
        setVerifying(false);
        setVerifyMessage(entry.awarded_points ? `Verified! +${entry.awarded_points} points awarded.` : "Verified! Points awarded.");
        celebrate(target.id, entry.awarded_points ?? 0);
        return;
      }
      if (!isCurrent()) return;
      setVerifying(false);
      setVerifyMessage(pendingVerificationMessage(entry));
    })();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || savingProfile) return;
    if (!waitlistName.trim()) { setError("Enter your name to register."); return; }
    if (!leetcodeHandle.trim()) { setError("A LeetCode account is required to register."); return; }
    setSavingProfile(true); setError("");
    try {
      const response = await fetch(`${api}/api/profile`, { method: "PATCH", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: waitlistName.trim(), academic_year: academicYear, leetcode_username: leetcodeHandle.trim() }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? "profile_update_failed"); }
      const body = await response.json() as { profile?: { name?: string; academic_year?: string; leetcode_username?: string | null } };
      const savedHandle = body.profile?.leetcode_username ?? leetcodeHandle.trim();
      const savedName = body.profile?.name ?? waitlistName.trim();
      const savedYear = body.profile?.academic_year ?? academicYear;
      setLeetcodeHandle(savedHandle);
      setProgress((current) => current ? { ...current, profile: { ...current.profile, name: savedName, academic_year: savedYear, leetcode_username: savedHandle } } : current);
      setOnboardingStage("ready");
      // Registration is complete, but do not trust a possibly stale gate.
      // Re-read the launch setting before rendering either the dashboard or
      // the coming-soon confirmation. If the gate cannot be confirmed, fail
      // closed instead of letting the student through.
      try {
        const latestSettings = await fetchSiteSettings(api);
        setSiteSettings(latestSettings);
        setSettingsError("");
      } catch {
        if (!siteSettings?.waitlistEnabled) {
          setSiteSettings(null);
          setSettingsError("Your registration was saved, but we couldn’t confirm the launch status. Check your connection and try again.");
        }
      }
    } catch (saveError) {
      const code = saveError instanceof Error ? saveError.message : "";
      setError(code === "leetcode_username_not_found" ? "We couldn’t find that LeetCode account. Check the username and try again."
        : code === "leetcode_check_unavailable" ? "LeetCode isn’t responding right now. Please try again in a minute."
        : code === "leetcode_username_required" ? "A LeetCode account is required to register."
        : code === "leetcode_username_taken" ? "That LeetCode account is already linked to another registration. Contact support if this is yours."
        : code === "invalid_leetcode_username" || code === "invalid_profile" ? "Enter a valid LeetCode username or profile URL."
        : "We couldn’t save your LeetCode username. Please check it and try again.");
    }
    finally { setSavingProfile(false); }
  }

  // Profile-page save. Same endpoint as registration, but it stays on the page
  // and reports success instead of advancing the onboarding flow.
  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || profileSaving) return;
    if (!waitlistName.trim()) { setProfileError("Enter your name."); return; }
    if (!leetcodeHandle.trim()) { setProfileError("Enter your LeetCode username or profile URL."); return; }
    setProfileSaving(true); setProfileError(""); setProfileNotice("");
    try {
      const response = await fetch(`${api}/api/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: waitlistName.trim(), academic_year: academicYear, leetcode_username: leetcodeHandle.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; profile?: { name?: string; academic_year?: string; leetcode_username?: string | null } };
      if (!response.ok) throw new Error(body.error ?? "profile_update_failed");
      const saved = body.profile;
      if (saved) {
        setProgress((current) => current ? { ...current, profile: { ...current.profile, name: saved.name ?? current.profile.name, academic_year: saved.academic_year ?? current.profile.academic_year, leetcode_username: saved.leetcode_username ?? null } } : current);
        if (saved.name) setWaitlistName(saved.name);
        if (saved.academic_year) setAcademicYear(saved.academic_year);
        setLeetcodeHandle(saved.leetcode_username ?? "");
      }
      setProfileNotice("Saved. Your LeetCode profile is linked.");
    } catch (saveError) {
      const code = saveError instanceof Error ? saveError.message : "";
      setProfileError(code === "leetcode_username_not_found" ? "We couldn’t find that LeetCode account. Check the URL and try again."
        : code === "leetcode_check_unavailable" ? "LeetCode isn’t responding right now. Try again in a minute."
        : code === "leetcode_username_taken" ? "That LeetCode account is already linked to another student."
        : code === "invalid_leetcode_username" || code === "invalid_profile" ? "Enter a valid name and LeetCode profile URL."
        : "We couldn’t save your profile. Check your connection and try again.");
    } finally { setProfileSaving(false); }
  }

  const verified = useMemo(() => progress?.statuses.filter((item) => item.status === "verified") ?? [], [progress]);
  const selectedChallenge = challengeForSelection();
  const selectedStatus = progress?.statuses.find((item) => item.challenge_id === selectedChallenge?.id);
  // A history link opens a closed day. Say so in the header instead of still
  // calling it "today's" question.
  const viewingPastDay = requestedDay !== null && selectedChallenge != null && selectedChallenge.day !== challenge?.day;
  const filteredResources = useMemo(() => resources.filter((resource) => `${resource.title} ${resource.detail} ${resource.category}`.toLowerCase().includes(resourceQuery.toLowerCase().trim())), [resourceQuery]);

  if (!introComplete) return <main className="entry-splash" aria-label="Accelerate Club introduction"><div className="onboarding-grid" aria-hidden="true" /><div className="entry-splash-content"><ParticleText text="WELCOME, RVIANS" color="#22d3ee" highlightColor="#a855f7" scatter={135} gatherDuration={1400} stagger={320} pointerRepel={28} repelRadius={110} idleDrift={0.4} fontSize="clamp(2.2rem, 7.4vw, 5rem)" fontWeight={800} /><p>ACCELERATE · INNOVATE · CONNECT · INSPIRE</p></div></main>;
  // Session is checked once per mount, but it must never bring the intro back:
  // after the first visit this is a quiet loading card instead.
  if (authLoading) return <LoadingScreen label="Checking your session…" />;
  // Waitlist mode: the public site is ONLY the waitlist screen + register.
  // No dashboard tour, no challenge content for non-admins.
  if (settingsLoading) return <LoadingScreen label="Checking cohort status…" />;
  if (!siteSettings) return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">LAUNCH STATUS UNAVAILABLE</p><h1>We can’t confirm the launch gate.</h1><p className="onboarding-copy">{settingsError || "We couldn’t confirm the launch status. Check your connection and try again."} We’re not loading the dashboard until the backend confirms whether the waitlist is active.</p><div className="onboarding-actions"><button className="primary-button" onClick={() => { setSettingsError(""); setSettingsLoading(true); setSettingsRetry((value) => value + 1); }}>Retry <span>→</span></button>{session && <button className="secondary-button" onClick={signOut}>Log out</button>}</div></div></section></main>;
  if (siteSettings?.waitlistEnabled && !isAdmin && !session) return <LaunchWaitlist message={siteSettings.message} launchAt={siteSettings.launchAt} onSignIn={signIn} error={error} />;
  if (!session) {
    if (onboardingStage === "welcome") return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content welcome-content"><p className="onboarding-kicker">WELCOME, RVIANS</p><h1>Make a habit of solving.</h1><p className="onboarding-copy">Accelerate Club invites you to a focused 30-day LeetCode challenge for RVCE students.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-action" onClick={() => setOnboardingStage("briefing")}>See how the challenge works <span>→</span></button><a className="whatsapp-link" href={whatsappGroupUrl} target="_blank" rel="noreferrer">Join the cohort WhatsApp group <span>↗</span></a></div></section></main>;
    if (onboardingStage === "briefing") return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">THE FORMAT</p><h1>One question. Every day.</h1><div className="briefing-list"><div><b>01</b><p>A new challenge is published daily at 12:00 AM IST.</p></div><div><b>02</b><p>Solve on LeetCode and let the backend verify your accepted submission.</p></div><div><b>03</b><p>Earn 100 points on time or 70 points late, once per challenge.</p></div></div><div className="onboarding-actions"><button className="secondary-button" onClick={() => setOnboardingStage("welcome")}>Back</button><button className="primary-button" onClick={() => setOnboardingStage("signin")}>Continue <span>→</span></button></div></div></section></main>;
    return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">RVCE STUDENTS ONLY</p><h1>Use your college Google account.</h1><p className="onboarding-copy">Sign in with your <code>@rvce.edu.in</code> account to continue. We’ll ask for your LeetCode username next.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="google-button" onClick={signIn}><span aria-hidden="true">G</span> Continue with Google</button><button className="text-button onboarding-back" onClick={() => setOnboardingStage("briefing")}>Back to challenge details</button></div></section></main>;
  }
  if (loading) return <LoadingScreen label="Loading your challenge data…" />;
  if (!progress) return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">CONNECTION INTERRUPTED</p><h1>We couldn’t load your profile.</h1><p className="onboarding-copy">{error || "The challenge API did not respond. Check your connection and try again."}</p><div className="onboarding-actions"><button className="primary-button" onClick={() => window.location.reload()}>Retry <span>→</span></button><button className="secondary-button" onClick={signOut}>Log out</button></div></div></section></main>;
  const launchGated = Boolean(siteSettings?.waitlistEnabled && session && !isAdmin);
  const editingRegistration = Boolean(progress.profile.leetcode_username);
  if (!isAdmin && (onboardingStage === "waitlist" || !editingRegistration)) return <WaitlistDetails name={waitlistName} setName={setWaitlistName} handle={leetcodeHandle} setHandle={setLeetcodeHandle} academicYear={academicYear} setAcademicYear={setAcademicYear} saving={savingProfile} onSave={saveProfile} onCancel={editingRegistration ? () => { setError(""); setOnboardingStage("ready"); } : undefined} error={error} notice={launchGated ? (editingRegistration ? (siteSettings?.message || "You’re registered. The dashboard unlocks at launch.") : "Connect your LeetCode handle to complete your waitlist registration.") : ""} />;
  if (launchGated) return <ComingSoon name={progress.profile.name} handle={progress.profile.leetcode_username ?? ""} academicYear={progress.profile.academic_year ?? "Second Year"} email={session.user.email ?? ""} message={siteSettings?.message ?? ""} launchAt={siteSettings?.launchAt ?? null} onEdit={() => { setError(""); setOnboardingStage("waitlist"); }} onSignOut={signOut} />;

  const nav: { id: View; label: string; path: string }[] = [{ id: "overview", label: "Home", path: "/" }, { id: "challenge", label: "Challenge", path: "/challenge" }, { id: "progress", label: "My progress", path: "/progress" }, { id: "leaderboard", label: "Leaderboard", path: "/leaderboard" }, { id: "resources", label: "Resources", path: "/resources" }, { id: "support", label: "Support", path: "/support" }, ...(isAdmin ? [{ id: "admin" as View, label: "Admin", path: "/admin" }] : [])];
  const title = view === "leaderboard" ? "THE LEADERBOARD" : view === "progress" ? "YOUR PROGRESS" : view === "profile" ? "YOUR PROFILE" : view === "challenge" ? (viewingPastDay && selectedChallenge ? `DAY ${String(selectedChallenge.day).padStart(2, "0")} · PAST CHALLENGE` : "TODAY’S QUESTION") : view === "resources" ? "STUDY RESOURCES" : view === "support" ? "SUPPORT" : view === "admin" ? "ADMIN MONITORING" : "COMMAND CENTER";

  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true"><AccelerateMark /></span><div><strong>30DAYS</strong><small>BY ACCELERATE · RVCE</small></div></div><div className="live-pill"><span className="pulse" /> {challenge ? `DAY ${String(challenge.day).padStart(2, "0")}` : "SPRINT"} <span className="divider" /> LIVE</div><nav className="nav-tabs" aria-label="Primary navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigateTo(item.id, item.path)}>{item.label}</button>)}</nav><div className="top-actions"><button type="button" className="user-avatar" onClick={() => navigateTo("profile", "/profile")} aria-label="Open your profile" title="Your profile">{(progress?.profile.name ?? session.user.email ?? "U").slice(0, 2).toUpperCase()}</button><button type="button" className={`profile-button ${view === "profile" ? "active" : ""}`} onClick={() => navigateTo("profile", "/profile")} aria-current={view === "profile" ? "page" : undefined}>Profile</button><button className="logout-button" onClick={signOut}>Log out</button></div></header><main className="page-wrap"><section className="hero-row"><div><div className="eyebrow"><span className="accent-dot" /> PLACEMENT READINESS INDEX <span className="muted">· SEASON 01</span></div><h1>{title}</h1><p>{view === "leaderboard" ? "Consistency wins. Every solved question counts." : view === "support" ? "Get help with your challenge account or verification status." : view === "challenge" ? (viewingPastDay ? "This day has closed. A late solve still earns points on your record." : "Today’s problem is ready when you are.") : view === "progress" ? "A clear record of the work you have actually verified." : view === "profile" ? "Your name, streak, and the LeetCode profile we verify." : view === "resources" ? "A curated library for planning practice and filling the gaps." : view === "admin" ? "Live worker health and verification totals." : "A sharp view of your 30-day algorithm sprint."}</p></div></section>{error && <div className="error-banner" role="alert">{error}</div>}
    {view === "overview" && <><section className="metrics-grid"><Metric label="CAMPAIGN CADENCE" value={challenge ? `DAY ${String(challenge.day).padStart(2, "0")} / 30` : "—"} detail={challenge ? `${Math.max(0, 30 - challenge.day)} days remaining in this cohort` : "No active cohort"} progress={challenge ? challenge.day / 30 * 100 : undefined} /><Metric label="ACTIVE CHALLENGERS" value={String(leaderboard.length)} detail="Live registered profiles" /><Metric label="YOUR SCORE" value={`${progress?.profile.points ?? 0} PTS`} detail="Awarded after verification" accent /><Metric label="CURRENT STREAK" value={`${progress?.profile.streak ?? 0} DAYS`} detail="Verified solves only" progress={Math.min(100, ((progress?.profile.streak ?? 0) / 30) * 100)} accent /></section><section className="overview-grid"><ChallengeCard challenge={challenge} onOpen={() => { setSelectedChallengeId(challenge?.id ?? ""); setVerifyMessage(""); navigateTo("challenge", "/challenge"); }} /><StreakTracker challenges={challenges} progress={progress} currentChallenge={challenge} /></section><ChallengeHistory challenges={challenges} currentChallenge={challenge} onSelect={(id) => { const item = challenges.find((candidate) => candidate.id === id); setSelectedChallengeId(id); setAttemptRecorded(progress?.statuses.some((entry) => entry.challenge_id === id) ?? false); setVerifyMessage(""); navigateTo("challenge", item ? `/challenge?day=${item.day}` : "/challenge", item?.day ?? null); }} /></>}
    {view === "challenge" && <ChallengeDetail challenge={selectedChallenge} attemptRecorded={attemptRecorded} recording={recording} opening={opening} verifying={verifying} verifyMessage={verifyMessage} verificationStatus={selectedStatus?.status ?? null} verificationJob={selectedStatus?.verification ?? null} awardedPoints={selectedStatus?.awarded_points} onSolve={recordAndSolve} onVerify={checkSubmission} />}
    {view === "progress" && <ProgressView progress={progress} verifiedCount={verified.length} challenges={challenges} />}
    {view === "profile" && <ProfileView progress={progress} email={session.user.email ?? ""} name={waitlistName} handle={leetcodeHandle} academicYear={academicYear} saving={profileSaving} error={profileError} notice={profileNotice} onName={setWaitlistName} onHandle={setLeetcodeHandle} onYear={setAcademicYear} onSave={updateProfile} />}
    {view === "leaderboard" && <Leaderboard rows={leaderboard} query={leaderboardQuery} setQuery={setLeaderboardQuery} me={progress.profile.leetcode_username ?? ""} myName={progress.profile.name} />}
    {view === "resources" && <Resources query={resourceQuery} setQuery={setResourceQuery} filtered={filteredResources} />}
    {view === "support" && <Support />}
    {view === "admin" && isAdmin && <AdminDashboard api={api} token={token ?? ""} metrics={adminMetrics} challenges={adminChallenges} users={adminUsers} jobs={adminJobs} logs={adminLogs} completions={adminCompletions} onReturn={() => navigateTo("overview", "/")} onRefresh={(overview) => { setAdminMetrics(overview.metrics); setAdminChallenges(overview.challenges); setAdminUsers(overview.users); setAdminJobs(overview.jobs); setAdminCompletions(overview.completions); setAdminLogs(overview.logs); }} onSettingsSaved={(next) => { setSiteSettings(next); setSettingsError(""); }} />}
  </main><footer><span>ACCELERATE // THE COMPUTER SCIENCE CLUB OF RVCE · MYSURU ROAD, BENGALURU 560059</span><a className="footer-status" href={statusPageUrl} target="_blank" rel="noreferrer">SYSTEM STATUS ↗</a><span>INNOVATE · CONNECT · INSPIRE</span></footer>{celebration && <VerifiedCelebration points={celebration.points} day={challenges.find((item) => item.id === celebration.challengeId)?.day} onDismiss={dismissCelebration} />}</div>;
}

function ProfileView({ progress, email, name, handle, academicYear, saving, error, notice, onName, onHandle, onYear, onSave }: {
  progress: Progress;
  email: string;
  name: string;
  handle: string;
  academicYear: string;
  saving: boolean;
  error: string;
  notice: string;
  onName: (value: string) => void;
  onHandle: (value: string) => void;
  onYear: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const profile = progress.profile;
  const savedHandle = profile.leetcode_username ?? "";
  const leetcodeUrl = savedHandle ? `https://leetcode.com/u/${savedHandle}/` : null;
  const currentStreak = profile.streak ?? 0;
  const longestStreak = profile.longest_streak ?? currentStreak;
  const initials = (profile.name || email || "U").split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <section className="profile-layout">
    <article className="panel profile-card">
      <div className="eyebrow">STUDENT PROFILE</div>
      <div className="profile-identity">
        <span className="profile-avatar" aria-hidden="true">{initials}</span>
        <div>
          <h2>{profile.name || "RVCE student"}</h2>
          <p>{profile.academic_year ?? academicYear}{email ? ` · ${email}` : ""}</p>
        </div>
      </div>
      <div className="profile-stats">
        <div><small>CURRENT STREAK</small><strong>{currentStreak}<em> days</em></strong></div>
        <div><small>LONGEST STREAK</small><strong>{longestStreak}<em> days</em></strong></div>
        <div><small>POINTS</small><strong>{profile.points}</strong></div>
        <div><small>VERIFIED</small><strong>{progress.verifiedCompletions}<em> / 30</em></strong></div>
      </div>
      <div className="profile-leetcode">
        <div className="eyebrow">LEETCODE PROFILE</div>
        {leetcodeUrl
          ? <a href={leetcodeUrl} target="_blank" rel="noreferrer">{leetcodeUrl}</a>
          : <p className="empty-copy">No LeetCode profile linked yet. Add it on the right so the verifier can read your submissions.</p>}
        <p className="profile-hint">This is the URL we verify against. Example: <code>https://leetcode.com/u/your-handle/</code></p>
      </div>
    </article>
    <article className="panel profile-form-panel">
      <div className="eyebrow">UPDATE SECTION</div>
      <h2>Keep your details current</h2>
      <form className="profile-form" onSubmit={onSave}>
        <label>Name<input value={name} onChange={(event) => onName(event.target.value)} maxLength={120} autoComplete="name" /></label>
        <label>Academic year<select value={academicYear} onChange={(event) => onYear(event.target.value)}>
          {["First Year", "Second Year", "Third Year", "Fourth Year"].map((year) => <option key={year} value={year}>{year}</option>)}
        </select></label>
        <label>LeetCode profile URL<input value={handle} onChange={(event) => onHandle(event.target.value)} placeholder="https://leetcode.com/u/your-handle/" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <p className="form-hint">Paste your full profile URL or just the username. We store the handle and link it as <code>leetcode.com/u/&lt;handle&gt;/</code>.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      </form>
    </article>
  </section>;
}

function ChallengeCard({ challenge, onOpen }: { challenge: Challenge | null; onOpen: () => void }) { return <article className="panel challenge-panel"><div className="panel-heading"><div><div className="eyebrow">TODAY’S QUESTION {challenge && <span className="muted">· DAY {String(challenge.day).padStart(2, "0")}</span>}</div><h2>{challenge?.title ?? "No challenge published"}</h2></div>{challenge && <span className={`difficulty ${challenge.difficulty.toLowerCase()}`}>{challenge.difficulty.toUpperCase()}</span>}</div>{challenge ? <><div className="problem-meta"><span><b>{challenge.slug.toUpperCase()}</b> PROBLEM ID</span><span><b>{challenge.points} PTS</b> AVAILABLE</span><span><b>{formatTime(challenge.deadlineAt)} IST</b> DEADLINE</span></div><p className="challenge-privacy-note"><strong>Curate your profile:</strong> turn on <b>Recent AC Problems and Submission Details</b> and <b>Submission Heatmap</b> in <a href="https://leetcode.com/settings/profile/" target="_blank" rel="noreferrer">LeetCode privacy settings</a> so we can verify your solve.</p><button className="primary-button" onClick={onOpen}>Open question <span>→</span></button></> : <p className="empty-copy">The next challenge will appear here when it is published.</p>}</article>; }
function ChallengeHistory({ challenges, currentChallenge, onSelect }: { challenges: Challenge[]; currentChallenge: Challenge | null; onSelect: (id: string) => void }) { const currentDay = currentChallenge?.day ?? 31; const past = challenges.filter((item) => item.id !== currentChallenge?.id && item.day < currentDay); return <article className="panel activity-panel"><div className="eyebrow">CHALLENGE HISTORY</div><h2>Complete a missed challenge</h2>{past.length === 0 ? <p className="empty-copy">No earlier challenges are available.</p> : <div className="activity-list">{past.map((item) => <div className="activity-row" key={item.id}><span className="question-day">DAY {String(item.day).padStart(2, "0")}</span><div><strong>{item.title}</strong><p>Late completion · 70 points</p></div><button className="text-button" onClick={() => onSelect(item.id)}>Open →</button></div>)}</div>}</article>; }
function StreakTracker({ challenges, progress, currentChallenge }: { challenges: Challenge[]; progress: Progress | null; currentChallenge: Challenge | null }) { const completedDays = new Set((progress?.statuses ?? []).filter((item) => item.status === "verified").map((item) => challenges.find((challenge) => challenge.id === item.challenge_id)?.day).filter((day): day is number => typeof day === "number")); return <article className="panel tracker-panel"><div className="panel-heading"><div><div className="eyebrow">STREAK TRACKER</div><h2>30 days in motion</h2></div><span className="tracker-count">{progress?.profile.streak ?? 0} <small>/ 30</small></span></div><div className="day-grid">{Array.from({ length: 30 }, (_, index) => { const day = index + 1; return <span key={day} className={completedDays.has(day) ? "complete" : currentChallenge?.day === day ? "today" : ""}>{String(day).padStart(2, "0")}</span>; })}</div><div className="tracker-foot"><span><span className="legend complete" /> verified</span><span><span className="legend today" /> current</span><span>next challenge at 00:00 IST</span></div></article>; }
function ChallengeDetail({ challenge, attemptRecorded, recording, opening, verifying, verifyMessage, verificationStatus, verificationJob, awardedPoints, onSolve, onVerify }: {
  challenge: Challenge | null;
  attemptRecorded: boolean;
  recording: boolean;
  opening: boolean;
  verifying: boolean;
  verifyMessage: string;
  verificationStatus: string | null;
  verificationJob: Progress["statuses"][number]["verification"] | null;
  awardedPoints?: number;
  onSolve: () => void;
  onVerify: () => void;
}) {
  const now = useNow();
  if (!challenge) return <EmptyPanel title="No challenge published" copy="There is no active challenge in the live database." />;
  const isVerified = verificationStatus === "verified";
  const availablePoints = isVerified ? (awardedPoints ?? challenge.points) : now <= Date.parse(challenge.deadlineAt) ? challenge.points : 70;
  const jobStatus = verificationJob?.status ?? null;
  // The queued state is read from the verification job, not just this click, so
  // leaving the page and coming back still shows the check in flight instead of
  // inviting another press.
  const pending = !isVerified && (jobStatus === "queued" || jobStatus === "processing" || jobStatus === "retry");
  const pendingMessage = !pending ? ""
    : jobStatus === "processing" ? "LeetCode check in progress. This page updates automatically when it finishes."
    : jobStatus === "retry" ? `No match yet. Automatic checks continue${verificationJob?.nextAttemptAt ? ` — next one around ${formatTime(verificationJob.nextAttemptAt)} IST` : ""}. This page updates automatically.`
    : "Verification queued. We’ll check your recent accepted submissions in the background and update your score automatically.";
  const failedMessage = !isVerified && !pending && (jobStatus === "failed" || verificationStatus === "not_verified")
    ? "No accepted submission was found for this problem. Check that your LeetCode submission history is public, then press Check Now to try again."
    : "";
  const message = verifyMessage || pendingMessage || failedMessage;
  const busy = verifying || pending;
  const checkLabel = verifying ? "Queued…" : jobStatus === "processing" ? "Checking…" : pending ? "Queued…" : "Check Now";

  return <section className="challenge-detail-layout"><article className="panel challenge-detail"><div className="eyebrow"><span className="accent-dot" /> DAY {String(challenge.day).padStart(2, "0")} · PUBLISHED {formatTime(challenge.publishedAt)} IST</div><div className="detail-title-row"><div><h2>{challenge.title}</h2><p className="slug">leetcode.com/problems/{challenge.slug}</p></div><span className={`difficulty ${challenge.difficulty.toLowerCase()}`}>{challenge.difficulty.toUpperCase()} · {availablePoints} PTS</span></div>{!isVerified && <div className="verification-callout"><strong>Curate your profile</strong><p>Control what opens to the public. Both of these must be on:</p><ul className="privacy-rows"><li><span>Recent AC Problems and Submission Details</span><b>On</b></li><li><span>Submission Heatmap</span><b>On</b></li></ul><p>If either is off, we can’t see your accepted submissions and can’t award points. <a href="https://leetcode.com/settings/profile/" target="_blank" rel="noreferrer">Open LeetCode privacy settings ↗</a></p></div>}<div className="detail-actions"><button className="primary-button" onClick={onSolve} disabled={recording || opening}>{recording ? "Recording…" : opening ? "Opening LeetCode…" : attemptRecorded ? "Open on LeetCode" : "Solve on LeetCode"} <span>↗</span></button>{attemptRecorded && !isVerified && <button className="secondary-button" onClick={onVerify} disabled={busy}>{checkLabel}</button>}{attemptRecorded && !isVerified && pending && jobStatus === "retry" && <button type="button" className="text-button" onClick={onVerify}>Solved it? Check now</button>}{isVerified && <span className="verification recorded">✓ VERIFIED +{awardedPoints ?? availablePoints} PTS</span>}{!isVerified && !attemptRecorded && <span className="verification">○ NOT ATTEMPTED</span>}</div>{message && <p className="empty-copy" role="status">{message}</p>}{isVerified && <p className="empty-copy">1 accepted submission = points credited once. Re-submissions never award duplicates.</p>}</article><aside className="panel deadline-card"><div className="eyebrow">VERIFICATION WINDOW</div><div className="countdown" role="timer" aria-label="Time remaining until the deadline">{formatCountdown(challenge.deadlineAt, now)}</div><p>Deadline · {formatDate(challenge.deadlineAt)}</p><div className="status-list"><div><span className={attemptRecorded ? "status-dot" : "muted-dot"} /> Attempt recorded <b>{attemptRecorded ? "yes" : "pending"}</b></div><div><span className={isVerified || pending ? "status-dot" : "muted-dot"} /> Submission check <b>{isVerified ? "verified" : pending ? (jobStatus === "processing" ? "checking" : "queued") : "1 Accepted = points"}</b></div><div><span className="muted-dot" /> Points <b>{availablePoints} pts</b></div></div></aside></section>;
}
function mergeCompletionStatus(statuses: Progress["statuses"], row: { challenge_id: string; status: string; awarded_points?: number }) {
  const existing = statuses.find((item) => item.challenge_id === row.challenge_id);
  const merged = { ...existing, ...row } as Progress["statuses"][number];
  return existing
    ? statuses.map((item) => item.challenge_id === row.challenge_id ? merged : item)
    : [...statuses, merged];
}

// The queue row is the accurate error state: it says whether a pending check is
// in flight, waiting on a scheduled retry, or has given up entirely.
function pendingVerificationMessage(entry?: Progress["statuses"][number]) {
  const job = entry?.verification;
  if (!job) return "No match yet. The worker keeps checking in the background, so press Check Now again once your solve shows up on LeetCode.";
  if (job.status === "failed" || entry?.status === "not_verified") return "No accepted submission was found for this problem. Make sure your LeetCode submission history is public, then press Check Now to try again.";
  const next = job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : NaN;
  if (Number.isFinite(next) && next > Date.now() + 30_000) {
    const minutes = Math.max(1, Math.round((next - Date.now()) / 60_000));
    return `No match yet. The next automatic check runs in about ${minutes} minute${minutes === 1 ? "" : "s"} — or press Check Now once you have solved it.`;
  }
  return "No accepted submission yet. The worker is still checking, so press Check Now again once your solve shows up on LeetCode.";
}

function formatCountdown(deadline: string, now: number) { const remaining = Math.max(0, Date.parse(deadline) - now); const hours = Math.floor(remaining / 3_600_000); const minutes = Math.floor((remaining % 3_600_000) / 60_000); const seconds = Math.floor((remaining % 60_000) / 1_000); return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function ProgressView({ progress, verifiedCount, challenges }: { progress: Progress | null; verifiedCount: number; challenges: Challenge[] }) { const verifiedItems = (progress?.statuses ?? []).filter((item) => item.status === "verified"); const recent = verifiedItems.slice(0, 3); const difficultyCounts = challenges.filter((challenge) => verifiedItems.some((item) => item.challenge_id === challenge.id)).reduce((counts, challenge) => { counts[challenge.difficulty] += 1; return counts; }, { Easy: 0, Medium: 0, Hard: 0 } as Record<string, number>); return <section className="progress-layout"><div className="progress-main"><article className="panel progress-hero"><div><div className="eyebrow">YOUR VERIFIED RECORD</div><h2>{verifiedCount} of 30 days complete</h2><p>Keep showing up. Your streak is based on verified solutions, not clicks.</p></div><div className="big-progress">{progress?.completionPercentage ?? 0}<span>%</span></div></article><section className="metrics-grid progress-metrics"><Metric label="VERIFIED COMPLETIONS" value={String(verifiedCount).padStart(2, "0")} detail="No duplicate points awarded" accent /><Metric label="CURRENT STREAK" value={`${progress?.profile.streak ?? 0} DAYS`} detail="Verified solves only" accent /><Metric label="TOTAL POINTS" value={String(progress?.profile.points ?? 0)} detail="Database-backed score" /><Metric label="DIFFICULTY MIX" value={`${difficultyCounts.Easy} · ${difficultyCounts.Medium} · ${difficultyCounts.Hard}`} detail="Easy · medium · hard" /></section><article className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">CHALLENGE CALENDAR</div><h2>Consistency at a glance</h2></div><span className="mini-tag">ASIA / KOLKATA</span></div><div className="day-grid large-day-grid">{Array.from({ length: 30 }, (_, index) => { const day = index + 1; const challenge = challenges.find((item) => item.day === day); const complete = challenge ? verifiedItems.some((item) => item.challenge_id === challenge.id) : false; return <span key={day} className={complete ? "complete" : ""}>{String(day).padStart(2, "0")}</span>; })}</div></article></div><aside className="progress-side"><article className="panel"><div className="eyebrow">RECENT ACTIVITY</div>{recent.length ? recent.map((item) => { const challenge = challenges.find((candidate) => candidate.id === item.challenge_id); return <div className="history-row" key={item.challenge_id}><span className="history-day">{String(challenge?.day ?? "—").padStart(2, "0")}</span><div><strong>{challenge?.title ?? "Verified challenge"}</strong><small>Verified · +{item.awarded_points ?? 0} pts</small></div><span className="verified">✓</span></div>; }) : <p className="empty-copy">No verified activity yet.</p>}</article><article className="panel"><div className="eyebrow">RULES THAT COUNT</div><p className="rule-copy">A streak day is earned only when the backend verifies an accepted submission inside that challenge&apos;s eligibility window.</p></article></aside></section>; }
const LEADERBOARD_PAGE_SIZE = 10;
function Leaderboard({ rows, query, setQuery, me, myName }: { rows: LeaderboardRow[]; query: string; setQuery: (value: string) => void; me: string; myName: string }) {
  const [page, setPage] = useState(1);
  const normalizedQuery = query.toLowerCase().trim();
  const filteredRows = rows.filter((row) => `${row.name} ${row.handle} ${row.academicYear}`.toLowerCase().includes(normalizedQuery));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / LEADERBOARD_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * LEADERBOARD_PAGE_SIZE, currentPage * LEADERBOARD_PAGE_SIZE);
  const podiumRows = rows.slice(0, 3);
  const totalPoints = rows.reduce((sum, row) => sum + row.points, 0);
  const verifiedSolutions = rows.reduce((sum, row) => sum + row.solved, 0);
  // Match on the verified handle first, then the display name, so the student
  // still finds their rank after renaming their profile.
  const handle = me.trim().toLowerCase();
  const name = myName.trim().toLowerCase();
  const myRow = (handle ? rows.find((row) => row.handle.trim().toLowerCase() === handle) : undefined)
    ?? (name ? rows.find((row) => row.name.trim().toLowerCase() === name) : undefined)
    ?? null;
  const myInitials = (myRow?.name || myName || "?").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const isMe = (row: LeaderboardRow) => row === myRow;

  return <><section className="leaderboard-metrics"><Metric label="VERIFIED SOLUTIONS" value={String(verifiedSolutions)} detail="Across live participants" accent /><Metric label="AVG. COHORT SCORE" value={`${rows.length ? Math.round(totalPoints / rows.length) : 0} PTS`} detail={`Across ${rows.length} challengers`} /><Metric label="SYNC POLLER" value="ACTIVE" detail="Backend verification worker" accent /></section><section className="panel my-rank" aria-label="Your rank"><div className="my-rank-score"><span className="eyebrow">YOUR RANK</span><strong>{myRow ? `#${String(myRow.rank).padStart(2, "0")}` : "—"}</strong><small>{myRow ? `of ${rows.length} challengers` : "Not on the board yet"}</small></div>{myRow ? <><div className="table-person my-rank-person"><div className="avatar small">{myInitials}</div><div><strong>{myRow.name}</strong><small>{myRow.handle}</small></div></div><div className="my-rank-stats"><span><b>{myRow.solved}</b><small>SOLVED</small></span><span><b>{myRow.streak}D</b><small>STREAK</small></span><span><b>{myRow.points}</b><small>PTS</small></span></div></> : <p className="my-rank-empty">Verify your first accepted submission and your rank appears here.</p>}</section>{podiumRows.length >= 3 && <section className="podium-grid"><PodiumCard row={podiumRows[1]} place="second" /><PodiumCard row={podiumRows[0]} place="first" /><PodiumCard row={podiumRows[2]} place="third" /></section>}<section className="panel ranking-panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT SPLIT · {rows.length} STUDENTS</div><h2>All challengers</h2><p className="ranking-rule">POINTS → STREAK → SUBMISSION TIME</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search by name or handle" aria-label="Search by name or handle" /></label></div>{filteredRows.length === 0 ? <p className="empty-copy">{rows.length ? "No challengers match your search." : "No verified participants yet."}</p> : <><div className="table-wrap"><table><thead><tr><th>RANK</th><th>CHALLENGER</th><th>BRANCH</th><th>SOLVED</th><th>STREAK</th><th>SCORE</th><th>TREND</th></tr></thead><tbody>{pageRows.map((row) => <tr key={`${row.rank}-${row.handle || row.name}`} className={[row.rank <= 3 ? "top-row" : "", isMe(row) ? "my-row" : ""].filter(Boolean).join(" ")}><td className="rank-cell">{String(row.rank).padStart(2, "0")}{isMe(row) && <span className="you-tag">YOU</span>}</td><td><div className="table-person"><div className="avatar small">{row.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><strong>{row.name}</strong><small>{row.handle}</small></div></div></td><td>{row.academicYear}</td><td>{row.solved} / 30</td><td>{row.streak} days</td><td className="score-cell">{row.points} pts</td><td className="muted">—</td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {(currentPage - 1) * LEADERBOARD_PAGE_SIZE + 1}–{Math.min(currentPage * LEADERBOARD_PAGE_SIZE, filteredRows.length)} of {filteredRows.length} challengers</span><div className="pagination-controls"><button className="secondary-button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">← Previous</button><span aria-live="polite">Page {currentPage} of {totalPages}</span><button className="secondary-button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page">Next →</button></div></div></>}</section></>; }
function PodiumCard({ row, place }: { row: LeaderboardRow; place: "first" | "second" | "third" }) { const initials = row.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); const tier = row.rank === 1 ? "GOLD" : row.rank === 2 ? "SILVER" : "BRONZE"; return <article className={`podium podium-${place}`}><div className="podium-topline" /><div className="podium-rank">0{row.rank}</div><div className="podium-tier">{tier} TIER</div><div className="podium-person"><div className="avatar">{initials}</div><div><h3>{row.name}</h3><p>{row.academicYear} · {row.handle}</p></div></div><div className="podium-stats"><span><b>{row.solved}</b> SOLVED</span><span><b>{row.streak}D</b> STREAK</span><span><b>{row.points}</b> SCORE</span></div></article>; }
function Resources({ query, setQuery, filtered }: { query: string; setQuery: (value: string) => void; filtered: ReadonlyArray<typeof resources[number]> }) { return <section className="resources-page"><div className="resource-controls"><div><span className="resource-count">{filtered.length} resources</span><p>Each link opens in a new tab. Save the paths that fit your current weak spot.</p></div><label className="search-box resource-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search topics or source" aria-label="Search resources" /></label></div>{["DSA Roadmaps & Problem Sheets", "YouTube Learning Resources"].map((category) => { const items = filtered.filter((resource) => resource.category === category); return <section className="resource-section" key={category}><div className="resource-section-heading"><h2>{category}</h2><span>{items.length} listed</span></div>{items.length ? <div className="resource-grid">{items.map((resource) => <article className="resource-card" key={resource.title}><div className="resource-card-top"><span className={`resource-kind ${resource.href ? "" : "pending"}`}>{resource.kind}</span><span aria-hidden="true">{resource.href ? "↗" : "· · ·"}</span></div><h3>{resource.title}</h3><p>{resource.detail}</p>{resource.href ? <a href={resource.href} target="_blank" rel="noreferrer" className="resource-link">Open resource <span>↗</span></a> : <span className="resource-unavailable">Link pending verification</span>}</article>)}</div> : <div className="resource-empty"><strong>No resources match “{query}”.</strong><button className="text-button" onClick={() => setQuery("")}>Clear search</button></div>}</section>; })}</section>; }
type UptimeMonitor = {
  name: string;
  statusClass: string;
  dailyRatios?: { date: string; ratio: string; label: string }[];
  ratio?: { ratio: string };
  "30dRatio"?: { ratio: string };
};

type UptimeState = { kind: "loading" } | { kind: "ready"; monitor: UptimeMonitor | null } | { kind: "error" };

function StatusCard() {
  const [state, setState] = useState<UptimeState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ kind: "error" });
    }, 8_000);
    fetch(statusApiUrl, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status_${response.status}`);
        return await response.json() as { data?: UptimeMonitor[] };
      })
      .then((body) => setState({ kind: "ready", monitor: body.data?.[0] ?? null }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const monitor = state.kind === "ready" ? state.monitor : null;
  const ratio = Number(monitor?.["30dRatio"]?.ratio ?? monitor?.ratio?.ratio);
  const uptime = Number.isFinite(ratio) ? `${ratio.toFixed(ratio >= 99.95 ? 0 : 2)}%` : "—";
  const online = monitor?.statusClass === "success";
  const label = state.kind === "loading" ? "Checking…" : state.kind === "error" ? "Status unavailable" : !monitor ? "Status page" : online ? "Operational" : monitor.statusClass === "paused" ? "Paused" : "Degraded";
  const dotClass = online ? "status-dot" : state.kind === "error" || state.kind === "loading" ? "muted-dot" : "status-dot status-dot-warning";
  const recentDays = monitor?.dailyRatios?.slice(-30) ?? [];

  return <article className="panel health-card status-card">
    <div className="panel-heading">
      <div><div className="eyebrow">LIVE INFRASTRUCTURE</div><h2>{label}</h2></div>
      <span className="health-badge"><span className={dotClass} /> UPTIMEROBOT</span>
    </div>
    {state.kind === "error" ? <p className="empty-copy status-card-copy">Live status is temporarily unavailable. <a href={statusPageUrl} target="_blank" rel="noreferrer">Open the status page ↗</a></p> : <>
      <div className="uptime-readout"><b>{uptime}</b><span>30-day uptime</span></div>
      <div className="uptime-strip" role="img" aria-label="Daily uptime for the last 30 days">
        {recentDays.length ? recentDays.map((day) => {
          const value = Number(day.ratio);
          const className = day.label === "black" ? "unknown" : value >= 99.5 ? "up" : value > 0 ? "partial" : "down";
          return <span key={day.date} className={className} title={`${day.date}: ${Number.isFinite(value) ? value.toFixed(2) : "—"}%`} />;
        }) : <span className="unknown status-empty" />}
      </div>
      {recentDays.some((day) => day.label === "black") && <p className="uptime-note">Grey = before this monitor started</p>}
      <div className="health-row"><span>Monitor</span><strong>API · 5 min checks</strong></div>
      <div className="health-row"><span>Current state</span><strong>{label}</strong></div>
      <div className="health-row"><span>Source</span><strong>UptimeRobot</strong></div>
      <a className="status-page-link" href={statusPageUrl} target="_blank" rel="noreferrer">Open full status page ↗</a>
    </>}
  </article>;
}

function Support() { return <section className="support-layout"><div className="support-main"><article className="panel support-card"><div className="panel-heading"><div><div className="eyebrow">01 // VERIFICATION SUPPORT</div><h2>Check a submission</h2></div><span className="mini-tag">LIVE RELAY</span></div><p>Need help with a challenge account or verification status? Send the challenge day, your LeetCode username, and the approximate submission time.</p>{supportEmails.length ? <div className="support-contact-grid">{supportEmails.map((email) => <a className="contact-person support-email" href={`mailto:${email}?subject=30DAYS%20verification%20support`} key={email}><div className="avatar">@</div><div><strong>{email}</strong><small>Open Gmail to send a query</small></div><span className="status-dot" /></a>)}</div> : <div className="resource-empty"><strong>Support contacts are not configured yet.</strong><span className="empty-copy">Set NEXT_PUBLIC_SUPPORT_EMAIL_ONE and NEXT_PUBLIC_SUPPORT_EMAIL_TWO.</span></div>}</article><article className="panel support-card"><div className="panel-heading"><div><div className="eyebrow">02 // COHORT SUPPORT DESK</div><h2>What to include in your query</h2></div><span className="mini-tag">EST. RESPONSE · 20M</span></div><div className="chip-row"><span className="chip selected">Submission not verified</span><span className="chip">Changed handle</span><span className="chip">Question clarification</span><span className="chip">Account error</span></div><p>Support can investigate your persisted attempt and verification evidence. Points are never changed from the browser.</p></article></div><aside className="support-side"><StatusCard /><article className="panel contact-card"><div className="eyebrow">SELECTED SUPPORT CONTACTS</div><h2>Live relay contacts</h2><p>Available to the cohort operations group during the active sprint window.</p>{supportEmails.length ? supportEmails.map((email) => <a className="contact-person support-email" href={`mailto:${email}?subject=30DAYS%20support%20query`} key={`side-${email}`}><div className="avatar small">@</div><div><strong>{email}</strong><small>Support relay</small></div><span className="status-dot" /></a>) : <p className="empty-copy">Configure the support addresses to show contacts.</p>}</article></aside></section>; }
function EmptyPanel({ title, copy }: { title: string; copy: string }) { return <article className="panel empty-state"><h2>{title}</h2><p className="empty-copy">{copy}</p></article>; }
function LoadingScreen({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 6_000);
    return () => window.clearTimeout(timer);
  }, []);
  return <main className="onboarding-shell"><section className="onboarding-card"><p className="onboarding-kicker">30DAYS</p><h1>{label}</h1>{slow && <p className="onboarding-copy">Still connecting. The challenge server may be waking up after being idle — this extra wait only happens once.</p>}</section></main>;
}
function LaunchWaitlist({ message, launchAt, onSignIn, error }: { message: string; launchAt: string | null; onSignIn: () => void; error?: string }) { return <main className="onboarding-shell coming-soon-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">SEASON 01 · REGISTRATIONS OPEN</p><h1>The first 30-day sprint starts soon.</h1><p className="onboarding-copy">{message || "A focused 30-day LeetCode sprint for RVCE students. Register with your college account to reserve your place before Day 1."}</p>{launchAt && <p className="onboarding-copy">Launch · {formatDate(launchAt)} IST</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="onboarding-actions"><button className="primary-button" onClick={onSignIn}>Register with Google <span>→</span></button></div><a className="whatsapp-link" href={whatsappGroupUrl} target="_blank" rel="noreferrer">Join the cohort WhatsApp group <span>↗</span></a><p className="onboarding-copy">RVCE students only · @rvce.edu.in account required.</p></div></section></main>; }
function ComingSoon({ name, handle, academicYear, email, message, launchAt, onEdit, onSignOut }: { name: string; handle: string; academicYear: string; email: string; message: string; launchAt: string | null; onEdit: () => void; onSignOut: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!launchAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [launchAt]);
  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const target = launchAt ? Date.parse(launchAt) : null;
  const remaining = target !== null && Number.isFinite(target) ? Math.max(0, target - now) : null;
  const countdown = remaining !== null && remaining > 0 ? [
    { label: "DAYS", value: Math.floor(remaining / 86_400_000) },
    { label: "HOURS", value: Math.floor((remaining % 86_400_000) / 3_600_000) },
    { label: "MINUTES", value: Math.floor((remaining % 3_600_000) / 60_000) },
    { label: "SECONDS", value: Math.floor((remaining % 60_000) / 1_000) },
  ] : null;
  const countdownLabel = countdown && remaining !== null && remaining > 0 ? `${countdown[0].value} days, ${countdown[1].value} hours and ${countdown[2].value} minutes until launch` : "Launch window is open";
  return (
    <main className="onboarding-shell coming-soon-shell">
      <div className="onboarding-grid" aria-hidden="true" />
      <section className="coming-soon-card" aria-labelledby="coming-soon-title">
        <header className="coming-soon-top">
          <div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div>
          <span className="coming-soon-status"><span className="pulse" /> WAITLIST CONFIRMED</span>
        </header>
        <div className="coming-soon-body">
          <p className="onboarding-kicker">YOU’RE ON THE LIST{firstName ? ` · ${firstName.toUpperCase()}` : ""}</p>
          <h1 id="coming-soon-title">The sprint starts soon.</h1>
          <p className="onboarding-copy">{message || "Your registration is locked in. The dashboard opens when Season 01 goes live."}</p>
          <div className="coming-soon-launch">
            <div className="coming-soon-launch-head"><span>LAUNCH SEQUENCE</span><span>{launchAt ? `${formatDate(launchAt)} IST` : "DATE TO BE ANNOUNCED"}</span></div>
            {countdown ? <div className="coming-soon-countdown" aria-label={countdownLabel}>{countdown.map((part) => <div key={part.label}><strong>{String(part.value).padStart(2, "0")}</strong><span>{part.label}</span></div>)}</div> : <div className="coming-soon-tba"><span className="pulse" /> {remaining === 0 ? "Launch window is open. Waiting for the cohort switch." : "Launch timing will be announced here"}</div>}
            <p className="coming-soon-launch-note">{remaining === 0 ? "The dashboard unlocks as soon as the cohort is switched live." : remaining === null ? "Check back for the launch date, or keep this tab open." : "This page unlocks the dashboard automatically when the cohort goes live."}</p>
          </div>
          <div className="coming-soon-summary">
            <div><span>REGISTERED AS</span><strong>{name.trim() || "RVCE student"}</strong><small>{email || "College Google account"}</small></div>
            <div><span>LEETCODE</span><strong>{handle ? <a href={`https://leetcode.com/u/${handle}/`} target="_blank" rel="noreferrer">{handle}</a> : "Not connected"}</strong><small>Accepted submissions verify automatically</small></div>
            <div><span>ACADEMIC YEAR</span><strong>{academicYear}</strong><small>Season 01 cohort</small></div>
          </div>
          <div className="coming-soon-steps">
            <div><b>01</b><div><strong>Registration locked</strong><p>Your profile and LeetCode handle are on the cohort list.</p></div></div>
            <div><b>02</b><div><strong>Dashboard unlocks</strong><p>One question drops each day at 12:00 AM IST once the sprint begins.</p></div></div>
            <div><b>03</b><div><strong>Solve, verify, score</strong><p>One accepted submission per challenge awards points exactly once.</p></div></div>
          </div>
          <div className="onboarding-actions coming-soon-actions">
            <button className="primary-button" onClick={onEdit}>Update details <span>→</span></button>
            <button className="secondary-button" onClick={onSignOut}>Log out</button>
          </div>
          <a className="whatsapp-link" href={whatsappGroupUrl} target="_blank" rel="noreferrer">Join the cohort WhatsApp group <span>↗</span></a>
          <p className="coming-soon-note">RVCE students only · @rvce.edu.in account required{supportEmails.length ? <> · <a href={`mailto:${supportEmails[0]}?subject=30DAYS%20waitlist%20support`}>Contact support</a></> : null}</p>
        </div>
      </section>
    </main>
  );
}
function WaitlistDetails({ name, setName, handle, setHandle, academicYear, setAcademicYear, saving, onSave, onCancel, error, notice = "" }: { name: string; setName: (value: string) => void; handle: string; setHandle: (value: string) => void; academicYear: string; setAcademicYear: (value: string) => void; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel?: () => void; error: string; notice?: string }) { return <main className="onboarding-shell"><div className="onboarding-grid" aria-hidden="true" /><section className="onboarding-card"><div className="onboarding-brand"><span className="onboarding-mark" aria-hidden="true"><AccelerateMark /></span><strong>ACCELERATE CLUB</strong><small>RV COLLEGE OF ENGINEERING</small></div><div className="onboarding-content"><p className="onboarding-kicker">{onCancel ? "YOUR REGISTRATION" : "JOIN THE SPRINT"}</p><h1>{onCancel ? "Keep your details current." : "Tell us where you are starting."}</h1><p className="onboarding-copy">These details connect your verified work to your challenge record.</p>{notice && <p className="onboarding-copy" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<form className="onboarding-form" onSubmit={onSave}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label><label>LeetCode username or profile URL<input value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. johndoe or https://leetcode.com/u/johndoe/" required /></label><label>Academic year<select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} required><option>Second Year</option><option>Third Year</option><option>Fourth Year</option></select></label><button className="primary-button onboarding-action" type="submit" disabled={saving || !name.trim() || !handle.trim()}>{saving ? "Saving…" : onCancel ? "Save changes" : "Join the sprint"} <span>→</span></button>{onCancel && <button className="secondary-button waitlist-cancel" type="button" onClick={onCancel}>Back to waitlist status</button>}</form><a className="whatsapp-link" href={whatsappGroupUrl} target="_blank" rel="noreferrer">Join the cohort WhatsApp group <span>↗</span></a></div></section></main>; }
