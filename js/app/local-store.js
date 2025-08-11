// Lightweight local scene storage using IndexedDB
const DB_NAME = 'sketcher-db';
const DB_VERSION = 1;
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

export async function saveScene({ id, name, json }) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const scene = {
    id: id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: name || 'Untitled',
    json,
    updatedAt: Date.now(),
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
  return items.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
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
