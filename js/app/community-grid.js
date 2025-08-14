// Community grid: same behavior as personal columbarium-grid, but reads from backend and uses magenta accent
import * as communityApi from './services/community-api.js';

const canvas = document.getElementById('communityGridStage');
const ctx = canvas.getContext('2d');
try { canvas.style.touchAction = 'none'; } catch {}

let offsetX = 0, offsetY = 0, scale = 1;
const MIN_SCALE = 0.4, MAX_SCALE = 2.5;
const CELL = 200, TILE_INSET = 12, MAJOR_EVERY = 5;
let tiles = []; const thumbCache = new Map();
let isPanning = false, panPointerId = null, startPanX = 0, startPanY = 0;
let expandedId = null, animStart = 0, isCollapsing = false; const ANIM_MS = 160;
let pulseIds = new Set(); // ids of tiles to subtly expand for trade
let tradeMode = false; let tradeJustId = null; let tradeToken = null;
let isPinching = false; const touchPoints = new Map(); let pinchStartDist = 0, pinchStartScale = 1, pinchStartCenter = {x:0,y:0};

function DPR(){ return Math.max(1, window.devicePixelRatio||1); }
function worldToScreen(wx, wy){ return { x: offsetX + wx*scale, y: offsetY + wy*scale }; }
function screenToWorld(sx, sy){ return { x: (sx - offsetX)/scale, y: (sy - offsetY)/scale }; }
function lerp(a,b,t){ return a + (b-a)*t; }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function formatDate(iso){
  try {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return ''; }
}

function resize(){
  const dpr = DPR();
  const vv = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport : null;
  const rect = canvas.getBoundingClientRect();
  const cssW = vv ? vv.width : rect.width;
  const cssH = vv ? vv.height : rect.height;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function centerOnTiles(){
  if (!tiles.length) return;
  let cx = 0, cy = 0; for (const t of tiles){ cx += t.x; cy += t.y; }
  cx /= tiles.length; cy /= tiles.length;
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  offsetX = vw/2 - cx * scale; offsetY = vh/2 - cy * scale;
}

function clear(){ const dpr = DPR(); ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); }

function drawGrid(){
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  const minor = 'rgba(255,0,255,0.18)';
  const major = 'rgba(255,0,255,0.45)';
  const step = CELL * scale; if (step <= 0.0001) return;
  const wmin = screenToWorld(0,0), wmax = screenToWorld(vw, vh);
  const startX = Math.floor(wmin.x / CELL) * CELL;
  const endX = Math.ceil(wmax.x / CELL) * CELL;
  const startY = Math.floor(wmin.y / CELL) * CELL;
  const endY = Math.ceil(wmax.y / CELL) * CELL;
  ctx.save();
  for (let gx = startX; gx <= endX; gx += CELL) {
    const sx = worldToScreen(gx, 0).x; const idx = Math.round(gx / CELL);
    const isMajor = (idx % MAJOR_EVERY === 0);
    ctx.strokeStyle = isMajor ? major : minor; ctx.lineWidth = isMajor ? 1.5 : 1.0;
    ctx.beginPath(); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, vh); ctx.stroke();
  }
  for (let gy = startY; gy <= endY; gy += CELL) {
    const sy = worldToScreen(0, gy).y; const idy = Math.round(gy / CELL);
    const isMajor = (idy % MAJOR_EVERY === 0);
    ctx.strokeStyle = isMajor ? major : minor; ctx.lineWidth = isMajor ? 1.5 : 1.0;
    ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(vw, sy + 0.5); ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
}

function drawButton(rect, label){
  ctx.save(); ctx.fillStyle = 'rgba(51,51,51,0.95)'; ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ddd'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w/2, rect.y + rect.h/2);
  ctx.restore();
}

function drawTiles(){
  const baseW = (CELL - TILE_INSET) * scale; const baseH = baseW;
  let expandedTile = null;
  for (const t of tiles) {
    const isExpanded = (expandedId === t.id); t.w = baseW; t.h = baseH; if (isExpanded) { expandedTile = t; continue; }
    const c = worldToScreen(t.x, t.y); const s = { x: c.x - baseW/2, y: c.y - baseH/2 };
    const slight = pulseIds.has(t.id) ? 1.06 : 1.0;
    const w = baseW * slight, h = baseH * slight; const dx = s.x - (w - baseW)/2, dy = s.y - (h - baseH)/2;
    const r = 16 * Math.max(0.75, scale);
    // Card
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
  roundRect(ctx, dx, dy, w, h, r); ctx.fillStyle = 'rgba(20,20,20,0.98)'; ctx.fill();
  // Emphasize trade picks with bright yellow, thicker outline
  if (pulseIds.has(t.id)) { ctx.strokeStyle = '#ffea00'; ctx.lineWidth = 3; }
  else { ctx.strokeStyle = 'rgba(255,0,255,0.50)'; ctx.lineWidth = 1.5; }
  ctx.stroke(); ctx.restore();
    // Thumb
    ctx.save(); roundRect(ctx, dx, dy, w, h, r); ctx.clip();
    const img = thumbCache.get(t.id);
    if (img && img.complete) {
      const ratio = Math.max(w / img.width, h / img.height);
      const iw = img.width * ratio, ih = img.height * ratio;
      const ix = dx + (w - iw) / 2, iy = dy + (h - ih) / 2;
      ctx.drawImage(img, ix, iy, iw, ih);
    } else { ctx.fillStyle = '#222'; ctx.fillRect(dx, dy, w, h); }
    // Name + date
    const gradH = Math.max(48 * scale, 36);
    const g = ctx.createLinearGradient(0, dy + h - gradH, 0, dy + h); g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(dx, dy + h - gradH, w, gradH);
    const name = t.name || 'Untitled';
    const dateStr = formatDate(t.created_at);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    const nameSize = Math.max(13, 13*scale);
    const dateSize = Math.max(11, 11*scale);
    ctx.fillStyle = '#fff'; ctx.font = `${nameSize}px system-ui, sans-serif`;
    ctx.fillText(name, dx + 10*scale, dy + h - Math.max(22*scale, 18));
    if (dateStr) {
      ctx.fillStyle = '#ddd'; ctx.font = `${dateSize}px system-ui, sans-serif`;
      ctx.fillText(dateStr, dx + 10*scale, dy + h - Math.max(8*scale, 6));
    }
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.restore();
  }
  // Empty state: draw a centered note mimicking personal page feel
  if (!tiles.length) {
    const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No community scenes yet', vw/2, vh/2 - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Upload from the editor to share yours', vw/2, vh/2 + 12);
    ctx.restore();
    return;
  }
  // Expanded overlay (static preview frame; no Preview button in community)
  if (expandedTile) {
    const now = performance.now(); const tAnim = Math.min(1, (now - animStart) / ANIM_MS); const k = easeOutCubic(tAnim); const prog = isCollapsing ? (1-k) : k;
    const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
    const c0 = worldToScreen(expandedTile.x, expandedTile.y); const fromW = baseW, fromH = baseH; const fromX = c0.x - fromW/2, fromY = c0.y - fromH/2;
    const pad = 40; const maxSize = Math.min(vw - pad*2, vh - pad*2); const targetSize = Math.max(fromW * 1.8, Math.min(maxSize, 520));
    const toW = targetSize, toH = targetSize; const toX = (vw - toW)/2, toY = (vh - toH)/2;
    const sX = lerp(fromX, toX, prog), sY = lerp(fromY, toY, prog), sW = lerp(fromW, toW, prog), sH = lerp(fromH, toH, prog);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 10; const r = 18; roundRect(ctx, sX, sY, sW, sH, r);
  ctx.fillStyle = 'rgba(20,20,20,0.98)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,0,255,0.40)'; ctx.lineWidth = 1.2; ctx.stroke();
    expandedTile.overlayRect = { x: sX, y: sY, w: sW, h: sH };
    // Static fallback (community.js handles live 3D preview overlay)
    ctx.save(); roundRect(ctx, sX, sY, sW, sH, r); ctx.clip(); const img = thumbCache.get(expandedTile.id);
    if (img && img.complete) {
      const ratio = Math.max(sW / img.width, sH / img.height); const w = img.width * ratio, h = img.height * ratio; const dx = sX + (sW - w)/2, dy = sY + (sH - h)/2; ctx.drawImage(img, dx, dy, w, h);
    } else { ctx.fillStyle = '#222'; ctx.fillRect(sX, sY, sW, sH); }
    const gradH2 = Math.min(96, Math.max(56, sH * 0.25)); const g2 = ctx.createLinearGradient(0, sY + sH - gradH2, 0, sY + sH); g2.addColorStop(0, 'rgba(0,0,0,0.0)'); g2.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = g2; ctx.fillRect(sX, sY + sH - gradH2, sW, gradH2);
    // Name + (optional) date in overlay footer
    ctx.fillStyle = '#fff'; ctx.font = '16px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    const ovName = expandedTile.name || 'Untitled';
    ctx.fillText(ovName, sX+14, sY+sH-16);
    ctx.shadowBlur = 0;
    const showAdd = !!(tradeMode && tradeToken && pulseIds.has(expandedTile.id));
    expandedTile.btnOpen = null;
    if (showAdd) {
      const btnW = 84, btnH = 30, by = sY + sH - btnH - 12, bxOpen = sX + sW - btnW - 12;
      expandedTile.btnOpen = { x: bxOpen, y: by, w: btnW, h: btnH };
      drawButton(expandedTile.btnOpen, 'Add');
    }
    ctx.restore(); ctx.restore(); if (tAnim < 1) requestAnimationFrame(draw);
  }
}

function draw(){ clear(); drawGrid(); drawTiles(); }

function tileAt(sx, sy){
  const baseW = (CELL - TILE_INSET) * scale; const baseH = baseW;
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]; const c = worldToScreen(t.x, t.y); const x = c.x - baseW/2, y = c.y - baseH/2;
    if (sx >= x && sx <= x + baseW && sy >= y && sy <= y + baseH) return t;
  }
  return null;
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); const delta = Math.sign(e.deltaY) * 0.1; const prev = scale; scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 - delta)));
  const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const wx = (mx - offsetX) / prev, wy = (my - offsetY) / prev; offsetX = mx - wx * scale; offsetY = my - wy * scale; draw();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect(); const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const isMiddle = (e.button === 1);
  if (isMiddle) {
    // Always pan with middle-click, even over a tile
    isPanning = true; panPointerId = e.pointerId; startPanX = sx - offsetX; startPanY = sy - offsetY; canvas.classList.add('grabbing'); return;
  }
  const t = tileAt(sx, sy);
  if (t) {
    if (tradeMode && tradeToken && pulseIds.size && !pulseIds.has(t.id)) { // only restrict when in active trade with token
      isPanning = true; panPointerId = e.pointerId; startPanX = sx - offsetX; startPanY = sy - offsetY; canvas.classList.add('grabbing'); return;
    }
    expandedId = t.id; animStart = performance.now(); isCollapsing = false; const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); }; run();
  } else { isPanning = true; panPointerId = e.pointerId; startPanX = sx - offsetX; startPanY = sy - offsetY; canvas.classList.add('grabbing'); }
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect(); const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (isPanning && panPointerId === e.pointerId) { offsetX = sx - startPanX; offsetY = sy - startPanY; draw(); return; }
});

canvas.addEventListener('pointerup', (e) => {
  if (isPanning && panPointerId === e.pointerId) { isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); }
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointercancel', () => { isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); });

canvas.addEventListener('click', (e) => {
  if (!expandedId) return; const rect = canvas.getBoundingClientRect(); const sx = e.clientX - rect.left, sy = e.clientY - rect.top; const t = tiles.find(tt => tt.id === expandedId); if (!t || !t.overlayRect) return;
  const { x, y, w, h } = t.overlayRect; const bxOpen = t.btnOpen;
  if (bxOpen && sx >= bxOpen.x && sx <= bxOpen.x + bxOpen.w && sy >= bxOpen.y && sy <= bxOpen.y + bxOpen.h) {
    // Add to personal collection: fetch full record then save locally
    (async () => { const rec = await communityApi.getCommunityScene(t.id).catch(()=>null); if (rec) {
      const local = await import('./local-store.js');
  // Require a one-time trade token regardless of URL params
  if (!tradeToken) { alert('Upload a scene to trade from the community.'); return; }
  await local.saveScene({ name: rec.name, json: rec.json, thumb: rec.thumb });
  try { sessionStorage.setItem('sketcher:lastTradePick', t.id); } catch {}
  try { sessionStorage.removeItem('sketcher:tradeToken'); } catch {}
  window.location.href = './columbarium.html';
    } })();
    return;
  }
  // Click outside buttons collapses
  const inside = (sx >= x && sx <= x + w && sy >= y && sy <= y + h);
  if (!inside) { isCollapsing = true; animStart = performance.now(); const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); else { expandedId = null; isCollapsing = false; draw(); } }; run(); }
});

async function loadTiles(){
  const items = await communityApi.listLatestCommunity(10).catch((e)=>{ console.warn('Community list failed', e); return []; });
  if (!Array.isArray(items) || items.length === 0) {
    console.info('No community scenes returned from backend.');
  }
  // Fixed 2 rows x 5 cols layout; align to grid cells exactly
  const cols = 5, rows = 2; const spacing = CELL;
  tiles = items.map((it, idx) => {
    const r = Math.floor(idx / cols); const c = idx % cols;
    return { id: it.id, name: it.name, created_at: it.created_at, x: (c * spacing) + CELL/2, y: (r * spacing) + CELL/2, w: CELL, h: CELL, thumb: it.thumb || null };
  });
  for (const t of tiles) {
    if (t.thumb && !thumbCache.has(t.id)) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { thumbCache.set(t.id, img); draw(); };
      img.onerror = () => { thumbCache.set(t.id, null); draw(); };
      img.src = t.thumb;
    }
    // If no backend thumbnail, generate one like the personal page for display
    if ((!t.thumb || t.thumb === '') && !thumbCache.has(t.id)) {
      (async () => {
        try {
          const rec = await communityApi.getCommunityScene(t.id);
          if (!rec || !rec.json) return;
          const mod = await import('./community.js');
          const dataUrl = await mod.generateSceneThumbnail(rec.json).catch(()=>null);
          if (!dataUrl) return;
          const img = new Image();
          img.onload = () => { thumbCache.set(t.id, img); draw(); };
          img.src = dataUrl;
        } catch {}
      })();
    }
  }
  if (tiles.length) centerOnTiles(); else { const rect2 = canvas.getBoundingClientRect(); offsetX = rect2.width * 0.5; offsetY = rect2.height * 0.4; }
}

window.addEventListener('resize', resize); if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
window.addEventListener('community:center', () => { centerOnTiles(); draw(); });
window.addEventListener('community:trade-picks', (e) => {
  try {
    const ids = Array.isArray(e.detail?.ids) ? e.detail.ids : [];
    if (ids.length) { pulseIds = new Set(ids); draw(); }
  } catch {}
});
// Parse trade intent
try { const qs = new URLSearchParams(location.search); tradeMode = (qs.get('trade') === '1'); tradeJustId = qs.get('just') || null; tradeToken = sessionStorage.getItem('sketcher:tradeToken'); } catch {}
resize(); loadTiles().then(()=>{ centerOnTiles(); draw(); });

// Trade flow: if URL has ?trade=1, highlight 3 random unique choices
(async () => {
  try {
  if (tradeMode && tradeToken) {
      // Ensure tiles are loaded first (poll briefly)
      const start = performance.now();
      while (tiles.length === 0 && performance.now() - start < 2000) {
        await new Promise(r => setTimeout(r, 50));
      }
      const ids = tiles.map(t => t.id);
      // Exclude the just uploaded id from picks (if present), then sample 3
      const pool = ids.filter(id => id !== tradeJustId);
      // Fallback to any if not enough
      const src = pool.length >= 3 ? pool : ids;
      const shuffled = src.slice(); for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      pulseIds = new Set(shuffled.slice(0, 3));
      draw();
    }
  } catch {}
})();
