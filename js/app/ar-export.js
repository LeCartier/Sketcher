// Recenter to ground and convert feet->meters without altering materials
export function prepareModelForAR(THREE, root) {
  try {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const translate = new THREE.Vector3(center.x, box.min.y, center.z);
    root.position.sub(translate);
    const FEET_TO_METERS = 0.3048;
    root.scale.setScalar(FEET_TO_METERS);
    root.updateMatrixWorld(true);
  } catch {}
}

// USDZ path: simplify materials for wider compatibility while keeping geometry/placement
export function prepareModelForUSDZ(THREE, root) {
  try {
    root.traverse((obj)=>{
      if (obj.isMesh) {
        const oldMat = obj.material;
        let color = 0xcccccc;
        // Try to keep base color if present
        if (oldMat) {
          if (Array.isArray(oldMat)) {
            obj.material = oldMat.map(m => new THREE.MeshStandardMaterial({ color: (m && m.color && m.color.getHex) ? m.color.getHex() : color, metalness: 0.0, roughness: 0.8 }));
          } else {
            if (oldMat.color && oldMat.color.getHex) color = oldMat.color.getHex();
            obj.material = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.8 });
          }
        } else {
          obj.material = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.8 });
        }
      }
    });
  } catch {}
  // Apply the same recenter + scale
  prepareModelForAR(THREE, root);
}
