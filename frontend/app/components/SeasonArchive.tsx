"use client";

import { FormEvent, useState } from "react";
import type { Challenge, Progress } from "./dashboard-types";
import { formatDate } from "./format";

type SeasonArchiveProps = {
  api: string;
  token: string;
  challenges: Challenge[];
  progress: Progress | null;
  seasonLabel: string;
  seasonEndedAt: string | null;
  email: string;
  onOpenLeaderboard: () => void;
};

export function SeasonArchive({ api, token, challenges, progress, seasonLabel, seasonEndedAt, email, onOpenLeaderboard }: SeasonArchiveProps) {
  const [wantSeasonTwo, setWantSeasonTwo] = useState<"yes" | "maybe" | "no">("yes");
  const [rating, setRating] = useState<number | null>(5);
  const [liked, setLiked] = useState("");
  const [improvements, setImprovements] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const verified = progress?.statuses.filter((item) => item.status === "verified").length ?? 0;
  const solvedDays = new Set(
    (progress?.statuses ?? [])
      .filter((item) => item.status === "verified")
      .map((item) => challenges.find((challenge) => challenge.id === item.challenge_id)?.day)
      .filter((day): day is number => typeof day === "number"),
  );

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch(`${api}/api/season/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          wantSeasonTwo,
          rating,
          liked: liked.trim(),
          improvements: improvements.trim(),
          suggestions: suggestions.trim(),
        }),
      });
      if (!response.ok) throw new Error("feedback_failed");
      setStatus({ kind: "success", text: "Feedback recorded. Thank you — it directly shapes whether Season 02 happens." });
      setLiked("");
      setImprovements("");
      setSuggestions("");
    } catch {
      setStatus({ kind: "error", text: "We couldn’t save your feedback. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="archive-page">
    <article className="panel archive-hero">
      <div className="archive-hero-copy">
        <p className="onboarding-kicker">{seasonLabel.toUpperCase()} · ARCHIVE</p>
        <h2>The season is complete. The questions stay open.</h2>
        <p>Scoring is frozen and the leaderboard is final. Every problem below remains available as a practice archive, with a direct link to LeetCode. Solving one now does not add points.</p>
        <div className="archive-hero-actions">
          <button className="secondary-button" onClick={onOpenLeaderboard}>View final standings</button>
          <a className="primary-button" href="#season-feedback">Share feedback <span>→</span></a>
        </div>
        {seasonEndedAt && <p className="archive-ended-at">Final window closed {formatDate(seasonEndedAt)} IST</p>}
      </div>
      {progress && <div className="archive-scorecard">
        <div><small>FINAL POINTS</small><strong>{progress.profile.points}</strong></div>
        <div><small>VERIFIED DAYS</small><strong>{verified}<em> / 30</em></strong></div>
        <div><small>LONGEST STREAK</small><strong>{progress.profile.longest_streak ?? progress.profile.streak ?? 0}<em> days</em></strong></div>
      </div>}
    </article>

    <section className="archive-list-panel panel" id="season-questions">
      <div className="panel-heading">
        <div><div className="eyebrow">QUESTION ARCHIVE</div><h2>All {challenges.length} questions</h2></div>
        <span className="mini-tag">PRACTICE ONLY · NO POINTS</span>
      </div>
      <div className="archive-grid">
        {challenges.map((challenge) => <article className="archive-card" key={challenge.id}>
          <div className="archive-card-top">
            <span className="question-day">DAY {String(challenge.day).padStart(2, "0")}</span>
            <span className={`difficulty ${challenge.difficulty.toLowerCase()}`}>{challenge.difficulty.toUpperCase()}</span>
          </div>
          <h3>{challenge.title}</h3>
          <p>{challenge.topic}</p>
          <div className="archive-card-foot">
            <span className={solvedDays.has(challenge.day) ? "archive-solved" : "archive-unsolved"}>{solvedDays.has(challenge.day) ? "✓ Verified in Season 01" : "Practice available"}</span>
            <a href={`https://leetcode.com/problems/${challenge.slug}/`} target="_blank" rel="noreferrer">Solve on LeetCode ↗</a>
          </div>
        </article>)}
      </div>
      {challenges.length === 0 && <p className="empty-copy">The question archive will appear here once the challenge bank is loaded.</p>}
    </section>

    <article className="panel archive-feedback" id="season-feedback">
      <div className="panel-heading">
        <div><div className="eyebrow">SEASON 02 · YOUR INPUT</div><h2>What should we do next?</h2></div>
        <span className="mini-tag">2 MINUTES</span>
      </div>
      <p>This is a memorial page for Season 01 and a planning form for what comes next. Tell us what worked, what frustrated you, and whether you want another season.</p>
      <form className="archive-feedback-form" onSubmit={submitFeedback}>
        <div className="archive-feedback-row">
          <label>Would you like a Season 02?
            <select value={wantSeasonTwo} onChange={(event) => setWantSeasonTwo(event.target.value as "yes" | "maybe" | "no")}>
              <option value="yes">Yes — I’d join again</option>
              <option value="maybe">Maybe — depends on the format</option>
              <option value="no">No — not for me</option>
            </select>
          </label>
          <label>How was Season 01?
            <select value={rating ?? ""} onChange={(event) => setRating(event.target.value ? Number(event.target.value) : null)}>
              <option value="5">5 · Loved it</option>
              <option value="4">4 · Good</option>
              <option value="3">3 · Okay</option>
              <option value="2">2 · Needs work</option>
              <option value="1">1 · Not for me</option>
            </select>
          </label>
        </div>
        <label>What worked well?<textarea value={liked} onChange={(event) => setLiked(event.target.value)} maxLength={2_000} placeholder="Daily cadence, question quality, verification, leaderboard…" /></label>
        <label>What should we improve?<textarea value={improvements} onChange={(event) => setImprovements(event.target.value)} maxLength={4_000} placeholder="Deadlines, difficulty curve, communication, points, events…" /></label>
        <label>Ideas for Season 02<textarea value={suggestions} onChange={(event) => setSuggestions(event.target.value)} maxLength={4_000} placeholder="Format, teams, prizes, workshops, anything else…" /></label>
        {status && <p className={`form-${status.kind === "success" ? "notice" : "error"}`} role="status">{status.text}</p>}
        <div className="archive-feedback-foot">
          <span>Submitting as {email || "your signed-in account"}</span>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send feedback"}</button>
        </div>
      </form>
    </article>
  </section>;
}

export function SeasonEndModal({ seasonLabel, endedAt, onViewArchive, onDismiss }: { seasonLabel: string; endedAt: string | null; onViewArchive: () => void; onDismiss: () => void }) {
  return <div className="season-end-modal" role="dialog" aria-modal="true" aria-labelledby="season-end-title">
    <section className="season-end-panel">
      <button className="season-end-close" onClick={onDismiss} aria-label="Close season announcement">×</button>
      <p className="onboarding-kicker">{seasonLabel.toUpperCase()} · COMPLETE</p>
      <h2 id="season-end-title">That’s a wrap.</h2>
      <p>{seasonLabel} of the 30 Days LeetCode Challenge has ended. The leaderboard is final and points are frozen — but every question stays online as a practice archive.</p>
      {endedAt && <p className="season-end-date">Final window closed {formatDate(endedAt)} IST</p>}
      <div className="season-end-actions">
        <button className="primary-button" onClick={onViewArchive}>Browse all 30 questions <span>↓</span></button>
        <button className="secondary-button" onClick={onDismiss}>Close</button>
      </div>
      <p className="season-end-note">There’s a short feedback form in the archive to help shape a potential Season 02.</p>
    </section>
  </div>;
}
