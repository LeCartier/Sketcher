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
			console.log('🎨 VR Draw: Created new drawGroup and added to scene');
		} else {
			console.log('🎨 VR Draw: Found existing drawGroup in scene');
		}
		console.log('🎨 VR Draw: DrawGroup parent after setup:', drawGroup.parent?.type || 'none');
		console.log('🎨 VR Draw: DrawGroup visible:', drawGroup.visible);
		console.log('🎨 VR Draw: Scene contains drawGroup:', scene.children.includes(drawGroup));
		
		let enabled = false;
		let currentStroke = null;
		let currentGeom = null;
		let previewStroke = null; // Preview line while pinching but not stable
		let points = [];
		const triggerPrev = new WeakMap();
		// Enhanced gesture tracking
		const gestureData = new WeakMap(); // Store per-hand gesture history
		let color = 0x00ff00; // bright green for Quest Pro visibility
		let lineWidth = 6; // thicker lines for VR visibility
		let minSegmentDist = 0.01; // 1 cm
		let maxPointsPerStroke = 5000;
		let onLineCreated = null; // callback when new line is added
		let currentStrokeId = null; // unique ID for current stroke
		let collaborationService = null; // reference to collaboration service
		// fingertip markers and status text
		const tipMarkers = new Map(); // src -> mesh
		let statusText = null; // floating text indicator in VR
		
		function createStatusText() {
			if (!statusText) {
				// Create a canvas for text rendering
				const canvas = document.createElement('canvas');
				canvas.width = 512;
				canvas.height = 128;
				const ctx = canvas.getContext('2d');
				
				// Create texture from canvas
				const texture = new THREE.CanvasTexture(canvas);
				
				// Create text material
				const textMaterial = new THREE.MeshBasicMaterial({ 
					map: texture, 
					transparent: true,
					depthTest: false
				});
				
				// Create text mesh
				const textGeometry = new THREE.PlaneGeometry(0.3, 0.075); // 30cm x 7.5cm in VR
				statusText = new THREE.Mesh(textGeometry, textMaterial);
				statusText.renderOrder = 10000; // Render on top
				statusText.userData.__helper = true;
				scene.add(statusText);
			}
			return statusText;
		}
		
		function updateStatusText(message, color = '#00ff00') {
			const text = createStatusText();
			const canvas = text.material.map.image;
			const ctx = canvas.getContext('2d');
			
			// Clear canvas
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			
			// Draw background
			ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			
			// Draw text
			ctx.fillStyle = color;
			ctx.font = 'bold 48px Arial';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(message, canvas.width/2, canvas.height/2);
			
			// Update texture
			text.material.map.needsUpdate = true;
			text.visible = true;
			
			// Position text in front of user (approximate)
			text.position.set(0, 1.6, -0.8); // 1.6m high, 80cm in front
			
			// Auto-hide after 3 seconds
			setTimeout(() => {
				if (text) text.visible = false;
			}, 3000);
		}
		function setEnabled(v){
			const wasEnabled = enabled;
			enabled = !!v;
			if (wasEnabled !== enabled) {
				console.log('🎨 VR Draw mode:', enabled ? 'ENABLED' : 'DISABLED');
				console.log('🎨 VR Draw state change timestamp:', performance.now());
				console.log('🎨 VR Draw drawGroup children count:', drawGroup?.children?.length || 0);
				console.log('🎨 VR Draw setEnabled called from:', new Error().stack?.split('\n')[2]?.trim() || 'unknown');
				
				// Show visual feedback in VR
				if (enabled) {
					updateStatusText('VR DRAW: ON', '#00ff00');
					// Force-create a test tube to verify the system works
					console.log('🎨 CREATING TEST TUBE TO VERIFY VR DRAW WORKS');
					const testPoints = [
						new THREE.Vector3(0, 1.5, -0.5),
						new THREE.Vector3(0.1, 1.5, -0.5),
						new THREE.Vector3(0.2, 1.6, -0.5),
						new THREE.Vector3(0.3, 1.5, -0.5)
					];
					try {
						const curve = new THREE.CatmullRomCurve3(testPoints);
						const tubeGeom = new THREE.TubeGeometry(curve, Math.max(2, testPoints.length * 2), lineWidth * 0.001, 8, false);
						const tubeMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: false });
						const testTube = new THREE.Mesh(tubeGeom, tubeMat);
						testTube.name = 'TestVRDrawTube';
						testTube.userData.__helper = false; // Make it permanent for testing
						drawGroup.add(testTube);
						console.log('🎨 TEST TUBE CREATED and added to drawGroup. DrawGroup children:', drawGroup.children.length);
						console.log('🎨 Test tube position:', testTube.position);
						console.log('🎨 DrawGroup parent:', drawGroup.parent?.type);
						console.log('🎨 DrawGroup visible:', drawGroup.visible);
						console.log('🎨 Test tube visible:', testTube.visible);
					} catch(e) {
						console.error('🎨 Failed to create test tube:', e);
					}
				} else {
					updateStatusText('VR DRAW: OFF', '#ff0000');
				}
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
				
				// Hide preview
				hidePreview();
				
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
		function startStroke(pt, dir, pressure = 1.0){
			console.log('🎨 VR Draw: Starting stroke at position:', pt, 'with pressure:', pressure);
			console.log('🎨 VR Draw: Scene children before:', scene.children.length);
			console.log('🎨 VR Draw: DrawGroup children before:', drawGroup.children.length);
			console.log('🎨 VR Draw: DrawGroup parent:', drawGroup.parent?.type || 'none');
			console.log('🎨 VR Draw: DrawGroup visible:', drawGroup.visible);
			console.log('🎨 VR Draw: Current color:', color.toString(16));
			console.log('🎨 VR Draw: Current line width:', lineWidth);
			
			// Generate unique stroke ID for collaboration
			currentStrokeId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
			
			// Use provided direction (finger forward) or fallback to world X
			let direction = (dir && dir.length() > 0) ? dir.clone().normalize() : new THREE.Vector3(1,0,0);
			// Create tiny forward stub (1.5mm) so a tube is visible immediately but can be replaced by first real movement
			const startPt = pt.clone();
			const nextPt = pt.clone().add(direction.multiplyScalar(0.0015));
			points = [
				{ position: startPt, pressure: pressure },
				{ position: nextPt, pressure: pressure }
			];
			
			// Create tube geometry with pressure-influenced radius - MADE MUCH LARGER FOR VISIBILITY
			const baseTubeRadius = (lineWidth || 6) * 0.002; // Doubled from 0.001 to 0.002 (now 12mm for lineWidth=6)
			const tubeRadius = baseTubeRadius * (0.8 + 0.4 * pressure); // Range 80%-120% of base (was 50%-100%)
			console.log('🎨 VR Draw: Creating EXTRA LARGE pressure-sensitive tube with radius:', tubeRadius, 'meters (pressure:', pressure, ')');
			console.log('🎨 VR Draw: This should be', (tubeRadius * 1000).toFixed(1), 'mm in diameter');
			
			try {
				const curve = new THREE.CatmullRomCurve3(points.map(p => p.position));
				currentGeom = new THREE.TubeGeometry(curve, Math.max(1, points.length - 1), tubeRadius, 8, false);
				console.log('🎨 VR Draw: Tube geometry created successfully');
			} catch(error) {
				console.error('🎨 VR Draw: Failed to create tube geometry:', error);
				return;
			}
			
			// Use MeshBasicMaterial with emissive properties for better VR visibility
			const mat = new THREE.MeshBasicMaterial({ 
				color, 
				transparent: false,
				opacity: 1.0,
				side: THREE.DoubleSide
			});
			// Add emissive glow for VR visibility
			mat.emissive = new THREE.Color(color);
			mat.emissiveIntensity = 0.3; // Subtle glow
			console.log('🎨 VR Draw: Created material with color:', mat.color.getHex().toString(16));
			
			currentStroke = new THREE.Mesh(currentGeom, mat);
			currentStroke.frustumCulled = false;
			currentStroke.renderOrder = 1000; // Ensure tubes render on top
			// Don't mark as helper - these tubes are part of the scene
			currentStroke.name = `VRDrawTube_${currentStrokeId}`;
			console.log('🎨 VR Draw: About to add mesh to drawGroup...');
			drawGroup.add(currentStroke);
			
			console.log('🎨 VR Draw: Created tube mesh:', currentStroke.name);
			console.log('🎨 VR Draw: DrawGroup children after:', drawGroup.children.length);
			console.log('🎨 VR Draw: Tube added to scene successfully');
			console.log('🎨 VR Draw: Tube visible:', currentStroke.visible);
			console.log('🎨 VR Draw: DrawGroup visible:', drawGroup.visible);
			console.log('🎨 VR Draw: DrawGroup parent:', drawGroup.parent?.constructor?.name);
			console.log('🎨 VR Draw: Tube world position:', currentStroke.getWorldPosition(new THREE.Vector3()));
			console.log('🎨 VR Draw: Tube bounding sphere:', currentStroke.geometry.boundingSphere);
			
			// FORCE VISIBILITY - Make sure everything is visible
			currentStroke.visible = true;
			drawGroup.visible = true;
			if (drawGroup.parent) drawGroup.parent.visible = true;
			
			console.log('🎨 VR Draw: Tube material properties:', {
				color: mat.color.getHex().toString(16),
				opacity: mat.opacity,
				transparent: mat.transparent,
				visible: mat.visible
			});
			
			// Send collaboration event for stroke start
			if (collaborationService && collaborationService.onVRDrawStart) {
				collaborationService.onVRDrawStart(currentStrokeId, pt, color, lineWidth);
			}
			
			// Notify callback of new line creation
			if (onLineCreated) try { onLineCreated(currentStroke); } catch(e) { console.warn('onLineCreated callback error:', e); }
		}
		function addPoint(pt, pressure = 1.0){
			if (!currentGeom || !points.length) {
				console.warn('🎨 VR Draw: Cannot add point - no current geometry or points');
				return;
			}
			const last = points[points.length-1];
			if (last.position.distanceToSquared(pt) < minSegmentDist*minSegmentDist) return;
			
			// Apply smoothing filter for better stroke quality
			let smoothedPoint = pt.clone();
			if (points.length >= 2) {
				// Use a simple weighted average with the last two points for smoothing
				const secondLast = points[points.length-2];
				// Weight: 60% new point, 30% last point, 10% second-to-last
				smoothedPoint = new THREE.Vector3()
					.addScaledVector(pt, 0.6)
					.addScaledVector(last.position, 0.3)
					.addScaledVector(secondLast.position, 0.1);
			}
			
			// Replace the initial dummy point with real drawing point
			if (points.length === 2 && points[0].position.distanceTo(points[1].position) < 0.002) {
				points[1] = { position: smoothedPoint, pressure: pressure }; // Replace dummy point with actual drawing point
			} else {
				points.push({ position: smoothedPoint, pressure: pressure });
			}
			
			console.log(`🎨 VR Draw: Added point ${points.length} with pressure ${pressure.toFixed(2)}:`, pt);
			if (points.length > maxPointsPerStroke) { 
				console.log('🎨 VR Draw: Max points reached, ending stroke');
				endStroke(); 
				return; 
			}
			
			// Rebuild tube geometry with variable radius based on pressure
			if (points.length >= 2 && currentStroke) {
				// Dispose old geometry to prevent memory leaks
				if (currentGeom) currentGeom.dispose();
				
				// Calculate average pressure for this segment
				const avgPressure = points.reduce((sum, p) => sum + p.pressure, 0) / points.length;
				const baseTubeRadius = (lineWidth || 6) * 0.002; // Doubled for visibility 
				const tubeRadius = baseTubeRadius * (0.8 + 0.4 * avgPressure); // Pressure-influenced radius
				
				const curve = new THREE.CatmullRomCurve3(points.map(p => p.position));
				currentGeom = new THREE.TubeGeometry(curve, Math.max(1, points.length - 1), tubeRadius, 8, false);
				
				// Update the mesh geometry
				currentStroke.geometry = currentGeom;
				currentStroke.geometry.computeBoundingSphere();
			}
			
			// Send collaboration event for new point (include pressure)
			if (collaborationService && collaborationService.onVRDrawPoint && currentStrokeId) {
				collaborationService.onVRDrawPoint(currentStrokeId, pt, pressure);
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
		
		function showPreview(position, direction) {
			// Create or update preview stroke
			if (!previewStroke) {
				const previewRadius = (lineWidth || 6) * 0.0005; // Half thickness for preview
				const previewLength = 0.02; // 2cm preview line
				
				let previewDirection = (direction && direction.length() > 0) ? direction.clone().normalize() : new THREE.Vector3(1,0,0);
				const startPt = position.clone();
				const endPt = position.clone().add(previewDirection.multiplyScalar(previewLength));
				
				const previewPoints = [startPt, endPt];
				const curve = new THREE.CatmullRomCurve3(previewPoints);
				const geom = new THREE.TubeGeometry(curve, 1, previewRadius, 8, false);
				
				const mat = new THREE.MeshBasicMaterial({ 
					color, 
					transparent: true,
					opacity: 0.5, // Semi-transparent preview
					side: THREE.DoubleSide
				});
				
				previewStroke = new THREE.Mesh(geom, mat);
				previewStroke.frustumCulled = false;
				previewStroke.renderOrder = 999; // Render before actual strokes
				previewStroke.name = 'VRDrawPreview';
				drawGroup.add(previewStroke);
			} else {
				// Update existing preview position
				previewStroke.position.copy(position);
				if (direction && direction.length() > 0) {
					previewStroke.lookAt(position.clone().add(direction));
				}
			}
		}
		
		function hidePreview() {
			if (previewStroke) {
				drawGroup.remove(previewStroke);
				previewStroke.geometry?.dispose?.();
				previewStroke.material?.dispose?.();
				previewStroke = null;
			}
		}
		function update(frame, session, referenceSpace){
			if (!session || !frame) {
				if (enabled) console.log('🎨 VR Draw: Update called but missing session/frame');
				return;
			}

			if (!enabled) {
				// Still process update for marker management but don't draw
				// Debug: Log every 3 seconds when disabled to confirm update is running
				if (!update.__disabledLastLog || (performance.now() - update.__disabledLastLog > 3000)) {
					console.log('🎨 VR Draw: Update running but DISABLED - call setEnabled(true) to activate');
					update.__disabledLastLog = performance.now();
				}
				return;
			}

			// Debug: Log when enabled and running
			if (!update.__enabledLastLog || (performance.now() - update.__enabledLastLog > 2000)) {
				console.log('🎨 VR Draw: Update running and ENABLED - detecting pinch gestures...');
				update.__enabledLastLog = performance.now();
			}			if (opts && typeof opts.shouldDraw === 'function' && !opts.shouldDraw()) { 
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
				
				// Calculate pressure from pinch tightness (inverted distance)
				const maxPinchDist = PINCH_DIST; // 3.5cm
				const minPinchDist = 0.010; // 1cm (tightest practical pinch)
				const normalizedDist = Math.max(0, Math.min(1, (dist - minPinchDist) / (maxPinchDist - minPinchDist)));
				const pressure = pinching ? (1.0 - normalizedDist) : 0; // Inverted: tighter pinch = higher pressure
				
				// Enhanced gesture tracking with velocity
				let gestureInfo = gestureData.get(src);
				if (!gestureInfo) {
					gestureInfo = {
						lastPosition: new THREE.Vector3(ip.x, ip.y, ip.z),
						lastTime: performance.now(),
						velocity: new THREE.Vector3(),
						stabilityCount: 0
					};
					gestureData.set(src, gestureInfo);
				}
				
				// Calculate velocity for more intelligent gesture recognition
				const currentTime = performance.now();
				const currentPos = new THREE.Vector3(ip.x, ip.y, ip.z);
				const deltaTime = (currentTime - gestureInfo.lastTime) / 1000; // Convert to seconds
				
				if (deltaTime > 0.001) { // Avoid division by zero
					const deltaPos = currentPos.clone().sub(gestureInfo.lastPosition);
					const currentVelocity = deltaPos.divideScalar(deltaTime);
					
					// Smooth velocity with exponential moving average
					gestureInfo.velocity.lerp(currentVelocity, 0.3);
					gestureInfo.lastPosition.copy(currentPos);
					gestureInfo.lastTime = currentTime;
				}
				
				// Check for drawing stability (low velocity indicates intentional drawing)
				const speed = gestureInfo.velocity.length();
				const isStable = speed < 0.5; // 50cm/s threshold for stable drawing
				
				if (isStable) {
					gestureInfo.stabilityCount++;
				} else {
					gestureInfo.stabilityCount = Math.max(0, gestureInfo.stabilityCount - 1);
				}
				
				// RELAXED pinch detection for better user experience
				// Instead of requiring stability, use a slightly larger threshold with immediate response
				const RELAXED_PINCH_DIST = 0.045; // Increased from 3.5cm to 4.5cm
				const relaxedPinching = dist < RELAXED_PINCH_DIST;
				
				// For now, let's bypass the stability requirement for testing
				const stablePinching = relaxedPinching; // Direct mapping - no stability delay
				
				// Debug logging for pinch detection
				if (enabled && (stablePinching !== prev)) {
					console.log(`🎨 VR Draw: Hand ${src.handedness} pinch ${stablePinching ? 'START' : 'END'} (dist: ${(dist*100).toFixed(1)}cm, pressure: ${pressure.toFixed(2)})`);
					console.log(`🎨 VR Draw: Index pos:`, ip, 'Thumb pos:', tp);
					console.log(`🎨 VR Draw: Draw position:`, drawPos);
					console.log(`🎨 VR Draw: Scene contains draw group:`, scene.children.includes(drawGroup));
				}
				
				// Additional debug for when enabled but no drawing occurs
				if (enabled && stablePinching && !currentStroke && !prev) {
					console.log('🎨 VR Draw: About to start stroke at position:', drawPos);
					console.log('🎨 VR Draw: Forward direction available:', !!forwardDir);
					console.log('🎨 VR Draw: Velocity:', gestureInfo.velocity.length().toFixed(3), 'm/s');
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
						new THREE.SphereGeometry(0.015, 16, 12), // Larger sphere for Quest Pro visibility
						new THREE.MeshBasicMaterial({ 
							color: color, 
							depthTest: false,
							transparent: true,
							opacity: 0.9
						})
					);
					marker.userData.__helper = true;
					marker.renderOrder = 9999; // Ensure it renders on top
					scene.add(marker);
					tipMarkers.set(src, marker);
				}
				marker.visible = enabled; // Always visible when draw mode is enabled
				marker.position.set(ip.x, ip.y, ip.z);
				// Update marker color and size based on draw state and stable pinching
				if (enabled) {
					// Use bright colors for Quest Pro visibility
					if (stablePinching) {
						marker.material.color.setHex(0xff0000); // Bright red when stable pinching/drawing
						marker.scale.setScalar(1.5); // Bigger when actively drawing
						marker.material.opacity = 1.0;
						hidePreview(); // Hide preview when actively drawing
					} else if (pinching) {
						marker.material.color.setHex(0xffaa00); // Orange when pinching but not stable
						marker.scale.setScalar(1.2); // Medium size when pinching
						marker.material.opacity = 0.9;
						showPreview(drawPos, forwardDir); // Show preview while pinching
					} else {
						marker.material.color.setHex(0x00ff00); // Bright green when ready to draw
						marker.scale.setScalar(1.0); // Normal size when ready
						marker.material.opacity = 0.8;
						hidePreview(); // Hide preview when not pinching
					}
				} else {
					marker.visible = false; // Hide markers when draw mode is off
					hidePreview(); // Hide preview when draw mode is off
				}
				if (stablePinching && !prev){ 
					console.log('🎨 VR Draw: *** STARTING STROKE ***'); 
					console.log('🎨 VR Draw: Position:', drawPos); 
					console.log('🎨 VR Draw: Forward direction:', forwardDir);
					console.log('🎨 VR Draw: Draw group children before:', drawGroup.children.length);
					console.log('🎨 VR Draw: Scene children before:', scene.children.length);
					startStroke(drawPos, forwardDir, pressure);
					console.log('🎨 VR Draw: Draw group children after:', drawGroup.children.length);
				}
				else if (stablePinching && currentStroke){ 
					console.log('🎨 VR Draw: Adding point to existing stroke:', drawPos, 'pressure:', pressure.toFixed(2));
					addPoint(drawPos, pressure); 
				}
				else if (!stablePinching && prev){ 
					console.log('🎨 VR Draw: *** ENDING STROKE ***'); 
					endStroke(); 
				}
				triggerPrev.set(src, stablePinching);
			}
		}
		
		// Expose test function globally for debugging
		window.testVRDraw = function() {
			console.log('🎨 TESTING VR DRAW FROM CONSOLE');
			console.log('🎨 VR Draw enabled:', enabled);
			console.log('🎨 DrawGroup children:', drawGroup.children.length);
			console.log('🎨 Scene contains drawGroup:', scene.children.includes(drawGroup));
			
			// Force enable if not already enabled
			if (!enabled) {
				console.log('🎨 Force enabling VR draw for test...');
				setEnabled(true);
			}
			
			return {
				enabled,
				drawGroupChildren: drawGroup.children.length,
				drawGroupParent: drawGroup.parent?.type,
				drawGroupInScene: scene.children.includes(drawGroup)
			};
		};
		
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
