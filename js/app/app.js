// Main application entry extracted from index.html
// Exports an init function executed by index.html

export async function init() {
	// Helper for smooth camera transition
	function tweenCamera(fromCam, toCam, duration = 600, onComplete) {
		const start = {
			position: fromCam.position.clone(),
			up: fromCam.up.clone(),
			target: controls.target.clone(),
		};
		const end = {
			position: toCam.position.clone(),
			up: toCam.up.clone(),
			target: controls.target.clone(),
		};
		let startTime = performance.now();
		function animate() {
			let t = Math.min(1, (performance.now() - startTime) / duration);
			fromCam.position.lerpVectors(start.position, end.position, t);
			fromCam.up.lerpVectors(start.up, end.up, t);
			controls.target.lerpVectors(start.target, end.target, t);
			fromCam.lookAt(controls.target);
			fromCam.updateProjectionMatrix();
			controls.update();
			if (t < 1) {
				requestAnimationFrame(animate);
			} else if (onComplete) {
				onComplete();
			}
		}
		animate();
	}
		const [THREE, { GLTFLoader }, { OBJLoader }, { OrbitControls }, { TransformControls }, { OBJExporter }, { setupMapImport }, outlines, transforms, localStore] = await Promise.all([
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
			if (el && !el.textContent) el.textContent = 'v1.0.0';
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
	let arContent = null; // cloned scene content for AR
	let arPlaced = false;
	let xrHitTestSource = null;
	let xrViewerSpace = null;
	let xrLocalSpace = null;

	// Grid & lights
	const GRID_SIZE = 20;
	const GRID_DIVS = 20;
	let grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, 0xffffff, 0xffffff);
	grid.receiveShadow = true; scene.add(grid);
	try {
	  if (Array.isArray(grid.material)) grid.material.forEach(m => { if (m) m.depthWrite = false; });
	  else if (grid.material) grid.material.depthWrite = false;
	} catch {}
	scene.add(new THREE.AmbientLight(0xffffff,0.5));
	const dirLight=new THREE.DirectionalLight(0xffffff,0.8); dirLight.position.set(5,10,7); dirLight.castShadow=true; scene.add(dirLight);

	// Controls + gizmos
	const controls=new OrbitControls(camera,renderer.domElement);
	controls.enableDamping=true; controls.dampingFactor=0.085;
	controls.enablePan=true; controls.enableZoom=true; controls.enableRotate=true;
	controls.rotateSpeed = 0.9; controls.zoomSpeed = 0.95; controls.panSpeed = 0.9;
	controls.mouseButtons={LEFT:THREE.MOUSE.NONE,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.PAN};
	controls.touches = { ONE: THREE.TOUCH.NONE, TWO: THREE.TOUCH.DOLLY_PAN };
	window.addEventListener('keydown',e=>{if(e.key==='Shift')controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;});
	window.addEventListener('keyup',  e=>{if(e.key==='Shift')controls.mouseButtons.MIDDLE=THREE.MOUSE.ROTATE;});
	const transformControls=new TransformControls(camera,renderer.domElement);
	transformControls.setMode('translate'); transformControls.setTranslationSnap(0.1);
	transformControls.addEventListener('dragging-changed',e=>controls.enabled=!e.value); scene.add(transformControls);
	const transformControlsRotate=new TransformControls(camera,renderer.domElement);
	transformControlsRotate.setMode('rotate'); transformControlsRotate.setRotationSnap(THREE.MathUtils.degToRad(15));
	transformControlsRotate.addEventListener('dragging-changed',e=>controls.enabled=!e.value); scene.add(transformControlsRotate);
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
	const objects=[];
	const material=new THREE.MeshNormalMaterial({side:THREE.DoubleSide});
	let loadedModel=null;
	let selectionOutlines = [];
	let selectedObjects = [];

	// Outline helpers
	function clearSelectionOutlines(){ selectionOutlines = outlines.clearSelectionOutlines(scene, selectionOutlines); }
	function rebuildSelectionOutlines(){ selectionOutlines = outlines.clearSelectionOutlines(scene, selectionOutlines); selectionOutlines = outlines.rebuildSelectionOutlines(THREE, scene, selectedObjects); }

	const getWorldMatrix = transforms.getWorldMatrix; const setWorldMatrix = transforms.setWorldMatrix;
	function updateMultiSelectPivot(){
		if(selectedObjects.length < 2) return;
		const center = new THREE.Vector3(); const tmp = new THREE.Vector3();
		selectedObjects.forEach(o=>{ o.updateMatrixWorld(); tmp.setFromMatrixPosition(o.matrixWorld); center.add(tmp); });
		center.multiplyScalar(1/selectedObjects.length);
		setWorldMatrix(multiSelectPivot, new THREE.Matrix4().compose(center, new THREE.Quaternion(), new THREE.Vector3(1,1,1)));
	}
	function attachTransformForSelection(){
		if(mode !== 'edit') { transformControls.detach(); transformControlsRotate.detach(); return; }
		if(selectedObjects.length === 1){ const target = selectedObjects[0]; transformControls.attach(target); transformControlsRotate.attach(target); enableTranslateGizmo(); enableRotateGizmo(); }
		else if(selectedObjects.length >= 2){ updateMultiSelectPivot(); transformControls.attach(multiSelectPivot); transformControlsRotate.attach(multiSelectPivot); enableTranslateGizmo(); enableRotateGizmo(); }
		else { transformControls.detach(); transformControlsRotate.detach(); }
	}
	function captureMultiStart(){ multiStartPivotMatrix = getWorldMatrix(multiSelectPivot); multiStartMatrices.clear(); selectedObjects.forEach(o=> multiStartMatrices.set(o, getWorldMatrix(o))); }
	function applyMultiDelta(){ if(selectedObjects.length<2) return; const currentPivot=getWorldMatrix(multiSelectPivot); const invStart=multiStartPivotMatrix.clone().invert(); const delta=new THREE.Matrix4().multiplyMatrices(currentPivot,invStart); selectedObjects.forEach(o=>{ const start=multiStartMatrices.get(o); if(!start) return; const newWorld=new THREE.Matrix4().multiplyMatrices(delta,start); setWorldMatrix(o,newWorld); }); }
	transformControls.addEventListener('dragging-changed', e => { if(e.value && transformControls.object===multiSelectPivot) captureMultiStart(); });
	transformControls.addEventListener('objectChange', () => { if(transformControls.object===multiSelectPivot) applyMultiDelta(); });
	transformControlsRotate.addEventListener('dragging-changed', e => { if(e.value && transformControlsRotate.object===multiSelectPivot) captureMultiStart(); });
	transformControlsRotate.addEventListener('objectChange', () => { if(transformControlsRotate.object===multiSelectPivot) applyMultiDelta(); });

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
	// Scenes UI
	const saveSceneBtn = document.getElementById('saveScene');
	const openScenesBtn = document.getElementById('openScenes');
	const scenesDrawer = document.getElementById('scenesDrawer');
	const scenesList = document.getElementById('scenesList');
	// Track the currently loaded/saved scene so we can overwrite on Save
	let currentSceneId = null;
	let currentSceneName = '';

	// Visibility UI
	function updateVisibilityUI(){
		objectList.innerHTML='';
		objects.forEach(obj=>{
			const div=document.createElement('div');
			const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=obj.visible; cb.addEventListener('change',()=>obj.visible=cb.checked);
			const span=document.createElement('span'); span.textContent=obj.name; span.style.flex='1'; span.style.cursor='pointer';
			if(selectedObjects.includes(obj)) span.style.background='#ffe066';
			span.addEventListener('dblclick',()=>{ const inp=document.createElement('input'); inp.type='text'; inp.value=obj.name; inp.style.flex='1'; inp.addEventListener('blur',()=>{obj.name=inp.value||obj.name;updateVisibilityUI();}); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();}); div.replaceChild(inp,span); inp.focus(); });
			span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
			div.append(cb,span); objectList.append(div);
		});
	}

	// Settings: background and grid colors (with persistence)
	function disposeGrid(g){
		try { g.geometry && g.geometry.dispose && g.geometry.dispose(); } catch {}
		try {
			if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose());
			else g.material && g.material.dispose && g.material.dispose();
		} catch {}
	}
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
		grid.visible = wasVisible;
		scene.add(grid);
	}
	// Apply saved or default colors on startup
	try {
		const savedBg = localStorage.getItem('sketcher.bgColor');
		const bg = savedBg || (bgColorPicker ? bgColorPicker.value : '#1e1e1e');
		renderer.setClearColor(bg);
		if (bgColorPicker && savedBg) bgColorPicker.value = savedBg;
		const savedGrid = localStorage.getItem('sketcher.gridColor');
		if (gridColorPicker && savedGrid) gridColorPicker.value = savedGrid;
		if (savedGrid) setGridColor(savedGrid); else if (gridColorPicker) setGridColor(gridColorPicker.value || '#ffffff');
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
					up = new THREE.Vector3(0,1,0); // match axon navigation axis
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
		if (cameraType === 'orthographic') {
			cameraType = 'perspective';
			let perspCamera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 5000);
			perspCamera.position.copy(camera.position);
			perspCamera.up.copy(camera.up);
			perspCamera.quaternion.copy(camera.quaternion);
			perspCamera.updateMatrixWorld();
			perspCamera.updateProjectionMatrix();
			controls.object = perspCamera;
			controls.target.copy(controls.target);
			controls.update();
			tweenCamera(camera, perspCamera, 600, () => { camera = perspCamera; controls.object = camera; controls.update(); });
		}
	});
	}
	if (viewAxonBtn) viewAxonBtn.addEventListener('click', () => setCameraView('axon'));
	if (viewPlanBtn) viewPlanBtn.addEventListener('click', () => setCameraView('plan'));
	if (viewNorthBtn) viewNorthBtn.addEventListener('click', () => setCameraView('north'));
	if (viewSouthBtn) viewSouthBtn.addEventListener('click', () => setCameraView('south'));
	if (viewEastBtn) viewEastBtn.addEventListener('click', () => setCameraView('east'));
	if (viewWestBtn) viewWestBtn.addEventListener('click', () => setCameraView('west'));

	// AR visibility
		if(mode==='ar') { arButton.style.display = 'block'; } else { arButton.style.display = 'none'; if(renderer.xr.isPresenting) renderer.xr.getSession().end(); }
		if (typeof applyAutoTouchMapping === 'function') applyAutoTouchMapping();
	});
	modeSelect.dispatchEvent(new Event('change'));

	// Export logic for toolbox popup
	function buildExportRootFromObjects(objs){ const root = new THREE.Group(); objs.forEach(o => root.add(o.clone(true))); return root; }
	function prepareModelForAR(root){ root.traverse((obj)=>{ if(obj.isMesh){ const oldMat=obj.material; let color=0xcccccc; if(oldMat){ if(Array.isArray(oldMat)){ obj.material = oldMat.map(m => new THREE.MeshStandardMaterial({ color: (m.color && m.color.getHex) ? m.color.getHex() : color, metalness: 0, roughness: 0.8 })); } else { if (oldMat.color && oldMat.color.getHex) color = oldMat.color.getHex(); obj.material = new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.8 }); } } else { obj.material = new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.8 }); } } }); root.updateMatrixWorld(true); const box=new THREE.Box3().setFromObject(root); const center=new THREE.Vector3(); box.getCenter(center); const translate=new THREE.Vector3(center.x, box.min.y, center.z); root.position.sub(translate); const FEET_TO_METERS=0.3048; root.scale.setScalar(FEET_TO_METERS); root.updateMatrixWorld(true); }
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
		if (!isSecure) { alert('Room Scan requires HTTPS.'); return; }
		try {
			const xr = navigator.xr; if (!xr) throw new Error('WebXR not available');
			const supported = await xr.isSessionSupported('immersive-ar');
			if (!supported) { alert('Room Scan not supported on this device/browser.'); return; }
			scanSession = await xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor', 'hit-test'] });
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
				// Cleanup preview
				if (scanGroup) { scene.remove(scanGroup); scanGroup = null; }
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
		if (e.key === 'Escape' && loadedModel) {
			loadedModel = null;
			if (fileInput) fileInput.value = '';
			if (placingPopup) placingPopup.style.display = 'none';
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
	function addObjectToScene(obj, { select = false } = {}){ scene.add(obj); objects.push(obj); updateVisibilityUI(); updateCameraClipping(); if (select){ selectedObjects = [obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } }

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
	let activeDrawTool=null; let isDragging=false; let startPt=new THREE.Vector3(); let previewMesh=null;
	const dcBoxBtn=document.getElementById('dcBox'); const dcSphereBtn=document.getElementById('dcSphere'); const dcCylinderBtn=document.getElementById('dcCylinder'); const dcConeBtn=document.getElementById('dcCone');
	function armDrawTool(kind){ activeDrawTool=kind; if(toggleDrawCreateBtn && drawCreateGroup){ if(toggleDrawCreateBtn.getAttribute('aria-pressed')!=='true'){ toggleDrawCreateBtn.click(); } } [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed', String(btn && btn.id==='dc'+kind.charAt(0).toUpperCase()+kind.slice(1))); }); }
	if(dcBoxBtn) dcBoxBtn.addEventListener('click',()=>armDrawTool('box'));
	if(dcSphereBtn) dcSphereBtn.addEventListener('click',()=>armDrawTool('sphere'));
	if(dcCylinderBtn) dcCylinderBtn.addEventListener('click',()=>armDrawTool('cylinder'));
	if(dcConeBtn) dcConeBtn.addEventListener('click',()=>armDrawTool('cone'));
	renderer.domElement.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
	const activeTouchPointers = new Set();
	renderer.domElement.addEventListener('pointerup', e => { if(e.pointerType==='touch') activeTouchPointers.delete(e.pointerId); });
	renderer.domElement.addEventListener('pointercancel', e => { if(e.pointerType==='touch') activeTouchPointers.delete(e.pointerId); });
	const SURFACE_EPS = 0.01;
		renderer.domElement.addEventListener('pointerdown',e=>{
		if (transformControls.dragging || transformControlsRotate.dragging) return;
		if (e.pointerType==='touch') { activeTouchPointers.add(e.pointerId); if(activeTouchPointers.size>1) return; }
		getPointer(e); raycaster.setFromCamera(pointer,camera); if(e.button!==0)return;
			const importPanelOpen = importGroup && importGroup.classList.contains('open');
			if((mode==='import' || importPanelOpen) && loadedModel){
				const hits=raycaster.intersectObjects(selectableTargets(),true);
				let dropPoint = null;
				if (hits.length) dropPoint = hits[0].point.clone().add(new THREE.Vector3(0, SURFACE_EPS, 0));
				else dropPoint = intersectGround();
				if(!dropPoint) return;
				const clone=loadedModel.clone();
				clone.position.copy(dropPoint);
				addObjectToScene(clone);
				// single placement complete
				loadedModel = null;
				if (fileInput) fileInput.value = '';
				if (placingPopup) placingPopup.style.display = 'none';
			}
		else if(mode==='edit'){
			if (activeDrawTool){ const hits=raycaster.intersectObjects(selectableTargets(),true); const baseY = hits.length ? hits[0].point.y : 0; const pt = intersectAtY(baseY) || intersectGround(); if(!pt) return; isDragging=true; startPt.copy(pt); controls.enabled=false; return; }
			if(e.pointerType==='touch'){ e.target.__tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
			const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]);
			const hits=raycaster.intersectObjects(selectableObjects,true);
			if(hits.length){ let obj=hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) { obj = obj.parent; } if(e.shiftKey||e.ctrlKey||e.metaKey){ if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); }
			else { transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines(); selectedObjects=[]; updateVisibilityUI(); }
		} else { transformControls.detach(); transformControlsRotate.detach(); }
	});
	renderer.domElement.addEventListener('pointerup', e => {
		if(e.pointerType==='touch'){
			const start = e.target.__tapStart; activeTouchPointers.delete(e.pointerId);
			if(mode==='edit' && start){ const dt = performance.now() - start.t; const dx = Math.abs(e.clientX - start.x); const dy = Math.abs(e.clientY - start.y); if(dt < 300 && dx < 8 && dy < 8){ getPointer(e); raycaster.setFromCamera(pointer,camera); const selectableObjects = objects.flatMap(obj => obj.type === 'Group' ? [obj, ...obj.children] : [obj]); const hits=raycaster.intersectObjects(selectableObjects,true); if(hits.length){ let obj=hits[0].object; while(obj.parent && obj.parent.type === 'Group' && objects.includes(obj.parent)) obj = obj.parent; selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI(); } else { transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines(); selectedObjects=[]; updateVisibilityUI(); } } e.target.__tapStart = undefined; }
		}
	});

	// Grouping logic for toolbox button
	function handleGroupSelected() {
		if(selectedObjects.length<2) return;
		const center = new THREE.Vector3(); selectedObjects.forEach(obj => { obj.updateMatrixWorld(); const pos = new THREE.Vector3(); pos.setFromMatrixPosition(obj.matrixWorld); center.add(pos); }); center.multiplyScalar(1 / selectedObjects.length);
		selectedObjects.forEach(obj=>{ scene.remove(obj); const idx=objects.indexOf(obj); if(idx>-1) objects.splice(idx,1); });
		const group=new THREE.Group(); group.position.copy(center);
		selectedObjects.forEach(obj=>{ obj.updateMatrixWorld(); const worldPos = new THREE.Vector3(); worldPos.setFromMatrixPosition(obj.matrixWorld); obj.position.copy(worldPos.sub(center)); group.add(obj); });
		group.name='Group '+(objects.filter(o=>o.type==='Group').length+1);
		scene.add(group); objects.push(group); selectedObjects=[group]; attachTransformForSelection(); rebuildSelectionOutlines(); updateVisibilityUI(); updateCameraClipping();
	}

	// Draw-create preview
	renderer.domElement.addEventListener('pointermove',e=>{
		if(!isDragging||!activeDrawTool) return; getPointer(e); raycaster.setFromCamera(pointer,camera);
		const pt=intersectGround(); if(!pt) return; const dx=pt.x-startPt.x, dz=pt.z-startPt.z; const sx=Math.max(0.1,Math.abs(dx)), sz=Math.max(0.1,Math.abs(dz));
		const r=Math.max(sx,sz)/2; const h=1; const cx=startPt.x+dx/2, cz=startPt.z+dz/2, cy=h/2+Math.min(startPt.y,pt.y);
		if(previewMesh){ scene.remove(previewMesh); if(previewMesh.geometry) previewMesh.geometry.dispose(); if(previewMesh.material&&previewMesh.material.dispose) previewMesh.material.dispose(); previewMesh=null; }
		if(activeDrawTool==='box'){ previewMesh=new THREE.Mesh(new THREE.BoxGeometry(sx,h,sz), material.clone()); }
		else if(activeDrawTool==='sphere'){ previewMesh=new THREE.Mesh(new THREE.SphereGeometry(r,24,16), material.clone()); }
		else if(activeDrawTool==='cylinder'){ previewMesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24), material.clone()); }
		else if(activeDrawTool==='cone'){ previewMesh=new THREE.Mesh(new THREE.ConeGeometry(r,h,24), material.clone()); }
		if(previewMesh){ previewMesh.position.set(cx,cy,cz); scene.add(previewMesh); }
	});
	window.addEventListener('pointerup',e=>{ if(e.button!==0) return; if(!isDragging||!activeDrawTool) return; isDragging=false; controls.enabled=true; if(previewMesh){ const placed=previewMesh; previewMesh=null; placed.name=`${activeDrawTool[0].toUpperCase()}${activeDrawTool.slice(1)} ${objects.length+1}`; addObjectToScene(placed,{ select:true }); } activeDrawTool=null; [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed','false'); }); });
	window.addEventListener('keydown',e=>{ if(e.key==='Escape' && activeDrawTool){ activeDrawTool=null; if(isDragging){ isDragging=false; controls.enabled=true; } if(previewMesh){ scene.remove(previewMesh); if(previewMesh.geometry) previewMesh.geometry.dispose(); if(previewMesh.material&&previewMesh.material.dispose) previewMesh.material.dispose(); previewMesh=null; } [dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed','false'); }); } });

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
			}
		} else {
			const sel=transformControls.object;
			if(sel){
				const box=new THREE.Box3().setFromObject(sel);
				const minY=box.min.y;
				sel.position.y-=minY;
			}
		}
	}
	// Delete
	window.addEventListener('keydown',e=>{ if(mode==='edit'&&(e.key==='Delete'||e.key==='Backspace')){ const toDelete = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []); toDelete.forEach(sel=>{ scene.remove(sel); const idx=objects.indexOf(sel); if(idx>-1)objects.splice(idx,1); }); selectedObjects = []; transformControls.detach(); clearSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); } });

	// Keep outlines syncing
	transformControls.addEventListener('objectChange', () => { rebuildSelectionOutlines(); });
	transformControlsRotate.addEventListener('objectChange', () => { rebuildSelectionOutlines(); });

	// Animation
	window.addEventListener('resize',()=>{ camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth,window.innerHeight); });
	renderer.setAnimationLoop((t, frame) => {
		try {
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
			const banner = document.getElementById('error-banner'); if (banner) banner.style.display = 'none';
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
		updateCameraClipping();
	});
	const addScaleFigureBtn = document.getElementById('addScaleFigure'); if (addScaleFigureBtn) addScaleFigureBtn.addEventListener('click', ()=>{ const grp = new THREE.Group(); const mat = material.clone(); const legH=2.5, legR=0.25, legX=0.35; const torsoH=2.5, torsoRTop=0.5, torsoRBot=0.6; const headR=0.5; const legGeo = new THREE.CylinderGeometry(legR, legR, legH, 16); const leftLeg = new THREE.Mesh(legGeo, mat.clone()); leftLeg.position.set(-legX, legH/2, 0); const rightLeg = new THREE.Mesh(legGeo.clone(), mat.clone()); rightLeg.position.set(legX, legH/2, 0); grp.add(leftLeg, rightLeg); const torsoGeo = new THREE.CylinderGeometry(torsoRTop, torsoRBot, torsoH, 24); const torso = new THREE.Mesh(torsoGeo, mat.clone()); torso.position.set(0, legH + torsoH/2, 0); grp.add(torso); const headGeo = new THREE.SphereGeometry(headR, 24, 16); const head = new THREE.Mesh(headGeo, mat.clone()); head.position.set(0, legH + torsoH + headR, 0); grp.add(head); grp.name = `Scale Figure 6ft ${objects.filter(o=>o.name && o.name.startsWith('Scale Figure 6ft')).length + 1}`; addObjectToScene(grp, { select: true }); });

	// Local scenes: serialize, save, list, load, delete
	function serializeScene() {
		// Build a root group of current objects and use Object3D.toJSON
		const root = buildExportRootFromObjects(objects);
		return root.toJSON();
	}
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
					(root.children||[]).forEach(child => { addObjectToScene(child, { select:false }); });
					updateCameraClipping();
					// Track current scene for overwrite on Save
					currentSceneId = id;
					currentSceneName = name || 'Untitled';
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
				await localStore.saveScene({ name, json });
				// After saving, do not update currentSceneId/currentSceneName (always a new scene)
				if (scenesDrawer && scenesDrawer.classList.contains('open')) refreshScenesList();
				alert('Saved');
			} catch(e){ alert('Save failed'); console.error(e); }
		});
	}

	// Map Import wiring
	setupMapImport({ THREE, renderer, fallbackMaterial: material, addObjectToScene, elements: { backdrop: mapBackdrop, container: mapContainer, searchInput: mapSearchInput, searchBtn: mapSearchBtn, closeBtn: mapCloseBtn, useFlatBtn: mapUseFlatBtn, useTopoBtn: mapUseTopoBtn, drawToggleBtn: mapDrawToggle, importBtn: mapImportBtn } });

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
					(root.children||[]).forEach(child => { addObjectToScene(child, { select:false }); });
					updateCameraClipping();
					currentSceneId = rec.id; currentSceneName = rec.name || 'Untitled';
				}
			}
		} catch {}
	})();
}

