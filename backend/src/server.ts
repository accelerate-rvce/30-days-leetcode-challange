import express from "express";
import cors from "cors";
import api from "./routes.js";
import { runPersistentVerificationCycle } from "./persistent-worker.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(express.json());
app.use(cors({ origin: allowedOrigins }));
app.use("/api", api);

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "30days-backend" });
});

function landingPage(servedAt: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#090b0d">
  <meta name="robots" content="noindex">
  <title>30DAYS · Verification API</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090b0d;
      --panel: #111418;
      --line: #252a30;
      --text: #f4f1ea;
      --muted: #8b929b;
      --accent: #d7ff3f;
      --violet: #8a6cff;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      padding: 32px;
      color: var(--text);
      background:
        radial-gradient(circle at 12% 8%, rgba(138, 108, 255, .18), transparent 34%),
        radial-gradient(circle at 88% 92%, rgba(215, 255, 63, .09), transparent 30%),
        var(--bg);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(760px, 100%);
      padding: clamp(28px, 6vw, 64px);
      border: 1px solid var(--line);
      border-radius: 28px;
      background: linear-gradient(145deg, rgba(255, 255, 255, .035), transparent 55%), var(--panel);
      box-shadow: 0 30px 100px rgba(0, 0, 0, .45);
    }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: clamp(56px, 9vw, 96px); }
    .brand { display: flex; align-items: baseline; gap: 10px; letter-spacing: -.07em; font-size: 30px; font-weight: 800; }
    .brand span { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .22em; }
    .status { display: inline-flex; align-items: center; gap: 9px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .16em; white-space: nowrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 5px rgba(215, 255, 63, .09); }
    .eyebrow { margin: 0 0 18px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .2em; }
    h1 { max-width: 620px; margin: 0; font-size: clamp(44px, 8vw, 76px); font-weight: 650; letter-spacing: -.065em; line-height: .93; }
    h1 em { color: var(--muted); font-style: normal; font-weight: 400; }
    .copy { max-width: 500px; margin: 26px 0 0; color: var(--muted); font-size: 16px; line-height: 1.6; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 38px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 19px; border: 1px solid var(--line); border-radius: 999px; color: var(--text); font-size: 13px; font-weight: 650; text-decoration: none; transition: border-color .2s, transform .2s, background .2s; }
    .button:hover { border-color: var(--muted); transform: translateY(-1px); }
    .button.primary { border-color: var(--accent); background: var(--accent); color: #111408; }
    .button.primary:hover { background: #e6ff7a; }
    footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; margin-top: 72px; padding-top: 18px; border-top: 1px solid var(--line); color: #5d646d; font-size: 11px; letter-spacing: .04em; }
    code { color: #aeb5be; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (max-width: 520px) {
      .top { align-items: flex-start; flex-direction: column; gap: 14px; margin-bottom: 64px; }
      footer { flex-direction: column; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .dot { animation: pulse 2.4s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .45; box-shadow: 0 0 0 8px rgba(215, 255, 63, .03); } }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div class="brand">30<span>DAYS</span></div>
      <div class="status"><span class="dot"></span> SERVICE ONLINE</div>
    </div>
    <p class="eyebrow">RVCE · LEETCODE VERIFICATION</p>
    <h1>The challenge<br><em>is live.</em></h1>
    <p class="copy">Verification, scoring, and cohort data are running. This is the backend that checks submissions, wakes the queue, and keeps the leaderboard honest.</p>
    <div class="actions">
      <a class="button primary" href="https://30days-accelerate.pages.dev/">Open the dashboard ↗</a>
      <a class="button" href="/health">Health check</a>
    </div>
    <footer>
      <span><code>GET /health</code> · <code>POST /api/cron/verify</code></span>
      <span>Response ${servedAt}</span>
    </footer>
  </main>
</body>
</html>`;
}

app.get("/", (_request, response) => {
  response.set("Cache-Control", "no-store").type("html").send(landingPage(new Date().toISOString()));
});

const verificationTimer = setInterval(() => {
  void runPersistentVerificationCycle().catch((error) => console.error("verification cycle failed", error));
}, 60_000);
verificationTimer.unref();

app.listen(port, host, () => {
  console.log(`30DAYS backend listening on http://${host}:${port}`);
});

