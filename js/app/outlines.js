// Selection outline helpers for Sketcher
// Exports pure functions that operate on provided scene and objects to avoid global coupling.

/**
 * Remove and dispose all current selection outlines.
 * @param {import('three').Scene} scene
 * @param {Array<import('three').LineSegments>} outlines
 * @returns {Array} empty array to reassign caller's selectionOutlines
 */
export function clearSelectionOutlines(scene, outlines) {
  if (!outlines) return [];
  outlines.forEach(outline => {
    if (!outline) return;
    scene.remove(outline);
    if (outline.geometry && outline.geometry.dispose) outline.geometry.dispose();
    const mat = outline.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(m => m && m.dispose && m.dispose());
      else if (mat.dispose) mat.dispose();
    }
  });
  return [];
}

/**
 * Rebuild outlines for the provided selected objects. Returns the new outlines array.
 * Handles Groups by outlining their children meshes with world transforms applied.
 * @param {*} THREE three module
 * @param {import('three').Scene} scene
 * @param {Array<import('three').Object3D>} selectedObjects
 * @returns {Array<import('three').LineSegments>}
 */
export function rebuildSelectionOutlines(THREE, scene, selectedObjects) {
  const outlines = [];
  if (!selectedObjects || !selectedObjects.length) return outlines;
  selectedObjects.forEach(selObj => {
    if (selObj.type === 'Group') {
      selObj.children.forEach(child => {
        if (child && child.geometry) {
          const edgeGeo = new THREE.EdgesGeometry(child.geometry);
          const outline = new THREE.LineSegments(
            edgeGeo,
            new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 })
          );
          child.updateMatrixWorld();
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          const worldScale = new THREE.Vector3();
          child.matrixWorld.decompose(worldPos, worldQuat, worldScale);
          outline.position.copy(worldPos);
          outline.quaternion.copy(worldQuat);
          outline.scale.copy(worldScale);
          scene.add(outline);
          outlines.push(outline);
        }
      });
    } else if (selObj && selObj.geometry) {
      const edgeGeo = new THREE.EdgesGeometry(selObj.geometry);
      const outline = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 })
      );
      selObj.updateMatrixWorld();
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      selObj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
      outline.position.copy(worldPos);
      outline.quaternion.copy(worldQuat);
      outline.scale.copy(worldScale);
      scene.add(outline);
      outlines.push(outline);
    }
  });
  return outlines;
}
