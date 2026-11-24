"use client";

import { useState } from "react";
import { SeasonArchive, SeasonEndModal } from "../../components/SeasonArchive";
import type { Challenge, Progress } from "../../components/dashboard-types";

// Demo-only preview of the archived Season 01 site. It renders the real
// SeasonArchive and SeasonEndModal components with mock data, so the archive
// can be reviewed without Supabase credentials. Not linked from the app.
const problems: { day: number; title: string; slug: string; difficulty: "Easy" | "Medium" | "Hard"; topic: string }[] = [
  { day: 30, title: "Trapping Rain Water", slug: "trapping-rain-water", difficulty: "Hard", topic: "Two Pointers" },
  { day: 29, title: "Serialize and Deserialize Binary Tree", slug: "serialize-and-deserialize-binary-tree", difficulty: "Hard", topic: "Trees" },
  { day: 28, title: "LRU Cache", slug: "lru-cache", difficulty: "Medium", topic: "Design" },
  { day: 27, title: "Word Break", slug: "word-break", difficulty: "Medium", topic: "Dynamic Programming" },
  { day: 26, title: "Implement Trie (Prefix Tree)", slug: "implement-trie-prefix-tree", difficulty: "Medium", topic: "Trie" },
  { day: 25, title: "Lowest Common Ancestor of a BST", slug: "lowest-common-ancestor-of-a-binary-search-tree", difficulty: "Medium", topic: "Trees" },
  { day: 24, title: "Kth Smallest Element in a BST", slug: "kth-smallest-element-in-a-bst", difficulty: "Medium", topic: "Trees" },
  { day: 23, title: "Rotting Oranges", slug: "rotting-oranges", difficulty: "Medium", topic: "Graphs" },
  { day: 22, title: "Course Schedule", slug: "course-schedule", difficulty: "Medium", topic: "Graphs" },
  { day: 21, title: "Number of Islands", slug: "number-of-islands", difficulty: "Medium", topic: "Graphs" },
  { day: 20, title: "Insert Interval", slug: "insert-interval", difficulty: "Medium", topic: "Intervals" },
  { day: 19, title: "Merge Intervals", slug: "merge-intervals", difficulty: "Medium", topic: "Intervals" },
  { day: 18, title: "Top K Frequent Elements", slug: "top-k-frequent-elements", difficulty: "Medium", topic: "Heap" },
  { day: 17, title: "Group Anagrams", slug: "group-anagrams", difficulty: "Medium", topic: "Hash Map" },
  { day: 16, title: "Container With Most Water", slug: "container-with-most-water", difficulty: "Medium", topic: "Two Pointers" },
  { day: 15, title: "3Sum", slug: "3sum", difficulty: "Medium", topic: "Two Pointers" },
  { day: 14, title: "Longest Substring Without Repeating Characters", slug: "longest-substring-without-repeating-characters", difficulty: "Medium", topic: "Sliding Window" },
  { day: 13, title: "Product of Array Except Self", slug: "product-of-array-except-self", difficulty: "Medium", topic: "Arrays" },
  { day: 12, title: "Coin Change", slug: "coin-change", difficulty: "Medium", topic: "Dynamic Programming" },
  { day: 11, title: "Climbing Stairs", slug: "climbing-stairs", difficulty: "Easy", topic: "Dynamic Programming" },
  { day: 10, title: "Maximum Subarray", slug: "maximum-subarray", difficulty: "Medium", topic: "Dynamic Programming" },
  { day: 9, title: "Flood Fill", slug: "flood-fill", difficulty: "Easy", topic: "Graphs" },
  { day: 8, title: "Binary Search", slug: "binary-search", difficulty: "Easy", topic: "Binary Search" },
  { day: 7, title: "Valid Anagram", slug: "valid-anagram", difficulty: "Easy", topic: "Strings" },
  { day: 6, title: "Invert Binary Tree", slug: "invert-binary-tree", difficulty: "Easy", topic: "Trees" },
  { day: 5, title: "Valid Palindrome", slug: "valid-palindrome", difficulty: "Easy", topic: "Two Pointers" },
  { day: 4, title: "Best Time to Buy and Sell Stock", slug: "best-time-to-buy-and-sell-stock", difficulty: "Easy", topic: "Arrays" },
  { day: 3, title: "Merge Two Sorted Lists", slug: "merge-two-sorted-lists", difficulty: "Easy", topic: "Linked List" },
  { day: 2, title: "Valid Parentheses", slug: "valid-parentheses", difficulty: "Easy", topic: "Stack" },
  { day: 1, title: "Two Sum", slug: "two-sum", difficulty: "Easy", topic: "Arrays" },
];

const seasonEnd = "2026-11-24T00:00:00+05:30";
const seasonStart = new Date(Date.parse(seasonEnd) - 30 * 24 * 60 * 60 * 1000).toISOString();

const challenges: Challenge[] = problems.map((problem) => ({
  id: `demo-${problem.day}`,
  day: problem.day,
  title: problem.title,
  slug: problem.slug,
  difficulty: problem.difficulty,
  topic: problem.topic,
  points: 100,
  publishedAt: seasonStart,
  deadlineAt: seasonEnd,
}));

// 23 of 30 days verified, four of those late (70 points).
const missedDays = new Set([7, 14, 19, 22, 25, 28, 30]);
const lateDays = new Set([11, 16, 21, 27]);
const statuses = challenges
  .filter((challenge) => !missedDays.has(challenge.day))
  .map((challenge) => ({
    challenge_id: challenge.id,
    status: "verified",
    awarded_points: lateDays.has(challenge.day) ? 70 : 100,
  }));

const progress: Progress = {
  profile: { id: "demo-student", name: "Aarav Sharma", points: 2160, streak: 4, longest_streak: 12, leetcode_username: "aarav_rvce", academic_year: "Third Year", role: "student" },
  verifiedCompletions: statuses.length,
  completionPercentage: Math.round((statuses.length / 30) * 100),
  statuses,
};

export default function DemoPage() {
  const [showModal, setShowModal] = useState(true);
  // Admins keep the Challenge and Admin tabs after the archive opens; everyone
  // else sees the archive in place of the daily challenge.
  const [asAdmin, setAsAdmin] = useState(false);
  const nav = ["Home", "Archive", ...(asAdmin ? ["Challenge"] : []), "My progress", "Leaderboard", "Resources", "Support", ...(asAdmin ? ["Admin"] : [])];

  return <div className="app-shell">
    <div style={{ alignItems: "center", background: "#0b0d14", borderBottom: "1px solid #22d3ee33", color: "#94a3b8", display: "flex", flexWrap: "wrap", fontSize: 12, gap: 12, justifyContent: "space-between", letterSpacing: ".04em", padding: "10px 18px" }}>
      <span><b style={{ color: "#22d3ee" }}>DEMO PREVIEW</b> · Season 01 archive with mock data</span>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="secondary-button" style={{ marginTop: 0 }} onClick={() => setAsAdmin((value) => !value)}>{asAdmin ? "View as student" : "View as admin"}</button>
        <button type="button" className="secondary-button" style={{ marginTop: 0 }} onClick={() => setShowModal(true)}>Replay season-end popup</button>
      </div>
    </div>
    <header className="topbar">
      <div className="brand"><div><strong>30DAYS</strong><small>BY ACCELERATE · RVCE</small></div></div>
      <div className="live-pill"><span className="pulse" /> DAY 30 <span className="divider" /> ARCHIVED</div>
      <nav className="nav-tabs" aria-label="Primary navigation">
        {nav.map((item) => <button key={item} className={item === "Archive" ? "active" : ""} type="button">{item}</button>)}
      </nav>
      <div className="top-actions">
        <button type="button" className="user-avatar" aria-label="Open your profile">AS</button>
        <button type="button" className="profile-button">Profile</button>
        <button className="logout-button" type="button">Log out</button>
      </div>
    </header>
    <main className="page-wrap">
      <section className="hero-row">
        <div>
          <div className="eyebrow"><span className="accent-dot" /> SEASON ARCHIVE <span className="muted">· SEASON 01</span></div>
          <h1>SEASON 01 · ARCHIVE</h1>
          <p>Final standings. Every verified solve is locked in.</p>
        </div>
      </section>
      <SeasonArchive
        api="http://localhost:4000"
        token=""
        challenges={challenges}
        progress={progress}
        seasonLabel="Season 01"
        seasonEndedAt={seasonEnd}
        email="aarav@rvce.edu.in"
        onOpenLeaderboard={() => {}}
      />
    </main>
    <footer><span>ACCELERATE // THE COMPUTER SCIENCE CLUB OF RVCE · MYSURU ROAD, BENGALURU 560059</span><span>INNOVATE · CONNECT · INSPIRE</span></footer>
    {showModal && <SeasonEndModal
      seasonLabel="Season 01"
      endedAt={seasonEnd}
      onViewArchive={() => {
        setShowModal(false);
        window.setTimeout(() => {
          document.getElementById("season-questions")?.scrollIntoView({ block: "start" });
        }, 50);
      }}
      onDismiss={() => setShowModal(false)}
    />}
  </div>;
}
