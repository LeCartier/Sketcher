// Visual helpers for soft-snapping highlight plane
// Usage:
//   const snapV = createSnapVisuals({ THREE, scene });
//   snapV.showAt(movingBox, snapInfo);
//   snapV.hide();

export function createSnapVisuals({ THREE, scene }) {
  let snapHighlight = null;

  function ensure() {
    if (snapHighlight) return snapHighlight;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.7, depthTest: true });
    const g = new THREE.PlaneGeometry(1, 1);
    snapHighlight = new THREE.Mesh(g, mat);
    snapHighlight.name = '__SnapHighlight';
    snapHighlight.visible = false;
    scene.add(snapHighlight);
    return snapHighlight;
  }

  function hide() { if (snapHighlight) snapHighlight.visible = false; }

  function showAt(movingBox, snapInfo) {
    const hl = ensure();
    if (!snapInfo || !snapInfo.axis || !snapInfo.otherBox) { hl.visible = false; return; }
    const bA = movingBox; const bB = snapInfo.otherBox;
    const axis = snapInfo.axis;
    let cx = 0, cy = 0, cz = 0, sx = 0.05, sy = 0.05, sz = 0.05, rot = new THREE.Euler(0, 0, 0);
    if (axis === 'x') {
      cx = snapInfo.movingFace === 'max' ? bA.max.x : bA.min.x;
      cy = (Math.max(bA.min.y, bB.min.y) + Math.min(bA.max.y, bB.max.y)) * 0.5;
      cz = (Math.max(bA.min.z, bB.min.z) + Math.min(bA.max.z, bB.max.z)) * 0.5;
      sy = Math.max(0.01, Math.min(bA.max.y, bB.max.y) - Math.max(bA.min.y, bB.min.y));
      sz = Math.max(0.01, Math.min(bA.max.z, bB.max.z) - Math.max(bA.min.z, bB.min.z));
      rot.set(0, Math.PI / 2, 0);
    } else if (axis === 'y') {
      cx = (Math.max(bA.min.x, bB.min.x) + Math.min(bA.max.x, bB.max.x)) * 0.5;
      cy = snapInfo.movingFace === 'max' ? bA.max.y : bA.min.y;
      cz = (Math.max(bA.min.z, bB.min.z) + Math.min(bA.max.z, bB.max.z)) * 0.5;
      sx = Math.max(0.01, Math.min(bA.max.x, bB.max.x) - Math.max(bA.min.x, bB.min.x));
      sz = Math.max(0.01, Math.min(bA.max.z, bB.max.z) - Math.max(bA.min.z, bB.min.z));
      rot.set(Math.PI / 2, 0, 0);
    } else { // z
      cx = (Math.max(bA.min.x, bB.min.x) + Math.min(bA.max.x, bB.max.x)) * 0.5;
      cy = (Math.max(bA.min.y, bB.min.y) + Math.min(bA.max.y, bB.max.y)) * 0.5;
      cz = snapInfo.movingFace === 'max' ? bA.max.z : bA.min.z;
      sx = Math.max(0.01, Math.min(bA.max.x, bB.max.x) - Math.max(bA.min.x, bB.min.x));
      sy = Math.max(0.01, Math.min(bA.max.y, bB.max.y) - Math.max(bA.min.y, bB.min.y));
      rot.set(0, 0, 0);
    }
    const g = hl.geometry; g.dispose();
    hl.geometry = new THREE.PlaneGeometry(Math.max(0.01, sx), Math.max(0.01, sy || sz));
    hl.position.set(cx, cy, cz);
    hl.rotation.set(rot.x, rot.y, rot.z);
    hl.visible = true;
  }

  return { ensure, hide, showAt };
}
