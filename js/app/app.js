// Main application entry extracted from index.html
// Exports an init function executed by index.html

export async function init() {
	// Delegate tweenCamera to views.js while keeping the same call shape
	function tweenCamera(fromCam, toCam, duration = 600, onComplete) {
		return views.tweenCamera(fromCam, toCam, controls, duration, onComplete);
	}
		const [THREE, { GLTFLoader }, { OBJLoader }, { OrbitControls }, { TransformControls }, { OBJExporter }, { setupMapImport }, outlines, transforms, localStore, persistence, snapping, views, gridUtils, arExport, { createSnapVisuals }, { createSessionDraft }, primitives, { createAREdit }] = await Promise.all([
		import('../vendor/three.module.js'),
		import('../vendor/GLTFLoader.js'),
		import('../vendor/OBJLoader.js'),
		import('../vendor/OrbitControls.js'),
		import('../vendor/TransformControls.js'),
		import('../vendor/OBJExporter.js'),
			import('./map-import.js'),
			import('./outlines.js'),
			import('./transforms.js'),
			import('./local-store.js'),
			import('./persistence.js'),
			import('./snapping.js'),
			import('./views.js'),
			import('./grid-utils.js'),
			import('./ar-export.js'),
			import('./snapping-visuals.js'),
			import('./session-draft.js'),
			import('./features/primitives.js'),
			import('./services/ar-edit.js'),
		]);

	// Version badge
	(async () => {
		try {
			const res = await fetch('./version.json', { cache: 'no-store' });
			if (res.ok) {
				const v = await res.json();
				const el = document.getElementById('version-badge');
				if (el) el.textContent = `v${v.version} — ${v.date}`;
			}
		} catch {
			const el = document.getElementById('version-badge');
			if (el && !el.textContent) el.textContent = 'v1.1.0';
		}
	})();



		async function loadWebXRPolyfillIfNeeded() {
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
		if (isIOS && !('xr' in navigator)) {
				try { await import('../vendor/webxr-polyfill.module.js'); } catch {}
		}
	}
	loadWebXRPolyfillIfNeeded();

	// Scene
	const scene = new THREE.Scene();
	let cameraType = 'perspective';
	let camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 5000);
	camera.position.set(5,5,5); camera.lookAt(0,0,0);
	let orthoCamera = null;
	const renderer = new THREE.WebGLRenderer({ antialias:true, logarithmicDepthBuffer: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	// Prefer VisualViewport for accurate iOS dynamic viewport sizing
	const vv = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport : null;
	const sizeW = vv ? Math.round(vv.width) : window.innerWidth;
	const sizeH = vv ? Math.round(vv.height) : window.innerHeight;
	renderer.setSize(sizeW, sizeH);
	renderer.shadowMap.enabled = true;
	document.body.appendChild(renderer.domElement);
	// Ensure great touch/stylus behavior on tablets and iPad (no page scroll/zoom gestures on canvas)
	try {
		renderer.domElement.style.touchAction = 'none';
		renderer.domElement.style.msTouchAction = 'none';
		renderer.domElement.style.webkitUserSelect = 'none';
		renderer.domElement.style.userSelect = 'none';
		renderer.domElement.style.webkitTapHighlightColor = 'rgba(0,0,0,0)';
		// Avoid long-press context menus interrupting drawing/selection
		renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); });
	} catch {}
	renderer.xr.enabled = true;
	let arActive = false;
	// Room Scan is now provided by a service module
	let arContent = null; // cloned scene content for AR
	let arPlaced = false;
	let arPrevVisibility = null; // Map(object -> prevVisible) to restore after AR
	let xrHitTestSource = null;
	let xrViewerSpace = null;
	let xrLocalSpace = null;
	// Track grab transitions per XR input source for haptics and statefulness
	const xrGrabState = new WeakMap();

	// AR editing helper (controllers or hands)
	const arEdit = createAREdit(THREE, scene, renderer);
	try { arEdit.setGizmoEnabled(false); } catch {}

	// Snap highlight via module
	const snapVisuals = createSnapVisuals({ THREE, scene });

	// Room Scan service will be initialized after core scene state is created (see below)

	// Grid & lights
	let GRID_SIZE = 20;
	let GRID_DIVS = 20;
	let grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, 0xffffff, 0xffffff);
	grid.receiveShadow = true; scene.add(grid);
	try {
	  if (Array.isArray(grid.material)) grid.material.forEach(m => { if (m) m.depthWrite = false; });
	  else if (grid.material) grid.material.depthWrite = false;
	} catch {}

	// Screen-space fade for grid lines (to black at edges)
	function enhanceGridMaterial(mat){ try { gridUtils.enhanceGridMaterial(THREE, mat); } catch {} }
	try { enhanceGridMaterial(grid.material); } catch {}
	scene.add(new THREE.AmbientLight(0xffffff,0.5));
	const dirLight=new THREE.DirectionalLight(0xffffff,0.8); dirLight.position.set(5,10,7); dirLight.castShadow=true; scene.add(dirLight);

	// Controls + gizmos
	const controls=new OrbitControls(camera,renderer.domElement);
	controls.enableDamping=true; controls.dampingFactor=0.085;
	controls.enablePan=true; controls.enableZoom=true; controls.enableRotate=true;
	controls.rotateSpeed = 0.9; controls.zoomSpeed = 0.95; controls.panSpeed = 0.9;
	// Desktop: left = rotate, middle = pan, right = pan
	controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
	controls.touches = { ONE: THREE.TOUCH.NONE, TWO: THREE.TOUCH.DOLLY_PAN };
	const transformControls=new TransformControls(camera,renderer.domElement);
	transformControls.setMode('translate'); transformControls.setTranslationSnap(0.1);
	transformControls.addEventListener('dragging-changed',e=>controls.enabled=!e.value); scene.add(transformControls);
	// Shrink gizmo size
	if (typeof transformControls.setSize === 'function') transformControls.setSize(0.5);
	const transformControlsRotate=new TransformControls(camera,renderer.domElement);
	transformControlsRotate.setMode('rotate'); transformControlsRotate.setRotationSnap(THREE.MathUtils.degToRad(15));
	transformControlsRotate.addEventListener('dragging-changed',e=>controls.enabled=!e.value); scene.add(transformControlsRotate);
	// Shrink rotate gizmo size
	if (typeof transformControlsRotate.setSize === 'function') transformControlsRotate.setSize(0.5);

	// Reduce perceived line weight on gizmos (lines are often fixed-width on WebGL; use opacity as fallback)
	function softenGizmoLines(ctrl){
		try{
			ctrl.traverse(obj=>{
				const mats = obj && obj.material ? (Array.isArray(obj.material)? obj.material : [obj.material]) : null;
				if (!mats) return;
				mats.forEach(m=>{
					if (m && m.isLineBasicMaterial){
						m.transparent = true;
						m.opacity = Math.min(m.opacity ?? 1, 0.5);
						if ('linewidth' in m) { try { m.linewidth = 0.5; } catch(_){} }
						m.needsUpdate = true;
					}
				});
			});
		}catch{}
	}
	softenGizmoLines(transformControls);
	softenGizmoLines(transformControlsRotate);
	function disableRotateGizmo(){ transformControlsRotate.enabled = false; transformControlsRotate.visible = false; }
	function enableRotateGizmo(){ transformControlsRotate.enabled = true; transformControlsRotate.visible = true; }
	function disableTranslateGizmo(){ transformControls.enabled = false; transformControls.visible = false; }
	function enableTranslateGizmo(){ transformControls.enabled = true; transformControls.visible = true; }
	transformControls.addEventListener('mouseDown', () => { disableRotateGizmo(); });
	transformControls.addEventListener('mouseUp',   () => { enableRotateGizmo(); });
	transformControlsRotate.addEventListener('mouseDown', () => { disableTranslateGizmo(); });
	transformControlsRotate.addEventListener('mouseUp',   () => { enableTranslateGizmo(); });

	// Also guard via dragging-changed so touch/pen (no mouseDown/Up) behaves correctly
	transformControls.addEventListener('dragging-changed', e => { if (e.value) disableRotateGizmo(); else enableRotateGizmo(); });
	transformControlsRotate.addEventListener('dragging-changed', e => { if (e.value) disableTranslateGizmo(); else enableTranslateGizmo(); });

	// Multi-select pivot
	const multiSelectPivot = new THREE.Object3D(); multiSelectPivot.name='__MultiSelectPivot'; scene.add(multiSelectPivot);
	let multiStartPivotMatrix = new THREE.Matrix4();
	let multiStartMatrices = new Map();

	// State
	const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
	const groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
	let mode='edit';
	// Plan View Lock state
	let planViewLocked = false;
	const objects=[];
	const material=new THREE.MeshNormalMaterial({side:THREE.DoubleSide});
	let loadedModel=null;
	let selectionOutlines = [];
	let selectedObjects = [];
	let hasHardwareKeyboard3D = false; // set true after any keydown (non-modifier)
	// Touch double-tap tracking
	let lastTapAt = 0;
	let lastTapObj = null;
	// Mouse double-click fallback tracking
	let lastClickAt = 0;
	let lastClickObj = null;
	// Single selection display mode: 'gizmo' (default) or 'handles'
	let singleSelectionMode = 'gizmo';

	// Room Scan service
	const { createRoomScanService } = await import('./services/room-scan.js');
	const roomScan = createRoomScanService({
		THREE,
		renderer,
		scene,
		camera,
		controls,
		raycaster,
		pointer,
		getPointer,
		intersectGround,
		addObjectToScene,
		material,
		grid,
		loadWebXRPolyfillIfNeeded,
	});

	// Soft snapping config (feet): snap when within SNAP_ENTER; allow pushing past with up to SNAP_OVERLAP before releasing
	const SNAP_ENABLED = true;
	const SNAP_ENTER = 0.3; // start snapping within this gap
	const SNAP_OVERLAP = 0.06; // allow up to this much overlap while still snapping
	let snapGuard = false; // prevent re-entrant snaps

	function getWorldBoxOf(object){
		const box = new THREE.Box3();
		try { box.setFromObject(object); } catch {}
		return box;
	}

	function getCombinedWorldBox(objectsArr){
		const box = new THREE.Box3();
		box.makeEmpty();
		for (const o of objectsArr){
			try { box.expandByObject(o); } catch {}
		}
		return box;
	}

	function computeSnapDelta(movingBox, excludeSet){
		if (!SNAP_ENABLED) return { delta: new THREE.Vector3(0,0,0), axis: null, other: null, otherBox: null, movingFace: null, otherFace: null };
		return snapping.computeSnapDelta(THREE, movingBox, objects, excludeSet, SNAP_ENTER, SNAP_OVERLAP);
	}

	// Outline helpers
	function clearSelectionOutlines(){ selectionOutlines = outlines.clearSelectionOutlines(scene, selectionOutlines); }
	function rebuildSelectionOutlines(){ selectionOutlines = outlines.clearSelectionOutlines(scene, selectionOutlines); selectionOutlines = outlines.rebuildSelectionOutlines(THREE, scene, selectedObjects); }

		// Grabber handles for single selection
		let handlesGroup = null;
		let handleMeshes = [];
		let handleDrag = null; // { mesh, info, target, start:{box,center,objWorldPos,objScale,originOffset}, dragPlane }
		// Track last target/matrix to know when to update handle positions
		let lastHandleTarget = null;
		let lastHandleMatrix = new THREE.Matrix4();
		let lastHandleScale = new THREE.Vector3(1,1,1);
		function clearHandles(){ if (handlesGroup){ scene.remove(handlesGroup); handlesGroup = null; } handleMeshes = []; handleDrag = null; controls.enabled = true; lastHandleTarget = null; }
		function buildHandlesForObject(obj){
				clearHandles(); if (!obj) return; handleDrag = null; controls.enabled = true;
				// Helpers
				function computeLocalOBB(target){
					const invWorld = new THREE.Matrix4().copy(target.matrixWorld).invert();
					const boxLocal = new THREE.Box3(); boxLocal.makeEmpty();
					const v = new THREE.Vector3();
					target.traverseVisible(node => {
						if (!node.isMesh || !node.geometry) return;
						const geom = node.geometry;
						if (!geom.boundingBox) geom.computeBoundingBox();
						const bb = geom.boundingBox; if (!bb) return;
						for (let xi=0; xi<2; xi++) for (let yi=0; yi<2; yi++) for (let zi=0; zi<2; zi++){
							v.set(xi?bb.max.x:bb.min.x, yi?bb.max.y:bb.min.y, zi?bb.max.z:bb.min.z);
							v.applyMatrix4(node.matrixWorld); // to world
							v.applyMatrix4(invWorld); // into target local
							boxLocal.expandByPoint(v);
						}
					});
					return boxLocal;
				}
				function getTRMatrix(target){
					const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
					target.matrixWorld.decompose(pos, quat, scl);
					return new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1,1,1));
				}
				// Compute oriented box in local space for visual placement
				obj.updateMatrixWorld(true);
				const boxLocal = computeLocalOBB(obj);
				if (!isFinite(boxLocal.min.x) || !isFinite(boxLocal.max.x)) return;
				// Bake current object scale into the local box coordinates so handles don't scale visually
				const sObj = obj.scale.clone();
				const minL = boxLocal.min.clone().multiply(sObj);
				const maxL = boxLocal.max.clone().multiply(sObj);
				const ctrL = boxLocal.getCenter(new THREE.Vector3()).multiply(sObj);
				// Also compute world AABB for anchor math (preserve existing drag behavior)
				const boxW = new THREE.Box3().setFromObject(obj);
				const minW = boxW.min.clone(); const maxW = boxW.max.clone(); const ctrW = boxW.getCenter(new THREE.Vector3());
				// Create a TR-aligned group so handles rotate/translate with object but ignore its scale
				handlesGroup = new THREE.Group(); handlesGroup.name = '__HandlesGroup'; handlesGroup.matrixAutoUpdate = false;
				handlesGroup.matrix.copy(getTRMatrix(obj)); handlesGroup.matrixWorldNeedsUpdate = true; scene.add(handlesGroup);
				const xsL=[minL.x,maxL.x], ysL=[minL.y,maxL.y], zsL=[minL.z,maxL.z];
				const xsW=[minW.x,maxW.x], ysW=[minW.y,maxW.y], zsW=[minW.z,maxW.z];
			const mk = (pos, kind, mask, anchor, sel) => {
				const geo = new THREE.SphereGeometry(0.105, 16, 12);
				const color = (kind==='center')?0x0066ff : (kind==='face'?0x00aa55 : (kind==='edge'?0xff8800:0xdd2255));
				const mat = new THREE.MeshBasicMaterial({ color, depthTest: true });
				const m = new THREE.Mesh(geo, mat);
				// Place in object's local frame; group carries TR to world
				m.position.copy(pos);
				m.userData.__handle = { kind, mask, anchor: anchor.clone(), sel };
				m.renderOrder = 10; handlesGroup.add(m); handleMeshes.push(m);
			};
			// corners (8)
			for (let xi=0; xi<2; xi++) for (let yi=0; yi<2; yi++) for (let zi=0; zi<2; zi++){
				const p = new THREE.Vector3(xsL[xi], ysL[yi], zsL[zi]);
				const a = new THREE.Vector3(xsL[1-xi], ysL[1-yi], zsL[1-zi]);
				mk(p, 'corner', [1,1,1], a, { type:'corner', xi, yi, zi });
			}
			// edges X (y,z vary)
			for (let yi=0; yi<2; yi++) for (let zi=0; zi<2; zi++){
				const p = new THREE.Vector3(ctrL.x, ysL[yi], zsL[zi]);
				const a = new THREE.Vector3(ctrL.x, ysL[1-yi], zsL[1-zi]);
				mk(p, 'edge', [0,1,1], a, { type:'edgeX', yi, zi });
			}
			// edges Y (x,z vary)
			for (let xi=0; xi<2; xi++) for (let zi=0; zi<2; zi++){
				const p = new THREE.Vector3(xsL[xi], ctrL.y, zsL[zi]);
				const a = new THREE.Vector3(xsL[1-xi], ctrL.y, zsL[1-zi]);
				mk(p, 'edge', [1,0,1], a, { type:'edgeY', xi, zi });
			}
			// edges Z (x,y vary)
			for (let xi=0; xi<2; xi++) for (let yi=0; yi<2; yi++){
				const p = new THREE.Vector3(xsL[xi], ysL[yi], ctrL.z);
				const a = new THREE.Vector3(xsL[1-xi], ysL[1-yi], ctrL.z);
				mk(p, 'edge', [1,1,0], a, { type:'edgeZ', xi, yi });
			}
			// faces (6)
			mk(new THREE.Vector3(minL.x, ctrL.y, ctrL.z), 'face', [1,0,0], new THREE.Vector3(maxL.x, ctrL.y, ctrL.z), { type:'faceX', side:-1 });
			mk(new THREE.Vector3(maxL.x, ctrL.y, ctrL.z), 'face', [1,0,0], new THREE.Vector3(minL.x, ctrL.y, ctrL.z), { type:'faceX', side:1 });
			mk(new THREE.Vector3(ctrL.x, minL.y, ctrL.z), 'face', [0,1,0], new THREE.Vector3(ctrL.x, maxL.y, ctrL.z), { type:'faceY', side:-1 });
			mk(new THREE.Vector3(ctrL.x, maxL.y, ctrL.z), 'face', [0,1,0], new THREE.Vector3(ctrL.x, minL.y, ctrL.z), { type:'faceY', side:1 });
			mk(new THREE.Vector3(ctrL.x, ctrL.y, minL.z), 'face', [0,0,1], new THREE.Vector3(ctrL.x, ctrL.y, maxL.z), { type:'faceZ', side:-1 });
			mk(new THREE.Vector3(ctrL.x, ctrL.y, maxL.z), 'face', [0,0,1], new THREE.Vector3(ctrL.x, ctrL.y, minL.z), { type:'faceZ', side:1 });
			// center
			mk(ctrL, 'center', [0,0,0], ctrW.clone(), { type:'center' });

			// Remember this target for sync
			obj.updateMatrixWorld(true);
			lastHandleTarget = obj;
			lastHandleMatrix.copy(obj.matrixWorld);
			lastHandleScale.copy(obj.scale);
		}
		function updateHandles(){ if (selectedObjects.length===1) buildHandlesForObject(selectedObjects[0]); else clearHandles(); }

		// During a handle drag, refresh positions to reflect changing extents without a full rebuild
		function refreshHandlePositionsDuringDrag(target){
			if (!handlesGroup || !handleMeshes || !handleMeshes.length) return;
			target.updateMatrixWorld(true);
			// Recompute TR and local OBB (scaled local) like buildHandles
			const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
			target.matrixWorld.decompose(pos, quat, scl);
			const TR = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1,1,1));
			const invTR = TR.clone().invert();
			const boxL = new THREE.Box3(); boxL.makeEmpty();
			const v = new THREE.Vector3();
			target.traverseVisible(node => {
				if (!node.isMesh || !node.geometry) return;
				const geom = node.geometry; if (!geom.boundingBox) geom.computeBoundingBox();
				const bb = geom.boundingBox; if (!bb) return;
				for (let xi=0; xi<2; xi++) for (let yi=0; yi<2; yi++) for (let zi=0; zi<2; zi++){
					v.set(xi?bb.max.x:bb.min.x, yi?bb.max.y:bb.min.y, zi?bb.max.z:bb.min.z);
					v.applyMatrix4(node.matrixWorld);
					v.applyMatrix4(invTR);
					boxL.expandByPoint(v);
				}
			});
			const minL = boxL.min.clone(); const maxL = boxL.max.clone(); const ctrL = boxL.getCenter(new THREE.Vector3());
			const xsL=[minL.x,maxL.x], ysL=[minL.y,maxL.y], zsL=[minL.z,maxL.z];
			for (const m of handleMeshes){
				const info = m.userData.__handle && m.userData.__handle.sel;
				if (!info) continue;
				switch(info.type){
					case 'corner': m.position.set(xsL[info.xi], ysL[info.yi], zsL[info.zi]); break;
					case 'edgeX': m.position.set(ctrL.x, ysL[info.yi], zsL[info.zi]); break;
					case 'edgeY': m.position.set(xsL[info.xi], ctrL.y, zsL[info.zi]); break;
					case 'edgeZ': m.position.set(xsL[info.xi], ysL[info.yi], ctrL.z); break;
					case 'faceX': m.position.set(info.side<0?minL.x:maxL.x, ctrL.y, ctrL.z); break;
					case 'faceY': m.position.set(ctrL.x, info.side<0?minL.y:maxL.y, ctrL.z); break;
					case 'faceZ': m.position.set(ctrL.x, ctrL.y, info.side<0?minL.z:maxL.z); break;
					case 'center': m.position.copy(ctrL); break;
				}
			}
		}

	const getWorldMatrix = transforms.getWorldMatrix; const setWorldMatrix = transforms.setWorldMatrix;
	function updateMultiSelectPivot(){
		if(selectedObjects.length < 2) return;
		const center = new THREE.Vector3(); const tmp = new THREE.Vector3();
		selectedObjects.forEach(o=>{ o.updateMatrixWorld(); tmp.setFromMatrixPosition(o.matrixWorld); center.add(tmp); });
		center.multiplyScalar(1/selectedObjects.length);
		setWorldMatrix(multiSelectPivot, new THREE.Matrix4().compose(center, new THREE.Quaternion(), new THREE.Vector3(1,1,1)));
	}
	function attachTransformForSelection(){
		if(mode !== 'edit') { transformControls.detach(); transformControlsRotate.detach(); clearHandles(); return; }
		if(selectedObjects.length === 1){
			// Special-case: 2D Overlay group is movable on ground plane (X/Z only)
			if (selectedObjects[0] && selectedObjects[0].name === '2D Overlay'){
				clearHandles();
				transformControls.attach(selectedObjects[0]);
				if (typeof transformControls.setMode === 'function') transformControls.setMode('translate');
				// If TransformControls supports axis visibility flags, hide Y
				if ('showX' in transformControls) { transformControls.showX = true; }
				if ('showY' in transformControls) { transformControls.showY = false; }
				if ('showZ' in transformControls) { transformControls.showZ = true; }
				// Ensure rotate gizmo is disabled for overlay moves
				transformControlsRotate.detach(); disableRotateGizmo(); enableTranslateGizmo();
				return;
			}
			// Helper: identify walls by name
			const isWall = (obj) => { const n = (obj && obj.name || '').toLowerCase(); return n.includes('wall'); };
			// Reset rotate axes visibility defensively on each selection attach
			if ('showX' in transformControlsRotate) { transformControlsRotate.showX = true; }
			if ('showY' in transformControlsRotate) { transformControlsRotate.showY = true; }
			if ('showZ' in transformControlsRotate) { transformControlsRotate.showZ = true; }
			if (singleSelectionMode === 'handles'){
				// In handles mode we normally hide gizmos; for Plan Lock + Wall we still allow rotate gizmo, not translate
				transformControls.detach(); transformControlsRotate.detach();
				updateHandles();
				// Ensure initial TR sync for the handles group
				if (handlesGroup && selectedObjects[0]){
					selectedObjects[0].updateMatrixWorld(true);
					const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
					selectedObjects[0].matrixWorld.decompose(pos, quat, scl);
					handlesGroup.matrix.copy(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1,1,1)));
					handlesGroup.matrixWorldNeedsUpdate = true;
				}
				// If plan-locked wall: keep only faceX handles (length) and show rotate gizmo; disable translate
				if (planViewLocked && isWall(selectedObjects[0])){
					if (handleMeshes && handleMeshes.length){
						handleMeshes.forEach(m => {
							const sel = m && m.userData && m.userData.__handle && m.userData.__handle.sel;
							m.visible = !!(sel && sel.type === 'faceX');
						});
					}
					transformControlsRotate.attach(selectedObjects[0]);
					if (typeof transformControlsRotate.setMode === 'function') transformControlsRotate.setMode('rotate');
					// Only allow rotation around Y in plan (if supported by TransformControls)
					if ('showX' in transformControlsRotate) { transformControlsRotate.showX = false; }
					if ('showZ' in transformControlsRotate) { transformControlsRotate.showZ = false; }
					if ('showY' in transformControlsRotate) { transformControlsRotate.showY = true; }
					enableRotateGizmo();
					disableTranslateGizmo();
				}
			} else {
				clearHandles();
				transformControls.attach(selectedObjects[0]);
				if (typeof transformControls.setMode === 'function') transformControls.setMode('translate');
				transformControlsRotate.attach(selectedObjects[0]);
				if (typeof transformControlsRotate.setMode === 'function') transformControlsRotate.setMode('rotate');
				// Restore rotate axes visibility if previously restricted
				if ('showX' in transformControlsRotate) { transformControlsRotate.showX = true; }
				if ('showY' in transformControlsRotate) { transformControlsRotate.showY = true; }
				if ('showZ' in transformControlsRotate) { transformControlsRotate.showZ = true; }
				enableTranslateGizmo();
				enableRotateGizmo();
			}
		}
		else if(selectedObjects.length >= 2){ updateMultiSelectPivot(); transformControls.attach(multiSelectPivot); transformControlsRotate.attach(multiSelectPivot); enableTranslateGizmo(); enableRotateGizmo(); clearHandles(); }
		else { transformControls.detach(); transformControlsRotate.detach(); clearHandles(); }
	}
	function captureMultiStart(){ multiStartPivotMatrix = getWorldMatrix(multiSelectPivot); multiStartMatrices.clear(); selectedObjects.forEach(o=> multiStartMatrices.set(o, getWorldMatrix(o))); }
	function applyMultiDelta(){ if(selectedObjects.length<2) return; const currentPivot=getWorldMatrix(multiSelectPivot); const invStart=multiStartPivotMatrix.clone().invert(); const delta=new THREE.Matrix4().multiplyMatrices(currentPivot,invStart); selectedObjects.forEach(o=>{ const start=multiStartMatrices.get(o); if(!start) return; const newWorld=new THREE.Matrix4().multiplyMatrices(delta,start); setWorldMatrix(o,newWorld); }); }
	transformControls.addEventListener('dragging-changed', e => { if(e.value && transformControls.object===multiSelectPivot) captureMultiStart(); });
	transformControls.addEventListener('dragging-changed', e => { if (!e.value) { snapVisuals.hide(); saveSessionDraftSoon(); } });
	transformControls.addEventListener('objectChange', () => {
		if(transformControls.object===multiSelectPivot) { applyMultiDelta(); return; }
		// Constrain 2D Overlay to ground plane Y during translation
		if (transformControls.object && transformControls.object.name === '2D Overlay'){
			const obj = transformControls.object;
			obj.position.y = 0; // keep at ground plane
			obj.updateMatrixWorld(true);
			return;
		}
		// Soft snap for single-object translate moves
		if (SNAP_ENABLED && selectedObjects.length===1 && transformControls.object===selectedObjects[0]){
			const target = selectedObjects[0];
			const movingBox = new THREE.Box3().setFromObject(target);
			const exclude = new Set([target]);
			const snap = computeSnapDelta(movingBox, exclude);
			if (snap.delta.lengthSq() > 0){
				const parent = target.parent || scene;
				const newWorldPos = target.getWorldPosition(new THREE.Vector3()).add(snap.delta);
				const newLocal = parent.worldToLocal(newWorldPos.clone());
				target.position.copy(newLocal);
				target.updateMatrixWorld(true);
				rebuildSelectionOutlines();
				snapVisuals.showAt(movingBox, snap);
			}
			else { snapVisuals.hide(); }
			// Debounced autosave as objects move
			saveSessionDraftSoon();
		}
	});
	transformControlsRotate.addEventListener('dragging-changed', e => { if(e.value && transformControlsRotate.object===multiSelectPivot) captureMultiStart(); });
	transformControlsRotate.addEventListener('dragging-changed', e => { if (!e.value) saveSessionDraftSoon(); });
	transformControlsRotate.addEventListener('objectChange', () => { if(transformControlsRotate.object===multiSelectPivot) applyMultiDelta(); saveSessionDraftSoon(); });

	// UI refs
const viewPerspectiveBtn = document.getElementById('viewPerspective');
const viewAxonBtn = document.getElementById('viewAxon');
	const uiContainer=document.getElementById('ui-container');
	const modeSelect=document.getElementById('modeSelect');
	const editUI=document.getElementById('edit-ui');
	const toolbox=document.getElementById('toolbox');
	const togglePrimsBtn = document.getElementById('togglePrims');
	const primsGroup = document.getElementById('primsGroup');
	const toggleDrawCreateBtn = document.getElementById('toggleDrawCreate');
	const drawCreateGroup = document.getElementById('drawCreateGroup');
	const toggleUtilsBtn = document.getElementById('toggleUtils');
	const utilsGroup = document.getElementById('utilsGroup');
	const toggleSceneManagerBtn = document.getElementById('toggleSceneManager');
	const sceneManagerGroup = document.getElementById('sceneManagerGroup');
	const toggleImportBtn = document.getElementById('toggleImport');
	const importGroup = document.getElementById('importGroup');
	const toggleSettingsBtn = document.getElementById('toggleSettings');
	const settingsGroup = document.getElementById('settingsGroup');
	const toggleViewsBtn = document.getElementById('toggleViews');
	const viewsGroup = document.getElementById('viewsGroup');
	const viewPlanBtn = document.getElementById('viewPlan');
	// Mobile delete UI
	const mobileDeleteBar = document.getElementById('mobileDeleteBar');
	const mobileDeleteBtn = document.getElementById('mobileDeleteBtn');
	const viewNorthBtn = document.getElementById('viewNorth');
	const viewSouthBtn = document.getElementById('viewSouth');
	const viewEastBtn = document.getElementById('viewEast');
	const viewWestBtn = document.getElementById('viewWest');
	const bgColorPicker = document.getElementById('bgColorPicker');
	const gridColorPicker = document.getElementById('gridColorPicker');
	const gridSizeInput = document.getElementById('gridSizeInput');
	const gridDivsInput = document.getElementById('gridDivsInput');
	const gridInfiniteBtn = document.getElementById('gridInfiniteBtn');
	const matOriginalBtn = document.getElementById('matOriginal');
	const matCardboardBtn = document.getElementById('matCardboard');
	const matMdfBtn = document.getElementById('matMdf');
	const uploadBtn=document.getElementById('uploadModel');
	const fileInput=document.getElementById('modelInput');
	const placingPopup=document.getElementById('placingPopup');
	const placingName=document.getElementById('placingName');
	const placingCancel=document.getElementById('placingCancel');
	const addFloorBtn=document.getElementById('addFloor');
	const addWallBtn=document.getElementById('addWall');
	const objectList=document.getElementById('objectList');
	const arButton=document.getElementById('arButton');
	const mapBackdrop = document.getElementById('mapModalBackdrop');
	const mapContainer = document.getElementById('mapContainer');
	const mapSearchInput = document.getElementById('mapSearch');
	const mapSearchBtn = document.getElementById('mapSearchBtn');
	const mapDrawToggle = document.getElementById('mapDrawToggle');
	const mapCloseBtn = document.getElementById('mapCloseBtn');
	const mapUseFlatBtn = document.getElementById('mapUseFlat');
	const mapUseTopoBtn = document.getElementById('mapUseTopo');
	const mapImportBtn = document.getElementById('mapImport');
	// Plan View Lock parent button
	const planLockBtn = document.getElementById('planLock');
	// Scenes UI
	const saveSceneBtn = document.getElementById('saveScene');
	const openScenesBtn = document.getElementById('openScenes');
	const scenesDrawer = document.getElementById('scenesDrawer');
	const scenesList = document.getElementById('scenesList');
	// Track the currently loaded/saved scene so we can overwrite on Save
	let currentSceneId = null;
	let currentSceneName = '';

	// --- Session draft autosave (persist state across reloads/navigation) ---
	function __isHelperObject(obj){
		if (!obj) return true;
		if (obj === grid) return true;
		if (obj === transformControls || obj === transformControlsRotate) return true;
		if ((obj.name && (obj.name.startsWith('__') || obj.name.startsWith('Room Scan') || obj.name === 'Scan Point Cloud')) || (obj.userData && obj.userData.__helper)) return true;
		if (obj.isLight || obj.isCamera) return true;
		if (obj.isGridHelper) return true;
		return false;
	}
	function getPersistableObjects(){
		const list = [...objects];
		const have = new Set(list);
		for (const child of scene.children){
			if (have.has(child)) continue;
			if (__isHelperObject(child)) continue;
			// Only include Mesh/Group-like user content
			if (child && (child.type === 'Mesh' || child.type === 'Group' || child.type === 'Points')){
				list.push(child);
			}
		}
		return list;
	}
	function serializeScene() { return persistence.serializeSceneFromObjects(THREE, getPersistableObjects()); }

	// Expose a safe global accessor for current scene JSON (used by share-to-community flow)
	try { window.sketcherSerializeScene = serializeScene; window.sketcherObjectCount = () => getPersistableObjects().length; } catch {}

	// --- Picking helpers ---
	function __isHelperChain(node){
		let n = node;
		while(n){ if (n.userData && n.userData.__helper) return true; n = n.parent; }
		return false;
	}
	function __resolvePickedObjectFromHits(hits){
		for (const h of hits){
			let o = h.object;
			// Allow picking the 2D Overlay even though it's marked as helper
			if (__isHelperChain(o)){
				let n = o;
				let allowed = false;
				while(n){ if (n.name === '2D Overlay'){ allowed = true; o = n; break; } n = n.parent; }
				if (!allowed) continue;
			}
			while(o.parent && o.parent.type === 'Group' && objects.includes(o.parent)) o = o.parent;
			return o;
		}
		return null;
	}

	// --- Undo History (Ctrl/Cmd+Z) ---
	const __history = [];
	let __historyIndex = -1;
	const __historyLimit = 50;
	let __isRestoringHistory = false;
	function __captureSnapshot(reason = ''){
		try {
			const json = serializeScene();
			const str = JSON.stringify(json);
			// Dedupe: if same as current, skip
			if (__historyIndex >= 0 && __history[__historyIndex] && __history[__historyIndex].str === str) return;
			// If we undid and then make a new change, drop redo tail
			if (__historyIndex < __history.length - 1) __history.splice(__historyIndex + 1);
			__history.push({ json, str, t: Date.now(), reason });
			if (__history.length > __historyLimit) __history.shift();
			__historyIndex = __history.length - 1;
		} catch {}
	}
	async function __restoreFromSnapshot(idx){
		if (idx < 0 || idx >= __history.length) return;
		const rec = __history[idx]; if (!rec) return;
		__isRestoringHistory = true;
		try {
			// Clear and rebuild scene from JSON
			clearSceneObjects();
			const loader = new THREE.ObjectLoader();
			const root = loader.parse(rec.json);
			[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
			updateCameraClipping();
			// Update session draft to mirror this state without creating a new history entry
			try { sessionStorage.setItem('sketcher:sessionDraft', JSON.stringify({ json: rec.json })); } catch {}
		} catch(e) {
			console.error('Undo restore failed:', e);
		} finally {
			__isRestoringHistory = false;
		}
	}
	function __undo(){
		if (__historyIndex <= 0) return;
		__historyIndex -= 1;
		__restoreFromSnapshot(__historyIndex);
	}
	// Global key handler for Ctrl/Cmd+Z (no Shift); ignore when typing in inputs/textarea/contentEditable
	window.addEventListener('keydown',e=>{
		// Mark potential hardware keyboard presence on any non-modifier key
		try {
			const ign = ['Shift','Control','Alt','Meta','CapsLock','NumLock','ScrollLock'];
			if (!ign.includes(e.key)) hasHardwareKeyboard3D = true;
		} catch {}
		const isZ = (e.key === 'z' || e.key === 'Z');
		if (isZ && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			const toDeleteRaw = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []);
			const toDelete = toDeleteRaw.filter(o=>!__isOverlayOrChild(o));
			if (!toDelete.length) return; // nothing deletable selected (maybe overlay)
			const isEditable = (tag === 'input' || tag === 'textarea' || (tgt && tgt.isContentEditable));
			if (isEditable) return; // let browser handle text undo
			e.preventDefault();
			__undo();
		}
	});

	const sessionDraft = createSessionDraft({
		serializeScene,
		sessionKey: 'sketcher:sessionDraft',
		onAfterSave: ({ json }) => {
			// Also record undo snapshot when not restoring
			if (!__isRestoringHistory) {
				try {
					const str = JSON.stringify(json);
					if (__historyIndex >= 0 && __history[__historyIndex] && __history[__historyIndex].str === str) return;
					if (__historyIndex < __history.length - 1) __history.splice(__historyIndex + 1);
					__history.push({ json, str, t: Date.now(), reason: 'autosave' });
					if (__history.length > __historyLimit) __history.shift();
					__historyIndex = __history.length - 1;
				} catch {}
			}
		}
	});
	// Ensure latest draft is persisted on refresh/navigation
	window.addEventListener('beforeunload', () => { try { sessionDraft.saveNow(); } catch {} });
	window.addEventListener('pagehide', () => { try { sessionDraft.saveNow(); } catch {} });
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { sessionDraft.saveNow(); } catch {} } });
	function saveSessionDraftNow(){ sessionDraft.saveNow(); }
	function saveSessionDraftSoon(delay=250){ sessionDraft.saveSoon(delay); }

	// Visibility UI
	function updateVisibilityUI(){
		objectList.innerHTML='';
		// List regular user objects
		objects.forEach(obj=>{
			if (__isHelperObject(obj)) return; // skip helpers other than overlay
			const div=document.createElement('div');
			const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=obj.visible; cb.addEventListener('change',()=>{ obj.visible=cb.checked; saveSessionDraftSoon(); });
			const span=document.createElement('span'); span.textContent=obj.name; span.style.flex='1'; span.style.cursor='pointer';
			if(selectedObjects.includes(obj)) span.style.background='#ffe066';
			span.addEventListener('dblclick',()=>{ const inp=document.createElement('input'); inp.type='text'; inp.value=obj.name; inp.style.flex='1'; inp.addEventListener('blur',()=>{obj.name=inp.value||obj.name;updateVisibilityUI(); saveSessionDraftSoon();}); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();}); div.replaceChild(inp,span); inp.focus(); });
			span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
			div.append(cb,span); objectList.append(div);
		});
		// Add 2D Overlay as a managed row (visible toggle only; cannot delete)
		try {
			const ov = scene.getObjectByName('2D Overlay');
			if (ov){
				const div=document.createElement('div');
				const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=ov.visible; cb.addEventListener('change',()=>{ ov.visible=cb.checked; saveSessionDraftSoon(); });
				const span=document.createElement('span'); span.textContent=ov.name||'2D Overlay'; span.style.flex='1'; span.style.cursor='pointer';
				if(selectedObjects.includes(ov)) span.style.background='#ffe066';
				// No rename for overlay; click selects
				span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(ov)) selectedObjects=selectedObjects.filter(o=>o!==ov); else selectedObjects.push(ov); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[ov]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
				div.append(cb,span); objectList.append(div);
			}
		} catch{}
		// Toggle delete bar only on devices likely without a hardware keyboard
		try {
			if (mobileDeleteBar) {
				const ua = navigator.userAgent || '';
				const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
				const isTouchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
				const pointerFineHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
				const likelyDesktop = pointerFineHover && !isMobileUA;
				const inXR = !!(renderer && renderer.xr && renderer.xr.isPresenting) || !!arActive;
				const noKeyboard = !hasHardwareKeyboard3D && !likelyDesktop && (isMobileUA || isTouchCapable || inXR);
				const show = noKeyboard && mode==='edit' && (selectedObjects && selectedObjects.length > 0);
				mobileDeleteBar.style.display = show ? 'flex' : 'none';
			}
		} catch {}
	}

	// Hook delete action for mobile/no-keyboard button (mirrors Delete/Backspace handler)
	if (mobileDeleteBtn) {
		mobileDeleteBtn.addEventListener('click', () => {
			if (mode !== 'edit') return;
			const toDeleteRaw = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []);
			const toDelete = toDeleteRaw.filter(o=>!__isOverlayOrChild(o));
			if (!toDelete.length) return;
			toDelete.forEach(sel=>{ scene.remove(sel); const idx=objects.indexOf(sel); if(idx>-1)objects.splice(idx,1); });
			selectedObjects = []; transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); saveSessionDraftNow();
		});
	}

	function __isOverlayOrChild(node){ let n=node; while(n){ if(n.name==='2D Overlay') return true; n=n.parent; } return false; }

	// Settings: background and grid colors (with persistence)
	function disposeGrid(g){ try { gridUtils.disposeGrid(THREE, g); } catch {} }
	function setGridColor(hex){
		if (!grid) return;
		const wasVisible = grid.visible;
		const pos = grid.position.clone();
		const rot = grid.rotation.clone();
		scene.remove(grid);
		disposeGrid(grid);
		grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, hex, hex);
		grid.receiveShadow = true;
		grid.position.copy(pos);
		grid.rotation.copy(rot);
		// Keep depthWrite disabled to reduce shimmer/flicker
		try {
		  if (Array.isArray(grid.material)) grid.material.forEach(m => { if (m) m.depthWrite = false; });
		  else if (grid.material) grid.material.depthWrite = false;
		} catch {}
		try { enhanceGridMaterial(grid.material); } catch {}
		grid.visible = wasVisible;
		scene.add(grid);
	}

	function rebuildGrid() {
		const hex = (gridColorPicker && gridColorPicker.value) || '#ffffff';
		setGridColor(hex);
	}

	// --- Global Material Style (Original/Cardboard/MDF) ---
	// Preserve original materials for each mesh so we can restore them later
	const __originalMaterials = new WeakMap();
	function forEachMeshInScene(cb){
		const stack = [...scene.children];
		while (stack.length){
			const o = stack.pop();
			if (!o) continue;
			// Skip helpers (grid, lights, cameras, gizmos, scan previews, etc.)
			if (__isHelperObject(o)) { continue; }
			// Never apply style overrides to map-imported geometry; skip entire subtree
			const isMapImport = (o.userData && (o.userData.__mapImport === true || o.userData.mapImport === true))
				|| (o.name === 'Imported Topography' || o.name === 'Imported Flat Area');
			if (isMapImport) { continue; }
			if (!o.visible) { if (o.children && o.children.length) stack.push(...o.children); continue; }
			if (o.isMesh) cb(o);
			if (o.children && o.children.length) stack.push(...o.children);
		}
	}
	function ensureOriginalMaterial(mesh){ if (!__originalMaterials.has(mesh)) __originalMaterials.set(mesh, mesh.material); }

	// Texture/material caches (shared instances)
	let __cardboardMat = null; // final shared material (photo if available, else procedural)
	let __mdfMat = null;       // final shared material (photo if available, else procedural)
	let __sketchMat = null;    // shared sketch material (procedural only)

	// Sketch style environment overrides and temps
	let __sketchPrevBg = null;           // string like '#rrggbb'
	let __sketchPrevGrid = null;         // string like '#rrggbb'
	let __sketchOverrideActive = false;  // whether overrides are active
	// Track attached sketch outline nodes so we can remove/dispose on exit
	const __sketchOutlineNodes = new Set();

	// Procedural fallback textures (lightweight, immediate)
	function makeNoiseCanvas(w=256,h=256,opts={}){
		const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
		ctx.fillStyle=opts.base||'#c9a46a'; ctx.fillRect(0,0,w,h);
		const grains=opts.grains||800; const alpha=opts.alpha||0.06; const size=opts.size||1.2; const hueJitter=opts.hueJitter||0;
		for(let i=0;i<grains;i++){
			const x=Math.random()*w, y=Math.random()*h; const s=(Math.random()*size)+0.4; const a=alpha*Math.random();
			ctx.fillStyle=`rgba(0,0,0,${a.toFixed(3)})`; ctx.fillRect(x,y,s,s);
			if (hueJitter>0){ ctx.fillStyle=`rgba(255,255,255,${(a*0.5).toFixed(3)})`; ctx.fillRect(x+0.5,y+0.5,s*0.7,s*0.7); }
		}
		// Subtle vertical stripes for corrugation hint
		if (opts.stripes){
			ctx.globalAlpha = 0.05; ctx.fillStyle = '#000';
			const period = opts.period || 18;
			for(let x=0;x<w;x+=period){ ctx.fillRect(x,0,1,h); }
			ctx.globalAlpha = 1;
		}
		return c;
	}
	function makeCardboardMaterialProcedural(){
		const texCanvas = makeNoiseCanvas(512,512,{ base:'#c9a46a', grains:1400, alpha:0.08, size:1.4, hueJitter:0.2, stripes:true, period:22 });
		const tex = new THREE.CanvasTexture(texCanvas);
		if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1.5,1.5);
		return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
	}
	function makeMDFMaterialProcedural(){
		const texCanvas = makeNoiseCanvas(512,512,{ base:'#b8aa8f', grains:1200, alpha:0.06, size:1.2, hueJitter:0.15, stripes:false });
		const tex = new THREE.CanvasTexture(texCanvas);
		if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1.8,1.8);
		return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
	}
	function makeSketchMaterialProcedural(){
		// White toon material, front faces only
		const mat = new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.FrontSide });
		try { mat.userData = { ...(mat.userData||{}), procedural: true, base: 'sketch' }; } catch {}
		return mat;
	}
	function restoreOriginalMaterials(){ forEachMeshInScene(m=>{ const orig = __originalMaterials.get(m); if (orig) m.material = orig; }); }
	function __isMaterialOverrideChain(node){ let n=node; while(n){ if (n.userData && n.userData.__materialOverride) return true; n = n.parent; } return false; }
	function applyUniformMaterial(sharedMat){ forEachMeshInScene(m=>{ if (__isMaterialOverrideChain(m)) return; ensureOriginalMaterial(m); m.material = sharedMat; }); }
	function restoreOriginalMaterialsRespectingOverrides(){ forEachMeshInScene(m=>{ if (__isMaterialOverrideChain(m)) return; const orig = __originalMaterials.get(m); if (orig) m.material = orig; }); }
	function applyStyleToSubtree(root, style){
		const stack = [root];
		const use = (s)=> getActiveSharedMaterial(s) || getProceduralSharedMaterial(s) || material;
		while (stack.length){
			const o = stack.pop();
			if (!o) continue;
			if (o.isMesh){
				ensureOriginalMaterial(o);
				if (style === 'original') o.material = material; else o.material = use(style);
			}
			if (o.children && o.children.length) stack.push(...o.children);
		}
	}

	// Loader helpers for photoreal textures (optional assets)
	const __textureLoader = new THREE.TextureLoader();
	function setTexCommon(tex, { sRGB=false, repeat=1.5 }={}){
		try { if (sRGB && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; } catch {}
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat);
		tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8);
		tex.needsUpdate = true; return tex;
	}
	async function loadTextureAny(urls, opts){
		for (const u of urls){
			try { const tex = await __textureLoader.loadAsync(u); return setTexCommon(tex, opts); } catch (e) { /* try next */ }
		}
		return null;
	}
	async function buildPhotoMaterial(kind){
		const base = `./assets/textures/`;
		if (kind === 'cardboard'){
			const map = await loadTextureAny([base+'cardboard_basecolor.jpg', base+'cardboard_basecolor.png'], { sRGB:true, repeat:1.6 });
			if (!map) return makeCardboardMaterialProcedural();
			const normalMap = await loadTextureAny([base+'cardboard_normal.jpg', base+'cardboard_normal.png']);
			const roughnessMap = await loadTextureAny([base+'cardboard_roughness.jpg', base+'cardboard_roughness.png']);
			const mat = new THREE.MeshStandardMaterial({ map, normalMap: normalMap||undefined, roughnessMap: roughnessMap||undefined, roughness: roughnessMap?1.0:0.9, metalness: 0.0, side: THREE.DoubleSide });
			if (normalMap) mat.normalScale = new THREE.Vector2(0.6, 0.6);
			return mat;
		}
		if (kind === 'mdf'){
			const map = await loadTextureAny([base+'mdf_basecolor.jpg', base+'mdf_basecolor.png'], { sRGB:true, repeat:1.8 });
			if (!map) return makeMDFMaterialProcedural();
			const normalMap = await loadTextureAny([base+'mdf_normal.jpg', base+'mdf_normal.png']);
			const roughnessMap = await loadTextureAny([base+'mdf_roughness.jpg', base+'mdf_roughness.png']);
			const mat = new THREE.MeshStandardMaterial({ map, normalMap: normalMap||undefined, roughnessMap: roughnessMap||undefined, roughness: roughnessMap?1.0:0.85, metalness: 0.0, side: THREE.DoubleSide });
			if (normalMap) mat.normalScale = new THREE.Vector2(0.35, 0.35);
			return mat;
		}
		return null;
	}

	// Material style orchestration
	let currentMaterialStyle = 'original';
	let __materialLoadPromise = null;
	let __sketchOutlines = null; // THREE.Group of outlines

	function getRendererClearColorHex(){
		const c = new THREE.Color();
		try { renderer.getClearColor(c); } catch {}
		return `#${c.getHexString()}`;
	}
	function applySketchOverrides(){
		if (__sketchOverrideActive) return;
		__sketchPrevBg = getRendererClearColorHex();
		try {
			__sketchPrevGrid = (gridColorPicker && gridColorPicker.value) || localStorage.getItem('sketcher.gridColor') || '#ffffff';
		} catch { __sketchPrevGrid = '#ffffff'; }
		// Override display without touching persisted prefs
		try { if (bgColorPicker) bgColorPicker.disabled = true; } catch {}
		try { if (gridColorPicker) gridColorPicker.disabled = true; } catch {}
		renderer.setClearColor('#ffffff');
		setGridColor('#999999');
		__sketchOverrideActive = true;
	}
	function restoreSketchOverridesIfAny(){
		if (!__sketchOverrideActive) return;
		if (__sketchPrevBg) renderer.setClearColor(__sketchPrevBg);
		if (__sketchPrevGrid) setGridColor(__sketchPrevGrid);
		try { if (bgColorPicker) bgColorPicker.disabled = false; } catch {}
		try { if (gridColorPicker) gridColorPicker.disabled = false; } catch {}
		__sketchPrevBg = null; __sketchPrevGrid = null; __sketchOverrideActive = false;
	}
	function disposeSketchOutlines(){
		if(__sketchOutlines){
			try { scene.remove(__sketchOutlines); } catch {}
			__sketchOutlines.traverse(o=>{ try { o.geometry && o.geometry.dispose && o.geometry.dispose(); } catch {} try { o.material && o.material.dispose && o.material.dispose(); } catch {} });
			__sketchOutlines = null;
		}
		// Also remove attached nodes from meshes
		__sketchOutlineNodes.forEach(node => {
			try {
				if (node.parent) node.parent.remove(node);
				node.traverse(o=>{ try { o.geometry && o.geometry.dispose && o.geometry.dispose(); } catch {} try { o.material && o.material.dispose && o.material.dispose(); } catch {} });
			} catch {}
		});
		__sketchOutlineNodes.clear();
	}
	function jitterEdgesGeometry(egeo, amount){
		// returns a new BufferGeometry with jittered positions
		const src = egeo.attributes.position;
		const dst = new Float32Array(src.array.length);
		for (let i=0;i<src.count;i++){
			const ix = i*3;
			dst[ix]   = src.array[ix]   + (Math.random()-0.5)*amount;
			dst[ix+1] = src.array[ix+1] + (Math.random()-0.5)*amount;
			dst[ix+2] = src.array[ix+2] + (Math.random()-0.5)*amount;
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(dst, 3));
		return g;
	}
	function makeSketchLinesForMesh(m){
		const srcGeo = m.geometry; if (!srcGeo) return null;
		try { if (!srcGeo.boundingSphere) srcGeo.computeBoundingSphere(); } catch {}
		const r = (srcGeo.boundingSphere && Number.isFinite(srcGeo.boundingSphere.radius)) ? srcGeo.boundingSphere.radius : 1;
		const egeo = new THREE.EdgesGeometry(srcGeo, 1);
		const grp = new THREE.Group();
		// Single jittered stroke for a hand-drawn outline
		const jitterBase = Math.max(0.0015, Math.min(0.01, r * 0.0025));
		const jgeo = jitterEdgesGeometry(egeo, jitterBase);
		const mat = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.85 });
		const lines = new THREE.LineSegments(jgeo, mat);
		grp.add(lines);
		// Mark as helper/non-selectable and disable raycasting so it can't be picked or moved
		grp.name = '__sketchOutline'; grp.userData.__helper = true; lines.userData.__helper = true;
		grp.raycast = function(){}; lines.raycast = function(){};
		// Attach in mesh-local space so it follows transforms automatically
		grp.position.set(0,0,0); grp.rotation.set(0,0,0); grp.scale.set(1,1,1);
		return grp;
	}
	function getActiveSharedMaterial(style){
		if (style === 'cardboard') return __cardboardMat || null;
		if (style === 'mdf') return __mdfMat || null;
		if (style === 'sketch') return __sketchMat || null;
		return null;
	}
	function getProceduralSharedMaterial(style){
		if (style === 'cardboard') {
			if (!__cardboardMat) { __cardboardMat = makeCardboardMaterialProcedural(); try { __cardboardMat.userData = { ...( __cardboardMat.userData||{} ), procedural: true }; } catch {} }
			return __cardboardMat;
		}
		if (style === 'mdf') {
			if (!__mdfMat) { __mdfMat = makeMDFMaterialProcedural(); try { __mdfMat.userData = { ...( __mdfMat.userData||{} ), procedural: true }; } catch {} }
			return __mdfMat;
		}
		if (style === 'sketch') {
			if (!__sketchMat) { __sketchMat = makeSketchMaterialProcedural(); try { __sketchMat.userData = { ...( __sketchMat.userData||{} ), procedural: true }; } catch {} }
			return __sketchMat;
		}
		return null;
	}
	function setMaterialButtons(style){
		if (matOriginalBtn) matOriginalBtn.setAttribute('aria-pressed', style==='original'?'true':'false');
		if (matCardboardBtn) matCardboardBtn.setAttribute('aria-pressed', style==='cardboard'?'true':'false');
		if (matMdfBtn) matMdfBtn.setAttribute('aria-pressed', style==='mdf'?'true':'false');
		const matSketchBtn = document.getElementById('matSketch'); if (matSketchBtn) matSketchBtn.setAttribute('aria-pressed', style==='sketch'?'true':'false');
	}
	function applyMaterialStyle(style){
		style = style || 'original';
		currentMaterialStyle = style;
		// Persist selection
		try { localStorage.setItem('sketcher.materialStyle', style); } catch {}
		// Handle environment overrides toggling
		if (style !== 'sketch') restoreSketchOverridesIfAny();
		// Immediate path
		if (style === 'original') {
			// Apply a shared MeshNormalMaterial to the whole scene
			applyUniformMaterial(material);
			disposeSketchOutlines();
			setMaterialButtons(style);
			return;
		}
		// Apply procedural immediately, then upgrade to photo when ready
		const proc = getProceduralSharedMaterial(style);
		applyUniformMaterial(proc);
		setMaterialButtons(style);
		// Sketch style specifics: overrides, outlines, and per-mesh grey shades
		if (style === 'sketch'){
			applySketchOverrides();
			disposeSketchOutlines();
			// Build plane/feature-edge outlines and attach to each mesh so they follow
			forEachMeshInScene(m => {
				const lines = makeSketchLinesForMesh(m);
				if (lines) { try { m.add(lines); __sketchOutlineNodes.add(lines); } catch {} }
			});
		} else {
			disposeSketchOutlines();
		}
		// On narrow/mobile, skip photoreal upgrade to keep it light
		const isMobileNarrow = Math.min(window.innerWidth, window.innerHeight) <= 640;
		if (isMobileNarrow) return;
		// Kick off async load (debounced to one in-flight per style)
		const need = (style === 'cardboard' && (!__cardboardMat || __cardboardMat.userData?.procedural))
				 || (style === 'mdf' && (!__mdfMat || __mdfMat.userData?.procedural)); // no photo upgrade for sketch
		if (!need) return;
		__materialLoadPromise = (async () => {
			const mat = await buildPhotoMaterial(style);
			if (mat && !mat.map) { try { mat.userData = { ...(mat.userData||{}), procedural: true }; } catch {} }
			if (style === 'cardboard') __cardboardMat = mat;
			if (style === 'mdf') __mdfMat = mat;
			if (currentMaterialStyle === style && mat) applyUniformMaterial(mat);
		})();
	}
	// Initialize selected material style from storage and expose public API
	(function(){
		let saved = 'original';
		try { const s = localStorage.getItem('sketcher.materialStyle'); if (s) saved = s; } catch {}
		applyMaterialStyle(saved);
		setMaterialButtons(saved);
		// Public, stable API for other modules (UI wiring, etc.)
		try {
			window.sketcherMaterialsAPI = {
				applyMaterialStyle,
				getActiveSharedMaterial,
				getProceduralSharedMaterial,
				getCurrentStyle: () => currentMaterialStyle,
				setMaterialButtons,
			};
			// Signal readiness for late-loading UI modules
			document.dispatchEvent(new CustomEvent('sketcher:materials-ready'));
		} catch {}
	})();

	// Texture library folder (File System Access API)
	let __textureLibHandle = null;
	let __textureNames = [];
	async function restoreTextureLibraryHandle(){
		try {
			const { getTextureLibraryHandle } = localStore;
			if (typeof getTextureLibraryHandle === 'function') {
				const h = await getTextureLibraryHandle();
				if (h && h.kind === 'directory') __textureLibHandle = h;
			}
		} catch {}
	}
	async function refreshTextureNameList(){
		__textureNames = [];
		if (!__textureLibHandle) return;
		try {
			for await (const entry of __textureLibHandle.values()){
				if (entry.kind === 'file' && entry.name) __textureNames.push(entry.name);
			}
			try {
				const dl = document.getElementById('teTexList');
				if (dl) { dl.innerHTML = ''; __textureNames.slice(0,500).forEach(n=>{ const o=document.createElement('option'); o.value=n; dl.appendChild(o); }); }
			} catch {}
		} catch {}
	}
	async function chooseTextureLibrary(){
		if (!window.showDirectoryPicker) { alert('Your browser does not support choosing a texture folder. Please use a recent Chromium-based browser.'); return; }
		try {
			const handle = await window.showDirectoryPicker({ mode: 'read' });
			__textureLibHandle = handle;
			const { setTextureLibraryHandle } = localStore;
			if (typeof setTextureLibraryHandle === 'function') await setTextureLibraryHandle(handle);
			try { const name = handle.name || 'Folder'; document.dispatchEvent(new CustomEvent('sketcher:texture-folder-updated', { detail: { name } })); } catch {}
			await refreshTextureNameList();
		} catch (e) { /* user cancelled */ }
	}
	document.addEventListener('sketcher:chooseTextureFolder', chooseTextureLibrary);
	await restoreTextureLibraryHandle();
	try { if (__textureLibHandle) document.dispatchEvent(new CustomEvent('sketcher:texture-folder-updated', { detail: { name: __textureLibHandle.name || 'Folder' } })); } catch {}
	await refreshTextureNameList();

	// Texture Editor wiring: per-object apply/clear (face mode stub)
	(function(){
		function setTexProps(tex, detail){
			try {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
				tex.repeat.set(detail?.repeat?.x || 1, detail?.repeat?.y || 1);
				tex.offset.set(detail?.offset?.x || 0, detail?.offset?.y || 0);
				tex.rotation = detail?.rotation || 0;
				const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
				tex.anisotropy = Math.min(16, maxAniso || 8);
				tex.needsUpdate = true;
			} catch {}
		}
		async function loadTexFromTextureLibrary(nameLike){
			// Try to locate by basename (case-insensitive) in the chosen folder
			if (!__textureLibHandle || !nameLike) return null;
			try {
				const lower = String(nameLike).toLowerCase();
				for await (const entry of __textureLibHandle.values()){
					if (entry.kind === 'file' && entry.name && entry.name.toLowerCase() === lower) {
						const file = await entry.getFile();
						return file || null;
					}
				}
			} catch {}
			return null;
		}
		function isVideoFile(file){ return typeof file?.type === 'string' && file.type.startsWith('video/'); }
		function loadTexFromFile(file, { sRGB=false, detail }={}){
			return new Promise((resolve,reject)=>{
				if (!file) return resolve(null);
				const url = URL.createObjectURL(file);
				// Detect video vs image by MIME
				const isVideo = isVideoFile(file);
				if (isVideo) {
					try {
						const video = document.createElement('video');
						video.src = url;
						video.loop = true; video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous';
						const onReady = () => {
							try { video.play().catch(()=>{}); } catch {}
							const tex = new THREE.VideoTexture(video);
							try { if (sRGB && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; } catch {}
							tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
							setTexProps(tex, detail);
							resolve(tex);
						};
						video.addEventListener('loadeddata', onReady, { once: true });
						video.addEventListener('error', (e)=>{ try { URL.revokeObjectURL(url); } catch {} reject(e?.error||new Error('Video load failed')); }, { once: true });
					} catch (e) { try { URL.revokeObjectURL(url); } catch {} reject(e); }
					return;
				}
				const loader = new THREE.TextureLoader();
				loader.load(url, (tex)=>{
					try { if (sRGB && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; } catch {}
					setTexProps(tex, detail);
					resolve(tex);
					try { URL.revokeObjectURL(url); } catch {}
				}, undefined, (err)=>{ try { URL.revokeObjectURL(url); } catch {} reject(err); });
			});
		}
		document.addEventListener('sketcher:texture-editor:apply', async (ev) => {
			const detail = ev.detail || {};
			if (!selectedObjects || selectedObjects.length === 0) { alert('Select an object first.'); return; }
			const targetObjs = selectedObjects; // face mode will refine
			const filesUi = detail.files || {};
			// Accept both UI naming variants
			const files = {
				base: filesUi.base || null,
				normal: filesUi.normal || null,
				rough: filesUi.rough || filesUi.roughness || null,
				metal: filesUi.metal || filesUi.metalness || null,
				ao: filesUi.ao || null,
				emissive: filesUi.emissive || null,
				alpha: filesUi.alpha || null,
			};
			// Allow linking by filename typed into the new name inputs
			const names = {
				base: document.getElementById('teBaseName')?.value?.trim() || '',
				normal: document.getElementById('teNormalName')?.value?.trim() || '',
				rough: document.getElementById('teRoughnessName')?.value?.trim() || '',
				metal: document.getElementById('teMetalnessName')?.value?.trim() || '',
				ao: document.getElementById('teAOName')?.value?.trim() || '',
				emissive: document.getElementById('teEmissiveName')?.value?.trim() || '',
				alpha: document.getElementById('teAlphaName')?.value?.trim() || '',
			};
			async function ensureFile(f, name){
				if (f) return f;
				if (name && __textureLibHandle) {
					const file = await loadTexFromTextureLibrary(name);
					return file || null;
				}
				return null;
			}
			try {
				// Try to resolve using file picker first; if missing and we have a library handle, attempt to match by name
				const baseF = await ensureFile(files.base, names.base);
				const normalF = await ensureFile(files.normal, names.normal);
				const roughF = await ensureFile(files.rough, names.rough);
				const metalF = await ensureFile(files.metal, names.metal);
				const aoF = await ensureFile(files.ao, names.ao);
				const emissiveF = await ensureFile(files.emissive, names.emissive);
				const alphaF = await ensureFile(files.alpha, names.alpha);
				const [map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, alphaMap] = await Promise.all([
					loadTexFromFile(baseF, { sRGB:true, detail }),
					loadTexFromFile(normalF, { sRGB:false, detail }),
					loadTexFromFile(roughF, { sRGB:false, detail }),
					loadTexFromFile(metalF, { sRGB:false, detail }),
					loadTexFromFile(aoF, { sRGB:false, detail }),
					loadTexFromFile(emissiveF, { sRGB:true, detail }),
					loadTexFromFile(alphaF, { sRGB:false, detail }),
				]);
				const roughScalar = Number.isFinite(detail?.scalars?.roughness) ? detail.scalars.roughness : undefined;
				const metalScalar = Number.isFinite(detail?.scalars?.metalness) ? detail.scalars.metalness : undefined;
				const emissiveIntensity = Number.isFinite(detail?.scalars?.emissiveIntensity) ? detail.scalars.emissiveIntensity : undefined;
				// UI sends normalScale as a single number; allow vector too
				let nScaleX, nScaleY;
				if (detail && typeof detail.normalScale === 'number') { nScaleX = nScaleY = detail.normalScale; }
				else if (detail && detail.normalScale && Number.isFinite(detail.normalScale.x) && Number.isFinite(detail.normalScale.y)) {
					nScaleX = detail.normalScale.x; nScaleY = detail.normalScale.y;
				}
				// Mark roots as override so global style won't stomp
				targetObjs.forEach(o => { try { o.userData.__materialOverride = true; } catch {} });
				targetObjs.forEach(obj => {
					obj.traverse(child => {
						if (!child.isMesh) return;
						const mats = Array.isArray(child.material) ? child.material : [child.material];
						for (let i=0;i<mats.length;i++){
							let mat = mats[i];
							if (!mat || !mat.isMaterial) mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
							if (map) mat.map = map;
							if (normalMap) { mat.normalMap = normalMap; if (Number.isFinite(nScaleX) && Number.isFinite(nScaleY)) mat.normalScale = new THREE.Vector2(nScaleX, nScaleY); }
							if (roughnessMap) mat.roughnessMap = roughnessMap;
							if (metalnessMap) mat.metalnessMap = metalnessMap;
							if (aoMap) mat.aoMap = aoMap;
							if (emissiveMap) { mat.emissiveMap = emissiveMap; try { mat.emissive = new THREE.Color(0xffffff); } catch {} if (Number.isFinite(emissiveIntensity)) mat.emissiveIntensity = emissiveIntensity; }
							if (alphaMap) { mat.alphaMap = alphaMap; mat.transparent = true; }
							if (Number.isFinite(roughScalar)) mat.roughness = roughScalar;
							if (Number.isFinite(metalScalar)) mat.metalness = metalScalar;
							mat.needsUpdate = true;
							mats[i] = mat;
						}
						child.material = Array.isArray(child.material) ? mats : mats[0];
					});
				});
				saveSessionDraftNow();
			} catch (e) {
				console.warn('Texture apply failed', e);
				alert('Texture apply failed.');
			}
		});
		document.addEventListener('sketcher:texture-editor:clear', () => {
			if (!selectedObjects || selectedObjects.length === 0) return;
			selectedObjects.forEach(obj => {
				// Remove override and reapply current global style just for this subtree
				try { delete obj.userData.__materialOverride; } catch {}
				applyStyleToSubtree(obj, currentMaterialStyle);
			});
			saveSessionDraftNow();
		});
		document.addEventListener('sketcher:texture-editor:pick-face', () => {
			alert('Face picking will be available soon. For now, apply textures to the whole object.');
		});
	})();

	// Edge fade overlay for infinite grid
	function ensurePageVignette(on){ /* no-op: grid edge fade handled in shader now */ }
	// Apply saved or default colors on startup
	try {
		const savedBg = localStorage.getItem('sketcher.bgColor');
		const bg = savedBg || (bgColorPicker ? bgColorPicker.value : '#1e1e1e');
		renderer.setClearColor(bg);
		if (bgColorPicker && savedBg) bgColorPicker.value = savedBg;
		const savedGrid = localStorage.getItem('sketcher.gridColor');
		if (gridColorPicker && savedGrid) gridColorPicker.value = savedGrid;
		if (savedGrid) setGridColor(savedGrid); else if (gridColorPicker) setGridColor(gridColorPicker.value || '#ffffff');
		// Grid size/divs/infinite persistence
		const savedSize = parseInt(localStorage.getItem('sketcher.gridSize')||'');
		const savedDivs = parseInt(localStorage.getItem('sketcher.gridDivs')||'');
		const savedInf = localStorage.getItem('sketcher.gridInfinite');
		if (Number.isFinite(savedSize) && savedSize>0) { GRID_SIZE = savedSize; if (gridSizeInput) gridSizeInput.value = String(savedSize); }
		if (Number.isFinite(savedDivs) && savedDivs>0) { GRID_DIVS = savedDivs; if (gridDivsInput) gridDivsInput.value = String(savedDivs); }
		if (typeof savedInf === 'string' && gridInfiniteBtn) gridInfiniteBtn.setAttribute('aria-pressed', savedInf === '1' ? 'true' : 'false');
		// Apply any size/div changes by rebuilding now
		rebuildGrid();
		/* overlay vignette no longer used; shader fade is always active */
	} catch {}
	// Live update handlers
	if (bgColorPicker){
		bgColorPicker.addEventListener('input',()=>{ renderer.setClearColor(bgColorPicker.value); try { localStorage.setItem('sketcher.bgColor', bgColorPicker.value); } catch {} });
		bgColorPicker.addEventListener('change',()=>{ renderer.setClearColor(bgColorPicker.value); try { localStorage.setItem('sketcher.bgColor', bgColorPicker.value); } catch {} });
	}
	if (gridColorPicker){
		gridColorPicker.addEventListener('input',()=>{ setGridColor(gridColorPicker.value); try { localStorage.setItem('sketcher.gridColor', gridColorPicker.value); } catch {} });
		gridColorPicker.addEventListener('change',()=>{ setGridColor(gridColorPicker.value); try { localStorage.setItem('sketcher.gridColor', gridColorPicker.value); } catch {} });
	}
	if (gridSizeInput){
		const onSize = ()=>{
			let v = parseInt(gridSizeInput.value||'20');
			if (!Number.isFinite(v) || v<=0) v = 20;
			GRID_SIZE = v;
			rebuildGrid();
			try { localStorage.setItem('sketcher.gridSize', String(v)); } catch {}
		};
		gridSizeInput.addEventListener('change', onSize);
		gridSizeInput.addEventListener('blur', onSize);
	}
	if (gridDivsInput){
		const onDivs = ()=>{
			let v = parseInt(gridDivsInput.value||'20');
			if (!Number.isFinite(v) || v<=0) v = 20;
			GRID_DIVS = v;
			rebuildGrid();
			try { localStorage.setItem('sketcher.gridDivs', String(v)); } catch {}
		};
		gridDivsInput.addEventListener('change', onDivs);
		gridDivsInput.addEventListener('blur', onDivs);
	}
	let prevGridSize = GRID_SIZE, prevGridDivs = GRID_DIVS;
	if (gridInfiniteBtn){
		gridInfiniteBtn.addEventListener('click', ()=>{
			const on = gridInfiniteBtn.getAttribute('aria-pressed') !== 'true';
			gridInfiniteBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
			// Disable manual size/divs while infinite is active
			if (gridSizeInput) gridSizeInput.disabled = on;
			if (gridDivsInput) gridDivsInput.disabled = on;
			if (on){
				// Save current then switch to a larger grid for better coverage
				prevGridSize = GRID_SIZE; prevGridDivs = GRID_DIVS;
				GRID_SIZE = Math.max(100, prevGridSize);
				GRID_DIVS = Math.min(200, Math.max(100, prevGridDivs));
				rebuildGrid();
			} else {
				// Restore previous values
				GRID_SIZE = prevGridSize; GRID_DIVS = prevGridDivs;
				rebuildGrid();
			}
			try { localStorage.setItem('sketcher.gridInfinite', on ? '1' : '0'); } catch {}
		});
		// Reflect disabled state on load
		const initOn = gridInfiniteBtn.getAttribute('aria-pressed') === 'true';
		if (gridSizeInput) gridSizeInput.disabled = initOn;
		if (gridDivsInput) gridDivsInput.disabled = initOn;
	}

	// Mode change + toolbox
	modeSelect.addEventListener('change',()=>{
		mode=modeSelect.value; transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines();
		editUI.style.display=(mode==='edit')?'block':'none';
		const showToolbox = (mode==='edit'||mode==='import');
		toolbox.style.display = showToolbox ? 'inline-block' : 'none';
		if (showToolbox) {
			const showEdit = (mode==='edit');
			const showImport = (mode==='edit' || mode==='import');
			togglePrimsBtn.style.display = showEdit ? 'flex' : 'none';
			toggleDrawCreateBtn.style.display = showEdit ? 'flex' : 'none';
			if (toggleUtilsBtn) toggleUtilsBtn.style.display = showEdit ? 'flex' : 'none';
			if (toggleImportBtn) toggleImportBtn.style.display = showImport ? 'flex' : 'none';
			// Keep Scale Figure parent button visible in Edit mode
			const scaleParentBtn = document.getElementById('addScaleFigure');
			if (scaleParentBtn) scaleParentBtn.style.display = showEdit ? 'flex' : 'none';
			primsGroup.style.display = showEdit ? 'block' : 'none';
			drawCreateGroup.style.display = showEdit ? 'block' : 'none';
			if (utilsGroup) utilsGroup.style.display = showEdit ? 'block' : 'none';
			if (importGroup) importGroup.style.display = showImport ? 'block' : 'none';
			if (showEdit){ primsGroup.classList.remove('open'); primsGroup.setAttribute('aria-hidden','true'); togglePrimsBtn.setAttribute('aria-pressed','false'); drawCreateGroup.classList.remove('open'); drawCreateGroup.setAttribute('aria-hidden','true'); toggleDrawCreateBtn.setAttribute('aria-pressed','false'); if (utilsGroup && toggleUtilsBtn){ utilsGroup.classList.remove('open'); utilsGroup.setAttribute('aria-hidden','true'); toggleUtilsBtn.setAttribute('aria-pressed','false'); }
				// Also ensure nested drawers (like My Scenes) are closed when Utilities resets
				if (typeof scenesDrawer !== 'undefined' && scenesDrawer) { scenesDrawer.classList.remove('open'); scenesDrawer.setAttribute('aria-hidden','true'); }
			}
			if (showImport){ if (importGroup && toggleImportBtn){ importGroup.classList.remove('open'); importGroup.setAttribute('aria-hidden','true'); toggleImportBtn.setAttribute('aria-pressed','false'); } }
			// Pin toolbox centered vertically on the left; keep collapsible animations intact
			toolbox.style.position = 'fixed';
			toolbox.style.left = '24px';
			toolbox.style.top = '50%';
			toolbox.style.transform = 'translateY(-50%)';
		}
		// Toolbox: collapsible groups, settings panel floats right
		function closeAllPanels() {
			[primsGroup, drawCreateGroup, importGroup, sceneManagerGroup, utilsGroup, viewsGroup].forEach(panel => {
				if(panel) {
					panel.classList.remove('open');
					panel.setAttribute('aria-hidden','true');
				}
			});
			[togglePrimsBtn, toggleDrawCreateBtn, toggleImportBtn, toggleSceneManagerBtn, toggleUtilsBtn, toggleViewsBtn].forEach(btn => {
				if(btn) btn.setAttribute('aria-pressed','false');
			});
			// Hide settings panel
			if (settingsGroup) {
				settingsGroup.classList.remove('open');
				settingsGroup.setAttribute('aria-hidden','true');
			}
			if (toggleSettingsBtn) toggleSettingsBtn.setAttribute('aria-pressed','false');
			// Ensure nested drawers under Scene Manager are also closed
			if (typeof scenesDrawer !== 'undefined' && scenesDrawer) {
				scenesDrawer.classList.remove('open');
				scenesDrawer.setAttribute('aria-hidden','true');
			}
		}
		function togglePanel(btn, group) {
			btn.addEventListener('click', () => {
				const isOpen = group.classList.contains('open');
				closeAllPanels();
				if (!isOpen) {
					btn.setAttribute('aria-pressed','true');
					group.classList.add('open');
					group.setAttribute('aria-hidden','false');
				}
			});
		}
	if (togglePrimsBtn && primsGroup) togglePanel(togglePrimsBtn, primsGroup);
	if (toggleDrawCreateBtn && drawCreateGroup) togglePanel(toggleDrawCreateBtn, drawCreateGroup);
	if (toggleImportBtn && importGroup) togglePanel(toggleImportBtn, importGroup);
	if (toggleSceneManagerBtn && sceneManagerGroup) togglePanel(toggleSceneManagerBtn, sceneManagerGroup);
	if (toggleUtilsBtn && utilsGroup) togglePanel(toggleUtilsBtn, utilsGroup);
	if (toggleViewsBtn && viewsGroup) togglePanel(toggleViewsBtn, viewsGroup);
	if (toggleSettingsBtn && settingsGroup) togglePanel(toggleSettingsBtn, settingsGroup);
	// Camera view logic for standard views
	function setCameraView(type) {
		// If Plan View Lock is active, force 'plan' regardless of requested type
		if (planViewLocked) type = 'plan';
		if (type === 'perspective') {
			cameraType = 'perspective';
			const box = new THREE.Box3();
			objects.forEach(o => box.expandByObject(o));
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());
			let dist = Math.max(size.x, size.y, size.z) * 1.5 || 10;
			let pos = new THREE.Vector3(center.x + dist, center.y + dist, center.z + dist);
			let up = new THREE.Vector3(0,1,0);
			let look = center;
			let perspCamera = camera.clone();
			perspCamera.position.copy(pos);
			perspCamera.up.copy(up);
			perspCamera.lookAt(look);
			perspCamera.updateProjectionMatrix();
			controls.target.copy(center);
			controls.update();
			tweenCamera(camera, perspCamera, 600, () => { camera = perspCamera; controls.object = camera; controls.update(); });
			return;
		}

		// Use orthographic for Plan/N/E/S/W/Axon; orbiting will switch back to perspective
		let useOrtho = ['plan','north','south','east','west','axon'].includes(type);
		if (useOrtho) {
			cameraType = 'orthographic';
			const aspect = window.innerWidth / window.innerHeight;
			const box = new THREE.Box3();
			objects.forEach(o => box.expandByObject(o));
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());
			const orthoSize = Math.max(size.x, size.y, size.z) * 0.7 || 10;
			orthoCamera = new THREE.OrthographicCamera(
				-orthoSize * aspect, orthoSize * aspect,
				orthoSize, -orthoSize,
				-5000, 5000
			);
			let pos, up, look, dist;
			switch(type) {
				case 'plan':
					dist = Math.max(size.x, size.y, size.z) * 1.2 || 10;
					pos = new THREE.Vector3(center.x, center.y + dist, center.z);
					// North-up plan: use world +Z as screen up
					up = new THREE.Vector3(0,0,1);
					look = center;
					break;
				case 'north':
					dist = size.z * 1.2 || 10;
					pos = new THREE.Vector3(center.x, center.y, box.min.z - dist);
					up = new THREE.Vector3(0,1,0);
					look = center;
					break;
				case 'south':
					dist = size.z * 1.2 || 10;
					pos = new THREE.Vector3(center.x, center.y, box.max.z + dist);
					up = new THREE.Vector3(0,1,0);
					look = center;
					break;
				case 'east':
					dist = size.x * 1.2 || 10;
					pos = new THREE.Vector3(box.max.x + dist, center.y, center.z);
					up = new THREE.Vector3(0,1,0);
					look = center;
					break;
				case 'west':
					dist = size.x * 1.2 || 10;
					pos = new THREE.Vector3(box.min.x - dist, center.y, center.z);
					up = new THREE.Vector3(0,1,0);
					look = center;
					break;
				case 'axon':
					dist = Math.max(size.x, size.y, size.z) * 1.5 || 10;
					pos = new THREE.Vector3(center.x + dist, center.y + dist, center.z + dist);
					up = new THREE.Vector3(0,1,0);
					look = center;
					break;
			}
			orthoCamera.position.copy(pos);
			orthoCamera.up.copy(up);
			orthoCamera.lookAt(look);
			orthoCamera.updateProjectionMatrix();
			controls.object = orthoCamera;
			controls.target.copy(center);
			controls.update();
			tweenCamera(camera, orthoCamera, 600, () => { camera = orthoCamera; });
		} else {
			cameraType = 'perspective';
			// Currently no other perspective-only quick views
		}
	// Always render with current camera
	const originalRender = renderer.render.bind(renderer);
	renderer.render = function(scene, cam) {
		originalRender(scene, camera);
	};
	// Listen for orbit and revert to perspective
	controls.addEventListener('start', () => {
		// When locked to plan view, do not auto-switch to perspective on orbit start
		if (planViewLocked) return;
		if (cameraType === 'orthographic') {
			cameraType = 'perspective';
			let perspCamera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 5000);
			perspCamera.position.copy(camera.position);
			// Always return to normal Y-up in perspective
			perspCamera.up.set(0,1,0);
			perspCamera.quaternion.copy(camera.quaternion);
			perspCamera.updateMatrixWorld();
			perspCamera.updateProjectionMatrix();
			controls.object = perspCamera;
			controls.target.copy(controls.target);
			controls.update();
			tweenCamera(camera, perspCamera, 600, () => { camera = perspCamera; controls.object = camera; controls.update(); });
		}
	});
	// Double-click to show grabbers for single selection
	renderer.domElement.addEventListener('dblclick', e => {
		if (mode !== 'edit') return;
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const hits = raycaster.intersectObjects(selectableTargets(), true);
			// If there is already a single selection, prioritize toggling it to handles
			if (selectedObjects.length === 1) {
				singleSelectionMode = 'handles';
				attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
				return;
			}
			// Otherwise, use the hit object (if any)
			if (hits.length){
				const obj = __resolvePickedObjectFromHits(hits);
				if (!obj) return;
				selectedObjects = [obj];
				singleSelectionMode = 'handles';
				attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
			}
	});
	// Capture-phase dblclick fallback in case controls intercept the bubble phase
	window.addEventListener('dblclick', e => {
		if (mode !== 'edit') return;
		if (!(e.target && (e.target === renderer.domElement || renderer.domElement.contains(e.target)))) return;
		if (selectedObjects.length === 1) {
			singleSelectionMode = 'handles';
			attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
			return;
		}
		getPointer(e); raycaster.setFromCamera(pointer, camera);
	const hits = raycaster.intersectObjects(selectableTargets(), true);
		if (hits.length){
			const obj = __resolvePickedObjectFromHits(hits);
			if (!obj) return;
			selectedObjects = [obj];
			singleSelectionMode = 'handles';
			attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
		}
	}, true);
	}
	// View button listeners will be wired by ui/views.js via public API

	// Plan View Lock behavior
	function applyPlanLockState() {
		if (planViewLocked) {
			// Force plan view and restrict controls to pan/zoom only
			setCameraView('plan');
			controls.enableRotate = false;
			// Also disable accidental perspective revert
		} else {
			controls.enableRotate = true;
		}
		// Reflect button UI state
		if (planLockBtn) planLockBtn.setAttribute('aria-pressed', planViewLocked ? 'true' : 'false');
		// Persist setting
		try { localStorage.setItem('sketcher.planViewLocked', planViewLocked ? '1' : '0'); } catch {}
		// Re-attach transforms to apply wall constraints if a wall is selected
		attachTransformForSelection();
	}
	// Initialize Plan Lock button state now; click wiring moves to ui/views.js
	if (planLockBtn) {
		try { planViewLocked = localStorage.getItem('sketcher.planViewLocked') === '1'; } catch {}
		applyPlanLockState();
	}

	// Public Views API for UI modules
	try {
		window.sketcherViewsAPI = {
			setCameraView,
			getCameraType: () => cameraType,
			isPlanViewLocked: () => !!planViewLocked,
			setPlanViewLocked: (on) => {
				const next = !!on;
				const wasLocked = !!planViewLocked;
				planViewLocked = next;
				applyPlanLockState();
				// If transitioning from locked -> unlocked, restore perspective smoothly
				if (wasLocked && !next) {
					try {
						cameraType = 'perspective';
						let persp = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 5000);
						persp.position.copy(camera.position);
						persp.up.set(0,1,0);
						persp.quaternion.copy(camera.quaternion);
						persp.updateMatrixWorld(); persp.updateProjectionMatrix();
						controls.object = persp; controls.update();
						tweenCamera(camera, persp, 450, () => { camera = persp; controls.object = camera; controls.update(); });
					} catch {}
				}
			}
		};
		document.dispatchEvent(new CustomEvent('sketcher:views-ready'));
	} catch {}

	// AR visibility
			if(mode==='ar') { arButton.style.display = 'block'; } else { arButton.style.display = 'none'; if(renderer.xr.isPresenting) renderer.xr.getSession().end(); }
		if (typeof applyAutoTouchMapping === 'function') applyAutoTouchMapping();
	});
	modeSelect.dispatchEvent(new Event('change'));

		// Auto-start AR when arriving from 2D with ?autoAR=1
		try {
			const usp = new URLSearchParams(location.search);
			if (usp.get('autoAR') === '1') {
				// switch mode to AR then click AR button once UI settles
				setTimeout(()=>{
					try {
						const ms = document.getElementById('modeSelect');
						if (ms) { ms.value = 'ar'; ms.dispatchEvent(new Event('change')); }
						const btn = document.getElementById('arButton');
						if (btn) btn.click();
					} catch {}
				}, 200);
			}
		} catch {}

	// Export logic for toolbox popup
	function buildExportRootFromObjects(objs){ return persistence.buildExportRootFromObjects(THREE, objs); }
	function prepareModelForAR(root){ try { arExport.prepareModelForAR(THREE, root); } catch {} }
	async function openQuickLookUSDZ(){ const source=(selectedObjects && selectedObjects.length)?selectedObjects:objects; if(!source||!source.length){ alert('Nothing to show in AR. Create or import an object first.'); return; } const root=buildExportRootFromObjects(source); prepareModelForAR(root); try { const { USDZExporter } = await import('https://unpkg.com/three@0.155.0/examples/jsm/exporters/USDZExporter.js'); const exporter=new USDZExporter(); const arraybuffer=await exporter.parse(root); const blob=new Blob([arraybuffer],{type:'model/vnd.usdz+zip'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.setAttribute('rel','ar'); a.setAttribute('href',url); document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },30000); } catch(e){ alert('Unable to generate USDZ for AR: ' + (e?.message || e)); console.error(e); } }

	arButton.addEventListener('click', async () => {
		await loadWebXRPolyfillIfNeeded();
		const isSecure = window.isSecureContext || location.protocol === 'https:';
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
		if (!isSecure) { alert('AR requires HTTPS. Please host this page over https://'); return; }
		try {
			const xr = navigator.xr; const xrSupported = xr && await xr.isSessionSupported('immersive-ar');
			if (xrSupported) {
				const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local-floor'], optionalFeatures: ['hand-tracking'] });
				renderer.xr.setSession(session);
				// start AR edit service
				try { arEdit.setTarget(null); arEdit.start(session); } catch {}
				arActive = true;
				arPlaced = false;
				grid.visible = false;
				// Hide existing editor objects to avoid duplicates while AR export copy is shown
				try {
					arPrevVisibility = new Map();
					for (const o of getPersistableObjects()) { arPrevVisibility.set(o, !!o.visible); o.visible = false; }
					updateVisibilityUI();
				} catch {}
				// Setup hit test source and reference spaces for initial placement
				xrViewerSpace = await session.requestReferenceSpace('viewer');
				xrLocalSpace = await session.requestReferenceSpace('local-floor');
				xrHitTestSource = await session.requestHitTestSource({ space: xrViewerSpace });
				session.addEventListener('end', () => {
					arActive = false;
					try { arEdit.stop(); } catch {}
					grid.visible = true;
					if (arContent) { scene.remove(arContent); arContent = null; }
					arPlaced = false;
					if (xrHitTestSource && xrHitTestSource.cancel) { try { xrHitTestSource.cancel(); } catch {} }
					xrHitTestSource = null; xrViewerSpace = null; xrLocalSpace = null;
					// Restore editor object visibility
					try {
						if (arPrevVisibility) {
							for (const [o, v] of arPrevVisibility.entries()) { o.visible = !!v; }
							arPrevVisibility = null;
							updateVisibilityUI();
						}
					} catch {}
					// Return UI to Edit mode
					modeSelect.value = 'edit';
					modeSelect.dispatchEvent(new Event('change'));
				});
			} else if (isIOS) { await openQuickLookUSDZ(); } else { alert('AR not supported on this device or browser.'); }
		} catch (e) { alert('Failed to start AR: ' + (e?.message || e)); console.error(e); }
	});

	// Room Scan (beta) using service API
	document.addEventListener('sketcher:startRoomScan', async () => {
		await loadWebXRPolyfillIfNeeded();
		roomScan.startRoomScan();
	});

	// Upload model
	uploadBtn.addEventListener('click',()=>fileInput.click());
	fileInput.addEventListener('change',e=>{
		const file=e.target.files[0]; if(!file)return;
		const lower=file.name.toLowerCase();
		if (lower.endsWith('.rvt')){
			alert('Revit (.rvt) files are not directly supported in-browser.\n\nPlease export your model from Revit as OBJ/FBX/GLTF (or via the Revit add-in or FormIt/3ds Max) and import that here.');
			fileInput.value='';
			return;
		}
		const url=URL.createObjectURL(file);
		const loader=lower.endsWith('.obj')?new OBJLoader():new GLTFLoader();
		loader.load(url,gltf=>{
			loadedModel=gltf.scene||gltf;
			// Show placing popup with file name
			if (placingName) placingName.textContent = file.name;
			if (placingPopup) placingPopup.style.display = 'block';
			URL.revokeObjectURL(url);
		});
	});

	// Cancel current placement
	if (placingCancel) placingCancel.addEventListener('click', ()=>{
		loadedModel = null;
		if (fileInput) fileInput.value = '';
		if (placingPopup) placingPopup.style.display = 'none';
	});
	// Also allow Escape to cancel placement
	window.addEventListener('keydown', (e)=>{
		if (e.key === 'Escape') {
			// Cancel placement if active
			if (loadedModel) {
				loadedModel = null;
				if (fileInput) fileInput.value = '';
				if (placingPopup) placingPopup.style.display = 'none';
				return;
			}
			// Deselect current selection if not draw-creating
			if (mode === 'edit' && !activeDrawTool) {
				selectedObjects = [];
				transformControls.detach();
				transformControlsRotate.detach();
				clearHandles();
				clearSelectionOutlines();
				updateVisibilityUI();
			}
		}
	});

	// Mark hardware keyboard presence if any non-modifier key is pressed (late hook)
	window.addEventListener('keydown', (e)=>{
		try {
			const ign = ['Shift','Control','Alt','Meta','CapsLock','NumLock','ScrollLock'];
			if (!ign.includes(e.key)) hasHardwareKeyboard3D = true;
		} catch {}
	});

	// OBJ export (now in utilities popup)
	// Export Scene button wiring (only in Utilities group)
	const exportBtn = document.getElementById('exportScene');
	if (exportBtn) exportBtn.addEventListener('click',()=>{
		const exporter=new OBJExporter();
		const root=new THREE.Group();
		objects.forEach(o=>root.add(o.clone(true)));
		const data=exporter.parse(root);
		const blob=new Blob([data],{type:'text/plain'});
		const a=document.createElement('a');
		a.href=URL.createObjectURL(blob);
		a.download='scene.obj';
		a.click();
		setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
	});

	// Revit Family (guide) export: produce OBJ then show quick how-to
	const exportRfaBtn = document.getElementById('exportRevitFamily');
	if (exportRfaBtn) exportRfaBtn.addEventListener('click',()=>{
		const exporter=new OBJExporter();
		const root=new THREE.Group();
		objects.forEach(o=>root.add(o.clone(true)));
		const data=exporter.parse(root);
		const blob=new Blob([data],{type:'text/plain'});
		const a=document.createElement('a');
		a.href=URL.createObjectURL(blob);
		a.download='sketcher-family.obj';
		a.click();
		setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
		setTimeout(()=>{
			alert('To create a Revit Family (RFA):\n\n1) In Revit, create a new Generic Model family.\n2) Load the OBJ using an intermediary (e.g., import OBJ to FormIt or 3ds Max, then export as SAT/DWG/FBX).\n3) In Revit, Import/Link the converted file into the family.\n4) Adjust origin/scale as needed, then Save as .rfa.');
		}, 50);
	});

	// Helpers
	function getPointer(e){
		const el = renderer.domElement;
		const w = el.clientWidth || el.width; // CSS pixels
		const h = el.clientHeight || el.height;
		let px, py;
		if (e && e.target === el && typeof e.offsetX === 'number' && typeof e.offsetY === 'number'){
			// Prefer offsetX/Y when the event targets the canvas; more robust across VisualViewport quirks
			px = e.offsetX; py = e.offsetY;
		} else {
			const rect = el.getBoundingClientRect();
			px = (e.clientX - rect.left); py = (e.clientY - rect.top);
		}
		pointer.x = (px / w) * 2 - 1;
		pointer.y = -(py / h) * 2 + 1;
	}
	function intersectGround(){const pt=new THREE.Vector3();raycaster.ray.intersectPlane(groundPlane,pt);return pt;}
	function intersectAtY(y){const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-y);const pt=new THREE.Vector3();return raycaster.ray.intersectPlane(plane,pt)?pt:null;}

	function updateCameraClipping(){ if (!objects.length) return; const box = new THREE.Box3(); objects.forEach(o => box.expandByObject(o)); if (box.isEmpty()) return; const size = new THREE.Vector3(); box.getSize(size); const radius = Math.max(size.x, size.y, size.z) * 0.75; const far = Math.min(100000, Math.max(1000, radius * 12)); camera.near = Math.max(0.01, far / 50000); camera.far = far; camera.updateProjectionMatrix(); if (controls){ controls.maxDistance = far * 0.95; } }
	function selectableTargets(){
		const list = objects.flatMap(o => o.type === 'Group' ? [o, ...o.children] : [o]);
		try {
			const overlay = scene.getObjectByName('2D Overlay');
			if (overlay) list.push(overlay, ...overlay.children);
		} catch{}
		return list;
	}
	function addObjectToScene(obj, { select = false } = {}){
		scene.add(obj); objects.push(obj);
		// Skip applying global material styles to map imports
		const __isMapImportObj = !!(obj && ((obj.userData && (obj.userData.__mapImport === true || obj.userData.mapImport === true)) || (obj.name === 'Imported Topography' || obj.name === 'Imported Flat Area')));
		if (!__isMapImportObj){
		// Apply current material style to this object (shared instance)
		if (currentMaterialStyle === 'original'){
			const stack = [obj];
			while (stack.length){
				const o = stack.pop();
				if (o.isMesh){ ensureOriginalMaterial(o); o.material = material; }
				if (o.children && o.children.length) stack.push(...o.children);
			}
		} else if (currentMaterialStyle === 'cardboard' || currentMaterialStyle === 'mdf'){
			const shared = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle);
			const stack = [obj];
			while (stack.length){
				const o = stack.pop();
				if (o.isMesh){ ensureOriginalMaterial(o); o.material = shared; }
				if (o.children && o.children.length) stack.push(...o.children);
			}
		} else if (currentMaterialStyle === 'sketch'){
			const shared = getActiveSharedMaterial('sketch') || getProceduralSharedMaterial('sketch');
			const stack = [obj];
			while (stack.length){
				const o = stack.pop();
				if (o.isMesh){
					ensureOriginalMaterial(o);
					o.material = shared;
					// Attach a single outline child that follows this mesh
					const lines = makeSketchLinesForMesh(o);
					if (lines) { try { o.add(lines); __sketchOutlineNodes.add(lines); } catch {} }
				}
				if (o.children && o.children.length) stack.push(...o.children);
			}
		}
		}
		updateVisibilityUI(); updateCameraClipping();
		if (select){ selectedObjects = [obj]; attachTransformForSelection(); rebuildSelectionOutlines(); }
		saveSessionDraftNow();
	}

	// Trackpad support: allow pan/rotate/zoom for laptop users
	function isTrackpadEvent(e) {
		// Heuristic: if pointerType is 'touch' but device is not mobile, likely a trackpad
		return e.pointerType === 'touch' && !isTouchDevice && navigator.userAgent.match(/Mac|Windows/);
	}
	function applyAutoTouchMapping(){
		// On laptops, allow two-finger drag to pan, pinch to zoom, single-finger drag to rotate
		controls.touches = (mode === 'edit') ? { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.NONE, TWO: THREE.TOUCH.DOLLY_PAN };
	}
	applyAutoTouchMapping();
	// For non-touch devices, enable mouse drag for rotate, two-finger drag for pan, pinch for zoom
	controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

	// Draw-create tools
	let activeDrawTool=null; let isDragging=false; let startPt=new THREE.Vector3(); let previewMesh=null; let previewOutline=null; let dragStartScreenY=0;
	const dcBoxBtn=document.getElementById('dcBox'); const dcSphereBtn=document.getElementById('dcSphere'); const dcCylinderBtn=document.getElementById('dcCylinder'); const dcConeBtn=document.getElementById('dcCone');
	function armDrawTool(kind){ activeDrawTool=kind; if(toggleDrawCreateBtn && drawCreateGroup){ if(toggleDrawCreateBtn.getAttribute('aria-pressed')!=='true'){ toggleDrawCreateBtn.click(); } } [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed', String(btn && btn.id==='dc'+kind.charAt(0).toUpperCase()+kind.slice(1))); }); }
	if(dcBoxBtn) dcBoxBtn.addEventListener('click',()=>armDrawTool('box'));
	if(dcSphereBtn) dcSphereBtn.addEventListener('click',()=>armDrawTool('sphere'));
	if(dcCylinderBtn) dcCylinderBtn.addEventListener('click',()=>armDrawTool('cylinder'));
	if(dcConeBtn) dcConeBtn.addEventListener('click',()=>armDrawTool('cone'));
	// Prevent browser gestures while interacting with the canvas only
	renderer.domElement.addEventListener('touchmove', e => { try { e.preventDefault(); } catch {} }, { passive: false });
	const activeTouchPointers = new Set();
	renderer.domElement.addEventListener('pointerup', e => { if(e.pointerType==='touch' || e.pointerType==='pen') activeTouchPointers.delete(e.pointerId); });
	renderer.domElement.addEventListener('pointercancel', e => { if(e.pointerType==='touch' || e.pointerType==='pen') activeTouchPointers.delete(e.pointerId); });
	const SURFACE_EPS = 0.01;
	// Two-click placement tools state (floor/wall)
	const FLOOR_THICKNESS_FT = 0.5; // 6 inches
	const WALL_THICKNESS_FT = 0.333;
	const WALL_HEIGHT_FT = 10.0;
	let placingTool = null; // 'floor' | 'wall' | null
	let placingStage = 0;   // 0 = waiting for first click, 1 = waiting for second click
	let placingStart = new THREE.Vector3();
	let placingPreview = null; // THREE.Mesh
    let placingOutline = null; // THREE.Line (plan-view outline during drag)
	function cancelPlacing(){
		if (placingPreview){ try { scene.remove(placingPreview); placingPreview.geometry && placingPreview.geometry.dispose && placingPreview.geometry.dispose(); placingPreview.material && placingPreview.material.dispose && placingPreview.material.dispose(); } catch {}
			placingPreview = null;
		}
		if (placingOutline){ try { scene.remove(placingOutline); placingOutline.geometry && placingOutline.geometry.dispose && placingOutline.geometry.dispose(); placingOutline.material && placingOutline.material.dispose && placingOutline.material.dispose(); } catch {}
			placingOutline = null;
		}
		placingTool = null; placingStage = 0; placingStart.set(0,0,0);
		controls.enabled = true;
		const wallBtn = document.getElementById('addWall'); if (wallBtn) wallBtn.setAttribute('aria-pressed','false');
		const floorBtn = document.getElementById('addFloor'); if (floorBtn) floorBtn.setAttribute('aria-pressed','false');
	}
	function startPlacing(kind){
		if (placingTool === kind){ cancelPlacing(); return; }
		cancelPlacing();
		placingTool = kind; placingStage = 0; controls.enabled = false;
		const btn = document.getElementById(kind==='wall' ? 'addWall' : 'addFloor'); if (btn) btn.setAttribute('aria-pressed','true');
	}
	function updatePlacingPreview(current, modifiers={}){
		const shift = !!modifiers.shift;
		if (!placingTool || placingStage !== 1) return;
		// Build/replace preview mesh based on placingTool and start/end on ground plane
		if (placingPreview){ try { scene.remove(placingPreview); placingPreview.geometry && placingPreview.geometry.dispose && placingPreview.geometry.dispose(); placingPreview.material && placingPreview.material.dispose && placingPreview.material.dispose(); } catch {} placingPreview = null; }
		if (placingOutline){ try { scene.remove(placingOutline); placingOutline.geometry && placingOutline.geometry.dispose && placingOutline.geometry.dispose(); placingOutline.material && placingOutline.material.dispose && placingOutline.material.dispose(); } catch {} placingOutline = null; }
		if (placingTool === 'floor'){
			const minX = Math.min(placingStart.x, current.x); const maxX = Math.max(placingStart.x, current.x);
			const minZ = Math.min(placingStart.z, current.z); const maxZ = Math.max(placingStart.z, current.z);
			const w = Math.max(0.1, maxX - minX); const d = Math.max(0.1, maxZ - minZ);
			const cx = (minX + maxX) / 2; const cz = (minZ + maxZ) / 2;
			const geo = new THREE.BoxGeometry(w, FLOOR_THICKNESS_FT, d);
			const activeMat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material;
			const mesh = new THREE.Mesh(geo, activeMat);
			// Place so top face sits at ground plane (Y=0)
			mesh.position.set(cx, -FLOOR_THICKNESS_FT/2, cz);
			placingPreview = mesh; scene.add(mesh);
			// Add a thin outline in plan view during drag to improve visibility when Plan Lock is on
			if (planViewLocked){
				try {
					const pos = new Float32Array([
						-w/2, SURFACE_EPS, -d/2,
						 w/2, SURFACE_EPS, -d/2,
						 w/2, SURFACE_EPS,  d/2,
						-w/2, SURFACE_EPS,  d/2,
						-w/2, SURFACE_EPS, -d/2,
					]);
					const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
					const m = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.95 });
					const line = new THREE.Line(g, m);
					line.position.set(cx, SURFACE_EPS, cz); line.renderOrder = 9999;
					placingOutline = line; scene.add(line);
				} catch {}
			}
		} else if (placingTool === 'wall'){
			const dx0 = current.x - placingStart.x; const dz0 = current.z - placingStart.z;
			let angle = Math.atan2(dz0, dx0);
			if (shift){ angle = Math.round(angle / (Math.PI/2)) * (Math.PI/2); }
			const ux = Math.cos(angle), uz = Math.sin(angle);
			const s = (dx0 * ux + dz0 * uz); // signed distance along snapped axis
			const len = Math.max(0.1, Math.abs(s));
			const geo = new THREE.BoxGeometry(len, WALL_HEIGHT_FT, WALL_THICKNESS_FT);
			const activeMat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material;
			const mesh = new THREE.Mesh(geo, activeMat);
			// Position the wall mesh at its midpoint so the gizmo/pivot is centered
			const endX = placingStart.x + (shift ? s * ux : dx0);
			const endZ = placingStart.z + (shift ? s * uz : dz0);
			const midx = (placingStart.x + endX) / 2; const midz = (placingStart.z + endZ) / 2;
			mesh.position.set(midx, WALL_HEIGHT_FT/2, midz);
			mesh.rotation.y = -angle;
			placingPreview = mesh; scene.add(mesh);
			// Add a rectangle footprint outline during drag when Plan Lock is on
			if (planViewLocked){
				try {
					const t = WALL_THICKNESS_FT;
					const pos = new Float32Array([
						 -len/2, SURFACE_EPS, -t/2,
						  len/2, SURFACE_EPS, -t/2,
						  len/2, SURFACE_EPS,  t/2,
						 -len/2, SURFACE_EPS,  t/2,
						 -len/2, SURFACE_EPS, -t/2,
					]);
					const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
					const m = new THREE.LineBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.95 });
					const line = new THREE.Line(g, m);
					line.position.set(midx, SURFACE_EPS, midz);
					line.rotation.y = mesh.rotation.y; line.renderOrder = 9999;
					placingOutline = line; scene.add(line);
				} catch {}
			}
		}
	}
	function finalizePlacing(endPt){
		if (!placingTool) return;
		// Avoid creating degenerate walls/floors if the drag distance is too small
		if (placingTool === 'wall'){
			const d = Math.hypot(endPt.x - placingStart.x, endPt.z - placingStart.z);
			if (d < 0.01) { cancelPlacing(); return; }
		}
		// Create final mesh and add to scene (clone from preview for correctness)
		if (placingPreview){
			const placed = placingPreview; placingPreview = null;
			placed.name = (placingTool === 'floor') ? `Floor ${objects.filter(o=>o.name&&o.name.startsWith('Floor')).length+1}` : `Wall ${objects.filter(o=>o.name&&o.name.startsWith('Wall')).length+1}`;
			addObjectToScene(placed, { select: true });
		} else {
			// Fallback: build once if preview was missing
			updatePlacingPreview(endPt, { shift: false });
			if (placingPreview){ const placed = placingPreview; placingPreview = null; placed.name = (placingTool==='floor')? 'Floor' : 'Wall'; addObjectToScene(placed, { select: true }); }
		}
		// Cleanup outline if present
		if (placingOutline){ try { scene.remove(placingOutline); placingOutline.geometry && placingOutline.geometry.dispose && placingOutline.geometry.dispose(); placingOutline.material && placingOutline.material.dispose && placingOutline.material.dispose(); } catch {} placingOutline = null; }
		cancelPlacing(); saveSessionDraftNow();
	}
			renderer.domElement.addEventListener('pointerdown',e=>{
		if (transformControls.dragging || transformControlsRotate.dragging) return;
		if (e.pointerType==='touch' || e.pointerType==='pen') { activeTouchPointers.add(e.pointerId); if(activeTouchPointers.size>1) return; }
			getPointer(e); raycaster.setFromCamera(pointer,camera);
			// For mouse, only left button; for touch/pen there is no buttons semantic like mouse
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			// Consume events for two-click placement if active
			if (placingTool){
				const pt = intersectGround(); if (!pt) return;
				if (placingStage === 0){ placingStart.copy(pt); placingStage = 1; updatePlacingPreview(pt, { shift: !!e.shiftKey }); return; }
				else { finalizePlacing(pt); return; }
			}
			// Check handle hit first when single selection
			if (selectedObjects.length===1 && handleMeshes && handleMeshes.length){
				const hits=raycaster.intersectObjects(handleMeshes,true);
				if (hits && hits.length){
					const h = hits[0].object;
					// begin drag on handle
					const target = selectedObjects[0];
					target.updateMatrixWorld(true);
					const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
					const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, h.getWorldPosition(new THREE.Vector3()));
					// Decompose to build TR (no scale) and its inverse
					const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
					target.matrixWorld.decompose(pos, quat, scl);
					const TR = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1,1,1));
					const invTR = TR.clone().invert();
					// Compute initial local-scaled bounding box (in the same frame used by handles)
					const boxL = new THREE.Box3(); boxL.makeEmpty();
					const v = new THREE.Vector3();
					target.traverseVisible(node => {
						if (!node.isMesh || !node.geometry) return;
						const geom = node.geometry; if (!geom.boundingBox) geom.computeBoundingBox();
						const bb = geom.boundingBox; if (!bb) return;
						for (let xi=0; xi<2; xi++) for (let yi=0; yi<2; yi++) for (let zi=0; zi<2; zi++){
							v.set(xi?bb.max.x:bb.min.x, yi?bb.max.y:bb.min.y, zi?bb.max.z:bb.min.z);
							v.applyMatrix4(node.matrixWorld); // world
							v.applyMatrix4(invTR); // into target's TR-local (scaled local) frame
							boxL.expandByPoint(v);
						}
					});
					const centerL = boxL.getCenter(new THREE.Vector3());
					// Origin offset in world: object's world position relative to world center of the box
					const objWorldPos = new THREE.Vector3(); target.getWorldPosition(objWorldPos);
					const startCenterW = centerL.clone().applyMatrix4(TR);
					const originOffset = objWorldPos.clone().sub(startCenterW);
					const objScale = target.scale.clone();
					const pivotL = h.userData.__handle.anchor.clone();
					handleDrag = { mesh: h, info: h.userData.__handle, target, start: { boxL: boxL.clone(), centerL: centerL.clone(), objWorldPos: objWorldPos.clone(), objScale: objScale.clone(), originOffset: originOffset.clone(), TR, invTR, pos0: pos.clone(), quat0: quat.clone(), pivotL }, dragPlane: plane };
					controls.enabled = false;
					return; // consume
				}
			}
			const importPanelOpen = importGroup && importGroup.classList.contains('open');
			if((mode==='import' || importPanelOpen) && loadedModel){
				const hits=raycaster.intersectObjects(selectableTargets(),true);
				let dropPoint = null;
				if (hits.length) dropPoint = hits[0].point.clone().add(new THREE.Vector3(0, SURFACE_EPS, 0));
				else dropPoint = intersectGround();
				if(!dropPoint) return;
				const clone=loadedModel.clone();
				clone.position.copy(dropPoint);
				addObjectToScene(clone); saveSessionDraftNow();
				// single placement complete
				loadedModel = null;
				if (fileInput) fileInput.value = '';
				if (placingPopup) placingPopup.style.display = 'none';
			}
		else if(mode==='edit'){
            if (activeDrawTool){ const hits=raycaster.intersectObjects(selectableTargets(),true); const baseY = hits.length ? hits[0].point.y : 0; const pt = intersectAtY(baseY) || intersectGround(); if(!pt) return; isDragging=true; startPt.copy(pt); dragStartScreenY = e.clientY; controls.enabled=false; return; }
			if(e.pointerType==='touch' || e.pointerType==='pen'){ e.target.__tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
			const hits=raycaster.intersectObjects(selectableTargets(),true);
			if(hits.length){
				const obj = __resolvePickedObjectFromHits(hits);
				if (!obj) return;
				if(e.shiftKey||e.ctrlKey||e.metaKey){
					if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj);
				} else {
					selectedObjects=[obj];
					// On single-click, prefer gizmos
					singleSelectionMode = 'gizmo';
					// Desktop double-click fallback: quick second click on same object -> grabbers
					if (e.pointerType !== 'touch'){
						const now = performance.now();
						if (lastClickObj === obj && (now - lastClickAt) < 350){
							singleSelectionMode = 'handles';
							attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
							lastClickAt = 0; lastClickObj = null;
							return;
						} else {
							lastClickAt = now; lastClickObj = obj;
						}
					}
				}
				attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
			}
			else {
				// Click off -> deselect
				selectedObjects=[]; singleSelectionMode='gizmo'; transformControls.detach(); transformControlsRotate.detach(); clearHandles(); clearSelectionOutlines(); updateVisibilityUI(); lastClickAt = 0; lastClickObj = null;
			}
		} else { transformControls.detach(); transformControlsRotate.detach(); }
	});
			renderer.domElement.addEventListener('pointerup', e => {
			if(e.pointerType==='touch' || e.pointerType==='pen'){
			const start = e.target.__tapStart; activeTouchPointers.delete(e.pointerId);
				if(mode==='edit' && start){ const dt = performance.now() - start.t; const dx = Math.abs(e.clientX - start.x); const dy = Math.abs(e.clientY - start.y); if(dt < 300 && dx < 8 && dy < 8){ getPointer(e); raycaster.setFromCamera(pointer,camera); const hits=raycaster.intersectObjects(selectableTargets(),true); if(hits.length){ const obj = __resolvePickedObjectFromHits(hits); if (obj){ selectedObjects=[obj]; const now = performance.now(); const isDouble = (lastTapObj === obj) && (now - lastTapAt < 350); if (isDouble) { singleSelectionMode='handles'; lastTapAt = 0; lastTapObj = null; } else { singleSelectionMode='gizmo'; lastTapAt = now; lastTapObj = obj; } attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI(); } else { selectedObjects=[]; singleSelectionMode='gizmo'; transformControls.detach(); transformControlsRotate.detach(); clearHandles(); clearSelectionOutlines(); updateVisibilityUI(); lastTapAt = 0; lastTapObj = null; } } else { selectedObjects=[]; singleSelectionMode='gizmo'; transformControls.detach(); transformControlsRotate.detach(); clearHandles(); clearSelectionOutlines(); updateVisibilityUI(); lastTapAt = 0; lastTapObj = null; } } e.target.__tapStart = undefined; }
		}
		// end handle drag if active
	if (handleDrag){ handleDrag = null; controls.enabled = true; updateHandles(); snapVisuals.hide(); saveSessionDraftSoon(); }
	});

	// Grouping logic for toolbox button
	function handleGroupSelected() {
		if(selectedObjects.length<2) return;
		const center = new THREE.Vector3(); selectedObjects.forEach(obj => { obj.updateMatrixWorld(); const pos = new THREE.Vector3(); pos.setFromMatrixPosition(obj.matrixWorld); center.add(pos); }); center.multiplyScalar(1 / selectedObjects.length);
		selectedObjects.forEach(obj=>{ scene.remove(obj); const idx=objects.indexOf(obj); if(idx>-1) objects.splice(idx,1); });
		const group=new THREE.Group(); group.position.copy(center);
		selectedObjects.forEach(obj=>{ obj.updateMatrixWorld(); const worldPos = new THREE.Vector3(); worldPos.setFromMatrixPosition(obj.matrixWorld); obj.position.copy(worldPos.sub(center)); group.add(obj); });
		group.name='Group '+(objects.filter(o=>o.type==='Group').length+1);
	scene.add(group); objects.push(group); selectedObjects=[group]; attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); saveSessionDraftNow();
	}

	// Draw-create preview and two-click placement live update
		renderer.domElement.addEventListener('pointermove',e=>{
		// Update live preview for two-click placement
		if (placingTool && placingStage===1){ getPointer(e); raycaster.setFromCamera(pointer,camera); const pt = intersectGround(); if (pt) updatePlacingPreview(pt, { shift: !!e.shiftKey }); }
		// Handle dragging
		if (handleDrag){
			getPointer(e); raycaster.setFromCamera(pointer,camera);
			const ptW = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(handleDrag.dragPlane, ptW)) return;
			const { target, info, start } = handleDrag; const mask = info.mask;
			// Convert hit point to object-local coordinates using the cached inverse TRS
			const ptL = ptW.clone().applyMatrix4(start.invTR);
			// Work from the initial TR-local box extents
			const box0L = start.boxL; const min0L = box0L.min.clone(); const max0L = box0L.max.clone();
			let min = min0L.clone(); let max = max0L.clone();
			if (info.kind === 'center'){
				// Move the object by the delta in world space along the drag plane
				const deltaW = ptW.clone().sub(handleDrag.mesh.getWorldPosition(new THREE.Vector3()));
				let newWorldPos = start.objWorldPos.clone().add(deltaW);
				// Soft snap: adjust by nearest face-to-face delta
				if (SNAP_ENABLED && !snapGuard){
					snapGuard = true;
					const parent = target.parent || scene;
					const newLocal = parent.worldToLocal(newWorldPos.clone());
					// Temporarily set position to compute box at new pose
					const oldPos = target.position.clone();
					target.position.copy(newLocal);
					target.updateMatrixWorld(true);
					const movingBox = new THREE.Box3().setFromObject(target);
					const exclude = new Set([target]);
					const snap = computeSnapDelta(movingBox, exclude);
					// Revert and apply snap in world
					target.position.copy(oldPos);
					newWorldPos.add(snap.delta);
					if (snap.axis) snapVisuals.showAt(movingBox, snap); else snapVisuals.hide();
					snapGuard = false;
				}
				const parent = target.parent || scene; const newLocal = parent.worldToLocal(newWorldPos.clone());
					target.position.copy(newLocal);
					rebuildSelectionOutlines();
				return;
			}
			const anchor = info.anchor.clone();
			const minSize = 0.1;
			if (mask[0]){ if (Math.abs(anchor.x - min0L.x) < Math.abs(anchor.x - max0L.x)) { max.x = Math.max(anchor.x + minSize, ptL.x); min.x = anchor.x; } else { min.x = Math.min(anchor.x - minSize, ptL.x); max.x = anchor.x; } }
			if (mask[1]){ if (Math.abs(anchor.y - min0L.y) < Math.abs(anchor.y - max0L.y)) { max.y = Math.max(anchor.y + minSize, ptL.y); min.y = anchor.y; } else { min.y = Math.min(anchor.y - minSize, ptL.y); max.y = anchor.y; } }
			if (mask[2]){ if (Math.abs(anchor.z - min0L.z) < Math.abs(anchor.z - max0L.z)) { max.z = Math.max(anchor.z + minSize, ptL.z); min.z = anchor.z; } else { min.z = Math.min(anchor.z - minSize, ptL.z); max.z = anchor.z; } }
			const size0 = max0L.clone().sub(min0L); const size1 = max.clone().sub(min);
			const s = new THREE.Vector3(
				mask[0] ? Math.max(0.01, size1.x / Math.max(0.01, size0.x)) : 1,
				mask[1] ? Math.max(0.01, size1.y / Math.max(0.01, size0.y)) : 1,
				mask[2] ? Math.max(0.01, size1.z / Math.max(0.01, size0.z)) : 1
			);
			// Compute new scale and adjust translation to keep pivot fixed in world
			const pivotL = start.pivotL;
			const scaleNew = new THREE.Vector3(start.objScale.x * s.x, start.objScale.y * s.y, start.objScale.z * s.z);
			const scaleOld = start.objScale;
			// World pivot using initial TR
			const pivotW0 = pivotL.clone().applyMatrix4(start.TR);
			// Delta in local to keep pivot fixed under scaling: (1 - s) * pivotL
			const deltaLocal = new THREE.Vector3(
				(1 - s.x) * pivotL.x,
				(1 - s.y) * pivotL.y,
				(1 - s.z) * pivotL.z
			);
			// Rotate deltaLocal into world and add to original world position
			const deltaWorld = deltaLocal.clone().applyQuaternion(start.quat0);
			const newWorldPos = start.pos0.clone().add(deltaWorld);
			// Apply new scale and position
			target.scale.copy(scaleNew);
			const parent = target.parent || scene; const newLocal = parent.worldToLocal(newWorldPos.clone());
				target.position.copy(newLocal);
				refreshHandlePositionsDuringDrag(target);
				rebuildSelectionOutlines();
			return;
		}
		if(!isDragging||!activeDrawTool) return; getPointer(e); raycaster.setFromCamera(pointer,camera);
		const pt=intersectGround(); if(!pt) return;
		// Footprint on base plane
		const dx=pt.x-startPt.x, dz=pt.z-startPt.z; const sx=Math.max(0.1,Math.abs(dx)), sz=Math.max(0.1,Math.abs(dz));
		const minX = Math.min(startPt.x, pt.x); const maxX = Math.max(startPt.x, pt.x);
		const minZ = Math.min(startPt.z, pt.z); const maxZ = Math.max(startPt.z, pt.z);
		const r=Math.max(sx,sz)/2;
		// Height from vertical drag in screen space (up increases height)
		const dyPx = (dragStartScreenY - e.clientY);
		const camDist = camera.position.distanceTo(controls.target || new THREE.Vector3());
		const pxToWorld = Math.max(0.002, camDist / 600); // sensitivity scaling
		let h = Math.max(0.1, Math.abs(dyPx) * pxToWorld);
		// When Plan View Lock is active, default new objects to 3ft tall minimum
		if (planViewLocked) h = Math.max(h, 3);
		const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
		const cyBox = startPt.y + h/2; // center Y for extruded shapes resting on base
		const cySphere = startPt.y + r; // sphere rests on base
		if(previewMesh){ scene.remove(previewMesh); if(previewMesh.geometry) previewMesh.geometry.dispose(); if(previewMesh.material&&previewMesh.material.dispose) previewMesh.material.dispose(); previewMesh=null; }
		if(previewOutline){ scene.remove(previewOutline); if(previewOutline.geometry) previewOutline.geometry.dispose(); if(previewOutline.material&&previewOutline.material.dispose) previewOutline.material.dispose(); previewOutline=null; }
		const activeMat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material;
		if(activeDrawTool==='box'){ previewMesh=new THREE.Mesh(new THREE.BoxGeometry(sx,h,sz), activeMat); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
		else if(activeDrawTool==='sphere'){ previewMesh=new THREE.Mesh(new THREE.SphereGeometry(r,24,16), activeMat); if(previewMesh) previewMesh.position.set(cx,cySphere,cz); }
		else if(activeDrawTool==='cylinder'){ previewMesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24), activeMat); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
		else if(activeDrawTool==='cone'){ previewMesh=new THREE.Mesh(new THREE.ConeGeometry(r,h,24), activeMat); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
		// Base rectangle outline (helps intuition: corner -> opposite corner)
		try {
			const pos = new Float32Array([
				minX, startPt.y + SURFACE_EPS, minZ,
				maxX, startPt.y + SURFACE_EPS, minZ,
				maxX, startPt.y + SURFACE_EPS, maxZ,
				minX, startPt.y + SURFACE_EPS, maxZ,
				minX, startPt.y + SURFACE_EPS, minZ,
			]);
			const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
			previewOutline = new THREE.Line(new THREE.LineBasicMaterial({ color: 0x222222 }), g);
			scene.add(previewOutline);
		} catch {}
		if(previewMesh){ scene.add(previewMesh); }
	});
	window.addEventListener('pointerup',e=>{ if(e.button!==0) return; if(!isDragging||!activeDrawTool) return; isDragging=false; controls.enabled=true; if(previewMesh){ const placed=previewMesh; previewMesh=null; placed.name=`${activeDrawTool[0].toUpperCase()}${activeDrawTool.slice(1)} ${objects.length+1}`; addObjectToScene(placed,{ select:true }); } if(previewOutline){ scene.remove(previewOutline); if(previewOutline.geometry) previewOutline.geometry.dispose(); if(previewOutline.material&&previewOutline.material.dispose) previewOutline.material.dispose(); previewOutline=null; } activeDrawTool=null; [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed','false'); }); saveSessionDraftNow(); });
	window.addEventListener('keydown',e=>{ if(e.key==='Escape' && activeDrawTool){ activeDrawTool=null; if(isDragging){ isDragging=false; controls.enabled=true; } if(previewMesh){ scene.remove(previewMesh); if(previewMesh.geometry) previewMesh.geometry.dispose(); if(previewMesh.material&&previewMesh.material.dispose) previewMesh.material.dispose(); previewMesh=null; } if(previewOutline){ scene.remove(previewOutline); if(previewOutline.geometry) previewOutline.geometry.dispose(); if(previewOutline.material&&previewOutline.material.dispose) previewOutline.material.dispose(); previewOutline=null; } [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed','false'); }); } });

	// ESC should also cancel two-click placing tools (floor/wall)
	window.addEventListener('keydown', e => { if (e.key === 'Escape' && placingTool){ cancelPlacing(); } });

	// Primitives + utilities
	if (addFloorBtn) addFloorBtn.addEventListener('click',()=>{ startPlacing('floor'); });
	if (addWallBtn) addWallBtn.addEventListener('click',()=>{ startPlacing('wall'); });
	const addColumnBtn = document.getElementById('addColumn');
	const addBeamBtn = document.getElementById('addBeam');
	const addRampBtn = document.getElementById('addRamp');
	const addStairsBtn = document.getElementById('addStairs');
	const addRoofBtn = document.getElementById('addRoof');
	if(addColumnBtn) addColumnBtn.addEventListener('click', ()=>{ const mat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material; const mesh = primitives.createColumn({ THREE, material: mat, radius: 0.5, height: 8 }); mesh.name=`Column ${objects.filter(o=>o.name.startsWith('Column')).length+1}`; addObjectToScene(mesh,{ select:true }); });
	if(addBeamBtn) addBeamBtn.addEventListener('click', ()=>{ const mat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material; const mesh = primitives.createBeam({ THREE, material: mat, len: 12, depth: 1, width: 1 }); mesh.name=`Beam ${objects.filter(o=>o.name.startsWith('Beam')).length+1}`; addObjectToScene(mesh,{ select:true }); });
	if(addRampBtn) addRampBtn.addEventListener('click', ()=>{ const mat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material; const mesh = primitives.createRamp({ THREE, material: mat, len: 10, thick: 0.5, width: 4 }); mesh.name=`Ramp ${objects.filter(o=>o.name.startsWith('Ramp')).length+1}`; addObjectToScene(mesh,{ select:true }); });
	if(addStairsBtn) addStairsBtn.addEventListener('click', ()=>{ const mat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material; const grp = primitives.createStairs({ THREE, material: mat, steps: 10, rise: 0.7, tread: 1, width: 4 }); grp.name=`Stairs ${objects.filter(o=>o.name.startsWith('Stairs')).length+1}`; addObjectToScene(grp,{ select:true }); });
	if(addRoofBtn) addRoofBtn.addEventListener('click', ()=>{ const mat = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle) || material; const mesh = primitives.createRoofPlane({ THREE, material: mat, w: 12, d: 10 }); mesh.name=`Roof Plane ${objects.filter(o=>o.name.startsWith('Roof Plane')).length+1}`; addObjectToScene(mesh,{ select:true }); });

	// Return to Floor logic for toolbox button
	function handleReturnToFloor() {
		if(selectedObjects.length >= 2){
			let minY = Infinity;
			const box = new THREE.Box3();
			selectedObjects.forEach(o=>{ box.setFromObject(o); if(box.min.y < minY) minY = box.min.y; });
			if(isFinite(minY) && Math.abs(minY) > 1e-6){
				const T = new THREE.Matrix4().makeTranslation(0, -minY, 0);
				selectedObjects.forEach(o=>{
					const current = getWorldMatrix(o);
					setWorldMatrix(o, new THREE.Matrix4().multiplyMatrices(T, current));
				});
				updateMultiSelectPivot();
				rebuildSelectionOutlines();
				saveSessionDraftSoon();
			}
		} else {
			const sel=transformControls.object;
			if(sel){
				const box=new THREE.Box3().setFromObject(sel);
				const minY=box.min.y;
				sel.position.y-=minY;
				saveSessionDraftSoon();
			}
		}
	}
	// Delete
	window.addEventListener('keydown',e=>{ if(mode==='edit'&&(e.key==='Delete'||e.key==='Backspace')){ const toDelete = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []); toDelete.forEach(sel=>{ scene.remove(sel); const idx=objects.indexOf(sel); if(idx>-1)objects.splice(idx,1); }); selectedObjects = []; transformControls.detach(); clearSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); saveSessionDraftNow(); } });

	// Keep outlines syncing
	transformControls.addEventListener('objectChange', () => { rebuildSelectionOutlines(); });
	transformControlsRotate.addEventListener('objectChange', () => { rebuildSelectionOutlines(); });

	// Animation
	function resizeRenderer() {
		const vv = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport : null;
		const w = vv ? Math.round(vv.width) : window.innerWidth;
		const h = vv ? Math.round(vv.height) : window.innerHeight;
		// Update camera aspect safely (handles both perspective and ortho via controls.object)
		const activeCam = camera;
		if (activeCam && activeCam.isPerspectiveCamera) {
			activeCam.aspect = Math.max(0.0001, w / h);
			activeCam.updateProjectionMatrix();
		}
		if (orthoCamera && camera === orthoCamera) {
			// Recompute ortho frustum to keep content scale consistent across resizes
			const aspect = Math.max(0.0001, w / h);
			const box = new THREE.Box3(); objects.forEach(o => box.expandByObject(o));
			const size = box.getSize(new THREE.Vector3());
			const orthoSize = Math.max(size.x, size.y, size.z) * 0.7 || 10;
			orthoCamera.left = -orthoSize * aspect;
			orthoCamera.right = orthoSize * aspect;
			orthoCamera.top = orthoSize;
			orthoCamera.bottom = -orthoSize;
			orthoCamera.updateProjectionMatrix();
		}
		renderer.setSize(w, h);
	}
	window.addEventListener('resize', resizeRenderer);
	if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeRenderer);
	renderer.setAnimationLoop((t, frame) => {
		try {
				// Keep single-selection grippers aligned with the object's TR; rebuild on scale changes
				if (handlesGroup && lastHandleTarget && selectedObjects.length === 1 && selectedObjects[0] === lastHandleTarget) {
					lastHandleTarget.updateMatrixWorld(true);
					// Update group TR so handles rotate/translate with object
					const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
					lastHandleTarget.matrixWorld.decompose(pos, quat, scl);
					const tr = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1,1,1));
					if (!handlesGroup.matrix.equals(tr)) { handlesGroup.matrix.copy(tr); handlesGroup.matrixWorldNeedsUpdate = true; }
					// During drag, live-update positions for smooth feedback; otherwise rebuild on scale change
					if (handleDrag) {
						refreshHandlePositionsDuringDrag(lastHandleTarget);
					} else if (Math.abs(scl.x-lastHandleScale.x)>1e-6 || Math.abs(scl.y-lastHandleScale.y)>1e-6 || Math.abs(scl.z-lastHandleScale.z)>1e-6) {
						lastHandleScale.copy(scl);
						buildHandlesForObject(lastHandleTarget);
					}
				}
			// If infinite grid mode, keep grid centered beneath camera target to simulate endlessness
			if (grid && gridInfiniteBtn && gridInfiniteBtn.getAttribute('aria-pressed') === 'true') {
				const target = controls && controls.target ? controls.target : new THREE.Vector3();
				// Snap grid to a multiple of its cell size to avoid visible swimming
				const cell = GRID_SIZE / Math.max(1, GRID_DIVS);
				const gx = Math.round(target.x / cell) * cell;
				const gz = Math.round(target.z / cell) * cell;
				grid.position.set(gx, 0, gz);
			}
			// Room Scan per-frame updates (mutually exclusive with AR placement)
			if (roomScan && roomScan.isActive && roomScan.isActive()) {
				roomScan.update(frame);
			} else if (arActive) {
				// Perform one-time placement when AR starts using hit-test
				const session = renderer.xr.getSession && renderer.xr.getSession();
				if (session && xrHitTestSource && !arPlaced && frame && xrLocalSpace) {
					const results = frame.getHitTestResults(xrHitTestSource);
					if (results && results.length) {
						const pose = results[0].getPose(xrLocalSpace);
						if (pose) {
							// Build AR content from entire scene objects
							if (!arContent) {
								const root = buildExportRootFromObjects(objects);
								prepareModelForAR(root);
								arContent = root;
								scene.add(arContent);
							}
							const p = pose.transform.position;
							arContent.position.set(p.x, p.y, p.z);
							// Hand over to AR edit service for post-placement manipulation
							try { arEdit.setTarget(arContent); } catch {}
							arPlaced = true;
							if (xrHitTestSource && xrHitTestSource.cancel) { try { xrHitTestSource.cancel(); } catch {} }
							xrHitTestSource = null;
						}
					}
				}
				// After placement, update AR edit interaction via service
				if (session && arPlaced && arContent && frame) {
					try { arEdit.update(frame, xrLocalSpace); } catch {}
				}
			}
			renderer.render(scene, camera);
			// Update HUD status about depth availability (XR only)
			try {
				const xrCam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
				const dm = frame && frame.getDepthInformation && xrCam ? frame.getDepthInformation(xrCam) : null;
				const hudStatus = document.getElementById('scanHudStatus');
				if (hudStatus) hudStatus.textContent = dm ? 'Scanning (depth ON)… tap to finish' : 'Scanning (no depth)… tap to finish';
			} catch {}
		} catch (err) {
			const banner = document.getElementById('error-banner'); if (banner) { banner.textContent = 'Render error: ' + (err?.message || err); banner.style.display = 'block'; }
			console.error(err);
		}
	});

	// Utilities group mirrors
	const toolSnapFloorBtn = document.getElementById('toolSnapFloor');
	if (toolSnapFloorBtn) toolSnapFloorBtn.addEventListener('click', handleReturnToFloor);
	const toolGroupSelectedBtn = document.getElementById('toolGroupSelected');
	if (toolGroupSelectedBtn) toolGroupSelectedBtn.addEventListener('click', handleGroupSelected);
	const newSceneBtn = document.getElementById('newScene');
	if (newSceneBtn) newSceneBtn.addEventListener('click', () => {
		clearSceneObjects();
		currentSceneId = null;
		currentSceneName = '';
		try { sessionStorage.removeItem('sketcher:sessionDraft'); } catch {}
		updateCameraClipping();
	});
	const addScaleFigureBtn = document.getElementById('addScaleFigure'); if (addScaleFigureBtn) addScaleFigureBtn.addEventListener('click', ()=>{ const grp = new THREE.Group(); const mat = material.clone(); const legH=2.5, legR=0.25, legX=0.35; const torsoH=2.5, torsoRTop=0.5, torsoRBot=0.6; const headR=0.5; const legGeo = new THREE.CylinderGeometry(legR, legR, legH, 16); const leftLeg = new THREE.Mesh(legGeo, mat.clone()); leftLeg.position.set(-legX, legH/2, 0); const rightLeg = new THREE.Mesh(legGeo.clone(), mat.clone()); rightLeg.position.set(legX, legH/2, 0); grp.add(leftLeg, rightLeg); const torsoGeo = new THREE.CylinderGeometry(torsoRTop, torsoRBot, torsoH, 24); const torso = new THREE.Mesh(torsoGeo, mat.clone()); torso.position.set(0, legH + torsoH/2, 0); grp.add(torso); const headGeo = new THREE.SphereGeometry(headR, 24, 16); const head = new THREE.Mesh(headGeo, mat.clone()); head.position.set(0, legH + torsoH + headR, 0); grp.add(head); grp.name = `Scale Figure 6ft ${objects.filter(o=>o.name && o.name.startsWith('Scale Figure 6ft')).length + 1}`; addObjectToScene(grp, { select: true }); });

	// Local scenes: serialize, save, list, load, delete
	function clearSceneObjects() {
		[...objects].forEach(o => { scene.remove(o); const idx = objects.indexOf(o); if (idx>-1) objects.splice(idx,1); });
		selectedObjects = []; transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines(); updateVisibilityUI();
	}
	async function refreshScenesList() {
		if (!scenesList) return;
		const items = await localStore.listScenes().catch(()=>[]);
		scenesList.innerHTML = '';
		if (!items.length) { scenesList.textContent = 'No saved scenes'; return; }
		items.forEach(({ id, name, updatedAt }) => {
			const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px'; row.style.margin='4px 0';
			const btnLoad = document.createElement('button'); btnLoad.textContent = name || 'Untitled'; btnLoad.className='btn-link'; btnLoad.style.flex='1'; btnLoad.style.textAlign='left'; btnLoad.style.background='transparent'; btnLoad.style.border='none'; btnLoad.style.cursor='pointer';
			btnLoad.addEventListener('click', async ()=>{
				// Always clear everything before loading
				clearSceneObjects();
				const rec = await localStore.getScene(id); if (!rec || !rec.json) return;
				try {
					const loader = new THREE.ObjectLoader();
					const root = loader.parse(rec.json);
					// Add children as top-level objects
					[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
					updateCameraClipping();
					// Track current scene for overwrite on Save
					currentSceneId = id;
					currentSceneName = name || 'Untitled';
					// Replace session draft with this loaded scene
					try { sessionStorage.setItem('sketcher:sessionDraft', JSON.stringify({ json: rec.json })); } catch {}
				} catch(e){ alert('Failed to load scene'); console.error(e); }
			});
			const btnDelete = document.createElement('button'); btnDelete.textContent='Delete'; btnDelete.className='btn'; btnDelete.style.fontSize='11px'; btnDelete.addEventListener('click', async ()=>{ await localStore.deleteScene(id); if (currentSceneId === id) { currentSceneId = null; currentSceneName = ''; } refreshScenesList(); });
			row.append(btnLoad, btnDelete); scenesList.append(row);
		});
	}
	if (openScenesBtn && scenesDrawer) {
		openScenesBtn.addEventListener('click', async ()=>{
			const open = scenesDrawer.classList.contains('open');
			scenesDrawer.classList.toggle('open', !open);
			scenesDrawer.setAttribute('aria-hidden', open ? 'true' : 'false');
			if (!open) await refreshScenesList();
		});
	}
	if (saveSceneBtn) {
		saveSceneBtn.addEventListener('click', async (e)=>{
			try {
				const name = prompt('Scene name?') || 'Untitled';
				const json = serializeScene();
				let thumb = null;
				try {
					const mod = await import('./columbarium.js');
					if (mod && mod.generateSceneThumbnail) thumb = await mod.generateSceneThumbnail(json);
				} catch {}
				await localStore.saveScene({ name, json, thumb });
				// After saving, do not update currentSceneId/currentSceneName (always a new scene)
				if (scenesDrawer && scenesDrawer.classList.contains('open')) refreshScenesList();
				alert('Saved');
			} catch(e){ alert('Save failed'); console.error(e); }
		});
	}

	// Map Import wiring
	setupMapImport({ THREE, renderer, fallbackMaterial: material, addObjectToScene, elements: { backdrop: mapBackdrop, container: mapContainer, searchInput: mapSearchInput, searchBtn: mapSearchBtn, closeBtn: mapCloseBtn, useFlatBtn: mapUseFlatBtn, useTopoBtn: mapUseTopoBtn, drawToggleBtn: mapDrawToggle, importBtn: mapImportBtn } });

	// Preserve current editor scene when navigating to Columbarium (session draft)
	(() => {
		try {
			const openColBtn = document.getElementById('openColMenu');
			const colPopup = document.getElementById('columbariumPopup');
			const colPersonal = document.getElementById('colPersonal');
			const colCommunity = document.getElementById('colCommunity');
			if (openColBtn && colPopup) {
				openColBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					const isOpen = colPopup.getAttribute('data-open') === 'true';
					if (isOpen) {
						colPopup.setAttribute('data-open', 'false');
						colPopup.style.display = 'none';
					} else {
						colPopup.style.display = 'block';
						// next tick to allow transition
						requestAnimationFrame(()=> colPopup.setAttribute('data-open', 'true'));
					}
				});
				// close when clicking outside
				document.addEventListener('click', (e) => {
					if (!colPopup || colPopup.style.display === 'none') return;
					const target = e.target;
					if (target && (colPopup.contains(target) || openColBtn.contains(target))) return;
					colPopup.setAttribute('data-open', 'false');
					colPopup.style.display = 'none';
				});
			}

			function saveDraft() {
				try { const json = serializeScene(); sessionStorage.setItem('sketcher:sessionDraft', JSON.stringify({ json })); } catch {}
			}
			if (colPersonal) colPersonal.addEventListener('click', saveDraft);
			if (colCommunity) colCommunity.addEventListener('click', saveDraft);
			const to2D = document.getElementById('toSketch2D');
			if (to2D) {
				to2D.addEventListener('click', (e) => {
					if (e && e.preventDefault) e.preventDefault();
					saveDraft();
					try { document.body.classList.add('page-leave'); } catch {}
					const url = new URL('./sketch2d.html', location.href);
					setTimeout(()=>{ window.location.href = url.toString(); }, 170);
				}, { capture: false });
			}
		} catch {}
	})();

	// Deep-link load by sceneId from query string
	(async () => {
		try {
			const params = new URLSearchParams(location.search);
			const sceneId = params.get('sceneId');
			if (sceneId) {
				const rec = await localStore.getScene(sceneId);
				if (rec && rec.json) {
					clearSceneObjects();
					const loader = new THREE.ObjectLoader();
					const root = loader.parse(rec.json);
					[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
					updateCameraClipping();
					currentSceneId = rec.id; currentSceneName = rec.name || 'Untitled';
					// Opening a specific scene replaces any session draft
					try { sessionStorage.removeItem('sketcher:sessionDraft'); } catch {}
				}
			} else {
				// No explicit scene selected: attempt to restore session draft
				try {
					const raw = sessionStorage.getItem('sketcher:sessionDraft');
					if (raw) {
						const { json } = JSON.parse(raw);
						if (json) {
							clearSceneObjects();
							const loader = new THREE.ObjectLoader();
							const root = loader.parse(json);
							[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
							updateCameraClipping();
							// Do not set currentSceneId for session drafts
						}
					}
				} catch {}
			}
		} catch {}
	})();

	// Project any 2D sketch (feet) onto ground as helper overlay
	(function load2DOverlay(){
		try {
			const raw = sessionStorage.getItem('sketcher:2d'); if(!raw) return;
			const data = JSON.parse(raw); if(!data || !Array.isArray(data.objects)) return;
			const buildOverlay = (dataObj)=>{
				const group = new THREE.Group(); group.name = '2D Overlay'; group.userData.__helper = true;
				// Color handling: use 2D stroke/fill; invert if too close to 3D background
				const getBgColor = ()=>{ const c = new THREE.Color(); try { renderer.getClearColor(c); } catch{} return c; };
				const normHex = (hex)=>{ if(!hex||typeof hex!=='string') return null; const h=hex.trim().toLowerCase(); if(h==='#00000000'||h==='transparent') return null; if(/^#?[0-9a-f]{6,8}$/.test(h)){ const s=h.startsWith('#')?h.slice(1):h; return '#'+s.slice(0,6); } return null; };
				const strToColor = (hex, fallback)=>{ const h=normHex(hex); try { return h? new THREE.Color(h) : (fallback? new THREE.Color(fallback): null); } catch { return fallback? new THREE.Color(fallback): null; } };
				const relLum = (c)=>{ const srgb=[c.r,c.g,c.b].map(v=> v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)); return 0.2126*srgb[0]+0.7152*srgb[1]+0.0722*srgb[2]; };
				const contrastRatio = (a,b)=>{ const L1=Math.max(relLum(a),relLum(b)); const L2=Math.min(relLum(a),relLum(b)); return (L1+0.05)/(L2+0.05); };
				const invertColor = (c)=> new THREE.Color(1-c.r, 1-c.g, 1-c.b);
				const CONTRAST_MIN = 2.6; // threshold for readability
				const trackedMats = []; // { type: 'stroke'|'fill', mat, base }
				const strokeCache = new Map();
				const fillCache = new Map();
				function getStrokeMat(baseHex){
					const key = normHex(baseHex) || '#111111';
					let rec = strokeCache.get(key);
					if(!rec){
						const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: true });
						rec = { mat, base: strToColor(key, '#111111') };
						strokeCache.set(key, rec); trackedMats.push({ type:'stroke', ...rec });
					}
					return rec.mat;
				}
				function getFillMat(baseHex, opacity){
					const key = normHex(baseHex); if(!key) return null;
					let rec = fillCache.get(key);
					if(!rec){
						const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: Math.max(0.05, Math.min(1, opacity ?? 0.25)), side: THREE.DoubleSide, depthWrite:false });
						rec = { mat, base: strToColor(key, '#cccccc') };
						fillCache.set(key, rec); trackedMats.push({ type:'fill', ...rec });
					}
					return rec.mat;
				}
				const updateOverlayColors = ()=>{
					const bg = getBgColor();
					for(const rec of trackedMats){
						const base = rec.base; if(!base) continue;
						let adj = base;
						try { if (contrastRatio(base, bg) < CONTRAST_MIN) adj = invertColor(base); } catch {}
						rec.mat.color.set(adj);
					}
				};
				updateOverlayColors();
				const zLift = 0.02;
				// Compute 2D content bounds in feet to recenter geometry about (0,0) so gizmo sits at sketch center
				const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
				for (const o of (dataObj.objects||[])){
					if (o.type==='line'){ bounds.minX=Math.min(bounds.minX,o.a.x,o.b.x); bounds.maxX=Math.max(bounds.maxX,o.a.x,o.b.x); bounds.minY=Math.min(bounds.minY,o.a.y,o.b.y); bounds.maxY=Math.max(bounds.maxY,o.a.y,o.b.y); }
					else if (o.type==='rect' || o.type==='ellipse'){ bounds.minX=Math.min(bounds.minX,o.a.x,o.b.x); bounds.maxX=Math.max(bounds.maxX,o.a.x,o.b.x); bounds.minY=Math.min(bounds.minY,o.a.y,o.b.y); bounds.maxY=Math.max(bounds.maxY,o.a.y,o.b.y); }
					else if (o.type==='path' && Array.isArray(o.pts)) { for (const p of o.pts){ bounds.minX=Math.min(bounds.minX,p.x); bounds.maxX=Math.max(bounds.maxX,p.x); bounds.minY=Math.min(bounds.minY,p.y); bounds.maxY=Math.max(bounds.maxY,p.y); } }
				}
				const hasBounds = isFinite(bounds.minX) && isFinite(bounds.maxX) && bounds.maxX>bounds.minX && isFinite(bounds.minY) && isFinite(bounds.maxY) && bounds.maxY>bounds.minY;
				const cx = hasBounds ? (bounds.minX + bounds.maxX)/2 : 0;
				const cy = hasBounds ? (bounds.minY + bounds.maxY)/2 : 0;
				const shiftX = -cx, shiftY = -cy; // recenters to origin
				// Build geometry shifted so the group's origin is the sketch center
				for(const o of (dataObj.objects||[])){
					const strokeHex = o.stroke || '#111111';
					const fillHex = (o.fill && o.fill !== '#00000000') ? o.fill : null;
					if(o.type==='line'){
						const g = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(o.a.x+shiftX, 0, o.a.y+shiftY), new THREE.Vector3(o.b.x+shiftX, 0, o.b.y+shiftY) ]);
						const line = new THREE.Line(g, getStrokeMat(strokeHex)); line.position.y = zLift; group.add(line);
					} else if(o.type==='rect'){
						const minX = Math.min(o.a.x,o.b.x)+shiftX, maxX=Math.max(o.a.x,o.b.x)+shiftX;
						const minY = Math.min(o.a.y,o.b.y)+shiftY, maxY=Math.max(o.a.y,o.b.y)+shiftY;
						const w = Math.max(0.001, maxX-minX); const d = Math.max(0.001, maxY-minY);
						const cxr = (minX+maxX)/2, cyr = (minY+maxY)/2;
						const fm = fillHex ? getFillMat(fillHex, 0.28) : null;
						if (fm){ const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fm); mesh.rotation.x = -Math.PI/2; mesh.position.set(cxr, zLift, cyr); group.add(mesh); }
						const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w,d));
						const edgeL = new THREE.LineSegments(edges, getStrokeMat(strokeHex)); edgeL.rotation.x = -Math.PI/2; edgeL.position.set(cxr, zLift, cyr); group.add(edgeL);
					} else if(o.type==='ellipse'){
						const cx2 = (o.a.x+o.b.x)/2 + shiftX; const cy2=(o.a.y+o.b.y)/2 + shiftY; const rx=Math.abs(o.a.x-o.b.x)/2; const ry=Math.abs(o.a.y-o.b.y)/2;
						const shape = new THREE.Shape(); const steps = 64; for(let i=0;i<=steps;i++){ const t=i/steps*2*Math.PI; const x=cx2+Math.cos(t)*rx; const y=cy2+Math.sin(t)*ry; if(i===0) shape.moveTo(x, y); else shape.lineTo(x, y); }
						if (fillHex){ const geo = new THREE.ShapeGeometry(shape); const mesh = new THREE.Mesh(geo, getFillMat(fillHex, 0.26)); mesh.rotation.x=-Math.PI/2; mesh.position.y = zLift; group.add(mesh); }
						const pts = shape.getPoints(64).map(p=> new THREE.Vector3(p.x, zLift+1e-4, p.y));
						const g = new THREE.BufferGeometry().setFromPoints(pts);
						const line = new THREE.LineLoop(g, getStrokeMat(strokeHex)); group.add(line);
					} else if(o.type==='path' && Array.isArray(o.pts) && o.pts.length>1){
						const pts = o.pts.map(p=> new THREE.Vector3(p.x+shiftX, zLift, p.y+shiftY));
						const g = new THREE.BufferGeometry().setFromPoints(pts);
						const mat = getStrokeMat(strokeHex);
						const line = o.closed ? new THREE.LineLoop(g, mat) : new THREE.Line(g, mat);
						group.add(line);
					}
				}
				// Keep group's origin at sketch center; default offset is zero
				group.position.set(0, 0, 0);
				group.userData.defaultOffset = new THREE.Vector3(0, 0, 0);
				// Keep color in sync each frame
				const orig = renderer.render.bind(renderer);
				renderer.render = function(sc, cam){ updateOverlayColors(); orig(sc, camera); };
				return group;
			};
			// Build initial overlay (single instance)
			const prev = scene.getObjectByName('2D Overlay'); if(prev) scene.remove(prev);
			const initial = buildOverlay(data);
			scene.add(initial);
			// Realtime via BroadcastChannel; fallback to polling localStorage/sessionStorage
			const bc3D = (typeof window !== 'undefined' && 'BroadcastChannel' in window) ? new BroadcastChannel('sketcher-2d') : null;
			if (bc3D){
				bc3D.onmessage = (ev)=>{
					try {
						const d2 = ev.data; if(!d2 || !Array.isArray(d2.objects)) return;
						const old = scene.getObjectByName('2D Overlay');
						// If the 2D sketch was cleared, reset overlay back to center; else preserve moved offset
						const wasCleared = (d2.objects.length === 0);
						let nextOffset = new THREE.Vector3(0,0,0);
						if (old) {
                            const defaultOffset = (old.userData && old.userData.defaultOffset) ? old.userData.defaultOffset : new THREE.Vector3(0,0,0);
                            nextOffset.copy(wasCleared ? defaultOffset : old.position);
                            scene.remove(old);
                        }
						const fresh = buildOverlay(d2);
						fresh.position.copy(nextOffset);
						scene.add(fresh);
					} catch{}
				};
			}
			let lastStamp = data && data.meta && (data.meta.updatedAt || data.meta.createdAt) ? (data.meta.updatedAt || data.meta.createdAt) : 0;
			setInterval(()=>{
				try {
					const raw2 = localStorage.getItem('sketcher:2d') || sessionStorage.getItem('sketcher:2d'); if(!raw2) return;
					const d2 = JSON.parse(raw2); if(!d2 || !Array.isArray(d2.objects)) return;
					const stamp = d2 && d2.meta && (d2.meta.updatedAt || d2.meta.createdAt) ? (d2.meta.updatedAt || d2.meta.createdAt) : 0;
					if (stamp && stamp !== lastStamp){
						lastStamp = stamp;
						const old = scene.getObjectByName('2D Overlay');
						const wasCleared = (d2.objects.length === 0);
						let nextOffset = new THREE.Vector3(0,0,0);
						if (old) {
                                const defaultOffset = (old.userData && old.userData.defaultOffset) ? old.userData.defaultOffset : new THREE.Vector3(0,0,0);
                                nextOffset.copy(wasCleared ? defaultOffset : old.position);
                                scene.remove(old);
                            }
						const fresh = buildOverlay(d2);
						fresh.position.copy(nextOffset); // preserve user-moved insertion, reset if cleared
						scene.add(fresh);
					}
				} catch{}
			}, 500);

			// Wire Return sketch to center button
			try {
				const centerBtn = document.getElementById('centerOverlay');
				if (centerBtn){
					centerBtn.addEventListener('click', ()=>{
						const ov = scene.getObjectByName('2D Overlay');
						if (!ov) return;
						if (ov.userData && ov.userData.defaultOffset) ov.position.copy(ov.userData.defaultOffset); else ov.position.set(0,0,0);
						if (transformControls && transformControls.object === ov){ transformControls.updateMatrixWorld(); }
						renderer.render(scene, camera);
					});
				}
			} catch {}
		} catch(e){ console.warn('2D overlay load failed', e); }
	})();
}

