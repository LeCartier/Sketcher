// Lightweight persistence utilities for Sketcher
// Pure helpers; no global state. Pass THREE explicitly to avoid implicit deps.

/**
 * Build a new THREE.Group containing deep clones of the given objects.
 * @param {any} THREE - three.js module
 * @param {Array} objects - Array of THREE.Object3D
 * @returns {THREE.Group}
 */
export function buildExportRootFromObjects(THREE, objects) {
  const root = new THREE.Group();
  (objects || []).forEach(o => { if (o) {
    const c = o.clone(true);
    // Preserve a mapping from each cloned node back to its source node for later round-tripping
    try {
      const srcNodes = []; o.traverse(n => { if (n) srcNodes.push(n); });
      const cloneNodes = []; c.traverse(n => { if (n) cloneNodes.push(n); });
      const n = Math.min(srcNodes.length, cloneNodes.length);
      for (let i = 0; i < n; i++){
        const sn = srcNodes[i]; const cn = cloneNodes[i];
        try {
          cn.userData = cn.userData || {};
          // Direct in-memory back-reference (lifetime: this session)
          cn.userData.__sourceRef = sn;
          // Stable id for diagnostics
          cn.userData.__srcId = sn.uuid || (sn.userData && sn.userData.__srcId) || undefined;
        } catch {}
      }
    } catch {}
    // Deep-clone materials on the clone so modifications (simplify/restore) do not affect originals
    try {
      c.traverse((node) => {
        if (!node || !node.isMesh) return;
        const mat = node.material;
        if (!mat) return;
        if (Array.isArray(mat)) {
          node.material = mat.map(m => {
            try {
              const nm = m.clone();
              // If the material referenced textures, clone their maps where possible
              ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap'].forEach(k=>{
                try { if (nm[k] && nm[k].clone) nm[k] = nm[k].clone(); } catch{}
              });
              return nm;
            } catch(e){ return m; }
          });
        } else {
          try {
            const nm = mat.clone();
            ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap'].forEach(k=>{
              try { if (nm[k] && nm[k].clone) nm[k] = nm[k].clone(); } catch{}
            });
            node.material = nm;
          } catch(e){ /* leave original reference if clone fails */ }
        }
      });
    } catch(e){}
    root.add(c);
  } });
  return root;
}

/**
 * Serialize the provided objects as a single scene JSON via Object3D.toJSON().
 * @param {any} THREE - three.js module
 * @param {Array} objects - Array of THREE.Object3D
 * @returns {object} three.js JSON
 */
export function serializeSceneFromObjects(THREE, objects) {
  const root = buildExportRootFromObjects(THREE, objects);
  return root.toJSON();
}
