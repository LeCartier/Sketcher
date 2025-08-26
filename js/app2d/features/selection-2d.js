import { getObjectBBox, getBBoxCenter, deepCopyObject } from './geometry-2d.js';

export function drawSelectionOverlay(ctx, view, objects, selection, worldToScreen){
  const o = objects[selection.index]; if(!o) return; const bb = getObjectBBox(o);
  const s = view.scale * view.pxPerFt; const pad = 6 / s;
  const bbp = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad*2, h: bb.h + pad*2 };
  const a = worldToScreen({ x: bbp.x, y: bbp.y }); const b = worldToScreen({ x: bbp.x+bbp.w, y: bbp.y+bbp.h });
  const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y), w=Math.abs(a.x-b.x), h=Math.abs(a.y-b.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,128,255,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4,3]);
  ctx.strokeRect(x,y,w,h);
  const handles = selectionHandlesScreen(view, bbp, worldToScreen);
  ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,128,255,0.95)';
  for(const pt of handles.points){ ctx.beginPath(); ctx.rect(pt.x-4, pt.y-4, 8, 8); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(handles.rotate.x, handles.rotate.y, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo((handles.points[1].x+handles.points[2].x)/2, (handles.points[1].y+handles.points[2].y)/2);
  ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
  ctx.restore();
}

export function selectionHandlesScreen(view, bbw, worldToScreen){
  const corners = [
    { x: bbw.x, y: bbw.y },
    { x: bbw.x + bbw.w/2, y: bbw.y },
    { x: bbw.x + bbw.w, y: bbw.y },
    { x: bbw.x + bbw.w, y: bbw.y + bbw.h/2 },
    { x: bbw.x + bbw.w, y: bbw.y + bbw.h },
    { x: bbw.x + bbw.w/2, y: bbw.y + bbw.h },
    { x: bbw.x, y: bbw.y + bbw.h },
    { x: bbw.x, y: bbw.y + bbw.h/2 }
  ];
  const points = corners.map(p=> worldToScreen(p));
  const topMid = worldToScreen({ x: bbw.x + bbw.w/2, y: bbw.y });
  const rotate = { x: topMid.x, y: topMid.y - 24 };
  return { points, rotate };
}

export function pickSelectionHandleAt(localPt, view, objects, selection, worldToScreen){
  const o = objects[selection.index]; if(!o) return null; const bb = getObjectBBox(o); const s = view.scale * view.pxPerFt; const pad = 6/s; const bbw = { x: bb.x - pad, y: bb.y - pad, w: bb.w + pad*2, h: bb.h + pad*2 };
  const hs = selectionHandlesScreen(view, bbw, worldToScreen);
  const d = Math.hypot(localPt.x - hs.rotate.x, localPt.y - hs.rotate.y);
  // Make rotate easier to grab across DPIs/devices
  if(d <= 14) return 'rotate';
  const names=['nw','n','ne','e','se','s','sw','w'];
  for(let i=0;i<hs.points.length;i++){
    const p = hs.points[i]; if(localPt.x >= p.x-6 && localPt.x <= p.x+6 && localPt.y >= p.y-6 && localPt.y <= p.y+6) return names[i];
  }
  return null;
}

export function moveObject(o0, dx, dy){
  const o = deepCopyObject(o0);
  switch(o.type){
    case 'path': o.pts = o.pts.map(p=>({x:p.x+dx,y:p.y+dy})); break;
    case 'line': o.a={x:o.a.x+dx,y:o.a.y+dy}; o.b={x:o.b.x+dx,y:o.b.y+dy}; break;
    case 'rect': o.a={x:o.a.x+dx,y:o.a.y+dy}; o.b={x:o.b.x+dx,y:o.b.y+dy}; break;
    case 'ellipse': o.a={x:o.a.x+dx,y:o.a.y+dy}; o.b={x:o.b.x+dx,y:o.b.y+dy}; break;
    case 'text': o.p={x:o.p.x+dx,y:o.p.y+dy}; break;
  }
  return o;
}

export function scaleObject(o0, bbox0, handle, world){
  const o = deepCopyObject(o0);
  const bb = { ...bbox0 };
  const minSize = 0.1;
  const left = bb.x, right = bb.x + bb.w, top = bb.y, bottom = bb.y + bb.h;
  let ax, ay; let moveX = false, moveY = false;
  switch(handle){
    case 'nw': ax = right; ay = bottom; moveX = true; moveY = true; break;
    case 'n':  ax = (left+right)/2; ay = bottom; moveY = true; break;
    case 'ne': ax = left; ay = bottom; moveX = true; moveY = true; break;
    case 'e':  ax = left; ay = (top+bottom)/2; moveX = true; break;
    case 'se': ax = left; ay = top; moveX = true; moveY = true; break;
    case 's':  ax = (left+right)/2; ay = top; moveY = true; break;
    case 'sw': ax = right; ay = top; moveX = true; moveY = true; break;
    case 'w':  ax = right; ay = (top+bottom)/2; moveX = true; break;
    default:   ax = (left+right)/2; ay = (top+bottom)/2; moveX = true; moveY = true; break;
  }
  let newLeft = left, newRight = right, newTop = top, newBottom = bottom;
  if(moveX){ if(handle==='w' || handle==='sw' || handle==='nw'){ newLeft = Math.min(world.x, right - minSize); } else if(handle==='e' || handle==='se' || handle==='ne'){ newRight = Math.max(world.x, left + minSize); } }
  if(moveY){ if(handle==='n' || handle==='ne' || handle==='nw'){ newTop = Math.min(world.y, bottom - minSize); } else if(handle==='s' || handle==='se' || handle==='sw'){ newBottom = Math.max(world.y, top + minSize); } }
  const sx = ((handle==='w'||handle==='sw'||handle==='nw') ? (ax - newLeft) : (newRight - ax)) / Math.max(1e-6, (handle==='w'||handle==='sw'||handle==='nw') ? (ax - left) : (right - ax));
  const sy = ((handle==='n'||handle==='ne'||handle==='nw') ? (ay - newTop) : (newBottom - ay)) / Math.max(1e-6, (handle==='n'||handle==='ne'||handle==='nw') ? (ay - top) : (bottom - ay));
  function scalePt(p){ return { x: ax + (p.x - ax) * (moveX ? sx : 1), y: ay + (p.y - ay) * (moveY ? sy : 1) }; }
  switch(o.type){
    case 'path': o.pts = o.pts.map(scalePt); break;
    case 'line': o.a=scalePt(o.a); o.b=scalePt(o.b); break;
    case 'rect': o.a=scalePt(o.a); o.b=scalePt(o.b); break;
    case 'ellipse': o.a=scalePt(o.a); o.b=scalePt(o.b); break;
    case 'text': o.p=scalePt(o.p); break;
  }
  return o;
}

export function rotateObject(o0, center, da){
  const o = deepCopyObject(o0);
  const c = Math.cos(da), s = Math.sin(da);
  const rot = (p)=>{ const dx=p.x-center.x, dy=p.y-center.y; return { x: center.x + dx*c - dy*s, y: center.y + dx*s + dy*c }; };
  switch(o.type){
    case 'path': {
      o.pts = o.pts.map(rot); return o;
    }
    case 'line': {
      o.a = rot(o.a); o.b = rot(o.b); return o;
    }
    case 'rect': {
      // Convert to a closed path with 4 rotated corners so visual rotation is preserved
      const x1 = Math.min(o.a.x, o.b.x), y1 = Math.min(o.a.y, o.b.y);
      const x2 = Math.max(o.a.x, o.b.x), y2 = Math.max(o.a.y, o.b.y);
      const corners = [
        { x: x1, y: y1 }, // tl
        { x: x2, y: y1 }, // tr
        { x: x2, y: y2 }, // br
        { x: x1, y: y2 }  // bl
      ].map(rot);
      return { type:'path', pts: corners, closed: true, stroke: o.stroke, fill: o.fill, thickness: o.thickness };
    }
    case 'ellipse': {
      // Approximate rotated ellipse as a closed polyline
      const cx = (o.a.x + o.b.x) / 2, cy = (o.a.y + o.b.y) / 2; const rx = Math.abs(o.a.x - o.b.x) / 2, ry = Math.abs(o.a.y - o.b.y) / 2;
      const N = 48; const pts = [];
      for(let i=0;i<N;i++){
        const t = (i / N) * Math.PI * 2;
        const px = cx + rx * Math.cos(t);
        const py = cy + ry * Math.sin(t);
        pts.push(rot({ x: px, y: py }));
      }
      return { type:'path', pts, closed: true, stroke: o.stroke, fill: o.fill, thickness: o.thickness };
    }
    case 'text': {
      // Rotate anchor only; text glyphs remain screen-aligned by design
      o.p = rot(o.p); return o;
    }
  }
  return o;
}

export { getObjectBBox, getBBoxCenter };
