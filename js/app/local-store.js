// Lightweight local scene storage using IndexedDB
const DB_NAME = 'sketcher-db';
const DB_VERSION = 1; // store schema stays the same; we can include extra fields like posX/posY without migration
const STORE = 'scenes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_updated', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScene({ id, name, json, posX, posY, thumb }) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const scene = {
    id: id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: name || 'Untitled',
    json,
    updatedAt: Date.now(),
  // Optional layout metadata for Columbarium
  posX: Number.isFinite(posX) ? posX : undefined,
  posY: Number.isFinite(posY) ? posY : undefined,
  // Optional thumbnail data URL
  thumb: typeof thumb === 'string' ? thumb : undefined,
  };
  await new Promise((res, rej) => { const r = store.put(scene); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  return scene.id;
}

export async function listScenes() {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const items = await new Promise((res, rej) => {
    const out = []; const r = store.openCursor();
    r.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else { res(out.sort((a,b)=>b.updatedAt-a.updatedAt)); } };
    r.onerror = () => rej(r.error);
  });
  // Include optional layout metadata if present
  return items.map((s) => ({ id: s.id, name: s.name, updatedAt: s.updatedAt, posX: s.posX, posY: s.posY, thumb: s.thumb }));
}

export async function getScene(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  return await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}

export async function deleteScene(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// Update only the layout position for a scene (used by Columbarium tile drag)
export async function updateScenePosition(id, { posX, posY }) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  if (!rec) return;
  rec.posX = Number.isFinite(posX) ? posX : rec.posX;
  rec.posY = Number.isFinite(posY) ? posY : rec.posY;
  rec.updatedAt = Date.now();
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// Update only the thumbnail for a scene
export async function updateSceneThumbnail(id, { thumb }) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  if (!rec) return;
  rec.thumb = typeof thumb === 'string' ? thumb : rec.thumb;
  rec.updatedAt = Date.now();
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
