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
export function computeSnapDelta(THREE, movingBox, others, excludeSet = new Set(), SNAP_ENTER = 0.3, SNAP_OVERLAP = 0.06) {
  const getWorldBoxOf = (object) => {
    const box = new THREE.Box3();
    try { box.setFromObject(object); } catch {}
    return box;
  };

  let best = { axis: null, delta: 0, score: Infinity, other: null, otherBox: null, movingFace: null, otherFace: null };
  for (const other of others || []){
    if (!other || excludeSet.has(other)) continue;
    const b = getWorldBoxOf(other);
    if (!isFinite(b.min.x) || !isFinite(b.max.x)) continue;
    // Candidate deltas for each axis
    const dx1 = b.min.x - movingBox.max.x; // moving right -> other left (movingFace=max, otherFace=min)
    const dx2 = b.max.x - movingBox.min.x; // moving left -> other right (movingFace=min, otherFace=max)
    const dy1 = b.min.y - movingBox.max.y; // moving up -> other bottom (movingFace=max, otherFace=min)
    const dy2 = b.max.y - movingBox.min.y; // moving down -> other top (movingFace=min, otherFace=max)
    const dz1 = b.min.z - movingBox.max.z; // moving forward -> other back (movingFace=max, otherFace=min)
    const dz2 = b.max.z - movingBox.min.z; // moving back -> other front (movingFace=min, otherFace=max)
    const candidates = [
      { axis:'x', delta: dx1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min' },
      { axis:'x', delta: dx2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max' },
      { axis:'y', delta: dy1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min' },
      { axis:'y', delta: dy2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max' },
      { axis:'z', delta: dz1, other, otherBox: b.clone(), movingFace:'max', otherFace:'min' },
      { axis:'z', delta: dz2, other, otherBox: b.clone(), movingFace:'min', otherFace:'max' },
    ];
    for (const c of candidates){
      const d = c.delta;
      if (d <= SNAP_ENTER && d >= -SNAP_OVERLAP){
        const score = Math.abs(d);
        if (score < best.score){ best = { axis: c.axis, delta: d, score, other: c.other, otherBox: c.otherBox, movingFace: c.movingFace, otherFace: c.otherFace }; }
      }
    }
  }
  if (!best.axis) return { delta: new THREE.Vector3(0,0,0), axis: null, other: null, otherBox: null, movingFace: null, otherFace: null };
  const deltaVec = best.axis === 'x' ? new THREE.Vector3(best.delta,0,0) : (best.axis === 'y' ? new THREE.Vector3(0,best.delta,0) : new THREE.Vector3(0,0,best.delta));
  return { delta: deltaVec, axis: best.axis, other: best.other, otherBox: best.otherBox, movingFace: best.movingFace, otherFace: best.otherFace };
}
