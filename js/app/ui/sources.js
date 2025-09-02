// UI for managing user Supabase sources without exposing the built-in default
import { getSources, addSource, removeSource, DEFAULT_SOURCE } from '../services/supabase-sources.js';

const ACTIVE_KEY = 'sources:active';
const UPLOAD_KEY = 'sources:last-upload';

export function getActiveSourceId() {
  try { return sessionStorage.getItem(ACTIVE_KEY) || 'main'; } catch { return 'main'; }
}
export function setActiveSourceId(id) {
  try { sessionStorage.setItem(ACTIVE_KEY, id || 'main'); } catch {}
  window.dispatchEvent(new CustomEvent('sources:active-changed', { detail: { id: id || 'main' } }));
}
export function getUploadDestinationId() {
  try { return sessionStorage.getItem(UPLOAD_KEY) || 'main'; } catch { return 'main'; }
}
export function setUploadDestinationId(id) {
  try { sessionStorage.setItem(UPLOAD_KEY, id || 'main'); } catch {}
}

// Minimal floating panel
let container = null; let btn = null;

export async function renderInto(host) {
  container = host;
  container.innerHTML = '';
  const wrap = document.createElement('div'); wrap.id = 'sourcesWrap'; Object.assign(wrap.style, { padding: '10px' }); container.appendChild(wrap);
  const list = await getSources();
  const active = getActiveSourceId();
  // List section
  const ul = document.createElement('div'); Object.assign(ul.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
  for (const s of list) {
    const row = document.createElement('div'); Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', background: '#161616', border: '1px solid #2a2a2a', borderRadius: '10px', padding: '8px' });
    const name = document.createElement('div'); name.textContent = s.name || (s.isDefault ? 'Sketcher Community' : 'Custom'); Object.assign(name.style, { color: '#eee', font: '600 12px system-ui, sans-serif', marginRight: 'auto' });
    const tag = document.createElement('div'); if (s.isDefault) { tag.textContent = 'Default'; Object.assign(tag.style, { background: 'rgba(255,0,255,0.88)', color:'#111', border:'1px solid rgba(0,0,0,0.35)', borderRadius:'999px', padding:'2px 8px', font:'600 11px system-ui, sans-serif' }); }
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'activeSource'; radio.checked = (s.id === active);
    radio.addEventListener('change', () => { if (radio.checked) setActiveSourceId(s.id); });
    const del = document.createElement('button'); del.textContent = 'Remove'; Object.assign(del.style, { background:'#333', color:'#ddd', border:'1px solid rgba(255,255,255,0.16)', padding:'6px 10px', borderRadius:'8px', cursor:'pointer' });
    del.addEventListener('click', async ()=>{ if (s.isDefault) return; if (!confirm('Remove this source?')) return; try { await removeSource(s.id); await renderList(); } catch (e) { alert('Failed to remove'); } });
    row.append(name);
    if (s.isDefault) row.append(tag);
    row.append(radio);
    if (!s.isDefault) row.append(del);
    ul.appendChild(row);
  }
  wrap.appendChild(ul);
  // Divider
  const hr = document.createElement('div'); Object.assign(hr.style, { height: '1px', background: '#2a2a2a', margin: '10px 0' }); wrap.appendChild(hr);
  // Add form
  const form = document.createElement('form'); Object.assign(form.style, { display: 'grid', gridTemplateColumns: '1fr', gap: '8px' });
  const nameIn = document.createElement('input'); nameIn.placeholder = 'Name (optional)'; Object.assign(nameIn, { type:'text' }); Object.assign(nameIn.style, { background:'#111', color:'#eee', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'8px' });
  const urlIn = document.createElement('input'); urlIn.placeholder = 'Supabase URL (https://xxxxx.supabase.co)'; Object.assign(urlIn, { type:'url', required:true }); Object.assign(urlIn.style, { background:'#111', color:'#eee', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'8px' });
  const keyIn = document.createElement('input'); keyIn.placeholder = 'Anon public key'; Object.assign(keyIn, { type:'password', required:true }); Object.assign(keyIn.style, { background:'#111', color:'#eee', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'8px' });
  const addBtn = document.createElement('button'); addBtn.type = 'submit'; addBtn.textContent = 'Add Source'; Object.assign(addBtn.style, { background:'#333', color:'#ddd', border:'1px solid rgba(255,255,255,0.16)', padding:'8px 10px', borderRadius:'8px', cursor:'pointer', justifySelf:'end' });
  form.append(nameIn, urlIn, keyIn, addBtn);
  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      await addSource({ name: nameIn.value, url: urlIn.value, anonKey: keyIn.value });
      nameIn.value=''; urlIn.value=''; keyIn.value='';
      await renderList();
    } catch (err) { alert(err?.message || 'Failed to add'); }
    finally { addBtn.disabled = false; addBtn.textContent = 'Add Source'; }
  });
  wrap.appendChild(form);

  // Concise setup instructions
  const help = document.createElement('div');
  Object.assign(help.style, { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #2a2a2a', color: '#bbb', font: '12px/1.4 system-ui, sans-serif' });
  help.innerHTML = [
    '<div style="color:#eee; font-weight:600; margin-bottom:6px;">Set up a Supabase backend (concise)</div>',
    '<div>1) Create a Supabase project → copy its Project URL and anon public key (no service key).</div>',
    '<div>2) Storage: create a public bucket named <b>thumbs</b> (or configure another name here).</div>',
    '<div>3) Database: create table <b>community_scenes</b> with columns:</div>',
    '<div style="margin-left:10px">id uuid primary key default gen_random_uuid() • name text • json jsonb • thumb_url text • label text • created_at timestamptz default now()</div>',
    '<div>4) Policies (RLS): allow anon <b>select</b> and <b>insert</b> on <b>community_scenes</b>; allow public read on bucket; allow anon <b>insert</b> (and optional <b>delete</b>) on bucket for uploads/cleanup.</div>',
    '<div>5) Optional: set <b>label</b> = "SECRET" for Secret Space items. Password gate is client-side only.</div>',
    '<div style="margin-top:6px">Tip: Never paste a service key in the browser.</div>'
  ].join('');
  wrap.appendChild(help);

  // One-click SQL snippet
  const sqlBox = document.createElement('div');
  Object.assign(sqlBox.style, { marginTop: '8px', background:'#0f0f0f', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'8px', position:'relative' });
  const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy SQL'; Object.assign(copyBtn.style, { position:'absolute', right:'8px', top:'8px', background:'#333', color:'#ddd', border:'1px solid rgba(255,255,255,0.16)', padding:'4px 8px', borderRadius:'6px', cursor:'pointer' });
  const pre = document.createElement('pre'); pre.style.margin = '0'; pre.style.whiteSpace = 'pre-wrap'; pre.style.wordBreak = 'break-word'; pre.style.font = '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const sql = `-- Enable pgcrypto for gen_random_uuid (if not already)
create extension if not exists pgcrypto;

-- Community table
create table if not exists public.community_scenes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  json jsonb not null,
  thumb_url text,
  label text,
  created_at timestamptz not null default now()
);

-- Enable RLS and basic anon access (adjust as needed)
alter table public.community_scenes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='community_scenes' and policyname='Allow anon select') then
    create policy "Allow anon select" on public.community_scenes for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='community_scenes' and policyname='Allow anon insert') then
    create policy "Allow anon insert" on public.community_scenes for insert to anon with check (true);
  end if;
end $$;

-- Storage bucket policies (create bucket 'thumbs' in Storage UI)
-- Public read of objects in 'thumbs'
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Thumbs public read') then
    create policy "Thumbs public read" on storage.objects for select to anon using (bucket_id = 'thumbs');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Thumbs anon upload') then
    create policy "Thumbs anon upload" on storage.objects for insert to anon with check (bucket_id = 'thumbs');
  end if;
  -- Optional cleanup permission (delete)
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Thumbs anon delete (optional)') then
    create policy "Thumbs anon delete (optional)" on storage.objects for delete to anon using (bucket_id = 'thumbs');
  end if;
end $$;`;
  pre.textContent = sql;
  copyBtn.addEventListener('click', async ()=>{ try { await navigator.clipboard.writeText(sql); copyBtn.textContent = 'Copied'; setTimeout(()=>copyBtn.textContent='Copy SQL', 1200); } catch { } });
  sqlBox.append(copyBtn, pre);
  wrap.appendChild(sqlBox);
}

// Attach to floating button (no-op here; community.html handles popup motion)
export function attachFloating() {
  btn = document.getElementById('toSources');
}
