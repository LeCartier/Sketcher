// Main application entry extracted from index.html
// Exports an init function executed by index.html

export async function init() {
	// Delegate tweenCamera to views.js while keeping the same call shape
	function tweenCamera(fromCam, toCam, duration = 600, onComplete) {
		return views.tweenCamera(fromCam, toCam, controls, duration, onComplete);
	}
		const [THREE, { GLTFLoader }, { OBJLoader }, { OrbitControls }, { TransformControls }, { OBJExporter }, { setupMapImport }, outlines, transforms, localStore, persistence, snapping, views, gridUtils, arExport, { createSnapVisuals }, { createSessionDraft }] = await Promise.all([
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
	renderer.setSize(window.innerWidth, window.innerHeight);
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
	// Room Scan (beta) state
	let scanActive = false;
	let scanSession = null;
	let scanViewerSpace = null;
	let scanLocalSpace = null;
	let scanHitTestSource = null;
	let scanGroup = null; // preview group in meters
	const SCAN_M_TO_FT = 3.28084;
	const scanExtents = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
	// Depth sensing preview/accumulation (meters while scanning)
	let depthPointsPreview = null; // THREE.Points inside scanGroup
	let depthPointsAccum = []; // Array of THREE.Vector3 (meters)
	let depthSampleTick = 0;
	const MAX_DEPTH_POINTS = 15000;
	let arContent = null; // cloned scene content for AR
	let arPlaced = false;
	let xrHitTestSource = null;
	let xrViewerSpace = null;
	let xrLocalSpace = null;

	// Snap highlight via module
	const snapVisuals = createSnapVisuals({ THREE, scene });

	// Manual Room Scan fallback (non-AR)
	let manualScanActive = false;
	let manualScanPreview = null; // THREE.Group
	let manualScanStart = null; // THREE.Vector3
	const MANUAL_FLOOR_THICKNESS_FT = 0.2;

	function startManualRoomScan(){
		// HUD wiring
		const hud = document.getElementById('scanHud');
		const hudStatus = document.getElementById('scanHudStatus');
		const hudCancel = document.getElementById('scanHudCancel');
		if (hud) hud.style.display = 'block';
		if (hudStatus) hudStatus.textContent = 'Manual scan: drag to outline the room, release to finish.';
		if (hudCancel) {
			const cancel = () => {
				manualScanActive = false;
				controls.enabled = true;
				if (hud) hud.style.display = 'none';
				window.removeEventListener('pointerdown', onDown, true);
				window.removeEventListener('pointermove', onMove, true);
				window.removeEventListener('pointerup', onUp, true);
			};
			hudCancel.addEventListener('click', cancel);
		}

		if (manualScanActive) return;
		manualScanActive = true;
		controls.enabled = false;
		// Build a preview group
		manualScanPreview = new THREE.Group();
		manualScanPreview.name = 'Room Scan Manual Preview';
		scene.add(manualScanPreview);
		const info = 'Room Scan (manual): tap-drag to outline the floor; release to finish.';
		try { console.info(info); } catch {}
		// Capture-phase handlers to avoid other tools
		const onDown = (e) => {
			if (!manualScanActive) return;
			e.preventDefault(); e.stopPropagation();
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const pt = intersectGround();
			if (!pt) return;
			manualScanStart = pt.clone();
		};
		const onMove = (e) => {
			if (!manualScanActive || !manualScanStart) return;
			e.preventDefault(); e.stopPropagation();
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const pt = intersectGround(); if (!pt) return;
			const minX = Math.min(manualScanStart.x, pt.x);
			const maxX = Math.max(manualScanStart.x, pt.x);
			const minZ = Math.min(manualScanStart.z, pt.z);
			const maxZ = Math.max(manualScanStart.z, pt.z);
			const w = Math.max(0.1, maxX - minX);
			const d = Math.max(0.1, maxZ - minZ);
			const cx = (minX + maxX) / 2;
			const cz = (minZ + maxZ) / 2;
			// Rebuild preview
			manualScanPreview.clear();
			const floor = new THREE.Mesh(new THREE.BoxGeometry(w, MANUAL_FLOOR_THICKNESS_FT, d), new THREE.MeshBasicMaterial({ color: 0x00ff88, opacity: 0.25, transparent: true }));
			floor.position.set(cx, -MANUAL_FLOOR_THICKNESS_FT/2, cz);
			manualScanPreview.add(floor);
			const wallH = 2.4 * SCAN_M_TO_FT; // ~8 ft
			const t = 0.05; // preview wall thickness
			const y = wallH/2;
			const n = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); n.position.set(cx, y, maxZ); manualScanPreview.add(n);
			const s = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); s.position.set(cx, y, minZ); manualScanPreview.add(s);
			const eMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); eMesh.position.set(maxX, y, cz); manualScanPreview.add(eMesh);
			const wMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); wMesh.position.set(minX, y, cz); manualScanPreview.add(wMesh);
		};
		const onUp = (e) => {
			if (!manualScanActive || !manualScanStart) return;
			e.preventDefault(); e.stopPropagation();
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const pt = intersectGround(); if (!pt) return;
			const minX = Math.min(manualScanStart.x, pt.x);
			const maxX = Math.max(manualScanStart.x, pt.x);
			const minZ = Math.min(manualScanStart.z, pt.z);
			const maxZ = Math.max(manualScanStart.z, pt.z);
			// Create final floor and walls in feet, aligned to Y=0
			const w_ft = Math.max(0.2, maxX - minX);
			const d_ft = Math.max(0.2, maxZ - minZ);
			const cx_ft = (minX + maxX) / 2;
			const cz_ft = (minZ + maxZ) / 2;
			const h_ft = 8.0; // default wall height
			{
				const geo = new THREE.BoxGeometry(w_ft, MANUAL_FLOOR_THICKNESS_FT, d_ft);
				const mesh = new THREE.Mesh(geo, material.clone());
				mesh.position.set(cx_ft, -MANUAL_FLOOR_THICKNESS_FT/2, cz_ft);
				mesh.name = 'Scan Floor';
				addObjectToScene(mesh);
			}
			const t = 0.2;
			const y_ft = h_ft/2;
			{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, maxZ); mesh.name = 'Scan Wall N'; addObjectToScene(mesh); }
			{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, minZ); mesh.name = 'Scan Wall S'; addObjectToScene(mesh); }
			{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set(maxX, y_ft, cz_ft); mesh.name = 'Scan Wall E'; addObjectToScene(mesh); }
			{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set(minX, y_ft, cz_ft); mesh.name = 'Scan Wall W'; addObjectToScene(mesh); }
			// Cleanup
			if (manualScanPreview) { scene.remove(manualScanPreview); manualScanPreview = null; }
			manualScanStart = null;
			manualScanActive = false;
			controls.enabled = true;
			if (hud) hud.style.display = 'none';
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('pointermove', onMove, true);
			window.removeEventListener('pointerup', onUp, true);
		};
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('pointermove', onMove, true);
		window.addEventListener('pointerup', onUp, true);
	}

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
	// Touch double-tap tracking
	let lastTapAt = 0;
	let lastTapObj = null;
	// Mouse double-click fallback tracking
	let lastClickAt = 0;
	let lastClickObj = null;
	// Single selection display mode: 'gizmo' (default) or 'handles'
	let singleSelectionMode = 'gizmo';

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
			if (singleSelectionMode === 'handles'){
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
			} else {
				clearHandles();
				transformControls.attach(selectedObjects[0]);
				transformControlsRotate.attach(selectedObjects[0]);
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
		if (obj.name && (obj.name.startsWith('__') || obj.name.startsWith('Room Scan') || obj.name === 'Scan Point Cloud')) return true;
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
	window.addEventListener('keydown', e => {
		const isZ = (e.key === 'z' || e.key === 'Z');
		if (isZ && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			const tgt = e.target;
			const tag = tgt && tgt.tagName ? tgt.tagName.toLowerCase() : '';
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
		objects.forEach(obj=>{
			const div=document.createElement('div');
			const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=obj.visible; cb.addEventListener('change',()=>{ obj.visible=cb.checked; saveSessionDraftSoon(); });
			const span=document.createElement('span'); span.textContent=obj.name; span.style.flex='1'; span.style.cursor='pointer';
			if(selectedObjects.includes(obj)) span.style.background='#ffe066';
			span.addEventListener('dblclick',()=>{ const inp=document.createElement('input'); inp.type='text'; inp.value=obj.name; inp.style.flex='1'; inp.addEventListener('blur',()=>{obj.name=inp.value||obj.name;updateVisibilityUI(); saveSessionDraftSoon();}); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();}); div.replaceChild(inp,span); inp.focus(); });
			span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
			div.append(cb,span); objectList.append(div);
		});
	}

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
			if (!o.visible) { if (o.children && o.children.length) stack.push(...o.children); continue; }
			if (o.isMesh) cb(o);
			if (o.children && o.children.length) stack.push(...o.children);
		}
	}
	function ensureOriginalMaterial(mesh){ if (!__originalMaterials.has(mesh)) __originalMaterials.set(mesh, mesh.material); }

	// Texture/material caches (shared instances)
	let __cardboardMat = null; // final shared material (photo if available, else procedural)
	let __mdfMat = null;       // final shared material (photo if available, else procedural)

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
	function restoreOriginalMaterials(){ forEachMeshInScene(m=>{ const orig = __originalMaterials.get(m); if (orig) m.material = orig; }); }
	function applyUniformMaterial(sharedMat){ forEachMeshInScene(m=>{ ensureOriginalMaterial(m); m.material = sharedMat; }); }

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
	function getActiveSharedMaterial(style){
		if (style === 'cardboard') return __cardboardMat || null;
		if (style === 'mdf') return __mdfMat || null;
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
		return null;
	}
	function setMaterialButtons(style){
		if (matOriginalBtn) matOriginalBtn.setAttribute('aria-pressed', style==='original'?'true':'false');
		if (matCardboardBtn) matCardboardBtn.setAttribute('aria-pressed', style==='cardboard'?'true':'false');
		if (matMdfBtn) matMdfBtn.setAttribute('aria-pressed', style==='mdf'?'true':'false');
	}
	function applyMaterialStyle(style){
		style = style || 'original';
		currentMaterialStyle = style;
		// Persist selection
		try { localStorage.setItem('sketcher.materialStyle', style); } catch {}
		// Immediate path
		if (style === 'original') { restoreOriginalMaterials(); setMaterialButtons(style); return; }
		// Apply procedural immediately, then upgrade to photo when ready
		const proc = getProceduralSharedMaterial(style);
		applyUniformMaterial(proc);
		setMaterialButtons(style);
		// On narrow/mobile, skip photoreal upgrade to keep it light
		const isMobileNarrow = Math.min(window.innerWidth, window.innerHeight) <= 640;
		if (isMobileNarrow) return;
		// Kick off async load (debounced to one in-flight per style)
		const need = (style === 'cardboard' && (!__cardboardMat || __cardboardMat.userData?.procedural))
		         || (style === 'mdf' && (!__mdfMat || __mdfMat.userData?.procedural));
		if (!need) return;
		__materialLoadPromise = (async () => {
			const mat = await buildPhotoMaterial(style);
			if (mat && !mat.map) { try { mat.userData = { ...(mat.userData||{}), procedural: true }; } catch {} }
			if (style === 'cardboard') __cardboardMat = mat;
			if (style === 'mdf') __mdfMat = mat;
			if (currentMaterialStyle === style && mat) applyUniformMaterial(mat);
		})();
	}
	// Initialize selected material style from storage and wire buttons
	(function(){
		let saved = 'original';
		try { const s = localStorage.getItem('sketcher.materialStyle'); if (s) saved = s; } catch {}
		if (matOriginalBtn) matOriginalBtn.addEventListener('click', ()=> applyMaterialStyle('original'));
		if (matCardboardBtn) matCardboardBtn.addEventListener('click', ()=> applyMaterialStyle('cardboard'));
		if (matMdfBtn) matMdfBtn.addEventListener('click', ()=> applyMaterialStyle('mdf'));
		applyMaterialStyle(saved);
		setMaterialButtons(saved);
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
if (viewPerspectiveBtn) viewPerspectiveBtn.addEventListener('click', () => setCameraView('perspective'));
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
			const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]);
			const hits = raycaster.intersectObjects(selectableObjects, true);
			// If there is already a single selection, prioritize toggling it to handles
			if (selectedObjects.length === 1) {
				singleSelectionMode = 'handles';
				attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
				return;
			}
			// Otherwise, use the hit object (if any)
			if (hits.length){
				let obj = hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) { obj = obj.parent; }
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
		const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]);
		const hits = raycaster.intersectObjects(selectableObjects, true);
		if (hits.length){
			let obj = hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) { obj = obj.parent; }
			selectedObjects = [obj];
			singleSelectionMode = 'handles';
			attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI();
		}
	}, true);
	}
	if (viewAxonBtn) viewAxonBtn.addEventListener('click', () => setCameraView('axon'));
	if (viewPlanBtn) viewPlanBtn.addEventListener('click', () => setCameraView('plan'));
	if (viewNorthBtn) viewNorthBtn.addEventListener('click', () => setCameraView('north'));
	if (viewSouthBtn) viewSouthBtn.addEventListener('click', () => setCameraView('south'));
	if (viewEastBtn) viewEastBtn.addEventListener('click', () => setCameraView('east'));
	if (viewWestBtn) viewWestBtn.addEventListener('click', () => setCameraView('west'));

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
	}
	if (planLockBtn) {
		// Initialize from storage
		try { planViewLocked = localStorage.getItem('sketcher.planViewLocked') === '1'; } catch {}
		planLockBtn.addEventListener('click', () => {
			planViewLocked = !planViewLocked;
			applyPlanLockState();
			// If unlocking, restore normal perspective axes and rotation
			if (!planViewLocked) {
				try {
					cameraType = 'perspective';
					let persp = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 5000);
					persp.position.copy(camera.position);
					persp.up.set(0,1,0);
					persp.quaternion.copy(camera.quaternion);
					persp.updateMatrixWorld(); persp.updateProjectionMatrix();
					controls.object = persp;
					controls.update();
					tweenCamera(camera, persp, 450, () => { camera = persp; controls.object = camera; controls.update(); });
				} catch {}
			}
		});
		// Apply on startup
		applyPlanLockState();
	}

	// AR visibility
		if(mode==='ar') { arButton.style.display = 'block'; } else { arButton.style.display = 'none'; if(renderer.xr.isPresenting) renderer.xr.getSession().end(); }
		if (typeof applyAutoTouchMapping === 'function') applyAutoTouchMapping();
	});
	modeSelect.dispatchEvent(new Event('change'));

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
				const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local-floor'] });
				renderer.xr.setSession(session);
				arActive = true;
				arPlaced = false;
				grid.visible = false;
				// Setup hit test source and reference spaces for initial placement
				xrViewerSpace = await session.requestReferenceSpace('viewer');
				xrLocalSpace = await session.requestReferenceSpace('local-floor');
				xrHitTestSource = await session.requestHitTestSource({ space: xrViewerSpace });
				session.addEventListener('end', () => {
					arActive = false;
					grid.visible = true;
					if (arContent) { scene.remove(arContent); arContent = null; }
					arPlaced = false;
					if (xrHitTestSource && xrHitTestSource.cancel) { try { xrHitTestSource.cancel(); } catch {} }
					xrHitTestSource = null; xrViewerSpace = null; xrLocalSpace = null;
					// Return UI to Edit mode
					modeSelect.value = 'edit';
					modeSelect.dispatchEvent(new Event('change'));
				});
			} else if (isIOS) { await openQuickLookUSDZ(); } else { alert('AR not supported on this device or browser.'); }
		} catch (e) { alert('Failed to start AR: ' + (e?.message || e)); console.error(e); }
	});

	// Room Scan (beta) using WebXR hit-test to approximate room rectangle
	document.addEventListener('sketcher:startRoomScan', async () => {
		if (scanActive) return; // already running
		await loadWebXRPolyfillIfNeeded();
		const isSecure = window.isSecureContext || location.protocol === 'https:';
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
		// If insecure or on iOS (WebXR AR unavailable), use manual fallback
		if (!isSecure || isIOS) { startManualRoomScan(); return; }
		try {
			const xr = navigator.xr; if (!xr) throw new Error('WebXR not available');
			const supported = await xr.isSessionSupported('immersive-ar');
			if (!supported) { startManualRoomScan(); return; }
			scanSession = await xr.requestSession('immersive-ar', {
				requiredFeatures: ['local-floor', 'hit-test'],
				optionalFeatures: ['depth-sensing', 'plane-detection'],
				// Non-standard init dict for Chrome-based depth API (guarded at runtime)
				depthSensing: { preferredFormat: 'luminance-alpha', usagePreference: ['cpu-optimized'] }
			});
			renderer.xr.setSession(scanSession);
			scanActive = true;
			// Hide grid during scan
			if (grid) grid.visible = false;
			// Build preview group in meters
			scanGroup = new THREE.Group(); scanGroup.name = 'Room Scan Preview'; scene.add(scanGroup);
			// Reset extents
			scanExtents.minX = scanExtents.minZ = Infinity; scanExtents.maxX = scanExtents.maxZ = -Infinity;
			// Spaces + hit test
			scanViewerSpace = await scanSession.requestReferenceSpace('viewer');
			scanLocalSpace = await scanSession.requestReferenceSpace('local-floor');
			scanHitTestSource = await scanSession.requestHitTestSource({ space: scanViewerSpace });
			alert('Room Scan: move device to map the floor; tap once to finish.');
			const endScan = () => {
				if (!scanActive) return;
				scanActive = false;
				try { if (scanHitTestSource && scanHitTestSource.cancel) scanHitTestSource.cancel(); } catch {}
				scanHitTestSource = null; scanViewerSpace = null; scanLocalSpace = null;
				// Convert preview to scene objects in feet
				if (isFinite(scanExtents.minX) && isFinite(scanExtents.maxX) && isFinite(scanExtents.minZ) && isFinite(scanExtents.maxZ)) {
					const widthM = Math.max(0.2, scanExtents.maxX - scanExtents.minX);
					const depthM = Math.max(0.2, scanExtents.maxZ - scanExtents.minZ);
					const wallH_M = 2.4;
					// Floor
					{
						const thickness_ft = 0.2;
						const geo = new THREE.BoxGeometry(widthM * SCAN_M_TO_FT, thickness_ft, depthM * SCAN_M_TO_FT);
						const mesh = new THREE.Mesh(geo, material.clone());
						// Align the floor top surface to world Y=0 (level 0)
						const cx_ft = ((scanExtents.minX + scanExtents.maxX) / 2) * SCAN_M_TO_FT;
						const cz_ft = ((scanExtents.minZ + scanExtents.maxZ) / 2) * SCAN_M_TO_FT;
						mesh.position.set(cx_ft, -thickness_ft/2, cz_ft);
						mesh.name = 'Scan Floor';
						addObjectToScene(mesh);
					}
					// Walls (thin boxes along rectangle edges)
					const t = 0.2; // ~0.2 ft thickness
					const cx_ft = ((scanExtents.minX + scanExtents.maxX) / 2) * SCAN_M_TO_FT;
					const cz_ft = ((scanExtents.minZ + scanExtents.maxZ) / 2) * SCAN_M_TO_FT;
					const w_ft = (scanExtents.maxX - scanExtents.minX) * SCAN_M_TO_FT;
					const d_ft = (scanExtents.maxZ - scanExtents.minZ) * SCAN_M_TO_FT;
					const h_ft = wallH_M * SCAN_M_TO_FT;
					const y_ft = h_ft / 2;
					// North wall
					{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, (scanExtents.maxZ * SCAN_M_TO_FT)); mesh.name = 'Scan Wall N'; addObjectToScene(mesh); }
					// South wall
					{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, (scanExtents.minZ * SCAN_M_TO_FT)); mesh.name = 'Scan Wall S'; addObjectToScene(mesh); }
					// East wall
					{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set((scanExtents.maxX * SCAN_M_TO_FT), y_ft, cz_ft); mesh.name = 'Scan Wall E'; addObjectToScene(mesh); }
					// West wall
					{ const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set((scanExtents.minX * SCAN_M_TO_FT), y_ft, cz_ft); mesh.name = 'Scan Wall W'; addObjectToScene(mesh); }
				}
				// If we accumulated any depth points, add a point cloud in feet
				if (depthPointsAccum && depthPointsAccum.length) {
					const count = Math.min(depthPointsAccum.length, MAX_DEPTH_POINTS);
					const positions = new Float32Array(count * 3);
					for (let i = 0; i < count; i++) {
						const p = depthPointsAccum[i];
						positions[i*3+0] = p.x * SCAN_M_TO_FT;
						positions[i*3+1] = p.y * SCAN_M_TO_FT;
						positions[i*3+2] = p.z * SCAN_M_TO_FT;
					}
					const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
					const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x55ccff, size: 0.05 }));
					pts.name = 'Scan Point Cloud';
					addObjectToScene(pts);
				}
				// Cleanup preview
				if (scanGroup) { scene.remove(scanGroup); scanGroup = null; }
				depthPointsPreview = null; depthPointsAccum = []; depthSampleTick = 0;
				// Show grid again
				if (grid) grid.visible = true;
				// End session if still running
				try { const s = renderer.xr.getSession && renderer.xr.getSession(); if (s) s.end(); } catch {}
			};
			scanSession.addEventListener('end', endScan);
			scanSession.addEventListener('select', endScan);
		} catch (e) { alert('Failed to start Room Scan: ' + (e?.message || e)); console.error(e); }
	});

	// Upload model
	uploadBtn.addEventListener('click',()=>fileInput.click());
	fileInput.addEventListener('change',e=>{
		const file=e.target.files[0]; if(!file)return;
		const url=URL.createObjectURL(file);
		const loader=file.name.toLowerCase().endsWith('.obj')?new OBJLoader():new GLTFLoader();
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

	// Helpers
	function getPointer(e){const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;}
	function intersectGround(){const pt=new THREE.Vector3();raycaster.ray.intersectPlane(groundPlane,pt);return pt;}
	function intersectAtY(y){const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-y);const pt=new THREE.Vector3();return raycaster.ray.intersectPlane(plane,pt)?pt:null;}

	function updateCameraClipping(){ if (!objects.length) return; const box = new THREE.Box3(); objects.forEach(o => box.expandByObject(o)); if (box.isEmpty()) return; const size = new THREE.Vector3(); box.getSize(size); const radius = Math.max(size.x, size.y, size.z) * 0.75; const far = Math.min(100000, Math.max(1000, radius * 12)); camera.near = Math.max(0.01, far / 50000); camera.far = far; camera.updateProjectionMatrix(); if (controls){ controls.maxDistance = far * 0.95; } }
	function selectableTargets(){ return objects.flatMap(o => o.type === 'Group' ? [o, ...o.children] : [o]); }
	function addObjectToScene(obj, { select = false } = {}){
		scene.add(obj); objects.push(obj);
		// Apply current material style to this object (shared instance)
		if (currentMaterialStyle === 'cardboard' || currentMaterialStyle === 'mdf'){
			const shared = getActiveSharedMaterial(currentMaterialStyle) || getProceduralSharedMaterial(currentMaterialStyle);
			const stack = [obj];
			while (stack.length){
				const o = stack.pop();
				if (o.isMesh){ ensureOriginalMaterial(o); o.material = shared; }
				if (o.children && o.children.length) stack.push(...o.children);
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
			renderer.domElement.addEventListener('pointerdown',e=>{
		if (transformControls.dragging || transformControlsRotate.dragging) return;
		if (e.pointerType==='touch' || e.pointerType==='pen') { activeTouchPointers.add(e.pointerId); if(activeTouchPointers.size>1) return; }
			getPointer(e); raycaster.setFromCamera(pointer,camera);
			// For mouse, only left button; for touch/pen there is no buttons semantic like mouse
			if (e.pointerType === 'mouse' && e.button !== 0) return;
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
			const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]);
			const hits=raycaster.intersectObjects(selectableObjects,true);
			if(hits.length){
				let obj=hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) { obj = obj.parent; }
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
				if(mode==='edit' && start){ const dt = performance.now() - start.t; const dx = Math.abs(e.clientX - start.x); const dy = Math.abs(e.clientY - start.y); if(dt < 300 && dx < 8 && dy < 8){ getPointer(e); raycaster.setFromCamera(pointer,camera); const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]); const hits=raycaster.intersectObjects(selectableObjects,true); if(hits.length){ let obj=hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) obj = obj.parent; selectedObjects=[obj]; const now = performance.now(); const isDouble = (lastTapObj === obj) && (now - lastTapAt < 350); if (isDouble) { singleSelectionMode='handles'; lastTapAt = 0; lastTapObj = null; } else { singleSelectionMode='gizmo'; lastTapAt = now; lastTapObj = obj; } attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI(); } else { selectedObjects=[]; singleSelectionMode='gizmo'; transformControls.detach(); transformControlsRotate.detach(); clearHandles(); clearSelectionOutlines(); updateVisibilityUI(); lastTapAt = 0; lastTapObj = null; } } e.target.__tapStart = undefined; }
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

	// Draw-create preview
		renderer.domElement.addEventListener('pointermove',e=>{
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
		if(activeDrawTool==='box'){ previewMesh=new THREE.Mesh(new THREE.BoxGeometry(sx,h,sz), material.clone()); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
		else if(activeDrawTool==='sphere'){ previewMesh=new THREE.Mesh(new THREE.SphereGeometry(r,24,16), material.clone()); if(previewMesh) previewMesh.position.set(cx,cySphere,cz); }
		else if(activeDrawTool==='cylinder'){ previewMesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24), material.clone()); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
		else if(activeDrawTool==='cone'){ previewMesh=new THREE.Mesh(new THREE.ConeGeometry(r,h,24), material.clone()); if(previewMesh) previewMesh.position.set(cx,cyBox,cz); }
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

	// Primitives + utilities
	document.getElementById('addFloor').addEventListener('click',()=>{ const thickness=0.333;const floor=new THREE.Mesh(new THREE.BoxGeometry(10,thickness,10),material.clone()); floor.position.set(0,thickness/2,0);floor.name='Floor';addObjectToScene(floor,{ select:true }); });
	document.getElementById('addWall').addEventListener('click',()=>{ const thickness=0.333;const wall=new THREE.Mesh(new THREE.BoxGeometry(10,8,thickness),material.clone()); wall.position.set(0,4,-thickness/2);wall.name='Wall';addObjectToScene(wall,{ select:true }); });
	const addColumnBtn = document.getElementById('addColumn');
	const addBeamBtn = document.getElementById('addBeam');
	const addRampBtn = document.getElementById('addRamp');
	const addStairsBtn = document.getElementById('addStairs');
	const addRoofBtn = document.getElementById('addRoof');
	if(addColumnBtn) addColumnBtn.addEventListener('click', ()=>{ const radius=0.5, height=8; const geo=new THREE.CylinderGeometry(radius,radius,height,24); const col=new THREE.Mesh(geo, material.clone()); col.position.set(0, height/2, 0); col.name=`Column ${objects.filter(o=>o.name.startsWith('Column')).length+1}`; addObjectToScene(col,{ select:true }); });
	if(addBeamBtn) addBeamBtn.addEventListener('click', ()=>{ const len=12, depth=1, width=1; const beam=new THREE.Mesh(new THREE.BoxGeometry(len,depth,width), material.clone()); beam.position.set(0, 8, 0); beam.name=`Beam ${objects.filter(o=>o.name.startsWith('Beam')).length+1}`; addObjectToScene(beam,{ select:true }); });
	if(addRampBtn) addRampBtn.addEventListener('click', ()=>{ const len=10, thick=0.5, width=4; const ramp=new THREE.Mesh(new THREE.BoxGeometry(len, thick, width), material.clone()); ramp.rotation.x = THREE.MathUtils.degToRad(-15); ramp.position.set(0, 1, 0); ramp.name=`Ramp ${objects.filter(o=>o.name.startsWith('Ramp')).length+1}`; addObjectToScene(ramp,{ select:true }); });
	if(addStairsBtn) addStairsBtn.addEventListener('click', ()=>{ const steps=10, rise=0.7, tread=1, width=4; const grp=new THREE.Group(); for(let i=0;i<steps;i++){ const h=rise, d=tread, w=width; const step=new THREE.Mesh(new THREE.BoxGeometry(d,h,w), material.clone()); step.position.set(i*tread + d/2, (i+0.5)*rise, 0); grp.add(step); } grp.name=`Stairs ${objects.filter(o=>o.name.startsWith('Stairs')).length+1}`; addObjectToScene(grp,{ select:true }); });
	if(addRoofBtn) addRoofBtn.addEventListener('click', ()=>{ const w=12, d=10; const plane=new THREE.PlaneGeometry(w,d); plane.rotateX(-Math.PI/2); const roof=new THREE.Mesh(plane, material.clone()); roof.rotation.z = THREE.MathUtils.degToRad(30); roof.position.set(0, 10, 0); roof.name=`Roof Plane ${objects.filter(o=>o.name.startsWith('Roof Plane')).length+1}`; addObjectToScene(roof,{ select:true }); });

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
	window.addEventListener('resize',()=>{ camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth,window.innerHeight); });
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
			if (scanActive) {
				// Accumulate floor hit-test points and update preview
				const session = renderer.xr.getSession && renderer.xr.getSession();
				if (session && scanHitTestSource && frame && scanLocalSpace) {
					const results = frame.getHitTestResults(scanHitTestSource);
					if (results && results.length) {
						const pose = results[0].getPose(scanLocalSpace);
						if (pose) {
							const px = pose.transform.position.x; const pz = pose.transform.position.z;
							scanExtents.minX = Math.min(scanExtents.minX, px);
							scanExtents.maxX = Math.max(scanExtents.maxX, px);
							scanExtents.minZ = Math.min(scanExtents.minZ, pz);
							scanExtents.maxZ = Math.max(scanExtents.maxZ, pz);
							// Update preview geometry
							if (isFinite(scanExtents.minX) && isFinite(scanExtents.maxX) && isFinite(scanExtents.minZ) && isFinite(scanExtents.maxZ)) {
								const w = Math.max(0.1, scanExtents.maxX - scanExtents.minX);
								const d = Math.max(0.1, scanExtents.maxZ - scanExtents.minZ);
								const cx = (scanExtents.minX + scanExtents.maxX) / 2;
								const cz = (scanExtents.minZ + scanExtents.maxZ) / 2;
								// Clear and rebuild simple preview (thin floor + low outline walls)
								scanGroup.clear();
								const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), new THREE.MeshBasicMaterial({ color: 0x00ff88, opacity: 0.25, transparent: true }));
								floor.position.set(cx, 0.01, cz);
								scanGroup.add(floor);
								const wallH = 0.5; const t = 0.02; // low preview walls
								const n = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); n.position.set(cx, wallH/2, scanExtents.maxZ); scanGroup.add(n);
								const s = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); s.position.set(cx, wallH/2, scanExtents.minZ); scanGroup.add(s);
								const e = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); e.position.set(scanExtents.maxX, wallH/2, cz); scanGroup.add(e);
								const wMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); wMesh.position.set(scanExtents.minX, wallH/2, cz); scanGroup.add(wMesh);
							}
						}
					}
					// Sample WebXR depth information if available (Chrome/Android). Guard everything.
					try {
						const xrCam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
						const dm = frame && frame.getDepthInformation && xrCam ? frame.getDepthInformation(xrCam) : null;
						if (dm) {
							if ((depthSampleTick++ % 3) === 0 && depthPointsAccum.length < MAX_DEPTH_POINTS) {
								const width = dm.width, height = dm.height;
								const stepX = Math.max(1, Math.floor(width / 64));
								const stepY = Math.max(1, Math.floor(height / 64));
								for (let y = 0; y < height && depthPointsAccum.length < MAX_DEPTH_POINTS; y += stepY) {
									for (let x = 0; x < width && depthPointsAccum.length < MAX_DEPTH_POINTS; x += stepX) {
										const z = dm.getDepth(x, y);
										if (!isFinite(z) || z <= 0) continue;
										// Project ray from camera through NDC, place a point at depth z (meters)
										const ndcX = (x / width) * 2 - 1;
										const ndcY = (y / height) * -2 + 1;
										const ndc = new THREE.Vector3(ndcX, ndcY, 1);
										ndc.unproject(camera);
										const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
										const dir = ndc.sub(camPos).normalize();
										const pWorld = camPos.clone().addScaledVector(dir, z);
										depthPointsAccum.push(pWorld);
									}
								}
								// Live point cloud preview (meters)
								if (scanGroup) {
									if (!depthPointsPreview) {
										depthPointsPreview = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x55ccff, size: 0.01 }));
										scanGroup.add(depthPointsPreview);
									}
									const n = Math.min(depthPointsAccum.length, MAX_DEPTH_POINTS);
									const arr = new Float32Array(n * 3);
									for (let i = 0; i < n; i++) { const p = depthPointsAccum[i]; arr[i*3] = p.x; arr[i*3+1] = p.y; arr[i*3+2] = p.z; }
									depthPointsPreview.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
									depthPointsPreview.geometry.computeBoundingSphere();
								}
							}
						}
					} catch {}
				}
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
							arPlaced = true;
							if (xrHitTestSource && xrHitTestSource.cancel) { try { xrHitTestSource.cancel(); } catch {} }
							xrHitTestSource = null;
						}
					}
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
			const toCol = document.getElementById('toColumbarium');
			if (toCol) {
				toCol.addEventListener('click', () => {
					try {
						const json = serializeScene();
						sessionStorage.setItem('sketcher:sessionDraft', JSON.stringify({ json }));
					} catch {}
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
}

