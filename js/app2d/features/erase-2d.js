import { distToSegment } from './geometry-2d.js';

export function hitTestObject(o, p, radius){
  switch(o.type){
    case 'path': {
      for(let i=1;i<o.pts.length;i++){
        if(distToSegment(p, o.pts[i-1], o.pts[i]) <= Math.max(radius, o.thickness/2)) return {hit:true, seg:i-1};
      }
      // If closed, also test the closing edge from last to first
      if(o.closed && o.pts.length>2){
        if(distToSegment(p, o.pts[o.pts.length-1], o.pts[0]) <= Math.max(radius, o.thickness/2)) return {hit:true, seg:o.pts.length-1};
      }
      return {hit:false};
    }
    case 'line': { const d = distToSegment(p, o.a, o.b); return { hit: d <= Math.max(radius, o.thickness/2) }; }
    case 'rect': {
      const a={x:Math.min(o.a.x,o.b.x),y:Math.min(o.a.y,o.b.y)}, b={x:Math.max(o.a.x,o.b.x),y:Math.max(o.a.y,o.b.y)};
      const segs=[[{x:a.x,y:a.y},{x:b.x,y:a.y}],[{x:b.x,y:a.y},{x:b.x,y:b.y}],[{x:b.x,y:b.y},{x:a.x,y:b.y}],[{x:a.x,y:b.y},{x:a.x,y:a.y}]];
      const ok = segs.some(([s,e])=> distToSegment(p,s,e) <= Math.max(radius, o.thickness/2));
      return { hit: ok };
    }
    case 'ellipse': {
      const cx=(o.a.x+o.b.x)/2, cy=(o.a.y+o.b.y)/2, rx=Math.abs(o.a.x-o.b.x)/2, ry=Math.abs(o.a.y-o.b.y)/2;
      if(rx<1e-3||ry<1e-3) return {hit:false};
      const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; const d=Math.abs(dx*dx+dy*dy-1);
      return { hit: d <= Math.max(0.05, radius/(Math.max(rx,ry)||1)) };
    }
    case 'text': { const d = Math.hypot((p.x-o.p.x),(p.y-o.p.y)); return { hit: d <= Math.max(radius, 0.5) }; }
  }
  return {hit:false};
}

export function eraseObjectAt(objects, p, radius){
  for(let i=objects.length-1;i>=0;i--){
    const o = objects[i]; const ht = hitTestObject(o, p, radius); if(!ht.hit) continue; objects.splice(i,1); return true;
  }
  return false;
}

export function erasePixelAt(objects, p, radius){
  for(let i=objects.length-1;i>=0;i--){
    const o = objects[i];
    if(o.type==='path'){
      const keep = o.pts.map(pt => Math.hypot(pt.x-p.x, pt.y-p.y) > radius);
      if(keep.every(v=>v)) continue;
      const parts = []; let cur = [];
      for(let k=0;k<o.pts.length;k++){
        if(keep[k]){ cur.push(o.pts[k]); }
        else { if(cur.length>1) { parts.push(cur); } cur = []; }
      }
      if(cur.length>1) parts.push(cur);
      objects.splice(i,1);
      for(let pi=parts.length-1; pi>=0; pi--){ objects.splice(i,0,{...o, pts: parts[pi]}); }
    } else if(o.type==='line'){
      const hit = distToSegment(p, o.a, o.b) <= Math.max(radius, o.thickness/2);
      if(hit){
        const ax=o.a.x, ay=o.a.y, bx=o.b.x, by=o.b.y; const vx=bx-ax, vy=by-ay; const len2=vx*vx+vy*vy; if(len2<1e-6){ objects.splice(i,1); continue; }
        const t = ((p.x-ax)*vx + (p.y-ay)*vy)/len2; const tcut = Math.max(0, Math.min(1, t));
        const cutLen = (radius / Math.sqrt(len2)) * 2;
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
      if(edges.some(([s,e])=> distToSegment(p,s,e) <= Math.max(radius, o.thickness/2))){ objects.splice(i,1); }
    } else if(o.type==='ellipse'){
      const cx=(o.a.x+o.b.x)/2, cy=(o.a.y+o.b.y)/2, rx=Math.abs(o.a.x-o.b.x)/2, ry=Math.abs(o.a.y-o.b.y)/2;
      if(rx<1e-3||ry<1e-3) { objects.splice(i,1); continue; }
      const dx=(p.x-cx)/rx, dy=(p.y-cy)/ry; const d=Math.abs(dx*dx+dy*dy-1);
      if(d <= Math.max(0.05, radius/(Math.max(rx,ry)||1))) objects.splice(i,1);
    } else if(o.type==='text'){
      if(Math.hypot(o.p.x-p.x, o.p.y-p.y) <= Math.max(radius, 0.5)) objects.splice(i,1);
    }
  }
}
