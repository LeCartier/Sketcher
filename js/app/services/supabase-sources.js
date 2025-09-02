// Manage user-configured Supabase sources without exposing the built-in default
// Persists to IndexedDB via local-store SETTINGS, and always includes the default
// exported functions avoid returning default URL/keys to the UI layer.

import { getSetting, setSetting } from '../local-store.js';

const SETTINGS_KEY = 'supabase:sources';

// UI-facing descriptor for the default; credentials are not exposed here
export const DEFAULT_SOURCE = {
  id: 'main',
  name: 'Sketcher Community',
  isDefault: true
};

function sanitizeUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid protocol');
    return u.origin; // normalize
  } catch { return null; }
}

function makeId() {
  return (crypto?.randomUUID ? crypto.randomUUID() : ('src-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
}

// Returns only UI-safe descriptors. Default comes first and is undeletable.
export async function getSources() {
  const raw = (await getSetting(SETTINGS_KEY)) || [];
  const custom = Array.isArray(raw) ? raw : [];
  // Hide secrets from UI layer (no anon key, no url here for default)
  const safeCustom = custom.map(s => ({ id: s.id, name: s.name || 'Custom', isDefault: false }));
  return [ DEFAULT_SOURCE, ...safeCustom ];
}

// Internal: get the full stored record for a custom source id (never for default)
async function getStoredById(id) {
  const raw = (await getSetting(SETTINGS_KEY)) || [];
  return (Array.isArray(raw) ? raw : []).find(s => s.id === id) || null;
}

// Add a new custom source; returns id
export async function addSource({ name, url, anonKey, thumbsBucket = 'thumbs', table = 'community_scenes' }) {
  const origin = sanitizeUrl(url);
  if (!origin) throw new Error('Enter a valid Supabase URL');
  if (!anonKey || typeof anonKey !== 'string' || anonKey.length < 20) throw new Error('Enter a valid anon public key');
  const id = makeId();
  const rec = { id, name: (name || 'Custom').trim(), url: origin, anonKey: String(anonKey).trim(), thumbsBucket: String(thumbsBucket || 'thumbs'), table: String(table || 'community_scenes') };
  const raw = (await getSetting(SETTINGS_KEY)) || [];
  const list = Array.isArray(raw) ? raw : [];
  list.push(rec);
  await setSetting(SETTINGS_KEY, list);
  return id;
}

export async function removeSource(id) {
  if (id === DEFAULT_SOURCE.id) return false; // cannot remove default
  const raw = (await getSetting(SETTINGS_KEY)) || [];
  const list = Array.isArray(raw) ? raw : [];
  const next = list.filter(s => s.id !== id);
  await setSetting(SETTINGS_KEY, next);
  return true;
}

// Resolve credentials for a source id. For default, returns null so callers use built-ins.
export async function resolveCredentials(id) {
  if (!id || id === DEFAULT_SOURCE.id) return null;
  const rec = await getStoredById(id);
  if (!rec) throw new Error('Unknown source');
  return { url: rec.url, anonKey: rec.anonKey, thumbsBucket: rec.thumbsBucket || 'thumbs', table: rec.table || 'community_scenes' };
}
