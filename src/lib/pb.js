import PocketBase from 'pocketbase';

const PB_URL = (import.meta.env.VITE_PB_URL || '').trim();
const SESSION_KEY = 'pb_workspace_user';

export const pb = new PocketBase(PB_URL || 'http://127.0.0.1:8090');
export const pbEnabled = Boolean(PB_URL);

function safeStorageGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || '').split('.');
  if (!payload) throw new Error('Invalid JWT credential');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(normalized);
  return JSON.parse(json);
}

function clean(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

async function findFirstRecord(collection, filter) {
  try {
    return await pb.collection(collection).getFirstListItem(filter);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

export function getWorkspaceUser() {
  return safeStorageGet(SESSION_KEY);
}

export function ensurePocketBase() {
  if (!pbEnabled) {
    throw new Error('PocketBase is not configured. Set VITE_PB_URL first.');
  }
}

export async function syncGoogleUser(credentialOrProfile) {
  ensurePocketBase();

  const profile = typeof credentialOrProfile === 'string'
    ? decodeJwtPayload(credentialOrProfile)
    : credentialOrProfile;

  if (!profile?.sub || !profile?.email) {
    throw new Error('Google profile is missing sub/email');
  }

  const payload = clean({
    google_sub: profile.sub,
    google_email: profile.email,
    email: profile.email,
    name: profile.name || profile.email,
    avatar_url: profile.picture || null,
    last_login_at: new Date().toISOString(),
    google_status: 'connected',
    google_connected_at: new Date().toISOString(),
    google_error: null,
  });

  const existing = await findFirstRecord(
    'users',
    `google_sub="${profile.sub}" || email="${profile.email.replace(/"/g, '\\"')}"`
  );

  const record = existing
    ? await pb.collection('users').update(existing.id, payload)
    : await pb.collection('users').create({
        ...payload,
        role: 'Team member',
      });

  const session = {
    id: record.id,
    email: record.email,
    googleSub: record.google_sub,
    googleEmail: record.google_email || profile.email,
    name: record.name || profile.name || profile.email,
    avatarUrl: record.avatar_url || profile.picture || null,
  };

  safeStorageSet(SESSION_KEY, session);
  return session;
}

export async function saveGoogleConnection({ userId, googleEmail, accessToken, expiresAt }) {
  ensurePocketBase();
  if (!userId || !googleEmail || !accessToken) return null;

  const escapedUserId = String(userId).replace(/"/g, '\\"');
  const existing = await findFirstRecord('google_connections', `user_id="${escapedUserId}"`);
  const payload = clean({
    user_id: userId,
    google_email: googleEmail,
    access_token: accessToken,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  });

  return existing
    ? pb.collection('google_connections').update(existing.id, payload)
    : pb.collection('google_connections').create(payload);
}

export function signOut() {
  pb.authStore.clear();
  safeStorageRemove(SESSION_KEY);
}
