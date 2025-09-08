// Snapping utilities extracted from app.js
// Computes soft snapping delta between a moving AABB and others' AABBs.

/**
 * @param {any} THREE - three.js module
 * @param {THREE.Box3} movingBox - World-space AABB of the moving object
 * @param {Array} others - Array of THREE.Object3D to consider as snap targets
 * @param {Set<THREE.Object3D>} excludeSet - Objects to exclude
 * @param {number} SNAP_ENTER - distance within which to begin snapping
 * @param {number} SNAP_OVERLAP - maximum negative overlap still considered snapping
 * @returns {{ delta: any, axis: string|null, other: any, otherBox: any, movingFace: string|null, otherFace: string|null }}
 */
// options: { axisPreference: 'x'|'y'|'z'|null, minOverlapAbs?: number, overlapFrac?: number }
export function computeSnapDelta(THREE, movingBox, others, excludeSet = new Set(), SNAP_ENTER = 0.3, SNAP_OVERLAP = 0.06, options = {}) {
  const axisPref = options.axisPreference || null;
  const MIN_ABS = typeof options.minOverlapAbs === 'number' ? options.minOverlapAbs : 0.02; // feet
  const OVERLAP_FRAC = typeof options.overlapFrac === 'number' ? options.overlapFrac : 0.6; // 60% of smaller side
  const getWorldBoxOf = (object) => {
    const box = new THREE.Box3();
    try { box.setFromObject(object); } catch {}
    return box;
  };
  const isHelperOrOverlay = (obj) => {
    try {
      if (!obj) return true;
      const n = (obj.name||'');
      if (n === '2D Overlay' || n.startsWith('__') || n.includes('Outline') || n === '__SnapHighlight') return true;
      const ud = obj.userData || {};
      if (ud.__helper || ud.__overlay || ud.__teleportDisc || ud.__isOverlay) return true;
    } catch {}
    return false;
  };
  const overlapLen = (amin, amax, bmin, bmax) => Math.min(amax, bmax) - Math.max(amin, bmin);

  let best = { axis: null, delta: 0, score: Infinity, other: null, otherBox: null, movingFace: null, otherFace: null };
  for (const other of others || []){
    if (!other || excludeSet.has(other)) continue;
    if (isHelperOrOverlay(other)) continue;
    const b = getWorldBoxOf(other);
    if (!isFinite(b.min.x) || !isFinite(b.max.x)) continue;
    // Precompute overlaps between moving and other for Y and Z, X and Z, X and Y
    const ox = overlapLen(movingBox.min.x, movingBox.max.x, b.min.x, b.max.x);
    const oy = overlapLen(movingBox.min.y, movingBox.max.y, b.min.y, b.max.y);
    const oz = overlapLen(movingBox.min.z, movingBox.max.z, b.min.z, b.max.z);
    const sizeAx = movingBox.max.x - movingBox.min.x; const sizeAy = movingBox.max.y - movingBox.min.y; const sizeAz = movingBox.max.z - movingBox.min.z;
    const sizeBx = b.max.x - b.min.x; const sizeBy = b.max.y - b.min.y; const sizeBz = b.max.z - b.min.z;
    const thrX = Math.max(MIN_ABS, OVERLAP_FRAC * Math.min(sizeAx, sizeBx));
    const thrY = Math.max(MIN_ABS, OVERLAP_FRAC * Math.min(sizeAy, sizeBy));
    const thrZ = Math.max(MIN_ABS, OVERLAP_FRAC * Math.min(sizeAz, sizeBz));
    // Candidate deltas for each axis
    const dx1 = b.min.x - movingBox.max.x; // moving right -> other left (movingFace=max, otherFace=min)
    const dx2 = b.max.x - movingBox.min.x; // moving left -> other right (movingFace=min, otherFace=max)
    const dy1 = b.min.y - movingBox.max.y; // moving up -> other bottom (movingFace=max, otherFace=min)
    const dy2 = b.max.y - movingBox.min.y; // moving down -> other top (movingFace=min, otherFace=max)
    const dz1 = b.min.z - movingBox.max.z; // moving forward -> other back (movingFace=max, otherFace=min)
    const dz2 = b.max.z - movingBox.min.z; // moving back -> other front (movingFace=min, otherFace=max)
    const candidates = [
      { axis:'x', delta: dx1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min', oy, oz },
      { axis:'x', delta: dx2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max', oy, oz },
      { axis:'y', delta: dy1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min', ox, oz },
      { axis:'y', delta: dy2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max', ox, oz },
      { axis:'z', delta: dz1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min', ox, oy },
      { axis:'z', delta: dz2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max', ox, oy },
    ];
    for (const c of candidates){
      const d = c.delta;
      // Enforce sufficient face overlap along the other two axes
      const overlapOk = (c.axis==='x') ? (c.oy >= thrY && c.oz >= thrZ)
                        : (c.axis==='y') ? (c.ox >= thrX && c.oz >= thrZ)
                        : (c.ox >= thrX && c.oy >= thrY);
      if (!overlapOk) continue;
      if (d <= SNAP_ENTER && d >= -SNAP_OVERLAP){
        let score = Math.abs(d);
        if (axisPref && c.axis !== axisPref) score *= 1.25; // mild penalty to non-preferred axis
        if (score < best.score){ best = { axis: c.axis, delta: d, score, other: c.other, otherBox: c.otherBox, movingFace: c.movingFace, otherFace: c.otherFace }; }
      }
    }
  }
  if (!best.axis) return { delta: new THREE.Vector3(0,0,0), axis: null, other: null, otherBox: null, movingFace: null, otherFace: null };
  const deltaVec = best.axis === 'x' ? new THREE.Vector3(best.delta,0,0) : (best.axis === 'y' ? new THREE.Vector3(0,best.delta,0) : new THREE.Vector3(0,0,best.delta));
  return { delta: deltaVec, axis: best.axis, other: best.other, otherBox: best.otherBox, movingFace: best.movingFace, otherFace: best.otherFace };
}
