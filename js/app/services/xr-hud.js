// XR HUD: 3D wrist-anchored curved button bar with hover/select via rays
// Note: pass getLocalSpace() to resolve the latest XR reference space each frame.
export function createXRHud({ THREE, scene, renderer, getLocalSpace, getButtons }){
  // Button sizing and layout for palm grid
  const BUTTON_W = 0.028; // meters
  const BUTTON_H = 0.0115; // meters
  const GRID_GAP_X = 0.006; // 6mm horizontal gap
  const GRID_GAP_Y = 0.006; // 6mm vertical gap
  const PALM_OFFSET = 0.018; // 18mm above palm plane to avoid z-fighting with hand
  const PINCH_THRESHOLD_M = 0.035; // consistent with AR edit
  let hud = null;
  let buttons = [];
  const xrHoverBySource = new WeakMap();
  const xrPressedSources = new WeakSet();
  const raycaster = new THREE.Raycaster();
  // Simple viz for hands and right-controller ray
  let handVizL = null, handVizR = null, rightRay = null, rightRayTip = null;
  let handVizMode = null; // 'default' | 'hands-only'
  // Finger poke/depress interaction
  // Scale press thresholds relative to button height for better feel with smaller tiles
  const PRESS_START_M = Math.max(0.002, 0.40 * BUTTON_H);   // ~4.6mm for H=11.5mm
  const PRESS_RELEASE_M = Math.max(0.001, 0.20 * BUTTON_H); // ~2.3mm
  const PRESS_MAX_M = Math.max(0.004, 0.60 * BUTTON_H);     // ~6.9mm
  const PRESS_SMOOTH = 0.35;     // visual smoothing
  let fingerHover = null;        // hovered mesh by fingertip
  // Visibility suppression when left hand not open or grabbing occurs
  let prevVisible = false;
  // Anchor control: 'palm' (left hand) or 'controller' with a reference space
  let anchor = { type: 'palm', space: null, handedness: 'left' };
  function setAnchor(next){
    try { anchor = Object.assign({ type: 'palm', space: null, handedness: 'left' }, next||{}); } catch { anchor = { type: 'palm', space: null, handedness: 'left' }; }
  }

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
  const geom=new THREE.PlaneGeometry(BUTTON_W, BUTTON_H);
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
  const tipSpheres = tips.map(()=>sph(0.0075, tipColor));
        const wristSphere = sph(0.012, wristColor);
        const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * (tips.length + 1)), 3));
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: lineColor, transparent:true, opacity:0.9, depthTest:false }));
        g.add(wristSphere, line, ...tipSpheres);
  g.userData.__viz = { tips, tipSpheres, wristSphere, line, base:{ tipColor, wristColor, lineColor } };
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

  function setHandVizPalette(mode){
    if (handVizMode === mode) return;
    handVizMode = mode;
    const apply = (group) => {
      const child = group && group.children && group.children[0]; if (!child) return;
      const vz = child.userData.__viz; if (!vz) return;
      const tips = vz.tipSpheres || []; const wrist = vz.wristSphere; const line = vz.line;
      if (mode === 'hands-only'){
        // Force a distinct blue palette in hands-only mode
        const tipBlue = 0x1ea0ff; const lineBlue = 0x1ea0ff; const wristBlue = 0x8ac9ff;
        for (const t of tips){ if (t?.material){ t.material.color.setHex(tipBlue); t.material.needsUpdate = true; } }
        if (wrist?.material){ wrist.material.color.setHex(wristBlue); wrist.material.needsUpdate = true; }
        if (line?.material){ line.material.color.setHex(lineBlue); line.material.opacity = 0.95; line.material.needsUpdate = true; }
      } else {
        // Revert to base palette
        const base = vz.base || { tipColor:0x00e0ff, wristColor:0xffffff, lineColor:0x00c2ff };
        for (const t of tips){ if (t?.material){ t.material.color.setHex(base.tipColor); t.material.needsUpdate = true; } }
        if (wrist?.material){ wrist.material.color.setHex(base.wristColor); wrist.material.needsUpdate = true; }
        if (line?.material){ line.material.color.setHex(base.lineColor); line.material.opacity = 0.9; line.material.needsUpdate = true; }
      }
    };
    apply(handVizL); apply(handVizR);
  }

  function ensure(){
    if (hud) return hud;
    hud = new THREE.Group(); hud.name='XR HUD 3D'; hud.userData.__helper = true;
    buttons = (getButtons(createHudButton) || []);
    // Build a grid layout (2-3 columns depending on count)
    const n = buttons.length;
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(n||1))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const totalW = cols * BUTTON_W + (cols - 1) * GRID_GAP_X;
    const totalH = rows * BUTTON_H + (rows - 1) * GRID_GAP_Y;
    for (let i = 0; i < n; i++){
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = -totalW/2 + c * (BUTTON_W + GRID_GAP_X) + BUTTON_W/2;
      const y = totalH/2 - r * (BUTTON_H + GRID_GAP_Y) - BUTTON_H/2;
      const b = buttons[i];
      b.mesh.position.set(x, y, 0);
      // Face +Z in local space; group orientation will face outward from left palm
      hud.add(b.mesh);
    }
    scene.add(hud);
    hud.visible = true;
    prevVisible = true;
    ensureHandViz();
    // Disable controller select activation for palm UI; right index finger poke only
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
    let leftHandOpen = false;
    let anyGrabOrSqueeze = false;
    let sawRightController = false;
  try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        // Palm anchoring and state checks
        const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
        let leftWristPose=null, leftIdxPose=null, leftThumbPose=null;
        for (const src of sources){
          // Track any squeeze on controllers to hide menu
          if (src.gamepad && src.gamepad.buttons){ if (src.gamepad.buttons[1]?.pressed || src.gamepad.buttons[2]?.pressed) anyGrabOrSqueeze = true; }
          if (src.handedness === 'right' && src.gamepad && !src.hand){ sawRightController = true; }
          if (src.handedness !== 'left' || !src.hand) continue;
          const hand = src.hand;
          const wrist = hand.get?.('wrist');
          const idx = hand.get?.('index-finger-tip');
          const th = hand.get?.('thumb-tip');
          leftWristPose = wrist && frame.getJointPose ? frame.getJointPose(wrist, ref) : leftWristPose;
          leftIdxPose = idx && frame.getJointPose ? frame.getJointPose(idx, ref) : leftIdxPose;
          leftThumbPose = th && frame.getJointPose ? frame.getJointPose(th, ref) : leftThumbPose;
        }
        if (anchor.type === 'controller' && anchor.space){
          // Anchor to controller space: position above the controller and face user/camera
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          const pose = frame.getPose(anchor.space, ref);
          if (pose){
            const p = pose.transform.position; const o = pose.transform.orientation;
            const base = new THREE.Vector3(p.x, p.y, p.z);
            const qCtl = new THREE.Quaternion(o.x,o.y,o.z,o.w);
            const upCtl = new THREE.Vector3(0,1,0).applyQuaternion(qCtl);
            const forwardCtl = new THREE.Vector3(0,0,-1).applyQuaternion(qCtl);
            const pos = base.clone().add(upCtl.multiplyScalar(0.08)).add(forwardCtl.multiplyScalar(0.05));
            hud.position.lerp(pos, 0.35);
            // Face the user/camera primarily
            if (xrCam){
              const toCam = new THREE.Vector3().subVectors(camWorldPos, pos).normalize();
              // Build basis: x = right, y = up (world), z = forward to camera
              const z = toCam.clone();
              const y = new THREE.Vector3(0,1,0);
              let x = new THREE.Vector3().crossVectors(y, z); if (x.lengthSq()<1e-6) x.set(1,0,0); x.normalize();
              const zFixed = new THREE.Vector3().crossVectors(x, y).normalize();
              const m = new THREE.Matrix4().makeBasis(x, y, zFixed);
              const q = new THREE.Quaternion().setFromRotationMatrix(m);
              hud.quaternion.slerp(q, 0.35);
            } else {
              hud.quaternion.slerp(qCtl, 0.35);
            }
            placed = true;
          }
        } else if (leftWristPose){
          // Derive palm plane orientation from wrist->index and wrist->thumb
          const wp = leftWristPose.transform.position;
          const w = new THREE.Vector3(wp.x, wp.y, wp.z);
          const ip = leftIdxPose?.transform?.position; const tp = leftThumbPose?.transform?.position;
          let vIndex = null, vThumb = null;
          if (ip) vIndex = new THREE.Vector3(ip.x-w.x, ip.y-w.y, ip.z-w.z);
          if (tp) vThumb = new THREE.Vector3(tp.x-w.x, tp.y-w.y, tp.z-w.z);
          let z = new THREE.Vector3(0,0,1); // palm normal
          if (vIndex && vThumb){ z = new THREE.Vector3().crossVectors(vIndex, vThumb); if (z.lengthSq() < 1e-6) z.set(0,0,1); z.normalize(); }
          // x along index direction projected on palm plane
          let xAxis = vIndex ? vIndex.clone() : new THREE.Vector3(1,0,0);
          // remove normal component
          const proj = z.clone().multiplyScalar(xAxis.dot(z)); xAxis.sub(proj);
          if (xAxis.lengthSq() < 1e-6) xAxis.set(1,0,0); xAxis.normalize();
          const yAxis = new THREE.Vector3().crossVectors(z, xAxis).normalize();
          const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, z);
          const q = new THREE.Quaternion().setFromRotationMatrix(m);
          const targetPos = w.clone().add(z.clone().multiplyScalar(PALM_OFFSET));
          hud.position.lerp(targetPos, 0.35);
          hud.quaternion.slerp(q, 0.35);
          placed = true;
        }
        // Determine left-hand open (not pinching)
        if (leftIdxPose && leftThumbPose){
          const a = leftIdxPose.transform.position; const b = leftThumbPose.transform.position;
          const d = Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
          leftHandOpen = d >= PINCH_THRESHOLD_M;
          if (!leftHandOpen) anyGrabOrSqueeze = true; // treat pinch as grab condition
        }
      }
    } catch {}
    if (!placed && camWorldPos && camWorldQuat){ const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camWorldQuat); const up=new THREE.Vector3(0,1,0).applyQuaternion(camWorldQuat); const pos=camWorldPos.clone().add(forward.multiplyScalar(0.5)).add(up.multiplyScalar(-0.05)); hud.position.lerp(pos,0.35); hud.quaternion.slerp(camWorldQuat,0.35); }
    // Enforce visibility rules: menu shows when toggled AND no grab/squeeze; if palm-anchored, also require left hand open
    try {
      const palmReq = (anchor.type === 'palm');
      const allowShow = (!anyGrabOrSqueeze) && (!palmReq || leftHandOpen);
      const mustHide = (anyGrabOrSqueeze) || (palmReq && !leftHandOpen);
      if (hud.visible && mustHide) { hud.visible = false; hud.userData.__autoHidden = true; }
      else if (!hud.visible && allowShow && hud.userData.__autoHidden) { hud.visible = true; hud.userData.__autoHidden = false; }
    } catch {}
    // Hover via rays (visualize only; do not click via controller). We can still show right controller ray, but ignore for clicking.
    try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        const hudTargets = buttons.map(b=>b.mesh);
        const hovered = new Set();
        let anyController = false; let anyHand = false;
  for (const src of sources){
      const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
      // Don't use controller rays for activation; optional hover visualization only
      const raySpace = src.targetRaySpace || src.gripSpace; if (raySpace){
        const pose = frame.getPose(raySpace, ref); if (pose){
          const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
          raycaster.set(origin, dir);
          const hits=raycaster.intersectObjects(hudTargets,true);
          const top = hits && hits.length ? hits[0].object : null;
          xrHoverBySource.set(src, top);
          if (top) hovered.add(top);
        }
      }
      // Visualize right-controller pointer ray but don't enable clicking with it
      if (src.handedness === 'right' && src.gamepad && !src.hand){
        sawRightController = true; anyController = true;
        if (rightRay && rightRayTip){
          const pose = raySpace ? frame.getPose(raySpace, ref) : null;
          if (pose){
            const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
            const posAttr = rightRay.geometry.attributes.position;
            posAttr.setXYZ(0, origin.x, origin.y, origin.z);
            const tip = origin.clone().add(dir.clone().multiplyScalar(1.5));
            posAttr.setXYZ(1, tip.x, tip.y, tip.z);
            posAttr.needsUpdate = true; rightRay.visible = true;
            rightRayTip.position.copy(tip); rightRayTip.visible = true;
          }
        }
      }
          if (src.hand) anyHand = true;
        }
        if (rightRay && rightRayTip && !sawRightController){ rightRay.visible = false; rightRayTip.visible = false; }
        // Switch palette based on modality: blue when hands-only
        if (anyHand && !anyController) setHandVizPalette('hands-only'); else setHandVizPalette('default');

        // Simple hand outlines: wrist + fingertips per hand
        try {
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          const updateOne = (src, group) => {
            const child = group && group.children && group.children[0]; if (!child) return;
            const vz = child.userData.__viz; if (!vz) return;
            const wristJ = src.hand?.get?.('wrist'); const wrist = wristJ ? frame.getJointPose(wristJ, ref) : null;
            const tips = vz.tips.map(name => { const j = src.hand?.get?.(name); return j ? frame.getJointPose(j, ref) : null; });
            if (!wrist || tips.every(t=>!t)) { if (child.visible) child.visible=false; return; }
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
            posAttr.needsUpdate = true; child.visible = true;
          };
          for (const src of sources){ if (src.hand && src.handedness==='left') updateOne(src, handVizL); if (src.hand && src.handedness==='right') updateOne(src, handVizR); }
        } catch {}

  // Right index finger hover + poke-to-click (depress animation). Only this triggers clicks.
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
        const halfW = BUTTON_W/2, halfH = BUTTON_H/2;
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

  return { ensure, remove, update, setAnchor, get group(){ return hud; }, get buttons(){ return buttons; } };
}
