// Secret Space panel controller: prompt for password, then list Secret items in a side panel
import * as communityApi from './services/community-api.js';

const btn = document.getElementById('secretAccessBtn');
const panel = document.getElementById('secretPanel');
const closeBtn = document.getElementById('secretClose');
const listEl = document.getElementById('secretList');

function setOpen(on){ if (!panel) return; panel.classList.toggle('open', !!on); if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }

async function ensurePassword(){
  try {
    const cached = sessionStorage.getItem('sketcher:secret:ok') || sessionStorage.getItem('sketcher:ffe:ok');
    if (cached === '1') return true;
  } catch {}
  const pwd = prompt('Enter Secret Space upload password to view this collection:','');
  if (pwd && pwd === 'CLINT') {
    try { sessionStorage.setItem('sketcher:secret:ok','1'); } catch {}
    // Also set legacy key for back-compat with older tabs
    try { sessionStorage.setItem('sketcher:ffe:ok','1'); } catch {}
    try { window.dispatchEvent(new Event('secret:unlocked')); } catch {}
    // Fire legacy event too
    try { window.dispatchEvent(new Event('ffe:unlocked')); } catch {}
    return true;
  }
  alert('Incorrect password.');
  return false;
}

function card(rec){
  const el = document.createElement('div'); el.className = 'secret-card';
  const img = document.createElement('img'); img.alt = rec.name || 'Untitled';
  if (rec.thumb) img.src = rec.thumb; else img.style.background = '#222';
  const meta = document.createElement('div'); meta.className='meta';
  const name = document.createElement('div'); name.className='name'; name.textContent = rec.name || 'Untitled';
  const dl = document.createElement('button'); dl.textContent = 'Download';
  dl.addEventListener('click', async () => {
    try {
      const full = await communityApi.getCommunityScene(rec.id);
      const { saveScene } = await import('./local-store.js');
      const newId = await saveScene({ name: full.name, json: full.json, thumb: full.thumb });
      try { sessionStorage.setItem('sketcher:newSceneId', newId); } catch {}
      window.location.href = './columbarium.html';
    } catch (e) { console.error(e); alert('Failed to download.'); }
  });
  meta.append(name, dl);
  el.append(img, meta);
  return el;
}

async function loadSecret(){
  try {
    if (!listEl) return;
    listEl.innerHTML = '';
    const items = await communityApi.listLatestCommunity(20, { group: 'SECRET' });
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div'); empty.textContent = 'No Secret Space items yet.'; empty.style.color = '#aaa'; empty.style.padding = '10px';
      listEl.appendChild(empty); return;
    }
    for (const it of items) listEl.appendChild(card(it));
  } catch (e) { console.warn('Secret Space list failed', e); }
}

function wire(){
  if (btn) btn.addEventListener('click', async () => {
    const ok = await ensurePassword(); if (!ok) return;
    setOpen(panel && !panel.classList.contains('open'));
    if (panel && panel.classList.contains('open')) loadSecret();
  });
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
}

wire();
