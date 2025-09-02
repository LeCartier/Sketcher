// Factory for a 1ft x 1ft alignment tile with directionality graphics
export function createAlignmentTile({ THREE, feet = 1, name = 'Alignment Tile 1ft' } = {}) {
  const size = Math.max(0.1, feet); // in feet
  const w = size, h = size, t = 0.05; // small thickness
  const group = new THREE.Group();
  group.name = name;

  // Base plate
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(w, t, h),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.9, metalness: 0.05 })
  );
  base.position.y = t / 2;
  group.add(base);

  // Directionality graphics: N arrow and axes on top surface using simple line segments
  const lines = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x222222 });
  function addLine(ax, az, bx, bz) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([ax, t + 0.001, az, bx, t + 0.001, bz]), 3));
    lines.add(new THREE.Line(g, mat));
  }
  const r = (Math.min(w, h) * 0.45);
  // A crosshair
  addLine(-r, 0, r, 0);
  addLine(0, -r, 0, r);
  // North arrow on +Z
  addLine(0, r * 0.3, 0, r);
  addLine(0, r, -r * 0.08, r - r * 0.12);
  addLine(0, r, r * 0.08, r - r * 0.12);
  lines.name = '__AlignmentGlyphs';
  group.add(lines);

  // Metadata for alignment
  group.userData = group.userData || {};
  group.userData.__alignmentTile = { sizeFeet: feet, northAxis: [0, 0, 1] };

  // Make it easy to pick/move like other primitives
  base.castShadow = false; base.receiveShadow = true;
  return group;
}
