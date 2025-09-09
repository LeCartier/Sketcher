// First-Person Quality Modes: low | high | ultra
// High (default): improved shadow resolution, tighter shadow camera fit
// Ultra: higher shadow resolution, more frequent refit, optional fill light
// Non-destructive: can revert to low
export function createFPQuality({ THREE, renderer, scene }) {
  const state = {
    mode: 'high',
    dirLight: null,
    fillLight: null,
    original: null,
    lastFitAt: 0,
    fitIntervalHigh: 5.0, // seconds
    fitIntervalUltra: 1.5,
    margin: 1.0,
  envPMREM: null,
  envTexture: null,
  originalEnv: null,
  // physicallyCorrectLights is removed in newer three.js; avoid toggling it
  originalPhysicallyCorrect: null,
  };

  function findMainDirLight(){
    if (state.dirLight && scene.children.includes(state.dirLight)) return state.dirLight;
    let best=null;
    scene.traverse(o=>{ if (o && o.isDirectionalLight){ if (!best) best=o; else if (o.intensity>best.intensity) best=o; }});
    state.dirLight = best || null;
    if (state.dirLight && !state.original){
      state.original = {
        mapSize: state.dirLight.shadow?.mapSize ? state.dirLight.shadow.mapSize.clone() : null,
        camera: (function(cam){ if (!cam) return null; return { left:cam.left, right:cam.right, top:cam.top, bottom:cam.bottom, near:cam.near, far:cam.far }; })(state.dirLight.shadow?.camera),
        bias: state.dirLight.shadow?.bias,
        normalBias: state.dirLight.shadow?.normalBias,
      };
    }
    return state.dirLight;
  }

  function computeSceneBounds(){
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let any=false;
    try {
      scene.traverse(o=>{
        if (!o || !o.visible) return;
        if (o.userData && o.userData.__helper) return;
        if (o.isLight || o.isCamera) return;
        if (!o.isMesh) return;
        try { tmp.setFromObject(o); } catch { return; }
        if (!isFinite(tmp.min.x) || tmp.isEmpty()) return;
        if (!any){ box.copy(tmp); any=true; } else { box.union(tmp); }
      });
    } catch{}
    if (!any) box.set(new THREE.Vector3(-5,-1,-5), new THREE.Vector3(5,5,5));
    return box;
  }

  function fitShadowCamera(){
    const light = findMainDirLight(); if (!light || !light.shadow || !light.shadow.camera) return;
    const cam = light.shadow.camera;
    const box = computeSceneBounds();
    // Expand by margin
    const m = state.margin;
    cam.left = box.min.x - m;
    cam.right = box.max.x + m;
    cam.bottom = box.min.z - m;
    cam.top = box.max.z + m;
    // Depth range along light direction: approximate using y extents (simple heuristic)
    cam.near = 0.5;
    cam.far = Math.max(10, (box.max.y - box.min.y) + 20);
    cam.updateProjectionMatrix();
    try { light.shadow.needsUpdate = true; } catch{}
  }

  function applyLow(){
    const light = findMainDirLight(); if (!light) return;
    if (state.original){
      if (light.shadow && state.original.mapSize){ light.shadow.mapSize.copy(state.original.mapSize); light.shadow.map.dispose?.(); }
      if (light.shadow && light.shadow.camera && state.original.camera){
        const c = light.shadow.camera; const oc = state.original.camera;
        c.left=oc.left; c.right=oc.right; c.top=oc.top; c.bottom=oc.bottom; c.near=oc.near; c.far=oc.far; c.updateProjectionMatrix();
      }
      if (light.shadow){ light.shadow.bias = state.original.bias; light.shadow.normalBias = state.original.normalBias; }
    }
    // Remove fill light if present
    if (state.fillLight){ scene.remove(state.fillLight); state.fillLight.dispose?.(); state.fillLight=null; }
  // Restore environment
    try {
      if (state.originalEnv !== undefined) scene.environment = state.originalEnv;
    } catch{}
  }

  function applyHigh(){
    const light = findMainDirLight(); if (!light || !light.shadow) return;
    // Shadow quality
    try { light.shadow.mapSize.set(2048,2048); light.shadow.bias = -0.0004; light.shadow.normalBias = 0.5; } catch{}
    fitShadowCamera();
    // Remove fill if existing
    if (state.fillLight){ scene.remove(state.fillLight); state.fillLight=null; }
    // Environment / physically correct lights
    ensureEnvironment({ intensity:1.0 });
  }

  function applyUltra(){
    applyHigh();
    const light = findMainDirLight(); if (!light) return;
    try { light.shadow.mapSize.set(4096,4096); } catch{}
    // Add subtle fill light opposite direction for balanced contrast
    if (!state.fillLight){
      state.fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
      try {
        state.fillLight.position.copy(light.position.clone().multiplyScalar(-0.6));
      } catch{}
      state.fillLight.userData.__helper = true; // avoid bounds inclusion
      scene.add(state.fillLight);
    }
    // Boost environment intensity slightly for Ultra
    ensureEnvironment({ intensity:1.5 });
  }

  function setMode(mode){
    if (!['low','high','ultra'].includes(mode)) mode='high';
    if (state.mode === mode) return;
    state.mode = mode;
    if (mode==='low') applyLow(); else if (mode==='high') applyHigh(); else applyUltra();
  }

  function forceRefresh(){ if (state.mode==='high' || state.mode==='ultra'){ fitShadowCamera(); } }

  function update(dt){
    if (state.mode==='high' || state.mode==='ultra'){
      state.lastFitAt += dt;
      const interval = (state.mode==='ultra') ? state.fitIntervalUltra : state.fitIntervalHigh;
      if (state.lastFitAt >= interval){ state.lastFitAt = 0; fitShadowCamera(); }
    }
  }

  async function ensureEnvironment({ intensity = 1.0 } = {}){
    try {
      if (state.originalEnv === null) state.originalEnv = scene.environment || undefined;
  // No-op: renderer.physicallyCorrectLights has been removed; rely on modern lighting pipeline
      if (!state.envTexture){
        // Lazy-load HDR environment only once
        const { RGBELoader } = await import('../../vendor/RGBELoader.js');
        const loader = new RGBELoader();
        const hdr = await loader.loadAsync('./assets/Base.hdr');
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(renderer);
        state.envPMREM = pmrem;
        state.envTexture = pmrem.fromEquirectangular(hdr).texture;
        try { hdr.dispose && hdr.dispose(); } catch{}
      }
      scene.environment = state.envTexture;
      // Adjust exposure slightly based on intensity (non-destructive; First Person may override exposure separately)
      try { renderer.toneMappingExposure = 0.85 * Math.max(0.5, Math.min(2.0, intensity)); } catch{}
    } catch{}
  }

  // Initialize default (high)
  setTimeout(()=>{ if (state.mode==='high') applyHigh(); }, 0);

  return { setMode, getMode:()=>state.mode, update, forceRefresh, fitShadowCamera };
}
