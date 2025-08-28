// First-person walk/fly service for desktop
// API: const fp = createFirstPerson({ THREE, renderer, scene, camera, domElement });
// fp.start({ hFov:100, constrainHeight:true }); fp.stop(); fp.update(dt);

export function createFirstPerson({ THREE, renderer, scene, camera, domElement }){
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
  // Colliders cache for walk-mode collisions
  colliders: [],
  colliderRefreshTimer: 0,
  // Desktop AR environment (sun/ground/sky)
  env: null,
  // Vertical motion for gravity-based walk mode
  vy: 0,
  onGround: false,
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
    const exit = mkBtn('Exit');
  const sunBtn = mkBtn('Sun');
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

  return { start, stop, update, setHFov, setFlyMode:(on)=>{ state.fly=!!on; state.constrainHeight = !state.fly; }, isActive: ()=> state.active };
}
