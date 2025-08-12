import * as THREE from '../vendor/three.module.js';
import * as localStore from './local-store.js';

// Simple local-only “gallery” previewer. Exposes openPreviewById for the grid canvas.

const importBtn = document.getElementById('importBtn');
const importInput = document.getElementById('importInput');

const viewerBackdrop = document.getElementById('viewerBackdrop');
const viewerTitle = document.getElementById('viewerTitle');
const viewerClose = document.getElementById('viewerClose');
const viewerCanvas = document.getElementById('viewerCanvas');

const GALLERY_NAMESPACE = 'gallery:';

function niceDate(ts){ try { return new Date(ts).toLocaleString(); } catch { return String(ts); } }

// Viewer setup
let renderer, camera, scene;
function initViewer() {
  if (renderer) return; // singleton
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: viewerCanvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const w = viewerCanvas.clientWidth || viewerCanvas.parentElement.clientWidth || 800;
  const h = viewerCanvas.clientHeight || viewerCanvas.parentElement.clientHeight || 560;
  renderer.setSize(w, h, false);
  renderer.setClearColor('#1e1e1e');
  camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 5000);
  camera.position.set(6, 6, 8);
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5,10,7); scene.add(dir);
  const grid = new THREE.GridHelper(20, 20, 0xffffff, 0xffffff); scene.add(grid);
  function animate(){ requestAnimationFrame(animate); renderer.render(scene, camera); }
  animate();
  window.addEventListener('resize', () => {
    const w2 = viewerCanvas.clientWidth || viewerCanvas.parentElement.clientWidth || window.innerWidth * 0.8;
    const h2 = viewerCanvas.clientHeight || viewerCanvas.parentElement.clientHeight || window.innerHeight * 0.6;
    camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2, false);
  });
}

export async function openPreviewById(id){
  const rec = await localStore.getScene(id);
  if (!rec) return;
  await openPreviewRecord(rec);
}

async function openPreviewRecord(rec){
  viewerBackdrop.style.display = 'flex';
  viewerBackdrop.setAttribute('aria-hidden', 'false');
  const name = (rec.name || 'Preview').replace(GALLERY_NAMESPACE, '');
  viewerTitle.textContent = name;
  initViewer();
  // Clear existing non-light/grid
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj.isLight || obj.type === 'GridHelper') continue;
    scene.remove(obj);
  }
  try {
    const loader = new THREE.ObjectLoader();
    const root = loader.parse(rec.json);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 5;
    camera.position.set(center.x + radius*1.2, center.y + radius*0.9, center.z + radius*1.2);
    camera.lookAt(center);
    (root.children || []).forEach(child => scene.add(child));
  } catch (e) {
    console.error('Preview load failed', e);
  }
}

viewerClose.addEventListener('click', () => {
  viewerBackdrop.style.display = 'none';
  viewerBackdrop.setAttribute('aria-hidden', 'true');
});

importBtn.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const nameBase = file.name.replace(/\.(json|gltf|glb|obj)$/i, '');
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let savedId = null;
    if (ext === 'json') {
      const text = await file.text();
      const json = JSON.parse(text);
      const thumb = await generateSceneThumbnail(json).catch(()=>null);
      savedId = await localStore.saveScene({ name: `${GALLERY_NAMESPACE}${nameBase}`, json, thumb });
    } else if (ext === 'gltf' || ext === 'glb') {
      const { GLTFLoader } = await import('../vendor/GLTFLoader.js');
      const { Object3D, Scene } = await import('../vendor/three.module.js');
      const loader = new GLTFLoader();
      const arrayBuffer = await file.arrayBuffer();
      const url = URL.createObjectURL(new Blob([arrayBuffer]));
      const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
      // Convert to Three JSON via Object3D.toJSON()
      const root = new Object3D();
      root.name = nameBase;
      if (gltf.scene) root.add(gltf.scene);
      const json = root.toJSON();
      const thumb = await generateSceneThumbnail(json).catch(()=>null);
      savedId = await localStore.saveScene({ name: `${GALLERY_NAMESPACE}${nameBase}`, json, thumb });
      URL.revokeObjectURL(url);
    } else if (ext === 'obj') {
      const { OBJLoader } = await import('../vendor/OBJLoader.js');
      const { Object3D } = await import('../vendor/three.module.js');
      const loader = new OBJLoader();
      const text = await file.text();
      const obj = loader.parse(text);
      const root = new Object3D(); root.name = nameBase; root.add(obj);
      const json = root.toJSON();
      const thumb = await generateSceneThumbnail(json).catch(()=>null);
      savedId = await localStore.saveScene({ name: `${GALLERY_NAMESPACE}${nameBase}`, json, thumb });
    } else {
      alert('Unsupported file type. Please import .json, .gltf, .glb, or .obj');
    }
    if (savedId) window.dispatchEvent(new Event('columbarium:refresh'));
  } catch (err) {
    alert('Failed to import file');
    console.error(err);
  } finally {
    e.target.value = '';
  }
});

async function generateSceneThumbnail(json){
  try {
    const { ObjectLoader, Scene, WebGLRenderer, PerspectiveCamera, GridHelper, AmbientLight, DirectionalLight, Vector3, Box3 } = await import('../vendor/three.module.js');
    const loader = new ObjectLoader();
    const root = loader.parse(json);
    const canvas = document.createElement('canvas');
    const size = 256; canvas.width = size; canvas.height = size;
    const renderer = new WebGLRenderer({ antialias: true, canvas });
    renderer.setSize(size, size, false);
    renderer.setClearColor('#1e1e1e');
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 0.9));
    const dir = new DirectionalLight(0xffffff, 0.9); dir.position.set(5,10,7); scene.add(dir);
    const grid = new GridHelper(12, 12, 0x777777, 0x777777); scene.add(grid);
    (root.children||[]).forEach(child => scene.add(child));
    const box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());
    const radius = Math.max(s.x, s.y, s.z) || 6;
    const camera = new PerspectiveCamera(60, 1, 0.01, 5000);
    camera.position.set(center.x + radius*1.2, center.y + radius*0.9, center.z + radius*1.2);
    camera.lookAt(center);
    renderer.render(scene, camera);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
