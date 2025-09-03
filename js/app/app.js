// Main application entry extracted from index.html
// Exports an init function executed by index.html

export async function init() {
	// Delegate tweenCamera to views.js while keeping the same call shape
	function tweenCamera(fromCam, toCam, duration = 600, onComplete) {
		return views.tweenCamera(fromCam, toCam, controls, duration, onComplete);
	}
		const [THREE, { GLTFLoader }, { OBJLoader }, { OrbitControls }, { TransformControls }, { OBJExporter }, { setupMapImport }, outlines, transforms, localStore, persistence, snapping, views, gridUtils, arExport, { createSnapVisuals }, { createSessionDraft }, primitives, { createAREdit }, { createXRHud }, { simplifyMaterialsForARInPlace, restoreMaterialsForARInPlace, applyOutlineModeForARInPlace, clearOutlineModeForAR }, { createCollab }, { createAlignmentTile }] = await Promise.all([
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
			import('./services/xr-hud.js'),
			import('./services/ar-materials.js'),
			import('./services/collab.js'),
			import('./features/alignment-tile.js'),
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

	// Inject Room parent toggle and group into the toolbox DOM (buttons wired later)
	(function ensureRoomToolboxDOM(){
		try {
			const tb = document.getElementById('toolbox'); if (!tb) return;
			if (document.getElementById('toggleRoom')) return; // already added
			const btn = document.createElement('button');
			btn.id = 'toggleRoom'; btn.className = 'icon-btn toggle-btn';
			btn.title = 'Room'; btn.setAttribute('aria-label','Room'); btn.setAttribute('aria-pressed','false');
			btn.innerHTML = '<span class="sr-only">Room</span><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#222" stroke-width="2"><circle cx="12" cy="7" r="3"/><path d="M4 20c0-3 3-5 8-5s8 2 8 5"/></g></svg>';
			tb.appendChild(btn);
			const group = document.createElement('div');
			group.id = 'roomGroup'; group.className = 'collapse'; group.setAttribute('aria-hidden','true');
			group.innerHTML = '<button id="hostRoom" class="icon-btn" title="Host Room" aria-label="Host Room">Host Room</button>\
			<button id="joinRoom" class="icon-btn" title="Join Room" aria-label="Join Room">Join Room</button>';
			tb.appendChild(group);
		} catch {}
	})();

	// Global error banner to surface runtime failures
	(function setupErrorBanner(){
		function show(msg){
			try {
				const el = document.getElementById('error-banner');
				if (!el) return;
				el.textContent = String(msg || 'Error');
				el.style.display = 'block';
			} catch {}
		}
		window.addEventListener('error', (e) => {
			const m = e && (e.message || (e.error && e.error.message)) || 'Script error';
			show(m);
		});
		window.addEventListener('unhandledrejection', (e) => {
			const reason = e && e.reason;
			const m = (reason && (reason.message || reason.stack || String(reason))) || 'Unhandled promise rejection';
			show(m);
		});
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
	const renderer = new THREE.WebGLRenderer({ antialias:true, logarithmicDepthBuffer: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	// Prefer VisualViewport for accurate iOS dynamic viewport sizing
	const vv = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport : null;
	const sizeW = vv ? Math.round(vv.width) : window.innerWidth;
	const sizeH = vv ? Math.round(vv.height) : window.innerHeight;
	renderer.setSize(sizeW, sizeH);
	renderer.shadowMap.enabled = true;
	try { renderer.shadowMap.type = THREE.PCFSoftShadowMap; } catch {}
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
	// XR visual quality/perf tuning for Meta Quest
	try {
		renderer.physicallyCorrectLights = true;
		if (THREE && THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
		if (THREE && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
	// Slight foveation improves perf on Quest; 0 = full res center, 1 = aggressive peripheral reduction
		if (renderer.xr && typeof renderer.xr.setFoveation === 'function') renderer.xr.setFoveation(0.5);
	// Keep default framebuffer scale factor at 1.0; raise carefully if you need sharper visuals
	if (renderer.xr && typeof renderer.xr.setFramebufferScaleFactor === 'function') renderer.xr.setFramebufferScaleFactor(1.0);
	} catch {}
	let arActive = false;
	// Room Scan is now provided by a service module
	let arContent = null; // cloned scene content for AR
	let arPlaced = false;
	let arPrevVisibility = null; // Map(object -> prevVisible) to restore after AR
	let arPendingTeleport = null; // Vector3 meters (xz on local-floor) to apply on first AR placement
	const FEET_TO_METERS = 0.3048;
	// Optional visual scale debug: enable by adding '#scaleDebug' to the URL or set localStorage 'sketcher.scaleDebug' = '1'
	const ENABLE_SCALE_DEBUG = (typeof location !== 'undefined' && location.hash && location.hash.includes('scaleDebug')) || (typeof localStorage !== 'undefined' && localStorage.getItem && localStorage.getItem('sketcher.scaleDebug') === '1');
	let __scaleDebugGroup = null;
	let xrHitTestSource = null;
	let xrViewerSpace = null;
	let xrLocalSpace = null;
	// Track grab transitions per XR input source for haptics and statefulness
	const xrGrabState = new WeakMap();
	// AR scale helpers and XR HUD (3D ray-interactive)
	let xrHud3D = null; // THREE.Group
	let xrHudButtons = []; // [{ mesh, onClick }]
	// XR HUD service instance
	let arOneToOne = true; // last chosen scale mode
	let arBaseBox = null;  // Box3 in meters after prepareModelForAR
	let arBaseDiagonal = 1; // meters
	let arFitMaxDim = 1.6; // meters target for Fit
		let arSimplifyMaterials = false; // AR performance mode toggle
		let arMatMode = 'normal'; // 'normal' | 'outline' | 'lite'
	// XR interaction mode: true = Ray teleport, false = Grab (pinch)
	let xrInteractionRay = false;

	// Defensive: ensure the scene root has identity transform (no offsets/rotations/scales)
	function resetSceneTransform(){
		try {
			if (!scene) return;
			if (scene.position){ scene.position.set(0,0,0); }
			if (scene.quaternion){ scene.quaternion.identity(); }
			if (scene.rotation){ scene.rotation.set(0,0,0); }
			if (scene.scale){ scene.scale.set(1,1,1); }
			if (scene.updateMatrixWorld) scene.updateMatrixWorld(true);
		} catch {}
	}
	function computeArBaseMetrics(root){
		try {
			root.updateMatrixWorld(true);
				const box = new THREE.Box3().setFromObject(root);
			arBaseBox = box; 
			try { if (!arContent.userData) arContent.userData = {}; arContent.userData.__oneScale = FEET_TO_METERS; } catch{}
			const size = box.getSize(new THREE.Vector3());
			arBaseDiagonal = Math.max(1e-4, Math.max(size.x, size.y, size.z));
		} catch { arBaseBox = null; arBaseDiagonal = 1; }
	}
	function setARScaleOne(){
		if (!arContent) return;
		arOneToOne = true;
			try { arContent.scale.setScalar(FEET_TO_METERS); } catch {}
			// Disable pinch scaling in AR edit while 1:1 is active
			try { arEdit.setScaleEnabled(false); } catch {}
			if (arSimplifyMaterials) simplifyMaterialsForARInPlace(THREE, arContent);
		// Keep on floor
		try {
			if (arBaseBox) {
				const y = -arBaseBox.min.y;
				arContent.position.y += y; // nudge to rest on floor
			} else {
				arContent.position.y = 0;
			}
		} catch {}
		// If ground lock active, ensure model is aligned to local-floor (y=0)
		try { if (arGroundLocked) { alignModelToGround(arContent); } } catch {}
	}

	// Ensure HUD reflects 1:1 active state
	try { setHudButtonActiveByLabel('1:1', true); } catch {}
	function setARScaleFit(){
		if (!arContent) return;
		arOneToOne = false;
		// Re-enable pinch scaling when not in 1:1
		try { arEdit.setScaleEnabled(true); } catch {}
		try { setHudButtonActiveByLabel('1:1', false); } catch {}
		const box = new THREE.Box3().setFromObject(arContent);
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(1e-4, Math.max(size.x, size.y, size.z));
		// scale so the max dimension becomes arFitMaxDim
		const s = Math.max(0.01, Math.min(100, arFitMaxDim / maxDim));
		const desired = new THREE.Vector3().setScalar(s);
		try { arContent.scale.copy(desired); } catch {}
	}
	function resetARTransform(){
		if (!arContent) return;
		setARScaleOne();
		// Reset clears 1:1 toggle visual and re-enables pinch scaling
		try { setHudButtonActiveByLabel('1:1', false); } catch {}
		try { arEdit.setScaleEnabled(true); } catch {}
		arOneToOne = false;
		// Place 1.5m in front again, on floor
		try { arContent.position.set(0, 0, -1.5); } catch {}
		try { arContent.quaternion.identity(); } catch {}
			applyArMaterialModeOnContent();
	}
		function applyArMaterialModeOnContent(){
		if (!arContent) return;
			// Clear outline helpers before switching
			try { clearOutlineModeForAR(THREE, arContent); } catch {}
			if (arMatMode === 'outline') {
				applyOutlineModeForARInPlace(THREE, arContent);
			} else if (arMatMode === 'lite') {
				simplifyMaterialsForARInPlace(THREE, arContent);
			} else {
				restoreMaterialsForARInPlace(THREE, arContent);
			}
	}
	// XR HUD: build via service
	const xrHud = createXRHud({
		THREE,
		scene,
		renderer,
		getLocalSpace: ()=> xrLocalSpace,
		getButtons: (createHudButton) => {
			// Track per-object manipulation mode (default: whole scene)
			let arPerObject = false;
			let handStyle = 'fingertips'; // 'fingertips' | 'skeleton' | 'off'
			const bOne = createHudButton('1:1', ()=>{
				// Toggle-only behavior: do not auto-fit; just flip 1:1 state and update HUD + scale gate
				try {
					if (arOneToOne) {
						// Turning 1:1 off: keep current scale, just re-enable pinch scaling and clear highlight
						arOneToOne = false;
						arEdit.setScaleEnabled(true);
						setHudButtonActiveByLabel('1:1', false);
					} else {
						// Turning 1:1 on: set feet->meters scale and disable pinch scaling
						setARScaleOne();
						setHudButtonActiveByLabel('1:1', true);
					}
				} catch {}
			});
			const bFit = createHudButton('Fit', ()=> setARScaleFit());
			const bReset = createHudButton('Reset', ()=> resetARTransform());
			// Toggle XR interaction mode between Ray (teleport) and Grab (pinch)
	    const bInteract = createHudButton('Grab', ()=>{
				try {
		    setXRInteractionMode(!xrInteractionRay);
				} catch {}
			});
			// Toggle per-object vs whole-scene manipulation
			const bMode = createHudButton('Objects', ()=>{
				try {
					arPerObject = !arPerObject;
					arEdit.setPerObjectEnabled(arPerObject);
					bMode.setLabel(arPerObject ? 'Scene' : 'Objects');
				} catch {}
			});
			// Lock ground: snap AR content ground to XR local-floor (translate up, yaw align, optional scale within constraints)
			const bLock = createHudButton('Lock Ground', ()=>{
				try {
					if (!arContent) return;
					// Toggle lock state
					arGroundLocked = !arGroundLocked;
					// Visual HUD tint
					try { setHudButtonActiveByLabel('Lock Ground', arGroundLocked); } catch {}
					// If enabling lock, align model now
					if (arGroundLocked) {
						try { alignModelToGround(arContent); } catch {}
					}
					// Recompute metrics/material mode consistency
					try { computeArBaseMetrics(arContent); } catch {}
					try { applyArMaterialModeOnContent(); } catch {}
				} catch {}
			});
			// Cycle material mode: Normal -> Outline -> Lite -> Normal
			const bMatMode = createHudButton('Mat', ()=>{
				try {
					arMatMode = (arMatMode === 'normal') ? 'outline' : (arMatMode === 'outline' ? 'lite' : 'normal');
					applyArMaterialModeOnContent();
					bMatMode.setLabel(arMatMode === 'normal' ? 'Mat' : (arMatMode === 'outline' ? 'Outline' : 'Lite'));
				} catch {}
			});
			const bHands = createHudButton('Fingers', ()=>{
				try {
					// Cycle through supported styles
					if (handStyle === 'fingertips') handStyle = 'skeleton';
					else if (handStyle === 'skeleton') handStyle = 'off';
					else handStyle = 'fingertips';
					xrHud.setHandVizStyle?.(handStyle);
					bHands.setLabel(
						handStyle === 'fingertips' ? 'Fingers' :
						handStyle === 'skeleton' ? 'Skeleton' :
						'Hands Off'
					);
				} catch {}
			});
			// Room controls in XR: dispatch to app-level handler
			const bRoomHost = createHudButton('Host', ()=>{
				try {
					const r = prompt('Enter room to host'); if (!r) return;
					window.dispatchEvent(new CustomEvent('sketcher:room', { detail: { action: 'host', room: r.trim() } }));
				} catch {}
			});
			const bRoomJoin = createHudButton('Join', ()=>{
				try {
					const r = prompt('Enter room to join'); if (!r) return;
					window.dispatchEvent(new CustomEvent('sketcher:room', { detail: { action: 'join', room: r.trim() } }));
				} catch {}
			});
			// Initialize to default style
			try { xrHud.setHandVizStyle?.(handStyle); } catch {}
				// Initialize interaction button visuals
				try { bInteract.setLabel(xrInteractionRay ? 'Ray' : 'Grab'); if (bInteract.mesh && bInteract.mesh.material){ bInteract.mesh.material.color.setHex(xrInteractionRay ? 0xff8800 : 0xffffff); bInteract.mesh.material.needsUpdate = true; } } catch{}
				// Also ensure AR edit initial enable state matches mode (Grab by default)
				try { arEdit.setEnabled(!xrInteractionRay); } catch{}
				xrHudButtons = [bOne, bFit, bReset, bInteract, bLock, bMode, bMatMode, bHands, bRoomHost, bRoomJoin];
			return xrHudButtons;
		}
	});

		// State for ground lock
		let arGroundLocked = false;

			// Helper: align model so its local up aligns with world up (make ground horizontal) and snap its min.y to 0
			function alignModelToGround(root){
				try {
					if (!root) return;
					root.updateMatrixWorld(true);
					// Compute world quaternion for root
					const worldQ = new THREE.Quaternion(); root.getWorldQuaternion(worldQ);
					// model's up in world
					const modelUpWorld = new THREE.Vector3(0,1,0).applyQuaternion(worldQ).normalize();
					const worldUp = new THREE.Vector3(0,1,0);
					// If already aligned, skip
					if (modelUpWorld.angleTo(worldUp) < 1e-3) {
						// still snap to ground
						const box = new THREE.Box3().setFromObject(root);
						if (!box.isEmpty()){
							const dy = -box.min.y;
							root.position.y += dy;
						}
						return;
					}
					// rotation that maps modelUpWorld -> worldUp
					const r = new THREE.Quaternion().setFromUnitVectors(modelUpWorld, worldUp);
					// Apply rotation in parent space so world up aligns
					root.quaternion.premultiply(r);
					root.updateMatrixWorld(true);
					// Snap to floor
					const box2 = new THREE.Box3().setFromObject(root);
					if (!box2.isEmpty()){
						const dy2 = -box2.min.y;
						root.position.y += dy2;
					}
				} catch(e){ console.warn('alignModelToGround failed', e); }
			}

		// Helper: toggle HUD button active visual by label (orange when active)
		function setHudButtonActiveByLabel(label, active){
			try {
				if (!xrHudButtons || !xrHudButtons.length) return;
				for (const b of xrHudButtons){
					try {
						const mesh = b && b.mesh;
						const meta = mesh && mesh.userData && mesh.userData.__hudButton;
						if (!meta) continue;
						if (meta.label === label){
							mesh.userData.__hudButton.active = !!active;
							// Use material.color to tint the button; multiply the texture
							if (mesh.material) {
								if (active) mesh.material.color.setHex(0xff8800);
								else mesh.material.color.setHex(0xffffff);
								mesh.material.needsUpdate = true;
							}
						}
					} catch(_){}
				}
			} catch(e){ }
		}

		// Helper: set XR interaction mode and update HUD visuals: true = Ray (teleport), false = Grab (pinch)
		function setXRInteractionMode(isRay){
			try {
					xrInteractionRay = !!isRay;
					// Publish current mode for modules (e.g., xr-hud hand ray rendering)
					try { window.__xrInteractionRay = xrInteractionRay; } catch{}
				// Enable AR edit only in Grab mode
				try { arEdit.setEnabled(!xrInteractionRay); } catch{}
				// Update the interaction button label and tint
				if (Array.isArray(xrHudButtons)){
					for (const b of xrHudButtons){
						try {
							const meta = b?.mesh?.userData?.__hudButton;
							if (!meta) continue;
							if (meta.label === 'Ray' || meta.label === 'Grab' || meta.label === 'Ray/Grab'){
								b.setLabel(xrInteractionRay ? 'Ray' : 'Grab');
								if (b.mesh && b.mesh.material){ b.mesh.material.color.setHex(xrInteractionRay ? 0xff8800 : 0xffffff); b.mesh.material.needsUpdate = true; }
								break;
							}
						} catch{}
					}
				}
			} catch{}
		}

	// First-person desktop fallback
	const { createFirstPerson } = await import('./services/first-person.js');
	const firstPerson = createFirstPerson({ THREE, renderer, scene, camera, domElement: renderer.domElement });
	let __fpControlsDisabled = false;
	let __fpEditSuppressed = false;
	let __fpPrevToolboxDisplay = null;
	function __enterFirstPersonSideEffects(){
		// Disable orbit controls and editing gizmos
		try { if (controls) controls.enabled = false; } catch {}
		try { transformControls.enabled = false; transformControls.visible = false; } catch {}
		try { transformControlsRotate.enabled = false; transformControlsRotate.visible = false; } catch {}
		// Hide toolbox temporarily
		const toolbox = document.getElementById('toolbox');
		if (toolbox){ __fpPrevToolboxDisplay = toolbox.style.display; toolbox.style.display = 'none'; }
		__fpEditSuppressed = true;
		// Ensure teleport discs remain interactive in First-Person
		try { if (window.__teleport && window.__teleport.setActive) window.__teleport.setActive(true); } catch{}
	}
	function __exitFirstPersonSideEffects(){
		// Restore toolbox visibility according to current mode
		const toolbox = document.getElementById('toolbox');
		if (toolbox){
			// If mode is edit/import, toolbox should be visible
			const modeSel = document.getElementById('modeSelect');
			const curMode = modeSel ? modeSel.value : 'edit';
			if (curMode === 'edit' || curMode === 'import') toolbox.style.display = 'inline-block';
			else toolbox.style.display = (__fpPrevToolboxDisplay != null ? __fpPrevToolboxDisplay : toolbox.style.display);
		}
		__fpEditSuppressed = false;
	}
	function ensureXRHud3D(){ const g = xrHud.ensure(); xrHud3D = xrHud.group; return g; }
	function removeXRHud3D(){ xrHud.remove(); xrHud3D = null; xrHudButtons = []; }

	// XR UI toggles via controller "menu"-like buttons
	let __xrMenuPrevBySource = new WeakMap(); // inputSource -> boolean pressed last frame
	function toggleXRHudVisibility(){ try { if (!xrHud3D) ensureXRHud3D(); if (xrHud3D) xrHud3D.visible = !xrHud3D.visible; } catch {} }
	function toggleDomUIInXR(){
		try {
			const s = renderer && renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
			if (!s || !s.domOverlayState) return; // only when DOM overlay is actually active
			const editUI = document.getElementById('edit-ui');
			if (editUI) {
				const cur = getComputedStyle(editUI).display;
				editUI.style.display = (cur === 'none') ? 'block' : 'none';
			}
		} catch {}
	}
	function handleXRMenuTogglePoll(frame){
		try {
			const session = renderer && renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
			if (!session || !frame) return;
			const sources = session.inputSources ? Array.from(session.inputSources) : [];
			const nowTs = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
			const inCooldown = (handleXRMenuTogglePoll.__cooldownUntil && nowTs < handleXRMenuTogglePoll.__cooldownUntil);
			// Candidate indices for a "menu"-like press; on Meta Quest the left-Menu/Y is commonly among these
		// Only the LEFT side's physical gamepad/menu inputs toggle the HUD; some UAs expose both hand and gamepad on the same inputSource,
		// so accept gamepad presses regardless of whether `src.hand` is present.
		const CANDIDATES = [0,3,4,5];
			// Pre-scan: detect whether any controllers are present and whether left palm is up
			let anyControllerPresent = false;
			let leftPalmPresent = false;
			let leftPalmUp = false;
			try {
				for (const s of sources){
					if (s && s.gamepad && !s.hand) anyControllerPresent = true;
					if (s && s.handedness === 'left' && s.hand){
						const wrist = s.hand.get && s.hand.get('wrist');
						const idx = s.hand.get && s.hand.get('index-finger-tip');
						const th = s.hand.get && s.hand.get('thumb-tip');
						const ref = xrLocalSpace || xrViewerSpace || null;
						const pw = wrist && frame.getJointPose ? frame.getJointPose(wrist, ref) : null;
						leftPalmPresent = !!pw;
						if (pw && pw.transform && pw.transform.orientation){
							const o = pw.transform.orientation; const qW = new THREE.Quaternion(o.x,o.y,o.z,o.w);
							const z = new THREE.Vector3(0,-1,0).applyQuaternion(qW).normalize();
							leftPalmUp = (z.y >= 0.15);
						} else if (pw && idx && th){
							const pi = frame.getJointPose(idx, ref); const pt = frame.getJointPose(th, ref);
							if (pi && pt){
								const w = pw.transform.position; const ip = pi.transform.position; const tp = pt.transform.position;
								const vIndex = new THREE.Vector3(ip.x-w.x, ip.y-w.y, ip.z-w.z);
								const vThumb = new THREE.Vector3(tp.x-w.x, tp.y-w.y, tp.z-w.z);
								let z = new THREE.Vector3().crossVectors(vIndex, vThumb); if (z.lengthSq()<1e-6) z.set(0,0,1); z.normalize();
								leftPalmUp = (z.y >= 0.15);
							}
						}
					}
				}
			} catch {}
			for (const src of sources){
			// Require left-handed gamepad-capable input sources; allow src.hand to be present
			if (!src || src.handedness !== 'left' || !src.gamepad) continue;
				const gp = src.gamepad;
				if (!gp || !gp.buttons || !gp.buttons.length) continue;
				let pressed = false;
				for (const idx of CANDIDATES){ const b = gp.buttons[idx]; if (b && (b.pressed || b.touched)) { pressed = true; break; } }
				const prev = __xrMenuPrevBySource.get(src) === true;
						if (pressed && !prev){
							// Debounce: ignore toggles while in cooldown window
							if (inCooldown){ __xrMenuPrevBySource.set(src, pressed); continue; }
							// Require left hand palm-up before toggling HUD
							if (!leftPalmUp){ __xrMenuPrevBySource.set(src, pressed); continue; }
					// Rising edge: toggle HUD. Always anchor to LEFT palm.
					try {
						ensureXRHud3D();
						if (xrHud3D) {
							xrHud.setAnchor({ type: 'palm', handedness: 'left' });
							const wasShown = !!xrHud3D.userData.__menuShown;
							const nextShown = !wasShown;
							xrHud3D.userData.__menuShown = nextShown;
							xrHud3D.userData.__autoHidden = false;
							xrHud3D.visible = nextShown;
											// Temporarily force Ray mode while the HUD is shown, but only if a controller is present.
											if (nextShown){
												if (anyControllerPresent){
													try { xrHud3D.userData.__prevInteractionRay = xrInteractionRay; } catch{}
													try { setXRInteractionMode(true); } catch{}
													xrHud3D.userData.__forcedRayByMenu = true;
												} else {
													// Hands-only: do not change interaction mode
													xrHud3D.userData.__forcedRayByMenu = false;
												}
											} else {
												// Restore previous mode only if we had forced it
												try {
													if (xrHud3D.userData.__forcedRayByMenu){
														const prevMode = xrHud3D.userData.__prevInteractionRay;
														if (typeof prevMode === 'boolean') setXRInteractionMode(prevMode);
													}
													xrHud3D.userData.__prevInteractionRay = undefined;
													xrHud3D.userData.__forcedRayByMenu = undefined;
												} catch{}
											}
							if (nextShown) {
								try { xrHud.resetPressStates?.(); } catch {}
								try { xrHud3D.userData.__menuJustShownAt = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); } catch{}
							}
							}
							// Start cooldown to prevent double-toggles (e.g., single pinch triggering open+close)
							handleXRMenuTogglePoll.__cooldownUntil = nowTs + 500;
					} catch {}
				}
				__xrMenuPrevBySource.set(src, pressed);
			}
			// Hand-tracking gesture toggle: left palm-up + pinch toggles HUD, controller-independent
			try {
				let leftHand = sources.find(s => s && s.handedness === 'left' && s.hand);
				if (leftHand){
					const ref = xrLocalSpace || xrViewerSpace || null;
					const wrist = leftHand.hand.get && leftHand.hand.get('wrist');
					const idx = leftHand.hand.get && leftHand.hand.get('index-finger-tip');
					const th = leftHand.hand.get && leftHand.hand.get('thumb-tip');
					const pw = wrist && frame.getJointPose ? frame.getJointPose(wrist, ref) : null;
					const pi = idx && frame.getJointPose ? frame.getJointPose(idx, ref) : null;
					const pt = th && frame.getJointPose ? frame.getJointPose(th, ref) : null;
					let palmUpOk = false;
					if (pw && pw.transform && pw.transform.orientation){
						const o = pw.transform.orientation; const qW = new THREE.Quaternion(o.x,o.y,o.z,o.w);
						const z = new THREE.Vector3(0,-1,0).applyQuaternion(qW).normalize();
						palmUpOk = (z.y >= 0.15);
					}
					let isPinch = false;
					if (pi && pt){
						const a = pi.transform.position; const b = pt.transform.position;
						const dist = Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
						isPinch = dist < 0.035;
					}
					if (!handleXRMenuTogglePoll.__handPrev) handleXRMenuTogglePoll.__handPrev = { pinch:false };
					const prevPinch = !!handleXRMenuTogglePoll.__handPrev.pinch;
					if (palmUpOk && isPinch && !prevPinch){
						// Debounce: ignore toggles while in cooldown window
						if (inCooldown){ handleXRMenuTogglePoll.__handPrev.pinch = isPinch; return; }
						// Toggle HUD; anchor to left palm; temporarily force Ray only if a controller exists
						ensureXRHud3D();
						if (xrHud3D){
							xrHud.setAnchor({ type: 'palm', handedness: 'left' });
							const wasShown = !!xrHud3D.userData.__menuShown;
							const nextShown = !wasShown;
							xrHud3D.userData.__menuShown = nextShown;
							xrHud3D.userData.__autoHidden = false;
							xrHud3D.visible = nextShown;
							if (nextShown){
								if (sources.some(s=>s && s.gamepad && !s.hand)){
									xrHud3D.userData.__prevInteractionRay = xrInteractionRay;
									setXRInteractionMode(true);
									xrHud3D.userData.__forcedRayByMenu = true;
								} else {
									xrHud3D.userData.__forcedRayByMenu = false;
								}
								xrHud.resetPressStates?.();
								xrHud3D.userData.__menuJustShownAt = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
							} else {
								if (xrHud3D.userData.__forcedRayByMenu){
									const prevMode = xrHud3D.userData.__prevInteractionRay;
									if (typeof prevMode === 'boolean') setXRInteractionMode(prevMode);
								}
								xrHud3D.userData.__prevInteractionRay = undefined;
								xrHud3D.userData.__forcedRayByMenu = undefined;
							}
						}
						// Start cooldown window to avoid immediate re-toggle on the same pinch
						handleXRMenuTogglePoll.__cooldownUntil = nowTs + 500;
					}
					handleXRMenuTogglePoll.__handPrev.pinch = isPinch;
				}
			} catch{}
		} catch {}
	}

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

	// Optional: add a tiny debug cube to verify rendering when troubleshooting blank view
	(function maybeAddDebugCube(){
		try {
			const enable = (location && location.hash && location.hash.includes('debugcube'))
				|| (localStorage && localStorage.getItem('sketcher.debugCube') === '1');
			if (!enable) return;
			const g = new THREE.BoxGeometry(1,1,1);
			const m = new THREE.MeshStandardMaterial({ color: 0x4caf50 });
			const cube = new THREE.Mesh(g,m); cube.position.set(0,0.5,0); cube.castShadow = true; cube.receiveShadow = true;
			scene.add(cube);
			// Axis helper for orientation
			const axes = new THREE.AxesHelper(2); scene.add(axes);
		} catch {}
	})();

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
					// Toggle ground lock state
					arGroundLocked = !arGroundLocked;
					setHudButtonActiveByLabel('Lock Ground', arGroundLocked);
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

	// Teleport discs (jump points)
	const teleportDiscs = [];
	// Free-aim teleport reticle (moving circle on floor)
	let teleportReticle = null;
	function __isTeleportDisc(obj){ return !!(obj && obj.userData && obj.userData.__teleportDisc); }
	function __getTeleportDiscRoot(obj){ let o=obj; while(o && !__isTeleportDisc(o)) o=o.parent; return __isTeleportDisc(o) ? o : null; }
	// Rehydrate a disc that was loaded from JSON (no runtime registry/material refs yet)
	function __registerTeleportDisc(group){
		if (!group) return;
		// Avoid duplicate registration
		if (teleportDiscs.includes(group)) return;
		// Ensure marker exists
		const ud = (group.userData.__teleportDisc = group.userData.__teleportDisc || {});
		// Normalize stored normal (plain object -> THREE.Vector3)
		try {
			if (ud.normal && !(ud.normal.isVector3)) {
				ud.normal = new THREE.Vector3(ud.normal.x||0, ud.normal.y||1, ud.normal.z||0).normalize();
			}
		} catch{}
		if (!ud.normal){
			// Derive from orientation (group up rotated by group quaternion)
			try { ud.normal = new THREE.Vector3(0,1,0).applyQuaternion(group.quaternion).normalize(); } catch { ud.normal = new THREE.Vector3(0,1,0); }
		}
		// Find child meshes for plane and cone (lost by JSON in userData)
		try {
			let plane = null, cone = null;
			group.traverse(o => {
				if (plane && cone) return;
				if (o && o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry') plane = plane || o;
				if (o && o.isMesh && o.geometry && o.geometry.type === 'ConeGeometry') cone = cone || o;
			});
			// Reapply canonical materials to ensure consistent look
			if (plane) {
				ud.plane = plane; ud.top = plane;
				try {
					const m = plane.material;
					if (m && m.isMeshStandardMaterial){
						m.color && m.color.set(0x2f8cff);
						m.emissive && m.emissive.set(0x114477);
						m.emissiveIntensity = 0.35;
						m.roughness = 0.6; m.metalness = 0.0; m.side = THREE.DoubleSide;
						m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; m.depthWrite = false;
						m.needsUpdate = true;
					}
				} catch{}
			}
			if (cone) {
				ud.cone = cone;
				try {
					const m = cone.material;
					if (m && m.isMeshStandardMaterial){
						m.color && m.color.set(0x2f8cff);
						m.emissive && m.emissive.set(0x114477);
						m.emissiveIntensity = 0.5;
						m.needsUpdate = true;
					}
				} catch{}
			}
		} catch{}
		// Ensure a consistent name marker
		try { if (!group.name || group.name === '') group.name = '__TeleportDisc'; } catch{}
		teleportDiscs.push(group);
		// Default to active on load so interactions work immediately
		try { ud.active = (ud.active !== false); } catch{}
	}
	// Toggle interactivity across mode transitions without affecting user visibility
	function setTeleportDiscsActive(active=true){
		try { teleportDiscs.forEach(d => { if (d && d.userData){ if(!d.userData.__teleportDisc) d.userData.__teleportDisc = {}; d.userData.__teleportDisc.active = !!active; } }); } catch{}
	}
	function createTeleportDisc(position, normal){
		const n = (normal && normal.isVector3) ? normal.clone().normalize() : new THREE.Vector3(0,1,0);
		const group = new THREE.Group(); group.name = '__TeleportDisc'; group.userData.__teleportDisc = { normal: n.clone() };
		// Flat blue plane circle (2 ft Ø) — no thickness
		const planeGeo = new THREE.CircleGeometry(1.0, 64);
		const planeMat = new THREE.MeshStandardMaterial({ color: 0x2f8cff, emissive: 0x114477, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false });
		const plane = new THREE.Mesh(planeGeo, planeMat);
		// Orient so circle normal is +Y pre-alignment; then lift slightly to avoid z-fight
		try { plane.rotation.x = -Math.PI/2; } catch{}
		try { plane.position.y = 0.001; } catch{}
		plane.castShadow = false; plane.receiveShadow = false; group.add(plane);
		// Direction cone to indicate facing (points along disc normal)
		const coneGeo = new THREE.ConeGeometry(0.18, 0.45, 24);
		const coneMat = new THREE.MeshStandardMaterial({ color: 0x2f8cff, emissive: 0x114477, emissiveIntensity: 0.5 });
		const cone = new THREE.Mesh(coneGeo, coneMat); cone.position.y = 0.25 + 0.225; group.add(cone);
		// Orient so +Y aligns to normal
		const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n);
		group.quaternion.copy(q);
		// Place at position
		if (position && position.isVector3) group.position.copy(position);
		// Store references for highlight
		group.userData.__teleportDisc.plane = plane; group.userData.__teleportDisc.top = plane; group.userData.__teleportDisc.cone = cone;
		teleportDiscs.push(group); scene.add(group);
		// Make selectable/movable like other objects (but we'll disable rotation on selection)
		try { objects.push(group); } catch {}
		try { updateVisibilityUI(); updateCameraClipping(); } catch {}
		return group;
	}
	function highlightTeleportDisc(disc, on){
		try {
			// Boost plane emissive as subtle hover feedback
			const ud = disc?.userData?.__teleportDisc || {};
			const p = ud.plane; if (p && p.material) { p.material.emissiveIntensity = on ? 0.8 : 0.35; p.material.needsUpdate = true; }
			// Create or toggle a thick orange/yellow highlight ring overlay on top cap
				let hl = ud.ringHL;
			if (on && !hl){
					const top = ud.top || disc; // plane mesh or disc root
				// Estimate radius from bounding sphere or default 1 (2 ft dia)
				let rad = 1.0;
				try { const bs = new THREE.Sphere(); new THREE.Box3().setFromObject(top).getBoundingSphere(bs); if (isFinite(bs.radius) && bs.radius>0) rad = Math.min(2.0, Math.max(0.3, bs.radius)); } catch{}
				const inner = Math.max(0.01, rad * 0.80);
				const outer = inner + Math.max(0.02, rad * 0.10); // thick band ~10% of radius
				const g = new THREE.RingGeometry(inner, outer, 64);
				const m = new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
				hl = new THREE.Mesh(g, m); hl.name = '__teleportDiscHL'; hl.renderOrder = 10000; hl.userData.__helper = true;
				// Position slightly above the top surface to avoid z-fight
					try { hl.rotation.x = -Math.PI/2; } catch{}
					try {
						// Anchor to top world position, then convert to disc local, offset a hair on +Y
						disc.updateMatrixWorld(true);
						const topWorld = new THREE.Vector3(); top.getWorldPosition(topWorld);
						const topLocal = disc.worldToLocal(topWorld.clone());
						const y = topLocal.y + 0.012; hl.position.set(topLocal.x, y, topLocal.z);
					} catch{}
				disc.add(hl); ud.ringHL = hl; disc.userData.__teleportDisc = ud;
			}
			if (hl) hl.visible = !!on;
		} catch{}
	}

	// ---- Free-aim Teleport: Reticle + teleport-to-point ----
	function ensureTeleportReticle(){
		if (teleportReticle) return teleportReticle;
		try {
			const group = new THREE.Group(); group.name = '__TeleportReticle'; group.userData.__helper = true;
			// Outer ring
			const outerR = 1.0, innerR = 0.85;
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(innerR, outerR, 64),
				new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false })
			);
			ring.renderOrder = 9999;
			// Soft inner fill
			const fill = new THREE.Mesh(
				new THREE.CircleGeometry(innerR * 0.92, 48),
				new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.18, depthTest: true, depthWrite: false })
			);
			fill.renderOrder = 9998;
			// Orient horizontal by default; placement will re-orient to surface normal
			try { ring.rotation.x = -Math.PI/2; fill.rotation.x = -Math.PI/2; } catch{}
			group.add(fill, ring);
			// Tiny facing arrow to indicate forward when available
			const arrow = new THREE.Mesh(
				new THREE.ConeGeometry(0.14, 0.32, 16),
				new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.9, depthTest: true, depthWrite: false })
			);
			arrow.position.y = 0.08 + 0.16; arrow.userData.__helper = true; arrow.renderOrder = 9999;
			group.add(arrow);
			group.visible = false;
			scene.add(group);
			teleportReticle = { group, ring, fill, arrow };
		} catch{}
		return teleportReticle;
	}

	function showTeleportReticleAt(point, normal){
		const r = ensureTeleportReticle(); if (!r || !point) return;
		try {
			r.group.position.copy(point);
			// Align to surface normal (default up)
			const up = new THREE.Vector3(0,1,0);
			const n = (normal && normal.isVector3) ? normal.clone().normalize() : up.clone();
			const q = new THREE.Quaternion().setFromUnitVectors(up, n);
			r.group.quaternion.copy(q);
			// Point arrow roughly toward current view direction projected on plane
			try {
				const viewDir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
				const tangential = viewDir.clone().sub(n.clone().multiplyScalar(viewDir.dot(n))).normalize();
				r.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tangential.lengthSq()>0? tangential : up);
			} catch{}
			r.group.visible = true;
		} catch{}
	}

	function hideTeleportReticle(){ try { if (teleportReticle && teleportReticle.group) teleportReticle.group.visible = false; } catch{} }

	function teleportToPoint(worldPoint, worldNormal){
		if (!worldPoint) return;
		const up = new THREE.Vector3(0,1,0);
		const n = (worldNormal && worldNormal.isVector3) ? worldNormal.clone().normalize() : up.clone();
		// Preserve heading/distance like disc teleport
		let prevDir = null; let prevDist = 10;
		try {
			const d = new THREE.Vector3().subVectors(controls.target, camera.position);
			const len = d.length();
			if (len > 1e-6) { prevDir = d.normalize(); prevDist = camera.position.distanceTo(controls.target) || 10; }
		} catch {}
		if (!prevDir){ try { prevDir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize(); } catch { prevDir = new THREE.Vector3(0,0,-1); } }
		// Desktop target: 6ft above surface
		const target = new THREE.Vector3(worldPoint.x, worldPoint.y + 6, worldPoint.z);
		const session = renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
		if (session){
			const mode = (session.environmentBlendMode || 'opaque');
			if (mode !== 'opaque'){
				// AR passthrough: move the model to XZ target, keep y on floor
				try {
					if (arContent){
						arContent.position.set(target.x, 0, target.z);
						try { alignModelToGround(arContent); } catch{}
					} else {
						arPendingTeleport = new THREE.Vector3(target.x, 0, target.z);
					}
				} catch {}
				return;
			}
			// VR: shift only AR/VR content group
			try {
				const xrCam = renderer.xr.getCamera(camera);
				const camPos = new THREE.Vector3(); xrCam.getWorldPosition(camPos);
				const delta = camPos.clone().sub(target);
				if (arContent){ arContent.position.sub(delta); }
			} catch {}
			return;
		}
		// Desktop: move camera and keep heading
		try {
			camera.position.copy(target);
			const look = target.clone().add(prevDir.clone().multiplyScalar(prevDist));
			controls.target.copy(look);
			controls.update();
		} catch{}
	}
	function getTeleportDiscs(){
		try {
			// If in an XR session and an AR/VR clone exists, prefer discs under the clone,
			// since originals may be hidden while presenting. This ensures rays hit visible targets.
			const session = renderer && renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
			if (session && arContent) {
				const list = [];
				try {
					arContent.traverse(o => {
						if (!o) return;
						// Match by explicit marker or canonical name; normalize to the disc root
						const isDisc = (__isTeleportDisc(o) || (o.name === '__TeleportDisc'));
						if (!isDisc) return;
						const root = __getTeleportDiscRoot(o) || o;
						// Honor active flag when present
						const active = (root?.userData?.__teleportDisc?.active !== false);
						if (active) list.push(root);
					});
				} catch {}
				// De-duplicate while preserving order
				const uniq = [];
				const seen = new Set();
				for (const d of list){ if (d && !seen.has(d)) { uniq.push(d); seen.add(d); } }
				return uniq;
			}
		} catch {}
		// Non-XR (desktop) or no clone: use registered originals
		return teleportDiscs.filter(d => (d?.userData?.__teleportDisc?.active !== false)).slice();
	}
	function teleportToDisc(disc){
		if (!disc) return;
		disc.updateMatrixWorld(true);
		const center = new THREE.Vector3(); disc.getWorldPosition(center);
		const up = new THREE.Vector3(0,1,0);
		const n = (disc.userData?.__teleportDisc?.normal || up).clone().normalize();
		let target = center.clone();
		// Cache current desktop view direction and distance to keep heading after teleport
		let prevDir = null; let prevDist = 10;
		try {
			const d = new THREE.Vector3().subVectors(controls.target, camera.position);
			const len = d.length();
			if (len > 1e-6) { prevDir = d.normalize(); prevDist = camera.position.distanceTo(controls.target) || 10; }
		} catch {}
		if (!prevDir){ try { prevDir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize(); } catch { prevDir = new THREE.Vector3(0,0,-1); } }
	// Place camera 6ft above the disc center height (consistent for walk or fly)
	target.set(center.x, center.y + 6, center.z);
		// If XR session active (AR/VR): avoid moving the scene root.
		const session = renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
		if (session){
			const mode = (session.environmentBlendMode || 'opaque');
			if (mode !== 'opaque'){
				// AR passthrough: move the placed model (arContent) to the disc, keeping ground alignment.
				try {
					if (arContent){
						const xrCam = renderer.xr.getCamera(camera);
						const camPos = new THREE.Vector3(); xrCam.getWorldPosition(camPos);
						// Keep model on local-floor (y=0) and face roughly same heading
						arContent.position.set(target.x, 0, target.z);
						try { alignModelToGround(arContent); } catch{}
					} else {
						// Not yet placed: remember target to apply on first placement
						arPendingTeleport = new THREE.Vector3(target.x, 0, target.z);
					}
				} catch {}
				return;
			}
						// In VR, avoid moving XR-managed nodes; instead, shift only the cloned AR/VR content group.
			try {
				const xrCam = renderer.xr.getCamera(camera);
				const camPos = new THREE.Vector3(); xrCam.getWorldPosition(camPos);
				const delta = camPos.clone().sub(target);
							// Shift only the AR/VR content; never move the scene root or live editor objects during XR
							if (arContent){ arContent.position.sub(delta); }
			} catch {}
			return;
		}
		// Desktop: move camera and keep heading (preserve previous view direction and distance)
		try {
			camera.position.copy(target);
			const look = target.clone().add(prevDir.clone().multiplyScalar(prevDist));
			controls.target.copy(look);
			controls.update();
		} catch{}
	}
	// Expose teleport helpers for other modules (first-person, XR)
	try { window.__teleport = { getTeleportDiscs, teleportToDisc, highlightTeleportDisc, setActive: setTeleportDiscsActive, showReticleAt: showTeleportReticleAt, hideReticle: hideTeleportReticle, teleportToPoint }; } catch{}
	// Default: make discs active for interaction
	try { setTeleportDiscsActive(true); } catch{}
	// Add a UI button to place discs
	(function(){
		const toolbox = document.getElementById('toolbox');
		if (!toolbox) return;
		const btn = document.createElement('button'); btn.id='placeTeleportBtn'; btn.className='icon-btn'; btn.title='Place a jump disc'; btn.setAttribute('aria-label','Place Jump Disc');
		// Linework icon: axon ellipse with arrow pointing to center
		btn.innerHTML = '<span class="sr-only">Place Jump Disc</span>'+
			'<svg viewBox="0 0 24 24" aria-hidden="true">'+
			  '<g fill="none" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
			    // Axon ellipse (represents a circle in 3D)
			    '<ellipse cx="12" cy="9.5" rx="7" ry="3.5"/>'+
			    // Down arrow to center
			    '<path d="M12 5v7"/>'+
			    '<polyline points="9,10.5 12,12.6 15,10.5"/>'+
			  '</g>'+
			'</svg>';
		Object.assign(btn.style, { marginLeft:'6px' });
		let placing=false; let preview=null; let previewNormal=new THREE.Vector3(0,1,0);
		function ensurePreview(){ if (preview) return; preview = createTeleportDisc(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0)); preview.materialBackup = []; preview.traverse(o=>{ if (o.material){ preview.materialBackup.push(o.material); const m=o.material.clone?o.material.clone():o.material; o.material = m; if (o.material.opacity!==undefined){ o.material.transparent=true; o.material.opacity=0.6; }}}); }
		function removePreview(){
			if (!preview) return;
			try {
				// Remove from scene
				scene.remove(preview);
				// Remove from registries
				try { const i = teleportDiscs.indexOf(preview); if (i>=0) teleportDiscs.splice(i,1); } catch{}
				try { const j = objects.indexOf(preview); if (j>=0) objects.splice(j,1); } catch{}
				// Dispose resources
				preview.traverse(o=>{ if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
			} catch{}
			preview=null;
		}
		btn.addEventListener('click', ()=>{ placing = !placing; btn.setAttribute('data-active', placing?'1':'0'); if (placing){ ensurePreview(); } else { removePreview(); } });
		toolbox.appendChild(btn);
		// Hook into existing pointer handlers for placement preview and commit
		renderer.domElement.addEventListener('pointermove', e => {
			if (!placing || preview==null) return; if (firstPerson && firstPerson.isActive && firstPerson.isActive()) return;
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			// Find nearest horizontal surface under pointer (or ground)
			const up = new THREE.Vector3(0,1,0);
			const allHits = raycaster.intersectObjects(selectableTargets(), true) || [];
			let best = null;
			for (const h of allHits){
				if (!h.face) continue;
				// Exclude teleport discs and helpers
				if (__getTeleportDiscRoot(h.object)) continue;
				const wn = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
				const dot = wn.dot(up);
				if (dot >= 0.85){ best = h; break; }
			}
			let pos = null; if (best){ pos = best.point.clone(); } else { pos = intersectGround() || new THREE.Vector3(0,0,0); pos.y = 0; }
			preview.position.copy(pos);
			// Keep disc horizontal for placement
			const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), up);
			preview.quaternion.copy(q); previewNormal.copy(up);
		});
		renderer.domElement.addEventListener('pointerup', e => {
			if (!placing || preview==null) return; if (firstPerson && firstPerson.isActive && firstPerson.isActive()) return;
			// Ensure final placement is on a horizontal surface
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const up = new THREE.Vector3(0,1,0);
			const hits = raycaster.intersectObjects(selectableTargets(), true) || [];
			let okPos = null;
			for (const h of hits){
				if (!h.face) continue; if (__getTeleportDiscRoot(h.object)) continue;
				const wn = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
				if (wn.dot(up) >= 0.85){ okPos = h.point.clone(); break; }
			}
			if (!okPos){ okPos = intersectGround() || null; if (okPos) okPos.y = 0; }
			if (okPos){ preview.position.copy(okPos); previewNormal.copy(up); createTeleportDisc(preview.position, previewNormal); }
			placing = false; btn.setAttribute('data-active','0'); removePreview();
		});
	})();
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
	// Apply top-level transforms from the XR clone back to original scene objects (meters -> feet)
	function __applyXRCloneTopLevelToOriginals(root){
		try {
			if (!root || !root.children) return 0;
			const METERS_TO_FEET = 1.0 / FEET_TO_METERS;
			let applied = 0;
			root.updateMatrixWorld(true);
			for (const cn of root.children){
				if (!cn) continue;
				const orig = cn.userData && cn.userData.__sourceRef;
				if (!orig) continue;
				// Skip helper overlays except the 2D Overlay which is user-visible
				try {
					if (orig.userData && orig.userData.__helper && orig.name !== '2D Overlay') continue;
				} catch{}
				cn.updateMatrixWorld(true);
				const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
				cn.matrixWorld.decompose(pos, quat, scl);
				pos.multiplyScalar(METERS_TO_FEET);
				scl.multiplyScalar(METERS_TO_FEET);
				const worldFeet = new THREE.Matrix4().compose(pos, quat, scl);
				setWorldMatrix(orig, worldFeet);
				applied++;
			}
			return applied;
		} catch { return 0; }
	}
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
			// Jump Disc: treat as movable object only (no rotation). Also restrict translation Y axis.
			if (__getTeleportDiscRoot(selectedObjects[0])){
				clearHandles();
				const disc = __getTeleportDiscRoot(selectedObjects[0]);
				// Remember baseline Y to lock vertical movement while translating
				try { disc.userData.__teleportDisc.baseY = disc.position.y; } catch{}
				transformControls.attach(disc);
				if (typeof transformControls.setMode === 'function') transformControls.setMode('translate');
				if ('showX' in transformControls) { transformControls.showX = true; }
				if ('showY' in transformControls) { transformControls.showY = false; }
				if ('showZ' in transformControls) { transformControls.showZ = true; }
				transformControlsRotate.detach(); disableRotateGizmo(); enableTranslateGizmo();
				return;
			}
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
				// Restore translate gizmo axes in case a previous selection (e.g., 2D Overlay) hid Y
				if ('showX' in transformControls) { transformControls.showX = true; }
				if ('showY' in transformControls) { transformControls.showY = true; }
				if ('showZ' in transformControls) { transformControls.showZ = true; }
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
		else if(selectedObjects.length >= 2){ updateMultiSelectPivot(); transformControls.attach(multiSelectPivot); if ('showX' in transformControls) { transformControls.showX = true; } if ('showY' in transformControls) { transformControls.showY = true; } if ('showZ' in transformControls) { transformControls.showZ = true; } transformControlsRotate.attach(multiSelectPivot); if ('showX' in transformControlsRotate) { transformControlsRotate.showX = true; } if ('showY' in transformControlsRotate) { transformControlsRotate.showY = true; } if ('showZ' in transformControlsRotate) { transformControlsRotate.showZ = true; } enableTranslateGizmo(); enableRotateGizmo(); clearHandles(); }
		else { transformControls.detach(); transformControlsRotate.detach(); clearHandles(); }
	}
	function captureMultiStart(){ multiStartPivotMatrix = getWorldMatrix(multiSelectPivot); multiStartMatrices.clear(); selectedObjects.forEach(o=> multiStartMatrices.set(o, getWorldMatrix(o))); }
	function applyMultiDelta(){ if(selectedObjects.length<2) return; const currentPivot=getWorldMatrix(multiSelectPivot); const invStart=multiStartPivotMatrix.clone().invert(); const delta=new THREE.Matrix4().multiplyMatrices(currentPivot,invStart); selectedObjects.forEach(o=>{ const start=multiStartMatrices.get(o); if(!start) return; const newWorld=new THREE.Matrix4().multiplyMatrices(delta,start); setWorldMatrix(o,newWorld); }); try { if (collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) { selectedObjects.forEach(o=>{ try { collab.onTransform(o); } catch{} }); } } catch{} }
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
		// Constrain Jump Discs: no rotation and clamp Y (move only along surface plane approximately)
		if (transformControls.object && __getTeleportDiscRoot(transformControls.object)){
			const obj = __getTeleportDiscRoot(transformControls.object) || transformControls.object;
			// Freeze rotation
			obj.rotation.set(0, obj.rotation.y, 0);
			// If attached to transformControls directly, hide Y movement and pin to original Y
			if ('showY' in transformControls) { transformControls.showY = false; }
			try {
				const by = obj.userData?.__teleportDisc?.baseY;
				// Lock to plane Y=baseY; if missing, set now
				if (typeof by === 'number') obj.position.y = by; else { obj.userData.__teleportDisc.baseY = obj.position.y || 0; obj.position.y = obj.userData.__teleportDisc.baseY; }
			} catch{}
			obj.updateMatrixWorld(true);
		}
		// Broadcast transform for single-object moves/rotates when applicable
		try {
			const tgt = (selectedObjects.length===1 && transformControls.object===selectedObjects[0]) ? selectedObjects[0] : null;
			if (tgt && collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) {
				collab.onTransform(tgt);
			}
		} catch {}
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
	transformControlsRotate.addEventListener('objectChange', () => { 
		if(transformControlsRotate.object===multiSelectPivot) { applyMultiDelta(); saveSessionDraftSoon(); return; }
		// Broadcast transform for single-object rotates
		try {
			const tgt = (selectedObjects.length===1 && transformControlsRotate.object===selectedObjects[0]) ? selectedObjects[0] : null;
			if (tgt && collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) {
				collab.onTransform(tgt);
			}
		} catch {}
		saveSessionDraftSoon(); 
	});

	// UI refs
const viewPerspectiveBtn = document.getElementById('viewPerspective');
const viewAxonBtn = document.getElementById('viewAxon');
	const uiContainer=document.getElementById('ui-container');
	const modeSelect=document.getElementById('modeSelect');
	const editUI=document.getElementById('edit-ui');
	const toolbox=document.getElementById('toolbox');
	const togglePrimsBtn = document.getElementById('togglePrims');
	const primsGroup = document.getElementById('primsGroup');

	// --- Collaboration and alignment tile init (URL: ?room=abc&host=1) ---
	(async () => {
		try {
			const params = new URLSearchParams(location.search);
			const room = params.get('room');
			const asHost = params.has('host');
			if (room && createCollab) {
				collab = createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData });
				if (asHost) await collab.host(room); else await collab.join(room);
				// Tiny status badge in version area
				try {
					const el = document.getElementById('version-badge');
					if (el) el.textContent = (el.textContent || 'v') + `  ·  Room:${room}${asHost?' (host)':''}`;
				} catch {}
			}
		} catch {}
	})();

	const toggleDrawCreateBtn = document.getElementById('toggleDrawCreate');
	const drawCreateGroup = document.getElementById('drawCreateGroup');
	const toggleUtilsBtn = document.getElementById('toggleUtils');
	const utilsGroup = document.getElementById('utilsGroup');
	const toggleRoomBtn = document.getElementById('toggleRoom');
	const roomGroup = document.getElementById('roomGroup');
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
	// AR clone source should include overlay even though it's marked helper, so it appears in AR
	function getARCloneSourceObjects(){
		const list = getPersistableObjects().slice();
		try { const ov = scene.getObjectByName('2D Overlay'); if (ov && !list.includes(ov)) list.push(ov); } catch {}
		return list;
	}
	function serializeScene() { return persistence.serializeSceneFromObjects(THREE, getPersistableObjects()); }

	// Expose a safe global accessor for current scene JSON (used by share-to-community flow)
	try { window.sketcherSerializeScene = serializeScene; window.sketcherObjectCount = () => getPersistableObjects().length; } catch {}

	// --- Realtime Collaboration wiring (lazy/optional) ---
	let collab = null;
	function findObjectByUUID(uuid){ try { return scene.getObjectByProperty('uuid', uuid) || null; } catch { return null; } }
	function loadSceneFromJSON(json){
		try {
			const loader = new THREE.ObjectLoader();
			const root = loader.parse(json);
			[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); try { if (__isTeleportDisc(child)) __registerTeleportDisc(child); } catch{} });
			updateCameraClipping();
		} catch(e){ console.warn('Collab loadSceneFromJSON failed', e); }
	}
	async function getSnapshot(){
		try {
			const json = serializeScene();
			let overlay = null;
			try { const raw = sessionStorage.getItem('sketcher:2d'); overlay = raw ? JSON.parse(raw) : null; } catch{}
			return { json, overlay };
		} catch { return null; }
	}
	function applyOverlayData(data){
		try {
			const d = data ? { ...data } : null;
			if (d && d.meta){ d.meta.updatedAt = Date.now(); }
			sessionStorage.setItem('sketcher:2d', JSON.stringify(d));
			// The overlay loader polls sessionStorage and will pick this up within 500ms.
		} catch{}
	}

	// Live 2D overlay sync across devices while in a room: forward local overlay changes to collab
	(function wireOverlayCollabBridge(){
		try {
			const forward = (data)=>{
				try {
					if (!collab || !collab.isActive || !collab.isActive()) return;
					if (collab.isApplyingRemote && collab.isApplyingRemote()) return;
					// Guard: if this overlay update came from remote (collab), don't re-broadcast
					try {
						const stamp = data && data.meta && (data.meta.updatedAt || data.meta.createdAt);
						const lastRemote = sessionStorage.getItem('sketcher:2d:last-remote');
						if (stamp && lastRemote && String(stamp) === String(lastRemote)) return;
					} catch {}
					if (typeof collab.onOverlay === 'function') collab.onOverlay(data);
				} catch{}
			};
			// Same-device events via BroadcastChannel
			const bc = (typeof window !== 'undefined' && 'BroadcastChannel' in window) ? new BroadcastChannel('sketcher-2d') : null;
			if (bc){ bc.onmessage = (ev)=>{ try { const d = ev.data; if (d && Array.isArray(d.objects)) forward(d); } catch{} }; }
			// Storage polling fallback
			let lastStampX = 0;
			setInterval(()=>{
				try {
					const raw = localStorage.getItem('sketcher:2d') || sessionStorage.getItem('sketcher:2d'); if(!raw) return;
					const d = JSON.parse(raw); if(!d || !Array.isArray(d.objects)) return;
					const stamp = d && d.meta && (d.meta.updatedAt || d.meta.createdAt) ? (d.meta.updatedAt || d.meta.createdAt) : 0;
					if (stamp && stamp !== lastStampX){ lastStampX = stamp; forward(d); }
				} catch{}
			}, 600);
		} catch{}
	})();

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
			[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); if (__isTeleportDisc(child)) __registerTeleportDisc(child); });
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
		// Render a collapsible tree for scene objects
		const renderNode = (obj, level=0) => {
			if (__isHelperObject(obj)) return;
			const row = document.createElement('div');
			row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px';
			row.style.paddingLeft = (8 + level*12) + 'px';
			const hasChildren = !!(obj.children && obj.children.some(c => !__isHelperObject(c)));
			let isOpen = !!(obj.userData && obj.userData.__visOpen);
			const toggle = document.createElement('button');
			toggle.textContent = hasChildren ? (isOpen ? '▾' : '▸') : ''; toggle.className='tree-toggle';
			toggle.style.background='none'; toggle.style.border='none'; toggle.style.cursor= hasChildren ? 'pointer' : 'default'; toggle.style.width='16px'; toggle.style.padding='0';
			toggle.addEventListener('click', (e)=>{ e.stopPropagation(); if(!hasChildren) return; isOpen = !isOpen; obj.userData = obj.userData || {}; obj.userData.__visOpen = isOpen; updateVisibilityUI(); });
			const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=obj.visible; cb.addEventListener('change',()=>{ obj.visible=cb.checked; saveSessionDraftSoon(); });
			const span=document.createElement('span'); span.textContent=obj.name || obj.type; span.style.flex='1'; span.style.cursor='pointer';
			if(selectedObjects.includes(obj)) span.style.background='#ffe066';
			span.addEventListener('dblclick',()=>{ const inp=document.createElement('input'); inp.type='text'; inp.value=obj.name; inp.style.flex='1'; inp.addEventListener('blur',()=>{obj.name=inp.value||obj.name;updateVisibilityUI(); saveSessionDraftSoon();}); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();}); row.replaceChild(inp,span); inp.focus(); });
			span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(obj)) selectedObjects=selectedObjects.filter(o=>o!==obj); else selectedObjects.push(obj); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[obj]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
			row.append(toggle, cb, span); objectList.append(row);
			if (hasChildren && isOpen){
				for (const ch of obj.children){ renderNode(ch, level+1); }
			}
		};
		// Top-level user objects
		const roots = getPersistableObjects();
		roots.forEach(o=>renderNode(o, 0));
		// Add 2D Overlay as a managed row (visible toggle only; cannot delete)
		try {
			const ov = scene.getObjectByName('2D Overlay');
			if (ov){
				const row=document.createElement('div');
				row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px'; row.style.paddingLeft='8px';
				const spacer=document.createElement('span'); spacer.style.display='inline-block'; spacer.style.width='16px';
				const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=ov.visible; cb.addEventListener('change',()=>{ ov.visible=cb.checked; saveSessionDraftSoon(); });
				const span=document.createElement('span'); span.textContent=ov.name||'2D Overlay'; span.style.flex='1'; span.style.cursor='pointer';
				if(selectedObjects.includes(ov)) span.style.background='#ffe066';
				span.addEventListener('click',e=>{ if(mode!=='edit') return; if(e.ctrlKey||e.metaKey||e.shiftKey){ if(selectedObjects.includes(ov)) selectedObjects=selectedObjects.filter(o=>o!==ov); else selectedObjects.push(ov); attachTransformForSelection(); rebuildSelectionOutlines(); } else { selectedObjects=[ov]; attachTransformForSelection(); rebuildSelectionOutlines(); } updateVisibilityUI(); });
				row.append(spacer, cb, span); objectList.append(row);
			}
		} catch{}
		// Toggle delete bar; always show on Meta Quest (OculusBrowser) when appropriate
		try {
			if (mobileDeleteBar) {
				const ua = navigator.userAgent || '';
				const isHeadsetUA = /OculusBrowser|Meta Quest|Quest/i.test(ua);
				const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isHeadsetUA;
				const isTouchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
				const pointerFineHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
				const likelyDesktop = pointerFineHover && !isMobileUA && !isHeadsetUA;
				const inXR = !!(renderer && renderer.xr && renderer.xr.isPresenting) || !!arActive;
				// Show for: XR sessions, headset UA (Quest), or devices without hardware keyboard
				const noKeyboard = !hasHardwareKeyboard3D && !likelyDesktop && (isMobileUA || isTouchCapable || inXR);
				const shouldShow = mode==='edit' && (selectedObjects && selectedObjects.length > 0) && (inXR || isHeadsetUA || noKeyboard);
				mobileDeleteBar.style.display = shouldShow ? 'flex' : 'none';
				if (shouldShow) placeMobileDeleteBar();
			}
		} catch {}
	}

	// Keep the mobile delete bar docked just below the toolbox
	function placeMobileDeleteBar(){
		try {
			if (!mobileDeleteBar || mobileDeleteBar.style.display === 'none') return;
			if (!toolbox) return;
			const r = toolbox.getBoundingClientRect();
			const left = Math.round(r.left);
			const top = Math.round(r.bottom + 10);
			mobileDeleteBar.style.left = left + 'px';
			mobileDeleteBar.style.top = top + 'px';
		} catch {}
	}

	// Hook delete action for mobile/no-keyboard button (mirrors Delete/Backspace handler)
	if (mobileDeleteBtn) {
		mobileDeleteBtn.addEventListener('click', () => {
			if (mode !== 'edit') return;
			const toDeleteRaw = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []);
			const toDelete = toDeleteRaw.filter(o=>!__isOverlayOrChild(o));
			if (!toDelete.length) return;
			toDelete.forEach(sel=>{ try { if (collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) collab.onDelete(sel); } catch{} scene.remove(sel); const idx=objects.indexOf(sel); if(idx>-1)objects.splice(idx,1); });
			selectedObjects = []; transformControls.detach(); transformControlsRotate.detach(); clearSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); saveSessionDraftNow();
		});
	}

	function __isOverlayOrChild(node){ let n=node; while(n){ if(n.name==='2D Overlay') return true; n=n.parent; } return false; }

	// Settings: background and grid colors (with persistence)
	function disposeGrid(g){ try { gridUtils.disposeGrid(THREE, g); } catch {} }
	// Convert hex like '#rrggbb' to THREE.Color and return perceived luminance (sRGB approx)
	function __hexToColor(hex){
		try { const c = new THREE.Color(hex); return c; } catch { return new THREE.Color('#ffffff'); }
	}
	function __luminanceSRGB(c){
		// c is THREE.Color in linear by default; but three.js Color stores values in linear space when using ACES/linear pipelines.
		// We'll approximate perceived luminance using the common Rec. 709 luma coefficients on the current values.
		try { return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; } catch { return 0.5; }
	}
	function __contrastRatio(l1, l2){ const a = Math.max(l1, l2) + 0.05; const b = Math.min(l1, l2) + 0.05; return a / b; }
	function ensureGridContrastWithBackground(){
		try {
			// Read current bg and grid colors
			const bgHex = getRendererClearColorHex();
			const bgCol = __hexToColor(bgHex);
			const bgLum = __luminanceSRGB(bgCol);
			let gridHex = (gridColorPicker && gridColorPicker.value) || localStorage.getItem('sketcher.gridColor') || '#ffffff';
			let gridCol = __hexToColor(gridHex);
			let gridLum = __luminanceSRGB(gridCol);
			// If contrast is too low (white-on-white or black-on-black vibes), pick a contrasting default without clobbering user prefs permanently
			const cr = __contrastRatio(bgLum, gridLum);
			if (!isFinite(cr) || cr < 1.6 || bgHex.toLowerCase() === gridHex.toLowerCase()){
				const useLight = bgLum < 0.5; // on dark bg, use light grid; on light bg, use dark grid
				const fallback = useLight ? '#ffffff' : '#222222';
				if (gridColorPicker) gridColorPicker.value = fallback;
				setGridColor(fallback);
				// Do not overwrite localStorage unless no prior explicit user choice existed
				try { if (!localStorage.getItem('sketcher.gridColor')) localStorage.setItem('sketcher.gridColor', fallback); } catch {}
			}
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

	// --- Apply material to a single face (safe overlay approach) ---
	let __lastPickedFace = null; // { mesh, faceIndex }
	let __lastFacePreview = null; // temporary highlight overlay

	function __disposeFacePreview(){
		if (!__lastFacePreview) return;
		try { __lastFacePreview.parent && __lastFacePreview.parent.remove(__lastFacePreview); } catch {}
		try {
			__lastFacePreview.geometry && __lastFacePreview.geometry.dispose && __lastFacePreview.geometry.dispose();
			const mm = __lastFacePreview.material;
			if (Array.isArray(mm)) mm.forEach(m=>m && m.dispose && m.dispose()); else mm && mm.dispose && mm.dispose();
		} catch {}
		__lastFacePreview = null;
	}

	function __makeFaceOverlayMesh(mesh, faceIndex, material){
		try {
			const geom = mesh.geometry; if (!geom || !geom.isBufferGeometry) return null;
			const pos = geom.getAttribute('position'); if (!pos) return null;
			const idxAttr = geom.getIndex();
			let ia, ib, ic;
			if (idxAttr) { const a = idxAttr.getX(faceIndex*3+0), b = idxAttr.getX(faceIndex*3+1), c = idxAttr.getX(faceIndex*3+2); ia=a; ib=b; ic=c; }
			else { ia = faceIndex*3+0; ib = faceIndex*3+1; ic = faceIndex*3+2; if (ic >= pos.count) return null; }
			const pA = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
			const pB = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
			const pC = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
			const uvs = geom.getAttribute('uv');
			let uvArr = null;
			if (uvs) {
				uvArr = new Float32Array(6);
				const uA = uvs.getX(ia), vA = uvs.getY(ia);
				const uB = uvs.getX(ib), vB = uvs.getY(ib);
				const uC = uvs.getX(ic), vC = uvs.getY(ic);
				uvArr.set([uA,vA, uB,vB, uC,vC]);
			}
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
				pA.x,pA.y,pA.z,
				pB.x,pB.y,pB.z,
				pC.x,pC.y,pC.z,
			]), 3));
			// Flat normal for stable lighting
			const n = new THREE.Vector3().subVectors(pB, pA).cross(new THREE.Vector3().subVectors(pC, pA)).normalize();
			g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([n.x,n.y,n.z, n.x,n.y,n.z, n.x,n.y,n.z]), 3));
			if (uvArr) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
			// Pick material, clone to enable polygon offset without touching shared mats
			let mat = material;
			if (!mat) mat = getActiveSharedMaterial(currentMaterialStyle) || material;
			mat = mat && mat.clone ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
			mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
			const child = new THREE.Mesh(g, mat);
			child.userData.__materialOverride = true; // respect global overrides
			return child;
		} catch { return null; }
	}

	function applyMaterialToPickedFace(customMaterial=null){
		if (!__lastPickedFace) return false;
		const { mesh, faceIndex } = __lastPickedFace;
		const child = __makeFaceOverlayMesh(mesh, faceIndex, customMaterial);
		if (!child) return false;
		__disposeFacePreview();
		try { mesh.add(child); } catch {}
		// Clear pick state but keep ability to re-apply later
		__lastPickedFace = null;
		return true;
	}

	function clearAllFaceOverrides(){
		try {
			const toRemove = [];
			scene.traverse((node)=>{ if (node && node.userData && node.userData.__materialOverride && node.parent) toRemove.push(node); });
			toRemove.forEach(n=>{ try { n.parent.remove(n); } catch{} try { n.geometry && n.geometry.dispose && n.geometry.dispose(); } catch{} try { const mm=n.material; if(Array.isArray(mm)) mm.forEach(m=>m&&m.dispose&&m.dispose()); else mm&&mm.dispose&&mm.dispose(); } catch{} });
			__disposeFacePreview();
		} catch {}
	}

	// Auto-pick face on click when Texture Editor target is set to "face"
	window.addEventListener('pointerdown', (e)=>{
		try {
			const target = (document.querySelector('input[name="teTarget"]:checked')?.value) || 'object';
			if (target !== 'face') { __disposeFacePreview(); __lastPickedFace = null; return; }
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const hits = raycaster.intersectObjects(selectableTargets(), true) || [];
			const hit = hits.find(h => h.object && h.object.isMesh && Number.isInteger(h.faceIndex));
			__disposeFacePreview(); __lastPickedFace = null;
			if (hit) {
				__lastPickedFace = { mesh: hit.object, faceIndex: hit.faceIndex };
				const previewMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.35, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
				__lastFacePreview = __makeFaceOverlayMesh(hit.object, hit.faceIndex, previewMat);
				if (__lastFacePreview) try { hit.object.add(__lastFacePreview); } catch {}
			}
		} catch {}
	}, true);

	// Apply from texture editor: build a material from provided files when target=face
	document.addEventListener('sketcher:texture-editor:apply', async (ev)=>{
		try {
			const detail = ev.detail || {}; const target = detail.target || 'object';
			if (target !== 'face') return;
			// Build a MeshStandardMaterial from files if any; else use current shared
			const files = detail.files || {};
			async function texFromFile(f){
				if (!f) return null; return new Promise((resolve)=>{
					try {
						const url = URL.createObjectURL(f);
						new THREE.TextureLoader().load(url, (tex)=>{ try { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; URL.revokeObjectURL(url); } catch {} resolve(tex); }, undefined, ()=>{ try { URL.revokeObjectURL(url); } catch {} resolve(null); });
					} catch { resolve(null); }
				});
			}
			let mat = null;
			if (files && (files.base || files.normal || files.roughness || files.metalness || files.ao || files.emissive || files.alpha)){
				mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
				const [map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, alphaMap] = await Promise.all([
					texFromFile(files.base), texFromFile(files.normal), texFromFile(files.roughness), texFromFile(files.metalness), texFromFile(files.ao), texFromFile(files.emissive), texFromFile(files.alpha)
				]);
				if (map) mat.map = map;
				if (normalMap) { mat.normalMap = normalMap; mat.normalScale = new THREE.Vector2(detail.normalScale || 1, detail.normalScale || 1); }
				if (roughnessMap) { mat.roughnessMap = roughnessMap; }
				if (metalnessMap) { mat.metalnessMap = metalnessMap; }
				if (aoMap) { mat.aoMap = aoMap; }
				if (emissiveMap) { mat.emissiveMap = emissiveMap; mat.emissive = new THREE.Color(0xffffff); }
				if (alphaMap) { mat.alphaMap = alphaMap; mat.transparent = true; }
				// Repeats/offsets/rotation
				const rep = detail.repeat || {x:1,y:1}; const off = detail.offset || {x:0,y:0}; const rot = detail.rotation || 0;
				[mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap, mat.alphaMap].forEach(t=>{
					if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep.x||1, rep.y||1); t.offset.set(off.x||0, off.y||0); t.rotation = rot||0; t.needsUpdate = true; }
				});
				if (typeof detail.scalars?.roughness === 'number') mat.roughness = detail.scalars.roughness;
				if (typeof detail.scalars?.metalness === 'number') mat.metalness = detail.scalars.metalness;
			}
			const ok = applyMaterialToPickedFace(mat);
			if (!ok) alert('Pick a face first (Pick Face), then Apply.');
		} catch (e) { console.error('Face apply failed', e); }
	});

	document.addEventListener('sketcher:texture-editor:clear', ()=>{ try { clearAllFaceOverrides(); } catch {} });

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
		// Ensure grid has sufficient contrast against background to avoid a "blank" look
		ensureGridContrastWithBackground();
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
		bgColorPicker.addEventListener('input',()=>{ renderer.setClearColor(bgColorPicker.value); try { localStorage.setItem('sketcher.bgColor', bgColorPicker.value); } catch {} ensureGridContrastWithBackground(); });
		bgColorPicker.addEventListener('change',()=>{ renderer.setClearColor(bgColorPicker.value); try { localStorage.setItem('sketcher.bgColor', bgColorPicker.value); } catch {} ensureGridContrastWithBackground(); });
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
			[primsGroup, drawCreateGroup, importGroup, sceneManagerGroup, utilsGroup, viewsGroup, roomGroup].forEach(panel => {
				if(panel) {
					panel.classList.remove('open');
					panel.setAttribute('aria-hidden','true');
				}
			});
			[togglePrimsBtn, toggleDrawCreateBtn, toggleImportBtn, toggleSceneManagerBtn, toggleUtilsBtn, toggleViewsBtn, toggleRoomBtn].forEach(btn => {
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
				// If closing Draw/Create parent, clear any active draw tool
				if (isOpen && group === drawCreateGroup) {
					try {
						activeDrawTool = null;
						[dcBoxBtn, dcSphereBtn, dcCylinderBtn, dcConeBtn].forEach(btn=>{ if(btn) btn.setAttribute('aria-pressed','false'); });
					} catch {}
				}
				// After any toggle, keep the delete bar docked below toolbox
				placeMobileDeleteBar();
			});
		}
	if (togglePrimsBtn && primsGroup) togglePanel(togglePrimsBtn, primsGroup);
	if (toggleDrawCreateBtn && drawCreateGroup) togglePanel(toggleDrawCreateBtn, drawCreateGroup);
	if (toggleRoomBtn && roomGroup) togglePanel(toggleRoomBtn, roomGroup);
	// On resize, keep the delete bar docked too
	window.addEventListener('resize', () => { placeMobileDeleteBar(); });
	if (toggleImportBtn && importGroup) togglePanel(toggleImportBtn, importGroup);
	if (toggleSceneManagerBtn && sceneManagerGroup) togglePanel(toggleSceneManagerBtn, sceneManagerGroup);
	if (toggleUtilsBtn && utilsGroup) togglePanel(toggleUtilsBtn, utilsGroup);
	if (toggleViewsBtn && viewsGroup) togglePanel(toggleViewsBtn, viewsGroup);
	if (toggleSettingsBtn && settingsGroup) togglePanel(toggleSettingsBtn, settingsGroup);

	// Room: wire Host/Join buttons
	(function wireRoomButtons(){
		try{
			const hostBtn = document.getElementById('hostRoom');
			const joinBtn = document.getElementById('joinRoom');
			const ensure = (hint)=>{ let r = prompt(hint||'Enter room name'); if (r) r=r.trim(); return r||null; };
			const updateBadge = (room, isHost)=>{ try { const vb = document.getElementById('version-badge'); if (vb){ vb.textContent = vb.textContent.replace(/\s*·\s*Room:.*$/, ''); if(room){ vb.textContent += `  ·  Room:${room}${isHost?' (host)':''}`; } } } catch{} };
			if (hostBtn) hostBtn.addEventListener('click', async ()=>{ try { if (!collab && createCollab){ collab = createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData }); }
				if (collab?.isActive?.()){ alert('Already in a room'); return; }
				const r = ensure('Enter room name to host'); if(!r) return; await collab.host(r); updateBadge(r, true); } catch{} });
			if (joinBtn) joinBtn.addEventListener('click', async ()=>{ try { if (!collab && createCollab){ collab = createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData }); }
				if (collab?.isActive?.()){ alert('Already in a room'); return; }
				const r = ensure('Enter room name to join'); if(!r) return; await collab.join(r); updateBadge(r, false); } catch{} });
		} catch{}
	})();

	// Handle room actions from XR HUD
	window.addEventListener('sketcher:room', async (ev)=>{
		try{
			const d = ev && ev.detail || {}; const action = d.action; const room = (d.room||'').trim(); if (!action || !room) return;
			if (!collab && createCollab){ collab = createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData }); }
			if (collab?.isActive?.()){ alert('Already in a room'); return; }
			if (action === 'host') await collab.host(room); else if (action === 'join') await collab.join(room);
			try { const vb = document.getElementById('version-badge'); if (vb){ vb.textContent = vb.textContent.replace(/\s*·\s*Room:.*$/, ''); vb.textContent += `  ·  Room:${room}${action==='host'?' (host)':''}`; } } catch{}
		} catch{}
	});
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
	function prepareModelForUSDZ(root){ try { (arExport.prepareModelForUSDZ||arExport.prepareModelForAR)(THREE, root); } catch {} }
	async function openQuickLookUSDZ(){ const source=(selectedObjects && selectedObjects.length)?selectedObjects:objects; if(!source||!source.length){ alert('Nothing to show in AR. Create or import an object first.'); return; } const root=buildExportRootFromObjects(source); prepareModelForUSDZ(root); try { const { USDZExporter } = await import('https://unpkg.com/three@0.155.0/examples/jsm/exporters/USDZExporter.js'); const exporter=new USDZExporter(); const arraybuffer=await exporter.parse(root); const blob=new Blob([arraybuffer],{type:'model/vnd.usdz+zip'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.setAttribute('rel','ar'); a.setAttribute('href',url); document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },30000); } catch(e){ alert('Unable to generate USDZ for AR: ' + (e?.message || e)); console.error(e); } }

	arButton.addEventListener('click', async () => {
		await loadWebXRPolyfillIfNeeded();
		const isSecure = window.isSecureContext || location.protocol === 'https:';
		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
		if (!isSecure) { alert('AR/VR requires HTTPS. Please host this page over https://'); return; }
		try {
			const xr = navigator.xr;
			const supportsVR = xr && await xr.isSessionSupported('immersive-vr');
			const supportsAR = xr && await xr.isSessionSupported('immersive-ar');

			// Prefer immersive-AR on Meta Quest if available; otherwise fall back to VR
			if (supportsAR) {
				// immersive AR (Quest passthrough or mobile AR)
				// Save a restore point before entering XR
				try { saveSessionDraftNow(); } catch {}
				// Ensure teleport discs interactive in XR
				try { if (window.__teleport && window.__teleport.setActive) window.__teleport.setActive(true); } catch{}
				const arOptions = { requiredFeatures: ['local-floor'], optionalFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root: document.body } };
				try { if (!arOptions.optionalFeatures.includes('hand-tracking')) arOptions.optionalFeatures.push('hand-tracking'); } catch {}
				const session = await navigator.xr.requestSession('immersive-ar', arOptions);
				renderer.xr.setSession(session);
				// Ensure world transform is clean before XR begins
				resetSceneTransform();
				// Default to Grab (pinch) on session start
				setXRInteractionMode(false);
				try { arEdit.setTarget(null); arEdit.start(session); } catch {}
				arActive = true;
				arPlaced = false;
				grid.visible = false;
				ensureXRHud3D(); if (xrHud3D) xrHud3D.visible = true;
				// Setup reference spaces; align to local-floor for ground alignment
				xrLocalSpace = await session.requestReferenceSpace('local-floor');
				xrViewerSpace = await session.requestReferenceSpace('viewer').catch(()=>null);
				session.addEventListener('end', () => {
					arActive = false;
					try { arEdit.stop(); } catch {}
					grid.visible = true;
					try { if (window.__teleport && window.__teleport.hideReticle) window.__teleport.hideReticle(); } catch{}
					// Reset scene transform after XR ends to clear any residual offsets
					resetSceneTransform();
						// If edits occurred, offer to apply them back to the editor scene
					try {
							const info = (typeof arEdit.getDirtyInfo === 'function') ? arEdit.getDirtyInfo() : { any:false, nodes:[] };
							const hadPerObject = !!info.any;
							const hasClone = !!arContent;
							if (hadPerObject || hasClone) {
								const ok = confirm('Apply XR adjustments (move/scale/rotate) back to the 3D workspace?');
								if (ok) {
									// First, per-object dirty nodes
									if (hadPerObject) {
										const METERS_TO_FEET = 1.0 / FEET_TO_METERS;
										const { setWorldMatrix } = transforms;
										for (const n of info.nodes) {
											if (!n) continue;
											const orig = n.userData && n.userData.__sourceRef;
											if (!orig) continue;
											try {
												n.updateMatrixWorld(true);
												const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
												n.matrixWorld.decompose(pos, quat, scl);
												pos.multiplyScalar(METERS_TO_FEET);
												scl.multiplyScalar(METERS_TO_FEET);
												const worldFeet = new THREE.Matrix4().compose(pos, quat, scl);
												setWorldMatrix(orig, worldFeet);
											} catch(e){ console.warn('Apply XR edit failed for node', n, e); }
										}
									}
									// Then, whole-clone placement back to originals (handles global move/scale)
									if (hasClone) { try { __applyXRCloneTopLevelToOriginals(arContent); } catch{} }
									try { saveSessionDraftNow(); } catch{}
								}
								try { arEdit.clearDirty && arEdit.clearDirty(); } catch{}
							}
					} catch{}
					if (arContent) { scene.remove(arContent); arContent = null; }
					if (__scaleDebugGroup && __scaleDebugGroup.parent) { __scaleDebugGroup.parent.remove(__scaleDebugGroup); __scaleDebugGroup = null; }
					arPlaced = false;
					xrHitTestSource = null; xrViewerSpace = null; xrLocalSpace = null;
					removeXRHud3D();
					// Restore editor object visibility
					try {
						if (arPrevVisibility) {
							for (const [o, v] of arPrevVisibility.entries()) { o.visible = !!v; }
							arPrevVisibility = null;
							updateVisibilityUI();
						}
					} catch {}
					// Safety: if scene appears empty or all user objects ended up hidden after XR, restore from session draft
					try {
						const items = getPersistableObjects();
						const anyVisible = items && items.some(o => o && o.visible !== false);
						if (!items || items.length === 0 || !anyVisible) {
							const raw = sessionStorage.getItem('sketcher:sessionDraft');
							if (raw) {
								const { json } = JSON.parse(raw);
								if (json) {
									clearSceneObjects();
									const loader = new THREE.ObjectLoader();
									const root = loader.parse(json);
									[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
									updateCameraClipping();
								}
							}
						}
					} catch {}
					// Return UI to Edit mode
					modeSelect.value = 'edit';
					modeSelect.dispatchEvent(new Event('change'));
				});

					// Defensive: restore any AR/outline materials on the live scene
					try { if (typeof clearOutlineModeForAR === 'function') clearOutlineModeForAR(THREE, scene); } catch {}
					try { if (typeof restoreMaterialsForARInPlace === 'function') restoreMaterialsForARInPlace(THREE, scene); } catch {}

					// When XR session ends, clear HUD active states
					try {
						setHudButtonActiveByLabel('1:1', false);
						setHudButtonActiveByLabel('Lock Ground', false);
						arGroundLocked = false;
					} catch {}
			} else if (supportsVR) {
				// Start immersive VR for headsets; use hands/controllers for manipulation
				// Save a restore point before entering XR
				try { saveSessionDraftNow(); } catch {}
				// Ensure teleport discs interactive in XR
				try { if (window.__teleport && window.__teleport.setActive) window.__teleport.setActive(true); } catch{}
				const vrOptions = { optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'], domOverlay: { root: document.body } };
				try { if (!vrOptions.optionalFeatures.includes('hand-tracking')) vrOptions.optionalFeatures.push('hand-tracking'); } catch {}
				const session = await navigator.xr.requestSession('immersive-vr', vrOptions);
				renderer.xr.setSession(session);
				// Ensure world transform is clean before XR begins
				resetSceneTransform();
				// Default to Grab (pinch) on session start
				setXRInteractionMode(false);
				try { arEdit.setTarget(null); arEdit.start(session); } catch {}
				arActive = true; arPlaced = false; grid.visible = false;
				ensureXRHud3D(); if (xrHud3D) xrHud3D.visible = true;
				// Keep originals visible until AR clone is created (we'll hide after placement)
				// Reference space (floor-aligned)
				xrLocalSpace = await session.requestReferenceSpace('local-floor');
				// Build content once and place 1.5m in front of the user at floor height
				try {
					const root = buildExportRootFromObjects(getARCloneSourceObjects());
					prepareModelForAR(root); // converts to meters and recenters to ground
					if (arSimplifyMaterials) simplifyMaterialsForARInPlace(THREE, root);
					arContent = root; scene.add(arContent);
					try { if (!arContent.userData) arContent.userData = {}; arContent.userData.__oneScale = FEET_TO_METERS; } catch{}
					// Place origin 1 foot in front of the user on the ground (local-floor y=0), using camera facing
					try {
						const xrCam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
						if (xrCam) {
							const camPos = new THREE.Vector3(); const camQuat = new THREE.Quaternion();
							xrCam.getWorldPosition(camPos); xrCam.getWorldQuaternion(camQuat);
							const forward = new THREE.Vector3(0,0,-1).applyQuaternion(camQuat);
							const place = camPos.clone().add(forward.multiplyScalar(0.3048));
							place.y = 0; // ground
							arContent.position.copy(place);
						} else {
							arContent.position.set(0, 0, -0.3048);
						}
					} catch { arContent.position.set(0, 0, -0.3048); }
					computeArBaseMetrics(arContent);
					try { arEdit.setTarget(arContent); } catch {}

					// If we had a pending teleport target (ray selected before model existed), apply it now
					try {
						if (arPendingTeleport && arContent){
							arContent.position.set(arPendingTeleport.x, 0, arPendingTeleport.z);
							alignModelToGround(arContent);
							arPendingTeleport = null;
						}
					} catch {}

					arPlaced = true;
					// Ensure model ground is horizontal and snapped to local-floor when placed
					try { alignModelToGround(arContent); } catch {}
							try {
								setHudButtonActiveByLabel('1:1', arOneToOne);
								arEdit.setScaleEnabled(!arOneToOne ? true : false);
							} catch {}
							// Scale debug visuals
							try {
								if (ENABLE_SCALE_DEBUG) {
									__scaleDebugGroup = new THREE.Group(); __scaleDebugGroup.name = 'Scale Debug';
									const mat1 = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.6, transparent: true });
									const cube1m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat1);
									cube1m.position.set(arContent.position.x + 0.6, 0.5, arContent.position.z);
									const mat2 = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.6, transparent: true });
									const cube1ft = new THREE.Mesh(new THREE.BoxGeometry(FEET_TO_METERS, FEET_TO_METERS, FEET_TO_METERS), mat2);
									cube1ft.position.set(arContent.position.x + 0.6 + 1.2, FEET_TO_METERS/2, arContent.position.z);
									__scaleDebugGroup.add(cube1m, cube1ft); scene.add(__scaleDebugGroup);
									console.log('AR/VR placed: arContent.scale=', arContent.scale, 'arBaseBox=', arBaseBox);
								}
							} catch(e){ console.warn('scale debug fail', e); }
					// Now hide originals to avoid duplicate visuals
					try {
						arPrevVisibility = new Map();
						for (const o of getARCloneSourceObjects()) { if (o !== arContent) { arPrevVisibility.set(o, !!o.visible); o.visible = false; } }
						updateVisibilityUI();
					} catch {}
				} catch {}
				session.addEventListener('end', () => {
					arActive = false;
					try { arEdit.stop(); } catch {}
					grid.visible = true;
					try { if (window.__teleport && window.__teleport.hideReticle) window.__teleport.hideReticle(); } catch{}
					// Reset scene transform after XR ends to clear any residual offsets
					resetSceneTransform();
						// Offer to apply XR edits back to originals (per-object and whole placement)
					try {
							const info = (typeof arEdit.getDirtyInfo === 'function') ? arEdit.getDirtyInfo() : { any:false, nodes:[] };
							const hadPerObject = !!info.any;
							const hasClone = !!arContent;
							if (hadPerObject || hasClone) {
								const ok = confirm('Apply XR adjustments (move/scale/rotate) back to the 3D workspace?');
								if (ok) {
									if (hadPerObject) {
										const METERS_TO_FEET = 1.0 / FEET_TO_METERS;
										const { setWorldMatrix } = transforms;
										for (const n of info.nodes) {
											if (!n) continue;
											const orig = n.userData && n.userData.__sourceRef;
											if (!orig) continue;
											try {
												n.updateMatrixWorld(true);
												const pos = new THREE.Vector3(); const quat = new THREE.Quaternion(); const scl = new THREE.Vector3();
												n.matrixWorld.decompose(pos, quat, scl);
												pos.multiplyScalar(METERS_TO_FEET);
												scl.multiplyScalar(METERS_TO_FEET);
												const worldFeet = new THREE.Matrix4().compose(pos, quat, scl);
												setWorldMatrix(orig, worldFeet);
											} catch(e){ console.warn('Apply XR edit failed for node', n, e); }
										}
									}
									if (hasClone) { try { __applyXRCloneTopLevelToOriginals(arContent); } catch{} }
									try { saveSessionDraftNow(); } catch{}
								}
								try { arEdit.clearDirty && arEdit.clearDirty(); } catch{}
							}
					} catch{}
					if (arContent) { scene.remove(arContent); arContent = null; }
					arPlaced = false;
					xrHitTestSource = null; xrViewerSpace = null; xrLocalSpace = null;
					removeXRHud3D();
					// Restore editor object visibility
					try {
						if (arPrevVisibility) {
							for (const [o, v] of arPrevVisibility.entries()) { o.visible = !!v; }
							arPrevVisibility = null;
							updateVisibilityUI();
						}
					} catch {}
					// Safety: if scene appears empty or all user objects ended up hidden after XR, restore from session draft
					try {
						const items = getPersistableObjects();
						const anyVisible = items && items.some(o => o && o.visible !== false);
						if (!items || items.length === 0 || !anyVisible) {
							const raw = sessionStorage.getItem('sketcher:sessionDraft');
							if (raw) {
								const { json } = JSON.parse(raw);
								if (json) {
									clearSceneObjects();
									const loader = new THREE.ObjectLoader();
									const root = loader.parse(json);
									[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); });
									updateCameraClipping();
								}
							}
						}
					} catch {}
					// Return UI to Edit mode
					modeSelect.value = 'edit';
					modeSelect.dispatchEvent(new Event('change'));
				});
			} else if (isIOS) {
				await openQuickLookUSDZ();
			} else {
				// Desktop/laptop fallback: enter First-Person walk mode
				try { if (controls) controls.enabled = false; __fpControlsDisabled = true; } catch{}
				firstPerson.start({ hFov: 100, constrainHeight: true });
				__enterFirstPersonSideEffects();
			}
		} catch (e) { alert('Failed to start AR/VR: ' + (e?.message || e)); console.error(e); }
	});
	// Room Scan (beta) using service API
	document.addEventListener('sketcher:startRoomScan', async () => {
		await loadWebXRPolyfillIfNeeded();
		roomScan.startRoomScan();
	});

	// Upload model
	uploadBtn.addEventListener('click',()=>fileInput.click());
	fileInput.addEventListener('change',async e=>{
		const file=e.target.files[0]; if(!file)return;
		const lower=file.name.toLowerCase();
		const processingBanner = document.getElementById('processingBanner');
		const processingTitle = document.getElementById('processingTitle');
		const processingStep = document.getElementById('processingStep');
		const processingBar = document.getElementById('processingBar');
		function showProcessing(title, step){ try { if (processingTitle) processingTitle.textContent = title; if (processingStep) processingStep.textContent = step; if (processingBar) processingBar.style.width = '0%'; if (processingBanner) processingBanner.style.display = 'block'; } catch{} }
		function updateProcessing(p){ try { if (processingBar) processingBar.style.width = Math.max(0, Math.min(100, Math.floor(p*100))) + '%'; } catch{} }
		function hideProcessing(){ try { if (processingBanner) processingBanner.style.display = 'none'; } catch{} }
		if (lower.endsWith('.rvt')){
			alert('Revit (.rvt) files are not directly supported in-browser.\n\nPlease export your model from Revit as OBJ/FBX/GLTF (or via the Revit add-in or FormIt/3ds Max) and import that here.');
			fileInput.value='';
			return;
		}
		// IFC support
		if (lower.endsWith('.ifc')){
			showProcessing('Importing IFC…', 'Parsing geometry and materials');
			try {
				const url = URL.createObjectURL(file);
				const { IFCLoader } = await import('../vendor/IFCLoader.js');
				const ifcLoader = new IFCLoader();
				// Configure WASM path; using CDN default. You can host locally under assets/ifc/ if preferred.
				if (ifcLoader.ifcManager && typeof ifcLoader.ifcManager.setWasmPath === 'function') {
					ifcLoader.ifcManager.setWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.50/');
				}
				ifcLoader.load(url, (model) => {
					try {
						loadedModel = model.scene || model; // IFCLoader returns a mesh/group
						// IFCs are typically in meters; convert to feet to match Sketcher scene units
						const METERS_TO_FEET = 1.0 / 0.3048;
						loadedModel.scale.multiplyScalar(METERS_TO_FEET);
						// Ensure materials keep textures; IFCLoader builds MeshStandardMaterials already
						// Show placing popup with file name
						if (placingName) placingName.textContent = file.name;
						if (placingPopup) placingPopup.style.display = 'block';
						hideProcessing();
					} finally {
						URL.revokeObjectURL(url);
					}
				}, (prog)=>{ try { if (prog && prog.total) updateProcessing(prog.loaded / prog.total); } catch{} }, (err)=>{
					console.error('IFC load error', err);
					alert('Failed to load IFC: ' + (err?.message || err));
					hideProcessing();
					URL.revokeObjectURL(url);
				});
			} catch (err){
				console.error(err);
				alert('IFC import failed: ' + (err?.message || err));
				hideProcessing();
			}
			return;
		}
	const url=URL.createObjectURL(file);
	const loader=lower.endsWith('.obj')?new OBJLoader():new GLTFLoader();
	// Show processing UI for all imports, including OBJ
	showProcessing('Importing Model…', lower.endsWith('.obj') ? 'Parsing OBJ geometry' : 'Preparing textures and geometry');
		try {
			if (loader.setKTX2Loader){
				const { KTX2Loader } = await import('../vendor/KTX2Loader.js');
				const ktx2 = new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/libs/basis/').detectSupport(renderer);
				loader.setKTX2Loader(ktx2);
			}
		} catch {}
		try {
			if (loader.setDRACOLoader){
				const { DRACOLoader } = await import('../vendor/DRACOLoader.js');
				const draco = new DRACOLoader();
				draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/libs/draco/');
				loader.setDRACOLoader(draco);
			}
		} catch {}
		try {
			if (loader.setMeshoptDecoder){
				const { MeshoptDecoder } = await import('../vendor/meshopt_decoder.js');
				loader.setMeshoptDecoder(MeshoptDecoder);
			}
		} catch {}
		loader.load(url, async gltf=>{
			try {
				loadedModel=gltf.scene||gltf;
				if (lower.endsWith('.obj')){
					// Offer optimization for large OBJs
					const mb = Math.round((file.size/1024/1024)*10)/10;
					let mode = 'Fast';
					if (file.size > 25*1024*1024){
						try {
							mode = await askChoice('Large OBJ detected', `This OBJ is ~${mb} MB. Optimize to improve performance?`, ['Fast (weld vertices)','Aggressive (weld + simplify)','Skip']);
							if (!mode) mode = 'Fast';
						} catch {}
					}
					showProcessing('Optimizing OBJ…', 'Welding vertices'); updateProcessing(0.05);
					const [{ optimizeObject3D }] = await Promise.all([
						import('./services/optimize-import.js')
					]);
					const simplify = mode && mode.startsWith('Aggressive');
					await optimizeObject3D(loadedModel, { weldTolerance: 1e-4, simplify, voxelSize: 0.01, onProgress: (p)=>{ try { updateProcessing(0.05 + p*0.6); } catch{} } });
					// Optionally downscale very large textures to tame memory.
					// Preserve quality by default; only shrink when Aggressive or low device memory / very large model.
					const devMem = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
					let maxTex = null;
					if (simplify) {
						maxTex = 2048; // Aggressive path favors perf
					} else if (devMem < 4 && file.size > 15*1024*1024) {
						maxTex = 2048; // Low-memory devices
					} else if (file.size > 50*1024*1024) {
						maxTex = 3072; // Very large OBJ
					} else if (devMem >= 8) {
						maxTex = 4096; // High-end: allow 4K
					}
					if (maxTex) {
						showProcessing('Optimizing OBJ…', 'Resizing large textures'); updateProcessing(0.7);
						try {
							const [{ downscaleLargeTextures }] = await Promise.all([
								import('./services/texture-utils.js')
							]);
							await downscaleLargeTextures(loadedModel, { maxSize: maxTex, onProgress: (p)=>{ try { updateProcessing(0.7 + p*0.25); } catch{} } });
						} catch {}
					}
					updateProcessing(0.98);
				}
				// Show placing popup with file name
				if (placingName) placingName.textContent = file.name;
				if (placingPopup) placingPopup.style.display = 'block';
			} finally {
				URL.revokeObjectURL(url);
				hideProcessing();
			}
		}, (prog)=>{ try { if (prog && prog.total) updateProcessing(prog.loaded / prog.total); } catch{} }, (err)=>{ console.error(err); alert('Model import failed: ' + (err?.message || err)); hideProcessing(); URL.revokeObjectURL(url); });
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

	// IFC export (Utilities group)
	const exportIFCBtn = document.getElementById('exportIFC');
	if (exportIFCBtn) exportIFCBtn.addEventListener('click', async ()=>{
		try {
			const [{ exportIFC }] = await Promise.all([
				import('./services/ifc-export.js')
			]);
			// Step 1: scope selection
			const hasSel = selectedObjects && selectedObjects.length;
			const scope = hasSel ? await askChoice('Export IFC', 'Choose what to export:', ['Selected objects','Entire scene']) : 'Entire scene';
			if (!scope) return;
			const objs = (scope==='Selected objects' && hasSel) ? selectedObjects : objects;
			if (!objs || !objs.length){ alert('Nothing to export. Create or import an object first.'); return; }
			// Step 2: basic metadata
			const projectName = await askPrompt('Project Name', 'Enter a project name for IFC:', 'Sketcher Project'); if (projectName===null) return;
			const author = await askPrompt('Author', 'Your name/organization:', 'Sketcher'); if (author===null) return;
			// Step 3: classification scheme (Revit-friendly)
			const scheme = await askChoice('Classification', 'Choose classification mapping:', ['By name keywords (Wall/Floor/etc.)','All as Generic Model']); if (!scheme) return;
			const classify = (scheme==='All as Generic Model') ? (()=>'IfcBuildingElementProxy') : undefined; // exporter uses defaultClassifier otherwise
			// Step 4: export
			showProcessing('Exporting IFC…'); updateProcessing(0.2);
			const root = new THREE.Group(); objs.forEach(o=>root.add(o));
			const blob = exportIFC(THREE, root, { projectName, author, classify });
			updateProcessing(0.9);
			const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(projectName||'sketcher')+'.ifc'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
			hideProcessing();
		} catch (e){ console.error(e); hideProcessing(); alert('IFC export failed: ' + (e?.message || e)); }
	});

	async function askChoice(title, msg, choices){
		return new Promise(resolve=>{
			const d = document.createElement('dialog');
			d.style.padding='14px 16px'; d.style.borderRadius='10px'; d.style.border='1px solid #666';
			d.innerHTML = `<div style="font-weight:600; margin-bottom:6px">${title}</div><div style="margin-bottom:10px">${msg}</div>`;
			const row=document.createElement('div'); row.style.display='flex'; row.style.gap='8px';
			choices.forEach(c=>{ const b=document.createElement('button'); b.textContent=c; b.onclick=()=>{ d.close(); d.remove(); resolve(c); }; row.appendChild(b); });
			const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>{ d.close(); d.remove(); resolve(null); }; cancel.style.marginLeft='auto';
			const footer=document.createElement('div'); footer.style.display='flex'; footer.style.marginTop='10px'; footer.appendChild(cancel);
			d.appendChild(row); d.appendChild(footer); document.body.appendChild(d); d.showModal();
		});
	}
	async function askPrompt(title, msg, def){
		return new Promise(resolve=>{
			const d=document.createElement('dialog'); d.style.padding='14px 16px'; d.style.borderRadius='10px'; d.style.border='1px solid #666';
			d.innerHTML=`<div style="font-weight:600; margin-bottom:6px">${title}</div><div style="margin-bottom:10px">${msg}</div>`;
			const input=document.createElement('input'); input.type='text'; input.value=def||''; input.style.width='280px';
			const row=document.createElement('div'); row.appendChild(input);
			const ok=document.createElement('button'); ok.textContent='OK'; ok.onclick=()=>{ const v=input.value; d.close(); d.remove(); resolve(v); };
			const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>{ d.close(); d.remove(); resolve(null); };
			const footer=document.createElement('div'); footer.style.display='flex'; footer.style.gap='8px'; footer.style.marginTop='10px'; footer.append(ok,cancel);
			d.append(row, footer); document.body.appendChild(d); d.showModal(); input.select();
		});
	}

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
	function intersectGround(){ const pt=new THREE.Vector3(); return raycaster.ray.intersectPlane(groundPlane, pt) ? pt : null; }
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
			// If a loaded object is a teleport disc, re-register it so picking and activation work
			try { if (__isTeleportDisc(obj)) __registerTeleportDisc(obj); } catch{}
		// Skip applying global material styles to map imports
			const __isMapImportObj = !!(obj && ((obj.userData && (obj.userData.__mapImport === true || obj.userData.mapImport === true)) || (obj.name === 'Imported Topography' || obj.name === 'Imported Flat Area')));
			const __isTeleportObj = !!__isTeleportDisc(obj);
			if (!__isMapImportObj && !__isTeleportObj){
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
		// Broadcast adds to collaborators (ignore during remote apply)
		try { if (collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) { collab.onAdd(obj); } } catch{}
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
		// Suppress editing in First-Person walk mode
		if (firstPerson && firstPerson.isActive && firstPerson.isActive()) { try { e.preventDefault(); } catch{} return; }
		if (transformControls.dragging || transformControlsRotate.dragging) return;
		if (e.pointerType==='touch' || e.pointerType==='pen') { activeTouchPointers.add(e.pointerId); if(activeTouchPointers.size>1) return; }
			getPointer(e); raycaster.setFromCamera(pointer,camera);
				// Editor: clicking a jump disc should select it, not teleport. Teleport remains in viewer modes.
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
			if (firstPerson && firstPerson.isActive && firstPerson.isActive()) { try { e.preventDefault(); } catch{} return; }
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
	if (firstPerson && firstPerson.isActive && firstPerson.isActive()) { return; }
		// Update live preview for two-click placement
		if (placingTool && placingStage===1){ getPointer(e); raycaster.setFromCamera(pointer,camera); const pt = intersectGround(); if (pt) updatePlacingPreview(pt, { shift: !!e.shiftKey }); }
		// Hover highlight for teleport discs
		try {
			getPointer(e); raycaster.setFromCamera(pointer, camera);
			const dh = raycaster.intersectObjects(getTeleportDiscs(), true);
			getTeleportDiscs().forEach(d=>highlightTeleportDisc(d,false));
			if (dh && dh.length){ const d = __getTeleportDiscRoot(dh[0].object); if (d) highlightTeleportDisc(d,true); }
		} catch{}
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
	// Delete (prevent deleting the 2D Overlay or any of its children)
	window.addEventListener('keydown', e => {
		if (mode === 'edit' && (e.key === 'Delete' || e.key === 'Backspace')) {
			const toDeleteRaw = selectedObjects.length ? [...selectedObjects] : (transformControls.object ? [transformControls.object] : []);
			const toDelete = toDeleteRaw.filter(o => !__isOverlayOrChild(o));
			if (!toDelete.length) return;
			toDelete.forEach(sel => { try { if (collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) collab.onDelete(sel); } catch{} scene.remove(sel); const idx = objects.indexOf(sel); if (idx > -1) objects.splice(idx, 1); });
			selectedObjects = []; transformControls.detach(); clearSelectionOutlines(); updateVisibilityUI(); updateCameraClipping(); saveSessionDraftNow();
		}
	});

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
            				// First-person update (dt in seconds)
				{
					const now = (typeof performance!=='undefined'?performance.now():Date.now());
					if (!window.__fp_prev) window.__fp_prev = now;
					const dt = Math.min(0.1, Math.max(0, (now - window.__fp_prev)/1000));
					window.__fp_prev = now;
            					firstPerson.update(dt);
						// If FP mode has been exited, re-enable OrbitControls and restore editing/toolbox once
						if (__fpControlsDisabled && !firstPerson.isActive()) {
							try { if (controls) controls.enabled = true; } catch{}
							__fpControlsDisabled = false;
							__exitFirstPersonSideEffects();
						}
				}
				// XR controller menu button polling to toggle AR UI
				handleXRMenuTogglePoll(frame);
				// XR controller trigger teleport (rising edge)
				(function xrTeleportPoll(){
					try {
						const session = renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null; if (!session || !frame) return;
						if (!window.__teleport) return;
						const discs = window.__teleport.getTeleportDiscs(); if (!discs || !discs.length) return;
						if (!window.__xrTriggerPrev) window.__xrTriggerPrev = new WeakMap();
						if (!window.__xrPinchPrev) window.__xrPinchPrev = new WeakMap();
						const sources = session.inputSources ? Array.from(session.inputSources) : [];
						for (const src of sources){
							const gp = src && src.gamepad; const raySpace = src && (src.targetRaySpace || src.gripSpace);
							// Controller trigger teleport
							if (gp && raySpace){
								const pressed = !!(gp.buttons && gp.buttons[0] && gp.buttons[0].pressed);
								const prev = window.__xrTriggerPrev.get(src) === true;
								if (pressed && !prev){
									// Skip teleport if HUD is being hovered by controller
									if (typeof window.__xrHudHover === 'boolean' && window.__xrHudHover) { window.__xrTriggerPrev.set(src, pressed); continue; }
									// Allow teleport only in Ray mode
									if (!xrInteractionRay) { window.__xrTriggerPrev.set(src, pressed); continue; }
									const pose = frame.getPose(raySpace, xrLocalSpace || xrViewerSpace || null) || frame.getPose(raySpace, renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace());
									if (pose){
										const p = pose.transform.position; const o = pose.transform.orientation;
										const origin = new THREE.Vector3(p.x,p.y,p.z);
										const dir = new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w)).normalize();
										const rc = new THREE.Raycaster(origin, dir, 0.01, 200);
										// 1) Try free-aim surface teleport
										try {
											const sceneTargets = [];
											scene.traverse(obj=>{ if (!obj || !obj.visible) return; if (obj.userData?.__helper) return; if (obj.isMesh) sceneTargets.push(obj); });
											const hits = rc.intersectObjects(sceneTargets, true);
											let picked = null;
											for (const h of hits){
												if (!h.face) continue;
												// Skip teleport discs
												let cur=h.object; let isDisc=false; while(cur){ if (cur.userData && cur.userData.__teleportDisc){ isDisc=true; break; } cur=cur.parent; }
												if (isDisc) continue;
												const nLocal = h.face.normal.clone();
												const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
												const nWorld = nLocal.applyMatrix3(nm).normalize();
												if (nWorld.dot(new THREE.Vector3(0,1,0)) >= 0.64){ picked = { point:h.point.clone(), normal:nWorld }; break; }
											}
											if (picked && window.__teleport && window.__teleport.teleportToPoint){ window.__teleport.teleportToPoint(picked.point, picked.normal); }
											else {
												// 2) Fallback to pre-placed discs
												const ih = rc.intersectObjects(discs, true);
												if (ih && ih.length){ const d = (function find(o){ while(o && !o.userData?.__teleportDisc) o=o.parent; return o; })(ih[0].object); if (d){ try { window.__teleport.highlightTeleportDisc(d, true); } catch{} window.__teleport.teleportToDisc(d); } }
											}
										} catch{}
									}
								}
								window.__xrTriggerPrev.set(src, pressed);
								continue;
							}
							// Hand-tracking pinch teleport (right hand only) in Ray mode
							if (src && src.handedness === 'right' && src.hand && xrInteractionRay){
								try {
									const ti = src.hand.get && src.hand.get('index-finger-tip');
									const tt = src.hand.get && src.hand.get('thumb-tip');
									if (!ti || !tt) continue;
									const pti = frame.getJointPose(ti, xrLocalSpace || xrViewerSpace || null);
									const ptt = frame.getJointPose(tt, xrLocalSpace || xrViewerSpace || null);
									if (!pti || !ptt) continue;
									const dx = pti.transform.position.x - ptt.transform.position.x;
									const dy = pti.transform.position.y - ptt.transform.position.y;
									const dz = pti.transform.position.z - ptt.transform.position.z;
									const dist = Math.hypot(dx,dy,dz);
									const prevPinch = window.__xrPinchPrev.get(src) === true;
									const isPinch = dist < 0.035; // ~3.5cm
									if (isPinch && !prevPinch){
										// Skip if HUD is hovered
										if (typeof window.__xrHudHover === 'boolean' && window.__xrHudHover) { window.__xrPinchPrev.set(src, isPinch); continue; }
										// Cast ray from fingertip orientation
										const p = pti.transform.position; const o = pti.transform.orientation;
										const origin = new THREE.Vector3(p.x,p.y,p.z);
										const dir = new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w)).normalize();
										const rc = new THREE.Raycaster(origin, dir, 0.01, 200);
										// 1) Try free-aim surface teleport
										try {
											const sceneTargets = [];
											scene.traverse(obj=>{ if (!obj || !obj.visible) return; if (obj.userData?.__helper) return; if (obj.isMesh) sceneTargets.push(obj); });
											const hits = rc.intersectObjects(sceneTargets, true);
											let picked = null;
											for (const h of hits){
												if (!h.face) continue;
												// Skip teleport discs
												let cur=h.object; let isDisc=false; while(cur){ if (cur.userData && cur.userData.__teleportDisc){ isDisc=true; break; } cur=cur.parent; }
												if (isDisc) continue;
												const nLocal = h.face.normal.clone();
												const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
												const nWorld = nLocal.applyMatrix3(nm).normalize();
												if (nWorld.dot(new THREE.Vector3(0,1,0)) >= 0.64){ picked = { point:h.point.clone(), normal:nWorld }; break; }
											}
											if (picked && window.__teleport && window.__teleport.teleportToPoint){ window.__teleport.teleportToPoint(picked.point, picked.normal); }
											else {
												// 2) Fallback to pre-placed discs
												const ih = rc.intersectObjects(discs, true);
												if (ih && ih.length){ const d = (function find(o){ while(o && !o.userData?.__teleportDisc) o=o.parent; return o; })(ih[0].object); if (d){ try { window.__teleport.highlightTeleportDisc(d, true); } catch{} window.__teleport.teleportToDisc(d); } }
											}
										} catch{}
									}
									window.__xrPinchPrev.set(src, isPinch);
								} catch{}
							}
						}
					} catch{}
				})();
				// XR HUD update via service
				xrHud.update(frame);
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
				// One-time placement for AR passthrough: 1:1 meters, ground-aligned, 1 foot in front
				const session = renderer.xr.getSession && renderer.xr.getSession();
				if (session && !arPlaced && frame && xrLocalSpace) {
					if (!arContent) {
						const root = buildExportRootFromObjects(getARCloneSourceObjects());
						prepareModelForAR(root);
						if (arMatMode === 'outline') applyOutlineModeForARInPlace(THREE, root);
						else if (arMatMode === 'lite') simplifyMaterialsForARInPlace(THREE, root);
						arContent = root;
						scene.add(arContent);
						try { if (!arContent.userData) arContent.userData = {}; arContent.userData.__oneScale = FEET_TO_METERS; } catch{}
						computeArBaseMetrics(arContent);
						// Ensure 1:1 scale in meters after feet->meters conversion in prepareModelForAR
						try { arContent.scale.setScalar(FEET_TO_METERS); } catch {}
						// Hide originals after clone is added to avoid duplicate visuals
						try {
							arPrevVisibility = new Map();
							for (const o of getARCloneSourceObjects()) { if (o !== arContent) { arPrevVisibility.set(o, !!o.visible); o.visible = false; } }
							updateVisibilityUI();
						} catch {}
					}
					// Place relative to viewer/camera: origin 1 foot forward, on local-floor
					try {
						const xrCam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
						if (xrCam) {
							const camPos = new THREE.Vector3(); const camQuat = new THREE.Quaternion();
							xrCam.getWorldPosition(camPos); xrCam.getWorldQuaternion(camQuat);
							const forward = new THREE.Vector3(0,0,-1).applyQuaternion(camQuat);
							const place = camPos.clone().add(forward.multiplyScalar(0.3048));
							// Snap to local-floor (y=0) for ground alignment
							place.y = 0;
							arContent.position.copy(place);
						} else {
							arContent.position.set(0, 0, -0.3048);
						}
					} catch { arContent.position.set(0, 0, -0.3048); }
					try { arEdit.setTarget(arContent); } catch {}

					arPlaced = true;
					// Ensure model ground is horizontal and snapped to local-floor when placed
					try { alignModelToGround(arContent); } catch {}
				}
				// After placement, update AR edit interaction via service
				if (session && arPlaced && arContent && frame) {
					try { arEdit.update(frame, xrLocalSpace); } catch {}
					// If ground lock is active, re-apply alignment each frame to enforce horizontal ground
					try { if (arGroundLocked) alignModelToGround(arContent); } catch {}
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
	const addAlignmentTileBtn = document.getElementById('addAlignmentTile');
	if (addAlignmentTileBtn) addAlignmentTileBtn.addEventListener('click', ()=>{
		try {
			const tile = createAlignmentTile ? createAlignmentTile({ THREE, feet: 1, name: 'Alignment Tile 1ft' }) : null;
			if (!tile) return;
			// Place in front of camera on ground (Y=0)
			const camPos = camera.getWorldPosition(new THREE.Vector3());
			const forward = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
			const pos = camPos.clone().add(forward.multiplyScalar(3)); pos.y = 0;
			tile.position.copy(pos);
			addObjectToScene(tile, { select: true });
		} catch {}
	});

	// Local scenes: serialize, save, list, load, delete
	function clearSceneObjects() {
			[...objects].forEach(o => { 
				try { if (collab && collab.isActive && collab.isActive() && (!collab.isApplyingRemote || !collab.isApplyingRemote())) collab.onDelete(o); } catch{}
				scene.remove(o); const idx = objects.indexOf(o); if (idx>-1) objects.splice(idx,1); 
			});
			// Reset teleport disc registry
			try { teleportDiscs.splice(0, teleportDiscs.length); } catch{}
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
					// Add children as top-level objects and rehydrate teleport discs
					[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); if (__isTeleportDisc(child)) __registerTeleportDisc(child); });
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
					[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); if (__isTeleportDisc(child)) __registerTeleportDisc(child); });
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
							[...(root.children||[])].forEach(child => { addObjectToScene(child, { select:false }); if (__isTeleportDisc(child)) __registerTeleportDisc(child); });
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

