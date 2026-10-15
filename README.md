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

The backend exposes `GET /health`, `GET /api/challenges/current`, `POST /api/events/open`, `GET /api/progress`, and `GET /api/leaderboard`.

Opening a challenge records one idempotent attempt in Supabase; it does not call LeetCode. After each challenge deadline, the verifier discovers pending completions, claims jobs with database row locks, groups them by user, and fetches each user’s recent accepted submissions once. Verification retries are persisted, and point awards are transactionally guarded so a repeated submission or retry cannot award duplicate points.

Production setup requires applying `backend/database/migrations/001_initial.sql` and `002_verification_pipeline.sql`, then configuring the Supabase service-role key and `CRON_SECRET` on Render. The GitHub Actions workflow at `.github/workflows/verification-cron.yml` calls `/api/cron/verify` every ten minutes; set repository secrets `RENDER_BACKEND_URL` and `CRON_SECRET` to wake the free Render web service and process verification batches.

## Production boundaries

The backend worker verifies only accepted submissions returned by LeetCode's available recent-submission feed and checks the timestamp against the challenge window. A missing feed entry is never treated as a verified failure; throttling and network errors become delayed/retry states.

For production, configure Supabase using `backend/.env.example`, apply `backend/database/migrations/001_initial.sql`, replace the in-memory store with Supabase repositories, and run the API and worker as separate long-lived processes. The included in-memory store is intentionally safe for local UI development only.
