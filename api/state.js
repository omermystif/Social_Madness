// Vercel Edge Function — shared workspace store.
// GET  /api/state       → returns current shared snapshot { state, version, updatedAt }
// PUT  /api/state       → writes new snapshot; body { state, expectedVersion? }
// Uses Upstash Redis via Vercel KV-style env vars (KV_REST_API_URL + KV_REST_API_TOKEN).
//
// Provisioning steps (one-time, in Vercel dashboard):
//   Project → Storage → Create Database → Upstash → KV (Redis) → Connect to project
// Vercel auto-injects KV_REST_API_URL + KV_REST_API_TOKEN into all environments.

export const config = { runtime: 'edge' };

const KEY    = 'cmd:workspace:default';
const VKEY   = 'cmd:workspace:default:version';
const TKEY   = 'cmd:workspace:default:updatedAt';
const MAX_BODY = 5 * 1024 * 1024; // 5 MB hard cap

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-Match',
    'Cache-Control':                'no-store',
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra },
  });
}

async function kvCmd(url, token, args) {
  const r = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(args),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`KV ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json().catch(() => ({}));
  return data.result;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return json(
      {
        error:    'storage_not_configured',
        message:  'Upstash KV not provisioned. In Vercel dashboard: Project → Storage → Create Database → Upstash KV → Connect.',
      },
      503,
    );
  }

  if (req.method === 'GET') {
    try {
      const [stateRaw, versionRaw, updatedAtRaw] = await Promise.all([
        kvCmd(url, token, ['GET', KEY]),
        kvCmd(url, token, ['GET', VKEY]),
        kvCmd(url, token, ['GET', TKEY]),
      ]);
      const state = stateRaw ? JSON.parse(stateRaw) : null;
      return json({
        state,
        version:   versionRaw ? Number(versionRaw) : 0,
        updatedAt: updatedAtRaw || null,
        empty:     !state,
      });
    } catch (err) {
      return json({ error: 'kv_read_failed', message: err.message }, 502);
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const ifMatch = req.headers.get('If-Match'); // optional optimistic concurrency
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    if (!body || typeof body !== 'object' || typeof body.state !== 'object') {
      return json({ error: 'missing_state' }, 400);
    }

    const serialized = JSON.stringify(body.state);
    if (serialized.length > MAX_BODY) {
      return json({ error: 'payload_too_large', maxBytes: MAX_BODY }, 413);
    }

    try {
      // Optimistic concurrency: if If-Match provided, abort if current version differs.
      if (ifMatch != null) {
        const currentV = await kvCmd(url, token, ['GET', VKEY]);
        const current  = currentV ? Number(currentV) : 0;
        if (Number(ifMatch) !== current) {
          return json({ error: 'version_conflict', currentVersion: current }, 412);
        }
      }

      const nextV = await kvCmd(url, token, ['INCR', VKEY]); // atomic
      const nowIso = new Date().toISOString();
      await Promise.all([
        kvCmd(url, token, ['SET', KEY, serialized]),
        kvCmd(url, token, ['SET', TKEY, nowIso]),
      ]);

      return json({ ok: true, version: Number(nextV), updatedAt: nowIso });
    } catch (err) {
      return json({ error: 'kv_write_failed', message: err.message }, 502);
    }
  }

  return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT, OPTIONS' });
}
