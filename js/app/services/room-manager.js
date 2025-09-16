/*
====================================================================================
ROOM MANAGER SERVICE (createRoomManager)
====================================================================================
Plain Meaning:
  Keeps a clean list of “rooms” in the scene, watches for changes, saves them, and
  lets other parts of the app know when something (added / edited / deleted) happens.

Developer Summary:
  Wraps a lower-level roomSystem with higher-level behaviors: scanning, designation,
  modification tracking, autosave debouncing, validation, and event fan‑out. Functions
  as the orchestration layer between raw scene meshes and persistent room data.

Design Goals:
  1. Non‑intrusive: Adds metadata without forcing mesh destruction/rebuild.
  2. Debounced persistence: Avoid excessive writes while still feeling reactive.
  3. Transparent introspection: getStatus / changeTracker counts for UI dashboards.
  4. Resilience: Defensive try/catch around persistence & geometry recalculations.

Key Concepts (High‑Level):
  Room: Logical container representing space with geometry (meshObject) + properties.
  Change Tracker: Three sets (added / modified / deleted) used for autosave + UI badges.
  Autosave: Timer resets on each change; flushes aggregated changes after delay.
  Scan: On init, attempts to reconstruct rooms from mesh userData or blocking masses.
  Issues: Basic data quality checks (missing name, department, geometry, etc.).

Table of Contents (Numbered Sections):
  [01] Internal State & Change Tracker
  [02] Initialization Sequence
  [03] Scene Scan for Existing Rooms
  [04] Auto Calculation Loop (Geometry Updates)
  [05] Designate / Remove / Update Room Operations
  [06] Change Event Hooks (Added / Modified / Deleted)
  [07] Autosave Scheduling & Persistence (save / load)
  [08] Issues Detection & Validation / Repair
  [09] Event Emitter (add/remove/emit)
  [10] Status Reporting (getStatus)
  [11] Public API Export

Reading Guide:
  Each bracketed section in code has Plain (non‑coder) and Dev (implementation) notes.
------------------------------------------------------------------------------------
*/

export function createRoomManager({ THREE, scene, roomSystem, persistence }) {
  // [01] STATE & CHANGE TRACKER
  // Plain: Store flags (tracking on?), event handlers, and which rooms changed.
  // Dev:   changeTracker uses Sets for O(1) membership and easy size counts.
  
  let isTracking = true;
  let eventListeners = new Map();
  let autosaveEnabled = true;
  let autosaveDelay = 1000; // 1 second delay after changes
  let autosaveTimer = null;
  
  // Room change tracking
  const changeTracker = {
    added: new Set(),
    modified: new Set(),
    deleted: new Set(),
    
    clear() {
      this.added.clear();
      this.modified.clear();
      this.deleted.clear();
    },
    
    hasChanges() {
      return this.added.size > 0 || this.modified.size > 0 || this.deleted.size > 0;
    }
  };
  
  /**
   * Initialize room manager and scan existing objects
   */
  // [02] INITIALIZATION
  // Plain: Kick off scanning, set up geometry watching, and load saved data.
  // Dev:   Order chosen so existing meshes become rooms before persistence import.
  function initialize() {
    console.log('Initializing Room Manager...');
    
    // Scan existing objects for room data
    scanExistingObjects();
    
    // Setup auto-calculation for room properties
    setupAutoCalculation();
    
    // Load saved room data if available
    loadRoomData();
    
    console.log(`Room Manager initialized with ${roomSystem.getAllRooms().length} rooms`);
  }
  
  /**
   * Scan scene for existing objects that could be rooms
   */
  // [03] SCENE SCAN
  // Plain: Walk every mesh; if it already has room info, rebuild a Room instance.
  // Dev:   Also converts blocking masses (room_mass) into formal rooms.
  function scanExistingObjects() {
    if (!scene || !scene.children) return;
    
    let scannedCount = 0;
    
    scene.traverse(obj => {
      // Skip non-mesh objects
      if (!obj.isMesh) return;
      
      // Skip helper objects
      if (obj.userData && (obj.userData.__helper || obj.name?.startsWith('__'))) return;
      
      // Check if object already has room data
      if (obj.userData && obj.userData.room) {
        try {
          // Try to recreate room from existing userData
          const roomData = obj.userData.room;
          const room = roomSystem.createRoomFromObject(obj, {
            id: roomData.id,
            name: roomData.name,
            number: roomData.number,
            department: roomData.department,
            height: roomData.height,
            metadata: roomData.metadata
          });
          scannedCount++;
        } catch (error) {
          console.warn('Error recreating room from userData:', error);
        }
      }
      
      // Check for blocking masses created by blocking system
      else if (obj.userData && obj.userData.type === 'room_mass' && obj.userData.isBlockingMass) {
        try {
          const room = roomSystem.createRoomFromObject(obj, {
            name: obj.userData.roomName || 'Imported Room',
            department: obj.userData.department || 'Unassigned',
            height: obj.userData.dimensions?.height || 8
          });
          scannedCount++;
        } catch (error) {
          console.warn('Error converting blocking mass to room:', error);
        }
      }
    });
    
    if (scannedCount > 0) {
      console.log(`Scanned and converted ${scannedCount} existing objects to rooms`);
    }
  }
  
  /**
   * Setup automatic calculation of room properties when objects change
   */
  // [04] AUTO CALCULATION LOOP
  // Plain: Every few seconds re-measure room geometry to update square footage.
  // Dev:   Lightweight polling (Box3-based inside room.calculateFromMesh). Debounced by interval.
  function setupAutoCalculation() {
    // Set up periodic check for room geometry changes
    let lastCheckTime = Date.now();
    const CHECK_INTERVAL = 500; // Reduced to 500ms for more responsive updates
    
    function checkRoomChanges() {
      if (!isTracking) {
        requestAnimationFrame(checkRoomChanges);
        return;
      }
      
      const now = Date.now();
      if (now - lastCheckTime >= CHECK_INTERVAL) {
        // Check all rooms for geometry changes
        roomSystem.getAllRooms().forEach(room => {
          if (room.meshObject && room.meshObject.parent) {
            const oldSquareFootage = room.squareFootage;
            const oldVolume = room.volume;
            const oldDimensions = { ...room.dimensions };
            
            room.calculateFromMesh();
            
            // Check for meaningful changes (more than 0.1 sq ft or 0.1 cubic ft)
            const squareFootageChanged = Math.abs(room.squareFootage - oldSquareFootage) > 0.1;
            const volumeChanged = Math.abs(room.volume - oldVolume) > 0.1;
            const dimensionsChanged = Math.abs(room.dimensions.width - oldDimensions.width) > 0.01 ||
                                     Math.abs(room.dimensions.height - oldDimensions.height) > 0.01 ||
                                     Math.abs(room.dimensions.depth - oldDimensions.depth) > 0.01;
            
            if (squareFootageChanged || volumeChanged || dimensionsChanged) {
              onRoomModified(room, {
                squareFootage: oldSquareFootage,
                volume: oldVolume,
                dimensions: oldDimensions
              });
            }
          }
        });
        
        lastCheckTime = now;
      }
      
      requestAnimationFrame(checkRoomChanges);
    }
    
    // Start the check loop
    requestAnimationFrame(checkRoomChanges);
  }
  
  /**
   * Designate an existing object as a room
   * @param {THREE.Object3D} object - Object to convert
   * @param {Object} roomProperties - Room properties
   * @returns {Room|null} Created room or null
   */
  // [05] ROOM DESIGNATION (CREATE)
  // Plain: Mark a mesh as a room, assign defaults, track as added.
  // Dev:   Delegates heavy lifting to roomSystem.createRoomFromObject.
  function designateAsRoom(object, roomProperties = {}) {
    if (!object || !object.isMesh) {
      console.warn('Cannot designate non-mesh object as room');
      return null;
    }
    
    // Check if object is already a room
    const existingRoom = roomSystem.getRoomFromObject(object);
    if (existingRoom) {
      console.warn('Object is already designated as a room:', existingRoom.name);
      return existingRoom;
    }
    
    try {
      const room = roomSystem.createRoomFromObject(object, {
        name: roomProperties.name || `Room ${roomSystem.getAllRooms().length + 1}`,
        number: roomProperties.number || '',
        department: roomProperties.department || 'Unassigned',
        height: roomProperties.height || 8,
        ...roomProperties
      });
      
      onRoomAdded(room);
      
      console.log(`Designated "${room.name}" as room with ${room.squareFootage.toFixed(1)} sq ft`);
      return room;
      
    } catch (error) {
      console.error('Error designating object as room:', error);
      return null;
    }
  }
  
  /**
   * Remove room designation from an object
   * @param {THREE.Object3D|string} objectOrId - Object or room ID
   * @returns {boolean} Success status
   */
  // [05B] ROOM DESIGNATION REMOVAL (DELETE)
  // Plain: Strip room metadata but keep the 3D object.
  // Dev:   Deletes userData.room, updates tracker & roomSystem.
  function removeRoomDesignation(objectOrId) {
    let room;
    
    if (typeof objectOrId === 'string') {
      room = roomSystem.getRoomById(objectOrId);
    } else {
      room = roomSystem.getRoomFromObject(objectOrId);
    }
    
    if (!room) {
      console.warn('No room found to remove designation');
      return false;
    }
    
    // Clear room userData from mesh but keep the mesh
    if (room.meshObject && room.meshObject.userData) {
      delete room.meshObject.userData.room;
      room.meshObject.name = room.meshObject.name.replace(/^Room_.*_/, '');
    }
    
    onRoomDeleted(room);
    
    const success = roomSystem.deleteRoom(room);
    
    if (success) {
      console.log(`Removed room designation from "${room.name}"`);
    }
    
    return success;
  }
  
  /**
   * Update room properties
   * @param {string|Room} roomOrId - Room or room ID
   * @param {Object} updates - Property updates
   * @returns {Room|null} Updated room
   */
  // [05C] ROOM UPDATE
  // Plain: Apply property edits (name, number, department, etc.).
  // Dev:   Snapshot old data for potential diff / event consumers.
  function updateRoom(roomOrId, updates) {
    const room = typeof roomOrId === 'string' ? roomSystem.getRoomById(roomOrId) : roomOrId;
    if (!room) return null;
    
    const oldData = { ...room };
    room.updateProperties(updates);
    
    onRoomModified(room, oldData);
    
    return room;
  }
  
  /**
   * Handle room added event
   * @param {Room} room - Added room
   */
  // [06] CHANGE HOOK: ADDED
  function onRoomAdded(room) {
    changeTracker.added.add(room.id);
    emitEvent('roomAdded', { room });
    scheduleAutosave();
  }
  
  /**
   * Handle room modified event
   * @param {Room} room - Modified room
   * @param {Object} oldData - Previous room data
   */
  // [06B] CHANGE HOOK: MODIFIED
  function onRoomModified(room, oldData = null) {
    changeTracker.modified.add(room.id);
    emitEvent('roomModified', { room, oldData, timestamp: Date.now() });
    scheduleAutosave();
  }
  
  /**
   * Handle room deleted event
   * @param {Room} room - Deleted room
   */
  // [06C] CHANGE HOOK: DELETED
  function onRoomDeleted(room) {
    changeTracker.deleted.add(room.id);
    emitEvent('roomDeleted', { room });
    scheduleAutosave();
  }
  
  /**
   * Schedule autosave if enabled
   */
  // [07] AUTOSAVE SCHEDULER
  // Plain: Wait briefly after a change, then save so repeated edits don’t spam storage.
  // Dev:   Simple resettable timeout; could be upgraded to requestIdleCallback if needed.
  function scheduleAutosave() {
    if (!autosaveEnabled) return;
    
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    
    autosaveTimer = setTimeout(() => {
      saveRoomData();
      autosaveTimer = null;
    }, autosaveDelay);
  }
  
  /**
   * Save room data to persistence
   */
  // [07B] SAVE PERSISTENCE
  // Plain: Serialize rooms and stash in sessionStorage.
  // Dev:   Versioned payload allows future migration logic.
  function saveRoomData() {
    if (!persistence) return;
    
    try {
      const roomsData = roomSystem.exportRoomsData();
      const saveData = {
        rooms: roomsData,
        timestamp: Date.now(),
        version: '1.0'
      };
      
      // Save to session storage for now
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('sketcher_rooms', JSON.stringify(saveData));
      }
      
      changeTracker.clear();
      emitEvent('roomDataSaved', { roomCount: roomsData.length });
      
      console.log(`Saved ${roomsData.length} rooms to storage`);
      
    } catch (error) {
      console.error('Error saving room data:', error);
    }
  }
  
  /**
   * Load room data from persistence
   */
  // [07C] LOAD PERSISTENCE
  // Plain: Restore rooms from last session so user doesn’t lose work.
  // Dev:   Re-add meshes to scene if detached; silent if malformed.
  function loadRoomData() {
    if (!persistence) return;
    
    try {
      // Load from session storage for now
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const saved = window.sessionStorage.getItem('sketcher_rooms');
        if (saved) {
          const saveData = JSON.parse(saved);
          if (saveData.rooms && Array.isArray(saveData.rooms)) {
            const loadedRooms = roomSystem.importRoomsData(saveData.rooms);
            
            // Add room meshes to scene if they don't exist
            loadedRooms.forEach(room => {
              if (room.meshObject && !room.meshObject.parent) {
                scene.add(room.meshObject);
              }
            });
            
            emitEvent('roomDataLoaded', { roomCount: loadedRooms.length });
            console.log(`Loaded ${loadedRooms.length} rooms from storage`);
          }
        }
      }
    } catch (error) {
      console.error('Error loading room data:', error);
    }
  }
  
  /**
   * Get rooms that need attention (missing data, calculation errors, etc.)
   * @returns {Array<Object>} Array of room issues
   */
  // [08] ISSUE DETECTION
  // Plain: List rooms with missing name, department, geometry, or size problems.
  // Dev:   Returns structured issue objects for UI panels.
  function getRoomIssues() {
    const issues = [];
    
    roomSystem.getAllRooms().forEach(room => {
      const roomIssues = [];
      
      // Check for missing required data
      if (!room.name || room.name.trim() === '') {
        roomIssues.push({ type: 'missing_name', message: 'Room name is missing' });
      }
      
      if (!room.department || room.department === 'Unassigned') {
        roomIssues.push({ type: 'missing_department', message: 'Department not assigned' });
      }
      
      if (room.squareFootage <= 0) {
        roomIssues.push({ type: 'invalid_size', message: 'Invalid or zero square footage' });
      }
      
      // Check for geometry issues
      if (!room.meshObject) {
        roomIssues.push({ type: 'missing_geometry', message: 'No 3D geometry associated' });
      } else if (!room.meshObject.parent) {
        roomIssues.push({ type: 'not_in_scene', message: 'Geometry not added to scene' });
      }
      
      if (roomIssues.length > 0) {
        issues.push({
          room,
          issues: roomIssues
        });
      }
    });
    
    return issues;
  }
  
  /**
   * Validate and fix room data
   * @returns {Object} Validation results
   */
  // [08B] VALIDATE / FIX
  // Plain: Recalculates geometry, ensures meshes are attached, updates metadata.
  // Dev:   Collects counts; schedules autosave if anything changed.
  function validateAndFixRooms() {
    const results = {
      validated: 0,
      fixed: 0,
      errors: []
    };
    
    roomSystem.getAllRooms().forEach(room => {
      results.validated++;
      
      try {
        // Recalculate properties from mesh
        if (room.meshObject) {
          const oldSquareFootage = room.squareFootage;
          room.calculateFromMesh();
          
          if (Math.abs(room.squareFootage - oldSquareFootage) > 0.1) {
            results.fixed++;
          }
        }
        
        // Ensure mesh is in scene
        if (room.meshObject && !room.meshObject.parent) {
          scene.add(room.meshObject);
          results.fixed++;
        }
        
        // Update userData
        room.updateMeshUserData();
        
      } catch (error) {
        results.errors.push({
          roomId: room.id,
          error: error.message
        });
      }
    });
    
    if (results.fixed > 0) {
      scheduleAutosave();
    }
    
    return results;
  }
  
  /**
   * Add event listener
   * @param {string} eventType - Event type
   * @param {Function} handler - Event handler
   */
  // [09] EVENT LISTENERS (ADD)
  function addEventListener(eventType, handler) {
    if (!eventListeners.has(eventType)) {
      eventListeners.set(eventType, []);
    }
    eventListeners.get(eventType).push(handler);
  }
  
  /**
   * Remove event listener
   * @param {string} eventType - Event type
   * @param {Function} handler - Event handler
   */
  // [09B] EVENT LISTENERS (REMOVE)
  function removeEventListener(eventType, handler) {
    const handlers = eventListeners.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }
  
  /**
   * Emit event to listeners
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   */
  // [09C] EMIT EVENT
  function emitEvent(eventType, data) {
    const handlers = eventListeners.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in room manager event handler for ${eventType}:`, error);
        }
      });
    }
  }
  
  /**
   * Get room manager status
   * @returns {Object} Status information
   */
  // [10] STATUS REPORTING
  // Plain: Snapshot counts for UI (rooms, departments, pending changes, issues).
  // Dev:   Uses roomSystem.getRoomStatistics for base aggregates.
  function getStatus() {
    const stats = roomSystem.getRoomStatistics();
    
    return {
      isTracking,
      autosaveEnabled,
      hasUnsavedChanges: changeTracker.hasChanges(),
      roomCount: stats.totalRooms,
      departmentCount: stats.departments,
      totalSquareFootage: stats.totalSquareFootage,
      issues: getRoomIssues().length,
      changeTracker: {
        added: changeTracker.added.size,
        modified: changeTracker.modified.size,
        deleted: changeTracker.deleted.size
      }
    };
  }
  
  // Return public API
  /**
   * Force immediate update of all room calculations
   */
  function forceUpdateAllRooms() {
    const updatedRooms = [];
    roomSystem.getAllRooms().forEach(room => {
      if (room.meshObject && room.meshObject.parent) {
        const oldData = {
          squareFootage: room.squareFootage,
          volume: room.volume,
          dimensions: { ...room.dimensions }
        };
        
        room.calculateFromMesh();
        
        // Check if anything actually changed
        const changed = Math.abs(room.squareFootage - oldData.squareFootage) > 0.01 ||
                       Math.abs(room.volume - oldData.volume) > 0.01 ||
                       Math.abs(room.dimensions.width - oldData.dimensions.width) > 0.001;
        
        if (changed) {
          onRoomModified(room, oldData);
          updatedRooms.push(room);
        }
      }
    });
    
    return updatedRooms;
  }
  
  /**
   * Force update of specific room by ID
   */
  function forceUpdateRoom(roomId) {
    const room = roomSystem.getRoomById(roomId);
    if (!room || !room.meshObject) return false;
    
    const oldData = {
      squareFootage: room.squareFootage,
      volume: room.volume,
      dimensions: { ...room.dimensions }
    };
    
    room.calculateFromMesh();
    onRoomModified(room, oldData);
    return true;
  }
  
  // [11] PUBLIC API EXPORT
  // Plain: Methods other modules call (UI forms, save buttons, dashboards).
  // Dev:   Prefixed internals (_changeTracker) exposed strictly for debugging/testing.
  return {
    // Initialization
    initialize,
    
    // Room management
    designateAsRoom,
    removeRoomDesignation,
    updateRoom,
    
    // Data persistence
    saveRoomData,
    loadRoomData,
    
    // Validation and maintenance
    getRoomIssues,
    validateAndFixRooms,
    scanExistingObjects,
    
    // Live updates
    forceUpdateAllRooms,
    forceUpdateRoom,
    
    // Event handling
    addEventListener,
    removeEventListener,
    
    // Configuration
    setTracking: (enabled) => { isTracking = enabled; },
    setAutosave: (enabled) => { autosaveEnabled = enabled; },
    setAutosaveDelay: (delay) => { autosaveDelay = delay; },
    
    // Status
    getStatus,
    hasUnsavedChanges: () => changeTracker.hasChanges(),
    
    // Internal access
    _changeTracker: changeTracker,
    _eventListeners: eventListeners
  };
}