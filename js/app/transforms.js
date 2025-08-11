// World transform helpers for applying deltas with parented objects

export function getWorldMatrix(obj) {
	if (!obj) return new (obj?.matrix?.constructor || window.THREE?.Matrix4 || Function)();
	obj.updateMatrixWorld(true);
	return obj.matrixWorld.clone();
}

export function setWorldMatrix(obj, worldMatrix) {
	// Applies a world matrix to an object, respecting its parent transform
	obj.updateMatrixWorld(true);
	const parent = obj.parent;
	if (!parent) {
		obj.matrix.copy(worldMatrix);
		obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
		return;
	}
	parent.updateMatrixWorld(true);
	const invParent = parent.matrixWorld.clone().invert();
	const local = worldMatrix.clone().premultiply(invParent);
	local.decompose(obj.position, obj.quaternion, obj.scale);
}
