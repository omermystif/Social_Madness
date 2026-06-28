/**
 * Auto-sync watcher: file change → debounce → smart commit → push
 *
 * Usage:
 *   npm run sync              # watch + auto-commit + auto-push
 *   npm run sync -- --dry-run # watch only, log what would commit
 *   npm run sync -- --no-push # commit but don't push
 *
 * Env:
 *   SYNC_DEBOUNCE_MS   default 30000 (30s)
 *   SYNC_BRANCH        default "develop"
 */

import { watch } from 'chokidar';
import { execSync, exec } from 'child_process';
import { join, relative, extname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────
const DEBOUNCE_MS  = parseInt(process.env.SYNC_DEBOUNCE_MS  || '30000', 10);
const SYNC_BRANCH  = process.env.SYNC_BRANCH || 'main';
const DRY_RUN      = process.argv.includes('--dry-run');
const NO_PUSH      = process.argv.includes('--no-push');

// ── Ignore patterns ──────────────────────────────────────────────────────────
const IGNORED = [
  /node_modules/,
  /[/\\]dist[/\\]/,
  /\.git[/\\]/,
  /\.husky[/\\]/,
  /\.vercel[/\\]/,
  /\.(log|lock)$/,
  /server\/taskmanager\.db/,
  /server\/backup/,
  /\.env$/,
  /\.env\.local$/,
];

function isIgnored(path) {
  return IGNORED.some((r) => r.test(path));
}

// ── Smart commit message generation ─────────────────────────────────────────
const AREA_MAP = [
  [/src\/components\/calendar/,    'calendar'],
  [/src\/components\/pages\/Gantt/, 'gantt'],
  [/src\/components\/pages\/Team/,  'team'],
  [/src\/components\/Topbar/,       'topbar'],
  [/src\/context\/TaskContext/,     'task-management'],
  [/src\/context\/CalendarContext/,'calendar-sync'],
  [/src\/auth\//,                   'auth'],
  [/src\/lib\//,                    'lib'],
  [/src\/seed\//,                   'seed-data'],
  [/api\//,                         'api'],
  [/\.github\//,                    'ci'],
  [/scripts\//,                     'scripts'],
  [/tailwind\.config/,              'styles'],
  [/src\/index\.css/,               'styles'],
  [/vite\.config/,                  'build-config'],
  [/vercel\.json/,                  'deployment'],
  [/package\.json/,                 'dependencies'],
];

function detectArea(files) {
  const counts = {};
  for (const f of files) {
    for (const [re, area] of AREA_MAP) {
      if (re.test(f)) {
        counts[area] = (counts[area] || 0) + 1;
        break;
      }
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return 'misc';
  if (sorted.length === 1) return sorted[0][0];
  return sorted.slice(0, 2).map(([a]) => a).join(', ');
}

function detectChangeType(files) {
  const exts = new Set(files.map((f) => extname(f)));
  if (exts.has('.css')) return 'styles';
  if (files.some((f) => /test|spec/i.test(f))) return 'tests';
  if (files.some((f) => /README|\.md$/i.test(f))) return 'docs';
  return 'update';
}

function buildCommitMessage(changedFiles) {
  const area  = detectArea(changedFiles);
  const type  = detectChangeType(changedFiles);
  const count = changedFiles.length;
  const when  = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const noun  = count === 1 ? relative(ROOT, changedFiles[0]).replace(/\\/g, '/') : `${count} files`;
  return `[auto-sync] ${area}: ${type} — ${noun} (${when})`;
}

// ── Git helpers ──────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
}

function currentBranch() {
  return run('git rev-parse --abbrev-ref HEAD', { quiet: true }).trim();
}

function ensureBranch() {
  const branch = currentBranch();
  if (branch === SYNC_BRANCH) return;

  // Check if develop exists remotely
  const remotes = run('git branch -r', { quiet: true });
  const remoteExists = remotes.includes(`origin/${SYNC_BRANCH}`);

  if (remoteExists) {
    console.log(`Switching to ${SYNC_BRANCH}...`);
    run(`git checkout ${SYNC_BRANCH}`);
  } else {
    console.log(`Creating ${SYNC_BRANCH} branch...`);
    run(`git checkout -b ${SYNC_BRANCH}`);
    run(`git push -u origin ${SYNC_BRANCH}`);
  }
}

function hasChanges() {
  const out = run('git status --porcelain', { quiet: true });
  return out.trim().length > 0;
}

function stagedAndUnstaged() {
  const out = run('git status --porcelain', { quiet: true });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => join(ROOT, line.slice(3).trim()));
}

// ── Commit + push ────────────────────────────────────────────────────────────
let timer = null;
const pendingFiles = new Set();

function scheduleCommit(filePath) {
  pendingFiles.add(filePath);
  clearTimeout(timer);
  const remaining = DEBOUNCE_MS / 1000;
  process.stdout.write(`\r⏳ Committing in ${remaining}s... (${pendingFiles.size} file${pendingFiles.size > 1 ? 's' : ''} pending)`);

  timer = setTimeout(doCommit, DEBOUNCE_MS);
}

async function doCommit() {
  const files = [...pendingFiles];
  pendingFiles.clear();
  process.stdout.write('\n');

  if (!hasChanges()) {
    console.log('No changes to commit.');
    return;
  }

  const msg = buildCommitMessage(files);
  console.log(`\n📝 Commit: ${msg}`);

  if (DRY_RUN) {
    console.log('[dry-run] Would commit and push.');
    return;
  }

  try {
    ensureBranch();
    run('git add -A');
    run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
    console.log('✅ Committed');

    if (!NO_PUSH) {
      const branch = currentBranch();
      console.log(`🚀 Pushing to origin/${branch}...`);
      run(`git push origin ${branch}`);
      console.log('✅ Pushed');
    }
  } catch (err) {
    console.error('❌ Commit/push failed:', err.message);
    // Retry push once after 5s
    if (!NO_PUSH) {
      console.log('Retrying push in 5s...');
      setTimeout(() => {
        try {
          run(`git push origin ${currentBranch()}`);
          console.log('✅ Retry push OK');
        } catch (e) {
          console.error('❌ Retry failed:', e.message);
        }
      }, 5000);
    }
  }
}

// ── Watcher ──────────────────────────────────────────────────────────────────
console.log(`
╔═══════════════════════════════════════════╗
║         Command Dashboard Auto-Sync        ║
╠═══════════════════════════════════════════╣
║ Branch  : ${SYNC_BRANCH.padEnd(31)}║
║ Debounce: ${String(DEBOUNCE_MS / 1000 + 's').padEnd(31)}║
║ Dry-run : ${String(DRY_RUN).padEnd(31)}║
║ No-push : ${String(NO_PUSH).padEnd(31)}║
╚═══════════════════════════════════════════╝
Watching for changes... (Ctrl+C to stop)
`);

const watcher = watch(ROOT, {
  ignored: (path) => isIgnored(path),
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
});

watcher
  .on('change', (p) => { console.log(`\n  ~ ${relative(ROOT, p)}`); scheduleCommit(p); })
  .on('add',    (p) => { console.log(`\n  + ${relative(ROOT, p)}`); scheduleCommit(p); })
  .on('unlink', (p) => { console.log(`\n  - ${relative(ROOT, p)}`); scheduleCommit(p); })
  .on('error',  (err) => console.error('Watcher error:', err));

process.on('SIGINT', () => {
  console.log('\nStopping watcher...');
  watcher.close();
  process.exit(0);
});
