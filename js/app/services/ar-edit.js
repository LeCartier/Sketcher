// AR Edit service: bimanual grab/translate/scale/twist with controllers or hands, with optional gizmo and haptics.
// Usage:
//   const arEdit = createAREdit(THREE, scene, renderer);
//   arEdit.setEnabled(true|false);
//   arEdit.setGizmoEnabled(true|false);
//   arEdit.setTarget(group); // the placed AR root
//   arEdit.start(session);
//   // per-frame:
//   arEdit.update(frame, xrLocalSpace);
//   // on session end:
//   arEdit.stop();

export function createAREdit(THREE, scene, renderer){
  const state = {
    enabled: true,
    gizmo: true,
    session: null,
    target: null,
    root: null, // when perObject is enabled, this is the root containing selectable children
    grabMap: new WeakMap(), // inputSource -> { grabbing:boolean }
    one: null, // {start:{x,y,z}, startPos:Vector3}
    two: null, // {startMid:{x,y,z}, startDist:number, startScale:Vector3, startPos:Vector3, startVec:Vector3, startQuat:Quaternion}
    gizmoGroup: null,
    gizmoLine: null,
    gizmoSpheres: [],
  smooth: 0.28, // low-pass filter factor for XR edits (0 = no smoothing, 1 = snap)
  useCollision: true,
  perObject: false,
  perActive: null, // currently selected sub-object when perObject is true
  };

  function setEnabled(on){ state.enabled = !!on; if(!on) clearManip(); updateGizmo([]); }
  function setGizmoEnabled(on){ state.gizmo = !!on; if(!on) removeGizmo(); }
  function setTarget(obj){ state.target = obj || null; state.root = obj || null; }
  function setPerObjectEnabled(on){ state.perObject = !!on; state.perActive = null; clearManip(); }
  function start(session){ state.session = session || null; }
  function stop(){ state.session = null; clearManip(); removeGizmo(); }

  function clearManip(){ if(state.target){ delete state.target.userData._grab; delete state.target.userData._bi; } state.one=null; state.two=null; }

  function ensureGizmo(){
    if (state.gizmoGroup) return;
    const g = new THREE.Group(); g.name = 'AR Edit Gizmo';
    const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent:true, opacity:0.9, depthTest:false });
    const line = new THREE.Line(lineGeom, lineMat); line.renderOrder = 999;
    const sphGeom = new THREE.SphereGeometry(0.02, 16, 12);
    const sphMat = new THREE.MeshBasicMaterial({ color:0xff00ff, depthTest:false });
    const s0 = new THREE.Mesh(sphGeom, sphMat.clone()); const s1 = new THREE.Mesh(sphGeom.clone(), sphMat.clone());
    g.add(line, s0, s1);
    scene.add(g);
    state.gizmoGroup = g; state.gizmoLine = line; state.gizmoSpheres = [s0, s1];
  }
  function removeGizmo(){ if(state.gizmoGroup && state.gizmoGroup.parent){ state.gizmoGroup.parent.remove(state.gizmoGroup); } state.gizmoGroup=null; state.gizmoLine=null; state.gizmoSpheres=[]; }
  function updateGizmo(points){ if(!state.gizmo) return; if(points.length===0){ if(state.gizmoGroup) state.gizmoGroup.visible=false; return; } ensureGizmo(); state.gizmoGroup.visible=true; if(points.length===1){ state.gizmoSpheres[0].position.set(points[0].x, points[0].y, points[0].z); state.gizmoSpheres[1].position.copy(state.gizmoSpheres[0].position); if(state.gizmoLine){ const pos=state.gizmoLine.geometry.attributes.position; pos.setXYZ(0, points[0].x, points[0].y, points[0].z); pos.setXYZ(1, points[0].x, points[0].y, points[0].z); pos.needsUpdate=true; } } else { const p0=points[0], p1=points[1]; state.gizmoSpheres[0].position.set(p0.x,p0.y,p0.z); state.gizmoSpheres[1].position.set(p1.x,p1.y,p1.z); if(state.gizmoLine){ const pos=state.gizmoLine.geometry.attributes.position; pos.setXYZ(0, p0.x,p0.y,p0.z); pos.setXYZ(1, p1.x,p1.y,p1.z); pos.needsUpdate=true; } } }

  function hapticPulse(src, strength, duration){ try { if (src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]) { src.gamepad.hapticActuators[0].pulse(strength, duration); } } catch {}
  }

  const PINCH_THRESHOLD_M = 0.035;
  const HAND_SPHERE_R = 0.045; // ~4.5cm interaction sphere
  const CONTROLLER_SPHERE_R = 0.040; // ~4cm sphere for controller grip/pose
  const GRAB_NEAR_MARGIN = 0.0; // meters; 0 = require true penetration for grab
  const COLLISION_PUSH_GAIN = 0.0; // disable passive push; only interact when grabbing

  function isCollidingWithBox(px, py, pz, radius, box){
    if (!box || box.isEmpty()) return false;
    // Compute nearest point on/in box to the sphere center
    const cx = Math.max(box.min.x, Math.min(px, box.max.x));
    const cy = Math.max(box.min.y, Math.min(py, box.max.y));
    const cz = Math.max(box.min.z, Math.min(pz, box.max.z));
    const dx = cx - px, dy = cy - py, dz = cz - pz;
    const dist = Math.hypot(dx,dy,dz);
    return dist <= (radius + GRAB_NEAR_MARGIN);
  }

  function collectActivePoints(frame, localSpace, targetBox){
    const session = state.session || (renderer.xr && renderer.xr.getSession && renderer.xr.getSession());
    if (!session) return [];
    const out = [];
    const sources = session.inputSources ? Array.from(session.inputSources) : [];
    const collisionActive = !!(state.useCollision && state.target && targetBox && !targetBox.isEmpty());
  for(const src of sources){
      const { gamepad, gripSpace, targetRaySpace, hand } = src;
      let isGrabbing=false; let pos=null; let quat=null; let pinching=false; let radius=HAND_SPHERE_R;
      const prev = state.grabMap.get(src) || { grabbing:false };
      if(gamepad && gamepad.buttons && gamepad.buttons.length){
        const squeeze = gamepad.buttons.find((b, i)=> b && b.pressed && (i===1 || i===2));
        if ((squeeze && (gripSpace||targetRaySpace))){
          const ref = gripSpace || targetRaySpace; const pose = frame.getPose(ref, localSpace);
          if(pose){
            const p = pose.transform.position; const o = pose.transform.orientation; radius = CONTROLLER_SPHERE_R;
            // Collision gate for starting/continuing grab with controller
            if (prev.grabbing || !collisionActive || isCollidingWithBox(p.x, p.y, p.z, radius, targetBox)){
              isGrabbing=true; pos = p; quat = new THREE.Quaternion(o.x, o.y, o.z, o.w);
            } else {
              // Not colliding: treat as non-grabbing point for pushing
              out.push({ x:p.x, y:p.y, z:p.z, src, grabbing:false, pinching:false, radius: CONTROLLER_SPHERE_R*0.9 });
            }
          }
        }
      }
      // Hand pinch detection (and general hand presence for collision)
      if(hand && hand.get){
        const ti = hand.get('index-finger-tip'); const tt = hand.get('thumb-tip');
        const wrist = hand.get('wrist');
        const pti = frame.getJointPose ? (ti && frame.getJointPose(ti, localSpace)) : null;
        const ptt = frame.getJointPose ? (tt && frame.getJointPose(tt, localSpace)) : null;
        const pw = frame.getJointPose ? (wrist && frame.getJointPose(wrist, localSpace)) : null;
        // Compute palm orientation to gate grabs: only allow pinching when palm is DOWN
        let palmDown = false;
        try {
          if (pw && pti && ptt){
            const wpos = pw.transform.position; const ipos = pti.transform.position; const tpos = ptt.transform.position;
            const vIndex = new THREE.Vector3(ipos.x - wpos.x, ipos.y - wpos.y, ipos.z - wpos.z);
            const vThumb = new THREE.Vector3(tpos.x - wpos.x, tpos.y - wpos.y, tpos.z - wpos.z);
            // For left hand, outward normal = thumb x index; for right, use index x thumb
            const z = (src.handedness === 'left') ? new THREE.Vector3().crossVectors(vThumb, vIndex) : new THREE.Vector3().crossVectors(vIndex, vThumb);
            if (z.lengthSq() > 1e-8){ z.normalize(); palmDown = (z.y <= -0.15); } // palm facing downward enough
          }
        } catch {}
        if(pti && ptt){
          const dx=pti.transform.position.x-ptt.transform.position.x, dy=pti.transform.position.y-ptt.transform.position.y, dz=pti.transform.position.z-ptt.transform.position.z; const dist=Math.hypot(dx,dy,dz);
          if(dist < PINCH_THRESHOLD_M){
            const p = pti.transform.position;
            // Collision gate for pinch grab, plus palm-down requirement
            if (palmDown && (prev.grabbing || !collisionActive || isCollidingWithBox(p.x, p.y, p.z, HAND_SPHERE_R, targetBox))){
              isGrabbing=true; pinching=true; pos = p; radius = HAND_SPHERE_R;
              // Build an approximate hand orientation for 6DoF hold: use wrist->index and wrist->thumb as axes
              try {
                let q = null;
                if (pw && pw.transform && pw.transform.orientation){
                  // Prefer the wrist joint orientation if present
                  const o = pw.transform.orientation; q = new THREE.Quaternion(o.x, o.y, o.z, o.w);
                }
                if ((!q || q.lengthSq()===0) && pw && pti && ptt){
                  const wpos = pw.transform.position;
                  const ipos = pti.transform.position;
                  const tpos = ptt.transform.position;
                  const z = new THREE.Vector3(ipos.x - wpos.x, ipos.y - wpos.y, ipos.z - wpos.z).normalize();
                  const x = new THREE.Vector3(tpos.x - wpos.x, tpos.y - wpos.y, tpos.z - wpos.z).normalize();
                  let y = new THREE.Vector3().crossVectors(z, x).normalize();
                  // Re-orthogonalize x
                  const x2 = new THREE.Vector3().crossVectors(y, z).normalize();
                  const m = new THREE.Matrix4().makeBasis(x2, y, z);
                  q = new THREE.Quaternion().setFromRotationMatrix(m);
                }
                if (q) quat = q;
              } catch {}
            }
          }
        }
        // If not grabbing, still record a hand point (wrist preferred) for collision pushing
        if(!isGrabbing && (pw || pti)){
          const p = (pw ? pw.transform.position : pti.transform.position);
          out.push({ x:p.x, y:p.y, z:p.z, src, grabbing:false, pinching:false, radius: HAND_SPHERE_R });
        }
      }
      if(isGrabbing && pos){
        const justStarted = !prev.grabbing;
        out.push({ x:pos.x, y:pos.y, z:pos.z, src, grabbing:true, pinching, radius, quat, justStarted });
        if (!prev.grabbing) { hapticPulse(src, 0.3, 50); }
        state.grabMap.set(src, { grabbing:true });
      } else {
        if (prev && prev.grabbing){ hapticPulse(src, 0.15, 30); state.grabMap.set(src, { grabbing:false }); }
      }
    }
    return out;
  }

  function update(frame, localSpace){
    if (!state.enabled || !frame || !localSpace) { updateGizmo([]); return; }

    // Determine which object is the current manipulation target
    let effectiveTarget = state.target;
    let targetBox = null;
    // For per-object mode, pick/maintain a child under the grabbing point
    if (state.perObject && state.root){
      // Build a temporary box for collision gating using the root (coarse gate)
      try { targetBox = new THREE.Box3().setFromObject(state.root); } catch { targetBox = null; }
      const pointsPre = collectActivePoints(frame, localSpace, targetBox);
      const grabbingPre = pointsPre.filter(p=>p.grabbing);
      // When a new grab starts, try to pick a child
      const newly = grabbingPre.find(p=>p.justStarted);
      const stillGrabbing = grabbingPre.length > 0;
      const pickChildAt = (px,py,pz,r)=>{
        let best = null; let bestDist = Infinity;
        const tmpBox = new THREE.Box3(); const tmpCenter = new THREE.Vector3();
        const visit = (obj)=>{
          if (!obj || obj.userData?.__helper || obj === state.root) return;
          if (obj.visible === false) return;
          try { tmpBox.setFromObject(obj); } catch { return; }
          if (tmpBox.isEmpty()) return;
          // sphere vs box test, then choose by center distance
          const cx = Math.max(tmpBox.min.x, Math.min(px, tmpBox.max.x));
          const cy = Math.max(tmpBox.min.y, Math.min(py, tmpBox.max.y));
          const cz = Math.max(tmpBox.min.z, Math.min(pz, tmpBox.max.z));
          const dx = cx - px, dy = cy - py, dz = cz - pz; const dist = Math.hypot(dx,dy,dz);
          if (dist <= r){
            tmpBox.getCenter(tmpCenter);
            const cdx = tmpCenter.x - px, cdy = tmpCenter.y - py, cdz = tmpCenter.z - pz;
            const cdist = Math.hypot(cdx,cdy,cdz);
            if (cdist < bestDist){ bestDist = cdist; best = obj; }
          }
          const children = obj.children || [];
          for (const ch of children) visit(ch);
        };
        visit(state.root);
        return best;
      };
      if (newly){
        const sel = pickChildAt(newly.x, newly.y, newly.z, newly.radius || HAND_SPHERE_R);
        if (sel){ state.perActive = sel; state.one = null; state.two = null; }
      }
      if (!stillGrabbing){ state.perActive = null; state.one = null; state.two = null; updateGizmo([]); return; }
      effectiveTarget = state.perActive || null;
      if (!effectiveTarget){ updateGizmo([]); return; }
      try { targetBox = new THREE.Box3().setFromObject(effectiveTarget); } catch { targetBox = null; }
      // Recompute points using the specific target box for accurate collision gating
      const points = collectActivePoints(frame, localSpace, targetBox);
      return updateWithTarget(points, effectiveTarget, targetBox);
    }

    // Whole-scene mode: operate on the configured target as before
    if (!effectiveTarget) { updateGizmo([]); return; }
    try { targetBox = new THREE.Box3().setFromObject(effectiveTarget); } catch { targetBox = null; }
    const points = collectActivePoints(frame, localSpace, targetBox);
    return updateWithTarget(points, effectiveTarget, targetBox);
  }

  function updateWithTarget(points, targetObj, targetBox){
    const grabbingPts = points.filter(p=>p.grabbing);
    const nonGrabPts = points.filter(p=>!p.grabbing);
    updateGizmo(grabbingPts);
    if(grabbingPts.length===1){
      const p = grabbingPts[0];
      if(!state.one){
        const handPos = new THREE.Vector3(p.x, p.y, p.z);
        const handQuat = (p.quat && p.quat.isQuaternion) ? p.quat.clone() : (p.quat ? p.quat.clone?.() : new THREE.Quaternion());
        const invH = handQuat.clone(); try { invH.invert(); } catch { invH.conjugate(); }
        const deltaPos = targetObj.position.clone().sub(handPos).applyQuaternion(invH);
        const deltaQuat = invH.clone().multiply(targetObj.quaternion.clone());
        state.one = { startHandPos: handPos, startHandQuat: handQuat, deltaPos, deltaQuat };
      }
      const g = state.one;
      const handPos = new THREE.Vector3(p.x, p.y, p.z);
      const handQuat = (p.quat && p.quat.isQuaternion) ? p.quat.clone() : (p.quat ? p.quat.clone?.() : new THREE.Quaternion());
      const desiredQuat = handQuat.clone().multiply(g.deltaQuat);
      const forwardDelta = g.deltaPos.clone().applyQuaternion(handQuat);
      const desiredPos = handPos.clone().add(forwardDelta);
      try { targetObj.position.lerp(desiredPos, state.smooth); } catch { targetObj.position.copy(desiredPos); }
      try { targetObj.quaternion.slerp(desiredQuat, state.smooth); } catch { targetObj.quaternion.copy(desiredQuat); }
      state.two = null; // reset two-hand state if switching modes
    } else if(grabbingPts.length>=2){
      // Require both hands/controllers to be currently colliding to orbit/scale
      const colliding = (p)=>{
        if (!targetBox || targetBox.isEmpty()) return false;
        const r = p.radius || HAND_SPHERE_R; const cx=Math.max(targetBox.min.x, Math.min(p.x, targetBox.max.x)); const cy=Math.max(targetBox.min.y, Math.min(p.y, targetBox.max.y)); const cz=Math.max(targetBox.min.z, Math.min(p.z, targetBox.max.z)); const dx=cx-p.x, dy=cy-p.y, dz=cz-p.z; return Math.hypot(dx,dy,dz) <= (r + GRAB_NEAR_MARGIN);
      };
      const both = grabbingPts.filter(colliding);
      if (both.length < 2){
        // If exactly one is colliding, treat as one-hand translate using that point
        if (both.length === 1){
          const gp = both[0];
          if(!state.one){ state.one = { start: { x: gp.x, y: gp.y, z: gp.z }, startPos: targetObj.position.clone() }; }
          const g = state.one; const dx=gp.x-g.start.x, dy=gp.y-g.start.y, dz=gp.z-g.start.z;
          const desiredPos = new THREE.Vector3(g.startPos.x+dx, g.startPos.y+dy, g.startPos.z+dz);
          try { targetObj.position.lerp(desiredPos, state.smooth); } catch { targetObj.position.copy(desiredPos); }
        }
        // Do not engage two-hand orbit/scale unless both are colliding
        return;
      }
      const p0=both[0], p1=both[1]; const mid=new THREE.Vector3((p0.x+p1.x)/2, (p0.y+p1.y)/2, (p0.z+p1.z)/2);
      const d = Math.hypot(p0.x-p1.x, p0.y-p1.y, p0.z-p1.z);
      if(!state.two){
        const startMid = mid.clone();
        const startDist = Math.max(1e-4, d);
        const startScale = targetObj.scale.clone();
        const startPos = targetObj.position.clone();
        const startVec = new THREE.Vector3(p1.x-p0.x, p1.y-p0.y, p1.z-p0.z).normalize();
        const startQuat = targetObj.quaternion.clone();
        const startOffset = startPos.clone().sub(startMid);
        state.two = { startMid, startDist, startScale, startPos, startVec, startQuat, startOffset };
      }
      const st = state.two; const s = Math.max(0.01, Math.min(50, d / st.startDist));
      const desiredScale = new THREE.Vector3(st.startScale.x*s, st.startScale.y*s, st.startScale.z*s);
      const v1 = new THREE.Vector3(p1.x-p0.x, p1.y-p0.y, p1.z-p0.z).normalize();
      let R = new THREE.Quaternion();
      try { R = new THREE.Quaternion().setFromUnitVectors(st.startVec.clone().normalize(), v1.clone().normalize()); } catch { R.identity?.(); }
      const desiredQuat = R.clone().multiply(st.startQuat);
      const offset = st.startOffset.clone().multiplyScalar(s).applyQuaternion(R);
      const desiredPos = mid.clone().add(offset);
      try { targetObj.scale.lerp(desiredScale, state.smooth); } catch { targetObj.scale.copy(desiredScale); }
      try { targetObj.position.lerp(desiredPos, state.smooth); } catch { targetObj.position.copy(desiredPos); }
      try { targetObj.quaternion.slerp(desiredQuat, state.smooth); } catch { targetObj.quaternion.copy(desiredQuat); }
      state.one = null; // reset one-hand state
    } else {
      state.one = null; state.two = null;
    }

  // Passive push disabled; object only responds when grabbing
  if (false && state.useCollision && nonGrabPts.length && state.target) {
      try {
        const box = new THREE.Box3().setFromObject(state.target);
        if (!box.isEmpty()){
          const tgtPos = state.target.position.clone();
          for (const p of nonGrabPts){
            const hx = p.x, hy = p.y, hz = p.z; const r = p.radius || HAND_SPHERE_R;
            const cx = Math.max(box.min.x, Math.min(hx, box.max.x));
            const cy = Math.max(box.min.y, Math.min(hy, box.max.y));
            const cz = Math.max(box.min.z, Math.min(hz, box.max.z));
            const dx = cx - hx, dy = cy - hy, dz = cz - hz;
            const dist = Math.hypot(dx,dy,dz);
            if (dist < r) {
              // penetration vector from hand into box; push object away
              const pen = (r - dist) || r;
              const nx = (dist>1e-6)? (dx/dist) : 0, ny = (dist>1e-6)? (dy/dist) : 0, nz = (dist>1e-6)? (dz/dist) : 0;
              tgtPos.x += nx * pen * COLLISION_PUSH_GAIN;
              tgtPos.y += ny * pen * COLLISION_PUSH_GAIN;
              tgtPos.z += nz * pen * COLLISION_PUSH_GAIN;
            }
          }
          // Smoothly move towards the pushed position if different
          if (!tgtPos.equals(state.target.position)){
            try { state.target.position.lerp(tgtPos, state.smooth); } catch { state.target.position.copy(tgtPos); }
          }
        }
      } catch {}
    }
  }

  return { setEnabled, setGizmoEnabled, setTarget, setPerObjectEnabled, start, stop, update };
}
