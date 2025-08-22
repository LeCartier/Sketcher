// Sketcher 2D: lightweight, pointer-friendly 2D drawing canvas
// Supports mouse, touch, and stylus (including Apple Pencil) via Pointer Events.

const canvas = document.getElementById('grid2d');
const ctx = canvas.getContext('2d');
const dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;

// State
let tool = 'select'; // select | pan | pen | line | rect | ellipse | text | erase-object | erase-pixel
let stroke = '#111111';
let fill = '#00000000';
let thickness = 2;
let statusEl = document.getElementById('statusBar');
let isPanning = false;
let panStart = { vx: 0, vy: 0, sx: 0, sy: 0 };
// 2D view: x,y in feet; scale is zoom factor; pxPerFt controls screen mapping
let view = { x: 0, y: 0, scale: 1, pxPerFt: 20 };
// Realtime broadcast channel to 3D (and any listeners)
const bc2D = (typeof window !== 'undefined' && 'BroadcastChannel' in window) ? new BroadcastChannel('sketcher-2d') : null;
let drawing = null; // active draft object
const objects = []; // drawn shapes
const undoStack = []; const redoStack = []; const undoLimit = 100;
let spacePanActive = false; // hold Space to pan temporarily
let pinch = { active:false, startDist:0, startScale:1, startCenterWorld:{x:0,y:0} };
// Erase state
const erasing = { active:false, radiusFt: 0.5, points: [], cursor:{x:0,y:0,visible:false} }; // radius in feet

function setStatus(msg){ if(statusEl) statusEl.textContent = msg; }

function resize(){
  // Preserve the world point at the screen center during resize
  const r = canvas.getBoundingClientRect();
  const centerBefore = { x: r.width/2, y: r.height/2 };
  const worldCenterBefore = screenToWorld(centerBefore);
  W = Math.max(1, Math.round(r.width * dpr));
  H = Math.max(1, Math.round(r.height * dpr));
  canvas.width = W; canvas.height = H;
  // Adjust view to keep the same world point at the new screen center
  const r2 = canvas.getBoundingClientRect();
  const worldCenterAfter = screenToWorld({ x: r2.width/2, y: r2.height/2 });
  view.x += worldCenterBefore.x - worldCenterAfter.x;
  view.y += worldCenterBefore.y - worldCenterAfter.y;
  draw();
}
window.addEventListener('resize', resize);
resize();

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

function drawObjects(){
  for(const o of objects){ drawObject(o); }
}
function drawObject(o){
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = o.stroke; ctx.lineWidth = Math.max(0.5, o.thickness * view.scale);
  ctx.fillStyle = o.fill || 'transparent';
  switch(o.type){
    case 'path': {
      ctx.beginPath();
      for(let i=0;i<o.pts.length;i++){
        const p = worldToScreen(o.pts[i]);
        if(i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      if(o.closed) ctx.closePath();
      if(o.fill && o.fill !== '#00000000') ctx.fill();
      ctx.stroke();
      break;
    }
    case 'line': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      break;
    }
    case 'rect': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y), w = Math.abs(a.x-b.x), h = Math.abs(a.y-b.y);
      if(o.fill && o.fill !== '#00000000'){ ctx.fillRect(x,y,w,h); }
      ctx.strokeRect(x,y,w,h); break;
    }
    case 'ellipse': {
      const a = worldToScreen(o.a); const b = worldToScreen(o.b);
      const cx = (a.x+b.x)/2, cy=(a.y+b.y)/2; const rx = Math.abs(a.x-b.x)/2, ry = Math.abs(a.y-b.y)/2;
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
      if(o.fill && o.fill !== '#00000000') ctx.fill();
      ctx.stroke(); break;
    }
    case 'text': {
  const p = worldToScreen(o.p);
  ctx.fillStyle = o.stroke; ctx.font = `${Math.round(14*view.scale)}px system-ui, sans-serif`;
      ctx.fillText(o.text||'', p.x, p.y);
      break;
    }
  }
  ctx.restore();
}

// --- Hit-testing and geometry utils for erase ---
function distToSegment(p, a, b){
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx*wx + vy*wy; if(c1<=0) return Math.hypot(p.x-a.x, p.y-a.y);
  const c2 = vx*vx + vy*vy; if(c2<=c1) return Math.hypot(p.x-b.x, p.y-b.y);
  const t = c1/c2; const proj = { x: a.x + t*vx, y: a.y + t*vy };
  return Math.hypot(p.x-proj.x, p.y-proj.y);
}
function pointInRect(p, a, b){ const x1=Math.min(a.x,b.x), y1=Math.min(a.y,b.y), x2=Math.max(a.x,b.x), y2=Math.max(a.y,b.y); return p.x>=x1 && p.x<=x2 && p.y>=y1 && p.y<=y2; }
function pointInEllipse(p, a, b){ const cx=(a.x+b.x)/2, cy=(a.y+b.y)/2, rx=Math.abs(a.x-b.x)/2, ry=Math.abs(a.y-b.y)/2; if(rx<1e-6||ry<1e-6) return false; const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; return dx*dx+dy*dy<=1; }

function hitTestObject(o, p, radius){
  switch(o.type){
    case 'path': {
      // Check distance to each stroke segment
      for(let i=1;i<o.pts.length;i++){
        if(distToSegment(p, o.pts[i-1], o.pts[i]) <= Math.max(radius, o.thickness/2)) return {hit:true, seg:i-1};
      }
      return {hit:false};
    }
    case 'line': {
      const d = distToSegment(p, o.a, o.b);
      return { hit: d <= Math.max(radius, o.thickness/2) };
    }
    case 'rect': {
      // Erase on edge: check to edges similar to line
      const a={x:Math.min(o.a.x,o.b.x),y:Math.min(o.a.y,o.b.y)}, b={x:Math.max(o.a.x,o.b.x),y:Math.max(o.a.y,o.b.y)};
      const segs=[[{x:a.x,y:a.y},{x:b.x,y:a.y}],[{x:b.x,y:a.y},{x:b.x,y:b.y}],[{x:b.x,y:b.y},{x:a.x,y:b.y}],[{x:a.x,y:b.y},{x:a.x,y:a.y}]];
      const ok = segs.some(([s,e])=> distToSegment(p,s,e) <= Math.max(radius, o.thickness/2));
      return { hit: ok };
    }
    case 'ellipse': {
      // Approximate: consider within stroke band
      const cx=(o.a.x+o.b.x)/2, cy=(o.a.y+o.b.y)/2, rx=Math.abs(o.a.x-o.b.x)/2, ry=Math.abs(o.a.y-o.b.y)/2;
      if(rx<1e-3||ry<1e-3) return {hit:false};
      const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; const d=Math.abs(dx*dx+dy*dy-1);
      return { hit: d <= Math.max(0.05, radius/(Math.max(rx,ry)||1)) };
    }
    case 'text': {
      // Remove text on direct click within a small radius
      const d = Math.hypot((p.x-o.p.x),(p.y-o.p.y));
      return { hit: d <= Math.max(radius, 0.5) };
    }
  }
  return {hit:false};
}

function eraseObjectAt(p){
  const r = erasing.radiusFt;
  for(let i=objects.length-1;i>=0;i--){
    const o = objects[i];
    const ht = hitTestObject(o, p, r);
    if(!ht.hit) continue;
    // For paths, split instead of full delete if erasing pixel-wise is desired
    if(o.type==='path'){
      // remove the touching segment to create up to two paths
      const idx = ht.seg;
      if(idx!=null){
        const left = o.pts.slice(0, idx+1);
        const right = o.pts.slice(idx+1);
        // discard a small gap around the erased point
        const gap = 1; // one vertex on each side
        const leftTrim = left.slice(0, Math.max(1, left.length-gap));
        const rightTrim = right.slice(Math.min(gap, right.length-1));
        objects.splice(i,1);
        if(leftTrim.length>1) objects.splice(i,0,{...o, pts:leftTrim});
        if(rightTrim.length>1) objects.splice(i+(leftTrim.length>1?1:0),0,{...o, pts:rightTrim});
        return;
      }
    }
    // Else, remove object entirely
    objects.splice(i,1);
    return;
  }
}

function erasePixelAt(p){
  const r = erasing.radiusFt;
  for(let i=objects.length-1;i>=0;i--){
    const o = objects[i];
    if(o.type==='path'){
      // Filter path points: remove those within radius; split into multiple paths across removed spans
      const keep = o.pts.map(pt => Math.hypot(pt.x-p.x, pt.y-p.y) > r);
      if(keep.every(v=>v)) continue;
      const parts = [];
      let cur = [];
      for(let k=0;k<o.pts.length;k++){
        if(keep[k]){ cur.push(o.pts[k]); }
        else { if(cur.length>1) { parts.push(cur); } cur = []; }
      }
      if(cur.length>1) parts.push(cur);
      objects.splice(i,1);
      for(let pi=parts.length-1; pi>=0; pi--){ objects.splice(i,0,{...o, pts: parts[pi]}); }
    } else if(o.type==='line'){
      const hit = distToSegment(p, o.a, o.b) <= Math.max(r, o.thickness/2);
      if(hit){
        // Clip out a small segment around the erase point: split line into two if possible
        const ax=o.a.x, ay=o.a.y, bx=o.b.x, by=o.b.y; const vx=bx-ax, vy=by-ay; const len2=vx*vx+vy*vy; if(len2<1e-6){ objects.splice(i,1); continue; }
        const t = ((p.x-ax)*vx + (p.y-ay)*vy)/len2; const tcut = Math.max(0, Math.min(1, t));
        const cutLen = (r / Math.sqrt(len2)) * 2; // parametric length to remove
        const t1 = Math.max(0, tcut - cutLen);
        const t2 = Math.min(1, tcut + cutLen);
        const P1 = { x: ax + vx*t1, y: ay + vy*t1 };
        const P2 = { x: ax + vx*t2, y: ay + vy*t2 };
        objects.splice(i,1);
        if(t1>0.01) objects.splice(i,0,{...o, a:o.a, b:P1});
        if(t2<0.99) objects.splice(i,0,{...o, a:P2, b:o.b});
      }
    } else if(o.type==='rect'){
      const a={x:Math.min(o.a.x,o.b.x),y:Math.min(o.a.y,o.b.y)}, b={x:Math.max(o.a.x,o.b.x),y:Math.max(o.a.y,o.b.y)};
      const edges=[[{x:a.x,y:a.y},{x:b.x,y:a.y}],[{x:b.x,y:a.y},{x:b.x,y:b.y}],[{x:b.x,y:b.y},{x:a.x,y:b.y}],[{x:a.x,y:b.y},{x:a.x,y:a.y}]];
      if(edges.some(([s,e])=> distToSegment(p,s,e) <= Math.max(r, o.thickness/2))){ objects.splice(i,1); }
    } else if(o.type==='ellipse'){
      const cx=(o.a.x+o.b.x)/2, cy=(o.a.y+o.b.y)/2, rx=Math.abs(o.a.x-o.b.x)/2, ry=Math.abs(o.a.y-o.b.y)/2;
      if(rx<1e-3||ry<1e-3) { objects.splice(i,1); continue; }
      const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; const d=Math.abs(dx*dx+dy*dy-1);
      if(d <= Math.max(0.05, r/(Math.max(rx,ry)||1))) objects.splice(i,1);
    } else if(o.type==='text'){
      if(Math.hypot(o.p.x-p.x, o.p.y-p.y) <= Math.max(r, 0.5)) objects.splice(i,1);
    }
  }
}

function draw(){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,W,H);
  drawGrid();
  drawObjects();
  if(drawing) drawObject(drawing);
  // brush cursor
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

// UI wiring
function setTool(id){
  tool = id; setStatus(`Tool: ${id}`);
  const ids = ['tSelect','tPan','tPen','tLine','tRect','tEllipse','tText','tEraseObj','tErasePix'];
  ids.forEach(i => { const el = document.getElementById(i); if(!el) return; const map = { tSelect:'select', tPan:'pan', tPen:'pen', tLine:'line', tRect:'rect', tEllipse:'ellipse', tText:'text', tEraseObj:'erase-object', tErasePix:'erase-pixel' }; el.setAttribute('aria-pressed', String(map[i]===id)); });
}
['tSelect','tPan','tPen','tLine','tRect','tEllipse','tText','tEraseObj','tErasePix'].forEach(id => {
  const el = document.getElementById(id); if(!el) return; el.addEventListener('click',()=>{
    const map = { tSelect:'select', tPan:'pan', tPen:'pen', tLine:'line', tRect:'rect', tEllipse:'ellipse', tText:'text', tEraseObj:'erase-object', tErasePix:'erase-pixel' };
    const targetTool = map[id];
    // Toggle behavior: clicking the active tool returns to Select
    if (tool === targetTool) { setTool('select'); }
    else { setTool(targetTool); }
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
function pushUndo(){ try { const snapshot = JSON.stringify(objects); undoStack.push(snapshot); if(undoStack.length>undoLimit) undoStack.shift(); redoStack.length = 0; } catch{} }
function undo(){ if(!undoStack.length) return; const snap = undoStack.pop(); redoStack.push(JSON.stringify(objects)); const list = JSON.parse(snap||'[]'); objects.length = 0; objects.push(...list); draw(); }
function redo(){ if(!redoStack.length) return; const snap = redoStack.pop(); if(snap){ undoStack.push(JSON.stringify(objects)); const list = JSON.parse(snap||'[]'); objects.length = 0; objects.push(...list); draw(); } }
function clearAll(){
  if(!objects.length) { draw(); scheduleSave(); return; }
  pushUndo();
  objects.length = 0;
  draw();
  // Persist and broadcast immediately so 3D can reset overlay to center
  try { if (bc2D) bc2D.postMessage(toJSON()); } catch{}
  try { sessionStorage.setItem('sketcher:2d', JSON.stringify(toJSON())); localStorage.setItem('sketcher:2d', JSON.stringify(toJSON())); } catch{}
}

const undoBtn = document.getElementById('undo'); if(undoBtn) undoBtn.addEventListener('click', undo);
const redoBtn = document.getElementById('redo'); if(redoBtn) redoBtn.addEventListener('click', redo);
const clearBtn = document.getElementById('clear'); if(clearBtn) clearBtn.addEventListener('click', clearAll);

// Export (PNG/SVG) + JSON save for 3D projection handoff
function exportPNG(){ const tmp = document.createElement('canvas'); const s = 2; tmp.width = Math.round(W/dpr*s); tmp.height = Math.round(H/dpr*s); const c = tmp.getContext('2d'); c.scale(s, s); // device independent
  // Background white for PNG readability
  c.fillStyle = '#fff'; c.fillRect(0,0,tmp.width,tmp.height);
  // Re-draw grid light (optional)
  c.fillStyle = '#fff';
  // Draw objects in view space
  c.save(); c.scale(1,1);
  // approximate: reuse render (not pixel-perfect vs. view)
  c.drawImage(canvas, 0,0, tmp.width, tmp.height);
  c.restore();
  const a = document.createElement('a'); a.href = tmp.toDataURL('image/png'); a.download = 'sketch2d.png'; a.click(); }
function exportSVG(){
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>','<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%" viewBox="0 0 '+(W/dpr)+' '+(H/dpr)+'">'];
  for(const o of objects){
    switch(o.type){
      case 'path': {
        const d = o.pts.map((p,i)=> (i?'L':'M') + ((p.x - view.x)) + ' ' + ((p.y - view.y))).join(' ');
        parts.push(`<path d="${d}" stroke="${o.stroke}" stroke-width="${o.thickness}" fill="${o.fill||'none'}" stroke-linecap="round" stroke-linejoin="round"/>`);
        break;
      }
      case 'line': parts.push(`<line x1="${o.a.x - view.x}" y1="${o.a.y - view.y}" x2="${o.b.x - view.x}" y2="${o.b.y - view.y}" stroke="${o.stroke}" stroke-width="${o.thickness}"/>`); break;
      case 'rect': {
        const x = Math.min(o.a.x, o.b.x) - view.x; const y = Math.min(o.a.y, o.b.y) - view.y; const w = Math.abs(o.a.x - o.b.x); const h = Math.abs(o.a.y - o.b.y);
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill||'none'}" stroke="${o.stroke}" stroke-width="${o.thickness}"/>`);
        break;
      }
      case 'ellipse': {
        const cx = (o.a.x + o.b.x)/2 - view.x; const cy = (o.a.y + o.b.y)/2 - view.y; const rx = Math.abs(o.a.x - o.b.x)/2; const ry = Math.abs(o.a.y - o.b.y)/2;
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.fill||'none'}" stroke="${o.stroke}" stroke-width="${o.thickness}"/>`);
        break;
      }
      case 'text': parts.push(`<text x="${o.p.x - view.x}" y="${o.p.y - view.y}" fill="${o.stroke}">${(o.text||'')}</text>`); break;
    }
  }
  parts.push('</svg>');
  const blob = new Blob([parts.join('\n')], {type:'image/svg+xml'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'sketch2d.svg'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
const exportPNGBtn = document.getElementById('exportPNG'); if(exportPNGBtn) exportPNGBtn.addEventListener('click', exportPNG);
const exportSVGBtn = document.getElementById('exportSVG'); if(exportSVGBtn) exportSVGBtn.addEventListener('click', exportSVG);

// JSON serialize for projection
function toJSON(){
  // Preserve createdAt if present; always bump updatedAt
  let createdAt = Date.now();
  try {
    const prev = localStorage.getItem('sketcher:2d') || sessionStorage.getItem('sketcher:2d');
    if (prev) { const d = JSON.parse(prev); if (d && d.meta && d.meta.createdAt) createdAt = d.meta.createdAt; }
  } catch {}
  return { view, objects, meta: { units: 'feet', createdAt, updatedAt: Date.now() } };
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
(function restore2D(){ try { const raw = sessionStorage.getItem('sketcher:2d'); if(raw){ const data = JSON.parse(raw); if(data && Array.isArray(data.objects)){ objects.length=0; objects.push(...data.objects); if(data.view){ view = { ...view, ...data.view }; } draw(); } } } catch {} })();

// Pointer handling
let pointersDown = new Map();
function onPointerDown(e){
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;
  const local = { x: px/dpr, y: py/dpr };
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
  if(tool === 'pan' || spacePanActive || isMouseMiddle || isMouseRight){
    isPanning = true; panStart = { vx: view.x, vy: view.y, sx: local.x, sy: local.y }; canvas.style.cursor='grabbing'; setStatus('Panning'); return;
  }
  if(tool === 'pen'){
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
    erasePixelAt(world);
    draw(); scheduleSave();
  }
}
function onPointerMove(e){
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;
  const local = { x: px/dpr, y: py/dpr };
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
      erasePixelAt(world);
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
  if(drawing){ objects.push(drawing); drawing = null; draw(); scheduleSave(); }
  if(tool === 'erase-pixel'){ erasing.active = false; erasing.cursor.visible=false; draw(); }
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
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  // Zoom around screen center to reduce perceived recentering
  const center = { x: rect.width/2, y: rect.height/2 };
  const worldBefore = screenToWorld(center);
  const z = Math.exp(-e.deltaY * 0.001);
  view.scale = Math.max(0.2, Math.min(6, view.scale * z));
  const worldAfter = screenToWorld(center);
  view.x += worldBefore.x - worldAfter.x;
  view.y += worldBefore.y - worldAfter.y;
  draw(); scheduleSave();
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
    if(tool!=='select'){ setTool('select'); }
    draw(); setStatus('Ready');
  }
  else if(k==='v') setTool('select');
  else if(k==='h') setTool('pan');
  else if(k==='p') setTool('pen');
  else if(k==='l') setTool('line');
  else if(k==='r') setTool('rect');
  else if(k==='o') setTool('ellipse');
  else if(k==='t') setTool('text');
  else if(k==='e') setTool(e.shiftKey ? 'erase-object' : 'erase-pixel');
  else if(k==='=') { erasing.radiusFt = Math.min(5, erasing.radiusFt + 0.25); setStatus(`Eraser: ${erasing.radiusFt.toFixed(2)} ft`); }
  else if(k==='-') { erasing.radiusFt = Math.max(0.1, erasing.radiusFt - 0.25); setStatus(`Eraser: ${erasing.radiusFt.toFixed(2)} ft`); }
  else if(k===' ') { spacePanActive = true; setStatus('Panning'); }
});
window.addEventListener('keyup', e => { if(e.key===' ') { spacePanActive = false; if(!isPanning) setStatus('Ready'); } });

// Touch-action tuning for consistent pen/finger behavior
canvas.style.touchAction = 'none';
canvas.addEventListener('contextmenu', e => e.preventDefault());

setStatus('Ready');

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
  });
}
// Wire collapsible groups in required order: drawing, shapes, text, style, erase, tools, edit/export
wireCollapse('toggle2DDraw', 'draw2DGroup');
wireCollapse('toggle2DShapes', 'shapes2DGroup');
wireCollapse('toggle2DText', 'text2DGroup');
wireCollapse('toggle2DStyle', 'style2DGroup');
wireCollapse('toggle2DErase', 'erase2DGroup');
wireCollapse('toggle2DTools', 'tools2DGroup');
wireCollapse('toggle2DEdit', 'edit2DGroup');
