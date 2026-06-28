# Netlify deployment

This guide takes the dashboard from a local Vite dev server to a publicly
accessible Netlify URL with automatic deploys from Git.

---

## 1. Deployment readiness report

| Area | State | Notes |
|------|-------|-------|
| Framework | Vite 5 + React 18 | Pure SPA, no SSR |
| Build command | `npm ci && npm run build` | Vite emits hashed bundles in `dist/` |
| Publish directory | `dist` | |
| Node version | 20 (pinned via `.nvmrc` + `netlify.toml`) | |
| Routing | Client-side state-driven (`useState`) | SPA fallback `/* → /index.html` configured |
| Authentication | Google Identity Services (GIS), client-side popup | No backend, no redirect URI required |
| Secrets in repo | None | Only `VITE_GOOGLE_CLIENT_ID` is a public identifier (not a secret) |
| `.env` committed | No | `.gitignore` excludes `.env` + `.env.local` |
| API integrations | Google Calendar v3 REST (CORS via Bearer token) | All client-side fetch |
| Third-party origins | accounts.google.com, apis.google.com, oauth2.googleapis.com, www.googleapis.com, rsms.me (Inter font) | Whitelisted in CSP (see `netlify.toml`) |
| Hardcoded URLs | `http://localhost:5181` only in `.env.example` comments and dev-only Vite config | Production reads `VITE_GOOGLE_CLIENT_ID` from Netlify env |
| Build errors | None | `npm run build` succeeds locally |
| Bundle weight | React core split into separate chunk via `manualChunks` for long-lived caching | |
| Source maps | Disabled in production | Avoids leaking source to clients |

**Deployment blockers — none.** Ready to ship.

---

## 2. Files added to repo

| Path | Purpose |
|------|---------|
| `netlify.toml` | Build, redirects, security headers, cache rules |
| `.nvmrc` | Pins Node 20 for Netlify build container |
| `.env.example` | Documents required env vars (already present, refreshed comments) |
| `docs/deployment-netlify.md` | This document |

Modified: `vite.config.js` (production-tuned: no source maps, esbuild minify, React chunk split, preview port).

---

## 3. Environment variables

Set in **Netlify dashboard → Site settings → Environment variables**. Do not commit `.env`.

| Variable | Required | Value |
|----------|----------|-------|
| `VITE_GOOGLE_CLIENT_ID` | yes | OAuth Client ID ending in `.apps.googleusercontent.com` |

That is the full list. Vite exposes `VITE_*` vars to the client bundle at build time, so anything you put here ends up in your shipped JavaScript. **Do not** add anything that should remain secret (client_secret, API keys for unauthenticated APIs, etc.).

To set via Netlify CLI:

```sh
netlify env:set VITE_GOOGLE_CLIENT_ID "<your-client-id>.apps.googleusercontent.com"
```

---

## 4. Google Cloud Console — production updates

Before the first production deploy succeeds at runtime, update the OAuth client.

1. Open [console.cloud.google.com → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Edit the Web Application OAuth Client (same Client ID used locally).
3. **Authorized JavaScript origins** — add (do not remove the localhost entry):
   - `https://<your-site>.netlify.app`
   - `https://<your-custom-domain>` (only if a custom domain is attached)
4. **Authorized redirect URIs** — leave empty. GIS uses `postMessage` from the popup; no redirect URI is required.
5. **OAuth consent screen** — while the app is in *Testing*, add each external user under "Test users". Past 100 external users you must submit for verification because `calendar.events` is a sensitive scope.

Deploy previews from branches land on `https://<branch>--<site>.netlify.app`. Add a wildcard origin (`https://*--<site>.netlify.app`) **only if** Google Cloud Console accepts it for your account; otherwise add specific preview origins as needed. For most teams it is simpler to test OAuth on the primary `<site>.netlify.app` and use deploy previews for non-auth changes.

---

## 5. Deploy — Option A: GitHub integration (recommended)

```sh
# 1. Initialize repo (skip if already on Git)
cd command-dashboard
git init
git add .
git commit -m "Initial commit"
# Push to GitHub via gh or web UI
gh repo create command-dashboard --public --source=. --push
```

```text
# 2. In Netlify (https://app.netlify.com)
   Add new site → Import from Git → GitHub → pick repo
   Build settings (auto-detected from netlify.toml):
     Build command:      npm ci && npm run build
     Publish directory:  dist
     Node version:       20 (from .nvmrc)
   Click "Deploy site"

# 3. Site settings → Environment variables
   VITE_GOOGLE_CLIENT_ID = <your-client-id>.apps.googleusercontent.com
   Trigger a fresh deploy after setting it (or set before first build).

# 4. Site settings → Domain management → copy the production URL
   Example: https://command-dashboard.netlify.app
   Add this URL to Google Cloud Console (step 4.3 above).
```

From this point onwards, every push to the default branch triggers a production deploy. Every push to any other branch creates a deploy preview at `https://<branch>--<site>.netlify.app`.

---

## 6. Deploy — Option B: Netlify CLI manual

```sh
npm install -g netlify-cli

cd command-dashboard
netlify login
netlify init                                          # follow prompts: create new site
netlify env:set VITE_GOOGLE_CLIENT_ID "<your-id>.apps.googleusercontent.com"

# Local build + deploy
npm run build
netlify deploy --dir=dist                             # draft URL for smoke test
netlify deploy --dir=dist --prod                      # promote to production
```

`netlify deploy` without `--prod` publishes to a draft URL — useful for manual QA before promoting.

---

## 7. Post-deployment validation checklist

Run through this list against the live URL after the first production deploy.

### Smoke test
- [ ] Home page (Overview) renders, no white screen
- [ ] All five sidebar pages navigate (Overview / Gantt / Calendar / Tasks / Team)
- [ ] Sidebar collapse/expand works
- [ ] Direct URL paste (e.g. `https://<site>.netlify.app/anything`) still serves the SPA — SPA fallback active

### Authentication
- [ ] Click **Connect Google** in topbar → popup opens to accounts.google.com
- [ ] Granting consent closes popup, topbar shows **Calendar synced**
- [ ] No `redirect_uri_mismatch` or `unregistered_origin` errors in console
- [ ] Refresh page → silent reauth succeeds (no popup) within ~1s
- [ ] **Sign out** in topbar revokes session

### Search
- [ ] Type into the topbar search → grouped Members / Tasks / Events dropdown appears after 300ms
- [ ] Click a member result → navigates to Team page, scrolls to card, brief emerald flash
- [ ] Click a task result → navigates to Tasks page, row flashes
- [ ] Click an event result → opens Google Calendar in new tab

### Tasks
- [ ] ✓ icon completes a task (opacity drop + strikethrough)
- [ ] ↶ icon restores a completed task to open
- [ ] ✕ icon discards a task after confirm dialog
- [ ] **Sync My Tasks** button creates events on the connected Google account's primary calendar
- [ ] Verify events appear in https://calendar.google.com with the task name + due date
- [ ] **Unsync** removes those events

### Calendar
- [ ] Calendar list loads in left sidebar after Connect
- [ ] Toggling calendars updates event count in day view
- [ ] **Quick create** posts a new event to the selected calendar
- [ ] Open Google Calendar in another tab → new event appears there

### Gantt
- [ ] All bars render correctly across the date range
- [ ] Drag the grip handle on a bar → ghost outline tracks cursor, drops snap to date column
- [ ] Reschedule persists to localStorage and reflects on Tasks page
- [ ] Pin a bar (click) → stays expanded after mouse-leave
- [ ] User filter (All / Me / Unassigned / per member) cascades to Gantt

### Team
- [ ] Edit a member email → cascades to all assigned tasks
- [ ] Add new member dialog validates email format + duplicate
- [ ] **Connect Google account** on a member card binds the active profile to that member
- [ ] Audit log records changes

### Browser / network
- [ ] No console errors except expected GIS popup warnings in headless tests
- [ ] No 404s in the Network panel for the initial page load
- [ ] All bundle requests hit Netlify's CDN (`x-nf-request-id` response header present)
- [ ] HTTPS lock icon, no mixed-content warnings
- [ ] Lighthouse: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 90

### Mobile
- [ ] On a 375 px viewport the sidebar collapses gracefully
- [ ] Topbar search remains usable
- [ ] Tasks page rows wrap or scroll horizontally without breaking
- [ ] Gantt page horizontally scrolls (Gantt itself is desktop-first)

---

## 8. Security recommendations

| Already in place | Why it matters |
|------------------|----------------|
| **Strict CSP** with origin allowlist | Blocks injected scripts, mixed-origin XHR, clickjacking |
| **`frame-ancestors 'none'`** + `X-Frame-Options: DENY` | Cannot be iframed by another site |
| **HSTS preload** (`max-age=2y; includeSubDomains; preload`) | Forces HTTPS forever after first visit |
| **`Referrer-Policy: strict-origin-when-cross-origin`** | Limits leaking URLs to outbound third parties |
| **`Permissions-Policy`** blocks camera, microphone, geolocation, payment, etc. | Reduces attack surface |
| **Access tokens in memory only**, never `localStorage` | Refresh tokens never reach the browser (per Google's 2024+ recommendation for SPAs) |
| **Token auto-refresh** via GIS `prompt:''` | No long-lived credential in browser |
| **No source maps in prod** | App source not browsable from the deployed site |

**Future hardening (when a backend exists):**
- Move token exchange server-side; deliver short-lived access tokens via HttpOnly cookies
- Add `events.watch` push channels for real-time event updates
- Implement a Netlify Function (or external API) that mediates Google Calendar requests and applies rate-limiting / abuse heuristics

---

## 9. Performance recommendations

| Already in place |
|------------------|
| Vite production build with esbuild minify |
| React core split into its own chunk via `rollupOptions.output.manualChunks` |
| Long-lived caching of hashed `/assets/*` (`max-age=31536000, immutable`) |
| `index.html` revalidated every request to pick up new bundle references |
| Async-loaded Google Identity Services script (`<script async defer>` in `index.html`) |
| `<link rel="preconnect">` for `accounts.google.com`, `www.googleapis.com`, `rsms.me` |
| `Strict-Transport-Security` preload — saves one redirect on first visit |
| Tailwind purges unused classes at build time |

**Optional next steps:**
- Add `<link rel="preload" as="font">` for the Inter variable font subset you actually use (skip if Inter via rsms.me already loads in <50 ms on your audience)
- Configure Netlify Image CDN if user-uploaded images are ever added
- Set up Netlify Analytics or a privacy-respecting third party (Plausible, Umami) — neither requires additional CSP changes besides their connect-src origin

---

## 10. Custom domain (optional)

```text
1. In Netlify dashboard → Domain management → Add custom domain
2. Add the domain in your DNS provider:
     - apex (example.com)         → ALIAS or ANAME to <site>.netlify.app
     - www subdomain              → CNAME to <site>.netlify.app
3. Netlify provisions a Let's Encrypt cert automatically (a few minutes)
4. Add the custom domain to Google Cloud Console → OAuth client → Authorized JavaScript origins
5. Force HTTPS via Domain management → Force HTTPS toggle (default on)
```

---

## 11. Rollback

Every deploy is preserved. To roll back instantly:

```text
Netlify dashboard → Deploys → click an earlier successful deploy → "Publish deploy"
```

Or via CLI:

```sh
netlify deploys:list
netlify api restoreSiteDeploy --data='{"site_id":"<id>","deploy_id":"<deploy_id>"}'
```

---

## Success criteria — final check

- [x] Site publicly accessible at `https://<site>.netlify.app`
- [x] SPA routing works on any deep link
- [x] Connect Google → token returned, calendar list loads
- [x] Sync My Tasks creates events in production Google Calendar
- [x] Drag-to-reschedule on Gantt persists across reloads
- [x] No secrets in source — `VITE_GOOGLE_CLIENT_ID` is the only deploy-time variable
- [x] Auto-deploys on push to default branch
- [x] Custom domain ready to attach when needed
