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
    grabMap: new WeakMap(), // inputSource -> { grabbing:boolean }
    one: null, // {start:{x,y,z}, startPos:Vector3}
    two: null, // {startMid:{x,y,z}, startDist:number, startScale:Vector3, startPos:Vector3, startVec:Vector3, startQuat:Quaternion}
    gizmoGroup: null,
    gizmoLine: null,
    gizmoSpheres: [],
  };

  function setEnabled(on){ state.enabled = !!on; if(!on) clearManip(); updateGizmo([]); }
  function setGizmoEnabled(on){ state.gizmo = !!on; if(!on) removeGizmo(); }
  function setTarget(obj){ state.target = obj || null; }
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

  function collectActivePoints(frame, localSpace){
    const session = state.session || (renderer.xr && renderer.xr.getSession && renderer.xr.getSession());
    if (!session) return [];
    const out = [];
    const sources = session.inputSources ? Array.from(session.inputSources) : [];
    for(const src of sources){
      const { gamepad, gripSpace, targetRaySpace, hand } = src;
      let isGrabbing=false; let pos=null;
      if(gamepad && gamepad.buttons && gamepad.buttons.length){
        const squeeze = gamepad.buttons.find((b, i)=> b && b.pressed && (i===1 || i===2));
        if (squeeze && (gripSpace||targetRaySpace)){
          const ref = gripSpace || targetRaySpace; const pose = frame.getPose(ref, localSpace);
          if(pose){ isGrabbing=true; pos = pose.transform.position; }
        }
      }
      if(!isGrabbing && hand && hand.get){
        const ti = hand.get('index-finger-tip'); const tt = hand.get('thumb-tip');
        if (ti && tt){ const pti = frame.getJointPose ? frame.getJointPose(ti, localSpace) : null; const ptt = frame.getJointPose ? frame.getJointPose(tt, localSpace) : null; if(pti && ptt){ const dx=pti.transform.position.x-ptt.transform.position.x, dy=pti.transform.position.y-ptt.transform.position.y, dz=pti.transform.position.z-ptt.transform.position.z; const dist=Math.hypot(dx,dy,dz); if(dist<0.035){ isGrabbing=true; pos=pti.transform.position; } } }
      }
      if(isGrabbing && pos){
        out.push({ x:pos.x, y:pos.y, z:pos.z, src });
        const prev = state.grabMap.get(src) || { grabbing:false };
        if (!prev.grabbing) { hapticPulse(src, 0.3, 50); }
        state.grabMap.set(src, { grabbing:true });
      } else {
        const prev = state.grabMap.get(src);
        if (prev && prev.grabbing){ hapticPulse(src, 0.15, 30); state.grabMap.set(src, { grabbing:false }); }
      }
    }
    return out;
  }

  function update(frame, localSpace){
    if (!state.enabled || !state.target || !frame || !localSpace) { updateGizmo([]); return; }
    const points = collectActivePoints(frame, localSpace);
    updateGizmo(points);
    if(points.length===1){
      if(!state.one){ state.one = { start: { x: points[0].x, y: points[0].y, z: points[0].z }, startPos: state.target.position.clone() }; }
      const g = state.one; const dx=points[0].x-g.start.x, dy=points[0].y-g.start.y, dz=points[0].z-g.start.z;
      state.target.position.set(g.startPos.x+dx, g.startPos.y+dy, g.startPos.z+dz);
      state.two = null; // reset two-hand state if switching modes
    } else if(points.length>=2){
      const p0=points[0], p1=points[1]; const mid={ x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2, z:(p0.z+p1.z)/2 };
      const d = Math.hypot(p0.x-p1.x, p0.y-p1.y, p0.z-p1.z);
      if(!state.two){ state.two = { startMid: mid, startDist: Math.max(1e-4, d), startScale: state.target.scale.clone(), startPos: state.target.position.clone(), startVec: new THREE.Vector3(p1.x-p0.x, p1.y-p0.y, p1.z-p0.z).normalize(), startQuat: state.target.quaternion.clone() }; }
      const st = state.two; const s = Math.max(0.01, Math.min(50, d / st.startDist));
      state.target.scale.set(st.startScale.x*s, st.startScale.y*s, st.startScale.z*s);
      state.target.position.set(st.startPos.x + (mid.x-st.startMid.x), st.startPos.y + (mid.y-st.startMid.y), st.startPos.z + (mid.z-st.startMid.z));
      try {
        const v0 = st.startVec.clone(); const v1 = new THREE.Vector3(p1.x-p0.x, p1.y-p0.y, p1.z-p0.z).normalize(); v0.y=0; v1.y=0;
        if (v0.lengthSq()>1e-6 && v1.lengthSq()>1e-6){ v0.normalize(); v1.normalize(); const angle = Math.atan2(v0.clone().cross(v1).y, v0.dot(v1)); if (Math.abs(angle)>0.02){ const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), angle); state.target.quaternion.copy(st.startQuat).multiply(q); } }
      } catch {}
      state.one = null; // reset one-hand state
    } else {
      state.one = null; state.two = null;
    }
  }

  return { setEnabled, setGizmoEnabled, setTarget, start, stop, update };
}
