// VR Draw service: simple 3D stroke drawing with hand pinch (thumb-index) in XR
// Marks created line objects with userData.__helper so they're ignored by measurements / resets.
(function(){
	function createVRDraw(opts){
		const THREE = (opts && opts.THREE) || window.THREE;
		const scene = (opts && opts.scene);
		if (!THREE || !scene) return null;
		const group = new THREE.Group();
		group.name = 'VRDrawGroup';
		group.userData.__helper = true;
		scene.add(group);
		let enabled = false;
		let currentStroke = null;
		let currentGeom = null;
		let points = [];
		const triggerPrev = new WeakMap();
		let color = 0xff0000; // red linework
		let minSegmentDist = 0.01; // 1 cm
		let maxPointsPerStroke = 5000;
		let onLineCreated = null; // callback when new line is added
		// fingertip markers
		const tipMarkers = new Map(); // src -> mesh
		function setEnabled(v){
			enabled = !!v;
			if (!enabled) endStroke();
		}
		function isActive(){ return !!enabled; }
		function clear(){ try { while(group.children.length){ const c=group.children.pop(); c.geometry?.dispose?.(); c.material?.dispose?.(); } } catch{} }
		function setColor(hex){ color = hex; }
		function setOnLineCreated(fn){ onLineCreated = fn; }
		function startStroke(pt){
			points = [pt.clone()];
			currentGeom = new THREE.BufferGeometry();
			currentGeom.setAttribute('position', new THREE.Float32BufferAttribute([pt.x, pt.y, pt.z], 3));
			const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
			currentStroke = new THREE.Line(currentGeom, mat);
			currentStroke.frustumCulled = false;
			currentStroke.userData.__helper = true;
			group.add(currentStroke);
			// Notify callback of new line creation
			if (onLineCreated) try { onLineCreated(currentStroke); } catch{}
		}
		function addPoint(pt){
			if (!currentGeom || !points.length) return;
			const last = points[points.length-1];
			if (last.distanceToSquared(pt) < minSegmentDist*minSegmentDist) return;
			points.push(pt.clone());
			if (points.length > maxPointsPerStroke) { endStroke(); return; }
			const arr = [];
			for (const p of points){ arr.push(p.x,p.y,p.z); }
			currentGeom.setAttribute('position', new THREE.Float32BufferAttribute(arr,3));
			currentGeom.attributes.position.needsUpdate = true;
			currentGeom.computeBoundingSphere();
		}
		function endStroke(){
			currentStroke = null; currentGeom = null; points = [];
		}
		function update(frame, session, referenceSpace){
			if (!enabled || !session || !frame) return;
			if (opts && typeof opts.shouldDraw === 'function' && !opts.shouldDraw()) { endStroke(); return; }
			const sources = session.inputSources ? Array.from(session.inputSources) : [];
			const PINCH_DIST = 0.028; // 2.8cm threshold
			// Remove markers for sources no longer present
			for (const k of Array.from(tipMarkers.keys())){ if (!sources.includes(k)){ const m = tipMarkers.get(k); try { if (m.parent) m.parent.remove(m); m.geometry?.dispose?.(); m.material?.dispose?.(); } catch{} tipMarkers.delete(k);} }
			for (const src of sources){
				if (!src || !src.hand) continue; // need hand tracking for pinch
				const ref = referenceSpace || null;
				const idxJ = src.hand.get && src.hand.get('index-finger-tip');
				const thJ = src.hand.get && src.hand.get('thumb-tip');
				if (!idxJ || !thJ || !frame.getJointPose) continue;
				const pi = frame.getJointPose(idxJ, ref); const pt = frame.getJointPose(thJ, ref);
				if (!pi || !pt) continue;
				const ip = pi.transform.position; const tp = pt.transform.position;
				const dist = Math.hypot(ip.x - tp.x, ip.y - tp.y, ip.z - tp.z);
				const pinching = dist < PINCH_DIST;
				const prev = triggerPrev.get(src) === true;
				// Drawing point originates slightly forward from index tip along local finger direction if orientation available
				let drawPos = new THREE.Vector3(ip.x, ip.y, ip.z);
				if (pi.transform && pi.transform.orientation){
					const o = pi.transform.orientation; const q = new THREE.Quaternion(o.x,o.y,o.z,o.w);
					const forward = new THREE.Vector3(0,0,-1).applyQuaternion(q);
					drawPos.add(forward.multiplyScalar(0.01)); // offset 1cm forward
				}
				// Update fingertip marker
				let marker = tipMarkers.get(src);
				if (!marker){
					marker = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color:0xff00ff, depthTest:false }));
					marker.userData.__helper = true;
					scene.add(marker);
					tipMarkers.set(src, marker);
				}
				marker.visible = true; 
				marker.position.set(ip.x, ip.y, ip.z);
				// Update marker color based on draw state and pinching
				if (enabled) {
					marker.material.color.setHex(pinching ? 0xff00ff : 0xff00ff); // Always magenta when draw mode is active
				} else {
					marker.visible = false; // Hide markers when draw mode is off
				}
				if (pinching && !prev){ startStroke(drawPos); }
				else if (pinching && currentStroke){ addPoint(drawPos); }
				else if (!pinching && prev){ endStroke(); }
				triggerPrev.set(src, pinching);
			}
		}
		return { group, setEnabled, isActive, clear, setColor, setOnLineCreated, update };
	}
	try { window.createVRDraw = createVRDraw; } catch{}
})();
