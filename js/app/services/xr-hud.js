// XR HUD: 3D wrist-anchored curved button bar with hover/select via rays
// Note: pass getLocalSpace() to resolve the latest XR reference space each frame.
export function createXRHud({ THREE, scene, renderer, getLocalSpace, getButtons }){
  // Button sizing and layout for palm grid (.75 inch ≈ 19.05mm)
  const BUTTON_SIZE = 0.01905; // 0.75in square
  const BUTTON_W = BUTTON_SIZE; // meters (square)
  const BUTTON_H = BUTTON_SIZE; // meters (square)
  const GRID_GAP_X = 0.006; // 6mm horizontal gap
  const GRID_GAP_Y = 0.006; // 6mm vertical gap
  const PALM_OFFSET = 0.0508; // ~2 inches (50.8mm) above palm plane for better visibility
  const PINCH_THRESHOLD_M = 0.035; // consistent with AR edit
  let hud = null;
  let buttons = [];
  const xrHoverBySource = new WeakMap();
  const xrPressedSources = new WeakSet();
  const raycaster = new THREE.Raycaster();
  // Simple viz for hands and right-controller ray
  let handVizL = null, handVizR = null, rightRay = null, rightRayTip = null;
  let handVizMode = null; // 'default' | 'hands-only'
  let handVizStyle = 'fingertips'; // 'fingertips' | 'index' | 'skeleton' | 'mesh' | 'off'

  // WebXR hand joint names and a simple bone connectivity map
  const FINGERS = ['thumb','index-finger','middle-finger','ring-finger','pinky-finger'];
  const FINGER_JOINTS = {
    'thumb': ['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'],
    'index-finger': ['index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip'],
    'middle-finger': ['middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip'],
    'ring-finger': ['ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip'],
    'pinky-finger': ['pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip']
  };
  const BONES = (()=>{
    const bones = [];
    for (const f of FINGERS){
      const chain = FINGER_JOINTS[f];
      // wrist to metacarpal
      bones.push(['wrist', chain[0]]);
      // chain segments
      for (let i=0;i<chain.length-1;i++) bones.push([chain[i], chain[i+1]]);
    }
    return bones;
  })();
  // Finger poke/depress interaction — tighter thresholds for crisp feel
  const PRESS_START_M = Math.max(0.0015, 0.22 * BUTTON_H);   // ~4mm
  const PRESS_RELEASE_M = Math.max(0.0008, 0.12 * BUTTON_H); // ~2mm
  const PRESS_MAX_M = Math.max(0.003, 0.35 * BUTTON_H);
  const PRESS_SMOOTH = 0.25;     // faster visual response
  let fingerHover = null;        // hovered mesh by fingertip
  // Visibility suppression when left hand not open or grabbing occurs
  let prevVisible = false;
  // Anchor control: 'palm' (left hand only) or 'controller' (deprecated here); we force left hand usage
  let anchor = { type: 'palm', space: null, handedness: 'left' };
  function setAnchor(next){
    try { anchor = Object.assign({ type: 'palm', space: null, handedness: 'left' }, next||{}); } catch { anchor = { type: 'palm', space: null, handedness: 'left' }; }
  // Force left-hand for palm anchors
  if (anchor.type === 'palm') anchor.handedness = 'left';
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
    // Square texture for rounded-square buttons
    const w=256,h=256; const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    const bg='rgba(30,30,35,0.78)',fg='#ffffff',hl='rgba(255,255,255,0.16)';
    const r=36; ctx.fillStyle=bg; ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(w-r,0); ctx.quadraticCurveTo(w,0,w,r); ctx.lineTo(w,h-r); ctx.quadraticCurveTo(w,h,w-r,h); ctx.lineTo(r,h); ctx.quadraticCurveTo(0,h,0,h-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
    // top sheen
    ctx.fillStyle=hl; ctx.fillRect(0,0,w,Math.max(6, Math.floor(h*0.04)));
    // label
    ctx.fillStyle=fg; ctx.font='bold 66px system-ui, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(label,w/2,h/2);
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
    // Click flash overlay for feedback
    const flashGeom = geom.clone();
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest:false, depthWrite:false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Mesh(flashGeom, flashMat); flash.name = 'hud-flash'; flash.renderOrder = 10001; flash.scale.set(1.05, 1.05, 1);
    mesh.add(flash); mesh.userData.__flash = flash;
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
        // fingertips polyline
        const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * (tips.length + 1)), 3));
        const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: lineColor, transparent:true, opacity:0.9, depthTest:false }));
        // skeleton polyline (segments for all bones)
        const skelGeom = new THREE.BufferGeometry(); skelGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * BONES.length), 3));
        const skelLine = new THREE.LineSegments(skelGeom, new THREE.LineBasicMaterial({ color: 0x5ac8ff, transparent:true, opacity:0.95, depthTest:false }));
        skelLine.visible = false;
        // simple hand mesh proxy: a quad (palm) and small cylinders between joints (approx)
        const meshGroup = new THREE.Group(); meshGroup.visible = false;
        const palmMat = new THREE.MeshBasicMaterial({ color: 0x2a7fff, transparent:true, opacity:0.15, depthTest:false, side: THREE.DoubleSide });
        const palm = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), palmMat); palm.name='palm-proxy'; meshGroup.add(palm);
        // pool a few bone cylinders for reuse
        const cylMat = new THREE.MeshBasicMaterial({ color: 0x2a7fff, transparent:true, opacity:0.25, depthTest:false });
        const cylGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 8);
        const boneCyls = new Array(BONES.length).fill(0).map(()=> new THREE.Mesh(cylGeo, cylMat.clone()));
        boneCyls.forEach(m=>{ m.visible=false; meshGroup.add(m); });
        g.add(wristSphere, line, skelLine, meshGroup, ...tipSpheres);
        g.userData.__viz = { tips, tipSpheres, wristSphere, line, base:{ tipColor, wristColor, lineColor }, skel:{ geom: skelGeom, line: skelLine }, mesh:{ group: meshGroup, palm, boneCyls } };
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
  hud.visible = false; // only after menu press
  hud.userData.__menuShown = false; // armed by menu button
  prevVisible = false;
    ensureHandViz();
  // Both controller trigger and right index finger can activate buttons
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
    // Track a left-controller space for fallback placement when left hand is not tracked
    let leftControllerSpace = null;
    let anyGrabOrSqueeze = false;
    let sawRightController = false;
    // Reset per-frame palm flags
    if (hud && hud.userData){ hud.userData.__palmPresent = false; hud.userData.__palmUp = false; }
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
          if (src.handedness === 'left' && src.gamepad && !src.hand){ leftControllerSpace = src.gripSpace || src.targetRaySpace || null; }
          // Only sample LEFT hand joints for palm anchoring and gestures
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
  }
  if (leftWristPose){
          // Derive palm plane orientation from wrist->index and wrist->thumb
          const wp = leftWristPose.transform.position;
          const w = new THREE.Vector3(wp.x, wp.y, wp.z);
          const ip = leftIdxPose?.transform?.position; const tp = leftThumbPose?.transform?.position;
          let vIndex = null, vThumb = null;
          if (ip) vIndex = new THREE.Vector3(ip.x-w.x, ip.y-w.y, ip.z-w.z);
          if (tp) vThumb = new THREE.Vector3(tp.x-w.x, tp.y-w.y, tp.z-w.z);
          let z = new THREE.Vector3(0,0,1); // palm normal (aim to point outward from palm)
          if (vIndex && vThumb){
            // WebXR uses a right-handed coord system (+X right, +Y up, +Z back).
            // For the LEFT palm, the outward normal is index x thumb (not thumb x index).
            // Using index × thumb yields +Y when the palm faces up, keeping the HUD above the palm.
            z = new THREE.Vector3().crossVectors(vIndex, vThumb);
            if (z.lengthSq() < 1e-6) z.set(0,0,1); z.normalize();
          }
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
          // Cache palm up/down state (z.y measures how much the palm normal points upward)
          if (hud && hud.userData){ hud.userData.__palmUp = (z.y >= 0.15); hud.userData.__palmPresent = true; }
        }
        // Fallback: if no left palm, place HUD relative to left controller for visibility
        if (!leftWristPose && leftControllerSpace){
          const ref2 = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          const pose = frame.getPose(leftControllerSpace, ref2);
          if (pose){
            const p=pose.transform.position, o=pose.transform.orientation;
            const base = new THREE.Vector3(p.x,p.y,p.z);
            const qCtl = new THREE.Quaternion(o.x,o.y,o.z,o.w);
            const upCtl = new THREE.Vector3(0,1,0).applyQuaternion(qCtl);
            const forwardCtl = new THREE.Vector3(0,0,-1).applyQuaternion(qCtl);
            const pos = base.clone().add(upCtl.multiplyScalar(0.08)).add(forwardCtl.multiplyScalar(0.05));
            hud.position.lerp(pos, 0.35);
            if (xrCam){
              const toCam = new THREE.Vector3().subVectors(camWorldPos, pos).normalize();
              const z = toCam.clone(); const y = new THREE.Vector3(0,1,0);
              let x = new THREE.Vector3().crossVectors(y, z); if (x.lengthSq()<1e-6) x.set(1,0,0); x.normalize();
              const zFixed = new THREE.Vector3().crossVectors(x, y).normalize();
              const m = new THREE.Matrix4().makeBasis(x, y, zFixed);
              const q = new THREE.Quaternion().setFromRotationMatrix(m);
              hud.quaternion.slerp(q, 0.35);
            } else {
              hud.quaternion.slerp(qCtl, 0.35);
            }
            placed = true;
            hud.userData.__palmPresent = false;
          }
        }
  // Pinch shouldn’t block before the menu is shown. Only suppress if HUD is visible and outside grace period.
  const justShownAt = hud?.userData?.__menuJustShownAt || 0;
  const nowTs = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
  const inGrace = (nowTs - justShownAt) <= 450; // ms
  if (hud?.visible && !inGrace && leftIdxPose && leftThumbPose){
          const a = leftIdxPose.transform.position; const b = leftThumbPose.transform.position;
          const d = Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
          if (d < PINCH_THRESHOLD_M) anyGrabOrSqueeze = true;
        }
      }
    } catch {}
  // For palm anchor, do not fallback to camera when not placed (menu should hide). For controller anchor, allow fallback.
  if (!placed && anchor.type === 'controller' && camWorldPos && camWorldQuat){ const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camWorldQuat); const up=new THREE.Vector3(0,1,0).applyQuaternion(camWorldQuat); const pos=camWorldPos.clone().add(forward.multiplyScalar(0.5)).add(up.multiplyScalar(-0.05)); hud.position.lerp(pos,0.35); hud.quaternion.slerp(camWorldQuat,0.35); }
    // Enforce visibility rules: menu shows when toggled AND no grab/squeeze; if palm-anchored, also require left hand open
    try {
  const palmReq = (anchor.type === 'palm');
  const palmUp = !!hud.userData.__palmUp;
  const palmPresent = !!hud.userData.__palmPresent;
  // If palm not present, don’t gate on palmUp; allow menu to show when toggled
  const allowShow = (!!hud.userData.__menuShown) && (!anyGrabOrSqueeze) && (!palmReq || !palmPresent || palmUp);
  const mustHide = (anyGrabOrSqueeze) || (palmReq && palmPresent && !palmUp);
  if (hud.visible && mustHide) { hud.visible = false; hud.userData.__autoHidden = true; hud.userData.__menuShown = false; try { if (typeof module!=='undefined'){} } catch {} }
  else if (!hud.visible && allowShow && (hud.userData.__autoHidden || hud.userData.__menuShown)) { hud.visible = true; hud.userData.__autoHidden = false; try { /* reset pressed states on show */ } catch {} }
    } catch {}
    // Hover and click via controller rays; also support right finger poke
    try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
        const sources = session.inputSources ? Array.from(session.inputSources) : [];
        const hudTargets = buttons.map(b=>b.mesh);
        const hovered = new Set();
        let anyController = false; let anyHand = false;
        let controllerHoveringHUD = false;
        if (!update.__xrTriggerPrev) update.__xrTriggerPrev = new WeakMap();
  for (const src of sources){
      const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
      // Use controller rays for hover and activation
      const raySpace = src.targetRaySpace || src.gripSpace; if (raySpace){
        const pose = frame.getPose(raySpace, ref); if (pose){
          const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w));
          raycaster.set(origin, dir);
          const hits=raycaster.intersectObjects(hudTargets,true);
          const top = hits && hits.length ? hits[0].object : null;
          xrHoverBySource.set(src, top);
          if (top) hovered.add(top);
          if (top && src.gamepad) controllerHoveringHUD = true;
          // Controller trigger clicks a hovered button
          if (src.gamepad){
            const pressed = !!(src.gamepad.buttons && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed);
            const prev = update.__xrTriggerPrev.get(src) === true;
            if (pressed && !prev && top){
              const handler = top.userData?.__hudButton?.onClick; if (typeof handler === 'function') { try { handler(); } catch{} }
              try { const fl = top.userData && top.userData.__flash; if (fl && fl.material) { fl.material.opacity = 0.9; } } catch{}
            }
            update.__xrTriggerPrev.set(src, pressed);
          }
        }
      }
  // Visualize right-controller pointer ray; extend to first hit among HUD, scene, or teleport discs
      if (src.handedness === 'right' && src.gamepad && !src.hand){
        sawRightController = true; anyController = true;
        if (rightRay && rightRayTip){
          const pose = raySpace ? frame.getPose(raySpace, ref) : null;
          if (pose){
    const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w)).normalize();
    // Raycast against HUD, scene, and teleport discs
    const discs = (window.__teleport && window.__teleport.getTeleportDiscs) ? window.__teleport.getTeleportDiscs() : [];
    const sceneTargets = [];
    try { scene.traverse(obj=>{ if (obj && obj.isMesh && obj.visible && !obj.userData?.__helper) sceneTargets.push(obj); }); } catch{}
    raycaster.set(origin, dir);
    let best = null;
    const consider = (hits, tag)=>{ if (!hits||!hits.length) return; const h = hits[0]; const d = (typeof h.distance==='number')? h.distance : origin.distanceTo(h.point); if (best==null || d < best.dist) best = { point: h.point.clone(), obj: h.object, dist: d, tag } };
    try { consider(raycaster.intersectObjects(hudTargets, true), 'hud'); } catch{}
    try { consider(raycaster.intersectObjects(sceneTargets, true), 'scene'); } catch{}
    try { if (discs && discs.length) consider(raycaster.intersectObjects(discs, true), 'disc'); } catch{}
    const posAttr = rightRay.geometry.attributes.position; posAttr.setXYZ(0, origin.x, origin.y, origin.z);
    let tip = origin.clone().add(dir.clone().multiplyScalar(2.0));
    // Default hide highlight on all discs; re-apply on target
    try { if (discs && discs.length) discs.forEach(d=>{ try { window.__teleport.highlightTeleportDisc(d,false); } catch{} }); } catch{}
    if (best && best.point){ tip.copy(best.point); if (best.tag==='disc'){ try { const d = (function find(o){ while(o && !(o.userData&&o.userData.__teleportDisc)) o=o.parent; return o; })(best.obj); if (d) window.__teleport.highlightTeleportDisc(d, true); } catch{} } }
    posAttr.setXYZ(1, tip.x, tip.y, tip.z); posAttr.needsUpdate = true; rightRay.visible = true;
    rightRayTip.position.copy(tip); rightRayTip.visible = true;
          }
        }
      }
          if (src.hand) anyHand = true;
        }
        if (rightRay && rightRayTip && !sawRightController){ rightRay.visible = false; rightRayTip.visible = false; }
  // Switch palette based on modality: blue when hands-only
        if (anyHand && !anyController) setHandVizPalette('hands-only'); else setHandVizPalette('default');

        // Hand visualization per style: fingertips | index | skeleton | mesh | off
        try {
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          const updateOne = (src, group) => {
            const child = group && group.children && group.children[0]; if (!child) return;
            const vz = child.userData.__viz; if (!vz) return;
            const wristJ = src.hand?.get?.('wrist'); const wrist = wristJ ? frame.getJointPose(wristJ, ref) : null;
            // Hide completely if style is 'off'
            if (handVizStyle === 'off') { child.visible = false; return; }
            if (!wrist) { child.visible = false; return; }
            const wpos = wrist.transform.position; vz.wristSphere.position.set(wpos.x, wpos.y, wpos.z);
            // Hide all sub-visuals initially
            vz.line.visible = false; vz.skel.line.visible = false; vz.mesh.group.visible = false;
            for (const s of vz.tipSpheres) { s.visible = false; }

            if (handVizStyle === 'fingertips' || handVizStyle === 'index'){
              const tipNames = (handVizStyle === 'index') ? ['index-finger-tip'] : vz.tips;
              const tips = tipNames.map(name => { const j = src.hand?.get?.(name); return j ? frame.getJointPose(j, ref) : null; });
              if (tips.length && tips.some(t=>t)){
                const posAttr = vz.line.geometry.attributes.position; let idx=0;
                posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
                for (let i=0;i<tips.length;i++){
                  const tp = tips[i]?.transform?.position; if (tp){
                    const name = tipNames[i]; const fullIdx = vz.tips.indexOf(name);
                    if (fullIdx >= 0) { const sphere = vz.tipSpheres[fullIdx]; sphere.position.set(tp.x,tp.y,tp.z); sphere.visible = true; }
                    posAttr.setXYZ(idx++, tp.x, tp.y, tp.z);
                  } else {
                    posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
                  }
                }
                posAttr.needsUpdate = true; vz.line.visible = true; child.visible = true;
              } else { child.visible = false; }
            } else if (handVizStyle === 'skeleton'){
              // Draw line segments between known bones
              const posAttr = vz.skel.geom.attributes.position; let idx=0; let any=false;
              for (const [aName,bName] of BONES){
                const aJ = src.hand?.get?.(aName); const bJ = src.hand?.get?.(bName);
                const a = aJ ? frame.getJointPose(aJ, ref) : null; const b = bJ ? frame.getJointPose(bJ, ref) : null;
                if (a?.transform?.position && b?.transform?.position){
                  const ap = a.transform.position; const bp = b.transform.position;
                  posAttr.setXYZ(idx++, ap.x, ap.y, ap.z);
                  posAttr.setXYZ(idx++, bp.x, bp.y, bp.z);
                  any = true;
                } else {
                  // fill with wrist if missing to keep buffer bounds
                  posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
                  posAttr.setXYZ(idx++, wpos.x, wpos.y, wpos.z);
                }
              }
              posAttr.needsUpdate = true; vz.skel.line.visible = any; child.visible = any;
            } else if (handVizStyle === 'mesh'){
              // Approximate with cylinders along bones and a palm quad facing the camera
              const cam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera() : null;
              if (!cam) { child.visible=false; return; }
              vz.mesh.group.visible = true; child.visible = true;
              // Position palm proxy at wrist, oriented to camera
              const camQ = new THREE.Quaternion(); cam.getWorldQuaternion(camQ);
              vz.mesh.palm.position.set(wpos.x, wpos.y + 0.01, wpos.z);
              vz.mesh.palm.quaternion.copy(camQ);
              // Place cylinders along bones
              let i=0;
              for (const cyl of vz.mesh.boneCyls){ cyl.visible = false; }
              for (const [aName,bName] of BONES){
                if (i >= vz.mesh.boneCyls.length) break; const cyl = vz.mesh.boneCyls[i++];
                const aJ = src.hand?.get?.(aName); const bJ = src.hand?.get?.(bName);
                const a = aJ ? frame.getJointPose(aJ, ref) : null; const b = bJ ? frame.getJointPose(bJ, ref) : null;
                if (a?.transform?.position && b?.transform?.position){
                  const ap = new THREE.Vector3(a.transform.position.x, a.transform.position.y, a.transform.position.z);
                  const bp = new THREE.Vector3(b.transform.position.x, b.transform.position.y, b.transform.position.z);
                  const mid = ap.clone().add(bp).multiplyScalar(0.5);
                  const dir = new THREE.Vector3().subVectors(bp, ap);
                  const len = dir.length(); if (len < 1e-5) continue; dir.normalize();
                  // orient cylinder along dir
                  const q = new THREE.Quaternion(); q.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
                  cyl.position.copy(mid); cyl.quaternion.copy(q); cyl.scale.set(1, len, 1); cyl.visible = true;
                }
              }
            }
          };
          // Visualize both hands, but anchoring only uses left; right-hand viz is for pointing/poking only
          for (const src of sources){
            if (src.hand && src.handedness==='left') updateOne(src, handVizL);
            if (src.hand && src.handedness==='right') updateOne(src, handVizR);
          }
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
          // Evaluate candidate buttons and choose a single active one to avoid edge mis-clicks
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          let best = null; // { m, st, depth, dist }
          const ACTIVE_SHRINK_X = 0.85, ACTIVE_SHRINK_Y = 0.85; // shrink hit box to reduce boundary triggers
          const toLocal = (p, m)=> m.worldToLocal(new THREE.Vector3(p.x, p.y, p.z));
          if (idxPos){
            for (const b of buttons){
              const m = b.mesh; if (!m) continue; const st = ensurePressState(m);
              const lp = toLocal(idxPos, m);
              const halfW = BUTTON_W/2, halfH = BUTTON_H/2;
              const inX = Math.abs(lp.x) <= halfW * ACTIVE_SHRINK_X;
              const inY = Math.abs(lp.y) <= halfH * ACTIVE_SHRINK_Y;
              if (!inX || !inY) continue;
              const pen = penetrationAlongNormal(m, idxPos);
              const depth = THREE.MathUtils.clamp(-pen, 0, PRESS_MAX_M);
              if (depth <= 0) continue;
              const dist = Math.hypot(lp.x, lp.y);
              if (!best || depth > best.depth + 1e-6 || (Math.abs(depth - best.depth) < 1e-6 && dist < best.dist)){
                best = { m, st, depth, dist };
              }
            }
          }
          // Animate and handle press only on the best candidate; release others
          for (const b of buttons){
            const m = b.mesh; if (!m) continue; const st = ensurePressState(m);
            let targetDepth = 0; let within = false; let pressedNow = st.pressed;
            if (best && best.m === m){
              targetDepth = best.depth; within = true;
              // stability frames: require 2 frames above threshold before firing
              st._stable = (st._stable || 0) + (best.depth >= PRESS_START_M ? 1 : 0);
              const cooldown = st._cooldownUntil && now < st._cooldownUntil;
              if (!st.pressed && st._stable >= 2 && !cooldown) { pressedNow = true; }
              if (st.pressed && best.depth <= PRESS_RELEASE_M) { pressedNow = false; st._stable = 0; }
            } else {
              st._stable = 0;
              if (st.pressed) { pressedNow = false; }
            }
            // animate to target depth
            st.depth = st.depth + (targetDepth - st.depth) * PRESS_SMOOTH;
            const s = 1 - 0.15 * Math.min(1, st.depth / PRESS_MAX_M);
            m.scale.set(st.baseScale.x, st.baseScale.y * s, st.baseScale.z);
            // update hovered set for highlight
            if (within) { hovered.add(m); if (!fingerHover) fingerHover = m; }
            // onPress transition: fire onClick once and set cooldown
            if (!st.pressed && pressedNow){
              const handler = m.userData?.__hudButton?.onClick; if (typeof handler === 'function') { try { handler(); } catch{} }
              st._cooldownUntil = now + 180; // ms
              // Trigger flash overlay
              try { const fl = m.userData && m.userData.__flash; if (fl && fl.material) { fl.material.opacity = 0.9; } } catch {}
            }
            st.pressed = pressedNow;
            // Fade flash overlay each frame
            try { const fl = m.userData && m.userData.__flash; if (fl && fl.material && fl.material.opacity>0) { fl.material.opacity = Math.max(0, fl.material.opacity - 0.12); } } catch {}
          }
        } catch {}

  // Apply hover highlight for any hovered (ray or finger)
  hudTargets.forEach(m=>{ const mat=m.material; if (!mat) return; const on = hovered.has(m); mat.opacity = on ? 1.0 : 0.82; mat.needsUpdate=true; });
  // Expose HUD hover to suppress other interactions (e.g., teleport)
  try { window.__xrHudHover = !!controllerHoveringHUD; } catch{}

      } else {
        if (rightRay) rightRay.visible = false; if (rightRayTip) rightRayTip.visible = false;
        try { window.__xrHudHover = false; } catch{}
        }
    } catch {}
  }

  function resetPressStates(){ try { for (const b of buttons){ const st = ensurePressState(b.mesh); st.pressed=false; st.depth=0; st._stable=0; } } catch {} }

  function setHandVizStyle(style){
    const allowed = ['fingertips','index','off'];
    if (allowed.includes(style)) handVizStyle = style;
    // Hide spheres immediately if turned off
    try {
      for (const group of [handVizL, handVizR]){
        const child = group && group.children && group.children[0];
        const vz = child && child.userData && child.userData.__viz;
        if (!vz) continue;
        for (const s of vz.tipSpheres){ if (s) s.visible = (handVizStyle !== 'off'); }
      }
    } catch {}
  }

  return { ensure, remove, update, setAnchor, setHandVizStyle, get group(){ return hud; }, get buttons(){ return buttons; }, resetPressStates };
}
