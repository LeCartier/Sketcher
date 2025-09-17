// Visual helpers for soft-snapping highlight plane
// Usage:
//   const snapV = createSnapVisuals({ THREE, scene });
//   snapV.showAt(movingBox, snapInfo);
//   snapV.hide();

export function createSnapVisuals({ THREE, scene }) {
  let snapHighlight = null; // legacy plane (kept for backward compatibility)
  let faceSnapHighlights = []; // Box helpers for both objects
  let outlineMode = true; // when true we suppress the fill plane and only show outlines

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

  function ensureFaceSnapHighlights() {
    if (faceSnapHighlights.length === 0) {
      // Create two subtle orange wireframe box helpers for VR face snapping
      for (let i = 0; i < 2; i++) {
        const box = new THREE.Box3();
        const helper = new THREE.Box3Helper(box, 0xff8800); // Slightly more subtle orange
        helper.name = `__VRFaceSnapHighlight_${i}`;
        helper.renderOrder = 10003; // Render on top
        helper.userData.__helper = true;
        helper.visible = false;
        // Make the wireframe more subtle and less distracting
        if (helper.material) {
          helper.material.linewidth = 2; // Reduced from 3 to 2
          helper.material.transparent = true;
          helper.material.opacity = 0.6; // Reduced from 0.9 to 0.6
          helper.material.depthTest = true; // Changed from false to true for better depth perception
        }
        scene.add(helper);
        faceSnapHighlights.push(helper);
      }
    }
    return faceSnapHighlights;
  }

  function hide() { 
    if (snapHighlight) snapHighlight.visible = false; 
    hideFaceSnapHighlights();
  }

  function hideFaceSnapHighlights() {
    faceSnapHighlights.forEach(helper => {
      if (helper) helper.visible = false;
    });
  }

  function showFaceSnapHighlights(movingObj, targetObj) {
    const helpers = ensureFaceSnapHighlights();
    
    try {
      // Only show highlights if both objects exist and are reasonably sized
      if (!movingObj || !targetObj) {
        hideFaceSnapHighlights();
        return;
      }
      
      // Validate that objects have meaningful size for face snapping
      const movingBox = new THREE.Box3().setFromObject(movingObj);
      const targetBox = new THREE.Box3().setFromObject(targetObj);
      
      if (movingBox.isEmpty() || targetBox.isEmpty()) {
        hideFaceSnapHighlights();
        return;
      }
      
      const movingSize = movingBox.getSize(new THREE.Vector3());
      const targetSize = targetBox.getSize(new THREE.Vector3());
      
      // Don't highlight if objects are too small or one is much larger than the other
      const movingMinDim = Math.min(movingSize.x, movingSize.y, movingSize.z);
      const targetMinDim = Math.min(targetSize.x, targetSize.y, targetSize.z);
      if (movingMinDim < 0.02 || targetMinDim < 0.02) {
        hideFaceSnapHighlights();
        return;
      }
      
      // Update bounding boxes and show highlights
      if (helpers[0]) {
        helpers[0].box.copy(movingBox);
        helpers[0].visible = true;
      }
      if (helpers[1]) {
        helpers[1].box.copy(targetBox);
        helpers[1].visible = true;
      }
    } catch (e) {
      console.warn('Error updating face snap highlights:', e);
      hideFaceSnapHighlights();
    }
  }

  function showAt(movingBox, snapInfo, movingObj=null, targetObj=null) {
    // Outline mode prefers box helpers instead of plane fill
    if (outlineMode) {
      if (!snapInfo || !snapInfo.axis || !snapInfo.otherBox) { hideFaceSnapHighlights(); return; }
      showFaceSnapHighlights(movingObj, targetObj);
      if (snapHighlight) snapHighlight.visible = false; // suppress plane
      return;
    }
    // Legacy plane visualization
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

  function setOutlineMode(v){ outlineMode = !!v; if (outlineMode) { if (snapHighlight) snapHighlight.visible = false; } }

  return { ensure, hide, showAt, showFaceSnapHighlights, hideFaceSnapHighlights, setOutlineMode };
}
