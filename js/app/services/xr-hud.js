// XR HUD: 3D wrist-anchored curved button bar with hover/select via rays
// Note: pass getLocalSpace() to resolve the latest XR reference space each frame.
export function createXRHud({ THREE, scene, renderer, getLocalSpace, getButtons }){
  let hud = null;
  let buttons = [];
  const xrHoverBySource = new WeakMap();
  const xrPressedSources = new WeakSet();
  const raycaster = new THREE.Raycaster();
  // Simple viz for hands and right-controller ray
  let handVizL = null, handVizR = null, rightRay = null, rightRayTip = null;
  // Finger poke/depress interaction
  const PRESS_START_M = 0.006;   // start press when penetration > 6mm
  const PRESS_RELEASE_M = 0.003; // release when penetration < 3mm (hysteresis)
  const PRESS_MAX_M = 0.010;     // max visual depression at 10mm
  const PRESS_SMOOTH = 0.35;     // visual smoothing
  let fingerHover = null;        // hovered mesh by fingertip

  function ensurePressState(m){
    if (!m.userData.__press) {
      m.userData.__press = { pressed:false, depth:0, baseScale: m.scale.clone() };
    }
    return m.userData.__press;
  }
  function getWorldNormal(obj){
    const q = new THREE.Quaternion(); obj.getWorldQuaternion(q);
    return new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
  }
  function getWorldPosition(obj){ const v = new THREE.Vector3(); obj.getWorldPosition(v); return v; }
  function penetrationAlongNormal(mesh, worldPoint){
    const n = getWorldNormal(mesh); const p0 = getWorldPosition(mesh); const v = new THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z).sub(p0);
    return v.dot(n); // negative when finger is behind the plane (pressed in)
  }

  function makeButtonTexture(label){
    const w=256,h=96; const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    const bg='rgba(30,30,35,0.75)',fg='#ffffff',hl='rgba(255,255,255,0.18)';
    const r=18; ctx.fillStyle=bg; ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(w-r,0); ctx.quadraticCurveTo(w,0,w,r); ctx.lineTo(w,h-r); ctx.quadraticCurveTo(w,h,w-r,h); ctx.lineTo(r,h); ctx.quadraticCurveTo(0,h,0,h-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
    ctx.fillStyle=hl; ctx.fillRect(0,0,w,8);
    ctx.fillStyle=fg; ctx.font='bold 36px system-ui, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(label,w/2,h/2);
    const tex=new THREE.CanvasTexture(c); if(THREE.SRGBColorSpace) tex.colorSpace=THREE.SRGBColorSpace; tex.needsUpdate=true; return tex;
  }

  function createHudButton(label, onClick){
    const tex=makeButtonTexture(label);
    const geom=new THREE.PlaneGeometry(0.15,0.06);
    // Render HUD always on top in AR; depthTest off avoids passthrough occlusion issues.
    const mat=new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const mesh=new THREE.Mesh(geom, mat);
    mesh.renderOrder = 10000;
    mesh.userData.__hudButton={ label, onClick, base: mat.clone(), hover: mat };
    function setLabel(next){ try { const t=makeButtonTexture(next); if (mesh.material?.map?.dispose) mesh.material.map.dispose(); mesh.material.map=t; mesh.material.needsUpdate=true; mesh.userData.__hudButton.label=next; } catch{} }
    return { mesh, onClick, setLabel };
  }

  function ensureHandViz() {
    if (!handVizL) {
      handVizL = new THREE.Group(); handVizL.name = 'XR Left Hand Viz'; handVizL.userData.__helper = true;
      handVizR = new THREE.Group(); handVizR.name = 'XR Right Hand Viz'; handVizR.userData.__helper = true;
      const mk = () => {
        const g = new THREE.Group();
        const tipColor = 0x00e0ff, wristColor = 0xffffff, lineColor = 0x00c2ff;
        const sph = (r,c)=> new THREE.Mesh(new THREE.SphereGeometry(r,12,10), new THREE.MeshBasicMaterial({ color:c, depthTest:false, depthWrite:false }));
        const tips = ['thumb-tip','index-finger-tip','middle-finger-tip','ring-finger-tip','pinky-finger-tip'];
        const tipSpheres = tips.map(()=>sph(0.01, tipColor));
        const wristSphere = sph(0.012, wristColor);
        const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * (tips.length + 1)), 3));
        const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: lineColor, transparent:true, opacity:0.9, depthTest:false }));
        g.add(wristSphere, line, ...tipSpheres);
        g.userData.__viz = { tips, tipSpheres, wristSphere, line };
        g.visible = false; return g;
      };
      handVizL.add(mk()); handVizR.add(mk());
      scene.add(handVizL, handVizR);
    }
    if (!rightRay) {
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0,0,-1.2)]);
      const mat = new THREE.LineBasicMaterial({ color:0xffee00, linewidth:2, transparent:true, opacity:0.95, depthTest:false });
      rightRay = new THREE.Line(geom, mat); rightRay.renderOrder = 9999; rightRay.visible = false; rightRay.userData.__helper = true;
      rightRayTip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 10), new THREE.MeshBasicMaterial({ color:0xffee00, depthTest:false, depthWrite:false }));
      rightRayTip.visible = false; rightRayTip.userData.__helper = true;
      scene.add(rightRay, rightRayTip);
    }
  }

  function ensure(){
    if (hud) return hud;
  hud = new THREE.Group(); hud.name='XR HUD 3D'; hud.userData.__helper = true;
    buttons = (getButtons(createHudButton) || []);
    // Linear layout (no overlap): left-to-right at fixed forward offset
    const n=buttons.length, half=(n-1)/2;
    const buttonW=0.15, gap=0.035, spacing=buttonW+gap, zForward = -0.08;
    for(let i=0;i<n;i++){
      const x = (i - half) * spacing; const z = zForward;
      const b = buttons[i]; b.mesh.position.set(x,0,z); b.mesh.lookAt(0,0,0); hud.add(b.mesh);
    }
  scene.add(hud);
  hud.visible = true;
    ensureHandViz();
    // XR select events
    const session = renderer.xr.getSession?.();
    const onSelectStart=(ev)=>{ const src=ev.inputSource; if (src) xrPressedSources.add(src); };
    const onSelectEnd=(ev)=>{
      const src=ev.inputSource; if (!src) return; xrPressedSources.delete(src);
      // Prefer a fresh raycast using the event frame, so clicks don't depend on last render update
      let target=null;
      try {
        const frame = ev.frame; const space = src.targetRaySpace || src.gripSpace; const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
        if (frame && space && ref) {
          const pose = frame.getPose(space, ref);
          if (pose) {
            const p=pose.transform.position, o=pose.transform.orientation;
            const origin=new THREE.Vector3(p.x,p.y,p.z);
            const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
            const hudTargets = buttons.map(b=>b.mesh);
            raycaster.set(origin, dir);
            const hits=raycaster.intersectObjects(hudTargets,true);
            if (hits && hits.length) target = hits[0].object;
          }
        }
      } catch {}
      if (!target) target = xrHoverBySource.get(src);
      const handler = target?.userData?.__hudButton?.onClick;
      if (typeof handler === 'function') { try { handler(); } catch{} }
    };
    try { if (session) { session.addEventListener('selectstart', onSelectStart); session.addEventListener('selectend', onSelectEnd); hud.userData.__listeners = { onSelectStart, onSelectEnd, session }; } } catch {}
    return hud;
  }

  function remove(){
    try { const l = hud && hud.userData && hud.userData.__listeners; if (l?.session){ l.session.removeEventListener('selectstart', l.onSelectStart); l.session.removeEventListener('selectend', l.onSelectEnd); } } catch {}
    if (hud?.parent) hud.parent.remove(hud);
    hud = null; buttons = []; xrHoverBySource.clear();
    // Cleanup viz
    try {
      if (handVizL?.parent) handVizL.parent.remove(handVizL);
      if (handVizR?.parent) handVizR.parent.remove(handVizR);
      if (rightRay?.parent) rightRay.parent.remove(rightRay);
      if (rightRayTip?.parent) rightRayTip.parent.remove(rightRayTip);
    } catch {}
    handVizL = handVizR = rightRay = rightRayTip = null;
  }

  function update(frame){
    if (!hud) return;
    const isXR = !!(renderer && renderer.xr && renderer.xr.isPresenting);
    if (!isXR) return;
    const xrCam = renderer.xr.getCamera?.();
    let camWorldPos=null, camWorldQuat=null;
    if (xrCam){ camWorldPos=new THREE.Vector3(); xrCam.getWorldPosition(camWorldPos); camWorldQuat=new THREE.Quaternion(); xrCam.getWorldQuaternion(camWorldQuat); }
    let placed=false;
  try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        for (const src of sources){
          if (src.handedness !== 'left') continue;
          let leftPose=null;
      const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
      if (src.gripSpace) leftPose = frame.getPose(src.gripSpace, ref);
      if (!leftPose && src.hand && frame.getJointPose){ const wrist = src.hand.get?.('wrist'); if (wrist) leftPose = frame.getJointPose(wrist, ref); }
          if (leftPose){
            const lp=leftPose.transform.position; const lo=leftPose.transform.orientation;
            const lpos=new THREE.Vector3(lp.x,lp.y,lp.z); const lquat=new THREE.Quaternion(lo.x,lo.y,lo.z,lo.w);
      const leftOut=new THREE.Vector3(-1,0,0).applyQuaternion(lquat);
      const forward=new THREE.Vector3(0,0,-1).applyQuaternion(lquat);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(lquat);
      // Closer to wrist: reduce offsets
      const offset=forward.multiplyScalar(0.055).add(up.multiplyScalar(0.02)).add(leftOut.multiplyScalar(0.045));
            const targetPos=lpos.clone().add(offset);
            hud.position.lerp(targetPos,0.4);
            const zInward=leftOut.clone().negate().normalize(); const yUp=up.clone().normalize(); let xRight=new THREE.Vector3().crossVectors(yUp,zInward); if (xRight.lengthSq()<1e-6) xRight.set(1,0,0); xRight.normalize(); const zFixed=new THREE.Vector3().crossVectors(xRight,yUp).normalize(); const m=new THREE.Matrix4().makeBasis(xRight,yUp,zFixed); const q=new THREE.Quaternion().setFromRotationMatrix(m); hud.quaternion.slerp(q,0.4);
            placed=true; break;
          }
        }
      }
    } catch {}
    if (!placed && camWorldPos && camWorldQuat){ const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camWorldQuat); const up=new THREE.Vector3(0,1,0).applyQuaternion(camWorldQuat); const pos=camWorldPos.clone().add(forward.multiplyScalar(0.6)).add(up.multiplyScalar(-0.05)); hud.position.lerp(pos,0.35); hud.quaternion.slerp(camWorldQuat,0.35); }
    // Hover via rays
    try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        const hudTargets = buttons.map(b=>b.mesh);
        const hovered = new Set();
        for (const src of sources){
      const raySpace = src.targetRaySpace || src.gripSpace; if (!raySpace) continue;
      const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
      const pose = frame.getPose(raySpace, ref); if (!pose) continue;
          const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
          raycaster.set(origin, dir);
          const hits=raycaster.intersectObjects(hudTargets,true);
          const top = hits && hits.length ? hits[0].object : null;
          xrHoverBySource.set(src, top);
          if (top) hovered.add(top);

          // Visualize right-controller pointer ray
          if (src.handedness === 'right'){
            if (rightRay && rightRayTip){
              const posAttr = rightRay.geometry.attributes.position;
              posAttr.setXYZ(0, origin.x, origin.y, origin.z);
              const tip = origin.clone().add(dir.clone().multiplyScalar(1.5));
              posAttr.setXYZ(1, tip.x, tip.y, tip.z);
              posAttr.needsUpdate = true; rightRay.visible = true;
              rightRayTip.position.copy(tip); rightRayTip.visible = true;
            }
          }
        }

        // Simple hand outlines: wrist + fingertips per hand
        try {
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          const updateOne = (src, group) => {
            const child = group && group.children && group.children[0]; if (!child) return;
            const vz = child.userData.__viz; if (!vz) return;
            const wristJ = src.hand?.get?.('wrist'); const wrist = wristJ ? frame.getJointPose(wristJ, ref) : null;
            const tips = vz.tips.map(name => { const j = src.hand?.get?.(name); return j ? frame.getJointPose(j, ref) : null; });
            if (!wrist || tips.every(t=>!t)) { group.visible=false; return; }
            const wpos = wrist.transform.position; vz.wristSphere.position.set(wpos.x, wpos.y, wpos.z);
            const posAttr = vz.line.geometry.attributes.position; let idx=0;
            posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
            for (let i=0;i<tips.length;i++){
              const tp = tips[i]?.transform?.position; if (tp){
                vz.tipSpheres[i].position.set(tp.x,tp.y,tp.z);
                posAttr.setXYZ(idx++, tp.x, tp.y, tp.z);
              } else {
                // duplicate wrist if missing
                posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
                vz.tipSpheres[i].position.copy(vz.wristSphere.position);
              }
            }
            posAttr.needsUpdate = true; group.visible = true;
          };
          for (const src of sources){ if (src.hand && src.handedness==='left') updateOne(src, handVizL); if (src.hand && src.handedness==='right') updateOne(src, handVizR); }
        } catch {}

        // Right index finger hover + poke-to-click (depress animation)
        try {
          const rightHand = sources.find(s => s.hand && s.handedness === 'right');
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          let idxPos = null;
          if (rightHand && frame.getJointPose && ref){
            const idx = rightHand.hand.get?.('index-finger-tip');
            const pIdx = idx ? frame.getJointPose(idx, ref) : null;
            if (pIdx?.transform?.position) idxPos = pIdx.transform.position;
          }
          fingerHover = null;
          // Evaluate hover and press per button
          for (const b of buttons){
            const m = b.mesh; if (!m) continue; const st = ensurePressState(m);
            // default target depth is 0 (released)
            let targetDepth = 0; let within = false; let pressedNow = st.pressed;
            if (idxPos){
              // bounds check in local XY
              const lp = m.worldToLocal(new THREE.Vector3(idxPos.x, idxPos.y, idxPos.z));
              const halfW = 0.15/2, halfH = 0.06/2;
              if (Math.abs(lp.x) <= halfW && Math.abs(lp.y) <= halfH){
                within = true;
                // penetration along world normal
                const pen = penetrationAlongNormal(m, idxPos); // negative means pushing through
                const depth = THREE.MathUtils.clamp(-pen, 0, PRESS_MAX_M); // convert to positive mm depth
                targetDepth = depth;
                // hysteresis press/release
                if (!st.pressed && depth >= PRESS_START_M) { pressedNow = true; }
                if (st.pressed && depth <= PRESS_RELEASE_M) { pressedNow = false; }
              }
            }
            // animate to target depth
            st.depth = st.depth + (targetDepth - st.depth) * PRESS_SMOOTH;
            const s = 1 - 0.15 * Math.min(1, st.depth / PRESS_MAX_M);
            m.scale.set(st.baseScale.x, st.baseScale.y * s, st.baseScale.z);
            // update hovered set for highlight
            if (within) { hovered.add(m); if (!fingerHover) fingerHover = m; }
            // onPress transition: fire onClick
            if (!st.pressed && pressedNow){
              const handler = m.userData?.__hudButton?.onClick; if (typeof handler === 'function') { try { handler(); } catch{} }
            }
            st.pressed = pressedNow;
          }
        } catch {}

  // Apply hover highlight for any hovered (ray or finger)
  hudTargets.forEach(m=>{ const mat=m.material; if (!mat) return; const on = hovered.has(m); mat.opacity = on ? 1.0 : 0.82; mat.needsUpdate=true; });

      } else {
        if (rightRay) rightRay.visible = false; if (rightRayTip) rightRayTip.visible = false;
        }
    } catch {}
  }

  return { ensure, remove, update, get group(){ return hud; }, get buttons(){ return buttons; } };
}
