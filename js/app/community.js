import * as THREE from '../vendor/three.module.js';
import * as localStore from './local-store.js';
import * as communityApi from './services/community-api.js';
import { getActiveSourceId } from './ui/sources.js';

// Re-export selected APIs so community.html stays simple
export const listCommunityScenes = localStore.listCommunityScenes;
export const getCommunityScene = localStore.getCommunityScene;
export const pickRandomCommunity = localStore.pickRandomCommunity;
export const saveScene = localStore.saveScene; // personal collection

// Thumbnail generator (reuse from columbarium if needed)
export async function generateSceneThumbnail(json){
  try {
    const loader = new THREE.ObjectLoader();
    const root = loader.parse(json);
    const canvas = document.createElement('canvas');
  // Render larger for higher quality thumbnails
  const size = 512; canvas.width = size; canvas.height = size;
    const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    renderer.setSize(size, size, false);
    renderer.setClearColor('#1e1e1e');
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5,10,7); scene.add(dir);
    const grid = new THREE.GridHelper(12, 12, 0x777777, 0x777777); scene.add(grid);
    (root.children||[]).forEach(child => scene.add(child));
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const radius = Math.max(s.x, s.y, s.z) || 6;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 5000);
    camera.position.set(center.x + radius*1.2, center.y + radius*0.9, center.z + radius*1.2);
    camera.lookAt(center);
  renderer.render(scene, camera);
  // Use higher JPEG quality
  return canvas.toDataURL('image/jpeg', 0.85);
  } catch { return null; }
}

// Lightweight preview overlay (like Columbarium overlay)
let overlay = null;
async function openPreviewById(id){
  // Try backend first, fallback to local
  let rec = null;
  try { rec = await communityApi.getCommunityScene(id, { sourceId: getActiveSourceId() }); } catch {}
  if (!rec) { try { rec = await localStore.getCommunityScene(id); } catch {} }
  if (!rec) return;
  await openPreviewRecord(rec);
}

async function openPreviewRecord(rec){
  if (overlay) closePreview();
  const c = document.createElement('div');
  Object.assign(c.style, { position:'fixed', left:'50%', top:'50%', transform:'translate(-50%, -50%)', width:'min(92vw, 960px)', height:'min(82vh, 640px)', zIndex:'250', borderRadius:'12px', overflow:'hidden', background:'#111', border:'1px solid #333', boxShadow:'0 10px 28px rgba(0,0,0,0.45)' });
  const canvas = document.createElement('canvas'); canvas.style.display='block'; canvas.style.width='100%'; canvas.style.height='100%'; c.appendChild(canvas);
  const closeBtn = document.createElement('button'); closeBtn.textContent='×'; Object.assign(closeBtn.style,{ position:'absolute', top:'8px', right:'10px', width:'28px', height:'28px', borderRadius:'14px', border:'1px solid rgba(255,255,255,0.16)', background:'#333', color:'#ddd', lineHeight:'26px', textAlign:'center', cursor:'pointer', zIndex:1 });
  closeBtn.addEventListener('click', closePreview); c.appendChild(closeBtn);
  document.body.appendChild(c);
  overlay = { root:c };
  // Three preview
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha:false });
  function getSize(){ const r=c.getBoundingClientRect(); return { w: Math.max(100, Math.floor(r.width)), h: Math.max(100, Math.floor(r.height)) }; }
  const sz = getSize(); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1)); renderer.setSize(sz.w, sz.h, false); renderer.setClearColor('#141414');
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9)); const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5,10,7); scene.add(dir);
  const camera = new THREE.PerspectiveCamera(60, sz.w/sz.h, 0.01, 5000);
  const loader = new THREE.ObjectLoader(); const root = loader.parse(rec.json); (root.children||[]).forEach(child=>scene.add(child));
  const box = new THREE.Box3().setFromObject(scene); const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x,size.y,size.z) || 6; camera.position.set(center.x+radius*1.2, center.y+radius*0.9, center.z+radius*1.2); camera.lookAt(center);
  let raf=0; function loop(){ raf=requestAnimationFrame(loop); renderer.render(scene,camera); } loop();
  overlay.raf = raf; overlay.renderer = renderer; overlay.scene=scene; overlay.camera=camera;
  overlay.onResize = () => { const s=getSize(); renderer.setSize(s.w, s.h, false); camera.aspect = Math.max(0.001, s.w/s.h); camera.updateProjectionMatrix(); };
  window.addEventListener('resize', overlay.onResize);

  // Add Secret Space label if applicable (FFE legacy supported via API mapping)
  if (rec && rec.group === 'SECRET') {
    const badge = document.createElement('div');
    badge.textContent = 'Secret';
    Object.assign(badge.style, { position:'absolute', right:'12px', bottom:'12px', background:'rgba(255,0,255,0.9)', color:'#111', border:'1px solid rgba(0,0,0,0.35)', borderRadius:'8px', padding:'4px 10px', font:'600 12px system-ui, sans-serif', zIndex:2 });
    c.appendChild(badge);
  }
}

function closePreview(){
  if (!overlay) return;
  try { cancelAnimationFrame(overlay.raf); } catch {}
  try { overlay.renderer && overlay.renderer.dispose && overlay.renderer.dispose(); } catch {}
  try { overlay.root && overlay.root.remove && overlay.root.remove(); } catch {}
  try { window.removeEventListener('resize', overlay.onResize); } catch {}
  overlay = null;
}

window.addEventListener('community:preview', (e)=>{ const id = e.detail?.id; if (id) openPreviewById(id); });
