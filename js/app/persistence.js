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
  (objects || []).forEach(o => { if (o) root.add(o.clone(true)); });
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
