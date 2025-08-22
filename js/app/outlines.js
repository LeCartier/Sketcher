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

	const addOutlineForMesh = (mesh, color = 0xffa500) => {
		if (!mesh || !mesh.geometry) return;
		const edges = new THREE.EdgesGeometry(mesh.geometry, 40);
		const mat = new THREE.LineBasicMaterial({ color });
		const line = new THREE.LineSegments(edges, mat);
		// Render in world space so it overlays regardless of parent transforms
		line.matrixAutoUpdate = false;
		mesh.updateMatrixWorld(true);
		line.matrix.copy(mesh.matrixWorld);
		// Put outlines slightly above to reduce z-fighting
		const bump = new THREE.Matrix4().makeScale(1.001, 1.001, 1.001);
		const lift = new THREE.Matrix4().makeTranslation(0, 0.01, 0);
		line.matrix.multiply(bump).multiply(lift);
		scene.add(line);
		outlines.push(line);
	};

	const addOutlineForLine = (src, color = 0xffa500) => {
		if (!src || !src.geometry) return;
		const mat = new THREE.LineBasicMaterial({ color, depthTest: true });
		let line;
		if (src.isLineSegments) line = new THREE.LineSegments(src.geometry, mat);
		else if (src.isLineLoop) line = new THREE.LineLoop(src.geometry, mat);
		else line = new THREE.Line(src.geometry, mat);
		line.matrixAutoUpdate = false;
		src.updateMatrixWorld(true);
		line.matrix.copy(src.matrixWorld);
		// Slight lift to reduce z-fighting for coplanar lines
		const lift = new THREE.Matrix4().makeTranslation(0, 0.01, 0);
		line.matrix.multiply(lift);
		scene.add(line);
		outlines.push(line);
	};

	const isInOverlay = (node) => {
		let n = node;
		while (n) { if (n.name === '2D Overlay') return true; n = n.parent; }
		return false;
	};

	selectedObjects.forEach((obj) => {
		if (!obj) return;
		const color = isInOverlay(obj) ? 0x00ff00 : 0xffa500;
		if (obj.isMesh) {
			addOutlineForMesh(obj, color);
		} else if (obj.isLine || obj.isLineSegments || obj.isLineLoop) {
			addOutlineForLine(obj, color);
		} else if (obj.traverse) {
			obj.traverse((child) => {
				if (child.isMesh) addOutlineForMesh(child, color);
				else if (child.isLine || child.isLineSegments || child.isLineLoop) addOutlineForLine(child, color);
			});
		}
	});

	return outlines;
}
