// First-person walk/fly service for desktop
// API: const fp = createFirstPerson({ THREE, renderer, scene, camera, domElement });
// fp.start({ hFov:100, constrainHeight:true }); fp.stop(); fp.update(dt);

export function createFirstPerson({ THREE, renderer, scene, camera, domElement }){
  const state = {
    active: false,
    fly: false,
    constrainHeight: true,
    heightFeet: 6,
  // Vertical physics (walk mode)
  gravity: 32, // ft/s^2
  velY: 0,
  onGround: false,
  stepHeight: 0.6, // can step up/down ~7in
  groundSnapEps: 0.08,
  maxFallSpeed: 200,
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
  // Colliders cache for walk-mode collisions
  colliders: [],
  colliderRefreshTimer: 0,
  // Raycast mesh cache for ground detection
  raycastMeshes: [],
  raycastRefreshTimer: 0,
  lastPos: null,
  // Desktop AR environment (sun/ground/sky)
  env: null,
  };

  function setHFov(deg){
    if (!camera || !camera.isPerspectiveCamera) return;
    const aspect = Math.max(0.0001, renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight));
    const h = THREE.MathUtils.degToRad(Math.max(10, Math.min(150, deg)));
    const v = 2 * Math.atan(Math.tan(h/2) / aspect);
    camera.fov = THREE.MathUtils.radToDeg(v);
    camera.updateProjectionMatrix();
  }

  function applyHighQualityMaterials(){
    try {
      scene.traverse(obj => {
        const mats = obj && obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : null;
        if (!mats) return;
        for (const m of mats){
          if (!m || typeof m !== 'object') continue;
          const setAniso = (tex)=>{ try { if (tex && 'anisotropy' in tex) tex.anisotropy = state.maxAniso; } catch{} };
          setAniso(m.map); setAniso(m.normalMap); setAniso(m.roughnessMap); setAniso(m.metalnessMap); setAniso(m.aoMap); setAniso(m.emissiveMap);
          if ('toneMapped' in m) m.toneMapped = true;
        }
      });
    } catch{}
    // Modest supersampling on desktop
    try { state.prevPixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : null; } catch{}
    try { renderer.setPixelRatio && renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); } catch{}
  }

  function restoreQuality(){ try { if (state.prevPixelRatio != null) renderer.setPixelRatio(state.prevPixelRatio); } catch{} }

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
    // Hover highlight when not dragging
    if (!state.dragging){ try { tryHoverHighlightAtClient(e.clientX, e.clientY); } catch{} }
    // Look input when dragging
    if (!state.dragging) return;
    const dx = (typeof e.movementX === 'number' ? e.movementX : (e.clientX - lastPX));
    const dy = (typeof e.movementY === 'number' ? e.movementY : (e.clientY - lastPY));
    clickState.moveSum += Math.abs(dx) + Math.abs(dy);
    lastPX = e.clientX; lastPY = e.clientY;
    state.yaw -= dx * state.sens; state.pitch -= dy * state.sens;
    const lim = Math.PI/2 - 0.01; state.pitch = Math.max(-lim, Math.min(lim, state.pitch));
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
  // Initialize physics trackers
  try { state.lastPos = camera.position.clone(); } catch {}
  state.velY = 0; state.onGround = false;
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
  // If we start in walk mode, snap to ground beneath
  if (state.constrainHeight){ try { snapHeadToGroundBelow(true); } catch{} }
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
  // Remove sun panel if present
  const sp = document.getElementById('fp-sun-panel'); if (sp && sp.parentNode) sp.parentNode.removeChild(sp);
  // Teardown environment
  try { disposeDesktopEnv(); } catch{}
    restoreQuality();
  try { domElement.style.cursor = ''; } catch{}
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
    // Walk mode collisions + gravity-grounding
    if (state.constrainHeight){
      refreshCollidersIfNeeded(dt);
      refreshRaycastMeshesIfNeeded(dt);
      applyWalkCollisions(camera);
      // Vertical physics: keep a 6ft-tall avatar whose feet are pulled by gravity to the surface below
      applyGroundingAndGravity(camera, dt);
    }
    // Track last position for teleport heuristics
    try { if (!state.lastPos) state.lastPos = camera.position.clone(); else state.lastPos.copy(camera.position); } catch{}
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
    const bottomY = pos.y - state.heightFeet; // feet (camera at head)
    const topY = pos.y; // feet
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

  // ---- Grounding and gravity for walk mode ----
  const groundRaycaster = new THREE.Raycaster();
  function refreshRaycastMeshesIfNeeded(dt){
    state.raycastRefreshTimer -= dt;
    if (state.raycastRefreshTimer > 0 && state.raycastMeshes.length) return;
    state.raycastRefreshTimer = 0.5;
    const list = [];
    try {
      scene.updateMatrixWorld(true);
      scene.traverse(obj => {
        if (!obj || !obj.isMesh || obj.visible === false) return;
        if (isHelperLike(obj)) return;
        // Exclude obvious AR HUD/teleport gizmos if tagged
        if (isTeleportDisc(obj)) return;
        list.push(obj);
      });
    } catch {}
    state.raycastMeshes = list;
  }

  function isTeleportDisc(o){
    try {
      let p = o;
      while (p){ if (p.userData && p.userData.__teleportDisc) return true; p = p.parent; }
      return false;
    } catch { return false; }
  }

  function getGroundYAt(x, z, yStart){
    try {
      const origin = new THREE.Vector3(x, yStart + 2, z);
      groundRaycaster.set(origin, new THREE.Vector3(0,-1,0));
      groundRaycaster.far = Math.max(5, yStart + 500);
      const hits = groundRaycaster.intersectObjects(state.raycastMeshes, true);
      if (hits && hits.length){
        for (const h of hits){
          // Prefer reasonably upward-facing surfaces
          const n = h.face && h.face.normal ? h.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)) : null;
          const upDot = n ? n.y : 1;
          if (upDot >= 0.25){ return h.point.y; }
        }
        // Fallback to first hit if none matched normal filter
        return hits[0].point.y;
      }
    } catch{}
    // Fallbacks: our desktop env ground if present, else y=0 plane
    try { if (state.env && state.env.ground) return state.env.ground.position.y; } catch{}
    return 0;
  }

  function snapHeadToGroundBelow(forceUp=false){
    try {
      const pos = camera.position;
      const gy = getGroundYAt(pos.x, pos.z, pos.y);
      const targetY = gy + state.heightFeet;
      if (forceUp || Math.abs(pos.y - targetY) > state.groundSnapEps){ pos.y = targetY; }
      state.velY = 0; state.onGround = true;
    } catch{}
  }

  function applyGroundingAndGravity(cam, dt){
    const pos = cam.position;
    // Teleport heuristic: if large horizontal jump this frame, reset vertical velocity and snap to ground
    // (We don't have direct teleport event hooks here.)
    try {
      if (state.lastPos){
        const dx = pos.x - state.lastPos.x; const dz = pos.z - state.lastPos.z;
        if ((dx*dx + dz*dz) > 9){ // >3ft jump in one frame
          snapHeadToGroundBelow(true);
        }
      }
    } catch{}

    const feetY = pos.y - state.heightFeet;
    const groundY = getGroundYAt(pos.x, pos.z, pos.y);
    const delta = feetY - groundY;

    // Snap small steps up/down
    if (Math.abs(delta) <= state.stepHeight){
      pos.y = groundY + state.heightFeet;
      state.velY = 0; state.onGround = true; return;
    }

    // If we're clearly above ground, apply gravity
    if (delta > state.stepHeight){
      state.onGround = false;
      state.velY = Math.max(-state.maxFallSpeed, state.velY - state.gravity * dt);
      const newFeet = feetY + state.velY * dt;
      if (newFeet <= groundY + state.groundSnapEps){
        // Land
        pos.y = groundY + state.heightFeet;
        state.velY = 0; state.onGround = true;
      } else {
        // Continue falling
        pos.y = newFeet + state.heightFeet;
      }
      return;
    }

    // If somehow below ground (moving platforms or geometry edits), pop up
    if (delta < -state.groundSnapEps){
      pos.y = groundY + state.heightFeet; state.velY = 0; state.onGround = true; return;
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
    const exit = mkBtn('Exit');
  const sunBtn = mkBtn('Sun');
  const matBtn = mkBtn('Materials: Original');
    toggle.addEventListener('click', ()=>{
      // Toggle Walk <-> Fly coherently
      if (state.constrainHeight){
        // Switch to Fly
        state.constrainHeight = false;
        state.fly = true;
  state.onGround = false; // allow vertical freedom
      } else {
        // Switch to Walk
        state.constrainHeight = true;
        state.fly = false;
  // Snap to ground and reset vertical velocity
  try { snapHeadToGroundBelow(true); } catch{}
      }
      toggle.textContent = state.constrainHeight ? 'Mode: Walk (6ft)' : 'Mode: Fly';
    });
    exit.addEventListener('click', ()=> stop());
  sunBtn.addEventListener('click', ()=>{ toggleSunPanel(); });
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
    ui.append(toggle, matBtn, sunBtn, exit); document.body.appendChild(ui);
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

  // ---- Teleport disc picking (hover + click) ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const clickState = { downX:0, downY:0, downT:0, moveSum:0 };
  function setPointerFromClient(clientX, clientY){
    const r = domElement.getBoundingClientRect();
    const x = (clientX - r.left) / Math.max(1, r.width);
    const y = (clientY - r.top) / Math.max(1, r.height);
    ndc.x = x*2 - 1;
    ndc.y = - (y*2 - 1);
  }
  function __discRoot(o){ try { while(o && !(o.userData && o.userData.__teleportDisc)) o = o.parent; return o || null; } catch { return null; } }
  function tryHoverHighlightAtClient(clientX, clientY){
    if (!window.__teleport) return;
    const discs = window.__teleport.getTeleportDiscs(); if (!discs || !discs.length) return;
    setPointerFromClient(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);
    const ih = raycaster.intersectObjects(discs, true);
    discs.forEach(d=>{ try { window.__teleport.highlightTeleportDisc(d, false); } catch{} });
    if (ih && ih.length){ const d = __discRoot(ih[0].object); if (d) try { window.__teleport.highlightTeleportDisc(d, true); } catch{} }
  }
  function tryTeleportAtClient(clientX, clientY){
    if (!window.__teleport) return false;
    const discs = window.__teleport.getTeleportDiscs(); if (!discs || !discs.length) return false;
    setPointerFromClient(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);
    const ih = raycaster.intersectObjects(discs, true);
    if (ih && ih.length){ const d = __discRoot(ih[0].object); if (d){ try { window.__teleport.highlightTeleportDisc(d, true); window.__teleport.teleportToDisc(d); } catch{} return true; } }
    return false;
  }

  // ---- Desktop AR environment (sun/ground/sky) ----
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
  state.env = { group, ground, sun, sunTarget, skyTex, sky, prevBg, hiddenGrids, params, matMode: 'original', matsBackup: new Map(), castBackup: new Map(), tempMaterials: new Set(), outlines: new Set(), hemi: null };
  // Enable shadow casting on scene meshes (store previous)
  try { enableSceneShadows(); } catch{}
  // Subtle hemisphere light for better separation
  try { const hemi = new THREE.HemisphereLight(0xdfe8ff, 0xf0efe9, 0.35); state.env.hemi = hemi; scene.add(hemi); } catch{}
  }

  function disposeDesktopEnv(){
    const e = state.env; if (!e) return; state.env = null;
  try { restoreMaterialsAndShadows(e); } catch{}
    try { scene.background = e.prevBg || null; } catch{}
    try { if (e.skyTex && e.skyTex.dispose) e.skyTex.dispose(); } catch{}
    try { if (e.ground && e.ground.geometry) e.ground.geometry.dispose(); if (e.ground && e.ground.material && e.ground.material.dispose) e.ground.material.dispose(); } catch{}
  try { if (e.sun && e.sun.parent) e.sun.parent.remove(e.sun); } catch{}
  try { if (e.hemi && e.hemi.parent) e.hemi.parent.remove(e.hemi); } catch{}
    try { if (e.group && e.group.parent) e.group.parent.remove(e.group); } catch{}
    try { if (Array.isArray(e.hiddenGrids)) e.hiddenGrids.forEach(g=>{ try { g.visible = true; } catch{} }); } catch{}
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

  function toggleSunPanel(){
    const id = 'fp-sun-panel';
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
      close
    );
    document.body.appendChild(p);
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

  return { start, stop, update, setHFov, setFlyMode:(on)=>{ state.fly=!!on; state.constrainHeight = !state.fly; if (state.constrainHeight) { try { snapHeadToGroundBelow(true); } catch{} } else { state.onGround=false; } }, isActive: ()=> state.active };
}
