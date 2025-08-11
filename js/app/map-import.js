// Map Import module: Leaflet modal, draw-box selection, imagery, and elevation anchoring
// Public API: setupMapImport({ THREE, renderer, fallbackMaterial, addObjectToScene, elements })

export function setupMapImport({ THREE, renderer, fallbackMaterial, addObjectToScene, elements }){
  const {
    backdrop,
    container,
    searchInput,
    searchBtn,
    closeBtn,
    useFlatBtn,
    useTopoBtn,
    drawToggleBtn,
    importBtn,
  } = elements;

  let leafletMap = null;
  let drawnBounds = null;
  let isDrawing = false;
  let drawStartLatLng = null;
  let selectionRect = null;
  let leafletHandlersAttached = false;

  async function ensureLeafletLoaded(){
    if (window.L && typeof window.L.map === 'function') return;
    await new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.onload = resolve; link.onerror = resolve; document.head.appendChild(link);
    });
    await new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = resolve; s.onerror = () => reject(new Error('Failed to load Leaflet')); document.head.appendChild(s);
    });
  }

  function show(){ backdrop.style.display = 'flex'; setTimeout(()=>{ if(leafletMap) leafletMap.invalidateSize(); }, 0); }
  function hide(){ backdrop.style.display = 'none'; }

  async function open(){
    try{
      await ensureLeafletLoaded();
      if (!leafletMap){
        leafletMap = L.map(container, { zoomControl: true }).setView([37.7749, -122.4194], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(leafletMap);
        if (!leafletHandlersAttached){
          leafletMap.on('mousedown', e => {
            if (!isDrawing) return;
            drawStartLatLng = e.latlng; if (selectionRect){ leafletMap.removeLayer(selectionRect); selectionRect = null; }
            leafletMap.dragging.disable();
          });
          leafletMap.on('mousemove', e => {
            if (!isDrawing || !drawStartLatLng) return;
            const sw = L.latLng(Math.min(drawStartLatLng.lat, e.latlng.lat), Math.min(drawStartLatLng.lng, e.latlng.lng));
            const ne = L.latLng(Math.max(drawStartLatLng.lat, e.latlng.lat), Math.max(drawStartLatLng.lng, e.latlng.lng));
            const b = L.latLngBounds(sw, ne);
            if (selectionRect) selectionRect.setBounds(b); else selectionRect = L.rectangle(b, { color:'#0078ff', weight:2, fillOpacity:0.08, interactive:false }).addTo(leafletMap);
          });
          leafletMap.on('mouseup', e => {
            if (!isDrawing || !drawStartLatLng) return;
            leafletMap.dragging.enable();
            const sw = L.latLng(Math.min(drawStartLatLng.lat, e.latlng.lat), Math.min(drawStartLatLng.lng, e.latlng.lng));
            const ne = L.latLng(Math.max(drawStartLatLng.lat, e.latlng.lat), Math.max(drawStartLatLng.lng, e.latlng.lng));
            const b = L.latLngBounds(sw, ne);
            drawnBounds = b; drawStartLatLng = null; isDrawing = false;
            drawToggleBtn?.setAttribute('aria-pressed','false');
            leafletMap.getContainer().classList.remove('crosshair');
          });
          leafletHandlersAttached = true;
        }
        if (navigator.geolocation){
          navigator.geolocation.getCurrentPosition(pos => {
            leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 13);
          });
        }
      }
      show();
    }catch(e){
      alert('Failed to open map: ' + (e?.message || e));
    }
  }

  function metersPerDegree(lat){
    const latRad = lat * Math.PI/180;
    const metersLat = 111132.92 - 559.82*Math.cos(2*latRad) + 1.175*Math.cos(4*latRad);
    const metersLon = 111412.84*Math.cos(latRad) - 93.5*Math.cos(3*latRad);
    return { metersLat, metersLon };
  }

  async function fetchWorldImageryTexture(bounds, pixelWidth=2048, pixelHeight=2048){
    const z = 16;
    function lngLatToTile(lng, lat, zoom){
      const latRad = lat*Math.PI/180;
      const n = 2**zoom;
      const x = Math.floor((lng + 180) / 360 * n);
      const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * n);
      return {x,y};
    }
    const sw = bounds.getSouthWest(); const ne = bounds.getNorthEast();
    const tSW = lngLatToTile(sw.lng, sw.lat, z); const tNE = lngLatToTile(ne.lng, ne.lat, z);
    const minX = Math.min(tSW.x, tNE.x), maxX = Math.max(tSW.x, tNE.x);
    const minY = Math.min(tNE.y, tSW.y), maxY = Math.max(tNE.y, tSW.y);
    const tileSize = 256;
    const cols = (maxX - minX + 1), rows = (maxY - minY + 1);
    const canvas = document.createElement('canvas'); canvas.width = cols*tileSize; canvas.height = rows*tileSize;
    const ctx = canvas.getContext('2d');
    const promises = [];
    for (let y=minY; y<=maxY; y++){
      for (let x=minX; x<=maxX; x++){
        const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
        const img = new Image(); img.crossOrigin = 'anonymous';
        const px = (x-minX)*tileSize, py = (y-minY)*tileSize;
        promises.push(new Promise(resolve=>{ img.onload=()=>{ctx.drawImage(img,px,py,tileSize,tileSize); resolve();}; img.onerror=()=>resolve(); }));
        img.src = url;
      }
    }
    await Promise.all(promises);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight){
      const out = document.createElement('canvas'); out.width=pixelWidth; out.height=pixelHeight; out.getContext('2d').drawImage(canvas,0,0,out.width,out.height); return out;
    }
    return canvas;
  }

  async function createFlatFromBounds(bounds){
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    const lat0 = (south + north)/2;
    const { metersLat, metersLon } = metersPerDegree(lat0);
    const widthMeters = Math.max(1, (east - west) * metersLon);
    const heightMeters = Math.max(1, (north - south) * metersLat);
    const m2ft = 3.28084;
    const widthFeet = widthMeters * m2ft;
    const heightFeet = heightMeters * m2ft;
    // Query elevation at center
    const centerLat = (south+north)/2, centerLon = (west+east)/2;
    let centerElevationFt = 0;
    try{
      const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${centerLat.toFixed(6)},${centerLon.toFixed(6)}`);
      if(res.ok){ const data = await res.json(); if (data.results && data.results[0]) centerElevationFt = data.results[0].elevation * m2ft; }
    }catch{}
    try{
      const texCanvas = await fetchWorldImageryTexture(bounds);
      const texture = new THREE.CanvasTexture(texCanvas);
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.()||1);
      const imgMat = new THREE.MeshStandardMaterial({ map: texture, metalness:0, roughness:1 });
      const plane = new THREE.PlaneGeometry(widthFeet, heightFeet); plane.rotateX(-Math.PI/2);
      const floor = new THREE.Mesh(plane, imgMat);
      floor.position.set(0, -centerElevationFt + 0.001, 0);
      floor.name = 'Map Floor';
      addObjectToScene(floor, { select: true });
      return;
    }catch{}
    const thickness = 0.333;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(widthFeet, thickness, heightFeet), fallbackMaterial.clone());
    floor.position.set(0, -centerElevationFt + thickness/2, 0); floor.name='Map Floor';
    addObjectToScene(floor, { select: true });
  }

  async function createTopoFromBounds(bounds){
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    const lat0 = (south + north)/2; const { metersLat, metersLon } = metersPerDegree(lat0);
    const widthMeters = Math.max(1, (east - west) * metersLon);
    const heightMeters = Math.max(1, (north - south) * metersLat);
    const m2ft = 3.28084; const widthFeet = widthMeters * m2ft; const heightFeet = heightMeters * m2ft;
    const centerLat = (south+north)/2, centerLon = (west+east)/2;
    let centerElevationFt = 0;
    try{
      const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${centerLat.toFixed(6)},${centerLon.toFixed(6)}`);
      if(res.ok){ const data = await res.json(); if (data.results && data.results[0]) centerElevationFt = data.results[0].elevation * m2ft; }
    }catch{}
    const segX = 16, segY = 16;
    const samples = [];
    for (let j=0;j<=segY;j++){
      const lat = north - ((north - south)*(j/segY));
      for (let i=0;i<=segX;i++){
        const lon = west + ((east - west)*(i/segX));
        samples.push({ lat, lon });
      }
    }
    async function fetchElevations(points){
      const chunkSize = 90; const results = [];
      for (let k=0;k<points.length;k+=chunkSize){
        const chunk = points.slice(k, k+chunkSize);
        const qs = chunk.map(p=>`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
        const url = `https://api.open-elevation.com/api/v1/lookup?locations=${qs}`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error('Open-Elevation error');
  const data = await resp.json();
        data.results.forEach(r=> results.push(r.elevation));
      }
      return results;
    }
    let elevationsM = [];
    try { elevationsM = await fetchElevations(samples); }
    catch(e){ alert('Failed to fetch topography: '+(e?.message||e)); return; }
    const toFeet = m=>m*3.28084;
    const geom = new THREE.PlaneGeometry(widthFeet, heightFeet, segX, segY); geom.rotateX(-Math.PI/2);
    const pos = geom.attributes.position;
    const centerIdx = Math.floor((segY/2)+0.5)*(segX+1) + Math.floor((segX/2)+0.5);
    const centerElevFt2 = toFeet(elevationsM[centerIdx] ?? elevationsM[0] ?? 0);
    for (let idx=0; idx<elevationsM.length; idx++) pos.setY(idx, toFeet(elevationsM[idx]) - centerElevFt2);
    pos.needsUpdate = true; geom.computeVertexNormals();
    let topoMat;
    try{
      const texCanvas = await fetchWorldImageryTexture(bounds);
      const texture = new THREE.CanvasTexture(texCanvas);
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.()||1);
      topoMat = new THREE.MeshStandardMaterial({ map: texture, metalness:0, roughness:1, side:THREE.DoubleSide });
    }catch{
      topoMat = new THREE.MeshStandardMaterial({ color: 0xbbbcae, metalness:0, roughness:0.95, side:THREE.DoubleSide });
    }
    const topo = new THREE.Mesh(geom, topoMat); topo.receiveShadow = true; topo.castShadow = false; topo.name='Topography';
    addObjectToScene(topo, { select: true });
  }

  function activeBounds(){
    if (drawnBounds) return drawnBounds;
    if (leafletMap) return leafletMap.getBounds();
    return null;
  }

  // Wire UI events
  importBtn && importBtn.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', hide);
  backdrop && backdrop.addEventListener('click', (e)=>{ if (e.target===backdrop) hide(); });
  searchBtn && searchBtn.addEventListener('click', async ()=>{
    try{
      const q = searchInput.value.trim(); if(!q||!leafletMap) return;
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
      const data = await res.json(); if (data && data[0]) leafletMap.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 14);
    }catch{}
  });
  drawToggleBtn && drawToggleBtn.addEventListener('click', ()=>{
    if (!leafletMap) return;
    isDrawing = !isDrawing;
    drawToggleBtn.setAttribute('aria-pressed', String(isDrawing));
    if (isDrawing){
      drawnBounds = null; if (selectionRect){ leafletMap.removeLayer(selectionRect); selectionRect = null; }
      leafletMap.getContainer().classList.add('crosshair');
    } else {
      leafletMap.getContainer().classList.remove('crosshair');
    }
  });
  useFlatBtn && useFlatBtn.addEventListener('click', async ()=>{ const b = activeBounds(); if(b){ await createFlatFromBounds(b); hide(); } });
  useTopoBtn && useTopoBtn.addEventListener('click', async ()=>{ const b = activeBounds(); if(b){ await createTopoFromBounds(b); hide(); } });

  return { open };
}
