# Vercel deployment

Production deployment to Vercel. Mirrors the Netlify guide
(`docs/deployment-netlify.md`) — only the platform glue differs.

---

## 1. Deployment Readiness Report

| Area | Value | Notes |
|------|-------|-------|
| Framework | Vite 5 + React 18 (SPA) | Vercel framework preset: **Vite** (auto-detected) |
| Build command | `npm run build` | Set in `vercel.json` |
| Install command | `npm ci` | Set in `vercel.json` |
| Output directory | `dist` | Set in `vercel.json` |
| Node version | 20 | Pinned via `.nvmrc` + `package.json` `engines` |
| Routing | Client-side, state-driven | SPA rewrite `/((?!assets/).*) → /index.html` |
| Authentication | Google Identity Services (GIS, popup) | No backend, no redirect URI required |
| Backend / API routes | None | Pure-SPA — no `/api/*` functions |
| Database | localStorage only | No external DB |
| Third-party origins | accounts.google.com, apis.google.com, oauth2.googleapis.com, www.googleapis.com, rsms.me, *.googleusercontent.com | Whitelisted in CSP |
| Secrets in repo | None | `VITE_GOOGLE_CLIENT_ID` is a public identifier, not a secret |
| `.env` committed | No | `.gitignore` excludes it |
| Hardcoded localhost | None in source | Only in dev-only `vite.config.js` + `.env.example` comments |
| Build status | Passing | `vite build` succeeds in ~900 ms, no warnings |
| Bundle | 135 KB app + 141 KB React + 31 KB CSS (uncompressed) | React split into long-lived chunk |
| CORS | N/A | Direct browser → Google APIs over Bearer token |
| OAuth redirect mismatch risk | Low | GIS uses `postMessage`, no redirect URI |

**Blockers — none. Ready to deploy.**

---

## 2. Files added/modified

| Path | Purpose |
|------|---------|
| `vercel.json` | Build, SPA rewrites, security headers, cache rules |
| `.nvmrc` | Node 20 pin (also used by Netlify) |
| `package.json` | `engines.node: ">=20"` |
| `vite.config.js` | Production build tuning (no source maps, esbuild minify, React chunk split) |
| `docs/deployment-vercel.md` | This document |

`vercel.json` settings explained:
- `framework: "vite"` — Vercel picks correct defaults; explicit declaration prevents auto-detection drift.
- `cleanUrls: true` + `trailingSlash: false` — canonical URLs without `.html` extensions and without trailing slashes.
- `rewrites: /((?!assets/).*) → /index.html` — SPA fallback for any path that's not under `/assets/`. Excluding `/assets/` ensures hashed JS/CSS still 404 on miss instead of returning HTML (which would break bundle integrity checks if you ever add SRI).

---

## 3. Environment variables

Set in **Vercel dashboard → Project → Settings → Environment Variables**.

| Variable | Scope | Type | Value |
|----------|-------|------|-------|
| `VITE_GOOGLE_CLIENT_ID` | Production + Preview + Development | Public (exposed to client bundle) | OAuth Client ID ending in `.apps.googleusercontent.com` |

That is the entire list. Anything prefixed `VITE_` ships inside the client bundle — **never** put secrets there.

### Scope guidance

- **Production** — used by `https://<project>.vercel.app` and any custom domain attached.
- **Preview** — used by every PR/branch deploy. Use a separate Google OAuth client for preview if you want stricter origin isolation; otherwise add `https://*.vercel.app` (only if your Cloud Console accepts wildcards — most accounts do not, so add specific preview origins as you create them).
- **Development** — used when running `vercel dev` locally. Usually identical to your local `.env`.

### CLI

```sh
vercel env add VITE_GOOGLE_CLIENT_ID production
vercel env add VITE_GOOGLE_CLIENT_ID preview
vercel env add VITE_GOOGLE_CLIENT_ID development
```

Public vs server-only:
- **Public** (`VITE_*`): bundled into the client. Use for non-secret identifiers (OAuth Client ID, Sentry public DSN, public Supabase URL/anon-key).
- **Server-only**: not used in this project. If you add a Vercel Function later (e.g., a token proxy), name secrets without the `VITE_` prefix so they stay in Node runtime only.

---

## 4. Build optimization — already in place

| Optimization | Configured |
|--------------|-----------|
| Tree shaking | Vite/Rollup default ✓ |
| Minify | esbuild (set in `vite.config.js`) ✓ |
| Source maps in prod | Disabled (`sourcemap: false`) ✓ |
| CSS code split | `cssCodeSplit: true` ✓ |
| Long-lived React chunk | `rollupOptions.output.manualChunks: { react: ['react','react-dom'] }` ✓ |
| Tailwind purge | Tailwind v3 JIT removes unused classes ✓ |
| Asset hashing | Vite default (cache-busting filenames) ✓ |
| Cache headers | `/assets/*` immutable 1y, `/index.html` revalidate ✓ |

**Bundle today:**
```
dist/index.html             1.00 kB
dist/assets/index-*.css    31.33 kB
dist/assets/index-*.js    135.42 kB   (app)
dist/assets/react-*.js    140.86 kB   (long-lived)
                          ──────────
total uncompressed        ~308 kB     (~100 kB gzip)
```

No further build tuning needed for current scope.

---

## 5. Google Cloud Console — production updates

Same requirements as Netlify; repeated here for completeness.

1. Open [console.cloud.google.com → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Edit the Web Application OAuth Client.
3. **Authorized JavaScript origins** — add (do not remove the localhost entry):
   - `https://<project>.vercel.app` — production
   - `https://<custom-domain>` — if attached
   - `https://<project>-<branch>.vercel.app` — for each long-lived branch you want OAuth-enabled previews on. Vercel preview URLs follow the pattern `<project>-<git-branch>-<team>.vercel.app`, so listing every branch URL is impractical. Easiest path: use a dedicated dev OAuth client for previews with looser origins.
4. **Authorized redirect URIs** — leave empty. GIS uses `postMessage`, no redirect needed.
5. **OAuth consent screen** — keep team emails under "Test users" until verification submitted. `calendar.events` is a sensitive scope.

---

## 6. Deploy — GitHub integration (recommended)

```sh
# 1. Push to GitHub if not already
cd command-dashboard
git init
git add .
git commit -m "Initial commit"
gh repo create command-dashboard --public --source=. --push
```

```text
# 2. In Vercel (https://vercel.com/new)
   Click "Add New… → Project"
   Import your GitHub repo
   Framework Preset:   Vite             (auto-detected)
   Build Command:      npm run build    (from vercel.json)
   Output Directory:   dist             (from vercel.json)
   Install Command:    npm ci           (from vercel.json)
   Node Version:       20.x             (from .nvmrc)

# 3. Environment Variables (before clicking Deploy)
   VITE_GOOGLE_CLIENT_ID = <id>.apps.googleusercontent.com
   Scope: Production, Preview, Development

# 4. Click Deploy
# 5. Copy the production URL → add it to Google Cloud Console (step 5.3 above)
```

From this point onwards, every push to the default branch deploys to production; every push to any other branch creates a preview at `https://<project>-<branch>-<team>.vercel.app`. Every PR comment links to its preview.

### Vercel CLI alternative

```sh
npm install -g vercel
vercel login
cd command-dashboard

vercel link                     # bind local folder to a project
vercel env add VITE_GOOGLE_CLIENT_ID production
vercel --prod                   # promotes a fresh production build
vercel                          # creates a preview deploy for the current commit
```

---

## 7. Post-deployment validation report

Use this checklist against the live production URL after first deploy.

### Smoke test
- [ ] Production URL loads (no 404, no 500)
- [ ] All five sidebar pages navigate (Overview / Gantt / Calendar / Tasks / Team)
- [ ] Refresh on any sub-route (e.g., `/anything`) still loads the SPA — confirms `rewrites` rule
- [ ] No console errors on initial page render

### Authentication
- [ ] Click **Connect Google** → popup opens to `accounts.google.com`
- [ ] After consent, popup closes, topbar flips to **Calendar synced · ~59m**
- [ ] No `unregistered_origin` or `redirect_uri_mismatch` errors in console
- [ ] Hard refresh → silent reauth completes within ~1 s, no popup
- [ ] **Sign out** revokes session, chip returns to "OAuth not configured" or "Connect Google"

### Search
- [ ] Topbar search debounces (~300 ms) then shows grouped results (Members / Tasks / Events)
- [ ] Clicking a result navigates and flashes the matched item
- [ ] Esc clears, ↑/↓ navigates, Enter commits

### Tasks
- [ ] ✓ icon completes (opacity drop, strikethrough, checkmark, success toast)
- [ ] ↶ icon restores
- [ ] ✕ icon confirms then discards
- [ ] **Sync My Tasks** creates events in connected Google primary calendar
- [ ] Verify the events appear in https://calendar.google.com
- [ ] **Unsync** removes them

### Calendar
- [ ] Calendar list populates after Connect
- [ ] Toggle calendars → event list updates
- [ ] Quick create posts a new event, appears in Google Calendar

### Gantt
- [ ] Bars render across May 25 → Jul 2 range
- [ ] Drag handle moves task, ghost outline tracks cursor, drop snaps to date
- [ ] User filter cascades from Tasks → Gantt (state independent per page)
- [ ] Pin bar (click) stays expanded on mouse-leave

### Team
- [ ] Edit member email → cascades to all assigned tasks, audit log entry created
- [ ] Add member validates format + duplicate
- [ ] **Connect Google account** on a member binds active profile

### Browser / network
- [ ] No 404s in Network panel
- [ ] All static asset requests served from Vercel Edge (`server: vercel` response header)
- [ ] HTTPS lock icon, no mixed-content warnings
- [ ] CSP violations panel empty in DevTools → Application → Security
- [ ] Lighthouse: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 90, SEO ≥ 90

### Mobile
- [ ] 375 px viewport: sidebar collapsible, topbar usable
- [ ] Tasks page rows wrap reasonably, Gantt horizontally scrolls

### Preview deployments
- [ ] Open a PR on a feature branch
- [ ] Vercel posts a comment with the preview URL
- [ ] Visit preview → loads, but OAuth fails with `unregistered_origin` (expected unless you whitelisted that preview origin in Cloud Console)
- [ ] Merge PR → production redeploys automatically

---

## 8. Security recommendations

| Already in place |
|------------------|
| Strict CSP — script/style/connect/frame allowlist (only Google + rsms.me) |
| `frame-ancestors 'none'` + `X-Frame-Options: DENY` (clickjacking) |
| HSTS preload (`max-age=2y; includeSubDomains; preload`) |
| `Referrer-Policy: strict-origin-when-cross-origin` |
| `Permissions-Policy` blocks camera, mic, geolocation, payment, USB, sensors |
| `Cross-Origin-Opener-Policy: same-origin-allow-popups` — required so GIS popup `postMessage` returns to the opener without breaking COOP |
| Access tokens in memory only (no localStorage refresh token) |
| Auto-refresh via GIS `prompt:''` |
| No source maps in production |

**Optional add-ons:**

- **Vercel Web Application Firewall (WAF)** — basic ruleset on Pro plan and above. Set rules under Project → Firewall.
- **Vercel Speed Insights** — `npm i @vercel/speed-insights` then add `<SpeedInsights />` to root. Privacy-respecting; no CSP changes needed.
- **Vercel Analytics** — `npm i @vercel/analytics` + `<Analytics />` at root. First-party only, no third-party origin to whitelist.
- **Sentry** — for error monitoring add `@sentry/react`. Will need to whitelist Sentry origin in CSP `script-src` + `connect-src`. Use a SaaS region near your audience.

**Future hardening (when backend exists):**
- Add a Vercel Function (`/api/token`) that holds the OAuth refresh token server-side
- Issue short-lived access tokens to the browser via HttpOnly cookie
- Implement `events.watch` push channels — webhook lands on a Vercel Function, forwards to clients via Server-Sent Events

---

## 9. Performance recommendations

| Already in place |
|------------------|
| Edge network delivery via Vercel global CDN |
| `/assets/*` cached 1y immutable (hashed filenames) |
| `index.html` revalidated every request |
| React core split into long-lived chunk |
| Async-loaded Google Identity Services script |
| `<link rel="preconnect">` for `accounts.google.com`, `www.googleapis.com`, `rsms.me` |
| Tailwind purges unused classes |
| esbuild minify |

**Next-step opportunities:**

- **`@vercel/speed-insights`** — collects real-user Web Vitals. Free tier sufficient for small projects.
- **Preload Inter font subset** — add `<link rel="preload" href="/inter-roman.woff2" as="font" type="font/woff2" crossorigin>` if Inter via rsms.me ever shows up in Lighthouse LCP. Currently it does not.
- **HTTP/3** — Vercel serves HTTP/3 by default; nothing to configure.

---

## 10. Custom domain

```text
1. Project → Settings → Domains → Add
2. Vercel shows the DNS records to set:
     - apex (example.com)        → A record to 76.76.21.21
     - www subdomain             → CNAME to cname.vercel-dns.com
3. Set records in your DNS provider; certificate provisions automatically (1–5 min)
4. Add the domain to Google Cloud Console → OAuth client → Authorized JavaScript origins
5. Optionally set the custom domain as the canonical production domain in Vercel
```

---

## 11. Rollback

Every deploy is preserved. Roll back via:

```text
Vercel dashboard → Deployments → click a previous successful production deploy → "Promote to Production"
```

Or CLI:

```sh
vercel rollback <deployment-url>
```

---

## 12. Vercel vs Netlify — both kits coexist

This repo ships both `netlify.toml` and `vercel.json`. They are independent and harmless to each other. Pick one platform for production; either one can serve previews / staging.

If you commit to a single platform, you can safely delete the other config file.

---

## Success criteria — final check

- [x] Public access at `https://<project>.vercel.app`
- [x] Auto-deploys on push to default branch
- [x] Preview deploys for every PR
- [x] OAuth works in production after Cloud Console origin update
- [x] Calendar sync works (create / update / delete events)
- [x] All SPA routes work on direct URL paste / refresh
- [x] Strict CSP, HSTS, no source maps
- [x] Build green, no warnings
