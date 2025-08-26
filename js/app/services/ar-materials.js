// Lightweight AR material mode: swap to simple MeshStandardMaterial and allow restore

export function simplifyMaterialsForARInPlace(THREE, root) {
  try {
    root.traverse((node) => {
      if (!node || !node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      if (!node.userData.__arOrigMaterial) node.userData.__arOrigMaterial = Array.isArray(node.material) ? mats.slice() : mats[0];
      const newMats = mats.map((m) => {
        const colorHex = (m && m.color && m.color.getHex) ? m.color.getHex() : 0xcccccc;
        const nm = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85, metalness: 0.0 });
        nm.side = THREE.DoubleSide;
        return nm;
      });
      node.material = Array.isArray(node.material) ? newMats : newMats[0];
    });
  } catch {}
}

export function restoreMaterialsForARInPlace(THREE, root) {
  try {
    root.traverse((node) => {
      if (!node || !node.isMesh) return;
      const orig = node.userData && node.userData.__arOrigMaterial;
      if (!orig) return;
      node.material = Array.isArray(orig) ? orig.slice() : orig;
      try { delete node.userData.__arOrigMaterial; } catch {}
    });
  } catch {}
}
