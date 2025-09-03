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

// Outline mode: set meshes to pure white and attach black edge lines as helper children
export function applyOutlineModeForARInPlace(THREE, root) {
  try {
    const attachOutline = (mesh) => {
      try {
        // Build edges; threshold 1 deg to show most edges
        const egeo = new THREE.EdgesGeometry(mesh.geometry, 1);
        const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95 });
        const lines = new THREE.LineSegments(egeo, mat);
        lines.name = '__arOutline'; lines.userData.__helper = true; lines.raycast = function(){};
        // Keep outline in mesh-local space
        lines.position.set(0,0,0); lines.rotation.set(0,0,0); lines.scale.set(1,1,1);
        mesh.add(lines);
      } catch {}
    };
    root.traverse((node) => {
      if (!node || !node.isMesh) return;
      // Record original material once
      if (!node.userData.__arOrigMaterial) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        node.userData.__arOrigMaterial = Array.isArray(node.material) ? mats.slice() : mats[0];
      }
      // Set to white basic for consistent shading across devices
      const basic = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      node.material = basic;
      // Attach outline helper if not already present
      const hasOutline = node.children && node.children.some(c => c && c.name === '__arOutline');
      if (!hasOutline) attachOutline(node);
    });
  } catch {}
}

export function clearOutlineModeForAR(THREE, root) {
  try {
    root.traverse((node) => {
      if (!node) return;
      // Remove attached outline helpers
      if (node.children && node.children.length){
        const toRemove = node.children.filter(c => c && c.name === '__arOutline');
        for (const c of toRemove){ try { node.remove(c); c.geometry?.dispose?.(); c.material?.dispose?.(); } catch {} }
      }
    });
  } catch {}
}
