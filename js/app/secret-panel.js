// Secret Space panel controller: prompt for password, then list Secret items in a side panel
import * as communityApi from './services/community-api.js';
import { getActiveSourceId } from './ui/sources.js';

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
  const full = await communityApi.getCommunityScene(rec.id, { sourceId: getActiveSourceId() });
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
  const items = await communityApi.listLatestCommunity(20, { group: 'SECRET', sourceId: getActiveSourceId() });
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div'); empty.textContent = 'No Secret Space items yet.'; empty.style.color = '#aaa'; empty.style.padding = '10px';
      listEl.appendChild(empty); return;
    }
    for (const it of items) listEl.appendChild(card(it));
  } catch (e) { console.warn('Secret Space list failed', e); }
}

function wire(){
  // Render bulb icon and state
  const renderBulb = () => {
    if (!btn) return;
    const ok = (()=>{ try { return (sessionStorage.getItem('sketcher:secret:ok') === '1') || (sessionStorage.getItem('sketcher:ffe:ok') === '1'); } catch { return false; } })();
    btn.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.style.width='24px'; svg.style.height='24px';
    const body = document.createElementNS('http://www.w3.org/2000/svg','path'); body.setAttribute('d','M12 2c-3.866 0-7 3.134-7 7 0 2.207 1.024 4.169 2.62 5.44.58.463 1.08 1.373 1.08 2.06V18h6v-.5c0-.687.5-1.597 1.08-2.06C17.976 13.169 19 11.207 19 9c0-3.866-3.134-7-7-7z');
    const base = document.createElementNS('http://www.w3.org/2000/svg','path'); base.setAttribute('d','M9 19h6M9.5 21h5'); base.setAttribute('fill','none'); base.setAttribute('stroke-linecap','round'); base.setAttribute('stroke-width','2');
    if (ok) { body.setAttribute('fill','#ffeb3b'); body.setAttribute('stroke','#ffeb3b'); body.setAttribute('stroke-width','1.5'); base.setAttribute('stroke','#ffeb3b'); }
    else { body.setAttribute('fill','none'); body.setAttribute('stroke','#888'); body.setAttribute('stroke-width','2'); base.setAttribute('stroke','#888'); }
    svg.appendChild(body); svg.appendChild(base); btn.appendChild(svg);
    btn.title = ok ? 'Secret Space (unlocked)' : 'Secret Space (locked)';
  };
  renderBulb();
  window.addEventListener('storage', (e)=>{ if (e.key === 'sketcher:secret:ok' || e.key === 'sketcher:ffe:ok') renderBulb(); });
  if (btn) btn.addEventListener('click', async () => {
    const wasUnlocked = (()=>{ try { return (sessionStorage.getItem('sketcher:secret:ok') === '1') || (sessionStorage.getItem('sketcher:ffe:ok') === '1'); } catch { return false; } })();
    const ok = await ensurePassword(); if (!ok) return;
    // Only toggle panel if it was already unlocked; unlocking shouldn’t auto-open
    if (wasUnlocked) {
      setOpen(panel && !panel.classList.contains('open'));
      if (panel && panel.classList.contains('open')) loadSecret();
    }
    // reflect bulb state and ask grid to refresh header visibility
    renderBulb();
    try { window.dispatchEvent(new Event('secret:unlocked')); } catch {}
  });
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
}

wire();
