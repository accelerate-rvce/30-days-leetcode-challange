# 30 Days LeetCode Challenge

The repository is split into a Next.js frontend and an Express/TypeScript backend.

## Deploying to Render

The frontend is deployed on Vercel; Render hosts the backend API. The
[`render.yaml`](./render.yaml) blueprint defines:

- `leet-backend` — Express API web service (`rootDir: backend`)

To deploy: push this repo, then in the Render dashboard choose **New → Blueprint**
and point it at the repo. Render builds the service with `npm ci && npm run build`
and starts it with `npm run start`.

During setup, set the `sync: false` values:

- `FRONTEND_ORIGIN` — your Vercel URL (e.g. `https://leet.vercel.app`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

On the Vercel side, set `NEXT_PUBLIC_API_URL` to the backend's
`https://<name>.onrender.com` URL. The `leet-worker` background worker is included
as a commented block because Render requires a paid instance type for workers.

## Local development

```bash
npm install --prefix frontend/app
npm install --prefix backend
npm run dev                 # frontend on :3000
npm run dev:backend         # backend on :4000
npm run dev:worker          # scheduler and verification worker
```

The backend exposes `GET /health`, `GET /api/bootstrap`, `GET /api/challenges/current`, `POST /api/events/open`, `GET /api/progress`, and `GET /api/leaderboard`.

Opening a challenge records one idempotent attempt in Supabase; it does not call LeetCode. After each challenge deadline, the verifier discovers pending completions, claims jobs with database row locks, groups them by user, and fetches each user’s recent accepted submissions once. Verification retries are persisted, and point awards are transactionally guarded so a repeated submission or retry cannot award duplicate points.

LeetCode checks are deliberately batched and paced. Up to eight users share one aliased GraphQL query, requests start at least 1.5 seconds apart globally, and a daily request budget plus 429/403 cooldown prevent a large cohort from becoming a burst. A per-student cooldown keeps repeated “check submission” clicks from starting back-to-back verification cycles. Tune these with the `LEETCODE_*` and `VERIFICATION_KICK_COOLDOWN_MS` variables in `backend/.env.example`.

## Dashboard loading and live updates

The dashboard paints from a single `GET /api/bootstrap` request that returns the
launch gate, the current challenge, the challenge list, the student's progress,
the leaderboard, the next scheduled publish, and (for admins) the monitoring
panels. It replaces four separate calls, each of which paid for its own CORS
preflight, token validation, and database round trips.

- `userIdFromAccessToken` caches a validated token for 30 seconds, so a burst of
  requests shares one Supabase Auth call. Rejected tokens are cached for five
  seconds, not thirty.
- Settings, the challenge window, and the leaderboard are micro-cached in the
  backend for 5–30 seconds and invalidated by the admin writes that change them.
  The cache is per instance; with multiple replicas the worst case is one TTL of
  staleness.
- The browser keeps a 15-minute snapshot of the last dashboard payload in
  `localStorage`, paints it immediately, and revalidates in the background.
  Signing out clears it. A missing `/api/bootstrap` (rolling deploy) falls back
  to the per-resource endpoints.
- A new question appears without a reload: the tab subscribes to `challenges`
  over Realtime (migration `012_realtime_challenges.sql`), schedules a refresh at
  the next `published_at` and at the current deadline, and re-reads when the tab
  becomes visible or the connection returns. Nothing polls the challenge
  endpoints.
- The waitlist setting is re-read every five minutes while visible instead of
  every minute.

## Verification round trip

1. “Check Now” calls `POST /api/verification/request`, which makes sure the
   completion exists and is `pending`, resets a finished job’s retry budget
   (never one that is actively processing), queues the job, and returns `202`
   immediately. Nothing waits on LeetCode in the request path.
2. The worker claims up to `VERIFY_BATCH_SIZE` jobs, groups them by student, and
   fetches recent accepted submissions for up to eight students per aliased
   GraphQL request.
3. Each job is matched on problem slug, `Accepted` status, and a submission
   timestamp inside the challenge window.
4. `finalize_verified_completion` flips the completion to `verified`, awards
   points once, and the worker refreshes the profile’s streak. A terminal
   not-found verdict writes `not_verified` on the completion.
5. The browser holds one Supabase Realtime subscription per signed-in student,
   filtered to that profile’s own `completions` rows (RLS scopes the rest), so
   the score, streak, and status message update the moment the worker commits.
   The subscription re-reads `/api/progress` every time it reaches `SUBSCRIBED`,
   which gives the initial state on connect and full recovery after a drop. A
   single delayed read at 20s covers the case where the socket never comes up;
   there is no polling loop.

### Queue guarantees

`verification_jobs` has `unique(profile_id, challenge_id)`, so a student can
never have two live jobs for one challenge. `enqueue_verification_job`
(migration `011`) refuses to requeue a job while another worker holds a fresh
`processing` lock, `claim_verification_jobs` takes rows with
`for update skip locked`, and an explicit “Check Now” neither resets the retry
budget of an in-flight job nor creates a second one. Points are awarded inside
`finalize_verified_completion`, which is idempotent, so a duplicate delivery can
never double-score.

### Retry and error states

- Not found: retried with escalating backoff (15m, 30m, 1h, 2h) up to
  `LEETCODE_MAX_RETRIES`, then the completion becomes `not_verified`.
- Throttled (429/403/503), network failure, or an exhausted daily budget: the job
  goes back to `retry` without consuming the not-found budget, waking after the
  cooldown or at the next UTC day.
- Each `/api/progress` status now carries its queue row
  (`verification.status`, `attempts`, `nextAttemptAt`, `lastError`), so the UI
  can say “next automatic check in about 30 minutes” instead of guessing.

### Verification celebration

When a completion flips to `verified`, two sounds play in order and then the UI
takes over the screen with a centred Rive mascot. All of it is client-side only:

- `frontend/app/components/Kabi.tsx` drives `/kabi.riv` (state machine `Kabi`,
  inputs `pose`, `mood`, `lookX`, `lookY`, `jump`). The celebration sets
  `pose=7` (celebrate) and `mood=1` (happy), and Kabi's head/eyes follow the
  pointer (`lookX`/`lookY` accept -100..100). Drop the exported file at
  `frontend/app/public/kabi.riv`; until it exists the card renders a verified
  medallion instead of an empty canvas.
- `frontend/app/public/sounds/verified-celebration.wav` is the confirmation
  hit. It plays the moment the verdict lands, so it acts as the notification.
- `frontend/app/public/sounds/verified-party.mp3` is the mascot music. The
  overlay only appears once the hit has finished, then loops this track until
  the student closes it (click, ×, or Escape).
- Both files are decoded during the Check Now click (`unlockVerifiedSound`),
  because browsers will not start audio from a websocket callback alone. The
  hit falls back to a synthesized chime if the file cannot be fetched.

Realtime requires migration `010_enable_realtime.sql`, which adds `completions`
to the `supabase_realtime` publication. Row level security already limits each
signed-in student to their own completions, so Realtime delivers only their row.

Production setup requires applying every migration in `backend/database/migrations/` in numeric order, then configuring the Supabase service-role key and `CRON_SECRET` on Render. The GitHub Actions workflow at `.github/workflows/verification-cron.yml` calls `/api/cron/verify` every ten minutes; set repository secrets `RENDER_BACKEND_URL` and `CRON_SECRET` to wake the free Render web service and process verification batches.

## Production boundaries

The backend worker verifies only accepted submissions returned by LeetCode's available recent-submission feed and checks the timestamp against the challenge window. The public feed returns at most 20 recent accepted submissions per user, so a user with a very large burst of accepted submissions can fall outside that window; a missing feed entry is never treated as a verified failure. Throttling and network errors become delayed/retry states instead of consuming the not-found retry budget.

For production, configure Supabase using `backend/.env.example`, apply `backend/database/migrations/001_initial.sql`, replace the in-memory store with Supabase repositories, and run the API and worker as separate long-lived processes. The included in-memory store is intentionally safe for local UI development only.
