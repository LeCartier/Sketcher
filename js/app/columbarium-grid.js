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

// Zones state
let zones = []; // {id,x,y,w,h,color,name}
let zonesColor = '#ffbf00';
let zonesMode = 'idle'; // 'idle' | 'draw'
let selectedZoneId = null;
let dragZone = null; // resizing or moving
let dragZoneStart = null; // { x,y,w,h, hit: 'inside'|'edgeL'|'edgeR'|'edgeT'|'edgeB'|'cornerTL'|'cornerTR'|'cornerBL'|'cornerBR', cellMinX,cellMinY,cellMaxX,cellMaxY, mx,my }
let hoverZoneHit = null; // { id, hit }
let zonesEditOn = false;

// ---------- 3D overlay viewer for expanded tile ----------
let overlay3D = null; // { id, container, canvas, renderer, scene, camera, controls, raf, lastRect }
let overlay3DPending = false;

async function createOverlay3D(tile, rect){
  try {
    const rec = await localStore.getScene(tile.id);
    if (!rec || !rec.json) return;
    // Lazy-load THREE and controls
    const THREE = await import('../vendor/three.module.js');
    const { OrbitControls } = await import('../vendor/OrbitControls.js');
    // Container (viewport-positioned, account for canvas offset)
    const container = document.createElement('div');
    container.id = 'cOverlayViewer';
    const cbr = canvas.getBoundingClientRect();
    const left = cbr.left + rect.x; const top = cbr.top + rect.y;
    Object.assign(container.style, {
      position: 'fixed', left: left + 'px', top: top + 'px', width: rect.w + 'px', height: rect.h + 'px',
      zIndex: '12', borderRadius: '18px', overflow: 'hidden', boxShadow: '0 10px 28px rgba(0,0,0,0.45)'
    });
    document.body.appendChild(container);
    // Renderer
    const canvas = document.createElement('canvas'); container.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(rect.w, rect.h, false);
    renderer.setClearColor('#141414');
    // Scene + camera
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5,10,7); scene.add(dir);
    const camera = new THREE.PerspectiveCamera(60, rect.w / rect.h, 0.01, 5000);
    // Load objects
    const loader = new THREE.ObjectLoader();
    const root = loader.parse(rec.json);
    (root.children||[]).forEach(child => scene.add(child));
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 6;
    camera.position.set(center.x + radius*1.2, center.y + radius*0.9, center.z + radius*1.2);
    camera.lookAt(center);
    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.copy(center);
    // Title + buttons overlay
    const ui = document.createElement('div');
    Object.assign(ui.style, { position:'absolute', left:0, right:0, bottom:'8px', display:'flex', alignItems:'center', gap:'8px', padding:'0 12px' });
    // Gradient backdrop for legibility
    const grad = document.createElement('div');
    Object.assign(grad.style, { position:'absolute', left:0, right:0, bottom:0, height:'96px', background:'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)', pointerEvents:'none' });
    container.appendChild(grad);
    const title = document.createElement('div');
    title.textContent = (tile.name || 'Untitled').replace(/^gallery:/,'');
    Object.assign(title.style, { color:'#fff', textShadow:'0 2px 6px rgba(0,0,0,0.6)', font:'600 14px system-ui, sans-serif', marginRight:'auto' });
  // Close button (top-right)
  const close = document.createElement('button');
  close.setAttribute('aria-label','Close');
  close.textContent = '×';
  Object.assign(close.style, { position:'absolute', top:'8px', right:'10px', width:'28px', height:'28px', borderRadius:'14px', border:'1px solid rgba(255,255,255,0.16)', background:'#333', color:'#ddd', lineHeight:'26px', textAlign:'center', cursor:'pointer' });
  close.addEventListener('click', () => { isCollapsing = true; animStart = performance.now(); const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); else { expandedId = null; isCollapsing = false; draw(); } }; run(); });
  container.appendChild(close);
    const btn = (label)=>{ const b=document.createElement('button'); b.textContent=label; Object.assign(b.style,{background:'#333',color:'#ddd',border:'1px solid rgba(255,255,255,0.16)',borderRadius:'8px',padding:'6px 10px',cursor:'pointer'}); return b; };
    const openBtn = btn('Open');
    const delBtn = btn('Delete');
    ui.append(title, delBtn, openBtn);
    container.appendChild(ui);
    // Wire actions
    openBtn.addEventListener('click', () => {
      const url = new URL('./index.html', location.href);
      url.searchParams.set('sceneId', tile.id);
      document.body.classList.add('page-leave'); setTimeout(()=>{ window.location.href = url.toString(); }, 180);
    });
    delBtn.addEventListener('click', async () => {
      const ok = confirm('Delete this scene?'); if (!ok) return;
      await localStore.deleteScene(tile.id);
      destroyOverlay3D(); expandedId = null; await loadTiles(); draw();
    });
    // Animate
    let raf = 0; function loop(){ raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }
    loop();
    overlay3D = { id: tile.id, container, canvas, renderer, scene, camera, controls, raf, lastRect: { ...rect } };
    // Resize handler for window resizes
    overlay3D._onResize = () => {
      const r = overlay3D.lastRect; if (!r) return;
      renderer.setSize(r.w, r.h, false); camera.aspect = r.w / r.h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', overlay3D._onResize);
  } catch (e) { console.error('Overlay 3D failed', e); }
}

function updateOverlay3DRect(rect){
  if (!overlay3D) return;
  overlay3D.lastRect = { ...rect };
  const cbr = canvas.getBoundingClientRect();
  const s = overlay3D.container.style; s.left = (cbr.left + rect.x) + 'px'; s.top = (cbr.top + rect.y) + 'px'; s.width = rect.w + 'px'; s.height = rect.h + 'px';
  overlay3D.renderer.setSize(rect.w, rect.h, false);
  overlay3D.camera.aspect = Math.max(0.0001, rect.w / rect.h); overlay3D.camera.updateProjectionMatrix();
}

function destroyOverlay3D(){
  if (!overlay3D) return;
  try { cancelAnimationFrame(overlay3D.raf); } catch {}
  try { overlay3D.controls && overlay3D.controls.dispose && overlay3D.controls.dispose(); } catch {}
  try {
    const sc = overlay3D.scene;
    if (sc) {
      sc.traverse(obj => {
        try { obj.geometry && obj.geometry.dispose && obj.geometry.dispose(); } catch {}
        try {
          if (Array.isArray(obj.material)) obj.material.forEach(m=>m && m.dispose && m.dispose());
          else obj.material && obj.material.dispose && obj.material.dispose();
        } catch {}
      });
    }
  } catch {}
  try { overlay3D.renderer && overlay3D.renderer.dispose && overlay3D.renderer.dispose(); } catch {}
  try { overlay3D.container && overlay3D.container.remove && overlay3D.container.remove(); } catch {}
  try { window.removeEventListener('resize', overlay3D._onResize); } catch {}
  overlay3D = null;
  overlay3DPending = false;
}

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

function drawZones(){
  // Draw rectangles behind tiles in world-space
  if (!zones.length) return;
  for (const z of zones) {
    const p0 = worldToScreen(z.x, z.y);
    const w = z.w * scale, h = z.h * scale;
    const x = p0.x, y = p0.y;
    const r = 12 * Math.max(0.75, scale);
    ctx.save();
    ctx.globalAlpha = 0.22;
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = z.color || '#ffbf00';
    ctx.fill();
    // Stroke with higher alpha for selection
    if (selectedZoneId === z.id) {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([6,4]); ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.globalAlpha = 0.35; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTiles(){
  const baseW = (CELL - TILE_INSET) * scale;
  const baseH = baseW;
  let expandedTile = null;

  // Pass 1: draw non-expanded tiles in world space
  for (const t of tiles) {
    const isExpanded = (expandedId === t.id);
    t.w = baseW; t.h = baseH; // screen-space for hit-testing
    if (isExpanded) { expandedTile = t; t.btnRemove = null; t.btnOpen = null; t.btnDelete = null; t.nameRect = null; continue; }

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

    // Content (full-bleed preview)
    ctx.save();
    roundRect(ctx, s.x, s.y, baseW, baseH, r); ctx.clip();
    const previewH = baseH;
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
    // Name overlay (bottom-left) with subtle gradient for legibility
    const gradH = Math.max(36 * scale, 28);
    const g = ctx.createLinearGradient(0, s.y + baseH - gradH, 0, s.y + baseH);
    g.addColorStop(0, 'rgba(0,0,0,0.0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(s.x, s.y + baseH - gradH, baseW, gradH);
    const name = (t.name || 'Untitled').replace(/^gallery:/,'');
    ctx.font = `${Math.max(12, 12*scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText(name, s.x + 10*scale, s.y + baseH - Math.max(18*scale, 14));
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

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

    // Overlay card (background frame)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
    const r = 18;
    roundRect(ctx, sX, sY, sW, sH, r);
    ctx.fillStyle = 'rgba(20,20,20,0.98)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();

    // Content: switch to interactive 3D overlay once animation completes
    expandedTile.overlayRect = { x: sX, y: sY, w: sW, h: sH };
    const needFallback = (prog < 1) || (!overlay3D || overlay3D.id !== expandedTile.id);
    // Fallback: draw static preview + title + buttons
    if (needFallback) {
      // Full-bleed image
      ctx.save();
      roundRect(ctx, sX, sY, sW, sH, r); ctx.clip();
      const img = thumbCache.get(expandedTile.id);
      if (img && img.complete) {
        const ratio = Math.max(sW / img.width, sH / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        const dx = sX + (sW - w) / 2; const dy = sY + (sH - h) / 2;
        ctx.drawImage(img, dx, dy, w, h);
      } else {
        ctx.fillStyle = '#222'; ctx.fillRect(sX, sY, sW, sH);
      }
      // Bottom gradient for legibility
      const gradH2 = Math.min(96, Math.max(56, sH * 0.25));
      const g2 = ctx.createLinearGradient(0, sY + sH - gradH2, 0, sY + sH);
      g2.addColorStop(0, 'rgba(0,0,0,0.0)');
      g2.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g2; ctx.fillRect(sX, sY + sH - gradH2, sW, gradH2);
      // Title text
      const name2 = (expandedTile.name || 'Untitled').replace(/^gallery:/,'');
      ctx.fillStyle = '#fff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      const titleX = sX + 14; const titleY = sY + sH - 16;
      ctx.fillText(name2, titleX, titleY);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      // Buttons
      const btnW = 84, btnH = 30; const by = sY + sH - btnH - 12;
      const bxOpen = sX + sW - btnW - 12;
      const gap = 8; const bxDelete = bxOpen - gap - btnW;
      expandedTile.btnDelete = { x: bxDelete, y: by, w: btnW, h: btnH };
      expandedTile.btnOpen = { x: bxOpen, y: by, w: btnW, h: btnH };
      drawButton(expandedTile.btnDelete, 'Delete');
      drawButton(expandedTile.btnOpen, 'Open');
      // Rename hotspot near title
      expandedTile.nameRect = { x: titleX - 6, y: titleY - 22, w: Math.min(260, sW - (btnW*2 + 48)), h: 26 };
      ctx.restore();
    }
    // Manage the overlay viewer lifecycle
    if (prog < 1) { if (overlay3D) destroyOverlay3D(); overlay3DPending = false; }
    else {
      if (!overlay3D || overlay3D.id !== expandedTile.id) {
        if (!overlay3DPending) {
          overlay3DPending = true;
          createOverlay3D(expandedTile, expandedTile.overlayRect).finally(()=>{ overlay3DPending = false; });
        }
      } else {
        updateOverlay3DRect(expandedTile.overlayRect);
        // When the overlay is active, in-canvas button rects are not needed
        expandedTile.btnDelete = null; expandedTile.btnOpen = null; expandedTile.nameRect = null;
      }
    }
    ctx.restore();
    ctx.restore();

    if (tAnim < 1) requestAnimationFrame(draw);
  } else {
    // No expanded tile: ensure overlay viewer is removed
    if (overlay3D) destroyOverlay3D();
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
  drawZones();
  drawTiles();
  // Cursor feedback
  if (hoverZoneHit && hoverZoneHit.hit) {
    const h = hoverZoneHit.hit;
    const map = {
      edgeL: 'ew-resize', edgeR: 'ew-resize', edgeT: 'ns-resize', edgeB: 'ns-resize',
      cornerTL: 'nwse-resize', cornerBR: 'nwse-resize', cornerTR: 'nesw-resize', cornerBL: 'nesw-resize', inside: 'move'
    };
    canvas.style.cursor = map[h] || '';
  } else if (!isPanning) {
    canvas.style.cursor = 'grab';
  }
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

  // Zones interactions (below overlay handling): allow drawing or selecting prior to overlay/tile drag
  if (zonesEditOn && zonesMode === 'draw' && e.button === 0) {
    const startW = screenToWorld(x, y);
    const id = await localStore.saveZone({ x: startW.x, y: startW.y, w: 0, h: 0, color: zonesColor });
    const zone = { id, x: startW.x, y: startW.y, w: 0, h: 0, color: zonesColor };
    zones.push(zone);
    selectedZoneId = id;
    dragZone = zone;
    dragZoneStart = { x: startW.x, y: startW.y, w: 0, h: 0, hit: 'corner' };
  // Sync picker to new zone color
  try { const picker = document.getElementById('zoneColor'); if (picker) picker.value = zonesColor; } catch {}
    canvas.setPointerCapture(e.pointerId);
    draw();
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
        // Delete button (only in expanded view)
        if (t.btnDelete && x>=t.btnDelete.x && x<=t.btnDelete.x+t.btnDelete.w && y>=t.btnDelete.y && y<=t.btnDelete.y+t.btnDelete.h) {
          (async ()=>{ const ok = confirm('Delete this scene?'); if (ok) { await localStore.deleteScene(t.id); expandedId = null; await loadTiles(); draw(); } })();
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

  // Zone hit-tests (selection/move/resize)
  if (zonesEditOn) for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    const p = worldToScreen(z.x, z.y);
    const zx = p.x, zy = p.y; const zw = z.w * scale, zh = z.h * scale;
    if (x >= zx && x <= zx + zw && y >= zy && y <= zy + zh) {
      // Which area? edges/corners vs inside for resizing
      const edge = 8; const ex = x - zx, ey = y - zy;
      let hit = 'inside';
      const nearL = ex < edge, nearR = (zw - ex) < edge, nearT = ey < edge, nearB = (zh - ey) < edge;
      if (nearL && nearT) hit = 'cornerTL';
      else if (nearR && nearB) hit = 'cornerBR';
      else if (nearR && nearT) hit = 'cornerTR';
      else if (nearL && nearB) hit = 'cornerBL';
      else if (nearL) hit = 'edgeL'; else if (nearR) hit = 'edgeR'; else if (nearT) hit = 'edgeT'; else if (nearB) hit = 'edgeB';
      selectedZoneId = z.id; dragZone = z; const sw = screenToWorld(x, y);
      // Sync color picker to selected zone without triggering recolor
      try {
        const picker = document.getElementById('zoneColor');
        if (picker && typeof z.color === 'string' && z.color) { picker.value = z.color; zonesColor = z.color; }
      } catch {}
  // Precompute cell-space bounds for stable resizing/moving, ignoring visual inset
  const inset = TILE_INSET;
  const cellMinX = Math.floor((z.x + inset) / CELL);
  const cellMinY = Math.floor((z.y + inset) / CELL);
  const cellMaxX = Math.ceil((z.x + z.w - inset) / CELL);
  const cellMaxY = Math.ceil((z.y + z.h - inset) / CELL);
      dragZoneStart = { x: z.x, y: z.y, w: z.w, h: z.h, mx: sw.x, my: sw.y, hit, cellMinX, cellMinY, cellMaxX, cellMaxY };
      canvas.setPointerCapture(e.pointerId);
      draw();
      return;
    }
  }

  // Hit test tiles (topmost first)
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    const c = worldToScreen(t.x, t.y); const x0 = c.x - t.w/2, y0 = c.y - t.h/2;
    if (x >= x0 && x <= x0 + t.w && y >= y0 && y <= y0 + t.h) {
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
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  // Hover detection for zones to update cursor when idle
  if (!isPanning && !dragTile && !dragZone) {
    hoverZoneHit = null;
    if (zonesEditOn) for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i]; const p = worldToScreen(z.x, z.y); const zx = p.x, zy = p.y; const zw = z.w * scale, zh = z.h * scale;
      if (x >= zx && x <= zx + zw && y >= zy && y <= zy + zh) {
        const edge = 8; const ex = x - zx, ey = y - zy;
        let hit = 'inside';
        const nearL = ex < edge, nearR = (zw - ex) < edge, nearT = ey < edge, nearB = (zh - ey) < edge;
        if (nearL && nearT) hit = 'cornerTL';
        else if (nearR && nearB) hit = 'cornerBR';
        else if (nearR && nearT) hit = 'cornerTR';
        else if (nearL && nearB) hit = 'cornerBL';
        else if (nearL) hit = 'edgeL'; else if (nearR) hit = 'edgeR'; else if (nearT) hit = 'edgeT'; else if (nearB) hit = 'edgeB';
        hoverZoneHit = { id: z.id, hit };
        break;
      }
    }
    draw();
    return;
  }
  if (dragZone) {
    // Update zone geometry based on hit mode
    const sw = screenToWorld(x, y);
    const z = dragZone, st = dragZoneStart;
    if (!z || !st) return;
    if (zonesMode === 'draw') {
      // Compute snapped rect expanded by TILE_INSET around the grid cells
      let minX = Math.min(st.x, sw.x), minY = Math.min(st.y, sw.y);
      let maxX = Math.max(st.x, sw.x), maxY = Math.max(st.y, sw.y);
      const inset = TILE_INSET;
      const gx0 = Math.floor(minX / CELL) * CELL; const gy0 = Math.floor(minY / CELL) * CELL;
      const gx1 = Math.ceil(maxX / CELL) * CELL; const gy1 = Math.ceil(maxY / CELL) * CELL;
      z.x = gx0 - inset; z.y = gy0 - inset; z.w = (gx1 - gx0) + inset*2; z.h = (gy1 - gy0) + inset*2;
    } else {
      // move/resize
      let minCellX = st.cellMinX, minCellY = st.cellMinY;
      let maxCellX = st.cellMaxX, maxCellY = st.cellMaxY;
      if (st.hit === 'inside') {
        // Move: preserve cell span and snap origin cell to new position (ignore visual inset)
        const dx = sw.x - st.mx, dy = sw.y - st.my;
        const nx = st.x + dx, ny = st.y + dy;
        const inset = TILE_INSET;
        minCellX = Math.floor((nx + inset) / CELL); minCellY = Math.floor((ny + inset) / CELL);
        maxCellX = minCellX + (st.cellMaxX - st.cellMinX);
        maxCellY = minCellY + (st.cellMaxY - st.cellMinY);
      } else {
        // Resize: only the dragged side moves by updating corresponding min/max cell
  // Start with original fixed side bounds
  minCellX = st.cellMinX; minCellY = st.cellMinY; maxCellX = st.cellMaxX; maxCellY = st.cellMaxY;
  // Adjust only the dragged sides
  if (st.hit === 'edgeL' || st.hit === 'cornerTL' || st.hit === 'cornerBL') minCellX = Math.min(Math.floor(sw.x / CELL), st.cellMaxX - 1);
  if (st.hit === 'edgeR' || st.hit === 'cornerTR' || st.hit === 'cornerBR') maxCellX = Math.max(Math.ceil(sw.x / CELL), st.cellMinX + 1);
  if (st.hit === 'edgeT' || st.hit === 'cornerTL' || st.hit === 'cornerTR') minCellY = Math.min(Math.floor(sw.y / CELL), st.cellMaxY - 1);
  if (st.hit === 'edgeB' || st.hit === 'cornerBL' || st.hit === 'cornerBR') maxCellY = Math.max(Math.ceil(sw.y / CELL), st.cellMinY + 1);
        // Ensure min <= max
        if (maxCellX < minCellX) { const t = maxCellX; maxCellX = minCellX; minCellX = t; }
        if (maxCellY < minCellY) { const t = maxCellY; maxCellY = minCellY; minCellY = t; }
      }
      const inset = TILE_INSET;
      const gx0 = minCellX * CELL, gy0 = minCellY * CELL;
      const gx1 = maxCellX * CELL, gy1 = maxCellY * CELL;
      z.x = gx0 - inset; z.y = gy0 - inset; z.w = (gx1 - gx0) + inset*2; z.h = (gy1 - gy0) + inset*2;
    }
    draw();
  } else if (dragTile) {
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
  if (dragZone) {
    // Persist zone change
    const z = dragZone; dragZone = null; const st = dragZoneStart; dragZoneStart = null;
  const wasDraw = zonesMode === 'draw';
  zonesMode = wasDraw ? 'idle' : zonesMode;
    if (z && z.id) await localStore.updateZone(z.id, { x: z.x, y: z.y, w: z.w, h: z.h });
    await loadZones(); draw();
    if (wasDraw) {
  const btn = document.getElementById('zoneCreate');
  if (btn) btn.setAttribute('aria-pressed', 'false');
    }
  } else if (dragTile) {
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
  // Load existing thumbs; lazily generate for missing ones
  for (const t of tiles) {
    if (t.thumb) {
      if (!thumbCache.has(t.id)) {
        const img = new Image(); img.onload = () => { thumbCache.set(t.id, img); draw(); }; img.src = t.thumb;
      }
    } else {
      try {
        const rec = await localStore.getScene(t.id);
        if (rec && rec.json) {
          const { generateSceneThumbnail } = await import('./columbarium.js');
          const thumb = await generateSceneThumbnail(rec.json).catch(()=>null);
          if (thumb) {
            await localStore.updateSceneThumbnail(t.id, { thumb });
            const img = new Image(); img.onload = () => { thumbCache.set(t.id, img); draw(); }; img.src = thumb;
          }
        }
      } catch {}
    }
  }
  if (tiles.length) centerOnTiles();
  else {
    const rect2 = canvas.getBoundingClientRect();
    offsetX = rect2.width * 0.5; offsetY = rect2.height * 0.4;
  }
}

async function loadZones(){
  zones = await localStore.listZones().catch(()=>[]);
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
window.addEventListener('scroll', () => { if (overlay3D && overlay3D.lastRect) updateOverlay3DRect(overlay3D.lastRect); }, { passive: true });
window.addEventListener('columbarium:refresh', async ()=>{ await loadTiles(); draw(); });
window.addEventListener('columbarium:center', () => { centerOnTiles(); draw(); });
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'r') { centerOnTiles(); draw(); } });
// Collapse overlay on Escape
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expandedId) { isCollapsing = true; animStart = performance.now(); const start = animStart; const run = () => { if (animStart !== start) return; draw(); if (performance.now()-start < ANIM_MS) requestAnimationFrame(run); else { expandedId = null; isCollapsing = false; draw(); } }; run(); } });
window.addEventListener('columbarium:resetView', () => { scale = 1; centerOnTiles(); draw(); });

// Zones toolbox integration
window.addEventListener('zones:color', async (e)=> {
  const color = (e.detail && e.detail.color) || zonesColor;
  zonesColor = color;
  // Live recolor selected zone
  if (zonesEditOn && selectedZoneId) {
    const z = zones.find(zz => zz.id === selectedZoneId);
    if (z) { z.color = color; await localStore.updateZone(z.id, { color }); draw(); }
  }
});
window.addEventListener('zones:mode', (e)=> {
  zonesMode = (e.detail && e.detail.mode) || 'idle';
  if (zonesMode !== 'draw') selectedZoneId = null;
});
window.addEventListener('zones:edit', (e)=> {
  zonesEditOn = !!(e.detail && e.detail.on);
  if (!zonesEditOn) { zonesMode = 'idle'; selectedZoneId = null; dragZone = null; dragZoneStart = null; hoverZoneHit = null; draw(); }
});
// Keyboard shortcuts in edit mode
window.addEventListener('keydown', async (e) => {
  if (!zonesEditOn) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') {
    zonesEditOn = false; zonesMode = 'idle'; selectedZoneId = null; dragZone = null; dragZoneStart = null; hoverZoneHit = null; draw();
    const parent = document.getElementById('cZonesGroup'); const btn = document.getElementById('cToggleZones'); const child = document.getElementById('zoneCreate');
    if (parent && btn) { parent.classList.remove('open'); parent.setAttribute('aria-hidden','true'); btn.setAttribute('aria-pressed','false'); }
    if (child) child.setAttribute('aria-pressed','false');
  }
  if ((key === 'delete' || key === 'backspace') && selectedZoneId) {
    e.preventDefault();
    await localStore.deleteZone(selectedZoneId);
    selectedZoneId = null; await loadZones(); draw();
  }
});
window.addEventListener('zones:deleteSelected', async ()=> {
  if (!selectedZoneId) return;
  if (confirm('Delete selected zone?')) { await localStore.deleteZone(selectedZoneId); selectedZoneId = null; await loadZones(); draw(); }
});
window.addEventListener('zones:clear', async ()=> { await localStore.clearZones(); selectedZoneId = null; await loadZones(); draw(); });

resize();
Promise.all([loadTiles(), loadZones()]).then(()=>draw());
