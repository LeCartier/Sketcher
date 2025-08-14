// Minimal Supabase client wrapper for community scenes
// No bundler needed; uses ESM import from Skypack CDN for @supabase/supabase-js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/community.js';

// Lazy-load Supabase client to avoid cost if feature unused
let _sb = null;
async function getClient() {
  if (_sb) return _sb;
  // Use a robust ESM CDN for browsers (Skypack can be flaky/CORS-blocked)
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'Sketcher' } }
  });
  return _sb;
}

// Upload a data URL thumbnail to the public 'thumbs' bucket; return public URL
async function uploadThumbDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const supabase = await getClient();
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const b64 = match[2];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ext = mime.includes('jpeg') ? 'jpg' : (mime.includes('png') ? 'png' : 'bin');
  const name = `${crypto.randomUUID?.() || (Date.now()+"-"+Math.random().toString(36).slice(2))}.${ext}`;
  const path = name; // flat namespace in thumbs bucket
  const { data, error } = await supabase.storage.from('thumbs').upload(path, bytes, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) { console.warn('Thumb upload failed', error); return null; }
  const { data: pub } = supabase.storage.from('thumbs').getPublicUrl(path);
  return pub?.publicUrl || null;
}

export async function saveCommunityScene({ name, json, thumb }) {
  const supabase = await getClient();
  // Enforce simple client-side size checks (defense-in-depth with DB constraints)
  if (!name || name.length > 80) name = (name || 'Untitled').slice(0, 80);
  const jsonText = typeof json === 'string' ? json : JSON.stringify(json || {});
  if (jsonText.length > 300000) throw new Error('Scene too large');
  let thumb_url = null;
  try { thumb_url = await uploadThumbDataUrl(thumb); } catch {}
  const payload = { name, json: JSON.parse(jsonText), thumb_url };
  const { data, error } = await supabase.from('community_scenes').insert(payload).select('id').single();
  if (error) throw error;
  // Backend cap: keep only latest 10 (best-effort) and remove orphaned thumbs
  try {
    const { data: rows } = await supabase
      .from('community_scenes')
      .select('id,created_at,thumb_url')
      .order('created_at', { ascending: false })
      .limit(100);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length > 10) {
      const excess = list.slice(10);
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
          await supabase.storage.from('thumbs').remove(paths);
        }
      } catch (err) { console.warn('Thumb cleanup failed', err); }
      if (toDelete.length) { await supabase.from('community_scenes').delete().in('id', toDelete); }
    }
  } catch {}
  return { id: data.id, name, thumb_url };
}

export async function pickRandomCommunity(n = 3) {
  const supabase = await getClient();
  // Use RPC-like random ordering via SQL function; fallback to LIMIT if needed
  const { data, error } = await supabase
    .from('community_scenes')
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

export async function getCommunityScene(id) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from('community_scenes')
    .select('id,name,json,thumb_url')
    .eq('id', id)
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, json: data.json, thumb: data.thumb_url };
}

export async function listLatestCommunity(limit = 10) {
  const supabase = await getClient();
  // Prefer created_at only to avoid errors if updated_at is absent
  const { data, error } = await supabase
    .from('community_scenes')
    .select('id,name,thumb_url,created_at')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, limit));
  if (error) throw error;
  return (data || []).map(r => ({ id: r.id, name: r.name, thumb: r.thumb_url || '', created_at: r.created_at }));
}
