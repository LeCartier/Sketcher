// Pure creators for common primitives. No side effects; return meshes/groups.
// All parameters are explicit; do not rely on global THREE or materials.

export function createColumn({ THREE, material, radius = 0.5, height = 8 }) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 24);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(0, height / 2, 0);
  return mesh;
}

export function createBeam({ THREE, material, len = 12, depth = 1, width = 1 }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, depth, width), material);
  mesh.position.set(0, 8, 0);
  return mesh;
}

export function createRamp({ THREE, material, len = 10, thick = 0.5, width = 4 }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, thick, width), material);
  mesh.rotation.x = THREE.MathUtils.degToRad(-15);
  mesh.position.set(0, 1, 0);
  return mesh;
}

export function createStairs({ THREE, material, steps = 10, rise = 0.7, tread = 1, width = 4 }) {
  const grp = new THREE.Group();
  for (let i = 0; i < steps; i++) {
    const h = rise, d = tread, w = width;
    const step = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), material);
    step.position.set(i * tread + d / 2, (i + 0.5) * rise, 0);
    grp.add(step);
  }
  return grp;
}

export function createRoofPlane({ THREE, material, w = 12, d = 10 }) {
  const plane = new THREE.PlaneGeometry(w, d);
  plane.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(plane, material);
  mesh.rotation.z = THREE.MathUtils.degToRad(30);
  mesh.position.set(0, 10, 0);
  return mesh;
}
