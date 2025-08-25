// Room Scan service: encapsulates AR hit-test rectangle approximation and manual fallback
// Public API: createRoomScanService(ctx) => { startRoomScan, startManualRoomScan, update, isActive }

export function createRoomScanService(ctx) {
  const {
    THREE,
    renderer,
    scene,
    camera,
    controls,
    raycaster,
    pointer,
    getPointer,
    intersectGround,
    addObjectToScene,
    material,
    grid,
    loadWebXRPolyfillIfNeeded, // optional; caller may still invoke before start
  } = ctx;

  // Internal state
  let scanActive = false;
  let scanSession = null;
  let scanViewerSpace = null;
  let scanLocalSpace = null;
  let scanHitTestSource = null;
  let scanGroup = null; // preview group in meters
  const scanExtents = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  // Depth sensing preview/accumulation (meters while scanning)
  let depthPointsPreview = null; // THREE.Points inside scanGroup
  let depthPointsAccum = []; // Array of THREE.Vector3 (meters)
  let depthSampleTick = 0;
  const MAX_DEPTH_POINTS = 15000;
  const SCAN_M_TO_FT = 3.28084;

  // Manual fallback state
  let manualScanActive = false;
  let manualScanPreview = null; // THREE.Group
  let manualScanStart = null; // THREE.Vector3
  const MANUAL_FLOOR_THICKNESS_FT = 0.2;

  function startManualRoomScan() {
    // HUD wiring
    const hud = document.getElementById('scanHud');
    const hudStatus = document.getElementById('scanHudStatus');
    const hudCancel = document.getElementById('scanHudCancel');
    if (hud) hud.style.display = 'block';
    if (hudStatus) hudStatus.textContent = 'Manual scan: drag to outline the room, release to finish.';
    const cancel = () => {
      manualScanActive = false;
      controls.enabled = true;
      if (hud) hud.style.display = 'none';
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      if (hudCancel) hudCancel.removeEventListener('click', cancel);
    };
    if (hudCancel) hudCancel.addEventListener('click', cancel);

    if (manualScanActive) return;
    manualScanActive = true;
    controls.enabled = false;
    // Build a preview group
    manualScanPreview = new THREE.Group();
    manualScanPreview.name = 'Room Scan Manual Preview';
    scene.add(manualScanPreview);
    try { console.info('Room Scan (manual): tap-drag to outline the floor; release to finish.'); } catch {}

    // Capture-phase handlers to avoid other tools
    function onDown(e) {
      if (!manualScanActive) return;
      e.preventDefault(); e.stopPropagation();
      getPointer(e); raycaster.setFromCamera(pointer, camera);
      const pt = intersectGround();
      if (!pt) return;
      manualScanStart = pt.clone();
    }
    function onMove(e) {
      if (!manualScanActive || !manualScanStart) return;
      e.preventDefault(); e.stopPropagation();
      getPointer(e); raycaster.setFromCamera(pointer, camera);
      const pt = intersectGround(); if (!pt) return;
      const minX = Math.min(manualScanStart.x, pt.x);
      const maxX = Math.max(manualScanStart.x, pt.x);
      const minZ = Math.min(manualScanStart.z, pt.z);
      const maxZ = Math.max(manualScanStart.z, pt.z);
      const w = Math.max(0.1, maxX - minX);
      const d = Math.max(0.1, maxZ - minZ);
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      // Rebuild preview
      manualScanPreview.clear();
      const floor = new THREE.Mesh(new THREE.BoxGeometry(w, MANUAL_FLOOR_THICKNESS_FT, d), new THREE.MeshBasicMaterial({ color: 0x00ff88, opacity: 0.25, transparent: true }));
      floor.position.set(cx, -MANUAL_FLOOR_THICKNESS_FT/2, cz);
      manualScanPreview.add(floor);
      const wallH = 2.4 * SCAN_M_TO_FT; // ~8 ft
      const t = 0.05; // preview wall thickness
      const y = wallH/2;
      const n = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); n.position.set(cx, y, maxZ); manualScanPreview.add(n);
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); s.position.set(cx, y, minZ); manualScanPreview.add(s);
      const eMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); eMesh.position.set(maxX, y, cz); manualScanPreview.add(eMesh);
      const wMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); wMesh.position.set(minX, y, cz); manualScanPreview.add(wMesh);
    }
    function onUp(e) {
      if (!manualScanActive || !manualScanStart) return;
      e.preventDefault(); e.stopPropagation();
      getPointer(e); raycaster.setFromCamera(pointer, camera);
      const pt = intersectGround(); if (!pt) return;
      const minX = Math.min(manualScanStart.x, pt.x);
      const maxX = Math.max(manualScanStart.x, pt.x);
      const minZ = Math.min(manualScanStart.z, pt.z);
      const maxZ = Math.max(manualScanStart.z, pt.z);
      // Create final floor and walls in feet, aligned to Y=0
      const w_ft = Math.max(0.2, maxX - minX);
      const d_ft = Math.max(0.2, maxZ - minZ);
      const cx_ft = (minX + maxX) / 2;
      const cz_ft = (minZ + maxZ) / 2;
      const h_ft = 8.0; // default wall height
      {
        const geo = new THREE.BoxGeometry(w_ft, MANUAL_FLOOR_THICKNESS_FT, d_ft);
        const mesh = new THREE.Mesh(geo, material.clone());
        mesh.position.set(cx_ft, -MANUAL_FLOOR_THICKNESS_FT/2, cz_ft);
        mesh.name = 'Scan Floor';
        addObjectToScene(mesh);
      }
      const t = 0.2;
      const y_ft = h_ft/2;
      { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, maxZ); mesh.name = 'Scan Wall N'; addObjectToScene(mesh); }
      { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, minZ); mesh.name = 'Scan Wall S'; addObjectToScene(mesh); }
      { const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set(maxX, y_ft, cz_ft); mesh.name = 'Scan Wall E'; addObjectToScene(mesh); }
      { const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set(minX, y_ft, cz_ft); mesh.name = 'Scan Wall W'; addObjectToScene(mesh); }
      // Cleanup
      if (manualScanPreview) { scene.remove(manualScanPreview); manualScanPreview = null; }
      manualScanStart = null;
      manualScanActive = false;
      controls.enabled = true;
      if (hud) hud.style.display = 'none';
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      if (hudCancel) hudCancel.removeEventListener('click', cancel);
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }

  async function startRoomScan() {
    // If insecure or on iOS (WebXR AR unavailable), use manual fallback
    const isSecure = window.isSecureContext || location.protocol === 'https:';
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (!isSecure || isIOS) { startManualRoomScan(); return; }
    try {
      const xr = navigator.xr; if (!xr) throw new Error('WebXR not available');
      const supported = await xr.isSessionSupported('immersive-ar');
      if (!supported) { startManualRoomScan(); return; }
      scanSession = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor', 'hit-test'],
        optionalFeatures: ['depth-sensing', 'plane-detection'],
        // Non-standard init dict for Chrome-based depth API (guarded at runtime)
        depthSensing: { preferredFormat: 'luminance-alpha', usagePreference: ['cpu-optimized'] }
      });
      renderer.xr.setSession(scanSession);
      scanActive = true;
      // Hide grid during scan
      if (grid) grid.visible = false;
      // Build preview group in meters
      scanGroup = new THREE.Group(); scanGroup.name = 'Room Scan Preview'; scene.add(scanGroup);
      // Reset extents
      scanExtents.minX = scanExtents.minZ = Infinity; scanExtents.maxX = scanExtents.maxZ = -Infinity;
      // Spaces + hit test
      scanViewerSpace = await scanSession.requestReferenceSpace('viewer');
      scanLocalSpace = await scanSession.requestReferenceSpace('local-floor');
      scanHitTestSource = await scanSession.requestHitTestSource({ space: scanViewerSpace });
      alert('Room Scan: move device to map the floor; tap once to finish.');
      const endScan = () => {
        if (!scanActive) return;
        scanActive = false;
        try { if (scanHitTestSource && scanHitTestSource.cancel) scanHitTestSource.cancel(); } catch {}
        scanHitTestSource = null; scanViewerSpace = null; scanLocalSpace = null;
        // Convert preview to scene objects in feet
        if (isFinite(scanExtents.minX) && isFinite(scanExtents.maxX) && isFinite(scanExtents.minZ) && isFinite(scanExtents.maxZ)) {
          const widthM = Math.max(0.2, scanExtents.maxX - scanExtents.minX);
          const depthM = Math.max(0.2, scanExtents.maxZ - scanExtents.minZ);
          const wallH_M = 2.4;
          // Floor
          {
            const thickness_ft = 0.2;
            const geo = new THREE.BoxGeometry(widthM * SCAN_M_TO_FT, thickness_ft, depthM * SCAN_M_TO_FT);
            const mesh = new THREE.Mesh(geo, material.clone());
            // Align the floor top surface to world Y=0 (level 0)
            const cx_ft = ((scanExtents.minX + scanExtents.maxX) / 2) * SCAN_M_TO_FT;
            const cz_ft = ((scanExtents.minZ + scanExtents.maxZ) / 2) * SCAN_M_TO_FT;
            mesh.position.set(cx_ft, -thickness_ft/2, cz_ft);
            mesh.name = 'Scan Floor';
            addObjectToScene(mesh);
          }
          // Walls (thin boxes along rectangle edges)
          const t = 0.2; // ~0.2 ft thickness
          const cx_ft = ((scanExtents.minX + scanExtents.maxX) / 2) * SCAN_M_TO_FT;
          const cz_ft = ((scanExtents.minZ + scanExtents.maxZ) / 2) * SCAN_M_TO_FT;
          const w_ft = (scanExtents.maxX - scanExtents.minX) * SCAN_M_TO_FT;
          const d_ft = (scanExtents.maxZ - scanExtents.minZ) * SCAN_M_TO_FT;
          const h_ft = wallH_M * SCAN_M_TO_FT;
          const y_ft = h_ft / 2;
          // North wall
          { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, (scanExtents.maxZ * SCAN_M_TO_FT)); mesh.name = 'Scan Wall N'; addObjectToScene(mesh); }
          // South wall
          { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w_ft, h_ft, t), material.clone()); mesh.position.set(cx_ft, y_ft, (scanExtents.minZ * SCAN_M_TO_FT)); mesh.name = 'Scan Wall S'; addObjectToScene(mesh); }
          // East wall
          { const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set((scanExtents.maxX * SCAN_M_TO_FT), y_ft, cz_ft); mesh.name = 'Scan Wall E'; addObjectToScene(mesh); }
          // West wall
          { const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, h_ft, d_ft), material.clone()); mesh.position.set((scanExtents.minX * SCAN_M_TO_FT), y_ft, cz_ft); mesh.name = 'Scan Wall W'; addObjectToScene(mesh); }
        }
        // If we accumulated any depth points, add a point cloud in feet
        if (depthPointsAccum && depthPointsAccum.length) {
          const count = Math.min(depthPointsAccum.length, MAX_DEPTH_POINTS);
          const positions = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            const p = depthPointsAccum[i];
            positions[i*3+0] = p.x * SCAN_M_TO_FT;
            positions[i*3+1] = p.y * SCAN_M_TO_FT;
            positions[i*3+2] = p.z * SCAN_M_TO_FT;
          }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x55ccff, size: 0.05 }));
          pts.name = 'Scan Point Cloud';
          addObjectToScene(pts);
        }
        // Cleanup preview
        if (scanGroup) { scene.remove(scanGroup); scanGroup = null; }
        depthPointsPreview = null; depthPointsAccum = []; depthSampleTick = 0;
        // Show grid again
        if (grid) grid.visible = true;
        // End session if still running
        try { const s = renderer.xr.getSession && renderer.xr.getSession(); if (s) s.end(); } catch {}
      };
      scanSession.addEventListener('end', endScan);
      scanSession.addEventListener('select', endScan);
    } catch (e) { alert('Failed to start Room Scan: ' + (e?.message || e)); console.error(e); }
  }

  function update(frame) {
    if (!scanActive) return;
    // Accumulate floor hit-test points and update preview
    const session = renderer.xr.getSession && renderer.xr.getSession();
    if (session && scanHitTestSource && frame && scanLocalSpace) {
      const results = frame.getHitTestResults(scanHitTestSource);
      if (results && results.length) {
        const pose = results[0].getPose(scanLocalSpace);
        if (pose) {
          const px = pose.transform.position.x; const pz = pose.transform.position.z;
          scanExtents.minX = Math.min(scanExtents.minX, px);
          scanExtents.maxX = Math.max(scanExtents.maxX, px);
          scanExtents.minZ = Math.min(scanExtents.minZ, pz);
          scanExtents.maxZ = Math.max(scanExtents.maxZ, pz);
          // Update preview geometry
          if (isFinite(scanExtents.minX) && isFinite(scanExtents.maxX) && isFinite(scanExtents.minZ) && isFinite(scanExtents.maxZ)) {
            const w = Math.max(0.1, scanExtents.maxX - scanExtents.minX);
            const d = Math.max(0.1, scanExtents.maxZ - scanExtents.minZ);
            const cx = (scanExtents.minX + scanExtents.maxX) / 2;
            const cz = (scanExtents.minZ + scanExtents.maxZ) / 2;
            // Clear and rebuild simple preview (thin floor + low outline walls)
            if (scanGroup) {
              scanGroup.clear();
              const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), new THREE.MeshBasicMaterial({ color: 0x00ff88, opacity: 0.25, transparent: true }));
              floor.position.set(cx, 0.01, cz);
              scanGroup.add(floor);
              const wallH = 0.5; const t = 0.02; // low preview walls
              const n = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); n.position.set(cx, wallH/2, scanExtents.maxZ); scanGroup.add(n);
              const s = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, t), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); s.position.set(cx, wallH/2, scanExtents.minZ); scanGroup.add(s);
              const e = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); e.position.set(scanExtents.maxX, wallH/2, cz); scanGroup.add(e);
              const wMesh = new THREE.Mesh(new THREE.BoxGeometry(t, wallH, d), new THREE.MeshBasicMaterial({ color: 0x00aaff, opacity: 0.25, transparent: true })); wMesh.position.set(scanExtents.minX, wallH/2, cz); scanGroup.add(wMesh);
            }
          }
        }
      }
      // Sample WebXR depth information if available (Chrome/Android). Guard everything.
      try {
        const xrCam = renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : null;
        const dm = frame && frame.getDepthInformation && xrCam ? frame.getDepthInformation(xrCam) : null;
        if (dm) {
          if ((depthSampleTick++ % 3) === 0 && depthPointsAccum.length < MAX_DEPTH_POINTS) {
            const width = dm.width, height = dm.height;
            const stepX = Math.max(1, Math.floor(width / 64));
            const stepY = Math.max(1, Math.floor(height / 64));
            for (let y = 0; y < height && depthPointsAccum.length < MAX_DEPTH_POINTS; y += stepY) {
              for (let x = 0; x < width && depthPointsAccum.length < MAX_DEPTH_POINTS; x += stepX) {
                const z = dm.getDepth(x, y);
                if (!isFinite(z) || z <= 0) continue;
                // Project ray from camera through NDC, place a point at depth z (meters)
                const ndcX = (x / width) * 2 - 1;
                const ndcY = (y / height) * -2 + 1;
                const ndc = new THREE.Vector3(ndcX, ndcY, 1);
                ndc.unproject(camera);
                const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
                const dir = ndc.sub(camPos).normalize();
                const pWorld = camPos.clone().addScaledVector(dir, z);
                depthPointsAccum.push(pWorld);
              }
            }
            // Live point cloud preview (meters)
            if (scanGroup) {
              if (!depthPointsPreview) {
                depthPointsPreview = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x55ccff, size: 0.01 }));
                scanGroup.add(depthPointsPreview);
              }
              const n = Math.min(depthPointsAccum.length, MAX_DEPTH_POINTS);
              const arr = new Float32Array(n * 3);
              for (let i = 0; i < n; i++) { const p = depthPointsAccum[i]; arr[i*3] = p.x; arr[i*3+1] = p.y; arr[i*3+2] = p.z; }
              depthPointsPreview.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
              depthPointsPreview.geometry.computeBoundingSphere();
            }
          }
        }
      } catch {}
    }
  }

  return {
    startRoomScan,
    startManualRoomScan,
    update,
    isActive: () => scanActive,
  };
}
