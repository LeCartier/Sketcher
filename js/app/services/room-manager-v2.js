/*
====================================================================================
ENHANCED ROOM MANAGER V2 - BOUNDARY-AWARE MANAGEMENT
====================================================================================
Plain Meaning:
  Manages both traditional mesh-based rooms and automatically detected boundary-based
  rooms. Provides unified interface for room operations while handling the different
  room types appropriately.

Developer Summary:
  Extends room management to support:
  1. Traditional mesh-based room management (backward compatibility)
  2. Automatic room detection and management
  3. Hybrid room workflows (detected → manually refined)
  4. Real-time updates when boundary objects change
  5. Enhanced UI integration for boundary-based rooms

Key Features:
  Auto Detection: Automatically finds rooms when scene changes
  Progressive Enhancement: Convert detected rooms to managed rooms
  Unified Interface: Same API for all room types
  Real-time Updates: Rooms adapt to boundary changes
====================================================================================
*/

export function createEnhancedRoomManager({ THREE, scene, roomSystem, roomBoundaryDetection, persistence }) {
  
  // Manager state
  let isTracking = true;
  let eventListeners = new Map();
  let autosaveEnabled = true;
  let autosaveDelay = 1000;
  let autosaveTimer = null;
  let autoDetectionEnabled = true;
  let detectionTimer = null;
  
  // Enhanced change tracking
  const changeTracker = {
    added: new Set(),
    modified: new Set(),
    deleted: new Set(),
    detected: new Set(),    // New rooms from auto-detection
    promoted: new Set(),    // Detected rooms promoted to hybrid
    
    clear() {
      this.added.clear();
      this.modified.clear();
      this.deleted.clear();
      this.detected.clear();
      this.promoted.clear();
    },
    
    hasChanges() {
      return this.added.size > 0 || this.modified.size > 0 || this.deleted.size > 0 ||
             this.detected.size > 0 || this.promoted.size > 0;
    }
  };
  
  /**
   * Initialize enhanced room manager
   */
  function initialize() {
    console.log('Initializing Enhanced Room Manager...');
    
    // Scan existing objects (original functionality)
    scanExistingObjects();
    
    // Run initial auto-detection
    if (autoDetectionEnabled && roomBoundaryDetection) {
      runAutoDetection();
    }
    
    // Setup monitoring
    setupAutoCalculation();
    setupBoundaryMonitoring();
    
    // Load saved room data
    loadRoomData();
    
    const stats = roomSystem.getRoomStatistics();
    console.log(`Enhanced Room Manager initialized:`, stats);
  }
  
  /**
   * Scan existing objects (original functionality preserved)
   */
  function scanExistingObjects() {
    if (!scene || !scene.children) return;
    
    let scannedCount = 0;
    
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.userData && (obj.userData.__helper || obj.name?.startsWith('__'))) return;
      
      // Check if object already has room data
      if (obj.userData && obj.userData.room) {
        try {
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
      
      // Check for blocking masses
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
   * Run automatic room detection
   */
  function runAutoDetection() {
    if (!roomBoundaryDetection) return;
    
    console.log('Running automatic room detection...');
    
    try {
      const detectedRooms = roomSystem.autoDetectRooms();
      
      if (detectedRooms.length > 0) {
        console.log(`Auto-detected ${detectedRooms.length} rooms`);
        
        // Track detected rooms
        detectedRooms.forEach(room => {
          changeTracker.detected.add(room.id);
          onRoomAdded(room);
        });
        
        // Trigger autosave
        scheduleAutosave();
        
        // Create visual indicators if available
        if (roomBoundaryDetection.createRoomVisuals) {
          roomBoundaryDetection.createRoomVisuals();
        }
      }
      
    } catch (error) {
      console.error('Error during auto-detection:', error);
    }
  }
  
  /**
   * Setup boundary object monitoring for real-time updates
   */
  function setupBoundaryMonitoring() {
    if (!roomBoundaryDetection) return;
    
    let lastBoundaryCheck = Date.now();
    const BOUNDARY_CHECK_INTERVAL = 2000; // Check every 2 seconds
    
    function checkBoundaryChanges() {
      if (!isTracking || !autoDetectionEnabled) {
        requestAnimationFrame(checkBoundaryChanges);
        return;
      }
      
      const now = Date.now();
      if (now - lastBoundaryCheck >= BOUNDARY_CHECK_INTERVAL) {
        // Check if any boundary objects have moved significantly
        const boundaryObjectsMoved = checkForBoundaryMovement();
        
        if (boundaryObjectsMoved) {
          console.log('Boundary objects moved, updating room detection...');
          scheduleDetectionUpdate();
        }
        
        lastBoundaryCheck = now;
      }
      
      requestAnimationFrame(checkBoundaryChanges);
    }
    
    checkBoundaryChanges();
  }
  
  /**
   * Check if boundary objects have moved significantly
   */
  function checkForBoundaryMovement() {
    // This is a simplified check - a real implementation would track
    // object positions and detect significant movements
    
    const detectedRooms = roomSystem.getRoomsByType(roomSystem.ROOM_TYPES.DETECTED);
    const hybridRooms = roomSystem.getRoomsByType(roomSystem.ROOM_TYPES.HYBRID);
    
    let movementDetected = false;
    
    [...detectedRooms, ...hybridRooms].forEach(room => {
      if (room.boundaryObjects) {
        room.boundaryObjects.forEach(obj => {
          // Check if object position changed significantly
          if (obj.userData && obj.userData.lastTrackedPosition) {
            const currentPos = obj.position;
            const lastPos = obj.userData.lastTrackedPosition;
            const distance = currentPos.distanceTo(lastPos);
            
            if (distance > 0.5) { // 0.5 meter threshold
              movementDetected = true;
            }
          }
          
          // Update tracked position
          obj.userData = obj.userData || {};
          obj.userData.lastTrackedPosition = obj.position.clone();
        });
      }
    });
    
    return movementDetected;
  }
  
  /**
   * Schedule detection update (debounced)
   */
  function scheduleDetectionUpdate() {
    clearTimeout(detectionTimer);
    detectionTimer = setTimeout(() => {
      if (autoDetectionEnabled) {
        updateDetectedRooms();
      }
    }, 2000);
  }
  
  /**
   * Update detected rooms when boundaries change
   */
  function updateDetectedRooms() {
    console.log('Updating detected rooms due to boundary changes...');
    
    try {
      // Update room system
      roomSystem.updateRooms();
      
      // Re-run detection for new spaces
      const newDetections = roomSystem.autoDetectRooms();
      
      if (newDetections.length > 0) {
        console.log(`Found ${newDetections.length} new rooms after boundary update`);
        
        newDetections.forEach(room => {
          changeTracker.detected.add(room.id);
          onRoomAdded(room);
        });
        
        scheduleAutosave();
      }
      
      // Update visuals
      if (roomBoundaryDetection.createRoomVisuals) {
        roomBoundaryDetection.createRoomVisuals();
      }
      
    } catch (error) {
      console.error('Error updating detected rooms:', error);
    }
  }
  
  /**
   * Setup auto-calculation (enhanced from original)
   */
  function setupAutoCalculation() {
    let lastCheckTime = Date.now();
    const CHECK_INTERVAL = 500;
    
    function checkRoomChanges() {
      if (!isTracking) {
        requestAnimationFrame(checkRoomChanges);
        return;
      }
      
      const now = Date.now();
      if (now - lastCheckTime >= CHECK_INTERVAL) {
        // Check manual rooms (original logic)
        roomSystem.getRoomsByType(roomSystem.ROOM_TYPES.MANUAL).forEach(room => {
          if (room.meshObject && room.meshObject.parent) {
            const oldSquareFootage = room.squareFootage;
            const oldVolume = room.volume;
            const oldDimensions = { ...room.dimensions };
            
            room.recalculateProperties();
            
            // Check for meaningful changes
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
    
    checkRoomChanges();
  }
  
  /**
   * Designate object as room (enhanced to handle boundary detection)
   */
  function designateAsRoom(meshObject, options = {}) {
    if (!meshObject || !meshObject.isMesh) {
      throw new Error('Invalid mesh object provided');
    }
    
    // Check if this object is already part of a detected room
    const existingRoom = roomSystem.getAllRooms().find(room => 
      room.boundaryObjects && room.boundaryObjects.includes(meshObject)
    );
    
    if (existingRoom && (existingRoom.type === roomSystem.ROOM_TYPES.DETECTED)) {
      console.log(`Object is part of detected room: ${existingRoom.name}`);
      console.log('Consider promoting the detected room to hybrid instead');
    }
    
    // Create manual room (original functionality)
    const room = roomSystem.createRoomFromObject(meshObject, options);
    
    changeTracker.added.add(room.id);
    onRoomAdded(room);
    scheduleAutosave();
    
    return room;
  }
  
  /**
   * Promote detected room to hybrid (add manual metadata)
   */
  function promoteDetectedRoom(roomId, manualMetadata = {}) {
    const room = roomSystem.getRoomById(roomId);
    
    if (!room || room.type !== roomSystem.ROOM_TYPES.DETECTED) {
      throw new Error('Room not found or not a detected room');
    }
    
    const success = room.promoteToHybrid(manualMetadata);
    
    if (success) {
      changeTracker.promoted.add(room.id);
      onRoomModified(room, { type: roomSystem.ROOM_TYPES.DETECTED });
      scheduleAutosave();
      
      console.log(`Promoted detected room to hybrid: ${room.name}`);
    }
    
    return success;
  }
  
  /**
   * Toggle auto-detection on/off
   */
  function setAutoDetectionEnabled(enabled) {
    autoDetectionEnabled = enabled;
    console.log(`Auto-detection ${enabled ? 'enabled' : 'disabled'}`);
    
    if (enabled && roomBoundaryDetection) {
      runAutoDetection();
    }
  }
  
  /**
   * Manually trigger room detection
   */
  function triggerDetection() {
    if (roomBoundaryDetection) {
      console.log('Manually triggering room detection...');
      runAutoDetection();
    } else {
      console.warn('Room boundary detection not available');
    }
  }
  
  /**
   * Get enhanced room statistics
   */
  function getEnhancedStatus() {
    const basicStats = roomSystem.getRoomStatistics();
    const changeStats = {
      added: changeTracker.added.size,
      modified: changeTracker.modified.size,
      deleted: changeTracker.deleted.size,
      detected: changeTracker.detected.size,
      promoted: changeTracker.promoted.size,
      hasChanges: changeTracker.hasChanges()
    };
    
    return {
      ...basicStats,
      changes: changeStats,
      autoDetectionEnabled,
      boundaryDetectionAvailable: !!roomBoundaryDetection
    };
  }
  
  // Event handling (extended from original)
  function onRoomAdded(room) {
    emit('roomAdded', { room, type: room.type });
  }
  
  function onRoomModified(room, oldValues) {
    changeTracker.modified.add(room.id);
    emit('roomModified', { room, oldValues, type: room.type });
  }
  
  function onRoomDeleted(room) {
    changeTracker.deleted.add(room.id);
    emit('roomDeleted', { room, type: room.type });
  }
  
  // Utility functions from original
  function scheduleAutosave() {
    if (!autosaveEnabled) return;
    
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      saveRoomData();
    }, autosaveDelay);
  }
  
  function saveRoomData() {
    if (!persistence || !changeTracker.hasChanges()) return;
    
    try {
      const roomData = {
        rooms: roomSystem.getAllRooms().map(room => ({
          id: room.id,
          type: room.type,
          name: room.name,
          number: room.number,
          department: room.department,
          squareFootage: room.squareFootage,
          volume: room.volume,
          height: room.height,
          dimensions: room.dimensions,
          position: room.position,
          metadata: room.metadata
        })),
        timestamp: Date.now(),
        version: '2.0' // Enhanced version
      };
      
      persistence.save('roomData', roomData);
      changeTracker.clear();
      
      console.log(`Saved ${roomData.rooms.length} rooms to persistence`);
      
    } catch (error) {
      console.error('Error saving room data:', error);
    }
  }
  
  function loadRoomData() {
    if (!persistence) return;
    
    try {
      const roomData = persistence.load('roomData');
      if (!roomData) return;
      
      console.log(`Loading ${roomData.rooms?.length || 0} rooms from persistence`);
      
      // Handle different versions
      if (roomData.version === '2.0') {
        // Enhanced format - includes room types
        roomData.rooms?.forEach(data => {
          // Skip rooms that already exist (from scanning)
          if (roomSystem.getRoomById(data.id)) return;
          
          // Only load manual rooms from persistence
          // Detected rooms will be recreated by auto-detection
          if (data.type === roomSystem.ROOM_TYPES.MANUAL) {
            // Find corresponding mesh object
            scene.traverse(obj => {
              if (obj.userData && obj.userData.room && obj.userData.room.id === data.id) {
                roomSystem.createRoomFromObject(obj, data);
              }
            });
          }
        });
      } else {
        // Legacy format - treat as manual rooms
        roomData.rooms?.forEach(data => {
          if (roomSystem.getRoomById(data.id)) return;
          
          scene.traverse(obj => {
            if (obj.userData && obj.userData.room && obj.userData.room.id === data.id) {
              roomSystem.createRoomFromObject(obj, data);
            }
          });
        });
      }
      
    } catch (error) {
      console.error('Error loading room data:', error);
    }
  }
  
  // Event emitter functionality (from original)
  function addEventListener(eventName, callback) {
    if (!eventListeners.has(eventName)) {
      eventListeners.set(eventName, new Set());
    }
    eventListeners.get(eventName).add(callback);
  }
  
  function removeEventListener(eventName, callback) {
    const listeners = eventListeners.get(eventName);
    if (listeners) {
      listeners.delete(callback);
    }
  }
  
  function emit(eventName, data) {
    const listeners = eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }
  }
  
  // Public API (enhanced)
  return {
    // Original API
    initialize,
    designateAsRoom,
    removeRoom: (roomOrId) => roomSystem.deleteRoom(roomOrId),
    getAllRooms: () => roomSystem.getAllRooms(),
    getRoomById: (id) => roomSystem.getRoomById(id),
    getStatus: getEnhancedStatus,
    addEventListener,
    removeEventListener,
    
    // Enhanced API
    promoteDetectedRoom,
    setAutoDetectionEnabled,
    triggerDetection,
    updateDetectedRooms,
    getRoomsByType: (type) => roomSystem.getRoomsByType(type),
    getRoomStatistics: () => roomSystem.getRoomStatistics(),
    getRoomContainingPoint: (x, z) => roomSystem.getRoomContainingPoint(x, z)
  };
}