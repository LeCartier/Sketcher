/* =================================================================================================
   XR HUD SERVICE
   -------------------------------------------------------------------------------------------------
   Factory:
     const hud = createXRHud({
       THREE,
       scene,
       renderer,
       getLocalSpace,   // () => XRReferenceSpace (current frame localized)
       getButtons       // (createHudButton)=> [{ mesh, onClick, setLabel }]
     });

   Purpose:
     Wrist / palm anchored interactive HUD for WebXR sessions supporting controller rays AND
     direct right‑hand fingertip poke interactions (depress -> click). Provides extensible
     button creation (textured, 3D primitives, OBJ preview, draw/tiles) plus nested draw submenu.

   Interaction Model:
     - Anchor: Left palm (preferred) -> dynamic orientation from wrist joint / fallback controller.
     - Controller Rays: Hover + trigger -> click (cooldown & suppression heuristics).
     - Finger Poke: Right index fingertip; depth penetration along button normal animates press.
     - Submenus: Draw mode overrides main grid; primitives/objects submenus prioritized in hit order.

   Safety / Noise Reduction:
     - Global click cooldown (prevents accidental double activation after menu transitions).
     - Hand crossing detection -> temporary suppression during ambiguous overlap.
     - Grace period after HUD show to ignore immediate pinch/grab noise.
     - Shrunk active hit box (ACTIVE_SHRINK_X/Y) to reduce edge misfires.

   Performance Notes:
     - Per-frame traversal limits: button target list built only from visible nodes.
     - Icon auto billboard (camera-facing) restricted to nodes flagged __icon3D.
     - Press physics uses cached base scale to avoid layout recomputation.

   Extensibility:
     - createPrimitive3DButton / createOBJ3DButton / createDraw3DButton / createTile3DButton
       all return uniform interface ({ mesh, onClick, setLabel, ...optionals }).
     - showDrawSubmenu / hideDrawSubmenu orchestrate dynamic button replacement while preserving
       pointer/finger logic.

   ================================================================================================
   TABLE OF CONTENTS
   --------------------------------------------------------------------------------
    [01] Constants & Core State
    [02] Hand Joint Definitions & Bone Map
    [03] Press Mechanics (depth thresholds & helpers)
    [04] Button Texture (Canvas) + Basic Text Button Factory
    [05] 3D Button Factories (Primitive / OBJ / Draw / Tile)
    [06] Hand Visualization (ensure + palette + style)
    [07] HUD Ensure / Layout & Removal
    [08] Frame Update (anchor placement / rays / finger poke / visibility rules)
    [09] Press State & Click Cooldowns (reset / adjust)
    [10] Hand Viz Style Setter
    [11] Draw Submenu (show/hide/arrange)
    [12] Public API Export
   --------------------------------------------------------------------------------
   NOTE: Search for  // [NN]  markers for rapid navigation.
   ================================================================================================ */
// [01] Constants & Core State --------------------------------------------------------------------
// XR HUD: 3D wrist-anchored curved button bar with hover/select via rays
// Note: pass getLocalSpace() to resolve the latest XR reference space each frame.
export function createXRHud({ THREE, scene, renderer, getLocalSpace, getButtons }){
  // [01] Constants & Core State (continued) ------------------------------------------------------
  // Button sizing and layout for palm grid (.75 inch ≈ 19.05mm)
  const BUTTON_SIZE = 0.01905; // 0.75in square
  const BUTTON_W = BUTTON_SIZE; // meters (square)
  const BUTTON_H = BUTTON_SIZE; // meters (square)
  const GRID_GAP_X = 0.006; // 6mm horizontal gap
  const GRID_GAP_Y = 0.006; // 6mm vertical gap
  const PALM_OFFSET = 0.0508; // ~2 inches (50.8mm) above palm plane for better visibility
  const PINCH_THRESHOLD_M = 0.035; // fallback hard threshold (m)
  const PINCH_SCALE = 2.0; // scale factor for radii-based threshold
  const PINCH_MIN = 0.02; // min threshold when using radii
  const PINCH_MAX = 0.06; // max threshold when using radii
  let hud = null;
  let buttons = [];
  let xrHoverBySource = new WeakMap();
  let xrPressedSources = new WeakSet();
  const raycaster = new THREE.Raycaster();
  // Global cooldown to prevent accidental clicks after menu transitions
  let globalClickCooldownUntil = 0;
  // Hand interaction smoothing - prevent rapid state changes when hands cross
  let handCrossingCooldownUntil = 0;
  let lastRightHandPosition = new THREE.Vector3();
  let handCrossingDetected = false;
  // Simple viz for hands and right-controller ray
  let handVizL = null, handVizR = null, rightRay = null, rightRayTip = null;
  let handVizMode = null; // 'default' | 'hands-only'
  let handVizStyle = 'fingertips'; // 'fingertips' | 'skeleton' | 'off'

  // [02] Hand Joint Definitions & Bone Map ------------------------------------------------------
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
  // [03] Press Mechanics ------------------------------------------------------------------------
  // Finger poke/depress interaction — increased thresholds to prevent accidental activation
  const PRESS_START_M = Math.max(0.003, 0.35 * BUTTON_H);   // ~8mm (increased from ~4mm)
  const PRESS_RELEASE_M = Math.max(0.0015, 0.20 * BUTTON_H); // ~4mm (increased from ~2mm) 
  const PRESS_MAX_M = Math.max(0.005, 0.50 * BUTTON_H);     // increased max depth
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
    // [04] Button Texture (Canvas-based) --------------------------------------------------------
    // Square texture for rounded-square buttons
    const w=256,h=256; const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
    const bg='rgba(30,30,35,0.78)',fg='#ffffff',hl='rgba(255,255,255,0.16)';
    const r=36; ctx.fillStyle=bg; ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(w-r,0); ctx.quadraticCurveTo(w,0,w,r); ctx.lineTo(w,h-r); ctx.quadraticCurveTo(w,h,w-r,h); ctx.lineTo(r,h); ctx.quadraticCurveTo(0,h,0,h-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
    // top sheen
    ctx.fillStyle=hl; ctx.fillRect(0,0,w,Math.max(6, Math.floor(h*0.04)));
    // label (support simple stacking for multi-word labels). Increase base size by ~33% and scale-to-fit.
    ctx.fillStyle=fg; ctx.textAlign='center'; ctx.textBaseline='middle';
    const raw = String(label||'');
    const words = raw.split(' ').filter(Boolean);
    const topLine = words.length > 1 ? words.slice(0, Math.ceil(words.length/2)).join(' ') : raw;
    const bottomLine = words.length > 1 ? words.slice(Math.ceil(words.length/2)).join(' ') : null;
    const margin = Math.floor(w * 0.08);
    const basePx = Math.round(88 * 1.77); // ~156px (increased from 1.33 to 1.77 for 33% larger text)
    let fontPx = basePx;
    const maxW = w - 2*margin;
    const maxH = h - 2*margin;
    // Find a font size that fits both width and height constraints
    while (fontPx > 16){ // Also increased minimum font size from 12 to 16
      ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
      const lineH = Math.round(fontPx * 1.1);
      const widthTop = ctx.measureText(topLine).width;
      const widthBottom = bottomLine ? ctx.measureText(bottomLine).width : 0;
      const widest = Math.max(widthTop, widthBottom);
      const totalH = bottomLine ? (lineH * 2) : lineH;
      if (widest <= maxW && totalH <= maxH) break;
      fontPx -= 2;
    }
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    const lineH = Math.round(fontPx * 1.15);
    if (bottomLine){
      ctx.fillText(topLine, w/2, h/2 - lineH*0.5);
      ctx.fillText(bottomLine, w/2, h/2 + lineH*0.5);
    } else {
      ctx.fillText(topLine, w/2, h/2);
    }
    const tex=new THREE.CanvasTexture(c); if(THREE.SRGBColorSpace) tex.colorSpace=THREE.SRGBColorSpace; tex.needsUpdate=true; return tex;
  }

  function createHudButton(label, onClick){
    // [04] Basic Text Button Factory ------------------------------------------------------------
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

  function createPrimitive3DButton(primitiveType, onClick) {
    // [05] 3D Primitive Button Factory ----------------------------------------------------------
    // Create a group to hold the 3D primitive and background
    const buttonGroup = new THREE.Group();
    buttonGroup.userData.__hudButton = { label: primitiveType, onClick, base: null, hover: null };
    
    // Background panel with improved contrast
    const bgGeom = new THREE.PlaneGeometry(BUTTON_W, BUTTON_H);
    const bgMat = new THREE.MeshBasicMaterial({ 
      color: 0x2a2a2a,
      transparent: false,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgMesh.renderOrder = 10000;
    buttonGroup.add(bgMesh);
    
    // 3D primitive icon (smaller scale to fit in button)
    const iconScale = Math.min(BUTTON_W, BUTTON_H) * 0.35; // 35% of button size
    let primitiveMesh;
    
    // Create primitive geometry based on type with brighter colors
    switch(primitiveType.toLowerCase()) {
    case 'box':
        primitiveMesh = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale, iconScale, iconScale),
      new THREE.MeshBasicMaterial({ color: 0x66d9ff, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }) // Bright blue, opaque
        );
        break;
      case 'sphere':
        primitiveMesh = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6666, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }) // Bright red, opaque
        );
        break;
      case 'cylinder':
        primitiveMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.4, iconScale * 0.4, iconScale, 12),
      new THREE.MeshBasicMaterial({ color: 0x66ff66, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }) // Bright green, opaque
        );
        break;
      case 'cone':
        primitiveMesh = new THREE.Mesh(
          new THREE.ConeGeometry(iconScale * 0.4, iconScale, 12),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }) // Bright orange, opaque
        );
        break;
      default:
        // Fallback to a simple cube
        primitiveMesh = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale, iconScale, iconScale),
      new THREE.MeshBasicMaterial({ color: 0xdddddd, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }) // Bright gray, opaque
        );
    }
    
    if (primitiveMesh) {
  primitiveMesh.renderOrder = 10003; // Higher render order than text and flash
  primitiveMesh.position.z = 0.012; // Push further forward to avoid blending dimming
      // Ensure icon faces outward (+Z in HUD local space)
      primitiveMesh.rotation.set(0, 0, 0);
      // Mark as 3D icon for per-frame camera-facing alignment
      primitiveMesh.userData.__icon3D = true;
      
      buttonGroup.add(primitiveMesh);
    }
    
    // Flash overlay for click feedback
    const flashGeom = bgGeom.clone();
    const flashMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0, 
      depthTest: false, 
      depthWrite: false, 
      blending: THREE.AdditiveBlending 
    });
    const flash = new THREE.Mesh(flashGeom, flashMat);
    flash.name = 'hud-flash';
    flash.renderOrder = 10002;
    flash.scale.set(1.05, 1.05, 1);
    flash.position.z = 0.002;
    buttonGroup.add(flash);
    buttonGroup.userData.__flash = flash;
    
    // Store materials for hover effects
    const baseBgMat = bgMat.clone();
    const hoverBgMat = bgMat.clone();
    hoverBgMat.color.setHex(0x555555); // Lighter on hover
    
    buttonGroup.userData.__hudButton.base = baseBgMat;
    buttonGroup.userData.__hudButton.hover = hoverBgMat;
    
    // Function to update appearance (not really needed for 3D buttons but kept for compatibility)
    function setLabel(next) {
      // 3D buttons don't change labels, but keep this for interface compatibility
      buttonGroup.userData.__hudButton.label = next;
    }
    
    return { mesh: buttonGroup, onClick, setLabel };
  }

  function createOBJ3DButton(objPreview, filename, onClick) {
    // [05] 3D OBJ Preview Button Factory --------------------------------------------------------
    // Create a group to hold the 3D object preview and background
    const buttonGroup = new THREE.Group();
    buttonGroup.userData.__hudButton = { label: filename, onClick, base: null, hover: null };
    
    // Tile background (same style as primitive buttons)
    const bgGeom = new THREE.PlaneGeometry(BUTTON_W, BUTTON_H);
    const bgMat = new THREE.MeshBasicMaterial({ 
      color: 0x1e1e23, 
      transparent: true, 
      opacity: 0.78,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgMesh.renderOrder = 10000;
    buttonGroup.add(bgMesh);
    
    // Add the 3D object preview
    if (objPreview) {
      // Clone the preview to avoid modifying the original
      const previewClone = objPreview.clone();
      previewClone.renderOrder = 10003; // Higher render order than text and flash
      previewClone.position.z = 0.012; // Push further forward to avoid blending dimming
      
      // Ensure the preview fits within the button bounds
      const boundingBox = new THREE.Box3().setFromObject(previewClone);
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      const targetSize = Math.min(BUTTON_W, BUTTON_H) * 0.6; // 60% of button size
      
      if (maxDimension > targetSize) {
        const scale = targetSize / maxDimension;
        previewClone.scale.setScalar(scale);
        console.log(`📦 Scaled OBJ preview for ${filename}: ${scale.toFixed(3)}x (${maxDimension.toFixed(4)}m -> ${(maxDimension * scale).toFixed(4)}m)`);
      }
      
      // Center the preview within the button
      const scaledBoundingBox = new THREE.Box3().setFromObject(previewClone);
      const center = scaledBoundingBox.getCenter(new THREE.Vector3());
      previewClone.position.x -= center.x;
      previewClone.position.y -= center.y;
      // Keep z position for forward offset
      
      // Mark as 3D icon for per-frame camera-facing alignment
      previewClone.userData.__icon3D = true;
      
      buttonGroup.add(previewClone);
    } else {
      // Fallback icon if preview failed to load
      const fallbackIcon = new THREE.Mesh(
        new THREE.BoxGeometry(BUTTON_W * 0.3, BUTTON_H * 0.3, BUTTON_W * 0.3),
        new THREE.MeshBasicMaterial({ 
          color: 0x666666, 
          depthTest: false, 
          depthWrite: false, 
          toneMapped: false 
        })
      );
      fallbackIcon.renderOrder = 10003;
      fallbackIcon.position.z = 0.012;
      fallbackIcon.userData.__icon3D = true;
      buttonGroup.add(fallbackIcon);
    }
    
    // Flash overlay for click feedback
    const flashGeom = bgGeom.clone();
    const flashMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0, 
      depthTest: false, 
      depthWrite: false, 
      blending: THREE.AdditiveBlending 
    });
    const flash = new THREE.Mesh(flashGeom, flashMat);
    flash.name = 'hud-flash';
    flash.renderOrder = 10002;
    flash.scale.set(1.05, 1.05, 1);
    flash.position.z = 0.002;
    buttonGroup.add(flash);
    buttonGroup.userData.__flash = flash;
    
    // Store materials for hover effects
    const baseBgMat = bgMat.clone();
    const hoverBgMat = bgMat.clone();
    hoverBgMat.color.setHex(0x555555); // Lighter on hover
    
    buttonGroup.userData.__hudButton.base = baseBgMat;
    buttonGroup.userData.__hudButton.hover = hoverBgMat;
    
    // Function to update appearance
    function setLabel(next) {
      buttonGroup.userData.__hudButton.label = next;
    }
    
    return { mesh: buttonGroup, onClick, setLabel };
  }

  function createDraw3DButton(onClick) {
    // [05] 3D Draw Tool Button Factory ----------------------------------------------------------
    console.log('🎨 Creating Draw 3D button with onClick handler:', typeof onClick);
    
    // Create a group to hold the 3D draw icon and background
    const buttonGroup = new THREE.Group();
    buttonGroup.userData.__hudButton = { label: 'Draw', onClick, base: null, hover: null };
    
    console.log('🎨 Draw button created with userData:', buttonGroup.userData.__hudButton);
    
    // Tile background (same style as other tile buttons)
    const bgGeom = new THREE.PlaneGeometry(BUTTON_W, BUTTON_H);
    const bgMat = new THREE.MeshBasicMaterial({ 
      color: 0x2a2a2a,
      transparent: false,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgMesh.renderOrder = 10000;
    buttonGroup.add(bgMesh);
    
    // Create 3D icon based on draw tool
    const iconScale = Math.min(BUTTON_W, BUTTON_H) * 0.28; // Same scale as other tiles
    const iconGroup = new THREE.Group();
    
    // Add label text (increase by ~33% and fit-to-width)
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 512; textCanvas.height = 128;
    const textCtx = textCanvas.getContext('2d');
    textCtx.fillStyle = '#ffffff';
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    let px = Math.round(32 * 1.77); // Increased from 1.33 to 1.77 for larger text
    const labelStr = 'Draw';
    const maxTextW = textCanvas.width * 0.9;
    while (px > 16){ // Increased minimum from 12 to 16
      textCtx.font = `bold ${px}px Arial`;
      if (textCtx.measureText(labelStr).width <= maxTextW) break;
      px -= 2;
    }
    textCtx.font = `bold ${px}px Arial`;
    textCtx.clearRect(0,0,textCanvas.width,textCanvas.height);
    textCtx.fillText(labelStr, textCanvas.width/2, textCanvas.height/2);
    
    const textTexture = new THREE.CanvasTexture(textCanvas);
  const textGeom = new THREE.PlaneGeometry(BUTTON_W * 0.9, BUTTON_H * 0.35); // Increased from 0.3 to 0.35 for larger text
    const textMat = new THREE.MeshBasicMaterial({ 
      map: textTexture, 
      transparent: true, 
      depthTest: false, 
      depthWrite: false,
      toneMapped: false
    });
    const textMesh = new THREE.Mesh(textGeom, textMat);
  textMesh.position.y = -BUTTON_H * 0.25; // Adjusted from 0.28 for larger text area
    textMesh.position.z = 0.002;
    textMesh.renderOrder = 10001;
    buttonGroup.add(textMesh);
    
    // Create draw icon: pencil/pen shape
    // Pencil body (cylinder)
    const bodyGeom = new THREE.CylinderGeometry(iconScale * 0.08, iconScale * 0.08, iconScale * 0.6, 8);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }); // Bright orange, opaque
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.renderOrder = 10001;
    iconGroup.add(bodyMesh);
    
    // Pencil tip (cone)
    const tipGeom = new THREE.ConeGeometry(iconScale * 0.08, iconScale * 0.15, 8);
  const tipMat = new THREE.MeshBasicMaterial({ color: 0x999999, depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, transparent: false }); // Bright gray, opaque
    const tipMesh = new THREE.Mesh(tipGeom, tipMat);
    tipMesh.position.y = -iconScale * 0.375; // Position at bottom of pencil
    tipMesh.renderOrder = 10001;
    iconGroup.add(tipMesh);
    
    // Small drawing line to indicate drawing action
    const linePoints = [
      new THREE.Vector3(-iconScale * 0.15, -iconScale * 0.5, 0.002),
      new THREE.Vector3(-iconScale * 0.05, -iconScale * 0.55, 0.002),
      new THREE.Vector3(iconScale * 0.05, -iconScale * 0.5, 0.002),
      new THREE.Vector3(iconScale * 0.15, -iconScale * 0.55, 0.002)
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff6666, linewidth: 3, depthTest: false, depthWrite: false }); // Bright red (LineBasicMaterial ignores toneMapped)
    const lineMesh = new THREE.Line(lineGeom, lineMat);
    lineMesh.renderOrder = 10001;
    iconGroup.add(lineMesh);
    
  // Position the icon group in the upper area of the tile
    iconGroup.position.y = BUTTON_H * 0.1; // Centered in upper area
  iconGroup.position.z = 0.006; // Push forward to avoid z-fighting/alpha blending dimming
  // Remove extra tilts so the icon faces outward (+Z in HUD local space)
  iconGroup.rotation.set(0, 0, 0);
  // Mark as 3D icon group for per-frame camera-facing alignment
  iconGroup.userData.__icon3D = true;
    
    buttonGroup.add(iconGroup);
    
    // Flash overlay for click feedback
    const flashGeom = bgGeom.clone();
    const flashMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0, 
      depthTest: false, 
      depthWrite: false, 
      blending: THREE.AdditiveBlending 
    });
    const flash = new THREE.Mesh(flashGeom, flashMat);
    flash.name = 'hud-flash';
    flash.renderOrder = 10002;
    flash.scale.set(1.05, 1.05, 1);
    flash.position.z = 0.002;
    buttonGroup.add(flash);
    buttonGroup.userData.__flash = flash;
    
    // Store materials for hover effects (same as other tiles)
    const baseBgMat = bgMat.clone();
    const hoverBgMat = bgMat.clone();
    hoverBgMat.color.setHex(0x4a4a4a); // Same hover color as other tiles
    
    buttonGroup.userData.__hudButton.base = baseBgMat;
    buttonGroup.userData.__hudButton.hover = hoverBgMat;
    
    // Function to update appearance
    function setLabel(next) {
      // Keep for interface compatibility
      buttonGroup.userData.__hudButton.label = next;
    }
    
    return { mesh: buttonGroup, onClick, setLabel };
  }

  function createTile3DButton(label, onClick) {
    // [05] 3D Tile Button Factory ---------------------------------------------------------------
    // Create a group to hold the 3D icon and tile background
    const buttonGroup = new THREE.Group();
    buttonGroup.userData.__hudButton = { label, onClick, base: null, hover: null };
    
    // Tile background (maintains the existing aesthetic)
    const bgGeom = new THREE.PlaneGeometry(BUTTON_W, BUTTON_H);
    const bgMat = new THREE.MeshBasicMaterial({ 
      color: 0x2a2a2a,
      transparent: false,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgMesh.renderOrder = 10000;
    buttonGroup.add(bgMesh);
    
    // Create 3D icon based on button label
    const iconScale = Math.min(BUTTON_W, BUTTON_H) * 0.28; // Slightly larger icons
    const iconGroup = new THREE.Group();
    
    // Add label text (increase by ~33% and fit-to-width)
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 512; textCanvas.height = 128;
    const textCtx = textCanvas.getContext('2d');
    textCtx.fillStyle = '#ffffff';
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    let px = Math.round(32 * 1.77); // Increased from 1.33 to 1.77 for larger text
    const maxTextW = textCanvas.width * 0.9;
    const labelStr = String(label||'');
    while (px > 16){ // Increased minimum from 12 to 16
      textCtx.font = `bold ${px}px Arial`;
      if (textCtx.measureText(labelStr).width <= maxTextW) break;
      px -= 2;
    }
    textCtx.font = `bold ${px}px Arial`;
    textCtx.clearRect(0,0,textCanvas.width,textCanvas.height);
    textCtx.fillText(labelStr, textCanvas.width/2, textCanvas.height/2);
    
    const textTexture = new THREE.CanvasTexture(textCanvas);
    if (THREE.SRGBColorSpace) textTexture.colorSpace = THREE.SRGBColorSpace;
  const textGeom = new THREE.PlaneGeometry(BUTTON_W * 0.9, BUTTON_H * 0.35); // Increased from 0.3 to 0.35 for larger text
    const textMat = new THREE.MeshBasicMaterial({ 
      map: textTexture, 
      transparent: true, 
      depthTest: false, 
      depthWrite: false,
      toneMapped: false // Ensure crisp text brightness in XR
    });
    const textMesh = new THREE.Mesh(textGeom, textMat);
    textMesh.position.y = -BUTTON_H * 0.25; // Adjusted from 0.28 for larger text area
    textMesh.position.z = 0.002;
    textMesh.renderOrder = 10001;
    buttonGroup.add(textMesh);
    
    // Create specific 3D icons based on label
    let iconMesh;
    switch(label.toLowerCase()) {
      case '1:1':
        // Scale icon: two connected cubes of different sizes
        const cube1 = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale * 0.6, iconScale * 0.6, iconScale * 0.6),
          new THREE.MeshBasicMaterial({ color: 0x66d9ff, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter blue
        );
        const cube2 = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale * 0.4, iconScale * 0.4, iconScale * 0.4),
          new THREE.MeshBasicMaterial({ color: 0x99e6ff, depthTest: false, depthWrite: false, toneMapped: false }) // Even brighter blue
        );
        cube1.renderOrder = 10003; // Higher than iconGroup
        cube2.renderOrder = 10003;
        cube1.position.x = -iconScale * 0.3;
        cube2.position.x = iconScale * 0.3;
        iconGroup.add(cube1, cube2);
        break;
        
      case 'fit':
        // Fit icon: arrows pointing inward
        const arrowGeom = new THREE.ConeGeometry(iconScale * 0.1, iconScale * 0.3, 6);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x33ff66, depthTest: false, depthWrite: false, toneMapped: false }); // Much brighter green
        const arrow1 = new THREE.Mesh(arrowGeom, arrowMat);
        const arrow2 = new THREE.Mesh(arrowGeom, arrowMat);
        arrow1.renderOrder = 10003; // Higher than iconGroup
        arrow2.renderOrder = 10003;
        arrow1.position.x = -iconScale * 0.4; arrow1.rotation.z = Math.PI / 2;
        arrow2.position.x = iconScale * 0.4; arrow2.rotation.z = -Math.PI / 2;
        iconGroup.add(arrow1, arrow2);
        break;
        
      case 'reset':
        // Reset icon: circular arrow
        const torusGeom = new THREE.TorusGeometry(iconScale * 0.4, iconScale * 0.08, 8, 16);
  const torusMat = new THREE.MeshBasicMaterial({ color: 0xff6666, depthTest: false, depthWrite: false, toneMapped: false }); // Much brighter red
        iconMesh = new THREE.Mesh(torusGeom, torusMat);
        break;
        
      case 'grab':
        // Grab icon: hand shape (simplified as sphere with fingers)
        const handSphere = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.3, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffcc33, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter orange
        );
        iconGroup.add(handSphere);
        // Add finger cylinders
        for (let i = 0; i < 5; i++) {
          const finger = new THREE.Mesh(
            new THREE.CylinderGeometry(iconScale * 0.04, iconScale * 0.04, iconScale * 0.2, 6),
            new THREE.MeshBasicMaterial({ color: 0xffdd66, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter orange
          );
          finger.position.x = (i - 2) * iconScale * 0.15;
          finger.position.y = iconScale * 0.2;
          iconGroup.add(finger);
        }
        break;
        
      case 'objects':
        // Objects icon: multiple small cubes
        for (let i = 0; i < 3; i++) {
          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(iconScale * 0.25, iconScale * 0.25, iconScale * 0.25),
            new THREE.MeshBasicMaterial({ color: 0x77ddff, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter blue
          );
          cube.position.x = (i - 1) * iconScale * 0.4;
          cube.position.y = Math.sin(i) * iconScale * 0.2;
          iconGroup.add(cube);
        }
        break;
        
      case 'lock ground':
        // Lock icon: padlock shape
        const lockBody = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale * 0.4, iconScale * 0.3, iconScale * 0.2),
          new THREE.MeshBasicMaterial({ color: 0xffee33, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter yellow
        );
        const lockShackle = new THREE.Mesh(
          new THREE.TorusGeometry(iconScale * 0.2, iconScale * 0.05, 6, 12, Math.PI),
          new THREE.MeshBasicMaterial({ color: 0xffff66, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter yellow
        );
        lockShackle.position.y = iconScale * 0.2;
        lockShackle.rotation.x = Math.PI;
        iconGroup.add(lockBody, lockShackle);
        break;
        
      case 'mat':
        // Material icon: textured plane
        const matPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(iconScale * 0.6, iconScale * 0.6),
          new THREE.MeshBasicMaterial({ color: 0xff88dd, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter magenta
        );
        matPlane.rotation.x = -Math.PI * 0.2;
        iconGroup.add(matPlane);
        break;
        
      case 'align tile':
        // Align icon: grid pattern
        for (let x = -1; x <= 1; x++) {
          for (let y = -1; y <= 1; y++) {
            const dot = new THREE.Mesh(
              new THREE.SphereGeometry(iconScale * 0.06, 6, 4),
              new THREE.MeshBasicMaterial({ color: 0x66ffaa, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter green
            );
            dot.position.x = x * iconScale * 0.2;
            dot.position.y = y * iconScale * 0.2;
            iconGroup.add(dot);
          }
        }
        break;
        
      case 'fingers':
        // Fingers icon: hand visualization
        const palmSphere = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.15, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x33eeff, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter cyan
        );
        iconGroup.add(palmSphere);
        // Fingertip spheres
        for (let i = 0; i < 5; i++) {
          const tip = new THREE.Mesh(
            new THREE.SphereGeometry(iconScale * 0.05, 6, 4),
            new THREE.MeshBasicMaterial({ color: 0x66ffff, depthTest: false, depthWrite: false, toneMapped: false }) // Much brighter cyan
          );
          const angle = (i - 2) * 0.3;
          tip.position.x = Math.sin(angle) * iconScale * 0.4;
          tip.position.y = Math.cos(angle) * iconScale * 0.4;
          iconGroup.add(tip);
        }
        break;
        
      case 'host':
        // Host icon: broadcast/signal waves
        for (let i = 1; i <= 3; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(iconScale * 0.15 * i, iconScale * 0.03, 6, 12),
            new THREE.MeshBasicMaterial({ 
              color: 0x00ff66, // Bright green
              transparent: true, 
              opacity: 1 - (i * 0.15), // Less opacity reduction for visibility
              depthTest: false, 
              depthWrite: false,
              toneMapped: false 
            })
          );
          iconGroup.add(ring);
        }
        break;
        
      case 'join':
        // Join icon: connecting arrows
        const centerSphere = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.1, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x66ff00, depthTest: false, depthWrite: false, toneMapped: false }) // Bright lime green
        );
        iconGroup.add(centerSphere);
        for (let i = 0; i < 4; i++) {
          const arrow = new THREE.Mesh(
            new THREE.ConeGeometry(iconScale * 0.06, iconScale * 0.2, 6),
            new THREE.MeshBasicMaterial({ color: 0x88ff22, depthTest: false, depthWrite: false, toneMapped: false }) // Brighter lime
          );
          const angle = i * Math.PI / 2;
          arrow.position.x = Math.cos(angle) * iconScale * 0.3;
          arrow.position.y = Math.sin(angle) * iconScale * 0.3;
          arrow.rotation.z = -angle + Math.PI / 2;
          iconGroup.add(arrow);
        }
        break;
        
      case 'prims':
        // Primitives icon: basic shapes
        const primCube = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale * 0.2, iconScale * 0.2, iconScale * 0.2),
          new THREE.MeshBasicMaterial({ color: 0x4da6ff, depthTest: false, depthWrite: false, toneMapped: false }) // Bright blue
        );
        const primSphere = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.1, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, depthWrite: false, toneMapped: false }) // Bright red
        );
        primCube.position.x = -iconScale * 0.2;
        primSphere.position.x = iconScale * 0.2;
        iconGroup.add(primCube, primSphere);
        break;
        
      case 'equip':
        // Equip icon: stack of 3D models/objects representing equipment
        const objBase = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale * 0.3, iconScale * 0.15, iconScale * 0.3),
          new THREE.MeshBasicMaterial({ color: 0x8B4513, depthTest: false, depthWrite: false, toneMapped: false }) // Brown (like a table)
        );
        const objMiddle = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.08, iconScale * 0.08, iconScale * 0.25, 8),
          new THREE.MeshBasicMaterial({ color: 0x228B22, depthTest: false, depthWrite: false, toneMapped: false }) // Forest green (like a plant)
        );
        const objTop = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.06, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xFF6347, depthTest: false, depthWrite: false, toneMapped: false }) // Tomato red (like a vase)
        );
        objBase.position.y = -iconScale * 0.2;
        objMiddle.position.y = iconScale * 0.05;
        objTop.position.y = iconScale * 0.25;
        iconGroup.add(objBase, objMiddle, objTop);
        break;
        
      case 'room':
        // Room icon: connected nodes representing collaboration
        const node1 = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x00BFFF, depthTest: false, depthWrite: false, toneMapped: false }) // Deep sky blue
        );
        const node2 = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x00BFFF, depthTest: false, depthWrite: false, toneMapped: false })
        );
        const node3 = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x00BFFF, depthTest: false, depthWrite: false, toneMapped: false })
        );
        // Connection lines between nodes
        const connectionGeom = new THREE.CylinderGeometry(iconScale * 0.02, iconScale * 0.02, iconScale * 0.3, 6);
        const connectionMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB, depthTest: false, depthWrite: false, toneMapped: false }); // Sky blue
        const conn1 = new THREE.Mesh(connectionGeom, connectionMat);
        const conn2 = new THREE.Mesh(connectionGeom, connectionMat);
        
        // Position nodes in triangle formation
        node1.position.set(0, iconScale * 0.2, 0);
        node2.position.set(-iconScale * 0.25, -iconScale * 0.1, 0);
        node3.position.set(iconScale * 0.25, -iconScale * 0.1, 0);
        
        // Position connections
        conn1.position.set(-iconScale * 0.125, iconScale * 0.05, 0);
        conn1.rotation.z = Math.PI / 6; // Angle to connect node1 to node2
        conn2.position.set(iconScale * 0.125, iconScale * 0.05, 0);
        conn2.rotation.z = -Math.PI / 6; // Angle to connect node1 to node3
        
        iconGroup.add(node1, node2, node3, conn1, conn2);
        break;
        
      case 'back':
        // Back icon: left-pointing arrow
        const backArrow = new THREE.Mesh(
          new THREE.ConeGeometry(iconScale * 0.15, iconScale * 0.4, 6),
          new THREE.MeshBasicMaterial({ color: 0xcccccc, depthTest: false, depthWrite: false, toneMapped: false }) // Brighter gray
        );
        backArrow.rotation.z = Math.PI / 2; // Point left
        iconGroup.add(backArrow);
        break;
        
      // Draw submenu color buttons
      case 'red':
        iconMesh = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.4, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, depthWrite: false, toneMapped: false }) // Red
        );
        break;
        
      case 'green':
        iconMesh = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.4, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false, toneMapped: false }) // Green
        );
        break;
        
      case 'blue':
        iconMesh = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.4, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0x0066ff, depthTest: false, depthWrite: false, toneMapped: false }) // Blue
        );
        break;
        
      case 'yellow':
        iconMesh = new THREE.Mesh(
          new THREE.SphereGeometry(iconScale * 0.4, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, depthWrite: false, toneMapped: false }) // Yellow
        );
        break;
        
      // Draw submenu line thickness buttons
      case 'thin':
        // Thin line icon
        const thinLine = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.02, iconScale * 0.02, iconScale * 0.8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false }) // White
        );
        thinLine.rotation.z = Math.PI / 2; // Horizontal
        iconGroup.add(thinLine);
        break;
        
      case 'medium':
        // Medium line icon
        const mediumLine = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.05, iconScale * 0.05, iconScale * 0.8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false }) // White
        );
        mediumLine.rotation.z = Math.PI / 2; // Horizontal
        iconGroup.add(mediumLine);
        break;
        
      case 'thick':
        // Thick line icon
        const thickLine = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.08, iconScale * 0.08, iconScale * 0.8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false }) // White
        );
        thickLine.rotation.z = Math.PI / 2; // Horizontal
        iconGroup.add(thickLine);
        break;
        
      case 'clear':
        // Clear icon: X symbol
        const clearLine1 = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.04, iconScale * 0.04, iconScale * 0.8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false, depthWrite: false, toneMapped: false }) // Red
        );
        const clearLine2 = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.04, iconScale * 0.04, iconScale * 0.8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false, depthWrite: false, toneMapped: false }) // Red
        );
        clearLine1.rotation.z = Math.PI / 4; // 45 degrees
        clearLine2.rotation.z = -Math.PI / 4; // -45 degrees
        iconGroup.add(clearLine1, clearLine2);
        break;
        
      case 'return':
        // Return icon: left arrow with bar
        const returnArrow = new THREE.Mesh(
          new THREE.ConeGeometry(iconScale * 0.15, iconScale * 0.3, 6),
          new THREE.MeshBasicMaterial({ color: 0x66ff66, depthTest: false, depthWrite: false, toneMapped: false }) // Green
        );
        const returnBar = new THREE.Mesh(
          new THREE.CylinderGeometry(iconScale * 0.05, iconScale * 0.05, iconScale * 0.4, 8),
          new THREE.MeshBasicMaterial({ color: 0x66ff66, depthTest: false, depthWrite: false, toneMapped: false }) // Green
        );
        returnArrow.position.x = -iconScale * 0.2;
        returnArrow.rotation.z = Math.PI / 2; // Point left
        returnBar.position.x = iconScale * 0.1;
        returnBar.rotation.z = Math.PI / 2; // Horizontal
        iconGroup.add(returnArrow, returnBar);
        break;
        
      default:
        // Default icon: simple cube
        iconMesh = new THREE.Mesh(
          new THREE.BoxGeometry(iconScale, iconScale, iconScale),
          new THREE.MeshBasicMaterial({ color: 0xbbbbbb, depthTest: false, depthWrite: false, toneMapped: false }) // Brighter gray
        );
    }
    
    if (iconMesh) {
      iconMesh.renderOrder = 10003; // Ensure individual icon meshes render in front
      iconGroup.add(iconMesh);
    }
    
    if (iconGroup.children.length > 0) {
  iconGroup.position.y = BUTTON_H * 0.1; // Position above text
  iconGroup.position.z = 0.006; // Push slightly further forward (6mm) for safety vs. alpha dimming
      
      // Ensure icon faces outward (+Z in HUD local space) without extra tilts
      iconGroup.rotation.set(0, 0, 0);
      // Mark as 3D icon group for per-frame camera-facing alignment
      iconGroup.userData.__icon3D = true;
      
      iconGroup.renderOrder = 10002; // Higher render order than background
      
      // Ensure all icon children have high render order
      iconGroup.traverse((child) => {
        if (child.isMesh) {
          child.renderOrder = 10003;
          // Mark meshes that are part of the 3D icon as well
          child.userData.__icon3D = true;
        }
      });
      
      buttonGroup.add(iconGroup);
    }
    
    // Flash overlay for click feedback
    // Flash overlay for click feedback
    const flashGeom = bgGeom.clone();
    const flashMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0, 
      depthTest: false, 
      depthWrite: false, 
      blending: THREE.AdditiveBlending 
    });
    const flash = new THREE.Mesh(flashGeom, flashMat);
    flash.name = 'hud-flash';
    flash.renderOrder = 10002;
    flash.scale.set(1.05, 1.05, 1);
    flash.position.z = 0.002;
    buttonGroup.add(flash);
    buttonGroup.userData.__flash = flash;
    
    // Store materials for hover effects
    const baseBgMat = bgMat.clone();
    const hoverBgMat = bgMat.clone();
    hoverBgMat.color.setHex(0x4a4a4a); // Much lighter gray on hover for better visibility
    
    buttonGroup.userData.__hudButton.base = baseBgMat;
    buttonGroup.userData.__hudButton.hover = hoverBgMat;
    
    // Function to update label (recompute font size to fit)
    function setLabel(next) {
      try {
        const labelStr = String(next || '');
        buttonGroup.userData.__hudButton.label = labelStr;
        // Clear
        textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
        // Redraw with scale-to-fit
        textCtx.fillStyle = '#ffffff';
        textCtx.textAlign = 'center';
        textCtx.textBaseline = 'middle';
        let px = Math.round(32 * 1.77); // Increased from 1.33 to 1.77 for larger text
        const maxTextW = textCanvas.width * 0.9;
        while (px > 16) { // Increased minimum from 12 to 16
          textCtx.font = `bold ${px}px Arial`;
          if (textCtx.measureText(labelStr).width <= maxTextW) break;
          px -= 2;
        }
        textCtx.font = `bold ${px}px Arial`;
        textCtx.fillText(labelStr, textCanvas.width / 2, textCanvas.height / 2);
        if (textTexture) textTexture.needsUpdate = true;
      } catch {}
    }
    
    // Function to add/update status indicator (like green dot)
    function setStatusIndicator(show, color = 0x00ff00) {
      // Remove existing indicator
      const existingIndicator = buttonGroup.children.find(child => child.name === 'statusIndicator');
      if (existingIndicator) {
        buttonGroup.remove(existingIndicator);
        if (existingIndicator.geometry) existingIndicator.geometry.dispose();
        if (existingIndicator.material) existingIndicator.material.dispose();
      }
      
      if (show) {
        // Add green dot indicator
        const dotGeom = new THREE.SphereGeometry(iconScale * 0.1, 8, 6);
  const dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.name = 'statusIndicator';
        dot.position.set(BUTTON_W * 0.35, BUTTON_H * 0.35, 0.003); // Top right corner
        dot.renderOrder = 10003;
        buttonGroup.add(dot);
      }
    }
    
    // Function to add/update user count badge
    function setUserCount(count) {
      // Remove existing count badge
      const existingBadge = buttonGroup.children.find(child => child.name === 'userCountBadge');
      if (existingBadge) {
        buttonGroup.remove(existingBadge);
        if (existingBadge.geometry) existingBadge.geometry.dispose();
        if (existingBadge.material && existingBadge.material.map) existingBadge.material.map.dispose();
        if (existingBadge.material) existingBadge.material.dispose();
      }
      
      if (count && count > 1) {
        // Create count badge
        const badgeCanvas = document.createElement('canvas');
        badgeCanvas.width = 64; badgeCanvas.height = 64;
        const badgeCtx = badgeCanvas.getContext('2d');
        
        // Draw badge background (circle)
        badgeCtx.fillStyle = '#ff4444';
        badgeCtx.beginPath();
        badgeCtx.arc(32, 32, 30, 0, Math.PI * 2);
        badgeCtx.fill();
        
        // Draw count text
        badgeCtx.fillStyle = '#ffffff';
        badgeCtx.font = 'bold 32px Arial'; // Increased from 24px to 32px
        badgeCtx.textAlign = 'center';
        badgeCtx.textBaseline = 'middle';
        badgeCtx.fillText(String(count), 32, 32);
        
        const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
        const badgeGeom = new THREE.PlaneGeometry(BUTTON_W * 0.25, BUTTON_W * 0.25);
        const badgeMat = new THREE.MeshBasicMaterial({ 
          map: badgeTexture, 
          transparent: true, 
          depthTest: false, 
          depthWrite: false,
          toneMapped: false
        });
        const badge = new THREE.Mesh(badgeGeom, badgeMat);
        badge.name = 'userCountBadge';
        badge.position.set(-BUTTON_W * 0.35, BUTTON_H * 0.35, 0.003); // Top left corner
        badge.renderOrder = 10003;
        buttonGroup.add(badge);
      }
    }
    
    return { mesh: buttonGroup, onClick, setLabel, setStatusIndicator, setUserCount };
  }

  function ensureHandViz() {
    // [06] Hand Visualization Creation ----------------------------------------------------------
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
  const skelGeom = new THREE.BufferGeometry();
  // skeleton line segments require two points per bone (start and end) -> 2 * BONES.length vertices
  skelGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * BONES.length * 2), 3));
        const skelLine = new THREE.LineSegments(skelGeom, new THREE.LineBasicMaterial({ color: 0x5ac8ff, transparent:true, opacity:0.95, depthTest:false }));
        skelLine.visible = false;
            // simple hand mesh proxy: a camera-facing canvas plane that draws a smoothed filled silhouette
            const meshGroup = new THREE.Group(); meshGroup.visible = false;
            // create a canvas texture for silhouette rendering
            const CANVAS_W = 256, CANVAS_H = 256;
            const c = document.createElement('canvas'); c.width = CANVAS_W; c.height = CANVAS_H; const ctx = c.getContext('2d');
            // initial clear
            ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
            const palmTex = new THREE.CanvasTexture(c); if(THREE.SRGBColorSpace) palmTex.colorSpace = THREE.SRGBColorSpace; palmTex.needsUpdate = true;
            // plane sized to roughly cover a hand area; double-sided so it remains visible in AR passthrough
            const PALM_W = 0.12, PALM_H = 0.12;
            const palmMat = new THREE.MeshBasicMaterial({ map: palmTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
            const palm = new THREE.Mesh(new THREE.PlaneGeometry(PALM_W, PALM_H), palmMat); palm.name = 'palm-proxy'; meshGroup.add(palm);
            // keep legacy cylinders available but hidden (not used for silhouette)
            const cylMat = new THREE.MeshBasicMaterial({ color: 0x2a7fff, transparent:true, opacity:0.0, depthTest:false });
            const cylGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 8);
            const boneCyls = new Array(BONES.length).fill(0).map(()=> new THREE.Mesh(cylGeo, cylMat.clone()));
      boneCyls.forEach(m=>{ m.visible=false; meshGroup.add(m); });
    g.add(wristSphere, line, skelLine, meshGroup, ...tipSpheres);
    // expose canvas texture and ctx for runtime silhouette drawing
    g.userData.__viz = { tips, tipSpheres, wristSphere, line, base:{ tipColor, wristColor, lineColor }, skel:{ geom: skelGeom, line: skelLine }, mesh:{ group: meshGroup, palm, boneCyls, palmTex: palmTex, palmCanvas: c, palmCtx: ctx, palmSize: [PALM_W, PALM_H] } };
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
    // [06] Hand Viz Palette Swap ----------------------------------------------------------------
    if (handVizMode === mode) return;
    handVizMode = mode;
    const apply = (group) => {
      const child = group && group.children && group.children[0]; if (!child) return;
      const vz = child.userData.__viz; if (!vz) return;
      const tips = vz.tipSpheres || []; const wrist = vz.wristSphere; const line = vz.line;
      
      // Check if VR draw mode is active - if so, don't override fingertip colors
      const vrDrawActive = window.vrDraw && window.vrDraw.isActive && window.vrDraw.isActive();
      
      if (mode === 'hands-only'){
        // Force a distinct blue palette in hands-only mode, unless VR draw is active
        const tipBlue = 0x1ea0ff; const lineBlue = 0x1ea0ff; const wristBlue = 0x8ac9ff;
        
        // Only change fingertip colors if VR draw is not active
        if (!vrDrawActive) {
          for (const t of tips){ if (t?.material){ t.material.color.setHex(tipBlue); t.material.needsUpdate = true; } }
        }
        
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
    // [07] HUD Ensure & Button Layout ------------------------------------------------------------
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
  // Note: hideDrawSubmenu() will be called after function definitions
  // Both controller trigger and right index finger can activate buttons
  return hud;
  }

  function remove(){
    // [07] HUD Removal & Cleanup ----------------------------------------------------------------
    try { const l = hud && hud.userData && hud.userData.__listeners; if (l?.session){ l.session.removeEventListener('selectstart', l.onSelectStart); l.session.removeEventListener('selectend', l.onSelectEnd); } } catch {}
    if (hud?.parent) hud.parent.remove(hud);
  hud = null; buttons = []; xrHoverBySource = new WeakMap(); xrPressedSources = new WeakSet();
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
    // [08] Frame Update -------------------------------------------------------------------------
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
          // Prefer using the wrist joint orientation to compute the palm outward normal.
          // Per WebXR spec the joint native -Y points outward from the palm, so transform (0,-1,0) by the wrist quaternion.
          const wp = leftWristPose.transform.position;
          const w = new THREE.Vector3(wp.x, wp.y, wp.z);
          let z = null; // world palm normal
          try {
            const o = leftWristPose.transform.orientation;
            if (o) {
              const qW = new THREE.Quaternion(o.x, o.y, o.z, o.w);
              z = new THREE.Vector3(0, -1, 0).applyQuaternion(qW).normalize();
            }
          } catch(e){ z = null; }

          // If orientation isn't available or is degenerate, fall back to index×thumb cross product using wrist->index and wrist->thumb vectors
          const ip = leftIdxPose?.transform?.position; const tp = leftThumbPose?.transform?.position;
          let vIndex = null, vThumb = null;
          if (ip) vIndex = new THREE.Vector3(ip.x-w.x, ip.y-w.y, ip.z-w.z);
          if (tp) vThumb = new THREE.Vector3(tp.x-w.x, tp.y-w.y, tp.z-w.z);
          if (!z){
            if (vIndex && vThumb){
              // For LEFT hand prefer index x thumb ordering; if handedness flips, this can be inverted.
              z = new THREE.Vector3().crossVectors(vIndex, vThumb);
              if (z.lengthSq() < 1e-6) z.set(0,0,1);
              z.normalize();
            } else {
              z = new THREE.Vector3(0,0,1);
            }
          }

          // x axis along index direction projected on palm plane
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
          // Cache palm up/down state and presence (only when wrist pose was usable)
          if (hud && hud.userData){ hud.userData.__palmUp = (z.y >= 0.15); hud.userData.__palmPresent = true; }
        } else {
          // Explicitly mark palm not present when we have no wrist pose
          if (hud && hud.userData) hud.userData.__palmPresent = false;
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
          // Prefer device-provided joint radii to compute a dynamic pinch threshold when available
          const rIdx = (typeof leftIdxPose.radius === 'number') ? leftIdxPose.radius : NaN;
          const rThumb = (typeof leftThumbPose.radius === 'number') ? leftThumbPose.radius : NaN;
          let thresh = PINCH_THRESHOLD_M;
          if (!Number.isNaN(rIdx) && !Number.isNaN(rThumb)){
            thresh = Math.min(PINCH_MAX, Math.max(PINCH_MIN, (rIdx + rThumb) * PINCH_SCALE));
          }
          if (d < thresh) anyGrabOrSqueeze = true;
        }
      }
    } catch {}
  // For palm anchor, do not fallback to camera when not placed (menu should hide). For controller anchor, allow fallback.
  if (!placed && anchor.type === 'controller' && camWorldPos && camWorldQuat){ const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camWorldQuat); const up=new THREE.Vector3(0,1,0).applyQuaternion(camWorldQuat); const pos=camWorldPos.clone().add(forward.multiplyScalar(0.5)).add(up.multiplyScalar(-0.05)); hud.position.lerp(pos,0.35); hud.quaternion.slerp(camWorldQuat,0.35); }
    // Make all 3D icons face the camera each frame (yaw/pitch), preserving tile/text quads.
    try {
      if (xrCam && hud) {
        const camPos = camWorldPos.clone();
        const worldY = new THREE.Vector3(0,1,0);
        hud.traverse((obj)=>{
          try {
            if (!obj || !obj.userData || !obj.userData.__icon3D) return;
            
            // Debug: Track which objects are being aligned
            const buttonData = obj.parent?.userData?.__hudButton;
            const buttonLabel = buttonData?.label || 'unknown';
            
            // Compute world-space position of the icon object
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            // Direction from icon to camera
            const toCam = new THREE.Vector3().subVectors(camPos, worldPos).normalize();
            
            // Debug logging for problematic icons
            if (buttonLabel.includes('OBJ') || buttonLabel.includes('.') || worldPos.length() > 10) {
              console.log('📦 Aligning 3D icon:', {
                label: buttonLabel,
                worldPos: worldPos.toArray().map(n => n.toFixed(3)),
                toCam: toCam.toArray().map(n => n.toFixed(3)),
                distance: worldPos.length().toFixed(3)
              });
            }
            
            // Build a facing quaternion: z -> toCam, y -> world up (best-effort)
            const z = toCam.clone();
            const y = worldY.clone();
            let x = new THREE.Vector3().crossVectors(y, z);
            if (x.lengthSq() < 1e-6) x.set(1,0,0); else x.normalize();
            const zFixed = new THREE.Vector3().crossVectors(x, y).normalize();
            const m = new THREE.Matrix4().makeBasis(x, y, zFixed);
            const q = new THREE.Quaternion().setFromRotationMatrix(m);
            // Apply in local space by converting world quaternion to parent space
            if (obj.parent) {
              const parentWorldQ = new THREE.Quaternion();
              obj.parent.getWorldQuaternion(parentWorldQ);
              const parentWorldQInv = parentWorldQ.clone().invert();
              const localQ = q.clone().premultiply(parentWorldQInv);
              obj.quaternion.slerp(localQ, 0.6);
            } else {
              obj.quaternion.slerp(q, 0.6);
            }
          } catch {}
        });
      }
    } catch {}
    // Enforce visibility rules: menu shows when toggled AND no grab/squeeze; if palm-anchored, also require left hand open
    try {
  const palmReq = (anchor.type === 'palm');
  const palmUp = !!hud.userData.__palmUp;
  const palmPresent = !!hud.userData.__palmPresent;
  // If palm not present, don’t gate on palmUp; allow menu to show when toggled
  const allowShow = (!!hud.userData.__menuShown) && (!anyGrabOrSqueeze) && (!palmReq || !palmPresent || palmUp) && (!(typeof window !== 'undefined' && window.__xrPrim));
  const mustHide = (anyGrabOrSqueeze) || (palmReq && palmPresent && !palmUp) || (typeof window !== 'undefined' && window.__xrPrim);
  if (hud.visible && mustHide) { 
    hud.visible = false; 
    hud.userData.__autoHidden = true; 
    hud.userData.__menuShown = false; 
    try { 
      // Ensure any draw submenu is closed when HUD hides
      if (typeof hideDrawSubmenu === 'function') hideDrawSubmenu(); 
    } catch {}
    try { if (typeof module!=='undefined'){} } catch {} 
  }
  else if (!hud.visible && allowShow && (hud.userData.__autoHidden || hud.userData.__menuShown)) { 
    hud.visible = true; 
    hud.userData.__autoHidden = false; 
    // Add extended grace period when HUD first becomes visible to prevent accidental clicks
    const now = performance.now();
    globalClickCooldownUntil = Math.max(globalClickCooldownUntil, now + 1000); // 1 second grace period
    handCrossingCooldownUntil = Math.max(handCrossingCooldownUntil, now + 800); // Additional hand crossing protection
    console.log('🎨 XR-HUD: Became visible - adding 1000ms grace period to prevent accidental clicks');
    try { 
      /* reset pressed states on show */ 
      // Default to main menu on open: ALWAYS start with main menu visible
      // Only show draw submenu if VR Draw was explicitly active AND user deliberately opened it
      // This prevents accidental auto-opening of draw menu on session start
      if (typeof hideDrawSubmenu === 'function') {
        hideDrawSubmenu();
        console.log('🎨 XR-HUD: Forcing main menu to show on HUD open (draw submenu hidden)');
      }
    } catch {} 
  }
    } catch {}
    // Hover and click via controller rays; also support right finger poke
    try {
      const session = renderer.xr.getSession?.();
    if (session && frame){
  const sources = session.inputSources ? Array.from(session.inputSources) : [];
  // Gather current HUD button meshes dynamically. Only include visible meshes to avoid mis-hits.
  const hudTargets = [];
  try {
    if (hud) hud.traverse(o=>{ 
      if (o && o.userData && o.userData.__hudButton) {
        // Include both meshes (text buttons) and groups (3D primitive buttons)
        if (o.isMesh || o.isGroup) {
          // Check if this object and all its ancestors are visible
          let isFullyVisible = o.visible;
          let parent = o.parent;
          while (parent && isFullyVisible) {
            if (parent.visible === false) {
              isFullyVisible = false;
              break;
            }
            parent = parent.parent;
          }
          if (isFullyVisible) {
            hudTargets.push(o);
          }
        }
      }
    });
  } catch{}
  // If primitives submenu open, raise its buttons' priority by sorting (renderOrder already set),
  // and rely on visibility of main menu buttons being false. As a safety, move submenu meshes to front.
  try {
    if (typeof window !== 'undefined' && window.__xrPrimsOpen && window.__primsMenuGroup){
      const primSet = new Set(); try { window.__primsMenuGroup.traverse(o=>{ if (o && o.isMesh) primSet.add(o); }); } catch{}
      hudTargets.sort((a,b)=>{ const ap=primSet.has(a)?1:0; const bp=primSet.has(b)?1:0; return bp-ap; });
    }
  } catch{}
  // If objects submenu open, raise its buttons' priority by sorting
  try {
    if (typeof window !== 'undefined' && window.__xrObjsOpen && window.__objMenuGroup){
      const objSet = new Set(); try { window.__objMenuGroup.traverse(o=>{ if (o && o.isMesh) objSet.add(o); }); } catch{}
      hudTargets.sort((a,b)=>{ const ap=objSet.has(a)?1:0; const bp=objSet.has(b)?1:0; return bp-ap; });
    }
  } catch{}
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
          let top = hits && hits.length ? hits[0].object : null;
          
          // If we hit a child of a 3D button group, find the parent group with __hudButton
          if (top && !top.userData.__hudButton) {
            let parent = top.parent;
            while (parent && !parent.userData.__hudButton) {
              parent = parent.parent;
            }
            if (parent && parent.userData.__hudButton) {
              top = parent;
            }
          }
          
          xrHoverBySource.set(src, top);
          if (top) hovered.add(top);
          if (top && src.gamepad) controllerHoveringHUD = true;
          // Controller trigger clicks a hovered button
          if (src.gamepad){
            const pressed = !!(src.gamepad.buttons && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed);
            const prev = update.__xrTriggerPrev.get(src) === true;
            if (pressed && !prev && top){
              // Check global cooldown to prevent accidental clicks after menu transitions
              const now = performance.now();
              if (now >= globalClickCooldownUntil) {
                console.log('XR HUD: Button clicked:', top.userData?.__hudButton?.label);
                const handler = top.userData?.__hudButton?.onClick; if (typeof handler === 'function') { try { handler(); } catch{} }
                try { const fl = top.userData && top.userData.__flash; if (fl && fl.material) { fl.material.opacity = 0.9; } } catch{}
              } else {
                console.log('XR HUD: Button click ignored due to cooldown');
              }
            }
            update.__xrTriggerPrev.set(src, pressed);
          }
        }
      }
  // Visualize right-controller pointer ray; extend to first hit among HUD or scene (horizontal only)
  // Show a right-hand/controller ray in Ray mode only (both controller and hand allowed)
  const wantRay = !!(typeof window !== 'undefined' && window.__xrInteractionRay === true);
  if (wantRay && src.handedness === 'right' && (src.gamepad || src.hand)){
        sawRightController = true; anyController = true;
        if (rightRay && rightRayTip){
          const pose = raySpace ? frame.getPose(raySpace, ref) : null;
          if (pose){
    const p=pose.transform.position, o=pose.transform.orientation; const origin=new THREE.Vector3(p.x,p.y,p.z); const dir=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(o.x,o.y,o.z,o.w)).normalize();
  // Raycast against HUD and scene (legacy teleport discs removed)
    const discs = []; // kept for backwards API shape
    // Improve hit precision against thin rings/planes
    try { raycaster.params.Line = { threshold: 0.01 }; raycaster.params.Points = { threshold: 0.02 }; } catch{}
    const sceneTargets = [];
    try { scene.traverse(obj=>{ if (!obj || !obj.visible) return; if (obj.userData?.__helper) return; if (obj.isMesh) sceneTargets.push(obj); }); } catch{}
    raycaster.set(origin, dir);
    const up = new THREE.Vector3(0,1,0);
    const COS_MAX_TILT = 0.85; // allow only near-horizontal surfaces for free-aim teleport
    // Intersections
  let hudHit = null, bestScene = null; // bestScene: { point, normal, obj, dist }
    try {
      const hudHits = raycaster.intersectObjects(hudTargets, true);
      if (hudHits && hudHits.length) {
        hudHit = hudHits[0];
        
        // If we hit a child of a 3D button group, find the parent group with __hudButton
        if (hudHit.object && !hudHit.object.userData.__hudButton) {
          let parent = hudHit.object.parent;
          while (parent && !parent.userData.__hudButton) {
            parent = parent.parent;
          }
          if (parent && parent.userData.__hudButton) {
            // Create a new hit object with the correct target
            hudHit = { ...hudHit, object: parent };
          }
        }
      }
    } catch{}
    // (Teleport discs removed)
    try {
      const sHits = raycaster.intersectObjects(sceneTargets, true);
      if (sHits && sHits.length){
        for (const h of sHits){
          if (!h || !h.object) continue;
          // (Teleport discs removed)
          // Require a face and upward-facing world normal
          if (!h.face) continue;
          let nWorld = null;
          try {
            const nLocal = h.face.normal.clone();
            const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
            nWorld = nLocal.applyMatrix3(nm).normalize();
          } catch{}
          if (!nWorld || nWorld.dot(up) < COS_MAX_TILT) continue;
          const d = (typeof h.distance==='number')? h.distance : origin.distanceTo(h.point);
          bestScene = { point: h.point.clone(), normal: nWorld, obj: h.object, dist: d };
          break; // first acceptable is the closest
        }
      }
    } catch{}
    // Determine pointer tip: prefer HUD, then discs, then horizontal scene, else stabilized ground / fallback
    const posAttr = rightRay.geometry.attributes.position; posAttr.setXYZ(0, origin.x, origin.y, origin.z);
    let tip = origin.clone().add(dir.clone().multiplyScalar(2.0));
    // Stabilization cache
    if (!update.__stableReticle) update.__stableReticle = { point: null, normal: null };
    const stable = update.__stableReticle;
    if (hudHit?.point){
      tip.copy(hudHit.point);
      stable.point = null; // do not persist HUD tip
    } else if (bestScene?.point){
      tip.copy(bestScene.point);
      stable.point = bestScene.point.clone(); stable.normal = bestScene.normal?.clone();
    } else {
      // If no current horizontal hit, reuse last stable horizontal or ground-plane intersection
      if (stable.point){
        tip.copy(stable.point);
      } else {
        // Ground plane fallback (y=0) but cache it to prevent oscillation
        const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
        const ray = new THREE.Ray(origin, dir);
        const pt = new THREE.Vector3();
        if (ray.intersectPlane(plane, pt)) { tip.copy(pt); stable.point = pt.clone(); stable.normal = new THREE.Vector3(0,1,0); }
      }
    }
    // Default hide highlight on all discs; re-apply on target
  // (No discs to highlight)
    // Show free-aim teleport reticle only on valid horizontal scene hits; else optionally y=0 fallback
    try {
      let showed = false;
      // If HUD is targeted, never show the reticle
      if (hudHit && hudHit.point){ /* suppress reticle while interacting with HUD */ }
  else if (bestScene && bestScene.point && bestScene.normal){
        if (window.__teleport && window.__teleport.showReticleAt){ window.__teleport.showReticleAt(bestScene.point, bestScene.normal); showed = true; }
      }
      if (!showed){
        // Use stabilized ground fallback (same as tip logic) to avoid sliding
        if (update.__stableReticle?.point && update.__stableReticle?.normal){
          if (window.__teleport && window.__teleport.showReticleAt){ window.__teleport.showReticleAt(update.__stableReticle.point, update.__stableReticle.normal); showed = true; }
        } else {
          try {
            const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
            const ray = new THREE.Ray(origin, dir);
            const pt = new THREE.Vector3();
            if (ray.intersectPlane(plane, pt)){
              update.__stableReticle.point = pt.clone(); update.__stableReticle.normal = up.clone();
              if (window.__teleport && window.__teleport.showReticleAt){ window.__teleport.showReticleAt(pt, up); showed = true; }
            }
          } catch{}
        }
      }
      if (!showed){ if (window.__teleport && window.__teleport.hideReticle) window.__teleport.hideReticle(); }
    } catch{}
  // (No disc highlight logic)
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
  // When using controllers, hide fingertip dots; show them again when hands-only
        try {
          if (anyController) setHandVizStyle('off');
          else if (anyHand) setHandVizStyle('fingertips');
        } catch{}

  // Hand visualization per style: fingertips | skeleton | off
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
            vz.line.visible = false; vz.skel.line.visible = false; if (vz.mesh?.group) vz.mesh.group.visible = false;
            for (const s of vz.tipSpheres) { s.visible = false; }

            if (handVizStyle === 'fingertips'){
              const tipNames = vz.tips;
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
          const leftHand = sources.find(s => s.hand && s.handedness === 'left');
          const ref = (typeof getLocalSpace === 'function' ? getLocalSpace() : null) || null;
          let idxPos = null;
          
          // Skip finger interaction completely if primitive creation mode is active
          if (typeof window !== 'undefined' && window.__xrPrim) {
            fingerHover = null;
            return; // Skip all finger interaction processing
          }
          
          // Detect hand crossing to prevent state confusion
          const nowCrossing = performance.now();
          if (rightHand && leftHand && frame.getJointPose && ref) {
            const rightIdx = rightHand.hand.get?.('index-finger-tip');
            const leftPalm = leftHand.hand.get?.('wrist');
            const pRightIdx = rightIdx ? frame.getJointPose(rightIdx, ref) : null;
            const pLeftPalm = leftPalm ? frame.getJointPose(leftPalm, ref) : null;
            
            if (pRightIdx?.transform?.position && pLeftPalm?.transform?.position) {
              const rightPos = new THREE.Vector3().copy(pRightIdx.transform.position);
              const leftPos = new THREE.Vector3().copy(pLeftPalm.transform.position);
              const crossingDistance = rightPos.distanceTo(leftPos);
              
              // Detect if right hand is crossing over to left side (within 15cm of left palm)
              if (crossingDistance < 0.15) {
                if (!handCrossingDetected) {
                  handCrossingDetected = true;
                  handCrossingCooldownUntil = nowCrossing + 500; // Increased from 200ms to 500ms stabilization period
                }
              } else if (crossingDistance > 0.25) {
                handCrossingDetected = false;
              }
            }
          }
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
            for (const m of hudTargets){
              if (!m) continue; const st = ensurePressState(m);
              const lp = toLocal(idxPos, m);
              const halfW = BUTTON_W/2, halfH = BUTTON_H/2;
              const inX = Math.abs(lp.x) <= halfW * ACTIVE_SHRINK_X;
              const inY = Math.abs(lp.y) <= halfH * ACTIVE_SHRINK_Y;
              if (!inX || !inY) continue;
              const pen = penetrationAlongNormal(m, idxPos);
              const depth = THREE.MathUtils.clamp(-pen, 0, PRESS_MAX_M);
              if (depth <= 0) continue;
              const dist = Math.hypot(lp.x, lp.y);
              
              // Debug logging for button targeting
              const buttonLabel = m.userData?.__hudButton?.label || 'unknown';
              console.log('🎯 Button candidate:', {
                label: buttonLabel,
                depth: depth,
                dist: dist,
                inBounds: { inX, inY },
                localPos: { x: lp.x, y: lp.y },
                penetration: pen
              });
              
              if (!best || depth > best.depth + 1e-6 || (Math.abs(depth - best.depth) < 1e-6 && dist < best.dist)){
                best = { m, st, depth, dist };
                console.log('🎯 New best button candidate:', buttonLabel, 'depth:', depth, 'dist:', dist);
              }
            }
            
            if (best) {
              console.log('🎯 Final best button:', best.m.userData?.__hudButton?.label);
            } else {
              console.log('🎯 No button candidates found');
            }
          }
          // Animate and handle press only on the best candidate; release others
          for (const m of hudTargets){
            if (!m) continue; const st = ensurePressState(m);
            let targetDepth = 0; let within = false; let pressedNow = st.pressed;
            if (best && best.m === m){
              targetDepth = best.depth; within = true;
              // stability frames: require 4 frames above threshold before firing (increased from 2 for more stability)
              st._stable = (st._stable || 0) + (best.depth >= PRESS_START_M ? 1 : 0);
              const cooldown = st._cooldownUntil && now < st._cooldownUntil;
              if (!st.pressed && st._stable >= 4 && !cooldown) { pressedNow = true; }
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
              // Check global cooldown and hand crossing to prevent accidental clicks
              const globalNow = performance.now();
              const crossingCheck = globalNow >= handCrossingCooldownUntil;
              if (globalNow >= globalClickCooldownUntil && crossingCheck) {
                const buttonData = m.userData?.__hudButton;
                const handler = buttonData?.onClick;
                console.log('🎯 Button clicked:', {
                  label: buttonData?.label,
                  handlerType: typeof handler,
                  timestamp: globalNow,
                  globalCooldownPassed: globalNow >= globalClickCooldownUntil,
                  crossingCheckPassed: crossingCheck
                });
                if (typeof handler === 'function') { 
                  try { 
                    handler(); 
                  } catch(e) {
                    console.error('🎯 Button click handler error:', e);
                  } 
                }
                st._cooldownUntil = now + 180; // ms
                // Trigger flash overlay
                try { const fl = m.userData && m.userData.__flash; if (fl && fl.material) { fl.material.opacity = 0.9; } } catch {}
              } else {
                console.log('🎯 Button click blocked by cooldown:', {
                  label: m.userData?.__hudButton?.label,
                  globalCooldownPassed: globalNow >= globalClickCooldownUntil,
                  crossingCheckPassed: crossingCheck,
                  globalCooldownRemaining: Math.max(0, globalClickCooldownUntil - globalNow),
                  crossingCooldownRemaining: Math.max(0, handCrossingCooldownUntil - globalNow)
                });
              }
            }
            st.pressed = pressedNow;
            // Fade flash overlay each frame
            try { const fl = m.userData && m.userData.__flash; if (fl && fl.material && fl.material.opacity>0) { fl.material.opacity = Math.max(0, fl.material.opacity - 0.12); } } catch {}
          }
        } catch {}

  // Apply hover highlight for any hovered (ray or finger)
  hudTargets.forEach(m=>{
    const on = hovered.has(m);
    
    // Handle different button types
    if (m.material) {
      // Standard text buttons with direct materials
      const mat = m.material;
      mat.opacity = on ? 1.0 : 0.82; 
      mat.needsUpdate = true;
    } else if (m.isGroup && m.userData.__hudButton) {
      // 3D primitive buttons (groups) - find background mesh
      const bgMesh = m.children.find(child => child.isMesh && child.material && child.material.color);
      if (bgMesh && bgMesh.material) {
        const hoverData = m.userData.__hudButton;
        if (on && hoverData.hover) {
          bgMesh.material.copy(hoverData.hover);
        } else if (!on && hoverData.base) {
          bgMesh.material.copy(hoverData.base);
        }
        bgMesh.material.needsUpdate = true;
      }
    }
  });
  // Expose HUD hover to suppress other interactions (e.g., teleport)
  try { window.__xrHudHover = !!controllerHoveringHUD; } catch{}

      } else {
        if (rightRay) rightRay.visible = false; if (rightRayTip) rightRayTip.visible = false;
        try { window.__xrHudHover = false; } catch{}
        }
    } catch {}
  }

  function resetPressStates(){
    // [09] Press State Reset --------------------------------------------------------------------
    try { for (const b of buttons){ const st = ensurePressState(b.mesh); st.pressed=false; st.depth=0; st._stable=0; } } catch {}
  }

  function setGlobalClickCooldown(durationMs = 300) {
    // [09] Global Click Cooldown Setter ---------------------------------------------------------
    globalClickCooldownUntil = performance.now() + durationMs;
  }

  function setHandVizStyle(style){
    // [10] Hand Viz Style Setter (fingertips / skeleton / off) ----------------------------------
  const allowed = ['fingertips','skeleton','off'];
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

  // Draw mode submenu functionality
  let drawSubmenuActive = false;
  let drawSubmenuButtons = [];
  let drawStartStopButton = null; // reference to Start/Stop toggle tile
  
  function showDrawSubmenu(vrDrawService) {
    // [11] Draw Submenu: Show & Populate --------------------------------------------------------
    console.log('🎨 showDrawSubmenu called! Current state:');
    console.log('🎨   - drawSubmenuActive:', drawSubmenuActive);
    console.log('🎨   - vrDrawService available:', !!vrDrawService);
    console.log('🎨   - call timestamp:', performance.now());
    console.log('🎨   - call stack:', new Error().stack?.split('\n').slice(1, 5));
    
    if (drawSubmenuActive) {
      console.log('🎨 Draw submenu already active, skipping...');
      return;
    }
    
    // Respect global click cooldown to prevent accidental opening during HUD startup
    const now = performance.now();
    if (now < globalClickCooldownUntil) {
      console.log('🎨 Blocking draw submenu open - still in grace period:', (globalClickCooldownUntil - now), 'ms remaining');
      return;
    }
    
    // Add stabilization delay to prevent rapid menu switching
    handCrossingCooldownUntil = Math.max(handCrossingCooldownUntil, now + 200);
    globalClickCooldownUntil = Math.max(globalClickCooldownUntil, now + 300); // Additional global cooldown
    
    drawSubmenuActive = true;
    
    // Hide main menu buttons temporarily
    for (const btn of buttons) {
      if (btn.mesh) btn.mesh.visible = false;
    }
    
    // Start/Stop toggle button (explicit control for draw mode)
    const startStopLabel = (vrDrawService && vrDrawService.isActive && vrDrawService.isActive()) ? 'Stop' : 'Start';
    drawStartStopButton = createTile3DButton(startStopLabel, () => {
      try {
        if (!vrDrawService) return;
        const active = vrDrawService.isActive && vrDrawService.isActive();
        const next = !active;
        console.log('🎨 Draw Start/Stop clicked! Current active:', active, '-> setting to:', next);
        vrDrawService.setEnabled(!!next);
        
        // Verify the state change took effect
        setTimeout(() => {
          const newState = vrDrawService.isActive && vrDrawService.isActive();
          console.log('🎨 Draw state verification - expected:', next, 'actual:', newState);
        }, 50);
        
        // Update label to reflect new state
        if (drawStartStopButton && typeof drawStartStopButton.setLabel === 'function') {
          drawStartStopButton.setLabel(next ? 'Stop' : 'Start');
        }
        // Reflect state on main Draw button highlight
        if (window.setHudButtonActiveByLabel) window.setHudButtonActiveByLabel('Draw', !!next);
        // Coordinate with AR edit if globally available
        try { if (window.arEdit && typeof window.arEdit.setEnabled === 'function') window.arEdit.setEnabled(!next); } catch {}
      } catch(e) {
        console.error('🎨 Draw Start/Stop error:', e);
      }
    });

    // Color selection buttons
    const colorRed = createTile3DButton('Red', () => {
      if (vrDrawService) vrDrawService.setColor(0xff0000);
    });
    const colorGreen = createTile3DButton('Green', () => {
      if (vrDrawService) vrDrawService.setColor(0x00ff00);
    });
    const colorBlue = createTile3DButton('Blue', () => {
      if (vrDrawService) vrDrawService.setColor(0x0066ff);
    });
    const colorYellow = createTile3DButton('Yellow', () => {
      if (vrDrawService) vrDrawService.setColor(0xffff00);
    });
    
    // Line thickness buttons
    const thinLine = createTile3DButton('Thin', () => {
      if (vrDrawService) vrDrawService.setLineWidth(1);
    });
    const mediumLine = createTile3DButton('Medium', () => {
      if (vrDrawService) vrDrawService.setLineWidth(3);
    });
    const thickLine = createTile3DButton('Thick', () => {
      if (vrDrawService) vrDrawService.setLineWidth(6);
    });
    
    // Clear and Return buttons
    const clearButton = createTile3DButton('Clear', () => {
      if (vrDrawService) vrDrawService.clear();
    });
    const returnButton = createTile3DButton('Return', () => {
      // Close submenu but keep draw mode active so user can continue drawing
      const now = performance.now();
      if (now < handCrossingCooldownUntil) {
        setTimeout(() => { hideDrawSubmenu(); }, 120);
      } else {
        hideDrawSubmenu();
      }
      // Keep Draw button visually in sync with current state
      try {
        const isActive = vrDrawService && vrDrawService.isActive && vrDrawService.isActive();
        if (window.setHudButtonActiveByLabel) window.setHudButtonActiveByLabel('Draw', !!isActive);
      } catch {}
    });

    // Provide explicit exit control separate from Return
    const exitButton = createTile3DButton('Exit', () => {
      // Exit draw mode entirely
      hideDrawSubmenu();
      if (vrDrawService) vrDrawService.setEnabled(false);
      if (window.setHudButtonActiveByLabel) window.setHudButtonActiveByLabel('Draw', false);
      // Re-enable AR edit when exiting draw mode
      try { if (window.arEdit && typeof window.arEdit.setEnabled === 'function') window.arEdit.setEnabled(true); } catch {}
    });
    
    drawSubmenuButtons = [
      drawStartStopButton,
      colorRed, colorGreen, colorBlue, colorYellow,
      thinLine, mediumLine, thickLine,
      clearButton, returnButton, exitButton
    ];
    
    // Add submenu buttons to the HUD
    if (hud) {
      arrangeSubmenuButtons();
    }
  }
  
  function hideDrawSubmenu() {
    // [11] Draw Submenu: Hide & Restore ---------------------------------------------------------
    if (!drawSubmenuActive) return;
    
    // Add brief cooldown to prevent rapid menu switching during hand crossing
    const now = performance.now();
    handCrossingCooldownUntil = Math.max(handCrossingCooldownUntil, now + 100);
    
    drawSubmenuActive = false;
    
    // Remove submenu buttons
    for (const btn of drawSubmenuButtons) {
      if (btn.mesh && btn.mesh.parent) {
        btn.mesh.parent.remove(btn.mesh);
      }
    }
    drawSubmenuButtons = [];
  drawStartStopButton = null;
    
    // Restore main menu buttons with slight delay to prevent immediate re-triggering
    setTimeout(() => {
      for (const btn of buttons) {
        if (btn.mesh) btn.mesh.visible = true;
      }
      // Re-enable AR edit if drawing is not currently active
      try {
        if (window.arEdit && typeof window.arEdit.setEnabled === 'function') {
          // Check if vrDraw is available and active
          const drawActive = window.vrDraw && window.vrDraw.isActive && window.vrDraw.isActive();
          if (!drawActive) {
            window.arEdit.setEnabled(true);
            console.log('AR edit re-enabled after closing draw submenu (drawing inactive)');
          }
        }
      } catch(e) {
        console.warn('Failed to coordinate AR edit after draw submenu close:', e);
      }
    }, 50);
  }
  
  function arrangeSubmenuButtons() {
    // [11] Draw Submenu: Layout Grid ------------------------------------------------------------
  // Arrange submenu buttons in a 4x3+ grid; first row starts with Start/Stop
  const cols = 4;
    const buttonSpacing = BUTTON_W + GRID_GAP_X;
    const rowSpacing = BUTTON_H + GRID_GAP_Y;
    
    for (let i = 0; i < drawSubmenuButtons.length; i++) {
      const btn = drawSubmenuButtons[i];
      if (!btn.mesh) continue;
      
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      const x = (col - 1) * buttonSpacing; // Center around 0
      const y = (1 - row) * rowSpacing;    // Top to bottom
      
      btn.mesh.position.set(x, y, 0);
      if (hud) hud.add(btn.mesh);
    }
  }

  // Ensure draw submenu is properly initialized as hidden
  try {
    hideDrawSubmenu();
    console.log('XR HUD: Draw submenu state reset during initialization');
  } catch(e) {
    console.warn('XR HUD: Failed to reset draw submenu state:', e);
  }

  // Explicitly ensure VR draw mode is disabled during HUD initialization  
  try {
    if (window.vrDraw && window.vrDraw.setEnabled) {
      window.vrDraw.setEnabled(false);
      console.log('XR HUD: Explicitly disabled VR draw mode during initialization');
    }
  } catch {}

  return { 
    // [12] Public API Export --------------------------------------------------------------------
    ensure, 
    remove, 
    update, 
    setAnchor, 
    setHandVizStyle, 
    setGlobalClickCooldown, 
    createPrimitive3DButton, 
    createOBJ3DButton,
    createDraw3DButton, 
    createTile3DButton, 
    showDrawSubmenu,
    hideDrawSubmenu,
    get group(){ return hud; }, 
    get buttons(){ return buttons; }, 
    resetPressStates 
  };
}
