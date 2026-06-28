# Auto-Sync Scripts

## `watcher.js` — File Watcher + Auto-Commit

Watches `src/`, `api/`, config files. Batches changes (30s debounce) → smart commit → pushes to `develop`.

### Usage

```bash
npm run sync          # watch + auto-commit + auto-push to develop
npm run sync:dry      # watch + log only (no commit, no push)
npm run sync:local    # watch + commit locally (no push)
```

### Environment options

| Var | Default | Description |
|-----|---------|-------------|
| `SYNC_DEBOUNCE_MS` | `30000` | Wait time after last change before committing |
| `SYNC_BRANCH` | `develop` | Target branch for auto-sync pushes |

### Commit message format

```
[auto-sync] <area>: <type> — <file or N files> (YYYY-MM-DD HH:mm)
```

Examples:
```
[auto-sync] task-management: update — src/context/TaskContext.jsx (2026-06-16 10:45)
[auto-sync] calendar, styles: update — 3 files (2026-06-16 11:00)
```

### Ignored paths

- `node_modules/`, `dist/`, `.git/`, `.husky/`, `.vercel/`
- `*.log`, `*.lock`, `.env`, `.env.local`
- `server/taskmanager.db`, `server/backup/`
