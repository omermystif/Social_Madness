# Command Dashboard

Premium SaaS-grade operations dashboard for Box Madness social media campaigns (World Cup 2026). Multi-view calendar, Gantt timeline, task management, team coordination, Google Calendar sync, and cross-device cloud persistence.

**Live:** https://command-dashboard-gold.vercel.app

---

## Features

- **Gantt timeline** — drag/resize tasks across a 6-week social calendar, color-coded by category
- **Calendar** — month / week / day / agenda views (FullCalendar) with drag-and-drop rescheduling
- **Activity heatmap** — 12-week GitHub-style density visualization of events and tasks
- **Task management** — assignees, priorities, status, audit log, idempotent completion
- **Team** — per-member Google Calendar sync (`personalSync[email]` map), presence indicators
- **Google Calendar integration** — OAuth via Google Identity Services (GIS), per-user push/pull, incremental syncToken
- **Cross-device cloud sync** — Vercel KV (Upstash Redis) persists state across browsers/devices
- **Theme system** — dark (Mystify purple `#4A3DBF`) + light (Claude teal `#14B8A6`) with no-flash bootstrap
- **Premium UI** — glassmorphism, neumorphism, gradients, Framer Motion micro-interactions

---

## Tech stack

| Layer       | Choice |
|-------------|--------|
| Frontend    | React 18, Vite 5, Tailwind 3 |
| UI primitives | Framer Motion, FullCalendar 6 |
| Auth        | Google Identity Services (token client, no refresh tokens in browser) |
| State       | localStorage + Vercel KV (Upstash REST) via 2s debounced PUT / 30s GET poll |
| Sync        | Google Calendar API v3 (batch + per-calendar incremental) |
| Deploy      | Vercel (Edge Functions for `/api/state`) |
| CI/CD       | GitHub Actions (lint + build) + Vercel native GitHub deploys |

---

## Local development

### Prerequisites
- Node.js ≥ 20
- A Google Cloud OAuth client ID with `https://localhost:5181` and your Vercel URL in **Authorized JavaScript Origins**

### Setup
```bash
git clone https://github.com/omermystif/Social_Madness.git
cd Social_Madness
npm install
cp .env.example .env
# Edit .env → set VITE_GOOGLE_CLIENT_ID
```

### Run
```bash
npm start            # dev server + auto-sync watcher in one terminal
npm start:local      # dev + watcher (commit only, no push)
npm run dev          # just the Vite dev server (port 5181)
npm run sync         # just the watcher
```

Open http://localhost:5181

---

## Auto-sync workflow

The watcher (`scripts/watcher.js`) monitors `src/`, `api/`, config files. On any change it waits 30 seconds (debounced), groups changes, builds a smart commit message, and pushes to the `develop` branch.

```
file save → watcher (30s debounce) → commit → push develop → CI lint+build
                                            ↘ merge to main → Vercel auto-deploy
```

### Commit message format
```
[auto-sync] <area>: <type> — <file or N files> (YYYY-MM-DD HH:mm)
```

Areas detected automatically: `calendar`, `gantt`, `team`, `task-management`, `calendar-sync`, `auth`, `lib`, `seed-data`, `api`, `ci`, `scripts`, `styles`, `build-config`, `deployment`, `dependencies`.

### Watcher options
| Env / flag         | Default   | Description |
|--------------------|-----------|-------------|
| `SYNC_DEBOUNCE_MS` | `30000`   | Wait time after last change before committing |
| `SYNC_BRANCH`      | `develop` | Target branch for pushes |
| `--dry-run`        | off       | Log only, no commits |
| `--no-push`        | off       | Commit locally, skip push |

### Toggle auto-sync
Stop the watcher (`Ctrl+C`) and use plain `npm run dev` for manual git workflow.

---

## Git hooks (Husky)

| Hook         | Action |
|--------------|--------|
| pre-commit   | `lint-staged` runs ESLint `--fix` on staged `src/**/*.{js,jsx}` |
| pre-push     | `npm run build` must pass (skipped for `[auto-sync]` commits to `develop`) |

---

## Deployment

Vercel auto-deploys on push to `main` via its native GitHub integration. To ship the latest auto-sync work:

```bash
git checkout main
git merge develop
git push origin main
```

Vercel picks it up within ~15 seconds. Production URL: https://command-dashboard-gold.vercel.app

### Environment variables (Vercel dashboard)

| Variable                  | Where to get |
|---------------------------|--------------|
| `VITE_GOOGLE_CLIENT_ID`   | Google Cloud Console → OAuth client |
| `VITE_ENABLE_CLOUD_SYNC`  | `true` to enable Vercel KV sync |
| `KV_REST_API_URL`         | Auto-injected by Vercel when KV integration added |
| `KV_REST_API_TOKEN`       | Auto-injected by Vercel when KV integration added |

---

## Architecture

```
src/
├── api/             Google Calendar API (calendarApi.js) + KV client
├── auth/            Google Identity Services wrapper (gis.js)
├── components/
│   ├── calendar/    MiniCalendar, ActivityHeatmap
│   ├── pages/       Overview, Gantt, Calendar, Tasks, Team
│   ├── ui/          DeployModal, MemberCard, ThemeToggle
│   ├── Sidebar.jsx
│   └── Topbar.jsx
├── context/         Auth, Task, Toast, Calendar React contexts
├── hooks/           useTasks, useServerTasks
├── lib/             cloudSync.js, theme.js, driveTaskSync.js
├── seed/            socialCalendarTasks.js (campaign data, SEED_VERSION gated)
└── index.css        Design tokens (CSS vars), component utilities

api/
└── state.js         Vercel Edge Function — GET/PUT to Upstash KV

scripts/
├── watcher.js       Chokidar file watcher → auto-commit/push
└── README.md
```

### State persistence layers
1. **localStorage** — instant local state (`dashboard_tasks`, `dashboard_team`, etc.)
2. **Vercel KV (Upstash Redis)** — version-tracked snapshot via `/api/state`, debounced PUT + polled GET
3. **Google Calendar** — per-member event sync via `personalSync[email]` map (idempotent — orphan delete → create → update phases)
4. **BroadcastChannel** — cross-tab realtime via `dashboard-sync` channel

### Theme system
Tokens live in `src/index.css` as CSS variables in `[data-theme="dark"]` / `[data-theme="light"]` blocks. RGB-channel form (`--accent-500-rgb: 74 61 191`) lets Tailwind compose alpha via `rgb(var(--accent-500-rgb) / <alpha-value>)`. No-flash bootstrap script in `index.html` applies the theme before React mounts.

---

## Scripts reference

| Command            | Action |
|--------------------|--------|
| `npm start`        | Dev server + auto-sync (concurrently) |
| `npm start:local`  | Dev + auto-sync without push |
| `npm run dev`      | Vite dev server only (port 5181) |
| `npm run build`    | Production build to `dist/` |
| `npm run preview`  | Preview production build |
| `npm run lint`     | ESLint over `src/**/*.{js,jsx}` |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm run sync`     | File watcher → commit/push to `develop` |
| `npm run sync:dry` | Watcher, log only |
| `npm run sync:local` | Watcher, commit locally (no push) |

---

## Security

- Access tokens live **in memory only** — no refresh tokens or access tokens in `localStorage`
- Silent token refresh scheduled 5 minutes before expiry via GIS token client
- CSP, HSTS, X-Frame-Options, CORP, Permissions-Policy set in `vercel.json`
- CI scans `src/` for accidentally committed API keys (`AIza…`, `ya29.…`)
- `.env`, `.env.local`, `.vercel/`, `server/taskmanager.db` excluded via `.gitignore`

---

## Troubleshooting

**Vercel build fails with `ERESOLVE`** — `.npmrc` pins `legacy-peer-deps=true`. If it persists, delete `package-lock.json` and `npm install` locally then commit the fresh lock.

**Auto-sync pushes nothing** — check the watcher terminal for `📝 Commit:` line. Files in `.gitignore` are skipped intentionally.

**Theme flashes on load** — the `<script>` block in `index.html` must run before React mounts. If you edit `index.html`, keep that block inline at the top of `<head>`.

**`/api/state` returns 503** — Vercel KV not provisioned. In Vercel dashboard → Storage → connect Upstash KV. `KV_REST_API_URL` and `KV_REST_API_TOKEN` should auto-inject.

**Google sign-in fails with `Error 400: origin_mismatch`** — add your dev/prod URL to **Authorized JavaScript Origins** in Google Cloud Console for the OAuth client.

---

## License

Private — Box Madness / Mystify internal tool.
