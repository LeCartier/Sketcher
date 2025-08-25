// Smart Draw recognition utilities (pure functions)
// Export: smartInterpretPath(pts)

export function smartInterpretPath(pts){
  if(!pts || pts.length < 3) return null;
  const N = Math.max(1, Math.floor(pts.length/64));
  const sp = pts.filter((_,i)=> i%N===0);
  const xs = sp.map(p=>p.x), ys = sp.map(p=>p.y);
  const minx=Math.min(...xs), maxx=Math.max(...xs), miny=Math.min(...ys), maxy=Math.max(...ys);
  const w=maxx-minx, h=maxy-miny;
  const cx = (minx+maxx)/2, cy=(miny+maxy)/2;
  const line = fitLine(sp);
  const lineResidual = avgLineResidual(sp, line);
  const diag = Math.hypot(w,h) || 1;
  if(lineResidual/diag < 0.045 && diag > 0.25){
    return { type:'line', a: sp[0], b: sp[sp.length-1] };
  }
  const circ = fitCircle(cx, cy, sp);
  const rVar = radiusVariance(sp, circ.cx, circ.cy);
  const closure = Math.hypot(sp[0].x - sp[sp.length-1].x, sp[0].y - sp[sp.length-1].y) / (Math.max(w,h)||1);
  if(rVar/(circ.r||1) < 0.12 && closure < 0.55 && circ.r > 0.15){
    return { type:'ellipse', a: { x: circ.cx - circ.r, y: circ.cy - circ.r }, b: { x: circ.cx + circ.r, y: circ.cy + circ.r } };
  }
  if(closure < 0.55){
    const angs = segmentAngles(sp);
    const score = rectAngleScore(angs);
    if(score > 0.52){
      return { type:'rect', a: { x: minx, y: miny }, b: { x: maxx, y: maxy } };
    }
  }
  return null;
}

function fitLine(pts){
  const n=pts.length; let sx=0, sy=0, sxx=0, sxy=0; for(const p of pts){ sx+=p.x; sy+=p.y; sxx+=p.x*p.x; sxy+=p.x*p.y; }
  const denom = n*sxx - sx*sx; if(Math.abs(denom) < 1e-6){ return { vertical:true, x: pts[0].x, m:0, b:0 }; }
  const m = (n*sxy - sx*sy) / denom; const b = (sy - m*sx)/n; return { m, b, vertical:false };
}
function avgLineResidual(pts, line){
  let sum=0; if(line.vertical){ const x0=line.x; for(const p of pts){ sum += Math.abs(p.x - x0); } return sum/pts.length; }
  const {m,b} = line; for(const p of pts){ const yhat = m*p.x + b; sum += Math.abs(p.y - yhat); } return sum/pts.length;
}
function fitCircle(cx, cy, pts){ let r=0; for(const p of pts){ r += Math.hypot(p.x-cx, p.y-cy); } r/=pts.length; return { cx, cy, r }; }
function radiusVariance(pts, cx, cy){ let sum=0, sum2=0; for(const p of pts){ const d=Math.hypot(p.x-cx,p.y-cy); sum+=d; sum2+=d*d; } const n=pts.length; const mean=sum/n; return Math.max(0, Math.sqrt(Math.max(0, sum2/n - mean*mean))); }
function segmentAngles(pts){ const angs=[]; for(let i=1;i<pts.length;i++){ const dx=pts[i].x-pts[i-1].x, dy=pts[i].y-pts[i-1].y; if(Math.hypot(dx,dy)<1e-6) continue; let a=Math.atan2(dy,dx); a=Math.abs(a); a = Math.min(a, Math.PI - a); angs.push(a); } return angs; }
function rectAngleScore(angs){ if(!angs.length) return 0; const good = angs.filter(a=>{ const deg=a*180/Math.PI; return (deg<10 || Math.abs(90-deg)<10); }).length; return good/angs.length; }
