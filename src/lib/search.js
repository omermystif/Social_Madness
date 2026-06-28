// Multi-field scored search with fuzzy fallback.
//
// score() per field returns a number 0..100 where:
//   100 = exact match
//    80 = prefix (startsWith)
//    60 = contains
//    50 = fuzzy distance 1 (typo)
//    35 = fuzzy distance 2 (long query only)
//    30 = numeric substring match in numeric field
//     0 = no match
//
// Field weights amplify by importance (name > email > role). Best field wins per item.

function lev(a, b) {
  // Iterative Levenshtein. O(m*n), capped by guards in score().
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j]     + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function isNumeric(s) {
  return /^\d+$/.test(s);
}

export function scoreField(rawField, q) {
  if (rawField == null || rawField === '') return 0;
  const f  = String(rawField).toLowerCase().trim();
  const ql = q.toLowerCase().trim();
  if (!ql) return 0;

  if (f === ql)         return 100;
  if (f.startsWith(ql)) return 80;
  if (f.includes(ql))   return 60;

  // Tokenized prefix match — match any whitespace/punctuation-separated token.
  for (const tok of f.split(/[\s._@\-/]+/)) {
    if (tok && tok.startsWith(ql)) return 70;
  }

  // Numeric substring — for IDs / reference numbers, allow query digits anywhere.
  if (isNumeric(ql)) {
    const digitsOnly = f.replace(/\D+/g, '');
    if (digitsOnly.includes(ql)) return 55;
  }

  // Fuzzy — limit to short-ish queries to keep cost bounded.
  if (ql.length >= 3 && ql.length <= 16) {
    // Compare against the shortest token-aligned slice of f (close to q's length).
    const candidates = [f, ...f.split(/[\s._@\-/]+/).filter(Boolean)];
    let best = Infinity;
    for (const c of candidates) {
      if (Math.abs(c.length - ql.length) > 3) continue; // cheap length-prune
      const d = lev(c, ql);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best === 1)                            return 50;
    if (best === 2 && ql.length >= 5)          return 35;
  }
  return 0;
}

// scoreItem: takes list of [field, weight] pairs; returns best weighted score across fields.
export function scoreItem(fields, q) {
  let best = 0;
  for (const [field, weight] of fields) {
    const s = scoreField(field, q) * (weight ?? 1);
    if (s > best) best = s;
  }
  return best;
}

// Debounce helper for input handlers.
export function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return debounced;
}

// ─── Domain-specific scorers ────────────────────────────────────────────────

export function scoreMember(m, q) {
  const parts = (m.name || '').split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName  = parts.length > 1 ? parts[parts.length - 1] : '';
  const username  = (m.email || '').split('@')[0];
  return scoreItem(
    [
      [m.name,        1.2],
      [firstName,     1.2],
      [lastName,      1.2],
      [m.email,       1.0],
      [username,      1.1],
      [username.split(/[._-]/).join(' '), 0.9],
      [m.role,        0.7],
      [m.googleEmail, 1.0],
    ],
    q,
  );
}

export function scoreTask(t, q) {
  return scoreItem(
    [
      [t.name,     1.2],
      [t.assignee, 0.8],
      [t.id,       0.6],
      [t.priority, 0.4],
    ],
    q,
  );
}

export function scoreEvent(ev, q) {
  // Google Calendar event shape: { id, summary, description, location, organizer:{email,displayName}, iCalUID }
  return scoreItem(
    [
      [ev.summary,                1.3],
      [ev.description,            0.8],
      [ev.location,               1.0],
      [ev.id,                     0.6],
      [ev.iCalUID,                0.5],
      [ev.organizer?.email,       0.7],
      [ev.organizer?.displayName, 0.9],
    ],
    q,
  );
}
