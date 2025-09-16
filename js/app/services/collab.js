/* =================================================================================================
   COLLABORATION SERVICE (Supabase Realtime)
   -------------------------------------------------------------------------------------------------
   Factory:
     const collab = createCollab({
       THREE,
       findObjectByUUID,        // (uuid)=>object | null
       addObjectToScene,        // (obj, { select })
       clearSceneObjects,       // () => void (clears current scene content)
       loadSceneFromJSON,       // (json) => void (rebuild scene graph)
       getSnapshot,             // async () => { json, overlay }
       applyOverlayData         // (overlayJson) => void (2D / hybrid data)
     });

   Purpose:
     Provide lightweight, opportunistic multi‑user synchronization of: scene object add/delete,
     object transforms (delta + interpolation), overlay documents, camera/pose avatars, and VR draw
     strokes. It degrades gracefully to a no‑op when the Supabase CDN or keys are unavailable.

   Core Concepts:
     - Supabase Channel per room: broadcast events (self suppressed) + presence metadata.
     - Host & Backup Host: Original host immediately answers snapshot requests; secondary clients
       can self‑elevate after dwell (host migration resilience).
     - Snapshot Flow: join() emits snapshot:request -> any host/backup responds with complete scene.
     - Delta Compression: Only broadcast transform when exceeding small thresholds (pos/rot/scale).
     - Interpolation & Prediction: Remote transforms lerp toward targets; minimal velocity prediction
       reduces visible lag for fast movements.
     - Avatars: Desktop vs VR representation (headset + controllers) + ephemeral labels.
     - VR Drawing: stroke lifecycle (start, point, end, clear) mirrored into a remote line group.
     - Fault Tolerance: Every external / networked interaction behind try/catch to remain inert
       if runtime capabilities vanish.

   Failure / Offline Strategy:
     - Absence of Supabase library => sb == null => ensureChannel returns null => all send() no‑ops.
     - Unexpected broadcast payload shape safely ignored.
     - Resource cleanup (avatars, lines) performed on leave() & periodic old avatar culling.

   ================================================================================================
   TABLE OF CONTENTS
   --------------------------------------------------------------------------------
    [01] Imports & Factory Signature
    [02] Internal State & Collections
    [03] Throttling Utilities (generic & context-aware)
    [04] Channel Initialization (ensureChannel / presence wiring)
    [05] Message Dispatch (handleMessage) & Kind Handlers
    [06] Host / Join / Leave Lifecycle
    [07] Broadcast Helpers (send / export)
    [08] Transform Delta Compression & Significant Change Test
    [09] Avatar Management (create / update / cleanup)
    [10] VR Drawing (ensure group + stroke handlers)
    [11] Transform Broadcast (onTransform throttled)
    [12] Overlay & Camera Broadcast
    [13] VR Drawing Broadcast API
    [14] Public API Export
   --------------------------------------------------------------------------------
   NOTE: Section markers follow // [NN] Title for grep-friendly navigation.
   ================================================================================================ */

// [01] Imports & Factory Signature ----------------------------------------------------------------
// Realtime collaboration service using Supabase Realtime channels
// Lightweight, optional: if CDN fails or keys missing, it becomes a no-op.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/community.js';

export function createCollab({ THREE, findObjectByUUID, addObjectToScene, clearSceneObjects, loadSceneFromJSON, getSnapshot, applyOverlayData }) {
  // [02] Internal State & Collections ------------------------------------------------------------
  let sb = null;
  let channel = null;
  let roomId = null;
  let isHost = false;
  let active = false;
  let applying = false;
  let canActAsHost = false; // Flag for whether this user can respond to snapshot requests
  const userId = (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));
  
  // Performance optimization maps
  const transformLerpMap = new Map(); // Store interpolation state for smooth remote transforms
  const userAvatars = new Map(); // Store avatar objects for each user
  
  // VR Drawing collaboration
  const remoteVRStrokes = new Map(); // strokeId -> { line, points, color, lineWidth }
  let vrDrawGroup = null; // Reference to VR draw group for remote lines
  
  const cameraThrottle = createSmartThrottle((cameraData) => {
    if (applying) return;
    send('camera', cameraData);
  });

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

  function throttle(fn, ms = 66) { // ~15 Hz default
    // [03] Basic Throttle ------------------------------------------------------------------------
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

  // Create different throttling rates for different interaction types
  function createSmartThrottle(fn) {
    // [03] Context-Aware Throttle (vr/desktop/touch) ---------------------------------------------
    const vrThrottle = throttle(fn, 33);    // 30 Hz for VR/AR - smoother hand tracking
    const desktopThrottle = throttle(fn, 50); // 20 Hz for desktop - good responsiveness
    const touchThrottle = throttle(fn, 40);   // 25 Hz for touch - mobile-friendly
    
    return function(obj, context = 'desktop') {
      // Auto-detect interaction context if not provided
      if (!context || context === 'auto') {
        if (typeof window !== 'undefined' && window.navigator) {
          if (window.navigator.xr) context = 'vr';
          else if ('ontouchstart' in window) context = 'touch';
          else context = 'desktop';
        }
      }
      
      switch(context) {
        case 'vr':
        case 'ar':
          return vrThrottle(obj);
        case 'touch':
          return touchThrottle(obj);
        default:
          return desktopThrottle(obj);
      }
    };
  }

  async function ensureChannel(id) {
    // [04] Channel Initialization & Presence Wiring ----------------------------------------------
    const client = await getClient();
    if (!client) return null;
    if (channel) return channel;
    roomId = String(id || 'default');
    channel = client.channel(`sketcher:${roomId}`, { config: { broadcast: { self: false }, presence: { key: userId } } });
    channel.on('broadcast', { event: 'sketcher' }, (payload) => { try { handleMessage(payload?.payload || {}); } catch {} });
    // Presence: Enhanced snapshot handling with host migration support
    channel.on('broadcast', { event: 'snapshot:request' }, async (payload) => {
      try {
        // Only respond if we're the original host OR if we can act as host (backup)
        if (!isHost && !canActAsHost) return;
        
        // Add small random delay to prevent multiple simultaneous responses
        // Original host responds immediately, backups wait a bit
        const delay = isHost ? 0 : Math.random() * 500 + 200;
        
        setTimeout(async () => {
          try {
            const snap = (typeof getSnapshot === 'function') ? await getSnapshot() : null;
            if (!snap) return;
            
            channel.send({ 
              type: 'broadcast', 
              event: 'snapshot', 
              payload: { 
                from: userId, 
                type: 'snapshot', 
                isOriginalHost: isHost,
                isBackupHost: canActAsHost && !isHost,
                ...snap 
              } 
            });
          } catch {}
        }, delay);
      } catch {}
    });
    // Presence sync: update participant count and clean up avatars for offline users
    try {
      channel.on('presence', { event: 'sync' }, () => {
        try {
          const state = channel.presenceState?.() || {};
          let count = 0; 
          const activeUserIds = new Set();
          
          try { 
            Object.values(state).forEach(arr => { 
              count += (Array.isArray(arr) ? arr.length : 0); 
              if (Array.isArray(arr)) {
                arr.forEach(user => {
                  if (user && user.user_id) activeUserIds.add(user.user_id);
                });
              }
            }); 
          } catch{}
          
          // Remove avatars for users who are no longer present
          for (const [userId, avatar] of userAvatars.entries()) {
            if (!activeUserIds.has(userId)) {
              try {
                if (avatar.group && avatar.group.parent) {
                  avatar.group.parent.remove(avatar.group);
                }
                avatar.group.traverse(obj => {
                  if (obj.geometry) obj.geometry.dispose();
                  if (obj.material) {
                    if (Array.isArray(obj.material)) {
                      obj.material.forEach(mat => mat.dispose());
                    } else {
                      obj.material.dispose();
                    }
                  }
                });
              } catch(e) {}
              userAvatars.delete(userId);
            }
          }
          
          // Host migration logic: if we have enough users, promote oldest to backup host
          if (count > 1 && !isHost && !canActAsHost) {
            // Simple heuristic: become backup host if we've been in the room for a while
            // and there are multiple users (indicating the room is active)
            if (!window.__roomJoinTime) window.__roomJoinTime = Date.now();
            const timeInRoom = Date.now() - window.__roomJoinTime;
            
            // After 10 seconds in a multi-user room, become eligible as backup host
            if (timeInRoom > 10000) {
              canActAsHost = true;
              console.log('Promoted to backup host - can respond to snapshot requests');
            }
          }
          
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
    // [05] Message Dispatch ----------------------------------------------------------------------
    if (!msg || msg.from === userId) return;
    const kind = msg.type;
    applying = true;
    try {
      if (kind === 'camera') {
      updateUserAvatar(msg.from, msg);
    } else if (kind === 'user_leaving') {
      // Remove avatar for user who announced they're leaving
      const avatar = userAvatars.get(msg.from);
      if (avatar && avatar.group) {
        try {
          if (avatar.group.parent) avatar.group.parent.remove(avatar.group);
          avatar.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        } catch(e) {}
        userAvatars.delete(msg.from);
      }
    } else if (kind === 'snapshot') {
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
          
          // Smooth interpolation for better visual experience
          const smoothTransform = () => {
            const currentPos = obj.position.clone();
            const currentQuat = obj.quaternion.clone();
            const currentScale = obj.scale.clone();
            
            let targetPos = Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : currentPos;
            const targetQuat = Array.isArray(q) ? new THREE.Quaternion(q[0], q[1], q[2], q[3]) : currentQuat;
            const targetScale = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : currentScale;
            
            // Enhanced interpolation with velocity prediction
            const objState = transformLerpMap.get(uuid) || {};
            if (objState.lastPosition && objState.lastTime) {
              const deltaTime = (Date.now() - objState.lastTime) / 1000;
              if (deltaTime > 0 && deltaTime < 0.5) {
                const velocity = new THREE.Vector3().subVectors(targetPos, objState.lastPosition).divideScalar(deltaTime);
                // Add small prediction (10% of velocity)
                const prediction = new THREE.Vector3().copy(velocity).multiplyScalar(deltaTime * 0.1);
                targetPos.add(prediction);
              }
            }
            
            // Store state for next prediction
            transformLerpMap.set(uuid, {
              ...objState,
              lastPosition: new THREE.Vector3(p[0], p[1], p[2]),
              lastTime: Date.now()
            });
            
            // Use lerp for smooth transitions (0.3 = 30% blend per frame)
            const lerpFactor = 0.3;
            obj.position.lerp(targetPos, lerpFactor);
            obj.quaternion.slerp(targetQuat, lerpFactor);
            obj.scale.lerp(targetScale, lerpFactor);
            obj.updateMatrixWorld(true);
            
            // Continue interpolating if not close enough to target
            const posDistance = obj.position.distanceTo(targetPos);
            const quatDistance = obj.quaternion.angleTo(targetQuat);
            const scaleDistance = obj.scale.distanceTo(targetScale);
            
            if (posDistance > 0.001 || quatDistance > 0.01 || scaleDistance > 0.001) {
              requestAnimationFrame(smoothTransform);
            }
          };
          
          // Start smooth interpolation instead of instant snap
          smoothTransform();
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
      // Handle VR drawing collaboration
      if (kind === 'vr_draw_start' && msg.strokeId && msg.point && msg.color && msg.lineWidth) {
        handleVRDrawStart(msg);
        return;
      }
      if (kind === 'vr_draw_point' && msg.strokeId && msg.point) {
        handleVRDrawPoint(msg);
        return;
      }
      if (kind === 'vr_draw_end' && msg.strokeId) {
        handleVRDrawEnd(msg);
        return;
      }
      if (kind === 'vr_draw_clear') {
        handleVRDrawClear();
        return;
      }
    } finally { applying = false; }
  }

  async function host(id) {
    // [06] Host Lifecycle -----------------------------------------------------------------------
    isHost = true;
    canActAsHost = true; // Hosts can always act as host
    window.__roomJoinTime = Date.now(); // Track when we joined/created room
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
    // [06] Join Lifecycle -----------------------------------------------------------------------
    isHost = false;
    window.__roomJoinTime = Date.now(); // Track when we joined room
    const ch = await ensureChannel(id);
    if (!ch) return false;
    // Request a snapshot from host(s) or backup hosts
    try { ch.send({ type: 'broadcast', event: 'snapshot:request', payload: { from: userId } }); } catch {}
    return true;
  }

  function leave() {
    // [06] Leave Lifecycle & Cleanup -------------------------------------------------------------
    try { 
      // Send graceful departure notification
      if (channel && active) {
        try {
          // Notify other users that we're leaving
          channel.send({ 
            type: 'broadcast', 
            event: 'sketcher', 
            payload: { 
              from: userId, 
              type: 'user_leaving', 
              wasHost: isHost,
              canActAsHost: canActAsHost
            } 
          });
        } catch {}
        
        // Note: Don't send room shutdown - let room persist for other users
        // If host leaves, backup hosts can take over seamlessly
      }
      
      channel?.unsubscribe(); 
    } catch {}
    
    channel = null; active = false; 
    const wasHost = isHost;
    isHost = false; canActAsHost = false;
    
    // Clean room join time
    try { delete window.__roomJoinTime; } catch {}
    
    // Clean up all user avatars when leaving
    for (const [userId, avatar] of userAvatars.entries()) {
      try {
        if (avatar.group && avatar.group.parent) {
          avatar.group.parent.remove(avatar.group);
        }
        avatar.group.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(mat => mat.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
      } catch(e) {}
    }
    userAvatars.clear();
    
    try { emit('status', 'LEFT'); } catch{}
    try { emit('presence', { count: 0, state: {} }); } catch{}
  }

  // Broadcast helpers
  function exportSingleObjectJSON(obj) {
    // [07] Export Single Object (wrap & serialize) -----------------------------------------------
    try {
      const root = new THREE.Group();
      const clone = obj.clone(true);
      root.add(clone);
      return root.toJSON();
    } catch { return null; }
  }

  function send(kind, payload) {
    // [07] Broadcast Helper ---------------------------------------------------------------------
    if (!channel || !active) return;
    try { channel.send({ type: 'broadcast', event: 'sketcher', payload: { from: userId, type: kind, ...payload } }); } catch {}
  }

  function onAdd(obj) {
    if (!obj || applying) return;
    const json = exportSingleObjectJSON(obj);
    if (!json) return;
    send('add', { obj: json });
  }

  // Transform cache and delta compression for performance
  const transformCache = new Map(); // Cache last sent transforms
  const deltaThreshold = { position: 0.001, rotation: 0.01, scale: 0.001 }; // Minimum change to sync
  
  function hasSignificantChange(objId, transform) {
    // [08] Delta Significance Test ---------------------------------------------------------------
    const cached = transformCache.get(objId);
    if (!cached) return true;
    
    // Check position delta
    const posDelta = Math.max(
      Math.abs(cached.p[0] - transform.p[0]),
      Math.abs(cached.p[1] - transform.p[1]),
      Math.abs(cached.p[2] - transform.p[2])
    );
    if (posDelta > deltaThreshold.position) return true;
    
    // Check quaternion delta (approximate rotation change)
    const qDelta = Math.max(
      Math.abs(cached.q[0] - transform.q[0]),
      Math.abs(cached.q[1] - transform.q[1]),
      Math.abs(cached.q[2] - transform.q[2]),
      Math.abs(cached.q[3] - transform.q[3])
    );
    if (qDelta > deltaThreshold.rotation) return true;
    
    // Check scale delta
    const scaleDelta = Math.max(
      Math.abs(cached.s[0] - transform.s[0]),
      Math.abs(cached.s[1] - transform.s[1]),
      Math.abs(cached.s[2] - transform.s[2])
    );
    if (scaleDelta > deltaThreshold.scale) return true;
    
    return false;
  }

  // User avatar management for camera position sync
  function createUserAvatar(userId, isVR = false) {
    // [09] Avatar Creation (desktop vs VR) -------------------------------------------------------
    if (!findObjectByUUID || !addObjectToScene) return null;
    
    const avatarGroup = new THREE.Group();
    avatarGroup.name = `UserAvatar_${userId}`;
    avatarGroup.userData.__helper = true; // Mark as helper to exclude from measurements
    
    if (isVR) {
      // VR headset representation - sleek headset shape
      const headsetGeom = new THREE.BoxGeometry(0.15, 0.08, 0.12);
      const headsetMat = new THREE.MeshBasicMaterial({ 
        color: 0x2196F3, 
        transparent: true, 
        opacity: 0.8 
      });
      const headset = new THREE.Mesh(headsetGeom, headsetMat);
      headset.position.y = 0.04;
      avatarGroup.add(headset);
      
      // VR controller indicators (small spheres for hands)
      const controllerGeom = new THREE.SphereGeometry(0.02);
      const controllerMat = new THREE.MeshBasicMaterial({ 
        color: 0x4CAF50, 
        transparent: true, 
        opacity: 0.7 
      });
      
      const leftController = new THREE.Mesh(controllerGeom, controllerMat);
      leftController.position.set(-0.3, -0.2, 0.1);
      leftController.name = 'leftController';
      avatarGroup.add(leftController);
      
      const rightController = new THREE.Mesh(controllerGeom, controllerMat);
      rightController.position.set(0.3, -0.2, 0.1);
      rightController.name = 'rightController';
      avatarGroup.add(rightController);
      
    } else {
      // Desktop camera representation - camera icon
      const cameraGeom = new THREE.BoxGeometry(0.1, 0.06, 0.08);
      const cameraMat = new THREE.MeshBasicMaterial({ 
        color: 0xFF9800, 
        transparent: true, 
        opacity: 0.8 
      });
      const camera = new THREE.Mesh(cameraGeom, cameraMat);
      
      // Add lens (front face)
      const lensGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.01);
      const lensMat = new THREE.MeshBasicMaterial({ 
        color: 0x333333, 
        transparent: true, 
        opacity: 0.9 
      });
      const lens = new THREE.Mesh(lensGeom, lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.045;
      camera.add(lens);
      
      avatarGroup.add(camera);
    }
    
    // Add floating user ID label
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 256;
      canvas.height = 64;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = 'white';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`User ${userId.slice(-4)}`, 128, 40);
      
      const texture = new THREE.CanvasTexture(canvas);
      const labelMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const label = new THREE.Sprite(labelMat);
      label.scale.set(0.4, 0.1, 1);
      label.position.y = 0.15;
      avatarGroup.add(label);
    } catch(e) {
      console.warn('Could not create user label:', e);
    }
    
    addObjectToScene(avatarGroup);
    userAvatars.set(userId, { group: avatarGroup, isVR, lastUpdate: Date.now() });
    
    return avatarGroup;
  }

  function updateUserAvatar(fromUserId, cameraData) {
    // [09] Avatar Update ------------------------------------------------------------------------
    if (!cameraData || fromUserId === userId) return; // Don't show our own avatar
    
    // Avatar visibility rules:
    // - VR users only see desktop user avatars (not other VR users)
    // - Desktop users see all avatars (VR and desktop)
    const isVRViewer = window.renderer && window.renderer.xr && window.renderer.xr.isPresenting;
    const isVRAvatar = cameraData.type === 'vr';
    
    if (isVRViewer && isVRAvatar) {
      // VR user viewing another VR user - don't show avatar
      return;
    }
    
    let avatar = userAvatars.get(fromUserId);
    const isVR = cameraData.type === 'vr';
    
    // Create avatar if it doesn't exist or type changed
    if (!avatar || avatar.isVR !== isVR) {
      if (avatar && avatar.group) {
        // Remove old avatar
        try { 
          if (avatar.group.parent) avatar.group.parent.remove(avatar.group);
          avatar.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        } catch(e) {}
      }
      avatar = { group: createUserAvatar(fromUserId, isVR), isVR, lastUpdate: Date.now() };
      if (!avatar.group) return;
    }
    
    const group = avatar.group;
    if (!group) return;
    
    // Update position and rotation
    if (cameraData.position) {
      group.position.set(cameraData.position[0], cameraData.position[1], cameraData.position[2]);
    }
    
    if (cameraData.rotation) {
      group.quaternion.set(
        cameraData.rotation[0], 
        cameraData.rotation[1], 
        cameraData.rotation[2], 
        cameraData.rotation[3]
      );
    }
    
    // Update VR controller positions if available
    if (isVR && cameraData.controllers) {
      const leftController = group.getObjectByName('leftController');
      const rightController = group.getObjectByName('rightController');
      
      if (leftController && cameraData.controllers.left) {
        const pos = cameraData.controllers.left.position;
        const rot = cameraData.controllers.left.rotation;
        if (pos) leftController.position.set(pos[0], pos[1], pos[2]);
        if (rot) leftController.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      }
      
      if (rightController && cameraData.controllers.right) {
        const pos = cameraData.controllers.right.position;
        const rot = cameraData.controllers.right.rotation;
        if (pos) rightController.position.set(pos[0], pos[1], pos[2]);
        if (rot) rightController.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      }
    }
    
    avatar.lastUpdate = Date.now();
    userAvatars.set(fromUserId, avatar);
  }

  function cleanupOldAvatars() {
    // [09] Avatar Reap (timeout) ----------------------------------------------------------------
    const now = Date.now();
    const TIMEOUT = 30000; // 30 seconds
    
    for (const [userId, avatar] of userAvatars.entries()) {
      if (now - avatar.lastUpdate > TIMEOUT) {
        // Remove old avatar
        try {
          if (avatar.group && avatar.group.parent) {
            avatar.group.parent.remove(avatar.group);
          }
          avatar.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        } catch(e) {}
        userAvatars.delete(userId);
      }
    }
  }

  // VR Drawing collaboration handlers
  function ensureVRDrawGroup() {
    // [10] VR Draw Group Ensure -----------------------------------------------------------------
    if (!vrDrawGroup) {
      // Find or create the VR draw group
      if (typeof window !== 'undefined' && window.scene) {
        vrDrawGroup = window.scene.getObjectByName('VRDrawLines');
        if (!vrDrawGroup) {
          vrDrawGroup = new THREE.Group();
          vrDrawGroup.name = 'VRDrawLines';
          window.scene.add(vrDrawGroup);
        }
      }
    }
    return vrDrawGroup;
  }

  function handleVRDrawStart(msg) {
    // [10] VR Draw: Start Stroke ---------------------------------------------------------------
    try {
      const group = ensureVRDrawGroup();
      if (!group) return;

      const { strokeId, point, color, lineWidth, from } = msg;
      
      // Create initial geometry with first point
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([point[0], point[1], point[2]], 3));
      
      const material = new THREE.LineBasicMaterial({ 
        color: color || 0xff0000, 
        linewidth: lineWidth || 2 
      });
      
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.name = `RemoteVRLine_${strokeId}_${from}`;
      
      // Store stroke data
      remoteVRStrokes.set(strokeId, {
        line,
        points: [new THREE.Vector3(point[0], point[1], point[2])],
        color: color || 0xff0000,
        lineWidth: lineWidth || 2
      });
      
      group.add(line);
    } catch (e) {
      console.warn('Failed to handle VR draw start:', e);
    }
  }

  function handleVRDrawPoint(msg) {
    // [10] VR Draw: Add Point ------------------------------------------------------------------
    try {
      const { strokeId, point } = msg;
      const stroke = remoteVRStrokes.get(strokeId);
      
      if (!stroke) return; // Stroke not found
      
      const newPoint = new THREE.Vector3(point[0], point[1], point[2]);
      stroke.points.push(newPoint);
      
      // Update geometry with all points
      const positions = [];
      for (const p of stroke.points) {
        positions.push(p.x, p.y, p.z);
      }
      
      stroke.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      stroke.line.geometry.attributes.position.needsUpdate = true;
      stroke.line.geometry.computeBoundingSphere();
    } catch (e) {
      console.warn('Failed to handle VR draw point:', e);
    }
  }

  function handleVRDrawEnd(msg) {
    // [10] VR Draw: End Stroke ------------------------------------------------------------------
    try {
      const { strokeId } = msg;
      const stroke = remoteVRStrokes.get(strokeId);
      
      if (stroke) {
        // Finalize the stroke - no more updates needed
        // Keep it in the scene but remove from active tracking
        remoteVRStrokes.delete(strokeId);
      }
    } catch (e) {
      console.warn('Failed to handle VR draw end:', e);
    }
  }

  function handleVRDrawClear() {
    // [10] VR Draw: Clear All -------------------------------------------------------------------
    try {
      const group = ensureVRDrawGroup();
      if (!group) return;
      
      // Clear all VR draw lines
      const linesToRemove = [];
      group.traverse(child => {
        if (child.name && child.name.startsWith('RemoteVRLine_')) {
          linesToRemove.push(child);
        }
      });
      
      for (const line of linesToRemove) {
        if (line.parent) line.parent.remove(line);
        if (line.geometry) line.geometry.dispose();
        if (line.material) line.material.dispose();
      }
      
      // Clear tracking map
      remoteVRStrokes.clear();
    } catch (e) {
      console.warn('Failed to handle VR draw clear:', e);
    }
  }

  const onTransform = createSmartThrottle((obj, context) => {
    // [11] Transform Broadcast (throttled + delta) ----------------------------------------------
    if (!obj || applying) return;
    const u = obj.uuid;
    if (!u) return;
    try {
      const p = [obj.position.x, obj.position.y, obj.position.z];
      const q = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
      const s = [obj.scale.x, obj.scale.y, obj.scale.z];
      const transform = { p, q, s };
      
      // Only send if there's a significant change (delta compression)
      if (!hasSignificantChange(u, transform)) return;
      
      // Cache the transform we're sending
      transformCache.set(u, transform);
      
      send('transform', { uuid: u, tr: transform, context });
    } catch {}
  });

  function onDelete(obj) {
    if (!obj || applying) return;
    const u = obj.uuid;
    if (!u) return;
    send('delete', { uuid: u });
  }

  // Broadcast overlay document changes (2D sketch data JSON)
  function onOverlay(data) {
    // [12] Overlay Broadcast --------------------------------------------------------------------
    if (!data || applying) return;
    try { send('overlay', { overlay: data }); } catch {}
  }

  // Camera position sync for user avatars
  function onCameraUpdate(cameraData) {
    // [12] Camera Pose Broadcast ---------------------------------------------------------------
    if (!cameraData || applying) return;
    try { 
      cameraThrottle({
        type: cameraData.type || 'desktop',
        position: cameraData.position,
        rotation: cameraData.rotation,
        controllers: cameraData.controllers || null,
        timestamp: Date.now()
      }); 
    } catch {}
  }

  // Cleanup old avatars periodically
  setInterval(cleanupOldAvatars, 10000); // Every 10 seconds

  // VR Drawing collaboration functions
  function onVRDrawStart(strokeId, point, color, lineWidth) {
    // [13] VR Draw Broadcast: Start --------------------------------------------------------------
    if (applying) return;
    try {
      send('vr_draw_start', { 
        strokeId, 
        point: [point.x, point.y, point.z], 
        color, 
        lineWidth 
      });
    } catch {}
  }

  function onVRDrawPoint(strokeId, point) {
    // [13] VR Draw Broadcast: Point --------------------------------------------------------------
    if (applying) return;
    try {
      send('vr_draw_point', { 
        strokeId, 
        point: [point.x, point.y, point.z] 
      });
    } catch {}
  }

  function onVRDrawEnd(strokeId) {
    // [13] VR Draw Broadcast: End ---------------------------------------------------------------
    if (applying) return;
    try {
      send('vr_draw_end', { strokeId });
    } catch {}
  }

  function onVRDrawClear() {
    // [13] VR Draw Broadcast: Clear -------------------------------------------------------------
    if (applying) return;
    try {
      send('vr_draw_clear', {});
    } catch {}
  }

  // [14] Public API Export ----------------------------------------------------------------------
  return { 
    host, 
    join, 
    leave, 
    isActive, 
    isApplyingRemote, 
    onAdd, 
    onTransform, 
    onDelete, 
    onOverlay, 
    onCameraUpdate,
    onVRDrawStart,
    onVRDrawPoint,
    onVRDrawEnd,
    onVRDrawClear
  };
}
