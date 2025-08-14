// Lightweight local storage using IndexedDB
const DB_NAME = 'sketcher-db';
// v3: add 'community' store with same schema as 'scenes'
const DB_VERSION = 3;
const STORE = 'scenes';
const ZONES = 'zones';
const COMMUNITY = 'community';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // scenes store
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_updated', 'updatedAt');
      }
      // zones store
      if (!db.objectStoreNames.contains(ZONES)) {
        const z = db.createObjectStore(ZONES, { keyPath: 'id' });
        z.createIndex('by_updated', 'updatedAt');
      }
      // community store
      if (!db.objectStoreNames.contains(COMMUNITY)) {
        const c = db.createObjectStore(COMMUNITY, { keyPath: 'id' });
        c.createIndex('by_updated', 'updatedAt');
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

// Update only the scene name
export async function updateSceneName(id, { name }) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  if (!rec) return;
  if (typeof name === 'string' && name.trim().length) rec.name = name.trim();
  rec.updatedAt = Date.now();
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// -------------------- Columbarium Zones API --------------------
export async function listZones() {
  const db = await openDB();
  const tx = db.transaction(ZONES, 'readonly');
  const store = tx.objectStore(ZONES);
  const items = await new Promise((res, rej) => {
    const out = []; const r = store.openCursor();
    r.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else { res(out.sort((a,b)=>b.updatedAt-a.updatedAt)); } };
    r.onerror = () => rej(r.error);
  });
  return items.map(z => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, color: z.color, name: z.name, updatedAt: z.updatedAt }));
}

export async function saveZone({ x, y, w, h, color, name }) {
  const db = await openDB();
  const tx = db.transaction(ZONES, 'readwrite');
  const store = tx.objectStore(ZONES);
  const zone = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
    x: Number(x) || 0,
    y: Number(y) || 0,
    w: Number(w) || 0,
    h: Number(h) || 0,
    color: typeof color === 'string' ? color : '#ffbf00',
    name: typeof name === 'string' && name.trim().length ? name.trim() : undefined,
    updatedAt: Date.now(),
  };
  await new Promise((res, rej) => { const r = store.put(zone); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  return zone.id;
}

export async function updateZone(id, props) {
  const db = await openDB();
  const tx = db.transaction(ZONES, 'readwrite');
  const store = tx.objectStore(ZONES);
  const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  if (!rec) return;
  if (props) {
    if (props.x !== undefined) rec.x = Number(props.x);
    if (props.y !== undefined) rec.y = Number(props.y);
    if (props.w !== undefined) rec.w = Number(props.w);
    if (props.h !== undefined) rec.h = Number(props.h);
    if (props.color !== undefined && typeof props.color === 'string') rec.color = props.color;
    if (props.name !== undefined && typeof props.name === 'string') rec.name = props.name.trim();
  }
  rec.updatedAt = Date.now();
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function deleteZone(id) {
  const db = await openDB();
  const tx = db.transaction(ZONES, 'readwrite');
  const store = tx.objectStore(ZONES);
  await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function clearZones() {
  const db = await openDB();
  const tx = db.transaction(ZONES, 'readwrite');
  const store = tx.objectStore(ZONES);
  await new Promise((res, rej) => { const r = store.clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// -------------------- Community API (local-only) --------------------
async function capStoreCount(db, storeName, max = 20) {
  // Delete oldest records beyond max based on updatedAt ascending
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const items = await new Promise((res, rej) => {
    const out = []; const r = store.openCursor();
    r.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else { res(out); } };
    r.onerror = () => rej(r.error);
  });
  items.sort((a,b)=>b.updatedAt - a.updatedAt);
  if (items.length > max) {
    const toDelete = items.slice(max);
    for (const rec of toDelete) {
      await new Promise((res, rej) => { const d = store.delete(rec.id); d.onsuccess = () => res(); d.onerror = () => rej(d.error); });
    }
  }
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function saveCommunityScene({ id, name, json, thumb }) {
  const db = await openDB();
  const tx = db.transaction(COMMUNITY, 'readwrite');
  const store = tx.objectStore(COMMUNITY);
  const rec = {
    id: id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: name || 'Untitled',
    json,
    updatedAt: Date.now(),
    thumb: typeof thumb === 'string' ? thumb : undefined,
  };
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  // Enforce cap
  await capStoreCount(db, COMMUNITY, 20);
  return rec.id;
}

export async function listCommunityScenes() {
  const db = await openDB();
  const tx = db.transaction(COMMUNITY, 'readonly');
  const store = tx.objectStore(COMMUNITY);
  const items = await new Promise((res, rej) => {
    const out = []; const r = store.openCursor();
    r.onsuccess = e => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else { res(out.sort((a,b)=>b.updatedAt-a.updatedAt)); } };
    r.onerror = () => rej(r.error);
  });
  return items.map(s => ({ id: s.id, name: s.name, updatedAt: s.updatedAt, thumb: s.thumb }));
}

export async function getCommunityScene(id) {
  const db = await openDB();
  const tx = db.transaction(COMMUNITY, 'readonly');
  const store = tx.objectStore(COMMUNITY);
  return await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}

export async function deleteCommunityScene(id) {
  const db = await openDB();
  const tx = db.transaction(COMMUNITY, 'readwrite');
  const store = tx.objectStore(COMMUNITY);
  await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function updateCommunityThumbnail(id, { thumb }) {
  const db = await openDB();
  const tx = db.transaction(COMMUNITY, 'readwrite');
  const store = tx.objectStore(COMMUNITY);
  const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  if (!rec) return;
  rec.thumb = typeof thumb === 'string' ? thumb : rec.thumb;
  rec.updatedAt = Date.now();
  await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function pickRandomCommunity(n = 3) {
  const list = await listCommunityScenes();
  if (!Array.isArray(list) || !list.length) return [];
  // Fisher-Yates partial shuffle
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, Math.min(n, arr.length)));
}
