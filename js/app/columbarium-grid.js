import * as localStore from './local-store.js';

// Pannable/zoomable 2D grid with draggable tiles representing scenes
const canvas = document.getElementById('gridStage');
const ctx = canvas.getContext('2d');

// View transform (world -> screen: x' = offsetX + x*scale)
let offsetX = 0, offsetY = 0;
let scale = 1;
const MIN_SCALE = 0.4, MAX_SCALE = 2.5;

// Grid metrics
const CELL = 200;              // base cell size in px at scale=1
const TILE_INSET = 12;         // tile inset from cell boundaries
const MAJOR_EVERY = 4;         // darker line every n cells

// Overlay state
let expandedId = null;         // id of expanded tile (overlay)
let animStart = 0;             // animation start time
const ANIM_MS = 160;           // duration
let isCollapsing = false;      // direction flag

// Input/drag state
let isPanning = false; let startPanX = 0, startPanY = 0; let panPointerId = null;
let dragTile = null; let pointerDownPos = null; let dragCenterDelta = { x: 0, y: 0 };

// Tiles cache
let tiles = [];
const thumbCache = new Map(); // id -> HTMLImageElement

// ---------- Math and helpers ----------
function DPR(){ return Math.max(1, window.devicePixelRatio || 1); }
function worldToScreen(wx, wy){ return { x: offsetX + wx * scale, y: offsetY + wy * scale }; }
function screenToWorld(sx, sy){ return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale }; }
function lerp(a, b, t){ return a + (b - a) * t; }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function resize(){
  const dpr = DPR();
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  draw();
}

function anyTileVisible(){
  if (!tiles.length) return false;
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  const tileW = (CELL - TILE_INSET) * scale; const tileH = tileW;
  for (const t of tiles) {
    const c = worldToScreen(t.x, t.y);
    const x = c.x - tileW/2, y = c.y - tileH/2;
    if (x < vw && x + tileW > 0 && y < vh && y + tileH > 0) return true;
  }
  return false;
}

function centerOnTiles(){
  if (!tiles.length) return;
  // Center the view on the centroid of tiles without changing scale
  let cx = 0, cy = 0; for (const t of tiles){ cx += t.x; cy += t.y; }
  cx /= tiles.length; cy /= tiles.length;
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  offsetX = vw/2 - cx * scale; offsetY = vh/2 - cy * scale;
}

// ---------- Drawing ----------
function clear(){
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  ctx.clearRect(0, 0, vw, vh);
}

function drawGrid(){
  const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;
  // grid colors
  const minor = 'rgba(255,255,255,0.06)';
  const major = 'rgba(255,255,255,0.12)';
  const step = CELL * scale;
  if (step <= 0.0001) return;
  // world bounds currently visible
  const wmin = screenToWorld(0, 0), wmax = screenToWorld(vw, vh);
  const startX = Math.floor(wmin.x / CELL) * CELL;
  const endX = Math.ceil(wmax.x / CELL) * CELL;
  const startY = Math.floor(wmin.y / CELL) * CELL;
  const endY = Math.ceil(wmax.y / CELL) * CELL;
  ctx.save();
  // vertical lines
  for (let gx = startX; gx <= endX; gx += CELL) {
    const sx = worldToScreen(gx, 0).x;
    const idx = Math.round(gx / CELL);
    ctx.strokeStyle = (idx % MAJOR_EVERY === 0) ? major : minor;
    ctx.beginPath(); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, vh); ctx.stroke();
  }
  // horizontal lines
  for (let gy = startY; gy <= endY; gy += CELL) {
    const sy = worldToScreen(0, gy).y;
    const idy = Math.round(gy / CELL);
    ctx.strokeStyle = (idy % MAJOR_EVERY === 0) ? major : minor;
    ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(vw, sy + 0.5); ctx.stroke();
  }
  ctx.restore();
}

function drawTiles(){
  const baseW = (CELL - TILE_INSET) * scale;
  const baseH = baseW;
  let expandedTile = null;

  // Pass 1: draw non-expanded tiles in world space
  for (const t of tiles) {
    const isExpanded = (expandedId === t.id);
    t.w = baseW; t.h = baseH; // screen-space for hit-testing
    if (isExpanded) { expandedTile = t; t.btnRemove = null; t.btnOpen = null; t.nameRect = null; continue; }

    const c = worldToScreen(t.x, t.y);
    const s = { x: c.x - baseW/2, y: c.y - baseH/2 };
    const r = 16 * Math.max(0.75, scale);

    // Card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
    roundRect(ctx, s.x, s.y, baseW, baseH, r);
    ctx.fillStyle = 'rgba(20,20,20,0.98)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // Content
    ctx.save();
    roundRect(ctx, s.x, s.y, baseW, baseH, r); ctx.clip();
    const nameBarH = Math.max(36 * scale, 28);
    const previewH = baseH - nameBarH;
    const img = thumbCache.get(t.id);
    if (img && img.complete) {
      const destW = baseW, destH = previewH;
      const ratio = Math.max(destW / img.width, destH / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      const dx = s.x + (destW - w) / 2;
      const dy = s.y + (destH - h) / 2;
      ctx.drawImage(img, dx, dy, w, h);
    } else {
      ctx.fillStyle = '#222'; ctx.fillRect(s.x, s.y, baseW, previewH);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + baseW, s.y + previewH);
      ctx.moveTo(s.x + baseW, s.y); ctx.lineTo(s.x, s.y + previewH); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(18,18,18,0.96)';
    ctx.fillRect(s.x, s.y + previewH, baseW, nameBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(s.x, s.y + previewH + 0.5); ctx.lineTo(s.x + baseW, s.y + previewH + 0.5); ctx.stroke();

    // Name
    const name = (t.name || 'Untitled').replace(/^gallery:/,'');
    ctx.fillStyle = '#fff'; ctx.font = `${Math.max(12, 12*scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(name, s.x + 12*scale, s.y + previewH + nameBarH/2);

    // Delete X
    const xSize = Math.max(18 * scale, 14);
    t.btnRemove = { x: s.x + baseW - xSize - 8*scale, y: s.y + 8*scale, w: xSize, h: xSize };
    drawDeleteX(t.btnRemove);

    ctx.restore();
  }

  // Empty state
  if (!tiles.length) {
    const dpr = DPR(); const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No scenes yet', w/2, h/2 - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Use "Import Scene JSON" to add one', w/2, h/2 + 10);
    ctx.restore();
  }

  // Pass 2: draw expanded overlay in screen space (no grid zoom)
  if (expandedTile) {
    const now = performance.now();
    const tAnim = Math.min(1, (now - animStart) / ANIM_MS);
    const k = easeOutCubic(tAnim);
    const prog = isCollapsing ? (1 - k) : k;
    const dpr = DPR(); const vw = canvas.width / dpr, vh = canvas.height / dpr;

    // From = tile rect in screen space
    const c0 = worldToScreen(expandedTile.x, expandedTile.y);
    const fromW = baseW, fromH = baseH;
    const fromX = c0.x - fromW/2, fromY = c0.y - fromH/2;
    // To = centered rect with padding
    const pad = 40;
    const maxSize = Math.min(vw - pad*2, vh - pad*2);
    const targetSize = Math.max(fromW * 1.8, Math.min(maxSize, 520));
    const toW = targetSize, toH = targetSize;
    const toX = (vw - toW) / 2, toY = (vh - toH) / 2;

    // Interpolate rect
    const sX = lerp(fromX, toX, prog);
    const sY = lerp(fromY, toY, prog);
    const sW = lerp(fromW, toW, prog);
    const sH = lerp(fromH, toH, prog);

    // Overlay card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
    const r = 18;
    roundRect(ctx, sX, sY, sW, sH, r);
    ctx.fillStyle = 'rgba(20,20,20,0.98)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();

    // Content
    ctx.save(); roundRect(ctx, sX, sY, sW, sH, r); ctx.clip();
    const nameBarH2 = 40; const previewH2 = sH - nameBarH2;
    const img = thumbCache.get(expandedTile.id);
    if (img && img.complete) {
      const ratio = Math.max(sW / img.width, previewH2 / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      const dx = sX + (sW - w) / 2; const dy = sY + (previewH2 - h) / 2;
      ctx.drawImage(img, dx, dy, w, h);
    } else { ctx.fillStyle = '#222'; ctx.fillRect(sX, sY, sW, previewH2); }

    // Name bar
    ctx.fillStyle = 'rgba(18,18,18,0.96)'; ctx.fillRect(sX, sY + previewH2, sW, nameBarH2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(sX, sY + previewH2 + 0.5); ctx.lineTo(sX + sW, sY + previewH2 + 0.5); ctx.stroke();
    const name2 = (expandedTile.name || 'Untitled').replace(/^gallery:/,'');
    ctx.fillStyle = '#fff'; ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(name2, sX + 12, sY + previewH2 + nameBarH2/2);

    // Buttons (screen space)
    const btnW = 80, btnH = 30; const bx = sX + sW - btnW - 12; const by = sY + sH - btnH - 12;
    expandedTile.btnOpen = { x: bx, y: by, w: btnW, h: btnH };
    drawButton(expandedTile.btnOpen, 'Open');
    expandedTile.nameRect = { x: sX + 8, y: sY + sH - nameBarH2, w: sW - btnW - 24, h: nameBarH2 };
    expandedTile.overlayRect = { x: sX, y: sY, w: sW, h: sH };
    ctx.restore();
    ctx.restore();

    if (tAnim < 1) requestAnimationFrame(draw);
  } else {
    tiles.forEach(t => { t.overlayRect = null; t.btnOpen = null; t.nameRect = null; });
  }

  // HUD
  const dpr2 = DPR(); const w2 = canvas.width / dpr2, h2 = canvas.height / dpr2;
  ctx.save();
  const text = `Tiles: ${tiles.length}`; ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width; const hudPad = 8, hudH = 24, hudW = tw + hudPad*2;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(8, h2 - hudH - 8, hudW, hudH);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 8 + hudPad, h2 - hudH/2 - 8);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function drawButton(rect, label){
  ctx.save();
  ctx.fillStyle = 'rgba(51,51,51,0.95)';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  const r = 8; // fixed-radius for screen-space button
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ddd';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w/2, rect.y + rect.h/2);
  ctx.restore();
}

function drawDeleteX(rect){
  ctx.save();
  const r = 6 * Math.max(0.75, scale);
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fillStyle = 'rgba(51,51,51,0.95)';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(rect.x + 5*scale, rect.y + 5*scale);
  ctx.lineTo(rect.x + rect.w - 5*scale, rect.y + rect.h - 5*scale);
  ctx.moveTo(rect.x + rect.w - 5*scale, rect.y + 5*scale);
  ctx.lineTo(rect.x + 5*scale, rect.y + rect.h - 5*scale);
  ctx.stroke();
  ctx.restore();
}

function draw(){
  if (!canvas.width || !canvas.height) return;
  if (tiles.length && !anyTileVisible()) centerOnTiles();
  clear();
  drawGrid();
  drawTiles();
}

// ---------- Interaction ----------
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  const oldScale = scale;
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
  if (newScale === scale) return;
  // zoom around cursor
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx = (mx - offsetX) / oldScale;
  const wy = (my - offsetY) / oldScale;
  scale = newScale;
  offsetX = mx - wx * scale;
  offsetY = my - wy * scale;
  draw();
}, { passive: false });

canvas.addEventListener('pointerdown', async (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  pointerDownPos = { x, y };

  // Middle-click always pans, regardless of what's under the cursor
  if (e.button === 1) {
    e.preventDefault();
    isPanning = true; panPointerId = e.pointerId; startPanX = x - offsetX; startPanY = y - offsetY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grabbing');
    return;
  }

  // Overlay interactions first
  if (expandedId) {
    const t = tiles.find(tt => tt.id === expandedId);
    if (t) {
      const o = t.overlayRect;
      if (o) {
        // Open button
        if (t.btnOpen && x>=t.btnOpen.x && x<=t.btnOpen.x+t.btnOpen.w && y>=t.btnOpen.y && y<=t.btnOpen.y+t.btnOpen.h) {
          const url = new URL('./index.html', location.href);
          url.searchParams.set('sceneId', t.id);
          document.body.classList.add('page-leave');
          setTimeout(()=>{ window.location.href = url.toString(); }, 180);
          return;
        }
        // Rename hotspot
        if (t.nameRect && x>=t.nameRect.x && x<=t.nameRect.x+t.nameRect.w && y>=t.nameRect.y && y<=t.nameRect.y+t.nameRect.h) {
          const newName = prompt('Rename scene:', t.name || 'Untitled');
          if (newName && newName.trim().length) { await localStore.updateSceneName(t.id, { name: newName.trim() }); await loadTiles(); draw(); }
          return;
        }
        // Inside overlay: treat as potential toggle on pointerup (left-click only)
        if (e.button === 0 && x>=o.x && x<=o.x+o.w && y>=o.y && y<=o.y+o.h) {
          dragTile = t; canvas.setPointerCapture(e.pointerId); return;
        }
      }
      // Clicked outside the overlay -> collapse
      isCollapsing = true; animStart = performance.now();
      const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); else { expandedId = null; isCollapsing = false; draw(); } }; run();
      return;
    }
  }

  // Hit test tiles (topmost first)
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    const c = worldToScreen(t.x, t.y); const x0 = c.x - t.w/2, y0 = c.y - t.h/2;
    if (x >= x0 && x <= x0 + t.w && y >= y0 && y <= y0 + t.h) {
      // Delete button
      if (t.btnRemove && x>=t.btnRemove.x && x<=t.btnRemove.x+t.btnRemove.w && y>=t.btnRemove.y && y<=t.btnRemove.y+t.btnRemove.h) {
        const ok = confirm('Delete this scene?');
        if (ok) { await localStore.deleteScene(t.id); await loadTiles(); draw(); }
        return;
      }
      // Start potential drag/snap
      if (e.button === 0) {
        dragTile = t; const pw = screenToWorld(x, y); dragCenterDelta.x = pw.x - t.x; dragCenterDelta.y = pw.y - t.y; canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
  }

  // Otherwise start panning on empty space (left-drag also pans if not on tile)
  if (e.button === 0) {
    isPanning = true; panPointerId = e.pointerId; startPanX = x - offsetX; startPanY = y - offsetY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing');
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isPanning && !dragTile) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  if (dragTile) {
    if (expandedId && expandedId === dragTile.id) { /* expanded overlay: don't drag */ return; }
    const pw = screenToWorld(x, y);
    const desiredCx = pw.x - dragCenterDelta.x;
    const desiredCy = pw.y - dragCenterDelta.y;
    const gx = Math.floor(desiredCx / CELL) * CELL + CELL/2;
    const gy = Math.floor(desiredCy / CELL) * CELL + CELL/2;
    dragTile.x = gx; dragTile.y = gy; draw();
  } else if (isPanning && (panPointerId === e.pointerId)) {
    offsetX = x - startPanX; offsetY = y - startPanY; draw();
  }
});

canvas.addEventListener('pointerup', async (e) => {
  if (dragTile) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const moved = pointerDownPos && (Math.hypot(x - pointerDownPos.x, y - pointerDownPos.y) > 6);
    if (!moved) {
      // Toggle expand/collapse
      if (expandedId && expandedId === dragTile.id) {
        isCollapsing = true; animStart = performance.now();
        const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); else { expandedId = null; isCollapsing = false; draw(); } }; run();
      } else {
        isCollapsing = false; expandedId = dragTile.id; animStart = performance.now();
        const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); }; run();
      }
    } else {
      await localStore.updateScenePosition(dragTile.id, { posX: dragTile.x, posY: dragTile.y });
    }
    dragTile = null;
  }
  if (isPanning && (panPointerId === e.pointerId)) { isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); }
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointercancel', () => { dragTile = null; isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); });

// ---------- Data loading ----------
async function loadTiles(){
  const list = await localStore.listScenes().catch(()=>[]);
  tiles = list.map((s, idx) => ({
    id: s.id,
    name: s.name,
    x: Number.isFinite(s.posX) ? s.posX : (((idx % 3) * CELL * 1.4) + CELL/2),
    y: Number.isFinite(s.posY) ? s.posY : ((Math.floor(idx / 3) * CELL * 1.4) + CELL/2),
    w: CELL, h: CELL,
    thumb: s.thumb || null,
  }));
  // Thumbnails
  tiles.forEach(t => {
    if (t.thumb && !thumbCache.has(t.id)) {
      const img = new Image();
      img.onload = () => { thumbCache.set(t.id, img); draw(); };
      img.src = t.thumb;
    }
  });
  if (tiles.length) centerOnTiles();
  else {
    const rect2 = canvas.getBoundingClientRect();
    offsetX = rect2.width * 0.5; offsetY = rect2.height * 0.4;
  }
}

// Optional: external preview hook
window.addEventListener('columbarium:preview', async (e) => {
  const { id } = e.detail || {}; if (!id) return;
  const mod = await import('./columbarium.js');
  if (mod && mod.openPreviewById) mod.openPreviewById(id);
  else alert('Preview not available');
});

// ---------- Wiring ----------
window.addEventListener('resize', resize);
window.addEventListener('columbarium:refresh', async ()=>{ await loadTiles(); draw(); });
window.addEventListener('columbarium:center', () => { centerOnTiles(); draw(); });
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'r') { centerOnTiles(); draw(); } });
window.addEventListener('columbarium:resetView', () => { scale = 1; centerOnTiles(); draw(); });

resize();
loadTiles().then(draw);
