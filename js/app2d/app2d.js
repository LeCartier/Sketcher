// Sketcher 2D: lightweight, pointer-friendly 2D drawing canvas
// Supports mouse, touch, and stylus (including Apple Pencil) via Pointer Events.
import { smartInterpretPath } from './features/smart-draw.js';
import { getObjectBBox, getBBoxCenter, pointInBBox, deepCopyObject } from './features/geometry-2d.js';
import {
  drawSelectionOverlay as drawSelOverlayMod,
  pickSelectionHandleAt as pickHandleMod,
  moveObject as moveObjectMod,
  scaleObject as scaleObjectMod,
  rotateObject as rotateObjectMod
} from './features/selection-2d.js';
import { hitTestObject, eraseObjectAt as eraseObjectAtMod, erasePixelAt as erasePixelAtMod } from './features/erase-2d.js';
import { exportPNG as exportPNGMod, exportPDF as exportPDFMod } from './features/export-2d.js';

const canvas = document.getElementById('grid2d');
const ctx = canvas.getContext('2d');
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;

// State
let tool = 'pan'; // select | pan | pen | line | rect | ellipse | text | erase-object | erase-pixel
let stroke = '#111111';
let fill = '#00000000';
let thickness = 2;
let statusEl = document.getElementById('statusBar');
let isPanning = false;
let panStart = { vx: 0, vy: 0, sx: 0, sy: 0 };
// 2D view: x,y in feet; scale is zoom factor; pxPerFt controls screen mapping
let view = { x: 0, y: 0, scale: 1, pxPerFt: 20 };
// Selection/transform state for Select mode
const selection = { index: -1, mode: null, handle: null, startWorld:{x:0,y:0}, bbox0:null, orig:null };
let selectToggle = false; // top-level toggle that enables object selection on left-click
let feetPerInch = 4; // default working scale; import flows can override per underlay or entities
// Realtime broadcast channel to 3D (and any listeners)
const bc2D = (typeof window !== 'undefined' && 'BroadcastChannel' in window) ? new BroadcastChannel('sketcher-2d') : null;
let drawing = null; // active draft object
const objects = []; // drawn shapes
const undoStack = []; const redoStack = []; const undoLimit = 100;
let spacePanActive = false; // hold Space to pan temporarily
let pinch = { active:false, startDist:0, startScale:1, startCenterWorld:{x:0,y:0} };
// Erase state
const erasing = { active:false, radiusFt: 0.5, points: [], cursor:{x:0,y:0,visible:false} }; // radius in feet
// Pixel-erase strokes (non-destructive mask of objects layer)
let eraseStrokes = []; // [{ pts:[{x,y}], radiusFt:number }]
// Offscreens: objects layer (before mask) and erase mask
let objectsLayer = null, objectsCtx = null;
let eraseMask = null, eraseMaskCtx = null;
// Underlay (PDF image or DXF-rendered offscreen)
const underlay = { type:null, image:null, worldRect:null, opacity:0.85 };
// No-keyboard delete UI (2D)
const mobileDeleteBar2D = document.getElementById('mobileDeleteBar');
const mobileDeleteBtn2D = document.getElementById('mobileDeleteBtn2D');

function setStatus(msg){ if(statusEl) statusEl.textContent = msg; }

function resize(){
  // Refresh DPR in case browser/page zoom changed (trackpad pinch, display scale)
  dpr = Math.max(1, window.devicePixelRatio || 1);
  // Preserve the world point at the screen center during resize
  const r = canvas.getBoundingClientRect();
  const centerBefore = { x: r.width/2, y: r.height/2 };
  const worldCenterBefore = screenToWorld(centerBefore);
  W = Math.max(1, Math.round(r.width * dpr));
  H = Math.max(1, Math.round(r.height * dpr));
  canvas.width = W; canvas.height = H;
  // Resize offscreens
  if(!objectsLayer){ objectsLayer = document.createElement('canvas'); }
  if(!eraseMask){ eraseMask = document.createElement('canvas'); }
  objectsLayer.width = W; objectsLayer.height = H; objectsCtx = objectsLayer.getContext('2d');
  eraseMask.width = W; eraseMask.height = H; eraseMaskCtx = eraseMask.getContext('2d');
  // Rebuild mask after resize
  rebuildEraseMask();
  // Adjust view to keep the same world point at the new screen center
  const r2 = canvas.getBoundingClientRect();
  const worldCenterAfter = screenToWorld({ x: r2.width/2, y: r2.height/2 });
  view.x += worldCenterBefore.x - worldCenterAfter.x;
  view.y += worldCenterBefore.y - worldCenterAfter.y;
  draw();
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// Reliable local coordinates helper (Chrome/trackpad friendly)
function eventToLocal(e){
  if (typeof e.offsetX === 'number' && typeof e.offsetY === 'number') {
    return { x: e.offsetX, y: e.offsetY };
  }
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
}

// Grid
function drawGrid(){
  // 1 ft minor grid, 5 ft major grid, in screen pixels
  const s = view.scale * view.pxPerFt;
  const minor = 1 * s; // 1 ft
  const major = 5 * s; // 5 ft
  // Work in CSS pixels (ctx is scaled by dpr already)
  const CSSW = W / dpr, CSSH = H / dpr;
  // Anchor grid strictly to world coordinates using modulo of screen offset
  const offXMinor = (-view.x * s) % minor;
  const offYMinor = (-view.y * s) % minor;
  let x0Minor = (offXMinor + minor) % minor; // first vertical minor grid line
  let y0Minor = (offYMinor + minor) % minor; // first horizontal minor grid line
  // Major grid anchored independently to multiples of 5 ft in world space
  const offXMajor = (-view.x * s) % major;
  const offYMajor = (-view.y * s) % major;
  let x0Major = (offXMajor + major) % major;
  let y0Major = (offYMajor + major) % major;
  ctx.save();
  // minor
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
  // verticals to right
  for(let x = x0Minor; x <= CSSW; x += minor){ const xx = Math.round(x) + 0.5; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, CSSH); ctx.stroke(); }
  // verticals to left
  for(let x = x0Minor - minor; x >= 0; x -= minor){ const xx = Math.round(x) + 0.5; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, CSSH); ctx.stroke(); }
  // horizontals down
  for(let y = y0Minor; y <= CSSH; y += minor){ const yy = Math.round(y) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(CSSW, yy); ctx.stroke(); }
  // horizontals up
  for(let y = y0Minor - minor; y >= 0; y -= minor){ const yy = Math.round(y) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(CSSW, yy); ctx.stroke(); }
  // major
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  for(let x = x0Major; x <= CSSW; x += major){ const xx = Math.round(x) + 0.5; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, CSSH); ctx.stroke(); }
  for(let x = x0Major - major; x >= 0; x -= major){ const xx = Math.round(x) + 0.5; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, CSSH); ctx.stroke(); }
  for(let y = y0Major; y <= CSSH; y += major){ const yy = Math.round(y) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(CSSW, yy); ctx.stroke(); }
  for(let y = y0Major - major; y >= 0; y -= major){ const yy = Math.round(y) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(CSSW, yy); ctx.stroke(); }
  ctx.restore();
}


function worldToScreen(pt){
  const s = view.scale * view.pxPerFt;
  return { x: (pt.x - view.x) * s, y: (pt.y - view.y) * s };
}
function screenToWorld(pt){
  const s = view.scale * view.pxPerFt;
  return { x: pt.x / s + view.x, y: pt.y / s + view.y };
}

// Thin wrappers binding module functions to current canvas/view state
const drawSelectionOverlay = () => drawSelOverlayMod(ctx, view, objects, selection, worldToScreen);
const pickSelectionHandleAt = (localPt) => pickHandleMod(localPt, view, objects, selection, worldToScreen);
const moveObject = (o0, dx, dy) => moveObjectMod(o0, dx, dy);
const scaleObject = (o0, bbox0, handle, world) => scaleObjectMod(o0, bbox0, handle, world);
const rotateObject = (o0, center, da) => rotateObjectMod(o0, center, da);
const eraseObjectAt = (p) => eraseObjectAtMod(objects, p, erasing.radiusFt);
const erasePixelAt = (p) => erasePixelAtMod(objects, p, erasing.radiusFt);

function drawObjects(){
  for(const o of objects){ drawObject(o); }
}
function drawObject(o, g = ctx){
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  // Keep line width in screen pixels (do not multiply by view.scale) so geometry stays visually pinned to the grid
  g.strokeStyle = o.stroke; g.lineWidth = Math.max(0.5, o.thickness);
  g.fillStyle = o.fill || 'transparent';
  switch(o.type){
    case 'path': {
      g.beginPath();
      for(let i=0;i<o.pts.length;i++){
        const p = worldToScreen(o.pts[i]);
        if(i===0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      if(o.closed) g.closePath();
      if(o.fill && o.fill !== '#00000000') g.fill();
      g.stroke();
      break;
    }
    case 'line': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      break;
    }
    case 'rect': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y), w = Math.abs(a.x-b.x), h = Math.abs(a.y-b.y);
      if(o.fill && o.fill !== '#00000000'){ g.fillRect(x,y,w,h); }
      g.strokeRect(x,y,w,h); break;
    }
    case 'ellipse': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      const cx = (a.x+b.x)/2, cy=(a.y+b.y)/2; const rx = Math.abs(a.x-b.x)/2, ry = Math.abs(a.y-b.y)/2;
      g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
      if(o.fill && o.fill !== '#00000000') g.fill();
      g.stroke(); break;
    }
    case 'text': {
      const p = worldToScreen(o.p);
      g.fillStyle = o.stroke; g.font = `${Math.round(14*view.scale)}px system-ui, sans-serif`;
      g.fillText(o.text||'', p.x, p.y);
      break;
    }
  }
  g.restore();
}

// --- hit-test/selection/draw/erase now come from modules ---

function draw(){
  // Main canvas prep
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,W,H);
  // Underlay first
  if(underlay.image && underlay.worldRect){
    const s = view.scale * view.pxPerFt;
    const r = underlay.worldRect;
    const x = (r.x - view.x) * s;
    const y = (r.y - view.y) * s;
    const w = r.w * s;
    const h = r.h * s;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, underlay.opacity));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(underlay.image, x, y, w, h);
    ctx.restore();
  }
  // Grid below objects
  drawGrid();
  // Draw objects into offscreen layer
  if(objectsCtx){
    objectsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    objectsCtx.clearRect(0,0,W,H);
    for(const o of objects){ drawObject(o, objectsCtx); }
    if(drawing) drawObject(drawing, objectsCtx);
    // Apply erase mask as destination-out (only affects objects)
    if(eraseMask){
  // Recompute mask for current view/zoom
  rebuildEraseMask();
      objectsCtx.save();
      objectsCtx.globalCompositeOperation = 'destination-out';
      objectsCtx.drawImage(eraseMask, 0, 0);
      objectsCtx.restore();
    }
    // Composite objects layer onto main canvas
    ctx.drawImage(objectsLayer, 0, 0);
  }
  // Selection overlay above
  if(selectToggle && selection.index>=0){ drawSelectionOverlay(); }
  // Toggle delete bar on devices without a keyboard (touch-capable or XR)
  try {
    const noKeyboard = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) || !!(navigator.xr);
    if (mobileDeleteBar2D) {
      const shouldShow = noKeyboard && selection.index >= 0;
      mobileDeleteBar2D.style.display = shouldShow ? 'flex' : 'none';
    }
  } catch {}
  // Brush cursor
  if(tool==='erase-pixel' && erasing.cursor.visible){
    const s = view.scale * view.pxPerFt;
    const px = erasing.radiusFt * s;
    const p = worldToScreen(erasing.cursor);
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, px, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(0,128,0,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4,3]);
    ctx.stroke(); ctx.restore();
  }
}

function rebuildEraseMask(){
  if(!eraseMaskCtx) return;
  // Clear mask
  eraseMaskCtx.setTransform(1,0,0,1,0,0);
  eraseMaskCtx.clearRect(0,0,eraseMask.width, eraseMask.height);
  eraseMaskCtx.fillStyle = '#000';
  eraseMaskCtx.globalCompositeOperation = 'source-over';
  const drawPts = (pts, rFt)=>{
    const s = view.scale * view.pxPerFt;
    const radPx = Math.max(0.5, rFt * s * dpr);
    eraseMaskCtx.beginPath();
    for(const wpt of pts){
      const p = worldToScreen(wpt);
      const x = p.x * dpr, y = p.y * dpr;
      eraseMaskCtx.moveTo(x + radPx, y);
      eraseMaskCtx.arc(x, y, radPx, 0, Math.PI*2);
    }
    eraseMaskCtx.fill();
  };
  // Persisted strokes
  for(const st of eraseStrokes){ if(st && Array.isArray(st.pts) && st.pts.length){ drawPts(st.pts, st.radiusFt || erasing.radiusFt); } }
  // Live stroke
  if(erasing.active && erasing.points && erasing.points.length){ drawPts(erasing.points, erasing.radiusFt); }
}

// UI wiring
function setTool(id){
  tool = id; setStatus(`Tool: ${id}`);
  const ids = ['tPen','tSmart','tLine','tRect','tEllipse','tText','tEraseObj','tErasePix'];
  ids.forEach(i => { const el = document.getElementById(i); if(!el) return; const map = { tPen:'pen', tSmart:'smart', tLine:'line', tRect:'rect', tEllipse:'ellipse', tText:'text', tEraseObj:'erase-object', tErasePix:'erase-pixel' }; el.setAttribute('aria-pressed', String(map[i]===id)); });
}
['tPen','tSmart','tLine','tRect','tEllipse','tText','tEraseObj','tErasePix'].forEach(id => {
  const el = document.getElementById(id); if(!el) return; el.addEventListener('click',()=>{
    const map = { tPen:'pen', tSmart:'smart', tLine:'line', tRect:'rect', tEllipse:'ellipse', tText:'text', tEraseObj:'erase-object', tErasePix:'erase-pixel' };
    const targetTool = map[id];
    setTool(targetTool);
  });
});

const strokeEl = document.getElementById('strokeColor');
const fillEl = document.getElementById('fillColor');
const fillNoneBtn = document.getElementById('fillNoneBtn');
const thickEl = document.getElementById('thickness');
const thickVal = document.getElementById('thicknessVal');
if(strokeEl) strokeEl.addEventListener('input', ()=>{ stroke = strokeEl.value; });
if(fillEl) fillEl.addEventListener('input', ()=>{
  // Picking a color disables No Fill and sets fill to chosen color
  if(fillNoneBtn) fillNoneBtn.setAttribute('aria-pressed','false');
  fill = fillEl.value; draw();
});
if(fillNoneBtn) fillNoneBtn.addEventListener('click', ()=>{
  const active = fillNoneBtn.getAttribute('aria-pressed') === 'true' ? false : true;
  fillNoneBtn.setAttribute('aria-pressed', String(active));
  fill = active ? '#00000000' : (fillEl ? fillEl.value : '#00000000');
  draw();
});
if(thickEl) thickEl.addEventListener('input', ()=>{ thickness = parseInt(thickEl.value||'2',10); if(thickVal) thickVal.textContent = `${thickness} px`; });

// Undo/Redo helpers
function pushUndo(){
  try {
    const snapshot = JSON.stringify({ objects, eraseStrokes });
    undoStack.push(snapshot);
    if(undoStack.length>undoLimit) undoStack.shift();
    redoStack.length = 0;
  } catch{}
}
function undo(){
  if(!undoStack.length) return;
  const prev = JSON.stringify({ objects, eraseStrokes });
  const snap = undoStack.pop();
  redoStack.push(prev);
  try {
    const data = JSON.parse(snap||'{}');
    objects.length = 0; if(Array.isArray(data.objects)) objects.push(...data.objects);
    eraseStrokes = Array.isArray(data.eraseStrokes) ? data.eraseStrokes : (data.erase && Array.isArray(data.erase.strokes) ? data.erase.strokes : []);
  } catch{}
  rebuildEraseMask(); draw();
}
function redo(){
  if(!redoStack.length) return;
  const cur = JSON.stringify({ objects, eraseStrokes });
  const snap = redoStack.pop();
  undoStack.push(cur);
  try {
    const data = JSON.parse(snap||'{}');
    objects.length = 0; if(Array.isArray(data.objects)) objects.push(...data.objects);
    eraseStrokes = Array.isArray(data.eraseStrokes) ? data.eraseStrokes : (data.erase && Array.isArray(data.erase.strokes) ? data.erase.strokes : []);
  } catch{}
  rebuildEraseMask(); draw();
}
function clearAll(){
  if(objects.length || underlay.image){ pushUndo(); }
  objects.length = 0;
  // also clear any underlay
  underlay.type = null; underlay.image = null; underlay.worldRect = null;
  // clear erase strokes/mask
  eraseStrokes = [];
  rebuildEraseMask();
  draw();
  // Persist and broadcast immediately so 3D can reset overlay to center
  try { if (bc2D) bc2D.postMessage(toJSON()); } catch{}
  try { sessionStorage.setItem('sketcher:2d', JSON.stringify(toJSON())); localStorage.setItem('sketcher:2d', JSON.stringify(toJSON())); } catch{}
}

const undoBtn = document.getElementById('undo'); if(undoBtn) undoBtn.addEventListener('click', undo);
const redoBtn = document.getElementById('redo'); if(redoBtn) redoBtn.addEventListener('click', redo);
const clearBtn = document.getElementById('clear'); if(clearBtn) clearBtn.addEventListener('click', clearAll);

// Export (PNG/PDF) now provided by features/export-2d
const exportPNG = () => exportPNGMod(canvas, W, H, dpr);
const exportPDF = () => exportPDFMod(canvas, W, H, dpr);

const exportPNGBtn = document.getElementById('exportPNG'); if(exportPNGBtn) exportPNGBtn.addEventListener('click', exportPNG);
const exportPDFBtn = document.getElementById('exportPDF'); if(exportPDFBtn) exportPDFBtn.addEventListener('click', exportPDF);

// JSON serialize for projection
function toJSON(){
  // Preserve createdAt if present; always bump updatedAt
  let createdAt = Date.now();
  try {
    const prev = localStorage.getItem('sketcher:2d') || sessionStorage.getItem('sketcher:2d');
    if (prev) { const d = JSON.parse(prev); if (d && d.meta && d.meta.createdAt) createdAt = d.meta.createdAt; }
  } catch {}
  return { view, objects, erase: { strokes: eraseStrokes }, underlay: serializeUnderlay(), scale: { feetPerInch }, meta: { units: 'feet', createdAt, updatedAt: Date.now() } };
}
function saveToSession(){
  try {
    const data = toJSON();
    const str = JSON.stringify(data);
    sessionStorage.setItem('sketcher:2d', str);
    try { localStorage.setItem('sketcher:2d', str); } catch {}
    try { if (bc2D) bc2D.postMessage(data); } catch {}
  } catch {}
}
let saveTimer = null;
function scheduleSave(){ if(saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveToSession, 200); }

// Save JSON before navigating back to 3D
const to3D = document.getElementById('to3D');
if(to3D){ to3D.addEventListener('click', (e)=>{ e.preventDefault(); saveToSession(); try { document.body.classList.add('page-leave'); } catch{} const url = new URL('./index.html', location.href); setTimeout(()=>{ window.location.href = url.toString(); }, 170); }); }

// Restore if any prior 2D exists
(function restore2D(){
  try {
    // If navigating with a sketchId, load it from IndexedDB; else restore session/local
    const params = new URLSearchParams(location.search);
    const sketchId = params.get('sketchId');
    if (sketchId) {
      // Defer async fetch
      setTimeout(async ()=>{
        try {
          const mod = await import('../app/local-store.js');
          const rec = mod && mod.getSketch2D ? await mod.getSketch2D(sketchId) : null;
          if (rec && rec.json) {
            // Replace current state entirely; broadcast to 3D overlay only
            objects.length = 0; if (Array.isArray(rec.json.objects)) objects.push(...rec.json.objects);
            if (rec.json.view) view = { ...view, ...rec.json.view };
            if (rec.json.scale && typeof rec.json.scale.feetPerInch==='number') {
              feetPerInch = rec.json.scale.feetPerInch;
            }
            if (rec.json.underlay) restoreUnderlay(rec.json.underlay);
            draw();
            // Broadcast without overwriting session immediately; mark loaded id
            try { if (bc2D) bc2D.postMessage(rec.json); } catch{}
            try { sessionStorage.setItem('sketcher:2d:currentId', rec.id); } catch{}
            // Since we replaced content, refresh session/local to this loaded sketch
            saveToSession();
          }
        } catch(e){ console.warn('Failed to open 2D sketch', e); }
      }, 0);
      return;
    }
    const raw = sessionStorage.getItem('sketcher:2d');
    if(raw){
      const data = JSON.parse(raw);
      if(data){
        if(Array.isArray(data.objects)){ objects.length=0; objects.push(...data.objects); }
        if(data.view){ view = { ...view, ...data.view }; }
        if(data.scale && typeof data.scale.feetPerInch==='number'){ feetPerInch = data.scale.feetPerInch; }
        if(data.underlay){ restoreUnderlay(data.underlay); }
        if(data.erase && Array.isArray(data.erase.strokes)) { eraseStrokes = data.erase.strokes; rebuildEraseMask(); }
        draw();
      }
    }
  } catch {}
})();

// ----- Import: PDF and DXF/DWG (DXF only) -----
const importPDFBtn = document.getElementById('importPDF2D');
const importDXFBtn = document.getElementById('importDXF2D');
if(importPDFBtn){ importPDFBtn.addEventListener('click', async ()=>{ try { await importPDFFlow(); } catch(e){ console.error(e); alert('PDF import failed.'); } }); }
if(importDXFBtn){ importDXFBtn.addEventListener('click', async ()=>{ try { await importDXFFlow(); } catch(e){ console.error(e); alert('DXF import failed.'); } }); }

function askScaleFeetPerInch(){
  // Prompt for architectural scale; return feet-per-inch (real feet represented by 1 drawing inch)
  // Examples: 1/4"=1' => 4 ft/in; 1"=1' => 1 ft/in; 1:48 => 4 ft/in; also accepts plain number as feet-per-inch
  const preset = prompt('Enter scale (architectural). Examples:\n- 1/4\"=1\' (quarter-inch scale)\n- 1/8\"=1\'\n- 1\"=1\'\n- ratio like 1:48\n- or a number = feet-per-inch (e.g., 1)', '1/4"=1\'');
  if(!preset) return null;
  const t = preset.trim();
  // e.g., 1/4"=1'
  const inchEq = t.match(/^(\d+\/?\d*)\"\s*=\s*(\d+)'/);
  if(inchEq){
    const inches = evalFraction(inchEq[1]); const feet = parseFloat(inchEq[2]);
    if(inches>0 && feet>0){ return feet / inches; }
  }
  // Ratio a:b where both are inches; 1:48 => 48 inches real per 1 inch drawing => 48/12 = 4 ft/in
  const ratio = t.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if(ratio){ const a=parseFloat(ratio[1]), b=parseFloat(ratio[2]); if(a>0&&b>0) return (b/a)/12; }
  // direct number => feet per inch
  const num = parseFloat(t);
  if(!isNaN(num) && isFinite(num) && num>0) return num;
  alert('Could not parse scale.'); return null;
}
function evalFraction(s){ if(!s) return NaN; if(s.includes('/')){ const [n,d]=s.split('/').map(parseFloat); if(d) return n/d; } return parseFloat(s); }

// Modal helpers for import flows
const importModal = {
  el: document.getElementById('importScaleModal'),
  preview: document.getElementById('importPreview'),
  preset: document.getElementById('importScalePreset'),
  custom: document.getElementById('importScaleCustom'),
  unitsWrap: document.getElementById('importDXFUnitsWrap'),
  unit: document.getElementById('importUnit'),
  opacityWrap: document.getElementById('importOpacityWrap'),
  opacity: document.getElementById('importOpacity'),
  pdfPageWrap: document.getElementById('importPDFPageWrap'),
  pdfPageNumber: document.getElementById('importPageNumber'),
  pdfPageTotal: document.getElementById('importPageTotal'),
  pdfPrev: document.getElementById('importPagePrev'),
  pdfNext: document.getElementById('importPageNext'),
  pdfThumbsWrap: document.getElementById('importPDFThumbsWrap'),
  pdfThumbs: document.getElementById('importPageThumbs'),
  cancel: document.getElementById('importCancel'),
  confirm: document.getElementById('importConfirm')
};

function getChosenFeetPerInch(){
  const custom = parseFloat(importModal.custom && importModal.custom.value || '');
  if(!isNaN(custom) && custom > 0) return custom;
  const preset = parseFloat(importModal.preset && importModal.preset.value || '');
  return (!isNaN(preset) && preset > 0) ? preset : feetPerInch;
}

function openImportModal({ type, drawPreview, pdfController }){
  return new Promise(resolve => {
    if(!importModal.el) { resolve(null); return; }
    // Configure sections
    if(importModal.unitsWrap) importModal.unitsWrap.style.display = (type==='dxf') ? 'block' : 'none';
    const isPDF = (type==='pdf');
    if(importModal.opacityWrap) importModal.opacityWrap.style.display = isPDF ? 'block' : 'none';
    if(importModal.pdfPageWrap) importModal.pdfPageWrap.style.display = isPDF ? 'block' : 'none';
    if(importModal.custom) importModal.custom.value = '';
    if(importModal.preset) importModal.preset.value = '4'; // 1/4"=1'
    if(importModal.opacity) importModal.opacity.value = String(underlay.opacity ?? 0.85);
    if(isPDF && pdfController){
      const total = pdfController.pageCount || 1;
      if(importModal.pdfPageTotal) importModal.pdfPageTotal.textContent = String(total);
      if(importModal.pdfPageNumber) importModal.pdfPageNumber.value = String(Math.max(1, Math.min(total, pdfController.current || 1)));
      if(importModal.pdfThumbsWrap) importModal.pdfThumbsWrap.style.display = (total>1) ? 'block' : 'none';
      if(importModal.pdfThumbs){
        importModal.pdfThumbs.innerHTML = '';
        const makeThumb = async (i)=>{
          const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 128; canvas.style.cssText = 'flex:0 0 auto; width:64px; height:86px; border:2px solid transparent; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.08); background:#fff; cursor:pointer;';
          canvas.setAttribute('data-page', String(i));
          try {
            const page = await pdfController.getPage(i);
            // scale page to thumb canvas
            const vp1 = page.getViewport({ scale: 1 });
            const k = Math.min(canvas.width/vp1.width, canvas.height/vp1.height);
            const vp = page.getViewport({ scale: k });
            const ctx2 = canvas.getContext('2d');
            if(ctx2){
              ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,canvas.width,canvas.height);
              await page.render({ canvasContext: ctx2, viewport: vp }).promise;
            }
          } catch {}
          canvas.addEventListener('click', async ()=>{
            const n = parseInt(canvas.getAttribute('data-page')||'1',10);
            await pdfController.goTo(n);
            if(importModal.pdfPageNumber) importModal.pdfPageNumber.value = String(n);
            // Highlight selected
            Array.from(importModal.pdfThumbs.children).forEach(ch => ch.style.borderColor = 'transparent');
            canvas.style.borderColor = '#111';
            if(typeof drawPreview==='function') drawPreview(importModal.preview);
          });
          importModal.pdfThumbs.appendChild(canvas);
        };
        // generate first up to 12 thumbs quickly, lazy others after a frame
        const totalThumbs = Math.min(total, 50);
        for(let i=1;i<=Math.min(12,totalThumbs);i++){ makeThumb(i); }
        if(totalThumbs>12){ setTimeout(()=>{ for(let i=13;i<=totalThumbs;i++){ makeThumb(i); } },0); }
      }
      const update = async (pageNum)=>{
        try { await pdfController.goTo(pageNum); if(typeof drawPreview==='function') drawPreview(importModal.preview); } catch{}
        // sync highlight
        if(importModal.pdfThumbs){
          Array.from(importModal.pdfThumbs.children).forEach(ch => {
            const n = parseInt(ch.getAttribute('data-page')||'1',10);
            ch.style.borderColor = (n===pageNum) ? '#111' : 'transparent';
          });
        }
      };
      const onPrev = ()=>{ const cur = parseInt(importModal.pdfPageNumber.value||'1',10); if(cur>1){ importModal.pdfPageNumber.value = String(cur-1); update(cur-1); } };
      const onNext = ()=>{ const cur = parseInt(importModal.pdfPageNumber.value||'1',10); const t = pdfController.pageCount||1; if(cur<t){ importModal.pdfPageNumber.value = String(cur+1); update(cur+1); } };
      const onInput = ()=>{ let v = parseInt(importModal.pdfPageNumber.value||'1',10); const t=pdfController.pageCount||1; if(!isFinite(v)) v=1; v=Math.max(1,Math.min(t,v)); importModal.pdfPageNumber.value=String(v); update(v); };
      if(importModal.pdfPrev) importModal.pdfPrev.addEventListener('click', onPrev);
      if(importModal.pdfNext) importModal.pdfNext.addEventListener('click', onNext);
      if(importModal.pdfPageNumber) importModal.pdfPageNumber.addEventListener('change', onInput);
    }
  // Show modal and lock background scroll
  importModal.el.style.display = 'flex';
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
    // Draw initial preview
    try { if(typeof drawPreview==='function') drawPreview(importModal.preview); } catch{}
  // Wire buttons
    const onCancel = ()=>{ cleanup(); resolve(null); };
    const onConfirm = ()=>{
      const fpi = getChosenFeetPerInch();
      const unit = (importModal.unit && importModal.unit.value) || 'in';
      const opacity = importModal.opacity ? parseFloat(importModal.opacity.value) : (underlay.opacity ?? 0.85);
      cleanup(); resolve({ fpi, unit, opacity });
    };
    importModal.cancel.addEventListener('click', onCancel, { once:true });
    importModal.confirm.addEventListener('click', onConfirm, { once:true });
  function cleanup(){ importModal.el.style.display = 'none'; document.body.style.overflow = prevOverflow; }
  });
}

async function importPDFFlow(){
  const file = await pickFile(['.pdf']); if(!file) return;
  setStatus('Loading PDF…');
  // Lazy-load pdf.js from CDN
  const pdfjsURL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.min.mjs';
  const { getDocument, GlobalWorkerOptions } = await import(/* @vite-ignore */ pdfjsURL);
  try { GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.js'; } catch{}
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  let currentPage = 1; const pageCount = (pdf.numPages||1);
  // shared offscreen canvas for preview/import
  const tmp = document.createElement('canvas'); const c = tmp.getContext('2d', { willReadFrequently: false });
  async function renderPage(pageNum){
    const page = await pdf.getPage(pageNum);
    const sc = 2; const vp = page.getViewport({ scale: sc });
    tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
    c.clearRect(0,0,tmp.width,tmp.height);
    await page.render({ canvasContext: c, viewport: vp }).promise;
    return page;
  }
  let lastPage = await renderPage(currentPage);
  const choice = await openImportModal({ type:'pdf', pdfController: {
      pageCount,
      get current(){ return currentPage; },
      async goTo(n){ currentPage = Math.max(1, Math.min(pageCount, n)); lastPage = await renderPage(currentPage); },
      async getPage(n){ return pdf.getPage(n); }
    }, drawPreview: (cnv)=>{
  if(!cnv) return; const pctx = cnv.getContext('2d'); if(!pctx) return;
  // adjust for device pixel ratio for crispness on mobile
  const dpr = Math.max(1, window.devicePixelRatio||1);
  const rect = cnv.getBoundingClientRect();
  const targetW = Math.max(1, Math.round(rect.width * dpr));
  const targetH = Math.max(1, Math.round(rect.height * dpr));
  if(cnv.width !== targetW || cnv.height !== targetH){ cnv.width = targetW; cnv.height = targetH; }
  pctx.clearRect(0,0,cnv.width,cnv.height);
  const sw = cnv.width, sh = cnv.height; const iw = tmp.width, ih = tmp.height;
    const k = Math.min(sw/iw, sh/ih);
    const w = Math.max(1, Math.floor(iw*k)); const h = Math.max(1, Math.floor(ih*k));
    const x = (sw - w)/2, y = (sh - h)/2; pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(tmp, 0,0,iw,ih, x,y,w,h);
  }});
  if(!choice){ setStatus('PDF import canceled'); return; }
  const { fpi, opacity } = choice;
  feetPerInch = fpi; // update working scale
  // Convert to world size using PDF points: 1 unit = 1/72 inch at scale=1
  // We use the last rendered page's viewport to compute inches
  const page1x = lastPage.getViewport({ scale: 1 });
  const widthInches = page1x.width / 72; const heightInches = page1x.height / 72;
  const worldW = widthInches * fpi; const worldH = heightInches * fpi;
  underlay.type = 'pdf'; underlay.image = tmp; underlay.worldRect = { x: view.x, y: view.y, w: worldW, h: worldH };
  if(typeof opacity==='number' && !isNaN(opacity)) underlay.opacity = Math.max(0, Math.min(1, opacity));
  draw(); scheduleSave(); setStatus('PDF imported');
}

async function importDXFFlow(){
  const file = await pickFile(['.dxf','.DXF']); if(!file) return;
  setStatus('Loading DXF…');
  const text = await file.text();
  const ents = parseDXF(text);
  // Compute bounds for preview
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const e of ents){
    if(e.type==='LINE'){
      minX=Math.min(minX,e.x1,e.x2); maxX=Math.max(maxX,e.x1,e.x2);
      minY=Math.min(minY,e.y1,e.y2); maxY=Math.max(maxY,e.y1,e.y2);
    } else if(e.type==='LWPOLYLINE' || e.type==='POLYLINE'){
      for(const p of e.points){ minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); }
    } else if(e.type==='CIRCLE'){
      minX=Math.min(minX, e.cx - e.r); maxX=Math.max(maxX, e.cx + e.r);
      minY=Math.min(minY, e.cy - e.r); maxY=Math.max(maxY, e.cy + e.r);
    }
  }
  if(!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)){
    alert('DXF appears empty or unsupported.'); setStatus('DXF import canceled'); return;
  }
  const choice = await openImportModal({ type:'dxf', drawPreview: (cnv)=>{
  if(!cnv) return; const pctx = cnv.getContext('2d'); if(!pctx) return;
  const dpr = Math.max(1, window.devicePixelRatio||1);
  const rect = cnv.getBoundingClientRect();
  const targetW = Math.max(1, Math.round(rect.width * dpr));
  const targetH = Math.max(1, Math.round(rect.height * dpr));
  if(cnv.width !== targetW || cnv.height !== targetH){ cnv.width = targetW; cnv.height = targetH; }
  pctx.clearRect(0,0,cnv.width,cnv.height);
  // Fit drawing into canvas with padding
  const pad = Math.round(20 * dpr); const sw = cnv.width-2*pad, sh = cnv.height-2*pad;
    const dw = (maxX-minX), dh = (maxY-minY); const k = Math.min(sw/dw, sh/dh);
    const ox = pad + (sw - dw*k)/2; const oy = pad + (sh - dh*k)/2;
    // Draw axes/background
    pctx.fillStyle = '#ffffff'; pctx.fillRect(0,0,cnv.width,cnv.height);
    pctx.strokeStyle = '#e0e0e0'; pctx.lineWidth = 1; pctx.beginPath(); pctx.rect(pad-0.5,pad-0.5,sw+1,sh+1); pctx.stroke();
    // Draw entities in screen space (DXF units)
    pctx.save(); pctx.translate(ox, oy); pctx.scale(k, k); pctx.translate(-minX, -minY);
    pctx.lineWidth = 1/Math.max(1,k);
    pctx.strokeStyle = '#111';
    for(const e of ents){
      if(e.type==='LINE'){
        pctx.beginPath(); pctx.moveTo(e.x1, e.y1); pctx.lineTo(e.x2, e.y2); pctx.stroke();
      } else if(e.type==='LWPOLYLINE' || e.type==='POLYLINE'){
        pctx.beginPath();
        for(let i=0;i<e.points.length;i++){ const p=e.points[i]; if(i===0) pctx.moveTo(p.x,p.y); else pctx.lineTo(p.x,p.y); }
        if(e.closed && e.points.length>1) pctx.closePath(); pctx.stroke();
      } else if(e.type==='CIRCLE'){
        pctx.beginPath(); pctx.ellipse(e.cx, e.cy, e.r, e.r, 0, 0, Math.PI*2); pctx.stroke();
      }
    }
    pctx.restore();
  }});
  if(!choice){ setStatus('DXF import canceled'); return; }
  const { fpi, unit } = choice; feetPerInch = fpi;
  const inchPerUnit = unit==='in' ? 1 : unit==='ft' ? 12 : unit==='mm' ? (1/25.4) : unit==='m' ? 39.37007874 : 1;
  const feetPerUnit = fpi * inchPerUnit;
  const added = [];
  pushUndo();
  for(const e of ents){
    if(e.type==='LINE'){
      const a = { x: e.x1*feetPerUnit, y: e.y1*feetPerUnit };
      const b = { x: e.x2*feetPerUnit, y: e.y2*feetPerUnit };
      objects.push({ type:'line', a, b, stroke:'#111', fill:'#00000000', thickness: 1 });
      added.push('line');
    } else if(e.type==='LWPOLYLINE' || e.type==='POLYLINE'){
      const pts = e.points.map(p=>({ x: p.x*feetPerUnit, y: p.y*feetPerUnit }));
      objects.push({ type:'path', pts, closed: !!e.closed, stroke:'#111', fill:'#00000000', thickness: 1 });
      added.push('path');
    } else if(e.type==='CIRCLE'){
      const a = { x: (e.cx - e.r)*feetPerUnit, y: (e.cy - e.r)*feetPerUnit };
      const b = { x: (e.cx + e.r)*feetPerUnit, y: (e.cy + e.r)*feetPerUnit };
      objects.push({ type:'ellipse', a, b, stroke:'#111', fill:'#00000000', thickness: 1 });
      added.push('ellipse');
    }
  }
  draw(); scheduleSave(); setStatus(`DXF imported (${added.length} objects)`);
}

function pickFile(acceptExt){
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; if(Array.isArray(acceptExt)) inp.accept = acceptExt.join(',');
    inp.onchange = ()=>{ resolve(inp.files && inp.files[0] ? inp.files[0] : null); document.body.removeChild(inp); };
    inp.style.display='none'; document.body.appendChild(inp); inp.click();
  });
}

function serializeUnderlay(){
  if(!underlay.image || !underlay.worldRect) return null;
  // Downscale to a reasonable data URL to persist (avoid massive storage). Max side ~2048.
  const maxSide = 2048;
  const iw = underlay.image.width, ih = underlay.image.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const tmp = document.createElement('canvas'); tmp.width = Math.max(2, Math.round(iw*scale)); tmp.height = Math.max(2, Math.round(ih*scale));
  tmp.getContext('2d').drawImage(underlay.image, 0,0,tmp.width,tmp.height);
  const url = tmp.toDataURL('image/png');
  return { type: underlay.type, img: url, worldRect: underlay.worldRect, opacity: underlay.opacity };
}
function restoreUnderlay(data){
  try {
    if(!data || !data.img || !data.worldRect) return;
    const img = new Image(); img.onload = ()=>{ underlay.type = data.type; underlay.image = img; underlay.worldRect = data.worldRect; underlay.opacity = data.opacity ?? 0.85; draw(); };
    img.src = data.img;
  } catch{}
}

// Basic DXF parser (very limited)
function parseDXF(text){
  const lines = text.split(/\r?\n/);
  const ents = []; let i=0; let inENT=false; let cur=null; let section='';
  function next(){ const code = lines[i++]; const val = lines[i++]; return [code, val]; }
  while(i<lines.length){
    const [code, val] = next(); if(code===undefined) break;
    if(code==='0'){
      if(val==='SECTION'){ const [, name] = next(); if(name==='2'){ const [, secName] = next(); section = secName && secName.trim(); }
      } else if(val==='ENDSEC'){ section=''; }
      else if(val==='EOF'){ break; }
      else if(section==='ENTITIES'){
        if(val==='LINE' || val==='LWPOLYLINE' || val==='POLYLINE' || val==='VERTEX' || val==='SEQEND' || val==='CIRCLE'){
          if(val==='LINE'){ cur = { type:'LINE' }; ents.push(cur); }
          else if(val==='CIRCLE'){ cur = { type:'CIRCLE' }; ents.push(cur); }
          else if(val==='LWPOLYLINE'){ cur = { type:'LWPOLYLINE', points:[], closed:false }; ents.push(cur); }
          else if(val==='POLYLINE'){ cur = { type:'POLYLINE', points:[], closed:false }; ents.push(cur); }
          else if(val==='VERTEX'){ cur = { type:'VERTEX' }; ents.push(cur); }
          else if(val==='SEQEND'){ cur = null; }
        } else {
          cur = null;
        }
      } else {
        cur = null;
      }
    } else if(cur){
      const c = parseInt(code,10); const v = parseFloat(val);
      if(cur.type==='LINE'){
        if(c===10) cur.x1 = v; else if(c===20) cur.y1 = v; else if(c===11) cur.x2 = v; else if(c===21) cur.y2 = v;
      } else if(cur.type==='CIRCLE'){
        if(c===10) cur.cx=v; else if(c===20) cur.cy=v; else if(c===40) cur.r=v;
      } else if(cur.type==='LWPOLYLINE'){
        if(c===90) cur.count = v; else if(c===70) cur.closed = (v & 1)===1; else if(c===10){ cur.points.push({ x:v, y:0 }); } else if(c===20){ const last = cur.points[cur.points.length-1]; if(last) last.y = v; }
      } else if(cur.type==='POLYLINE'){
        // closed flag in code 70
        if(c===70) cur.closed = (v & 1)===1;
      } else if(cur.type==='VERTEX'){
        if(c===10){ cur.vx = v; } else if(c===20){ cur.vy=v; }
      }
    }
  }
  // Stitch POLYLINE + VERTEX sequence
  const out = []; let acc=null;
  for(const e of ents){
    if(e.type==='LINE' || e.type==='LWPOLYLINE' || e.type==='CIRCLE'){ out.push(e); }
    else if(e.type==='POLYLINE'){ acc = { type:'LWPOLYLINE', points:[], closed: !!e.closed }; }
    else if(e.type==='VERTEX' && acc){ acc.points.push({ x:e.vx||0, y:e.vy||0 }); }
    else if(e.type==='SEQEND' && acc){ out.push(acc); acc=null; }
  }
  return out;
}

// Pointer handling
let pointersDown = new Map();
function onPointerDown(e){
  canvas.setPointerCapture(e.pointerId);
  const local = eventToLocal(e);
  const world = screenToWorld(local);
  erasing.cursor = { ...world, visible:true };
  pointersDown.set(e.pointerId, { x: local.x, y: local.y });
  // Start pinch zoom for two non-mouse pointers
  if(e.pointerType!=='mouse' && pointersDown.size===2){
    const pts = Array.from(pointersDown.values());
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    pinch.active = true;
    pinch.startDist = Math.max(1e-3, Math.hypot(dx, dy));
    pinch.startScale = view.scale;
    const center = { x: (pts[0].x + pts[1].x)/2, y: (pts[0].y + pts[1].y)/2 };
    pinch.startCenterWorld = screenToWorld(center);
    setStatus('Pinch zoom');
    return;
  }
  // Pan with pan tool, Space, middle, or right mouse
  const isMouseMiddle = (e.pointerType==='mouse' && e.button===1);
  const isMouseRight = (e.pointerType==='mouse' && e.button===2);
  if(spacePanActive || isMouseMiddle || isMouseRight){
    isPanning = true; panStart = { vx: view.x, vy: view.y, sx: local.x, sy: local.y }; canvas.style.cursor='grabbing'; setStatus('Panning'); return;
  }
  if(selectToggle){
    // Priority: handles > object hit > clear
    if(selection.index>=0){
      const h = pickSelectionHandleAt(local);
      if(h){
        pushUndo(); selection.handle = h; selection.startWorld = { ...world }; selection.orig = deepCopyObject(objects[selection.index]); selection.bbox0 = getObjectBBox(selection.orig);
        if(h==='rotate'){ selection.mode='rotate'; } else if(h==='move'){ selection.mode='move'; } else { selection.mode='scale'; }
        return;
      }
    }
    // hit-test objects from top
    const rFeet = 6 / (view.scale * view.pxPerFt);
    let hitIdx = -1;
    for(let i=objects.length-1;i>=0;i--){ const o = objects[i]; const ht = hitTestObject(o, world, rFeet); if(ht && ht.hit){ hitIdx=i; break; } }
    selection.index = hitIdx;
    if(hitIdx>=0){
      const bb = getObjectBBox(objects[hitIdx]);
      if(pointInBBox(world, bb)){ pushUndo(); selection.mode='move'; selection.handle='move'; selection.startWorld = { ...world }; selection.orig = deepCopyObject(objects[hitIdx]); selection.bbox0 = bb; setStatus('Move'); draw(); return; }
      draw(); return;
    } else {
      // empty space
      selection.index=-1; selection.mode=null; selection.handle=null; selection.orig=null; selection.bbox0=null; draw(); return;
    }
  }
  if(tool === 'pen' || tool === 'smart'){
    pushUndo(); drawing = { type:'path', pts:[world], closed:false, stroke, fill, thickness };
  } else if(tool === 'line'){
    pushUndo(); drawing = { type:'line', a: world, b: world, stroke, fill, thickness };
  } else if(tool === 'rect'){
    pushUndo(); drawing = { type:'rect', a: world, b: world, stroke, fill, thickness };
  } else if(tool === 'ellipse'){
    pushUndo(); drawing = { type:'ellipse', a: world, b: world, stroke, fill, thickness };
  } else if(tool === 'text'){
    const text = prompt('Enter text:'); if(text){ pushUndo(); objects.push({ type:'text', p: world, text, stroke, thickness: 1, fill:'#00000000' }); draw(); }
  } else if(tool === 'erase-object'){
    pushUndo();
    eraseObjectAt(world);
    draw(); scheduleSave();
  } else if(tool === 'erase-pixel'){
  pushUndo();
  erasing.active = true; erasing.points = [world];
  rebuildEraseMask();
  draw(); scheduleSave();
  }
}
function onPointerMove(e){
  const local = eventToLocal(e);
  const world = screenToWorld(local);
  if(pointersDown.has(e.pointerId)) pointersDown.set(e.pointerId, { x: local.x, y: local.y });
  // Pinch zoom
  if(pinch.active && pointersDown.size===2){
    const pts = Array.from(pointersDown.values());
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    const dist = Math.max(1e-3, Math.hypot(dx, dy));
    const center = { x: (pts[0].x + pts[1].x)/2, y: (pts[0].y + pts[1].y)/2 };
    const before = pinch.startCenterWorld;
    const scale = Math.max(0.2, Math.min(6, pinch.startScale * (dist / pinch.startDist)));
    view.scale = scale;
    const after = screenToWorld(center);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
  draw(); scheduleSave(); return;
  }
  if(isPanning){
    const s = view.scale * view.pxPerFt;
    view.x = panStart.vx - (local.x - panStart.sx) / s;
    view.y = panStart.vy - (local.y - panStart.sy) / s;
  draw(); scheduleSave(); return;
  }
  if(selectToggle && selection.index>=0 && selection.mode){
    const o0 = selection.orig; if(!o0){ draw(); return; }
    if(selection.mode==='move'){
      const dx = world.x - selection.startWorld.x; const dy = world.y - selection.startWorld.y; objects[selection.index] = moveObject(o0, dx, dy);
      draw(); scheduleSave(); return;
    } else if(selection.mode==='scale'){
      objects[selection.index] = scaleObject(o0, selection.bbox0, selection.handle, world); draw(); scheduleSave(); return;
    } else if(selection.mode==='rotate'){
      const center = getBBoxCenter(selection.bbox0); const a0 = Math.atan2(selection.startWorld.y - center.y, selection.startWorld.x - center.x); const a1 = Math.atan2(world.y - center.y, world.x - center.x); const da = a1 - a0; objects[selection.index] = rotateObject(o0, center, da); draw(); scheduleSave(); return;
    }
  }
  // Object erase: only on click, not on hover/move
  if(tool === 'erase-object'){
    // No-op on move; erase handled on pointerdown only
    erasing.cursor = { ...world, visible:false };
    // fall through to drawing/preview
  }
  // Pixel erase: only while pointer is down (active)
  if(tool === 'erase-pixel'){
    erasing.cursor = { ...world, visible:true };
    if (erasing.active) {
  erasing.points.push(world);
  rebuildEraseMask();
  draw(); scheduleSave(); return;
    }
  }
  if(!drawing) return;
  if(drawing.type==='path') drawing.pts.push(world);
  else if(drawing.type==='line' || drawing.type==='rect' || drawing.type==='ellipse'){
    let b = { ...world };
    // Shift-constrain: lines to axis/45s; rect/ellipse preserve square when Shift
    if(e.shiftKey){
      if(drawing.type==='line'){
        const dx = world.x - drawing.a.x; const dy = world.y - drawing.a.y;
        const angle = Math.atan2(dy, dx);
        const step = Math.PI/4; // 45deg
        const snapped = Math.round(angle/step)*step;
        const len = Math.hypot(dx,dy);
        b = { x: drawing.a.x + Math.cos(snapped)*len, y: drawing.a.y + Math.sin(snapped)*len };
      } else {
        // square circle when shift held
        const dx = world.x - drawing.a.x; const dy = world.y - drawing.a.y;
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        b = { x: drawing.a.x + Math.sign(dx||1)*s, y: drawing.a.y + Math.sign(dy||1)*s };
      }
    }
    drawing.b = b;
  }
  draw(); scheduleSave();
}
function onPointerUp(e){
  try { canvas.releasePointerCapture(e.pointerId); } catch{}
  pointersDown.delete(e.pointerId);
  if(pinch.active && pointersDown.size<2){ pinch.active = false; setStatus('Ready'); }
  if(isPanning && pointersDown.size===0){ isPanning=false; setStatus('Ready'); canvas.style.cursor='default'; }
  if(drawing){
    // If smart tool, try to interpret shape
    if(tool==='smart' && drawing.type==='path'){
      const snapped = smartInterpretPath(drawing.pts);
      if(snapped){ objects.push({ ...snapped, stroke, fill: (snapped.type==='line' ? '#00000000' : fill), thickness }); }
      else { objects.push(drawing); }
    } else {
      objects.push(drawing);
    }
    drawing = null; draw(); scheduleSave();
  }
  if(selectToggle && selection.mode){ selection.mode=null; selection.handle=null; selection.orig=null; }
  if(tool === 'erase-pixel'){
    if(erasing.points && erasing.points.length){ eraseStrokes.push({ pts: erasing.points.slice(), radiusFt: erasing.radiusFt }); }
    erasing.active = false; erasing.cursor.visible=false; erasing.points = [];
    rebuildEraseMask(); draw(); scheduleSave();
  }
}
// Eraser UI
const eraserEl = document.getElementById('eraserRadius');
const eraserVal = document.getElementById('eraserRadiusVal');
if(eraserEl){ eraserEl.addEventListener('input', ()=>{ erasing.radiusFt = Math.max(0.1, Math.min(5, parseFloat(eraserEl.value||'0.5'))); if(eraserVal) eraserVal.textContent = `${erasing.radiusFt.toFixed(2)} ft`; draw(); }); }
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);

// Wheel zoom (desktop)
function handleWheelEvent(e){
  const rect = canvas.getBoundingClientRect();
  // Normalize deltas
  const norm = (val) => (e.deltaMode === 1) ? val * 16 : (e.deltaMode === 2) ? val * rect.height : val;
  const dx = norm(e.deltaX);
  const dyRaw = norm(e.deltaY);
  const s = view.scale * view.pxPerFt;
  // Heuristic: treat as pinch-zoom if ctrlKey is held OR dy is large while dx is minimal (typical precision trackpad pinch)
  const pinchHeuristic = Math.abs(dyRaw) > Math.max(40, rect.height * 0.015) && Math.abs(dx) < 2;
  if (e.ctrlKey || pinchHeuristic) {
    // Pinch-zoom gesture: zoom toward pointer
    const pivot = { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
    const worldBefore = screenToWorld(pivot);
    // Clamp dy to avoid huge jumps
    const dy = Math.max(-800, Math.min(800, dyRaw));
    const z = Math.exp(-dy * 0.001);
    view.scale = Math.max(0.2, Math.min(6, view.scale * z));
    const worldAfter = screenToWorld(pivot);
    view.x += worldBefore.x - worldAfter.x;
    view.y += worldBefore.y - worldAfter.y;
  } else {
    // Two-finger scroll: pan
    view.x += dx / s;
    view.y += dyRaw / s;
  }
  draw(); scheduleSave();
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); handleWheelEvent(e); }, { passive: false });
// Also capture wheel at the document level to fully suppress Chrome page zoom during ctrl+wheel over the canvas
document.addEventListener('wheel', (e) => {
  try {
    const rect = canvas.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;
    const norm = (val) => (e.deltaMode === 1) ? val * 16 : (e.deltaMode === 2) ? val * rect.height : val;
    const dx = norm(e.deltaX);
    const dy = norm(e.deltaY);
    const pinchHeuristic = Math.abs(dy) > Math.max(40, rect.height * 0.015) && Math.abs(dx) < 2;
    if (e.ctrlKey || pinchHeuristic) {
      e.preventDefault();
      handleWheelEvent(e);
    }
  } catch {}
}, { passive: false });

// Keyboard shortcuts
window.addEventListener('keydown', e => {
  if(e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey) && !e.shiftKey && k==='z'){ e.preventDefault(); undo(); }
  else if((e.ctrlKey||e.metaKey) && (e.shiftKey && k==='z')){ e.preventDefault(); redo(); }
  else if(k==='escape') {
    // Quit any tool back to Select: cancel drawings and erasing
    if(drawing){ drawing=null; }
    if(tool==='erase-pixel'){ erasing.active=false; erasing.cursor.visible=false; }
    // Default interaction: disable selection overlay, clear transform, remain in current draw/erase tool
    selectToggle = false; try { const b=document.getElementById('toggle2DSelect'); if(b) b.setAttribute('aria-pressed','false'); } catch{}
    selection.mode=null; selection.handle=null; selection.orig=null; selection.index = -1;
    draw(); setStatus('Ready');
  }
  else if(k==='v') {
    selectToggle = !selectToggle; const b=document.getElementById('toggle2DSelect'); if(b) b.setAttribute('aria-pressed', String(selectToggle)); if(!selectToggle){ selection.index=-1; selection.mode=null; selection.handle=null; selection.orig=null; draw(); }
  }
  else if(k==='h') { /* Hint key for panning, but pan is via middle/right/Space. No state change needed. */ }
  else if(k==='p') setTool('pen');
  else if(k==='s' || (e.shiftKey && k==='p')) setTool('smart');
  else if(k==='l') setTool('line');
  else if(k==='r') setTool('rect');
  else if(k==='o') setTool('ellipse');
  else if(k==='t') setTool('text');
  else if(k==='backspace' || k==='delete'){
    // Delete selected object
    if(selection.index>=0 && selection.index < objects.length){
      e.preventDefault();
      pushUndo();
      objects.splice(selection.index, 1);
      selection.index = -1; selection.mode=null; selection.handle=null; selection.orig=null; selection.bbox0=null;
      setStatus('Deleted');
      draw(); scheduleSave();
    }
  }
  else if(k==='e') setTool(e.shiftKey ? 'erase-object' : 'erase-pixel');
  else if(k==='=') { erasing.radiusFt = Math.min(5, erasing.radiusFt + 0.25); setStatus(`Eraser: ${erasing.radiusFt.toFixed(2)} ft`); }
  else if(k==='-') { erasing.radiusFt = Math.max(0.1, erasing.radiusFt - 0.25); setStatus(`Eraser: ${erasing.radiusFt.toFixed(2)} ft`); }
  else if(k===' ') { spacePanActive = true; setStatus('Panning'); }
});
window.addEventListener('keyup', e => { if(e.key===' ') { spacePanActive = false; if(!isPanning) setStatus('Ready'); } });

// Hook 2D delete bar button
if (mobileDeleteBtn2D) {
  mobileDeleteBtn2D.addEventListener('click', () => {
    if (selection.index>=0 && selection.index < objects.length) {
      pushUndo();
      objects.splice(selection.index, 1);
      selection.index = -1; selection.mode=null; selection.handle=null; selection.orig=null; selection.bbox0=null;
      setStatus('Deleted');
      draw(); scheduleSave();
    }
  });
}

// Touch-action tuning for consistent pen/finger behavior
canvas.style.touchAction = 'none';
canvas.addEventListener('contextmenu', e => e.preventDefault());

setStatus('Ready');
// Wire select toggle button
const selectBtn = document.getElementById('toggle2DSelect');
if(selectBtn){ selectBtn.addEventListener('click', ()=>{ selectToggle = !selectToggle; selectBtn.setAttribute('aria-pressed', String(selectToggle)); if(!selectToggle){ selection.index=-1; selection.mode=null; selection.handle=null; selection.orig=null; draw(); } }); }

// Save to Personal Columbarium (2D)
async function save2DToColumbarium(){
  try {
    const name = prompt('Save sketch as:', 'Untitled Sketch'); if (!name) return;
    // Generate a compact PNG thumbnail
    const thumb = (()=>{ try { const s=0.5; const tmp=document.createElement('canvas'); tmp.width=Math.max(2,Math.round(W/dpr*s)); tmp.height=Math.max(2,Math.round(H/dpr*s)); const c=tmp.getContext('2d'); c.fillStyle='#0b0b0b'; c.fillRect(0,0,tmp.width,tmp.height); c.drawImage(canvas,0,0,tmp.width,tmp.height); return tmp.toDataURL('image/png'); } catch{ return null; } })();
    const data = toJSON();
    const mod = await import('../app/local-store.js');
    const id = await mod.saveSketch2D({ name, json: data, thumb });
    try { sessionStorage.setItem('sketcher:newSceneId', id); } catch{}
    // Navigate to Columbarium
    const url = new URL('../..//columbarium.html', import.meta.url).href;
    document.body.classList.add('page-leave'); setTimeout(()=>{ window.location.href = url; }, 170);
  } catch(e){ console.error(e); alert('Save failed'); }
}
const save2DBtn = document.getElementById('save2D'); if (save2DBtn) save2DBtn.addEventListener('click', ()=>{ save2DToColumbarium(); });

// Floating navigation from 2D
const toColBtn = document.getElementById('toColumbariumFrom2D');
if(toColBtn){ toColBtn.addEventListener('click', (e)=>{ e.preventDefault(); saveToSession(); try { document.body.classList.add('page-leave'); } catch{} const url = new URL('./columbarium.html', location.href); setTimeout(()=>{ window.location.href = url.toString(); }, 170); }); }
const toARBtn2D = document.getElementById('toARFrom2D');
if(toARBtn2D){ toARBtn2D.addEventListener('click', (e)=>{ e.preventDefault(); saveToSession(); try { document.body.classList.add('page-leave'); } catch{} const url = new URL('./index.html', location.href); url.searchParams.set('autoAR','1'); setTimeout(()=>{ window.location.href = url.toString(); }, 170); }); }

// Replace current sketch flow when opening another sketchId: prompt if unsaved changes
window.addEventListener('beforeunload', (e)=>{
  try {
    const cur = sessionStorage.getItem('sketcher:2d');
    const lastSaved = localStorage.getItem('sketcher:2d');
    if (cur && cur !== lastSaved) { e.preventDefault(); e.returnValue = ''; }
  } catch {}
});

// 2D toolbox collapsibles (match 3D pattern)
function wireCollapse(toggleId, groupId){
  const toggle = document.getElementById(toggleId);
  const group = document.getElementById(groupId);
  if(!toggle || !group) return;
  toggle.addEventListener('click', ()=>{
    const open = group.classList.contains('open');
    group.classList.toggle('open', !open);
    group.setAttribute('aria-hidden', open ? 'true' : 'false');
    toggle.setAttribute('aria-pressed', open ? 'false' : 'true');
    // If closing the Draw parent, return to navigation (pan)
    if (groupId === 'draw2DGroup' && open) {
      setTool('pan');
    }
  });
}
// Wire collapsible groups in required order: drawing, shapes, text, style, erase, edit/export
wireCollapse('toggle2DDraw', 'draw2DGroup');
wireCollapse('toggle2DShapes', 'shapes2DGroup');
wireCollapse('toggle2DText', 'text2DGroup');
wireCollapse('toggle2DStyle', 'style2DGroup');
wireCollapse('toggle2DErase', 'erase2DGroup');
wireCollapse('toggle2DEdit', 'edit2DGroup');
