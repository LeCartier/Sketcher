// Minimal Supabase client wrapper for community scenes
// Supports multiple user-added Supabase sources while always including the default
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/community.js';
import { resolveCredentials } from './supabase-sources.js';

// Lazy-load Supabase client to avoid cost if feature unused
const _clients = new Map(); // key: sourceId or 'main'
async function getClient(sourceId = 'main') {
  if (_clients.has(sourceId)) return _clients.get(sourceId);
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  let url = SUPABASE_URL; let key = SUPABASE_ANON_KEY; let thumbsBucket = 'thumbs'; let table = 'community_scenes';
  if (sourceId && sourceId !== 'main') {
    try {
      const creds = await resolveCredentials(sourceId);
      if (creds) { url = creds.url; key = creds.anonKey; thumbsBucket = creds.thumbsBucket || 'thumbs'; table = creds.table || 'community_scenes'; }
    } catch (e) { console.warn('Custom source resolution failed, falling back to main', e); }
  }
  const sb = createClient(url, key, { auth: { persistSession: false }, global: { headers: { 'x-application-name': 'Sketcher' } } });
  const client = { sb, thumbsBucket, table, sourceId };
  _clients.set(sourceId, client);
  return client;
}

// Upload a data URL thumbnail to the public 'thumbs' bucket; return public URL
async function uploadThumbDataUrl(dataUrl, sourceId = 'main') {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const { sb: supabase, thumbsBucket } = await getClient(sourceId);
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const b64 = match[2];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ext = mime.includes('jpeg') ? 'jpg' : (mime.includes('png') ? 'png' : 'bin');
  const name = `${crypto.randomUUID?.() || (Date.now()+"-"+Math.random().toString(36).slice(2))}.${ext}`;
  const path = name; // flat namespace in thumbs bucket
  const { data, error } = await supabase.storage.from(thumbsBucket).upload(path, bytes, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) { console.warn('Thumb upload failed', error); return null; }
  const { data: pub } = supabase.storage.from(thumbsBucket).getPublicUrl(path);
  return pub?.publicUrl || null;
}

export async function saveCommunityScene({ name, json, thumb, group = null, password = null, sourceId = 'main' }) {
  const { sb: supabase, table, thumbsBucket } = await getClient(sourceId);
  // Enforce simple client-side size checks (defense-in-depth with DB constraints)
  if (!name || name.length > 80) name = (name || 'Untitled').slice(0, 80);
  const jsonText = typeof json === 'string' ? json : JSON.stringify(json || {});
  if (jsonText.length > 300000) throw new Error('Scene too large');
  let thumb_url = null;
  try { thumb_url = await uploadThumbDataUrl(thumb, sourceId); } catch {}
  // Optional Secret Space password gate (client-side only; add RLS/policy server-side for real security)
  // Accept legacy 'FFE' and new 'SECRET' (canonical) identifiers
  const isSecretGroup = (group === 'SECRET' || group === 'Secret Space' || group === 'SECRET_SPACE' || group === 'FFE');
  if (isSecretGroup && password !== 'CLINT') {
    throw new Error('Invalid password for Secret Space upload');
  }
  const payload = { name, json: JSON.parse(jsonText), thumb_url };
  // Use 'label' as the DB column to avoid reserved keyword issues with 'group'
  if (group) {
    // Canonicalize label to 'SECRET' (but keep backward compat on read)
    payload.label = isSecretGroup ? 'SECRET' : group;
  }
  // Insert, retry without group if the column doesn't exist yet
  let data = null; let error = null;
  try {
    ({ data, error } = await supabase.from(table).insert(payload).select('id').single());
    if (error) throw error;
  } catch (e) {
    // Fallback: remove group and try again for older schema
    try {
  const legacy = { ...payload }; delete legacy.label;
      ({ data, error } = await supabase.from(table).insert(legacy).select('id').single());
      if (error) throw error;
    } catch (e2) { throw e2; }
  }
  // Backend cap: keep only latest 20 (best-effort) and remove orphaned thumbs
  try {
    const { data: rows } = await supabase
      .from(table)
      .select('id,created_at,thumb_url')
      .order('created_at', { ascending: false })
      .limit(100);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length > 20) {
      const excess = list.slice(20);
      const toDelete = excess.map(r => r.id);
      // Attempt to remove corresponding thumbnails from storage (best-effort)
      try {
        const paths = excess
          .map(r => r.thumb_url || '')
          .map(url => {
            const m = typeof url === 'string' ? url.match(/\/storage\/v1\/object\/public\/thumbs\/(.+)$/) : null;
            return m && m[1] ? decodeURIComponent(m[1]) : null;
          })
          .filter(Boolean);
        if (paths.length) {
          // remove from the configured bucket and attempt common legacy names
          try { await supabase.storage.from(thumbsBucket).remove(paths); } catch {}
          try { await supabase.storage.from('thumbs').remove(paths); } catch {}
          try { await supabase.storage.from('thumbs_public').remove(paths); } catch {}
        }
      } catch (err) { console.warn('Thumb cleanup failed', err); }
      if (toDelete.length) { await supabase.from(table).delete().in('id', toDelete); }
    }
  } catch {}
  return { id: data.id, name, thumb_url };
}

export async function pickRandomCommunity(n = 5, { sourceId = 'main' } = {}) {
  const { sb: supabase, table } = await getClient(sourceId);
  // Use RPC-like random ordering via SQL function; fallback to LIMIT if needed
  const { data, error } = await supabase
    .from(table)
    .select('id,name,thumb_url')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = Array.isArray(data) ? data : [];
  // client-side random pick to avoid costs/permissions for ORDER BY random()
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(1, n)).map(r => ({ id: r.id, name: r.name, thumb: r.thumb_url || '' }));
}

export async function getCommunityScene(id, { sourceId = 'main' } = {}) {
  const { sb: supabase, table } = await getClient(sourceId);
  // Try selecting with group column; fallback to legacy schema
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id,name,json,thumb_url,label')
      .eq('id', id)
      .single();
    if (error) throw error;
    // Map legacy 'FFE' to 'SECRET' for downstream code, but preserve UI choice elsewhere
    const label = data.label || null;
    const group = (label === 'FFE' || label === 'SECRET') ? 'SECRET' : (label || null);
    return { id: data.id, name: data.name, json: data.json, thumb: data.thumb_url, group };
  } catch (e) {
    const { data, error } = await supabase
  .from(table)
      .select('id,name,json,thumb_url')
      .eq('id', id)
      .single();
    if (error) throw error;
    return { id: data.id, name: data.name, json: data.json, thumb: data.thumb_url, group: null };
  }
}

export async function listLatestCommunity(limit = 10, { group = null, sourceId = 'main' } = {}) {
  const { sb: supabase, table } = await getClient(sourceId);
  // Prefer created_at only to avoid errors if updated_at is absent
  // Try with group column present; if it fails, fallback to legacy query without group filtering
  try {
    let q = supabase
      .from(table)
      .select('id,name,thumb_url,created_at,label')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, limit));
    if (group) {
      // Back-compat: if requesting Secret Space, include legacy 'FFE' too
      if (group === 'SECRET' || group === 'Secret Space' || group === 'SECRET_SPACE') {
        q = q.in('label', ['SECRET', 'FFE']);
      } else {
        q = q.eq('label', group);
      }
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => {
      const label = r.label || null;
      const groupOut = (label === 'FFE' || label === 'SECRET') ? 'SECRET' : (label || null);
      return { id: r.id, name: r.name, thumb: r.thumb_url || '', created_at: r.created_at, group: groupOut };
    });
  } catch (e) {
    // Legacy schema without 'label' column: cannot represent FFE; return empty for FFE requests
    if (group) {
      return [];
    }
    const { data, error } = await supabase
  .from(table)
      .select('id,name,thumb_url,created_at')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, limit));
    if (error) throw error;
    return (data || []).map(r => ({ id: r.id, name: r.name, thumb: r.thumb_url || '', created_at: r.created_at, group: null }));
  }
}
