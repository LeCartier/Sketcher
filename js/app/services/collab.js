// Realtime collaboration service using Supabase Realtime channels
// Lightweight, optional: if CDN fails or keys missing, it becomes a no-op.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/community.js';

export function createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData }) {
  let sb = null;
  let channel = null;
  let roomId = null;
  let isHost = false;
  let active = false;
  let applying = false;
  const userId = (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));

  // Lightweight event listeners for UI integration
  const listeners = { status: new Set(), presence: new Set() };
  function onStatus(fn){ try { if (typeof fn === 'function') listeners.status.add(fn); } catch{} }
  function onPresence(fn){ try { if (typeof fn === 'function') listeners.presence.add(fn); } catch{} }
  function emit(kind, payload){ try { (listeners[kind]||[]).forEach(fn=>{ try { fn(payload); } catch{} }); } catch{} }

  // Lazy create client
  async function getClient() {
    if (sb) return sb;
    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    } catch {
      sb = null;
    }
    return sb;
  }

  function isActive() { return !!active; }
  function isApplyingRemote() { return !!applying; }

  function throttle(fn, ms = 66) { // ~15 Hz
    let t = 0; let lastArgs = null; let pending = false;
    return function(...args){
      const now = Date.now();
      lastArgs = args;
      if (!pending && (now - t) >= ms) {
        t = now; fn.apply(null, args); pending = false; lastArgs = null; return;
      }
      if (!pending) {
        pending = true;
        setTimeout(()=>{ pending = false; t = Date.now(); if (lastArgs) fn.apply(null, lastArgs); lastArgs = null; }, Math.max(0, ms - (now - t)));
      }
    };
  }

  async function ensureChannel(id) {
    const client = await getClient();
    if (!client) return null;
    if (channel) return channel;
    roomId = String(id || 'default');
    channel = client.channel(`sketcher:${roomId}`, { config: { broadcast: { self: false }, presence: { key: userId } } });
    channel.on('broadcast', { event: 'sketcher' }, (payload) => { try { handleMessage(payload?.payload || {}); } catch {} });
    // Presence: when someone joins and requests a snapshot, host responds
    channel.on('broadcast', { event: 'snapshot:request' }, async (payload) => {
      if (!isHost) return;
      try {
        const snap = (typeof getSnapshot === 'function') ? await getSnapshot() : null;
        if (!snap) return;
        channel.send({ type: 'broadcast', event: 'snapshot', payload: { from: userId, type: 'snapshot', ...snap } });
      } catch {}
    });
    // Presence sync: update participant count
    try {
      channel.on('presence', { event: 'sync' }, () => {
        try {
          const state = channel.presenceState?.() || {};
          let count = 0; try { Object.values(state).forEach(arr => { count += (Array.isArray(arr) ? arr.length : 0); }); } catch{}
          emit('presence', { count, state });
        } catch{}
      });
    } catch{}

    const { status } = await channel.subscribe((status) => {
      try { emit('status', status); } catch{}
      /* console.log('realtime status', status) */
    });
    if (status === 'SUBSCRIBED') active = true;
    return channel;
  }

  function handleMessage(msg) {
    if (!msg || msg.from === userId) return;
    const kind = msg.type;
    applying = true;
    try {
      if (kind === 'snapshot') {
        if (msg.json) {
          try { clearSceneObjects?.(); } catch {}
          try { loadSceneFromJSON?.(msg.json); } catch {}
        }
        if (msg.overlay) {
          try {
            const m = msg.overlay && msg.overlay.meta;
            const stamp = (m && (m.updatedAt || m.createdAt)) ? (m.updatedAt || m.createdAt) : Date.now();
            try { sessionStorage.setItem('sketcher:2d:last-remote', String(stamp)); } catch {}
            applyOverlayData?.(msg.overlay);
          } catch {}
        }
        return;
      }
      if (kind === 'overlay' && msg.overlay) {
        try {
          const m = msg.overlay && msg.overlay.meta;
          const stamp = (m && (m.updatedAt || m.createdAt)) ? (m.updatedAt || m.createdAt) : Date.now();
          try { sessionStorage.setItem('sketcher:2d:last-remote', String(stamp)); } catch {}
          applyOverlayData?.(msg.overlay);
        } catch {}
        return;
      }
      if (kind === 'add' && msg.obj) {
        try {
          const loader = new THREE.ObjectLoader();
          const root = loader.parse(msg.obj);
          const kids = (root && root.children) ? root.children.slice() : [];
          kids.forEach(c => addObjectToScene?.(c, { select: false }));
        } catch {}
        return;
      }
      if (kind === 'transform' && msg.uuid && msg.tr) {
        const obj = findObjectByUUID?.(msg.uuid);
        if (!obj) return;
        try {
          const p = msg.tr.p, q = msg.tr.q, s = msg.tr.s;
          if (Array.isArray(p)) obj.position.set(p[0], p[1], p[2]);
          if (Array.isArray(q)) obj.quaternion.set(q[0], q[1], q[2], q[3]);
          if (Array.isArray(s)) obj.scale.set(s[0], s[1], s[2]);
          obj.updateMatrixWorld(true);
        } catch {}
        return;
      }
      if (kind === 'delete' && msg.uuid) {
        const obj = findObjectByUUID?.(msg.uuid);
        if (obj && obj.parent) {
          try { obj.parent.remove(obj); } catch {}
        }
        return;
      }
    } finally { applying = false; }
  }

  async function host(id) {
    isHost = true;
    const ch = await ensureChannel(id);
    if (!ch) return false;
    try {
      // On host start, proactively broadcast snapshot
      const snap = (typeof getSnapshot === 'function') ? await getSnapshot() : null;
      if (snap) ch.send({ type: 'broadcast', event: 'snapshot', payload: { from: userId, type: 'snapshot', ...snap } });
    } catch {}
    return true;
  }

  async function join(id) {
    isHost = false;
    const ch = await ensureChannel(id);
    if (!ch) return false;
    // Request a snapshot from host(s)
    try { ch.send({ type: 'broadcast', event: 'snapshot:request', payload: { from: userId } }); } catch {}
    return true;
  }

  function leave() {
    try { channel?.unsubscribe(); } catch {}
    channel = null; active = false; isHost = false;
  try { emit('status', 'LEFT'); } catch{}
  try { emit('presence', { count: 0, state: {} }); } catch{}
  }

  // Broadcast helpers
  function exportSingleObjectJSON(obj) {
    try {
      const root = new THREE.Group();
      const clone = obj.clone(true);
      root.add(clone);
      return root.toJSON();
    } catch { return null; }
  }

  function send(kind, payload) {
    if (!channel || !active) return;
    try { channel.send({ type: 'broadcast', event: 'sketcher', payload: { from: userId, type: kind, ...payload } }); } catch {}
  }

  function onAdd(obj) {
    if (!obj || applying) return;
    const json = exportSingleObjectJSON(obj);
    if (!json) return;
    send('add', { obj: json });
  }

  const onTransform = throttle((obj) => {
    if (!obj || applying) return;
    const u = obj.uuid;
    if (!u) return;
    try {
      const p = [obj.position.x, obj.position.y, obj.position.z];
      const q = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
      const s = [obj.scale.x, obj.scale.y, obj.scale.z];
      send('transform', { uuid: u, tr: { p, q, s } });
    } catch {}
  }, 66);

  function onDelete(obj) {
    if (!obj || applying) return;
    const u = obj.uuid;
    if (!u) return;
    send('delete', { uuid: u });
  }

  // Broadcast overlay document changes (2D sketch data JSON)
  function onOverlay(data) {
    if (!data || applying) return;
    try { send('overlay', { overlay: data }); } catch {}
  }

  return { host, join, leave, isActive, isApplyingRemote, onAdd, onTransform, onDelete, onOverlay };
}
