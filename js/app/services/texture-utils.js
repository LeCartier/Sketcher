// Resize overlarge textures at runtime to reduce memory. MIT License.

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

export default { downscaleLargeTextures };
