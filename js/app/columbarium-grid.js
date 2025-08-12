import * as localStore from './local-store.js';

// Pannable/zoomable 2D grid with draggable tiles representing scenes
const canvas = document.getElementById('gridStage');
const ctx = canvas.getContext('2d');

// View transform
let offsetX = 0, offsetY = 0; // world origin to screen
let scale = 1; // zoom
const MIN_SCALE = 0.4, MAX_SCALE = 2.5;

// Grid metrics
const CELL = 200; // base cell size in px at scale=1 (tic-tac-toe-like cells)
const TILE_INSET = 12; // slight inset inside cell
const MAJOR_EVERY = 4; // dark grid every n cells

// Drag state
let isPanning = false; let startPanX = 0, startPanY = 0; let panPointerId = null;
let dragTile = null; let dragStart = { x: 0, y: 0 }; let pointerDownPos = null; let dragCenterDelta = { x: 0, y: 0 };

// Tiles cache [{id,name,x,y, w,h}]
let tiles = [];
const thumbCache = new Map(); // id -> HTMLImageElement

// Utilities
function centerOnTiles() {
  if (!tiles.length) return;
  const rect = canvas.getBoundingClientRect();
  const half = (CELL - TILE_INSET) / 2;
  const minX = Math.min(...tiles.map(t=>t.x - half));
  const minY = Math.min(...tiles.map(t=>t.y - half));
  const maxX = Math.max(...tiles.map(t=>t.x + half));
  const maxY = Math.max(...tiles.map(t=>t.y + half));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  offsetX = (rect.width / 2) - cx * scale;
  offsetY = (rect.height / 2) - cy * scale;
}

function anyTileVisible() {
  if (!tiles.length) return false;
  const dpr = DPR();
  const w = canvas.width / dpr, h = canvas.height / dpr;
  const tl = screenToWorld(0,0);
  const br = screenToWorld(w,h);
  const vx0 = Math.min(tl.x, br.x), vy0 = Math.min(tl.y, br.y);
  const vx1 = Math.max(tl.x, br.x), vy1 = Math.max(tl.y, br.y);
  return tiles.some(t => {
  const half = (CELL - TILE_INSET) / 2;
  const x0 = t.x - half, y0 = t.y - half;
  const x1 = t.x + half, y1 = t.y + half;
    return x0 < vx1 && x1 > vx0 && y0 < vy1 && y1 > vy0;
  });
}
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  const dpr = DPR();
  // Use CSS width/height from style; fall back to viewport
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function worldToScreen(x, y){ return { x: x * scale + offsetX, y: y * scale + offsetY }; }
function screenToWorld(x, y){ return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }; }

function drawGrid() {
  const { width, height } = canvas;
  const dpr = DPR();
  // Use CSS pixels
  const w = width / dpr, h = height / dpr;
  const minorAlpha = 0.12, majorAlpha = 0.28;
  ctx.save();
  // Fill base background
  ctx.fillStyle = '#111';
  ctx.fillRect(0,0,w,h);
  // Compute visible world bounds
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);
  const minWX = Math.min(topLeft.x, bottomRight.x);
  const maxWX = Math.max(topLeft.x, bottomRight.x);
  const minWY = Math.min(topLeft.y, bottomRight.y);
  const maxWY = Math.max(topLeft.y, bottomRight.y);
  // Determine integer grid indices
  const startGX = Math.floor(minWX / CELL);
  const endGX = Math.ceil(maxWX / CELL);
  const startGY = Math.floor(minWY / CELL);
  const endGY = Math.ceil(maxWY / CELL);
  // Draw minor lines
  ctx.strokeStyle = `rgba(255,255,255,${minorAlpha})`;
  ctx.lineWidth = 1;
  for (let gx = startGX; gx <= endGX; gx++) {
    const wx = gx * CELL;
    const sx = worldToScreen(wx, 0).x;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }
  for (let gy = startGY; gy <= endGY; gy++) {
    const wy = gy * CELL;
    const sy = worldToScreen(0, wy).y;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }
  // Draw major lines overlay
  ctx.strokeStyle = `rgba(255,255,255,${majorAlpha})`;
  ctx.lineWidth = 1.2;
  for (let gx = startGX; gx <= endGX; gx++) {
    if (gx % MAJOR_EVERY !== 0) continue;
    const wx = gx * CELL;
    const sx = worldToScreen(wx, 0).x;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }
  for (let gy = startGY; gy <= endGY; gy++) {
    if (gy % MAJOR_EVERY !== 0) continue;
    const wy = gy * CELL;
    const sy = worldToScreen(0, wy).y;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }
  // Edge fade vignette
  const grad = ctx.createLinearGradient(0,0,0,20);
  ctx.fillStyle = '#000';
  // top
  let g = ctx.createLinearGradient(0,0,0,120);
  g.addColorStop(0,'rgba(17,17,17,1)'); g.addColorStop(1,'rgba(17,17,17,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,w,140);
  // bottom
  g = ctx.createLinearGradient(0, h-140, 0, h);
  g.addColorStop(0,'rgba(17,17,17,0)'); g.addColorStop(1,'rgba(17,17,17,1)');
  ctx.fillStyle = g; ctx.fillRect(0,h-140,w,140);
  // left
  g = ctx.createLinearGradient(0,0,140,0);
  g.addColorStop(0,'rgba(17,17,17,1)'); g.addColorStop(1,'rgba(17,17,17,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,140,h);
  // right
  g = ctx.createLinearGradient(w-140,0,w,0);
  g.addColorStop(0,'rgba(17,17,17,0)'); g.addColorStop(1,'rgba(17,17,17,1)');
  ctx.fillStyle = g; ctx.fillRect(w-140,0,140,h);
  ctx.restore();
}

function drawTiles() {
  const cardPad = 14;
  // Card size roughly one cell wide to echo tic-tac-toe feel
  // Slight inset; cards are centered at t.x/t.y (cell center)
  const tileW = (CELL - TILE_INSET) * scale;
  const tileH = (CELL - TILE_INSET) * scale; // square card
  ctx.save();
  // Update current w/h so visibility math uses correct sizes
  tiles.forEach(t => { t.w = tileW; t.h = tileH; });
  tiles.forEach(t => {
    const c = worldToScreen(t.x, t.y); // center
    const s = { x: c.x - tileW/2, y: c.y - tileH/2 };
  // Card shadow + rounded square background
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
    const r = 16 * scale;
  roundRect(ctx, s.x, s.y, tileW, tileH, r);
    ctx.fillStyle = 'rgba(20,20,20,0.98)';
    ctx.fill();
  // Subtle border to pop against dark grid
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
    ctx.restore();
    // Full-bleed preview area (top) with clip to rounded card
    ctx.save();
    roundRect(ctx, s.x, s.y, tileW, tileH, r);
    ctx.clip();
  const nameBarH = Math.max(36 * scale, 28);
    const previewH = tileH - nameBarH;
    // Draw preview image if available
    const img = thumbCache.get(t.id);
    if (img && img.complete) {
      // cover-fit the image into the preview rect
      const destX = s.x, destY = s.y, destW = tileW, destH = previewH;
      const ratio = Math.max(destW / img.width, destH / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      const dx = destX + (destW - w) / 2;
      const dy = destY + (destH - h) / 2;
      ctx.drawImage(img, dx, dy, w, h);
    } else {
      // visible placeholder
      ctx.fillStyle = '#222';
      ctx.fillRect(s.x, s.y, tileW, previewH);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      // diagonal hint
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + tileW, s.y + previewH);
      ctx.moveTo(s.x + tileW, s.y);
      ctx.lineTo(s.x, s.y + previewH);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }
    // Name bar
    ctx.fillStyle = 'rgba(18,18,18,0.96)';
    ctx.fillRect(s.x, s.y + previewH, tileW, nameBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(s.x, s.y + previewH + 0.5); ctx.lineTo(s.x + tileW, s.y + previewH + 0.5); ctx.stroke();
    // Name text
    const name = (t.name || 'Untitled').replace(/^gallery:/,'');
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(12, 12*scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(name, s.x + 12*scale, s.y + previewH + nameBarH/2);
  // Small corner delete "x" and title text; click card to preview
  const xSize = Math.max(18 * scale, 14);
  t.btnRemove = { x: s.x + tileW - xSize - 8*scale, y: s.y + 8*scale, w: xSize, h: xSize };
  drawDeleteX(t.btnRemove);
    ctx.restore();
  });
  // Empty state hint
  if (!tiles.length) {
    const dpr = DPR();
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No scenes yet', w/2, h/2 - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Use "Import Scene JSON" to add one', w/2, h/2 + 10);
    ctx.restore();
  }
  // HUD: bottom-left
  const dpr2 = DPR();
  const w2 = canvas.width / dpr2, h2 = canvas.height / dpr2;
  ctx.save();
  const text = `Tiles: ${tiles.length}`;
  ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const hudPad = 8, hudH = 24, hudW = tw + hudPad*2;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(8, h2 - hudH - 8, hudW, hudH);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 8 + hudPad, h2 - hudH/2 - 8);
  ctx.restore();
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
  const r = 8 * scale;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ddd';
  ctx.font = `${Math.max(11, 11*scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w/2, rect.y + rect.h/2);
  ctx.restore();
}

function drawDeleteX(rect){
  ctx.save();
  const r = 6 * scale;
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
  // If tiles exist but none are visible, recentre
  if (tiles.length && !anyTileVisible()) centerOnTiles();
  drawGrid();
  drawTiles();
}

// Interaction
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015); // smooth exponential zoom
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
  // hit test buttons or tiles
  for (let i = tiles.length-1; i >= 0; i--) {
    const t = tiles[i];
  const s = worldToScreen(t.x - (CELL - TILE_INSET)/2, t.y - (CELL - TILE_INSET)/2);
    if (x >= s.x && x <= s.x + t.w && y >= s.y && y <= s.y + t.h) {
      // Delete X
      if (t.btnRemove && x>=t.btnRemove.x && x<=t.btnRemove.x+t.btnRemove.w && y>=t.btnRemove.y && y<=t.btnRemove.y+t.btnRemove.h) {
        const ok = confirm('Delete this scene?');
        if (ok) {
          await localStore.deleteScene(t.id);
          await loadTiles();
          draw();
        }
        return;
      }
      // Left-click preview, drag with hold
      if (e.button === 0) {
        // Distinguish click vs drag on pointerup; capture center delta
        dragTile = t; const pw = screenToWorld(x, y); dragCenterDelta.x = pw.x - t.x; dragCenterDelta.y = pw.y - t.y;
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
  }
  // otherwise start panning (middle click or left click on empty space)
  if (e.button === 1 || e.button === 0) {
    isPanning = true; panPointerId = e.pointerId; startPanX = x - offsetX; startPanY = y - offsetY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing');
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isPanning && !dragTile) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  if (dragTile) {
    const pw = screenToWorld(x, y);
    const desiredCx = pw.x - dragCenterDelta.x;
    const desiredCy = pw.y - dragCenterDelta.y;
    // snap to grid cell centers (center of cell)
    const gx = Math.floor(desiredCx / CELL) * CELL + CELL/2;
    const gy = Math.floor(desiredCy / CELL) * CELL + CELL/2;
    dragTile.x = gx; dragTile.y = gy;
    draw();
  } else if (isPanning && (panPointerId === e.pointerId)) {
    offsetX = x - startPanX; offsetY = y - startPanY; draw();
  }
});

canvas.addEventListener('pointerup', async (e) => {
  if (dragTile) {
    // Click vs drag detection
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const moved = pointerDownPos && (Math.hypot(x - pointerDownPos.x, y - pointerDownPos.y) > 6);
    if (!moved) {
      // treat as click -> preview
      window.dispatchEvent(new CustomEvent('columbarium:preview', { detail: { id: dragTile.id } }));
    } else {
      // persist position after a drag
      await localStore.updateScenePosition(dragTile.id, { posX: dragTile.x, posY: dragTile.y });
    }
    // persist position
    dragTile = null;
  }
  if (isPanning && (panPointerId === e.pointerId)) { isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); }
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointercancel', () => { dragTile = null; isPanning = false; panPointerId = null; canvas.classList.remove('grabbing'); });

async function loadTiles(){
  const list = await localStore.listScenes().catch(()=>[]);
  tiles = list.map((s, idx) => ({
    id: s.id,
    name: s.name,
    // default layout: grid around origin, one-cell spacing
  x: Number.isFinite(s.posX) ? s.posX : (((idx % 3) * CELL * 1.4) + CELL/2),
  y: Number.isFinite(s.posY) ? s.posY : ((Math.floor(idx / 3) * CELL * 1.4) + CELL/2),
    w: CELL * 1.0, h: CELL * 1.0,
    thumb: s.thumb || null,
  }));
  console.log('[Columbarium] Loaded tiles:', tiles.length);
  // Kick off thumbnail loading for any without cached image
  tiles.forEach(t => {
    if (t.thumb && !thumbCache.has(t.id)) {
      const img = new Image();
      img.onload = () => { thumbCache.set(t.id, img); draw(); };
      img.src = t.thumb;
    }
  });
  // Center initial view on tiles cluster
  if (tiles.length) {
    centerOnTiles();
  } else {
    // pleasant default
  const rect2 = canvas.getBoundingClientRect();
  offsetX = rect2.width * 0.5; offsetY = rect2.height * 0.4;
  }
}

// Hook preview into the existing modal on the page via a simple event -> dynamic import
window.addEventListener('columbarium:preview', async (e) => {
  const { id } = e.detail || {}; if (!id) return;
  const mod = await import('./columbarium.js');
  if (mod && mod.openPreviewById) {
    mod.openPreviewById(id);
  } else {
    alert('Preview not available');
  }
});

window.addEventListener('resize', resize);
window.addEventListener('columbarium:refresh', async ()=>{ await loadTiles(); draw(); });
window.addEventListener('columbarium:center', () => { centerOnTiles(); draw(); });
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'r') { centerOnTiles(); draw(); } });
window.addEventListener('columbarium:resetView', () => { scale = 1; centerOnTiles(); draw(); });
resize();
loadTiles().then(draw);
