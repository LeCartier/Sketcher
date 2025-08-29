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
