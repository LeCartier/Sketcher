// Transform helpers for multi-select pivot operations
import * as THREE from '../vendor/three.module.js';

/** Return a clone of object's world matrix after updating world. */
export function getWorldMatrix(obj) {
  obj.updateMatrixWorld();
  return obj.matrixWorld.clone();
}

/** Set an object's transform using a world-space matrix. */
export function setWorldMatrix(obj, worldMat) {
  const parent = obj.parent;
  const invParent = new THREE.Matrix4();
  if (parent) {
    parent.updateMatrixWorld();
    invParent.copy(parent.matrixWorld).invert();
  } else {
    invParent.identity();
  }
  const local = new THREE.Matrix4().multiplyMatrices(invParent, worldMat);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  local.decompose(pos, quat, scl);
  obj.position.copy(pos);
  obj.quaternion.copy(quat);
  obj.scale.copy(scl);
  obj.updateMatrixWorld(true);
}
