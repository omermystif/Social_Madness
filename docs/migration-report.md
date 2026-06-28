# Migration Report

## Current application audit

- Frontend framework: React 18 with Vite.
- Build process: `vite build` outputs the SPA into `dist/`.
- Routing: client-side page switching inside `src/App.jsx`; there is no URL router.
- Current storage: the live app still uses browser `localStorage` as its main data store.
- Authentication: Google Identity Services in the browser.
- Google Calendar integration: direct browser calls to the Google Calendar API from `src/api/calendarApi.js`.
- External dependencies: Google Identity Services, Google Calendar API, and a legacy Vercel KV sync function in `api/state.js`.

## What changed

- Standardized the migration around Node.js + Express + SQLite.
- Switched the shared database default to `server/taskmanager.db`.
- Added a server-backed frontend mode with optimistic updates and polling-based shared refresh.
- Configured the Node server to bind to `0.0.0.0`, serve the built frontend, and print LAN URLs.
- Added automatic compressed backups to `server/backup/`.

## Remaining architecture

- Browser clients connect to one shared Node server on the local network.
- The Node server writes all shared state to SQLite.
- Google Calendar stays client-driven, but sync metadata is stored in SQLite so the app avoids duplicate events.
