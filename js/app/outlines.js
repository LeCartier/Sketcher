// Simple selection outline helpers
// clearSelectionOutlines(scene, outlines[]) -> returns []
// rebuildSelectionOutlines(THREE, scene, selectedObjects[]) -> returns new outlines[]

export function clearSelectionOutlines(scene, outlines) {
	if (Array.isArray(outlines)) {
		outlines.forEach((o) => {
			try {
				if (o && o.parent) o.parent.remove(o);
				if (o.geometry && o.geometry.dispose) o.geometry.dispose();
				if (o.material && o.material.dispose) o.material.dispose();
			} catch {}
		});
	}
	return [];
}

export function rebuildSelectionOutlines(THREE, scene, selectedObjects) {
	const outlines = [];
	if (!selectedObjects || !selectedObjects.length) return outlines;

	const addOutlineForMesh = (mesh) => {
		if (!mesh || !mesh.geometry) return;
		const edges = new THREE.EdgesGeometry(mesh.geometry, 40);
		const mat = new THREE.LineBasicMaterial({ color: 0xffa500 });
		const line = new THREE.LineSegments(edges, mat);
		// Render in world space so it overlays regardless of parent transforms
		line.matrixAutoUpdate = false;
		mesh.updateMatrixWorld(true);
		line.matrix.copy(mesh.matrixWorld);
		// Put outlines slightly above to reduce z-fighting
		const bump = new THREE.Matrix4().makeScale(1.001, 1.001, 1.001);
		line.matrix.multiply(bump);
		scene.add(line);
		outlines.push(line);
	};

	selectedObjects.forEach((obj) => {
		if (!obj) return;
		if (obj.isMesh) {
			addOutlineForMesh(obj);
		} else if (obj.traverse) {
			obj.traverse((child) => {
				if (child.isMesh) addOutlineForMesh(child);
			});
		}
	});

	return outlines;
}
