// Geometry helpers used by 2D editor (pure functions)

export function distToSegment(p, a, b){
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx*wx + vy*wy; if(c1<=0) return Math.hypot(p.x-a.x, p.y-a.y);
  const c2 = vx*vx + vy*vy; if(c2<=c1) return Math.hypot(p.x-b.x, p.y-b.y);
  const t = c1/c2; const proj = { x: a.x + t*vx, y: a.y + t*vy };
  return Math.hypot(p.x-proj.x, p.y-proj.y);
}
export function pointInRect(p, a, b){ const x1=Math.min(a.x,b.x), y1=Math.min(a.y,b.y), x2=Math.max(a.x,b.x), y2=Math.max(a.y,b.y); return p.x>=x1 && p.x<=x2 && p.y>=y1 && p.y<=y2; }
export function pointInEllipse(p, a, b){ const cx=(a.x+b.x)/2, cy=(a.y+b.y)/2, rx=Math.abs(a.x-b.x)/2, ry=Math.abs(a.y-b.y)/2; if(rx<1e-6||ry<1e-6) return false; const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; return dx*dx+dy*dy<=1; }
export function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
export function getObjectBBox(o){
  switch(o.type){
    case 'path': { const xs = o.pts.map(p=>p.x), ys=o.pts.map(p=>p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs)-Math.min(...xs), h: Math.max(...ys)-Math.min(...ys) }; }
    case 'line': { const x1=Math.min(o.a.x,o.b.x), y1=Math.min(o.a.y,o.b.y), x2=Math.max(o.a.x,o.b.x), y2=Math.max(o.a.y,o.b.y); return { x:x1, y:y1, w:x2-x1, h:y2-y1 }; }
    case 'rect': { const x1=Math.min(o.a.x,o.b.x), y1=Math.min(o.a.y,o.b.y), x2=Math.max(o.a.x,o.b.x), y2=Math.max(o.a.y,o.b.y); return { x:x1, y:y1, w:x2-x1, h:y2-y1 }; }
    case 'ellipse': { const x1=Math.min(o.a.x,o.b.x), y1=Math.min(o.a.y,o.b.y), x2=Math.max(o.a.x,o.b.x), y2=Math.max(o.a.y,o.b.y); return { x:x1, y:y1, w:x2-x1, h:y2-y1 }; }
    case 'text': return { x:o.p.x, y:o.p.y, w:0, h:0 };
  }
  return { x:0,y:0,w:0,h:0 };
}
export function getBBoxCenter(bb){ return { x: bb.x + bb.w/2, y: bb.y + bb.h/2 }; }
export function pointInBBox(p, bb){ return p.x>=bb.x && p.x<=bb.x+bb.w && p.y>=bb.y && p.y<=bb.y+bb.h; }
export function deepCopyObject(o){ return JSON.parse(JSON.stringify(o)); }
