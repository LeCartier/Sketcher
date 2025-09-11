// VR Draw service: 3D tube drawing with hand pinch (thumb-index) in XR
// Creates thin 3D tubes instead of 2D lines for true thickness control
// Options (opts):
//   THREE, scene (required)
//   shouldDraw(): boolean   -> additional global gating
//   shouldBlockHandForMenu(handedness): boolean -> return true to suppress drawing for that hand this frame (e.g. menu interaction)
// Tubes are added directly to the scene and scale/rotate with scene transformations.
(function(){
	function createVRDraw(opts){
		const THREE = (opts && opts.THREE) || window.THREE;
		const scene = (opts && opts.scene);
		if (!THREE || !scene) return null;
		
		// Create a dedicated group for VR draw tubes that's part of the scene structure
		let drawGroup = scene.getObjectByName('VRDrawLines');
		if (!drawGroup) {
			drawGroup = new THREE.Group();
			drawGroup.name = 'VRDrawLines';
			// Don't mark as helper - we want these tubes to be part of the scene
			scene.add(drawGroup);
		}
		
		let enabled = false;
		let currentStroke = null;
		let currentGeom = null;
		let points = [];
		const triggerPrev = new WeakMap();
		let color = 0xff0000; // red linework
		let lineWidth = 2; // line thickness
		let minSegmentDist = 0.01; // 1 cm
		let maxPointsPerStroke = 5000;
		let onLineCreated = null; // callback when new line is added
		let currentStrokeId = null; // unique ID for current stroke
		let collaborationService = null; // reference to collaboration service
		// fingertip markers
		const tipMarkers = new Map(); // src -> mesh
		function setEnabled(v){
			const wasEnabled = enabled;
			enabled = !!v;
			if (wasEnabled !== enabled) {
				console.log('VR Draw mode:', enabled ? 'ENABLED' : 'DISABLED');
			}
			if (!enabled) endStroke();
		}
		function isActive(){ return !!enabled; }
		function clear(){ 
			try { 
				// Send collaboration event for clear
				if (collaborationService && collaborationService.onVRDrawClear) {
					collaborationService.onVRDrawClear();
				}
				
				// Clear all VR draw tubes from the scene
				while(drawGroup.children.length){ 
					const c = drawGroup.children.pop(); 
					c.geometry?.dispose?.(); 
					c.material?.dispose?.(); 
				} 
			} catch{} 
		}
		function setColor(hex){ color = hex; }
		function setLineWidth(width){ lineWidth = width || 2; }
		function getColor(){ return color; }
		function getLineWidth(){ return lineWidth; }
		function setOnLineCreated(fn){ onLineCreated = fn; }
		function setCollaborationService(service){ collaborationService = service; }
		function startStroke(pt, dir){
			console.log('🎨 VR Draw: Starting stroke at position:', pt);
			console.log('🎨 VR Draw: Scene children before:', scene.children.length);
			console.log('🎨 VR Draw: DrawGroup children before:', drawGroup.children.length);
			
			// Generate unique stroke ID for collaboration
			currentStrokeId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
			
			// Use provided direction (finger forward) or fallback to world X
			let direction = (dir && dir.length() > 0) ? dir.clone().normalize() : new THREE.Vector3(1,0,0);
			// Create tiny forward stub (1.5mm) so a tube is visible immediately but can be replaced by first real movement
			const startPt = pt.clone();
			const nextPt = pt.clone().add(direction.multiplyScalar(0.0015));
			points = [startPt, nextPt];
			
			// Create tube geometry instead of line geometry
			// Convert lineWidth to tube radius (in meters) - make it quite thin for VR drawing
			const tubeRadius = (lineWidth || 2) * 0.0005; // 0.5mm for lineWidth=1, 1mm for lineWidth=2, etc.
			const curve = new THREE.CatmullRomCurve3(points);
			currentGeom = new THREE.TubeGeometry(curve, Math.max(1, points.length - 1), tubeRadius, 8, false);
			
			// Use MeshBasicMaterial for better performance and consistent appearance
			const mat = new THREE.MeshBasicMaterial({ 
				color, 
				transparent: true,
				opacity: 0.9,
				side: THREE.DoubleSide
			});
			currentStroke = new THREE.Mesh(currentGeom, mat);
			currentStroke.frustumCulled = false;
			currentStroke.renderOrder = 1000; // Ensure tubes render on top
			// Don't mark as helper - these tubes are part of the scene
			currentStroke.name = `VRDrawTube_${currentStrokeId}`;
			drawGroup.add(currentStroke);
			
			console.log('🎨 VR Draw: Created tube mesh:', currentStroke.name);
			console.log('🎨 VR Draw: DrawGroup children after:', drawGroup.children.length);
			console.log('🎨 VR Draw: Tube added to scene successfully');
			console.log('🎨 VR Draw: Tube radius:', (lineWidth || 2) * 0.0005, 'meters');
			
			// Send collaboration event for stroke start
			if (collaborationService && collaborationService.onVRDrawStart) {
				collaborationService.onVRDrawStart(currentStrokeId, pt, color, lineWidth);
			}
			
			// Notify callback of new line creation
			if (onLineCreated) try { onLineCreated(currentStroke); } catch(e) { console.warn('onLineCreated callback error:', e); }
		}
		function addPoint(pt){
			if (!currentGeom || !points.length) {
				console.warn('🎨 VR Draw: Cannot add point - no current geometry or points');
				return;
			}
			const last = points[points.length-1];
			if (last.distanceToSquared(pt) < minSegmentDist*minSegmentDist) return;
			
			// Replace the initial dummy point with real drawing point
			if (points.length === 2 && points[0].distanceTo(points[1]) < 0.002) {
				points[1] = pt.clone(); // Replace dummy point with actual drawing point
			} else {
				points.push(pt.clone());
			}
			
			console.log(`🎨 VR Draw: Added point ${points.length}:`, pt);
			if (points.length > maxPointsPerStroke) { 
				console.log('🎨 VR Draw: Max points reached, ending stroke');
				endStroke(); 
				return; 
			}
			
			// Rebuild tube geometry with updated points
			if (points.length >= 2 && currentStroke) {
				// Dispose old geometry to prevent memory leaks
				if (currentGeom) currentGeom.dispose();
				
				// Create new tube geometry with all current points
				const tubeRadius = (lineWidth || 2) * 0.0005; // Same radius calculation as in startStroke
				const curve = new THREE.CatmullRomCurve3(points);
				currentGeom = new THREE.TubeGeometry(curve, Math.max(1, points.length - 1), tubeRadius, 8, false);
				
				// Update the mesh geometry
				currentStroke.geometry = currentGeom;
				currentStroke.geometry.computeBoundingSphere();
			}
			
			// Send collaboration event for new point
			if (collaborationService && collaborationService.onVRDrawPoint && currentStrokeId) {
				collaborationService.onVRDrawPoint(currentStrokeId, pt);
			}
		}
		function endStroke(){
			// Send collaboration event for stroke end
			if (collaborationService && collaborationService.onVRDrawEnd && currentStrokeId) {
				collaborationService.onVRDrawEnd(currentStrokeId);
			}
			
			currentStroke = null; 
			currentGeom = null; 
			points = [];
			currentStrokeId = null;
		}
		function update(frame, session, referenceSpace){
			if (!session || !frame) {
				if (enabled) console.log('VR Draw: Update called but missing session/frame');
				return;
			}
			
			if (!enabled) {
				// Still process update for marker management but don't draw
				return;
			}
			
			if (opts && typeof opts.shouldDraw === 'function' && !opts.shouldDraw()) { 
				console.log('VR Draw: Blocked by shouldDraw() function');
				endStroke(); 
				return; 
			}
			
			// Check if primitive creation mode is active - if so, completely disable VR draw
			if (typeof window !== 'undefined' && window.__xrPrim) {
				console.log('VR Draw: Blocked by primitive creation mode');
				endStroke(); // End any current stroke if primitive mode starts
				return; // Skip all VR draw processing
			}
			
			const sources = session.inputSources ? Array.from(session.inputSources) : [];
			const PINCH_DIST = 0.035; // 3.5cm threshold (slightly more forgiving)
			
			// Debug hand tracking availability
			const handSources = sources.filter(src => src && src.hand);
			if (enabled && handSources.length === 0) {
				if (!update.__noHandsWarned || (performance.now() - update.__noHandsWarned > 5000)) {
					console.log('🎨 VR Draw: No hands detected in input sources. Total sources:', sources.length);
					console.log('🎨 VR Draw: Available source types:', sources.map(s => ({ hand: !!s.hand, gamepad: !!s.gamepad, handedness: s.handedness })));
					update.__noHandsWarned = performance.now();
				}
			} else if (enabled && handSources.length > 0) {
				console.log('🎨 VR Draw: Found', handSources.length, 'hand sources');
			}
			
			// Remove markers for sources no longer present
			for (const k of Array.from(tipMarkers.keys())){ if (!sources.includes(k)){ const m = tipMarkers.get(k); try { if (m.parent) m.parent.remove(m); m.geometry?.dispose?.(); m.material?.dispose?.(); } catch{} tipMarkers.delete(k);} }
			for (const src of sources){
				if (!src || !src.hand) continue; // need hand tracking for pinch
					const ref = referenceSpace || null;

					// If host app provided a gating predicate to reserve hand for menu, honor it
					try {
						if (opts && typeof opts.shouldBlockHandForMenu === 'function') {
							// We'll derive an approximate pointer position using the index tip if available later; for now just pass handedness
							const blocked = opts.shouldBlockHandForMenu(src.handedness);
							if (blocked) {
								// Ensure any ongoing stroke from this hand ends immediately
								if (triggerPrev.get(src)) { endStroke(); }
								triggerPrev.set(src, false);
								continue; // Skip drawing for this hand this frame
							}
						}
					} catch(e) {}
				const idxJ = src.hand.get && src.hand.get('index-finger-tip');
				const thJ = src.hand.get && src.hand.get('thumb-tip');
				if (!idxJ || !thJ || !frame.getJointPose) {
					if (enabled) {
						console.log(`VR Draw: Missing joints for ${src.handedness} hand:`, {
							indexJoint: !!idxJ,
							thumbJoint: !!thJ,
							getJointPose: !!frame.getJointPose
						});
					}
					continue;
				}
				
				const pi = frame.getJointPose(idxJ, ref); 
				const pt = frame.getJointPose(thJ, ref);
				if (!pi || !pt) {
					if (enabled) {
						console.log(`VR Draw: Failed to get joint poses for ${src.handedness} hand:`, {
							indexPose: !!pi,
							thumbPose: !!pt,
							referenceSpace: !!ref
						});
					}
					continue;
				}
				const ip = pi.transform.position; const tp = pt.transform.position;
				const dist = Math.hypot(ip.x - tp.x, ip.y - tp.y, ip.z - tp.z);
				const pinching = dist < PINCH_DIST;
				const prev = triggerPrev.get(src) === true;
				
				// Debug logging for pinch detection
				if (enabled && (pinching !== prev)) {
					console.log(`🎨 VR Draw: Hand ${src.handedness} pinch ${pinching ? 'START' : 'END'} (dist: ${(dist*100).toFixed(1)}cm, threshold: ${(PINCH_DIST*100).toFixed(1)}cm)`);
					console.log(`🎨 VR Draw: Index pos:`, ip, 'Thumb pos:', tp);
				}
				
				// Additional debug for when enabled but no drawing occurs
				if (enabled && pinching && !currentStroke && !prev) {
					console.log('🎨 VR Draw: About to start stroke...');
				}
				// Drawing point originates slightly forward from index tip along local finger direction if orientation available
				let drawPos = new THREE.Vector3(ip.x, ip.y, ip.z);
				let forwardDir = null;
				if (pi.transform && pi.transform.orientation){
					const o = pi.transform.orientation; const q = new THREE.Quaternion(o.x,o.y,o.z,o.w);
					forwardDir = new THREE.Vector3(0,0,-1).applyQuaternion(q).normalize();
					drawPos.add(forwardDir.clone().multiplyScalar(0.01)); // offset 1cm forward
				}
				// Update fingertip marker
				let marker = tipMarkers.get(src);
				if (!marker){
					marker = new THREE.Mesh(
						new THREE.SphereGeometry(0.01, 12, 8), // Slightly larger for better visibility
						new THREE.MeshBasicMaterial({ 
							color: color, 
							depthTest: false,
							transparent: true,
							opacity: 0.8
						})
					);
					marker.userData.__helper = true;
					marker.renderOrder = 9999; // Ensure it renders on top
					scene.add(marker);
					tipMarkers.set(src, marker);
				}
				marker.visible = enabled; // Always visible when draw mode is enabled
				marker.position.set(ip.x, ip.y, ip.z);
				// Update marker color based on draw state and pinching
				if (enabled) {
					// Use current drawing color when pinching, slightly dimmed when not pinching
					const currentColor = pinching ? color : (color & 0x888888); // Dim when not actively drawing
					marker.material.color.setHex(currentColor);
					marker.material.opacity = pinching ? 1.0 : 0.6; // More opaque when pinching
				} else {
					marker.visible = false; // Hide markers when draw mode is off
				}
				if (pinching && !prev){ 
					console.log('VR Draw: Starting stroke at', drawPos); 
					startStroke(drawPos, forwardDir); 
				}
				else if (pinching && currentStroke){ addPoint(drawPos); }
				else if (!pinching && prev){ 
					console.log('VR Draw: Ending stroke'); 
					endStroke(); 
				}
				triggerPrev.set(src, pinching);
			}
		}
		return { 
			group: drawGroup, 
			setEnabled, 
			isActive, 
			clear, 
			setColor, 
			setLineWidth,
			getColor,
			getLineWidth,
			setOnLineCreated, 
			setCollaborationService,
			update 
		};
	}
	try { window.createVRDraw = createVRDraw; } catch{}
})();
