# 30 Days LeetCode Challenge

The repository is split into a Next.js frontend and an Express/TypeScript backend.

## Deploying to Render

The frontend can be deployed on Vercel or GitHub Pages; Render hosts the backend
API. The [`render.yaml`](./render.yaml) blueprint defines:

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

## Deploying the frontend to GitHub Pages

GitHub Pages can host the frontend as static files. The backend and verification
worker still run on Render; Pages only hosts the UI.

The workflow at `.github/workflows/deploy-pages.yml` builds the Next.js app with
`STATIC_EXPORT=true`, sets the Pages base path (`/<repo>` for project sites), and
publishes `frontend/app/out` with the official Pages actions. The app has real
routes for `/challenge`, `/progress`, `/resources`, `/leaderboard`, `/support`,
and `/admin`, so deep links work without a server-side rewrite.

1. Push the workflow, then open **Settings → Pages** and set **Source** to
   **GitHub Actions**. The workflow also asks Pages to enable itself, but an
   organization policy may require this manual step.
2. In **Settings → Secrets and variables → Actions**, add these repository
   **variables**:
   - `NEXT_PUBLIC_API_URL` — the Render API URL, e.g. `https://leet-backend.onrender.com`
   - `NEXT_PUBLIC_SITE_URL` — the Pages URL, e.g. `https://accelerate-rvce.github.io/30-days-leetcode-challange/`
   - `NEXT_PUBLIC_SUPABASE_URL` — `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPPORT_EMAIL_ONE`, `NEXT_PUBLIC_SUPPORT_EMAIL_TWO`
3. Add the Supabase **anon** key as a repository **secret** named
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never use the service-role key in a frontend
   build; it would be published in the browser bundle.
4. Add the Pages origin to Render's `FRONTEND_ORIGIN`, e.g.
   `https://accelerate-rvce.github.io`. CORS uses the origin only, not the
   `/<repo>` path. Keep any Vercel or localhost origins as comma-separated values.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to the
   Pages URL and add the redirect URL
   `https://accelerate-rvce.github.io/30-days-leetcode-challange/**`. Keep
   `http://localhost:3000/**` for local development. For Google sign-in, the
   authorized JavaScript origin is `https://accelerate-rvce.github.io`; the
   OAuth redirect URI remains the Supabase callback URL.
6. Push to `main` (or run the workflow manually from **Actions → Deploy frontend
   to GitHub Pages**). The deployment URL appears on the workflow run and in
   **Settings → Pages**.

`NEXT_PUBLIC_*` values are compiled into the static bundle. Changing a variable
or secret requires a new workflow run. The workflow currently also listens to the
`feat/github-pages-deploy` branch for the first test deployment; remove that
branch entry after merging.

If you use a custom domain, configure it in **Settings → Pages**. The Pages action
then reports an empty base path, so keep `NEXT_PUBLIC_BASE_PATH` unset and update
the Supabase redirect URL and Render CORS origin to the custom domain. Project
sites are served from `https://<owner>.github.io/<repo>/`; the workflow derives
that base path automatically.

GitHub Pages is static-only: it does not provide waitlist/admin APIs, Supabase
service credentials, or the verification cron. Those remain on Render and in
Supabase. A private repository needs a GitHub plan that supports Pages for
private repositories, and Pages sites are public unless the organization has
appropriate access controls.

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

LeetCode checks are deliberately batched and paced. Up to eight users share one aliased GraphQL query, requests start at least 1.5 seconds apart globally, and a daily request budget plus 429/403 cooldown prevent a large cohort from becoming a burst. A per-student cooldown keeps repeated “check submission” clicks from starting back-to-back verification cycles. Tune these with the `LEETCODE_*` and `VERIFICATION_KICK_COOLDOWN_MS` variables in `backend/.env.example`.

Production setup requires applying every migration in `backend/database/migrations/` in numeric order, then configuring the Supabase service-role key and `CRON_SECRET` on Render. The GitHub Actions workflow at `.github/workflows/verification-cron.yml` calls `/api/cron/verify` every ten minutes; set repository secrets `RENDER_BACKEND_URL` and `CRON_SECRET` to wake the free Render web service and process verification batches.

## Production boundaries

The backend worker verifies only accepted submissions returned by LeetCode's available recent-submission feed and checks the timestamp against the challenge window. The public feed returns at most 20 recent accepted submissions per user, so a user with a very large burst of accepted submissions can fall outside that window; a missing feed entry is never treated as a verified failure. Throttling and network errors become delayed/retry states instead of consuming the not-found retry budget.

For production, configure Supabase using `backend/.env.example`, apply `backend/database/migrations/001_initial.sql`, replace the in-memory store with Supabase repositories, and run the API and worker as separate long-lived processes. The included in-memory store is intentionally safe for local UI development only.
