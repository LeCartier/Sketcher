// First-person walk/fly service for desktop
// API: const fp = createFirstPerson({ THREE, renderer, scene, camera, domElement });
// fp.start({ hFov:100, constrainHeight:true }); fp.stop(); fp.update(dt);

export function createFirstPerson({ THREE, renderer, scene, camera, domElement, fpQuality }){
  const state = {
    active: false,
    fly: false,
    constrainHeight: true,
    heightFeet: 6,
    yaw: 0,
    pitch: 0,
    sens: 0.0025, // rad per px
    speed: 6, // feet per second
    boost: 2.5,
    keys: new Set(),
    dragging: false,
    prevCam: null,
    cleanup: [],
    maxAniso: (renderer?.capabilities?.getMaxAnisotropy && renderer.capabilities.getMaxAnisotropy()) || 1,
  prevPixelRatio: null,
  prevToneMapping: null,
  prevToneExposure: null,
  prevOutputCS: null,
  // Colliders cache for walk-mode collisions
  colliders: [],
  colliderRefreshTimer: 0,
  // Desktop AR environment (sun/ground/sky)
  env: null,
  // Vertical motion for gravity-based walk mode
  vy: 0,
  onGround: false,
  };

  // Click / short-tap tracking for distinguishing look-drag vs. quick teleport click
  const clickState = { downX:0, downY:0, downT:0, moveSum:0 };

  function setHFov(deg){
    if (!camera || !camera.isPerspectiveCamera) return;
    const aspect = Math.max(0.0001, renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight));
    const h = THREE.MathUtils.degToRad(Math.max(10, Math.min(150, deg)));
    const v = 2 * Math.atan(Math.tan(h/2) / aspect);
    camera.fov = THREE.MathUtils.radToDeg(v);
    camera.updateProjectionMatrix();
  }

  function applyHighQualityMaterials(){
    console.info('[FP] Applying high-quality material settings');
    try {
      scene.traverse(obj => {
        const mats = obj && obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : null;
        if (!mats) return;
        for (const m of mats){
          if (!m || typeof m !== 'object') continue;
          const setAniso = (tex)=>{ try { if (tex && 'anisotropy' in tex) tex.anisotropy = state.maxAniso; } catch{} };
          setAniso(m.map); setAniso(m.normalMap); setAniso(m.roughnessMap); setAniso(m.metalnessMap); setAniso(m.aoMap); setAniso(m.emissiveMap);
          if ('toneMapped' in m) m.toneMapped = true;
          // Enhanced material properties for better quality
          if ('needsUpdate' in m) m.needsUpdate = true;
        }
      });
    } catch{}
    // Optimal supersampling on desktop
    try { state.prevPixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : null; } catch{}
    try { renderer.setPixelRatio && renderer.setPixelRatio(Math.min(2.5, window.devicePixelRatio * 1.5 || 1.5)); } catch{}
    // Enhanced shadow map settings for better quality
    try {
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Higher quality shadows
        renderer.shadowMap.autoUpdate = true;
      }
    } catch{}
    // Tone mapping optimized for HDR backgrounds and realistic lighting
    try {
      state.prevToneMapping = renderer.toneMapping;
      state.prevToneExposure = renderer.toneMappingExposure;
      state.prevOutputCS = renderer.outputColorSpace || renderer.outputEncoding;
      renderer.outputColorSpace = (THREE.SRGBColorSpace || renderer.outputColorSpace);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0; // Slightly higher for HDR backgrounds
      console.info('[FP] Quality settings applied - Anisotropy:', state.maxAniso, 'PixelRatio:', renderer.getPixelRatio());
    } catch{}
  }

  function restoreQuality(){
    console.info('[FP] Restoring previous quality settings');
    try { if (state.prevPixelRatio != null) renderer.setPixelRatio(state.prevPixelRatio); } catch{}
    try { if (state.prevToneMapping != null) renderer.toneMapping = state.prevToneMapping; } catch{}
    try { if (state.prevToneExposure != null) renderer.toneMappingExposure = state.prevToneExposure; } catch{}
    try {
      if (state.prevOutputCS != null) {
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = state.prevOutputCS;
        else if ('outputEncoding' in renderer) renderer.outputEncoding = state.prevOutputCS;
      }
    } catch{}
    // Reset material anisotropy to default
    try {
      scene.traverse(obj => {
        const mats = obj && obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : null;
        if (!mats) return;
        for (const m of mats){
          if (!m || typeof m !== 'object') continue;
          const resetAniso = (tex)=>{ try { if (tex && 'anisotropy' in tex) tex.anisotropy = 1; } catch{} };
          resetAniso(m.map); resetAniso(m.normalMap); resetAniso(m.roughnessMap); resetAniso(m.metalnessMap); resetAniso(m.aoMap); resetAniso(m.emissiveMap);
        }
      });
    } catch{}
  }

  function onKey(e, down){
    if (!state.active) return; const k = e.key;
    const map = {
      'w':'w','W':'w','ArrowUp':'w',
      's':'s','S':'s','ArrowDown':'s',
      'a':'a','A':'a','ArrowLeft':'a',
      'd':'d','D':'d','ArrowRight':'d',
      'Shift':'Shift'
    };
    const tag = map[k]; if (!tag) return;
    if (down) state.keys.add(tag); else state.keys.delete(tag);
    e.preventDefault();
  }
  // Pointer-based look controls
  let lastPX = 0, lastPY = 0;
  function onPointerDown(e){
    if (!state.active) return;
    try { domElement.setPointerCapture && domElement.setPointerCapture(e.pointerId); } catch{}
    state.dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    clickState.downX = e.clientX; clickState.downY = e.clientY; clickState.downT = performance.now(); clickState.moveSum = 0;
    try { domElement.style.cursor = 'grabbing'; } catch{}
  // Hide reticle while dragging to look
  try { if (window.__teleport && window.__teleport.hideReticle) window.__teleport.hideReticle(); } catch{}
    e.preventDefault();
  }
  function onPointerUp(e){
    if (!state.active) return;
    state.dragging = false; try { domElement.releasePointerCapture && domElement.releasePointerCapture(e.pointerId); } catch{}
    try { domElement.style.cursor = 'grab'; } catch{}
    // Short click teleport: if quick tap and minimal movement, raycast to teleport discs
    try {
      const dt = performance.now() - (clickState.downT||0);
      const dx = Math.abs(e.clientX - (clickState.downX||0));
      const dy = Math.abs(e.clientY - (clickState.downY||0));
      const moved = (clickState.moveSum||0);
      if (dt < 300 && dx < 8 && dy < 8 && moved < 12){
        tryTeleportAtClient(e.clientX, e.clientY);
      }
    } catch{}
    e.preventDefault();
  }
  function onPointerMove(e){
    if (!state.active) return;
    // Reticle hover feedback when not dragging
    if (!state.dragging){ try { tryHoverReticleAtClient(e.clientX, e.clientY); } catch{} }
    // Look input when dragging
    if (!state.dragging) return;
    const dx = (typeof e.movementX === 'number' ? e.movementX : (e.clientX - lastPX));
    const dy = (typeof e.movementY === 'number' ? e.movementY : (e.clientY - lastPY));
    clickState.moveSum += Math.abs(dx) + Math.abs(dy);
    lastPX = e.clientX; lastPY = e.clientY;
    state.yaw -= dx * state.sens; state.pitch -= dy * state.sens;
    // Allow full pitch range since we'll handle horizon-locking in the skybox
    const upLimit = Math.PI/2 - 0.01; // Can look straight up
    const downLimit = -Math.PI/2 + 0.01; // Can look straight down
    state.pitch = Math.max(downLimit, Math.min(upLimit, state.pitch));
  }
  function onWheel(e){ if (!state.active) return; const delta = Math.sign(e.deltaY); state.speed = Math.max(1, Math.min(50, state.speed + (-delta))); }

  function add(el, type, fn, opts){ el.addEventListener(type, fn, opts); state.cleanup.push(()=> el.removeEventListener(type, fn, opts)); }

  function start(opts={}){
    if (state.active) return;
    state.active = true;
  // Normalize options: Fly implies no height constraint
  state.fly = !!opts.fly;
  state.constrainHeight = opts.constrainHeight !== false;
  if (state.fly) state.constrainHeight = false;
  if (!state.constrainHeight) state.fly = true;
    // Snapshot camera for restore
    state.prevCam = { fov: camera.fov, position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    // Initialize yaw/pitch from camera
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); state.yaw = e.y; state.pitch = e.x;
    applyHighQualityMaterials();
    setHFov(opts.hFov || 100);
    // Event listeners
    add(window, 'keydown', (e)=>onKey(e,true));
    add(window, 'keyup', (e)=>onKey(e,false));
  add(domElement, 'pointerdown', onPointerDown);
  add(domElement, 'pointerup', onPointerUp);
  add(domElement, 'pointermove', onPointerMove);
    add(domElement, 'wheel', onWheel, { passive:false });
  add(window, 'blur', ()=>{ state.keys.clear(); state.dragging=false; try { domElement.style.cursor = 'grab'; } catch{} });
    // Build simple UI
    buildUI();
  try { domElement.style.cursor = 'grab'; } catch{}
  // Desktop AR environment (sun/ground/sky)
  try { initDesktopEnv(); } catch{}
  // Default to original material mode on entry
  try { setMaterialMode('original'); } catch{}
  }

  function stop(){
    if (!state.active) return;
    state.active = false; state.dragging = false; state.keys.clear();
    // Restore camera
    try { camera.fov = state.prevCam.fov; camera.updateProjectionMatrix(); camera.position.copy(state.prevCam.position); camera.quaternion.copy(state.prevCam.quaternion); } catch{}
    state.prevCam = null;
    // Cleanup listeners
    for (const c of state.cleanup) { try { c(); } catch{} }
    state.cleanup = [];
    // Remove UI
    const ui = document.getElementById('fp-ui'); if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
  // Remove enviro panel if present
  const sp = document.getElementById('fp-enviro-panel'); if (sp && sp.parentNode) sp.parentNode.removeChild(sp);
  // Teardown environment
  try { disposeDesktopEnv(); } catch{}
    restoreQuality();
  try { domElement.style.cursor = ''; } catch{}
  // Hide any free-aim reticle on exit
  try { if (window.__teleport && window.__teleport.hideReticle) window.__teleport.hideReticle(); } catch{}
  }

  function update(dt){
    if (!state.active) return;
    // Compose new orientation from yaw/pitch
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), state.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), state.pitch);
    const q = qYaw.clone().multiply(qPitch);
    camera.quaternion.copy(q);
    // Move
    let fwd = new THREE.Vector3(0,0,-1).applyQuaternion(qYaw); // ignore pitch for walk/fly baseline forward
    let right = new THREE.Vector3(1,0,0).applyQuaternion(qYaw);
    let move = new THREE.Vector3();
    if (state.keys.has('w')) move.add(fwd);
    if (state.keys.has('s')) move.sub(fwd);
    if (state.keys.has('a')) move.sub(right);
    if (state.keys.has('d')) move.add(right);
    if (move.lengthSq()>0){ move.normalize(); }
    const mult = (state.keys.has('Shift') ? state.boost : 1) * state.speed * dt;
    move.multiplyScalar(mult);
    // For fly mode, allow pitch to influence forward motion when moving purely forward/backward
    if (state.fly && (state.keys.has('w') || state.keys.has('s')) && !(state.keys.has('a')||state.keys.has('d'))){
      const fwdPitch = new THREE.Vector3(0,0,-1).applyQuaternion(q);
      move.copy(fwdPitch.multiplyScalar((state.keys.has('s')?-1:1) * (state.keys.has('Shift') ? state.boost : 1) * state.speed * dt));
    }
    camera.position.add(move);

    // Walk mode: use gravity/ground detection instead of hard-clamping the head height.
    if (state.constrainHeight){
      refreshCollidersIfNeeded(dt);
      // First resolve horizontal collisions using the current head/feet span
      applyWalkCollisions(camera);
      // Then resolve vertical position via simple gravity and ground raycast
      resolveVerticalAndGravity(dt, camera);
    }
  }

  const PERSON_RADIUS = 0.75; // feet (1.5ft wide)
  // Build/refresh a list of potential colliders (visible meshes) periodically
  function refreshCollidersIfNeeded(dt){
    state.colliderRefreshTimer -= dt;
    if (state.colliderRefreshTimer > 0) return;
    state.colliderRefreshTimer = 0.35; // refresh ~3x per second
    const list = [];
    try {
      scene.updateMatrixWorld(true);
      scene.traverse(obj => {
        // Only meshes with geometry, visible, and not helpers/gizmos/grids
        if (!obj || !obj.isMesh || !obj.geometry || obj.visible === false) return;
        if (isHelperLike(obj)) return;
        const box = new THREE.Box3();
        try { box.setFromObject(obj); } catch { return; }
        if (!box || !isFinite(box.min.x) || box.isEmpty()) return;
        // Ignore very flat/ground-like boxes to avoid fighting the floor
        const height = box.max.y - box.min.y;
        if (height < 0.75) return; // ignore things shorter than ~9 inches (floors, tiny trim)
        list.push({ obj, box });
      });
    } catch {}
    state.colliders = list;
  }

  function isHelperLike(obj){
    try {
      if (obj.isGridHelper) return true;
      const n = (obj.name||'').toLowerCase();
      const t = (obj.type||'').toLowerCase();
      if (n.startsWith('__')) return true;
      if (n.includes('transformcontrols') || t.includes('transformcontrols')) return true;
      if (n.includes('gizmo')) return true;
      return false;
    } catch { return false; }
  }

  function applyWalkCollisions(camera){
    const pos = camera.position;
    if (!state.colliders || state.colliders.length === 0) return;
    // The capsule spans from feetY .. headY
    const headY = pos.y;
    const feetY = pos.y - state.heightFeet;
    const bottomY = feetY;
    const topY = headY;
    // Iterate a few times to resolve corner overlaps
    for (let iter=0; iter<3; iter++){
      let moved = false;
      for (const { box } of state.colliders){
        // Quick vertical overlap test with capsule span
        if (box.max.y < bottomY || box.min.y > topY) continue;
        // Expand XZ by radius
        const minX = box.min.x - PERSON_RADIUS;
        const maxX = box.max.x + PERSON_RADIUS;
        const minZ = box.min.z - PERSON_RADIUS;
        const maxZ = box.max.z + PERSON_RADIUS;
        if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ){
          // If the collider top is a small step within tolerance, step up onto it
          try {
            const boxTop = box.max.y;
            const feetY = pos.y - state.heightFeet;
            const stepUp = boxTop - feetY;
            if (stepUp > 0 && stepUp <= STEP_TOLERANCE){
              // Snap up to the step surface
              pos.y = boxTop + state.heightFeet;
              state.onGround = true;
              state.vy = 0;
              moved = true;
              continue; // skip horizontal push for this collider
            }
          } catch{}
          // Inside horizontally; compute minimal push along X or Z
          const pushToMaxX = (maxX - pos.x);     // positive pushes +X
          const pushToMinX = (pos.x - minX);     // positive pushes -X (we'll negate later)
          const pushToMaxZ = (maxZ - pos.z);     // +Z
          const pushToMinZ = (pos.z - minZ);     // -Z
          // Find smallest magnitude push
          const px = (pushToMaxX < pushToMinX) ? pushToMaxX : -pushToMinX;
          const pz = (pushToMaxZ < pushToMinZ) ? pushToMaxZ : -pushToMinZ;
          if (Math.abs(px) < Math.abs(pz)){
            pos.x += px + Math.sign(px)*1e-3;
          } else {
            pos.z += pz + Math.sign(pz)*1e-3;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // Shared raycaster for ground queries
  const _groundRay = new THREE.Raycaster();
  // Find ground Y below the camera by raycasting downward across a small area (diameter 1ft => radius 0.5ft).
  // Returns the highest hit Y among samples, or null if none.
  function findGroundY(camera, radius = 0.5){
    try {
      const samples = [];
      // Sample center + 8 around circle (approx)
      const r = Math.max(0, radius);
      samples.push(new THREE.Vector3(0,0,0));
      const offs = [
        [r,0],[ -r,0 ], [0,r], [0,-r],
        [r*0.707, r*0.707], [r*0.707, -r*0.707], [-r*0.707, r*0.707], [-r*0.707, -r*0.707]
      ];
      for (const o of offs) samples.push(new THREE.Vector3(o[0], 0, o[1]));

      let bestY = null;
      for (const s of samples){
        const origin = camera.position.clone().add(new THREE.Vector3(s.x, 0, s.z));
        const dir = new THREE.Vector3(0, -1, 0);
        _groundRay.set(origin, dir);
        _groundRay.far = 1000;
        const hits = _groundRay.intersectObjects(scene.children, true);
        for (const h of hits){
          if (!h || !h.object) continue;
          if (isHelperLike(h.object)) continue;
          const y = h.point.y;
          if (bestY === null || y > bestY) bestY = y; // prefer highest support
          break; // take first non-helper hit for this sample
        }
      }
      return bestY;
    } catch(e){}
    return null;
  }

  const GRAVITY_FT_S2 = 32.174; // feet / s^2
  const MAX_FALL_SPEED = 200; // arbitrary cap
  const STEP_TOLERANCE = 0.5; // feet: small step that can be stepped onto without falling

  function resolveVerticalAndGravity(dt, camera){
    // Determine ground support within a 1ft diameter zone
    const supportY = findGroundY(camera, 0.5);
    const floorY = (supportY !== null) ? supportY : 0;
    const desiredHeadY = floorY + state.heightFeet;
    const feetY = camera.position.y - state.heightFeet;
    const supportedNow = (supportY !== null) && (feetY - floorY <= STEP_TOLERANCE + 1e-3);

    if (state.onGround){
      state.vy = 0;
      if (!supportedNow){
        // Leave ground only when the support zone no longer supports the player
        state.onGround = false;
      } else {
        // Stay glued to ground
        if (camera.position.y !== desiredHeadY){ camera.position.y = desiredHeadY; }
      }
    }

    if (!state.onGround){
      // Apply gravity step
      state.vy = Math.max(-MAX_FALL_SPEED, state.vy - GRAVITY_FT_S2 * dt);
      camera.position.y += state.vy * dt;
      // Re-sample support to check for landing at the new position
      const newSupportY = findGroundY(camera, 0.5);
      const newFloorY = (newSupportY !== null) ? newSupportY : 0;
      const newDesiredHeadY = newFloorY + state.heightFeet;
      if (camera.position.y <= newDesiredHeadY){
        camera.position.y = newDesiredHeadY;
        state.vy = 0;
        state.onGround = true;
      }
    }
  }

  function buildUI(){
    const ui = document.createElement('div'); ui.id='fp-ui';
    // Bottom-center, responsive to safe-area and VisualViewport changes
    Object.assign(ui.style, {
      position:'fixed',
      left:'50%',
      transform:'translateX(-50%)',
      bottom:'calc(12px + env(safe-area-inset-bottom, 0px))',
      display:'flex',
      gap:'8px',
      zIndex:10000,
      alignItems:'center',
      justifyContent:'center'
    });
  const mkBtn = (label)=>{ const b=document.createElement('button'); b.textContent=label; b.style.padding='8px 10px'; b.style.borderRadius='8px'; b.style.border='1px solid #666'; b.style.background='#111a'; b.style.color='#fff'; b.style.backdropFilter='blur(6px)'; b.style.cursor='pointer'; return b; };
  const toggle = mkBtn(state.constrainHeight ? 'Mode: Walk (6ft)' : 'Mode: Fly');
  const qualityBtn = mkBtn('Quality: High');
    const exit = mkBtn('Exit');
  const sunBtn = mkBtn('Enviro');
  const matBtn = mkBtn('Materials: Original');
    toggle.addEventListener('click', ()=>{
      // Toggle Walk <-> Fly coherently
      if (state.constrainHeight){
        // Switch to Fly
        state.constrainHeight = false;
        state.fly = true;
      } else {
        // Switch to Walk
        state.constrainHeight = true;
        state.fly = false;
      }
      toggle.textContent = state.constrainHeight ? 'Mode: Walk (6ft)' : 'Mode: Fly';
    });
    exit.addEventListener('click', ()=> stop());
  sunBtn.addEventListener('click', ()=>{ toggleEnviroPanel(); });
    matBtn.addEventListener('click', ()=>{
      const modes = ['original','white','white-outline','wire','xray'];
      const cur = (state.env && state.env.matMode) || 'original';
      const idx = modes.indexOf(cur);
      const next = modes[(idx+1) % modes.length];
      setMaterialMode(next);
      matBtn.textContent = `Materials: ${
        next==='original' ? 'Original' :
        next==='white' ? 'White' :
        next==='white-outline' ? 'White+Outline' :
        next==='wire' ? 'Wireframe' : 'X-Ray'
      }`;
    });
    qualityBtn.addEventListener('click', ()=>{
      try {
        const cur = fpQuality && fpQuality.getMode ? fpQuality.getMode() : 'high';
        const next = (cur==='low') ? 'high' : (cur==='high' ? 'ultra' : 'low');
        fpQuality && fpQuality.setMode && fpQuality.setMode(next);
        qualityBtn.textContent = `Quality: ${next.charAt(0).toUpperCase()+next.slice(1)}`;
        try { localStorage.setItem('fp.qualityMode', next); } catch{}
      } catch{}
    });
    // Initialize from stored preference
    try { const saved = localStorage.getItem('fp.qualityMode'); if (saved && fpQuality && fpQuality.setMode){ fpQuality.setMode(saved); qualityBtn.textContent = `Quality: ${saved.charAt(0).toUpperCase()+saved.slice(1)}`; } } catch{}
    ui.append(toggle, qualityBtn, matBtn, sunBtn, exit); document.body.appendChild(ui);
    // Adjust for VisualViewport bottom offset dynamically
    const vv = window.visualViewport || null;
    function applyVV(){
      try {
        const offset = vv ? Math.max(0, (window.innerHeight - vv.height - vv.offsetTop)) : 0;
        ui.style.bottom = `calc(${12 + offset}px + env(safe-area-inset-bottom, 0px))`;
      } catch{}
    }
    applyVV();
    if (vv){
      const onVV = ()=> applyVV();
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
      state.cleanup.push(()=>{ try { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); } catch{} });
    }
  }

  // ---- Free-aim teleport (reticle + click) ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setPointerFromClient(clientX, clientY){
    const r = domElement.getBoundingClientRect();
    const x = (clientX - r.left) / Math.max(1, r.width);
    const y = (clientY - r.top) / Math.max(1, r.height);
    ndc.x = x*2 - 1;
    ndc.y = - (y*2 - 1);
  }
  function tryTeleportAtClient(clientX, clientY){
    if (!window.__teleport) return false;
    const picked = pickTeleportPointAtClient(clientX, clientY);
    if (picked && picked.point){ try { window.__teleport.teleportToPoint(picked.point, picked.normal); } catch{} return true; }
    return false; // no valid surface
  }
  function tryHoverReticleAtClient(clientX, clientY){
    if (!window.__teleport || !window.__teleport.showReticleAt) return;
    const picked = pickTeleportPointAtClient(clientX, clientY);
    if (picked && picked.point){ try { window.__teleport.showReticleAt(picked.point, picked.normal); } catch{} }
    else { try { if (window.__teleport.hideReticle) window.__teleport.hideReticle(); } catch{} }
  }

  function pickTeleportPointAtClient(clientX, clientY){
    try {
      setPointerFromClient(clientX, clientY);
      raycaster.setFromCamera(ndc, camera);
      // Improve picking for thin geometry
      try { raycaster.params.Line = { threshold: 0.01 }; raycaster.params.Points = { threshold: 0.02 }; } catch{}
      // Build candidate targets: visible scene meshes excluding helpers and our FP env
      const targets = [];
      scene.traverse(o=>{ try { if (!o || !o.visible) return; if (isHelperLike(o)) return; if (state.env && (o===state.env.group || o.parent===state.env.group)) return; if (o.isMesh) targets.push(o); } catch{} });
      const hits = raycaster.intersectObjects(targets, true);
      for (const h of hits){
        if (!h || !h.object) continue;
  // (Teleport discs removed)
        // Require a face and compute world normal
        if (!h.face) continue;
        const nLocal = h.face.normal.clone();
        const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
        const nWorld = nLocal.applyMatrix3(nm).normalize();
        // Only allow mostly-up surfaces to feel natural (<= ~50deg tilt)
        const up = new THREE.Vector3(0,1,0);
        const cos = nWorld.dot(up);
        if (cos < 0.64) continue;
        // Use the first valid hit
        return { point: h.point.clone(), normal: nWorld };
      }
    } catch{}
    return null;
  }

  // ---- Desktop environment (sun/ground/sky + optional HDRI) ----
  function initDesktopEnv(){
    if (state.env) return;
    const group = new THREE.Group(); group.name = '__fp_env';
    // Sky background (simple gradient texture)
    const sky = { top:'#87ceeb', bottom:'#e6f3ff' };
    const prevBg = scene.background || null;
    const skyTex = makeSkyTexture(sky.top, sky.bottom);
    scene.background = skyTex;
    // Hide existing GridHelpers to avoid z-fight with ground
    const hiddenGrids = [];
    try {
      scene.traverse(o=>{ if (o && o.isGridHelper && o.visible){ hiddenGrids.push(o); o.visible=false; } });
    } catch{}
    // Ground plane that receives shadows
    const gMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.95, metalness: 0.0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000,2000), gMat);
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.001;
    ground.receiveShadow = true; group.add(ground);
    // Sun directional light with shadows and target
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
    const r = 60; // shadow frustum half-extents
    sun.shadow.camera.left = -r; sun.shadow.camera.right = r;
    sun.shadow.camera.top = r; sun.shadow.camera.bottom = -r;
    const sunTarget = new THREE.Object3D(); sunTarget.position.set(0,0,0); group.add(sunTarget); sun.target = sunTarget;
    group.add(sun);
    scene.add(group);
  // Default sun angles
  const params = { azimuth: 135, elevation: 45, intensity: 1.2, color: '#ffffff', shadows: true };
    applySun(params, sun);
    // Cache and expose
  state.env = { group, ground, sun, sunTarget, skyTex, sky, prevBg, hiddenGrids, params, matMode: 'original', matsBackup: new Map(), castBackup: new Map(), tempMaterials: new Set(), outlines: new Set(), hemi: null, pmrem: null, hdrEquirect: null, envMap: null, skybox: null, bgMode: 'hdr', disabledLights: [] };
  // Enable shadow casting on scene meshes (store previous)
  try { enableSceneShadows(); } catch{}
  // Subtle hemisphere light for better separation
  try { const hemi = new THREE.HemisphereLight(0xdfe8ff, 0xf0efe9, 0.35); state.env.hemi = hemi; scene.add(hemi); } catch{}
  // Load default HDRI to showcase Three.js HDR capabilities
  try { applyBackgroundMode(); } catch{}
  // Disable pre-existing scene lights to prevent double lighting/shadows; FP sun controls lighting here
  try {
    scene.traverse(o=>{
      try {
        if (!o || !o.isLight) return;
        if (o === state.env.sun || o === state.env.hemi) return;
        const rec = { light: o, intensity: (typeof o.intensity === 'number' ? o.intensity : null), castShadow: !!o.castShadow };
        state.env.disabledLights.push(rec);
        if (typeof o.intensity === 'number') o.intensity = 0;
        o.castShadow = false;
      } catch {}
    });
  } catch {}
  }

  function disposeDesktopEnv(){
    const e = state.env; if (!e) return; state.env = null;
  try { restoreMaterialsAndShadows(e); } catch{}
  try { scene.background = e.prevBg || null; } catch{}
  try { scene.environment = null; } catch{}
    try { if (e.skyTex && e.skyTex.dispose) e.skyTex.dispose(); } catch{}
    try { if (e.ground && e.ground.geometry) e.ground.geometry.dispose(); if (e.ground && e.ground.material && e.ground.material.dispose) e.ground.material.dispose(); } catch{}
  try { if (e.sun && e.sun.parent) e.sun.parent.remove(e.sun); } catch{}
  try { if (e.hemi && e.hemi.parent) e.hemi.parent.remove(e.hemi); } catch{}
    try { if (e.group && e.group.parent) e.group.parent.remove(e.group); } catch{}
    try { if (Array.isArray(e.hiddenGrids)) e.hiddenGrids.forEach(g=>{ try { g.visible = true; } catch{} }); } catch{}
  // Dispose custom skybox
  try { 
    if (e.skybox) {
      scene.remove(e.skybox);
      if (e.skybox.geometry) e.skybox.geometry.dispose();
      if (e.skybox.material) e.skybox.material.dispose();
    } 
  } catch{}
  // Dispose PMREM/HDR resources
  try { if (e.pmrem && e.pmrem.dispose) e.pmrem.dispose(); } catch{}
  try { if (e.hdrEquirect && e.hdrEquirect.dispose) e.hdrEquirect.dispose(); } catch{}
  try { if (e.envMap && e.envMap.dispose) e.envMap.dispose(); } catch{}
  // Restore any scene lights we disabled on entry
  try {
    if (Array.isArray(e.disabledLights)){
      for (const rec of e.disabledLights){
        try {
          if (!rec || !rec.light) continue;
          if (typeof rec.intensity === 'number') rec.light.intensity = rec.intensity;
          rec.light.castShadow = !!rec.castShadow;
        } catch {}
      }
    }
  } catch {}
  }

  function makeSkyTexture(top, bottom){
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const ctx = c.getContext('2d');
    const grd = ctx.createLinearGradient(0,0,0,512); grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    ctx.fillStyle = grd; ctx.fillRect(0,0,512,512);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding; return tex;
  }

  function applySun(params, sun){
    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(params.elevation, 0, 90));
    const az = THREE.MathUtils.degToRad(((params.azimuth%360)+360)%360);
    const h = Math.cos(elev); const y = Math.sin(elev);
    const x = Math.sin(az) * h; const z = -Math.cos(az) * h;
    const dist = 120;
    sun.position.set(x*dist, y*dist, z*dist);
    sun.intensity = params.intensity;
    try { sun.color && sun.color.set(params.color||'#ffffff'); } catch{}
    sun.castShadow = !!params.shadows;
    if (sun.target){ sun.target.position.set(0,0,0); sun.target.updateMatrixWorld(); }
  }

  function toggleEnviroPanel(){
    const id = 'fp-enviro-panel';
    let p = document.getElementById(id);
    if (p){ p.remove(); return; }
    if (!state.env) return;
    p = document.createElement('div'); p.id = id;
    Object.assign(p.style, {
      position:'fixed', left:'50%', transform:'translateX(-50%)',
      bottom:'calc(64px + env(safe-area-inset-bottom, 0px))', zIndex:10001,
      background:'#111a', color:'#fff', border:'1px solid #666', borderRadius:'10px', padding:'10px 12px',
      backdropFilter:'blur(6px)', display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 10px', minWidth:'260px'
    });
  const mkLabel = (t)=>{ const l=document.createElement('label'); l.textContent=t; l.style.alignSelf='center'; return l; };
    const mkRange = (min,max,step,val)=>{ const r=document.createElement('input'); r.type='range'; r.min=min; r.max=max; r.step=step; r.value=val; r.style.width='140px'; return r; };
    const mkColor = (val)=>{ const i=document.createElement('input'); i.type='color'; i.value=val; return i; };
  const mkCheck = (val)=>{ const i=document.createElement('input'); i.type='checkbox'; i.checked=val; return i; };
  const s = state.env.params; const sun = state.env.sun;
    const az = mkRange(0,360,1,s.azimuth);
    const el = mkRange(0,90,1,s.elevation);
    const it = mkRange(0,5,0.1,s.intensity);
    const col = mkColor(s.color);
    const sh = mkCheck(s.shadows);
    // Background mode toggle (HDR vs Sky)
    const bgLabel = mkLabel('Background');
    const bgSel = document.createElement('select'); bgSel.innerHTML = '<option value="sky">Sky</option><option value="hdr">HDRI</option>'; bgSel.value = (state.env.bgMode || 'sky');
    bgSel.addEventListener('change', ()=>{
      try { state.env.bgMode = bgSel.value; applyBackgroundMode(); } catch{}
    });
    // HDRI file picker (accept .hdr); lazy-loads and switches to HDR mode
    const fileLabel = mkLabel('HDRI File');
    const fileBtn = document.createElement('button'); fileBtn.textContent = 'Choose…'; fileBtn.style.padding='6px 10px'; fileBtn.style.borderRadius='8px'; fileBtn.style.border='1px solid #666'; fileBtn.style.background='#222'; fileBtn.style.color='#fff';
    const fileInput = document.createElement('input'); fileInput.type='file'; fileInput.accept='.hdr'; fileInput.style.display='none';
    fileBtn.addEventListener('click', ()=> fileInput.click());
    fileInput.addEventListener('change', ()=>{
      const f = fileInput.files && fileInput.files[0]; if (!f) return;
      try {
        // Switch to HDR mode BEFORE loading so applyBackgroundMode() uses HDR when the texture resolves
        state.env.bgMode = 'hdr';
        bgSel.value = 'hdr';
        loadHDRIFromFile(f);
      } catch{}
    });
    
    // HDRI rotate and flip buttons (compact, side by side)
    const transformLabel = mkLabel('HDRI Transform');
    const rotateBtn = document.createElement('button'); rotateBtn.textContent = 'Rotate 180°'; rotateBtn.style.padding='4px 8px'; rotateBtn.style.borderRadius='6px'; rotateBtn.style.border='1px solid #666'; rotateBtn.style.background='#222'; rotateBtn.style.color='#fff'; rotateBtn.style.fontSize='11px'; rotateBtn.style.marginRight='4px';
    const flipBtn = document.createElement('button'); flipBtn.textContent = 'Flip Vertical'; flipBtn.style.padding='4px 8px'; flipBtn.style.borderRadius='6px'; flipBtn.style.border='1px solid #666'; flipBtn.style.background='#222'; flipBtn.style.color='#fff'; flipBtn.style.fontSize='11px';
    
    const transformContainer = document.createElement('div');
    transformContainer.appendChild(rotateBtn);
    transformContainer.appendChild(flipBtn);
    
    rotateBtn.addEventListener('click', ()=>{
      try {
        if (state.env && state.env.skybox && state.env.skybox.material && state.env.skybox.material.uniforms) {
          const currentRotate = state.env.skybox.material.uniforms.rotateHorizontal.value;
          state.env.skybox.material.uniforms.rotateHorizontal.value = !currentRotate;
          console.info('[FP] HDRI rotated:', !currentRotate ? '180°' : 'normal');
        }
      } catch(err){ console.warn('[FP] Rotate error:', err); }
    });
    
    flipBtn.addEventListener('click', ()=>{
      try {
        if (state.env && state.env.skybox && state.env.skybox.material && state.env.skybox.material.uniforms) {
          const currentFlip = state.env.skybox.material.uniforms.flipVertical.value;
          state.env.skybox.material.uniforms.flipVertical.value = !currentFlip;
          console.info('[FP] HDRI flipped vertically:', !currentFlip ? 'flipped' : 'normal');
        }
      } catch(err){ console.warn('[FP] Flip error:', err); }
    });
    
    // Ground plane customization
    const groundLabel = mkLabel('Ground');
    const groundColorPicker = mkColor('#cfcfcf'); // Default ground color
    const groundTextureBtn = document.createElement('button'); groundTextureBtn.textContent = 'Texture…'; groundTextureBtn.style.padding='4px 8px'; groundTextureBtn.style.borderRadius='6px'; groundTextureBtn.style.border='1px solid #666'; groundTextureBtn.style.background='#222'; groundTextureBtn.style.color='#fff'; groundTextureBtn.style.fontSize='11px'; groundTextureBtn.style.marginLeft='4px';
    const groundTextureInput = document.createElement('input'); groundTextureInput.type='file'; groundTextureInput.accept='image/*'; groundTextureInput.style.display='none';
    
    const groundContainer = document.createElement('div');
    groundContainer.appendChild(groundColorPicker);
    groundContainer.appendChild(groundTextureBtn);
    
    // Ground color picker event
    groundColorPicker.addEventListener('input', ()=>{
      try {
        if (state.env && state.env.ground && state.env.ground.material) {
          state.env.ground.material.color.set(groundColorPicker.value);
          // Reset to color material if texture was applied
          if (state.env.ground.material.map) {
            state.env.ground.material.map = null;
            state.env.ground.material.needsUpdate = true;
          }
          console.info('[FP] Ground color changed:', groundColorPicker.value);
        }
      } catch(err){ console.warn('[FP] Ground color error:', err); }
    });
    
    // Ground texture picker event
    groundTextureBtn.addEventListener('click', ()=> groundTextureInput.click());
    groundTextureInput.addEventListener('change', ()=>{
      const f = groundTextureInput.files && groundTextureInput.files[0]; if (!f) return;
      try {
        const url = URL.createObjectURL(f);
        const loader = new THREE.TextureLoader();
        loader.load(url, (texture) => {
          try {
            if (state.env && state.env.ground && state.env.ground.material) {
              // Dispose old texture if any
              if (state.env.ground.material.map) {
                state.env.ground.material.map.dispose();
              }
              // Apply new texture
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.RepeatWrapping;
              texture.repeat.set(40, 40); // Tile the texture
              state.env.ground.material.map = texture;
              state.env.ground.material.needsUpdate = true;
              console.info('[FP] Ground texture applied:', f.name);
            }
          } catch(err){ console.warn('[FP] Texture application error:', err); }
          // Clean up object URL
          URL.revokeObjectURL(url);
        }, undefined, (err) => {
          console.warn('[FP] Texture load error:', err);
          URL.revokeObjectURL(url);
        });
      } catch(err){ console.warn('[FP] Ground texture error:', err); }
    });
    
    const close = document.createElement('button'); close.textContent='Close'; close.style.gridColumn='1 / span 2'; close.style.marginTop='6px';
    close.style.padding='6px 10px'; close.style.borderRadius='8px'; close.style.border='1px solid #666'; close.style.background='#222'; close.style.color='#fff';
    // Wire events
    const apply = ()=>{ s.azimuth=Number(az.value); s.elevation=Number(el.value); s.intensity=Number(it.value); s.color=col.value; s.shadows=!!sh.checked; applySun(s, sun); };
    az.addEventListener('input', apply); el.addEventListener('input', apply); it.addEventListener('input', apply); col.addEventListener('input', apply); sh.addEventListener('change', apply);
    close.addEventListener('click', ()=> p.remove());
    // Layout
    p.append(
      mkLabel('Azimuth'), az,
      mkLabel('Elevation'), el,
      mkLabel('Intensity'), it,
      mkLabel('Color'), col,
      mkLabel('Shadows'), sh,
      bgLabel, bgSel,
      fileLabel, fileBtn,
      transformLabel, transformContainer,
      groundLabel, groundContainer,
      close
    );
    document.body.appendChild(p);
    // Attach hidden inputs after appending panel
    p.appendChild(fileInput);
    p.appendChild(groundTextureInput);
  }

  // ---- HDRI environment ----
  async function loadHDRI(url){
    console.info('[FP] Starting HDR load:', url);
    try {
      const [{ RGBELoader }] = await Promise.all([
        import('../../vendor/RGBELoader.js')
      ]);
      console.info('[FP] RGBELoader imported successfully');
      
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      console.info('[FP] PMREM generator created');
      
      const loader = new RGBELoader();
      // Try different data types if needed - some browsers prefer HalfFloatType
      try {
        loader.setDataType(THREE.HalfFloatType);
      } catch {
        try {
          loader.setDataType(THREE.UnsignedByteType);
        } catch {
          console.warn('[FP] Could not set RGBELoader data type, using default');
        }
      }
      
      console.info('[FP] Starting texture load from:', url);
    loader.load(url, (hdrTex)=>{
        try {
          console.info('[FP] HDR texture loaded successfully!', {
            width: hdrTex.image?.width,
            height: hdrTex.image?.height,
            format: hdrTex.format,
            type: hdrTex.type,
            mapping: hdrTex.mapping
          });
          
          // Create horizon-locked skybox instead of full 360° sphere
          hdrTex.mapping = THREE.EquirectangularMapping;
          // RGBELoader provides linear data; configure for proper HDR display
          try { 
            hdrTex.magFilter = THREE.LinearFilter; 
            hdrTex.minFilter = THREE.LinearFilter; 
            hdrTex.generateMipmaps = false;
            hdrTex.flipY = false; // Don't flip - we'll handle orientation in skybox
            hdrTex.wrapS = THREE.RepeatWrapping;
            hdrTex.wrapT = THREE.ClampToEdgeWrapping;
            // For THREE.js 0.155+, ensure proper color space handling
            if ('colorSpace' in hdrTex) {
              hdrTex.colorSpace = THREE.LinearSRGBColorSpace;
            } else if ('encoding' in hdrTex) {
              hdrTex.encoding = THREE.LinearEncoding;
            }
            hdrTex.needsUpdate = true;
            console.info('[FP] HDR texture configured for horizon-locked skybox');
          } catch(err){ console.warn('[FP] HDR texture config error:', err); }
          
          // Create a copy for environment mapping with reflection mapping
          const envTex = hdrTex.clone();
          envTex.mapping = THREE.EquirectangularReflectionMapping;
          envTex.needsUpdate = true;
          
          const envMap = pmrem.fromEquirectangular(envTex).texture;
          console.info('[FP] PMREM environment map generated successfully');
          
          // Dispose the temporary environment texture
          envTex.dispose();
          
          // Cache resources for cleanup
          if (state.env){
            // Dispose previous HDR resources if replacing
            try { if (state.env.pmrem && state.env.pmrem !== pmrem) state.env.pmrem.dispose(); } catch{}
            try { if (state.env.envMap && state.env.envMap !== envMap) state.env.envMap.dispose(); } catch{}
            try { if (state.env.hdrEquirect && state.env.hdrEquirect !== hdrTex) state.env.hdrEquirect.dispose(); } catch{}
            try { if (state.env.hdrObjectUrl) { URL.revokeObjectURL(state.env.hdrObjectUrl); state.env.hdrObjectUrl = null; } } catch{}
            
            state.env.pmrem = pmrem;
            state.env.hdrEquirect = hdrTex;
            state.env.envMap = envMap;
            
            // Create horizon-locked skybox
            createHorizonLockedSkybox(hdrTex);
            
            // Force immediate application for testing
            console.info('[FP] Forcing immediate HDR background application');
            // Use the custom skybox instead of direct texture background
            applyBackgroundMode();
            
            // Debug: Check if background was actually set
            setTimeout(() => {
              console.info('[FP] Background check:', {
                sceneBackground: !!scene.background,
                backgroundType: scene.background?.constructor?.name,
                isTexture: scene.background?.isTexture,
                textureImage: scene.background?.image ? 'has image' : 'no image',
                imageSize: scene.background?.image ? `${scene.background.image.width}x${scene.background.image.height}` : 'N/A'
              });
            }, 100);
            
            // Also trigger the normal background mode application
            applyBackgroundMode();
            console.info('[FP] HDRI completely loaded and applied:', url);
          }
        } catch(err){ console.error('[FP] HDR processing error:', err, err.stack); }
  }, 
  (progress) => {
    console.info('[FP] HDR loading progress:', Math.round((progress.loaded / progress.total) * 100) + '%');
  }, 
  (err)=> { 
    try { pmrem.dispose(); } catch{} 
    console.error('[FP] HDRI load failed:', url, err, err.stack); 
  });
    } catch(err){ console.error('[FP] HDR load setup error:', err, err.stack); }
  }

  function createHorizonLockedSkybox(hdrTexture) {
    console.info('[FP] Creating horizon-locked skybox');
    try {
      // Remove existing skybox if present
      if (state.env.skybox) {
        scene.remove(state.env.skybox);
        if (state.env.skybox.geometry) state.env.skybox.geometry.dispose();
        if (state.env.skybox.material) state.env.skybox.material.dispose();
      }

      // Create a large sphere geometry for the skybox
      const geometry = new THREE.SphereGeometry(500, 60, 40);
      
      // Create custom shader material for horizon-locked HDR skybox
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tEquirect: { value: hdrTexture },
          horizonOffset: { value: 0.5 }, // Offset to position horizon at eye level
          skyIntensity: { value: 1.0 },
          rotateHorizontal: { value: false }, // Toggle for 180° horizontal rotation
          flipVertical: { value: false } // Toggle for vertical flip (sphere inside-out)
        },
        vertexShader: `
          varying vec3 vWorldDirection;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tEquirect;
          uniform float horizonOffset;
          uniform float skyIntensity;
          uniform bool rotateHorizontal;
          uniform bool flipVertical;
          varying vec3 vWorldDirection;

          vec2 equirectUv(vec3 dir) {
            // Apply vertical flip by inverting the direction vector's Y component
            if (flipVertical) {
              dir.y = -dir.y;
            }
            
            // Convert 3D direction to equirectangular UV coordinates
            float phi = atan(dir.z, dir.x);
            // Apply horizontal rotation if enabled (180° rotation)
            if (rotateHorizontal) {
              phi = phi + 3.14159265359;
            }
            float theta = asin(clamp(dir.y, -1.0, 1.0));
            
            vec2 uv = vec2(
              (phi / (2.0 * 3.14159265359)) + 0.5,
              1.0 - ((theta / 3.14159265359) + horizonOffset)
            );
            
            // Clamp V coordinate to only show sky portion (now upper half after flip)
            uv.y = clamp(uv.y, 0.0, 1.0 - horizonOffset);
            
            return uv;
          }

          void main() {
            vec3 direction = normalize(vWorldDirection);
            
            // For downward looking directions, fade to a ground color instead of HDR ground
            if (direction.y < -0.1) {
              // Simple ground color fade
              float groundFade = clamp((-direction.y - 0.1) / 0.3, 0.0, 1.0);
              vec3 groundColor = vec3(0.3, 0.25, 0.2); // Brownish ground color
              vec2 skyUv = equirectUv(vec3(direction.x, 0.0, direction.z)); // Use horizon for color
              vec3 skyColor = texture2D(tEquirect, skyUv).rgb;
              gl_FragColor = vec4(mix(skyColor, groundColor, groundFade) * skyIntensity, 1.0);
            } else {
              // Use HDR texture for sky
              vec2 uv = equirectUv(direction);
              vec4 texColor = texture2D(tEquirect, uv);
              gl_FragColor = vec4(texColor.rgb * skyIntensity, 1.0);
            }
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false
      });

      const skybox = new THREE.Mesh(geometry, material);
      skybox.name = '__fp_skybox';
      skybox.renderOrder = -1; // Render first
      skybox.frustumCulled = false; // Always render
      
      scene.add(skybox);
      state.env.skybox = skybox;
      
      console.info('[FP] Horizon-locked skybox created and added to scene');
    } catch(err) {
      console.error('[FP] Skybox creation error:', err);
    }
  }

  function loadHDRIFromFile(file){
    console.info('[FP] Loading HDRI from file:', file.name, file.size, 'bytes');
    try {
      const url = URL.createObjectURL(file);
      console.info('[FP] Created object URL:', url);
      // Stash so we can revoke later on replacement or dispose
      if (state.env) state.env.hdrObjectUrl = url;
      loadHDRI(url);
    } catch(err){ console.error('[FP] File load error:', err); }
  }

  function applyBackgroundMode(){
    const e = state.env; if (!e) return;
    const mode = e.bgMode || 'sky';
    console.info('[FP] Applying background mode:', mode);
    if (mode === 'hdr'){
      if (!e.envMap && !e.hdrEquirect){ 
        console.info('[FP] Loading default HDR file');
        try { loadHDRI('assets/Base.hdr'); } catch(err){ console.warn('[FP] Default HDR load failed:', err); } 
        return; // Wait for HDR to load before applying
      }
      
      // Use horizon-locked skybox for HDR mode
      try { 
        // Set scene background to null - we'll use the custom skybox instead
        scene.background = null;
        
        // Show skybox if it exists
        if (e.skybox) {
          e.skybox.visible = true;
          console.info('[FP] HDR skybox enabled');
        }
        
        console.info('[FP] Set HDR skybox as background');
      } catch(err){ console.warn('[FP] Background assignment error:', err); }
      
      try { 
        scene.environment = e.envMap || null; 
        console.info('[FP] Set environment map for lighting');
      } catch(err){ console.warn('[FP] Environment assignment error:', err); }
      
      console.info('[FP] HDR mode applied with horizon-locked skybox - environment:', !!scene.environment);
    } else {
      // Sky mode: hide HDR skybox and use simple sky texture
      try { 
        if (e.skybox) e.skybox.visible = false;
        scene.background = e.skyTex || null; 
      } catch{}
      try { scene.environment = null; } catch{}
      console.info('[FP] Sky mode applied - background:', !!scene.background);
    }
  }

  // ---- Materials and shadows management ----
  function enableSceneShadows(){
    const e = state.env; if (!e) return;
    try {
      scene.traverse(obj => {
        if (!obj || !obj.isMesh) return;
        if (obj.parent === e.group || isHelperLike(obj)) return; // skip our env and helpers
        if (!e.castBackup.has(obj)) e.castBackup.set(obj, !!obj.castShadow);
        obj.castShadow = true;
      });
    } catch{}
  }

  function setMaterialMode(mode){
    const e = state.env; if (!e) return;
    const valid = new Set(['original','white','white-outline','wire','xray']);
    if (!valid.has(mode)) return;
    if (mode === e.matMode) return;
    // Restore from any previous styled mode
    if (e.matMode !== 'original'){
      removeOutlines();
      restoreMaterialsAndShadows(e, { restoreOnlyMaterials:true });
      disposeTempMaterials();
    }
    if (mode === 'original') { e.matMode = mode; return; }
    if (mode === 'white') { applyWhiteMaterials(); }
    else if (mode === 'white-outline') { applyWhiteMaterials(); addOutlines(); }
    else if (mode === 'wire') { applyWireframeMaterials(); }
    else if (mode === 'xray') { applyXRayMaterials(); }
    e.matMode = mode;
  }
  
  function applyWhiteMaterials(){
    const e = state.env; if (!e) return;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.parent === e.group || isHelperLike(obj)) return; // skip env, helpers, gizmos
      // Backup material once
  if (!e.matsBackup.has(obj)) e.matsBackup.set(obj, obj.material);
      // Replace with a single white clay material
      try {
        const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
        // Dispose temporary greys later when restoring
        if (obj.material && obj.material.dispose && obj.material !== e.matsBackup.get(obj)) { try { obj.material.dispose(); } catch{} }
        obj.material = m; e.tempMaterials.add(m);
      } catch{}
    });
  }

  function applyWireframeMaterials(){
    const e = state.env; if (!e) return;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.parent === e.group || isHelperLike(obj)) return;
  if (!e.matsBackup.has(obj)) e.matsBackup.set(obj, obj.material);
      try {
        const m = new THREE.MeshBasicMaterial({ color: 0xdddddd, wireframe: true });
        if (obj.material && obj.material.dispose && obj.material !== e.matsBackup.get(obj)) { try { obj.material.dispose(); } catch{} }
        obj.material = m; e.tempMaterials.add(m);
      } catch{}
    });
  }

  function applyXRayMaterials(){
    const e = state.env; if (!e) return;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.parent === e.group || isHelperLike(obj)) return;
  if (!e.matsBackup.has(obj)) e.matsBackup.set(obj, obj.material);
      try {
        const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.0, transparent: true, opacity: 0.35, depthWrite: false });
        if (obj.material && obj.material.dispose && obj.material !== e.matsBackup.get(obj)) { try { obj.material.dispose(); } catch{} }
        obj.material = m; e.tempMaterials.add(m);
      } catch{}
    });
  }

  function addOutlines(){
    const e = state.env; if (!e) return;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      if (obj.parent === e.group || isHelperLike(obj)) return;
      try {
        const geo = new THREE.EdgesGeometry(obj.geometry, 30);
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
        lines.name = '__fp_outline'; lines.renderOrder = (obj.renderOrder || 0) + 1;
        obj.add(lines); e.outlines.add(lines);
      } catch{}
    });
  }

  function removeOutlines(){
    const e = state.env; if (!e) return;
    try {
      for (const l of e.outlines){
        if (!l) continue; if (l.parent) l.parent.remove(l);
        try { l.geometry && l.geometry.dispose(); } catch{}
        try { l.material && l.material.dispose && l.material.dispose(); } catch{}
      }
    } catch{}
    e.outlines = new Set();
  }

  function disposeTempMaterials(){
    const e = state.env; if (!e) return;
    try { for (const m of e.tempMaterials){ try { m.dispose && m.dispose(); } catch{} } } catch{}
    e.tempMaterials = new Set();
  }

  function restoreMaterialsAndShadows(e, opts={}){
    const restoreOnlyMaterials = !!opts.restoreOnlyMaterials;
    try {
      // Restore materials
      if (e && e.matsBackup){
        e.matsBackup.forEach((orig, obj)=>{
          try {
            if (obj && obj.isMesh){
              if (obj.material && obj.material.dispose && obj.material !== orig) { try { obj.material.dispose(); } catch{} }
              obj.material = orig;
            }
          } catch{}
        });
        e.matsBackup = new Map();
      }
      if (restoreOnlyMaterials) return;
      // Restore castShadow flags
      if (e && e.castBackup){
        e.castBackup.forEach((v, obj)=>{ try { if (obj && obj.isMesh) obj.castShadow = !!v; } catch{} });
        e.castBackup = new Map();
      }
    } catch{}
  }

  return { start, stop, update, setHFov, setFlyMode:(on)=>{ state.fly=!!on; state.constrainHeight = !state.fly; }, isActive: ()=> state.active };
}
