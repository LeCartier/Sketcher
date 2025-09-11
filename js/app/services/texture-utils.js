// Texture and Material System utilities. MIT License.

// Resize overlarge textures at runtime to reduce memory
export async function downscaleLargeTextures(root, opts = {}){
    const { maxSize = 2048, onProgress } = opts;
    const textures = new Set();
    root.traverse(o=>{
        if (o.isMesh && o.material){
            const mats = Array.isArray(o.material)?o.material:[o.material];
            for (const m of mats){
                if (!m) continue;
                for (const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
                    const tex = m[k]; if (tex && tex.image && tex.image.width && tex.image.height) textures.add(tex);
                }
            }
        }
    });
    const list = Array.from(textures);
    const total = list.length || 1; let i = 0;
    for (const tex of list){
        try {
            const img = tex.image; if (!img) continue;
            const w = img.width, h = img.height;
            const maxDim = Math.max(w,h);
            if (maxDim <= maxSize) { i++; if (onProgress) onProgress(i/total); continue; }
            const scale = maxSize / maxDim; const nw = Math.max(1, Math.floor(w*scale)); const nh = Math.max(1, Math.floor(h*scale));
            const canvas = document.createElement('canvas'); canvas.width = nw; canvas.height = nh;
            const ctx = canvas.getContext('2d');
            // Disable image smoothing for speed; acceptable for most PBR maps
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
            ctx.drawImage(img, 0, 0, nw, nh);
            const newImg = new Image();
            await new Promise(res=>{ newImg.onload = ()=>res(); newImg.src = canvas.toDataURL('image/png'); });
            tex.image = newImg; tex.needsUpdate = true;
        } catch(e){ console.warn('Texture downscale failed', e); }
        i++; if (onProgress) onProgress(i/total);
    }
}

// Create Material System with dependency injection
export function createMaterialSystem({ THREE, renderer, scene, forEachMeshInScene, originalMaterials, setGridColor, defaultMaterial, uiElements = {} }) {
    // Material caches (shared instances)
    let __cardboardMat = null; // final shared material (photo if available, else procedural)
    let __mdfMat = null;       // final shared material (photo if available, else procedural)
    let __sketchMat = null;    // shared sketch material (procedural only)
    let __toonMat = null;      // shared toon material (procedural only)

    // Sketch style environment overrides and temps
    let __sketchPrevBg = null;           // string like '#rrggbb'
    let __sketchPrevGrid = null;         // string like '#rrggbb'
    let __sketchOverrideActive = false;  // whether overrides are active
    // Track attached sketch outline nodes so we can remove/dispose on exit
    const __sketchOutlineNodes = new Set();
    // Feature flag: outlines enabled for a clean, crisp sketch look
    const SKETCH_OUTLINES_ENABLED = true;

    // Material style orchestration
    let currentMaterialStyle = 'original';
    let __materialLoadPromise = null;
    let __sketchOutlines = null; // THREE.Group of outlines

    // Procedural fallback textures (lightweight, immediate)
    function makeNoiseCanvas(w=256,h=256,opts={}){
        const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
        ctx.fillStyle=opts.base||'#c9a46a'; ctx.fillRect(0,0,w,h);
        const grains=opts.grains||800; const alpha=opts.alpha||0.06; const size=opts.size||1.2; const hueJitter=opts.hueJitter||0;
        for(let i=0;i<grains;i++){
            const x=Math.random()*w, y=Math.random()*h; const s=(Math.random()*size)+0.4; const a=alpha*Math.random();
            ctx.fillStyle=`rgba(0,0,0,${a.toFixed(3)})`; ctx.fillRect(x,y,s,s);
            if (hueJitter>0){ ctx.fillStyle=`rgba(255,255,255,${(a*0.5).toFixed(3)})`; ctx.fillRect(x+0.5,y+0.5,s*0.7,s*0.7); }
        }
        // Subtle vertical stripes for corrugation hint
        if (opts.stripes){
            ctx.globalAlpha = 0.05; ctx.fillStyle = '#000';
            const period = opts.period || 18;
            for(let x=0;x<w;x+=period){ ctx.fillRect(x,0,1,h); }
            ctx.globalAlpha = 1;
        }
        return c;
    }

    function makeCardboardMaterialProcedural(){
        const texCanvas = makeNoiseCanvas(512,512,{ base:'#c9a46a', grains:1400, alpha:0.08, size:1.4, hueJitter:0.2, stripes:true, period:22 });
        const tex = new THREE.CanvasTexture(texCanvas);
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1.5,1.5);
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    }

    function makeMDFMaterialProcedural(){
        const texCanvas = makeNoiseCanvas(512,512,{ base:'#b8aa8f', grains:1200, alpha:0.06, size:1.2, hueJitter:0.15, stripes:false });
        const tex = new THREE.CanvasTexture(texCanvas);
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1.8,1.8);
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
    }

    function makeSketchMaterialProcedural(){
        // White toon material, front faces only
        const mat = new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.FrontSide });
        try { mat.userData = { ...(mat.userData||{}), procedural: true, base: 'sketch' }; } catch {}
        return mat;
    }

    function makeToonMaterialProcedural(){
        // Neutral mid-gray toon with subtle warm gradient ramp (via simple color + high light contrast managed by lighting)
        const mat = new THREE.MeshToonMaterial({ color: 0xb0b0b0, side: THREE.FrontSide });
        try { mat.userData = { ...(mat.userData||{}), procedural: true, base: 'toon' }; } catch {}
        return mat;
    }

    function ensureOriginalMaterial(mesh){ if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material); }

    function restoreOriginalMaterials(){ forEachMeshInScene(m=>{ const orig = originalMaterials.get(m); if (orig) m.material = orig; }); }

    function __isMaterialOverrideChain(node){
        // Skip global overrides when any ancestor explicitly preserves materials
        let n = node;
        while (n) {
            if (n.userData) {
                if (n.userData.__materialOverride === true) return true;
                if (n.userData.__preserveMaterials === true) return true;
            }
            n = n.parent;
        }
        return false;
    }

    function applyUniformMaterial(sharedMat){ forEachMeshInScene(m=>{ if (__isMaterialOverrideChain(m)) return; ensureOriginalMaterial(m); m.material = sharedMat; }); }
    function restoreOriginalMaterialsRespectingOverrides(){ forEachMeshInScene(m=>{ if (__isMaterialOverrideChain(m)) return; const orig = originalMaterials.get(m); if (orig) m.material = orig; }); }

    function applyStyleToSubtree(root, style){
        const stack = [root];
        const use = (s)=> getActiveSharedMaterial(s) || getProceduralSharedMaterial(s) || defaultMaterial;
        while (stack.length){
            const o = stack.pop();
            if (!o) continue;
            if (o.isMesh){
                ensureOriginalMaterial(o);
                if (style === 'original') o.material = defaultMaterial; else o.material = use(style);
            }
            if (o.children && o.children.length) stack.push(...o.children);
        }
    }

    // Loader helpers for photoreal textures (optional assets)
    const __textureLoader = new THREE.TextureLoader();
    function setTexCommon(tex, { sRGB=false, repeat=1.5 }={}){
        try { if (sRGB && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; } catch {}
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat);
        tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8);
        tex.needsUpdate = true; return tex;
    }

    async function loadTextureAny(urls, opts){
        for (const u of urls){
            try { const tex = await __textureLoader.loadAsync(u); return setTexCommon(tex, opts); } catch (e) { /* try next */ }
        }
        return null;
    }

    async function buildPhotoMaterial(kind){
        const base = `./assets/textures/`;
        if (kind === 'cardboard'){
            const map = await loadTextureAny([base+'cardboard_basecolor.jpg', base+'cardboard_basecolor.png'], { sRGB:true, repeat:1.6 });
            if (!map) return makeCardboardMaterialProcedural();
            const normalMap = await loadTextureAny([base+'cardboard_normal.jpg', base+'cardboard_normal.png']);
            const roughnessMap = await loadTextureAny([base+'cardboard_roughness.jpg', base+'cardboard_roughness.png']);
            const mat = new THREE.MeshStandardMaterial({ map, normalMap: normalMap||undefined, roughnessMap: roughnessMap||undefined, roughness: roughnessMap?1.0:0.9, metalness: 0.0, side: THREE.DoubleSide });
            if (normalMap) mat.normalScale = new THREE.Vector2(0.6, 0.6);
            return mat;
        }
        if (kind === 'mdf'){
            const map = await loadTextureAny([base+'mdf_basecolor.jpg', base+'mdf_basecolor.png'], { sRGB:true, repeat:1.8 });
            if (!map) return makeMDFMaterialProcedural();
            const normalMap = await loadTextureAny([base+'mdf_normal.jpg', base+'mdf_normal.png']);
            const roughnessMap = await loadTextureAny([base+'mdf_roughness.jpg', base+'mdf_roughness.png']);
            const mat = new THREE.MeshStandardMaterial({ map, normalMap: normalMap||undefined, roughnessMap: roughnessMap||undefined, roughness: roughnessMap?1.0:0.85, metalness: 0.0, side: THREE.DoubleSide });
            if (normalMap) mat.normalScale = new THREE.Vector2(0.35, 0.35);
            return mat;
        }
        return null;
    }

    function getRendererClearColorHex(){
        const c = new THREE.Color();
        try { renderer.getClearColor(c); } catch {}
        return `#${c.getHexString()}`;
    }

    function applySketchOverrides(){
        if (__sketchOverrideActive) return;
        __sketchPrevBg = getRendererClearColorHex();
        try {
            __sketchPrevGrid = (uiElements.gridColorPicker && uiElements.gridColorPicker.value) || localStorage.getItem('sketcher.gridColor') || '#ffffff';
        } catch { __sketchPrevGrid = '#ffffff'; }
        // Override display without touching persisted prefs
        try { if (uiElements.bgColorPicker) uiElements.bgColorPicker.disabled = true; } catch {}
        try { if (uiElements.gridColorPicker) uiElements.gridColorPicker.disabled = true; } catch {}
        renderer.setClearColor('#ffffff');
        // Lighter grid for less visual noise in sketch mode
        setGridColor('#d0d0d0');
        __sketchOverrideActive = true;
    }

    function restoreSketchOverridesIfAny(){
        if (!__sketchOverrideActive) return;
        if (__sketchPrevBg) renderer.setClearColor(__sketchPrevBg);
        if (__sketchPrevGrid) setGridColor(__sketchPrevGrid);
        try { if (uiElements.bgColorPicker) uiElements.bgColorPicker.disabled = false; } catch {}
        try { if (uiElements.gridColorPicker) uiElements.gridColorPicker.disabled = false; } catch {}
        __sketchPrevBg = null; __sketchPrevGrid = null; __sketchOverrideActive = false;
    }

    function disposeSketchOutlines(){
        if(__sketchOutlines){
            try { scene.remove(__sketchOutlines); } catch {}
            __sketchOutlines.traverse(o=>{ try { o.geometry && o.geometry.dispose && o.geometry.dispose(); } catch {} try { o.material && o.material.dispose && o.material.dispose(); } catch {} });
            __sketchOutlines = null;
        }
        // Also remove attached nodes from meshes
        __sketchOutlineNodes.forEach(node => {
            try {
                if (node.parent) node.parent.remove(node);
                node.traverse(o=>{ try { o.geometry && o.geometry.dispose && o.geometry.dispose(); } catch {} try { o.material && o.material.dispose && o.material.dispose(); } catch {} });
            } catch {}
        });
        __sketchOutlineNodes.clear();
    }

    function makeSketchLinesForMesh(m){
        const srcGeo = m.geometry; if (!srcGeo) return null;
        // Build crisp feature/silhouette edges with a moderate threshold to reduce clutter
        const threshold = 30; // degrees
        const egeo = new THREE.EdgesGeometry(srcGeo, threshold);
        if (!egeo || !egeo.attributes || !egeo.attributes.position || egeo.attributes.position.count === 0) return null;
        const grp = new THREE.Group();
        const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: false, opacity: 1.0, depthTest: true, depthWrite: false });
        const lines = new THREE.LineSegments(egeo, mat);
        // Slightly bias ordering so lines appear atop their surfaces when depths are equal
        lines.renderOrder = 2;
        grp.add(lines);
        // Mark as helper/non-selectable and disable raycasting so it can't be picked or moved
        grp.name = '__sketchOutline'; grp.userData.__helper = true; lines.userData.__helper = true;
        grp.raycast = function(){}; lines.raycast = function(){};
        // Attach in mesh-local space so it follows transforms automatically
        grp.position.set(0,0,0); grp.rotation.set(0,0,0); grp.scale.set(1,1,1);
        return grp;
    }

    function getActiveSharedMaterial(style){
        if (style === 'cardboard') return __cardboardMat || null;
        if (style === 'mdf') return __mdfMat || null;
        if (style === 'sketch') return __sketchMat || null;
        if (style === 'toon') return __toonMat || null;
        return null;
    }

    function getProceduralSharedMaterial(style){
        if (style === 'cardboard') {
            if (!__cardboardMat) { __cardboardMat = makeCardboardMaterialProcedural(); try { __cardboardMat.userData = { ...( __cardboardMat.userData||{} ), procedural: true }; } catch {} }
            return __cardboardMat;
        }
        if (style === 'mdf') {
            if (!__mdfMat) { __mdfMat = makeMDFMaterialProcedural(); try { __mdfMat.userData = { ...( __mdfMat.userData||{} ), procedural: true }; } catch {} }
            return __mdfMat;
        }
        if (style === 'sketch') {
            if (!__sketchMat) { __sketchMat = makeSketchMaterialProcedural(); try { __sketchMat.userData = { ...( __sketchMat.userData||{} ), procedural: true }; } catch {} }
            return __sketchMat;
        }
        if (style === 'toon') {
            if (!__toonMat) { __toonMat = makeToonMaterialProcedural(); try { __toonMat.userData = { ...( __toonMat.userData||{} ), procedural: true }; } catch {} }
            return __toonMat;
        }
        return null;
    }

    function setMaterialButtons(style){
        if (uiElements.matOriginalBtn) uiElements.matOriginalBtn.setAttribute('aria-pressed', style==='original'?'true':'false');
        if (uiElements.matCardboardBtn) uiElements.matCardboardBtn.setAttribute('aria-pressed', style==='cardboard'?'true':'false');
        if (uiElements.matMdfBtn) uiElements.matMdfBtn.setAttribute('aria-pressed', style==='mdf'?'true':'false');
        const matSketchBtn = document.getElementById('matSketch'); if (matSketchBtn) matSketchBtn.setAttribute('aria-pressed', style==='sketch'?'true':'false');
        const matToonBtn = document.getElementById('matToon'); if (matToonBtn) matToonBtn.setAttribute('aria-pressed', style==='toon'?'true':'false');
    }

    function applyMaterialStyle(style){
        style = style || 'original';
        currentMaterialStyle = style;
        // Persist selection
        try { localStorage.setItem('sketcher.materialStyle', style); } catch {}
        // Handle environment overrides toggling
        if (style !== 'sketch') restoreSketchOverridesIfAny();
        // Immediate path
        if (style === 'original') {
            // Apply a shared MeshNormalMaterial to the whole scene
            applyUniformMaterial(defaultMaterial);
            disposeSketchOutlines();
            setMaterialButtons(style);
            return;
        }
        // Apply procedural immediately, then upgrade to photo when ready
        const proc = getProceduralSharedMaterial(style);
        applyUniformMaterial(proc);
        setMaterialButtons(style);
        // Sketch style specifics: overrides; outlines intentionally disabled for clean look
        if (style === 'sketch'){
            applySketchOverrides();
            disposeSketchOutlines();
            // If outlines are re-enabled in the future, guard with flag
            if (SKETCH_OUTLINES_ENABLED) {
                forEachMeshInScene(m => {
                    // Do not add outlines to preserved/override subtrees (e.g., overlay snips)
                    if (__isMaterialOverrideChain(m)) return;
                    const lines = makeSketchLinesForMesh(m);
                    if (lines) { try { m.add(lines); __sketchOutlineNodes.add(lines); } catch {} }
                });
            }
        } else if (style === 'toon') {
            // Toon: ensure sketch overrides are removed (white bg might be optional)
            restoreSketchOverridesIfAny();
            disposeSketchOutlines();
        } else {
            disposeSketchOutlines();
        }
        // On narrow/mobile, skip photoreal upgrade to keep it light
        const isMobileNarrow = Math.min(window.innerWidth, window.innerHeight) <= 640;
        if (isMobileNarrow) return;
        // Kick off async load (debounced to one in-flight per style)
        const need = (style === 'cardboard' && (!__cardboardMat || __cardboardMat.userData?.procedural))
                 || (style === 'mdf' && (!__mdfMat || __mdfMat.userData?.procedural)); // no photo upgrade for sketch or toon
        if (!need) return;
        __materialLoadPromise = (async () => {
            const mat = await buildPhotoMaterial(style);
            if (mat && !mat.map) { try { mat.userData = { ...(mat.userData||{}), procedural: true }; } catch {} }
            if (style === 'cardboard') __cardboardMat = mat;
            if (style === 'mdf') __mdfMat = mat;
            if (currentMaterialStyle === style && mat) applyUniformMaterial(mat);
        })();
    }

    // Initialize selected material style from storage and expose public API
    function initializeMaterialSystem() {
        let saved = 'original';
        try { const s = localStorage.getItem('sketcher.materialStyle'); if (s) saved = s; } catch {}
        applyMaterialStyle(saved);
        setMaterialButtons(saved);
        // Public, stable API for other modules (UI wiring, etc.)
        try {
            window.sketcherMaterialsAPI = {
                applyMaterialStyle,
                getActiveSharedMaterial,
                getProceduralSharedMaterial,
                getCurrentStyle: () => currentMaterialStyle,
                setMaterialButtons,
            };
            // Signal readiness for late-loading UI modules
            document.dispatchEvent(new CustomEvent('sketcher:materials-ready'));
        } catch {}
    }

    // --- Face material overlay system (for texture editor) ---
    let __lastPickedFace = null; // { mesh, faceIndex }
    let __lastFacePreview = null; // temporary highlight overlay

    function __disposeFacePreview(){
        if (!__lastFacePreview) return;
        try { __lastFacePreview.parent && __lastFacePreview.parent.remove(__lastFacePreview); } catch {}
        try {
            __lastFacePreview.geometry && __lastFacePreview.geometry.dispose && __lastFacePreview.geometry.dispose();
            const mm = __lastFacePreview.material;
            if (Array.isArray(mm)) mm.forEach(m=>m && m.dispose && m.dispose()); else mm && mm.dispose && mm.dispose();
        } catch {}
        __lastFacePreview = null;
    }

    function __makeFaceOverlayMesh(mesh, faceIndex, material){
        try {
            const geom = mesh.geometry; if (!geom || !geom.isBufferGeometry) return null;
            const pos = geom.getAttribute('position'); if (!pos) return null;
            const idxAttr = geom.getIndex();
            let ia, ib, ic;
            if (idxAttr) { const a = idxAttr.getX(faceIndex*3+0), b = idxAttr.getX(faceIndex*3+1), c = idxAttr.getX(faceIndex*3+2); ia=a; ib=b; ic=c; }
            else { ia = faceIndex*3+0; ib = faceIndex*3+1; ic = faceIndex*3+2; if (ic >= pos.count) return null; }
            const pA = new THREE.Vector3(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
            const pB = new THREE.Vector3(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
            const pC = new THREE.Vector3(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
            const uvs = geom.getAttribute('uv');
            let uvArr = null;
            if (uvs) {
                uvArr = new Float32Array(6);
                const uA = uvs.getX(ia), vA = uvs.getY(ia);
                const uB = uvs.getX(ib), vB = uvs.getY(ib);
                const uC = uvs.getX(ic), vC = uvs.getY(ic);
                uvArr.set([uA,vA, uB,vB, uC,vC]);
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
                pA.x,pA.y,pA.z,
                pB.x,pB.y,pB.z,
                pC.x,pC.y,pC.z,
            ]), 3));
            // Flat normal for stable lighting
            const n = new THREE.Vector3().subVectors(pB, pA).cross(new THREE.Vector3().subVectors(pC, pA)).normalize();
            g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([n.x,n.y,n.z, n.x,n.y,n.z, n.x,n.y,n.z]), 3));
            if (uvArr) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
            // Pick material, clone to enable polygon offset without touching shared mats
            let mat = material;
            if (!mat) mat = getActiveSharedMaterial(currentMaterialStyle) || defaultMaterial;
            mat = mat && mat.clone ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
            mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
            const child = new THREE.Mesh(g, mat);
            child.userData.__materialOverride = true; // respect global overrides
            return child;
        } catch { return null; }
    }

    // Build a coplanar patch overlay: expands from the clicked triangle across adjacent triangles
    function __makeCoplanarOverlayMesh(mesh, faceIndex, material){
        try {
            const geom = mesh.geometry; if (!geom || !geom.isBufferGeometry) return null;
            const pos = geom.getAttribute('position'); const idxAttr = geom.getIndex(); if (!pos) return null;
            const triCount = idxAttr ? (idxAttr.count / 3) : (pos.count / 3);
            if (!Number.isFinite(triCount) || triCount < 1) return null;
            // Helper: get vertex index for face f and corner k (0,1,2)
            const vIdx = (f,k)=> idxAttr ? idxAttr.getX(f*3+k) : (f*3+k);
            const vPos = (i)=> new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
            // Seed plane from picked face in local space
            const ia=vIdx(faceIndex,0), ib=vIdx(faceIndex,1), ic=vIdx(faceIndex,2);
            const A=vPos(ia), B=vPos(ib), C=vPos(ic);
            const seedN = new THREE.Vector3().subVectors(B,A).cross(new THREE.Vector3().subVectors(C,A)).normalize();
            if (!isFinite(seedN.x)) return null;
            const seedD = -seedN.dot(A);
            const onSeedPlane = (p)=> Math.abs(seedN.dot(p) + seedD) <= 1e-4;
            // Build edge->faces map for adjacency
            const edgeMap = new Map();
            const keyEdge = (i1,i2)=>{ const a=Math.min(i1,i2), b=Math.max(i1,i2); return a+','+b; };
            for (let f=0; f<triCount; f++){
                const a=vIdx(f,0), b=vIdx(f,1), c=vIdx(f,2);
                [[a,b],[b,c],[c,a]].forEach(([u,v])=>{
                    const key = keyEdge(u,v);
                    const arr = edgeMap.get(key); if (arr) arr.push(f); else edgeMap.set(key, [f]);
                });
            }
            // BFS from seed over coplanar neighbors
            const visited = new Uint8Array(triCount); const stack=[faceIndex]; visited[faceIndex]=1;
            while(stack.length){
                const f = stack.pop();
                const a=vIdx(f,0), b=vIdx(f,1), c=vIdx(f,2);
                const faces = [];
                [[a,b],[b,c],[c,a]].forEach(([u,v])=>{ const m = edgeMap.get(keyEdge(u,v))||[]; m.forEach(ff=>{ if (ff!==f) faces.push(ff); }); });
                for (const nb of faces){ if (visited[nb]) continue; // plane test: all three vertices lie on seed plane
                    const na=vIdx(nb,0), nb1=vIdx(nb,1), nc=vIdx(nb,2);
                    const p1=vPos(na), p2=vPos(nb1), p3=vPos(nc);
                    if (onSeedPlane(p1) && onSeedPlane(p2) && onSeedPlane(p3)) { visited[nb]=1; stack.push(nb); }
                }
            }
            // Build merged geometry from visited faces
            let positions=[]; let normals=[]; let uvs=[]; const hasUV = !!geom.getAttribute('uv');
            for (let f=0; f<triCount; f++){
                if (!visited[f]) continue;
                const a=vIdx(f,0), b=vIdx(f,1), c=vIdx(f,2);
                const pA=vPos(a), pB=vPos(b), pC=vPos(c);
                positions.push(pA.x,pA.y,pA.z, pB.x,pB.y,pB.z, pC.x,pC.y,pC.z);
                // Use seed normal for flat shading across the whole patch
                normals.push(seedN.x,seedN.y,seedN.z, seedN.x,seedN.y,seedN.z, seedN.x,seedN.y,seedN.z);
                if (hasUV){ const uv = geom.getAttribute('uv'); uvs.push(uv.getX(a),uv.getY(a), uv.getX(b),uv.getY(b), uv.getX(c),uv.getY(c)); }
            }
            if (positions.length === 0) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions),3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normals),3));
            if (hasUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs),2));
            let mat = material; if (!mat) mat = getActiveSharedMaterial(currentMaterialStyle) || defaultMaterial;
            mat = mat && mat.clone ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
            mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
            const child = new THREE.Mesh(g, mat); child.userData.__materialOverride = true; return child;
        } catch { return null; }
    }

    function applyMaterialToPickedFace(customMaterial=null){
        if (!__lastPickedFace) return false;
        const { mesh, faceIndex } = __lastPickedFace;
        // Prefer coplanar patch overlay (whole side); fallback to single triangle
        let child = __makeCoplanarOverlayMesh(mesh, faceIndex, customMaterial);
        if (!child) child = __makeFaceOverlayMesh(mesh, faceIndex, customMaterial);
        if (!child) return false;
        __disposeFacePreview();
        try { mesh.add(child); } catch {}
        // Clear pick state but keep ability to re-apply later
        __lastPickedFace = null;
        return true;
    }

    function clearAllFaceOverrides(){
        try {
            const toRemove = [];
            scene.traverse((node)=>{ if (node && node.userData && node.userData.__materialOverride && node.parent) toRemove.push(node); });
            toRemove.forEach(n=>{ try { n.parent.remove(n); } catch{} try { n.geometry && n.geometry.dispose && n.geometry.dispose(); } catch{} try { const mm=n.material; if(Array.isArray(mm)) mm.forEach(m=>m&&m.dispose&&m.dispose()); else mm&&mm.dispose&&mm.dispose(); } catch{} });
            __disposeFacePreview();
        } catch {}
    }

    // Return public API
    return {
        // Core material functions
        applyMaterialStyle,
        getActiveSharedMaterial,
        getProceduralSharedMaterial,
        getCurrentStyle: () => currentMaterialStyle,
        setMaterialButtons,
        
        // Helper functions
        applyStyleToSubtree,
        restoreOriginalMaterials,
        restoreOriginalMaterialsRespectingOverrides,
        ensureOriginalMaterial,
        
        // Face overlay system
        applyMaterialToPickedFace,
        clearAllFaceOverrides,
        
        // Internal state access for face picking
        setLastPickedFace: (mesh, faceIndex) => { __lastPickedFace = { mesh, faceIndex }; },
        getLastPickedFace: () => __lastPickedFace,
        disposeFacePreview: __disposeFacePreview,
        
        // Initialization
        initializeMaterialSystem
    };
}

export default { downscaleLargeTextures, createMaterialSystem };
