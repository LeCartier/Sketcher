/*
====================================================================================
ENHANCED ROOM SYSTEM V2 - BOUNDARY-BASED ROOMS
====================================================================================
Plain Meaning:
  Combines traditional mesh-based rooms with automatic boundary detection.
  Rooms can now be either manually designated objects OR automatically detected
  spaces bounded by walls and furniture. Provides a hybrid approach.

Developer Summary:
  Extends the original room system to support:
  1. Traditional mesh-based rooms (backward compatibility)
  2. Boundary-detected rooms (spaces between objects)
  3. Hybrid rooms (detected spaces with manual metadata)
  4. Real-time updates when boundary objects move

Key Concepts:
  Manual Room: User-designated mesh object with room properties
  Detected Room: Automatically found space bounded by objects
  Hybrid Room: Detected space with user-added metadata and name
  Boundary Object: Any mesh that can form room boundaries

Design Goals:
  1. Backward Compatibility: Existing room workflows still work
  2. Automatic Detection: Find rooms without manual designation
  3. Progressive Enhancement: Convert detected rooms to managed rooms
  4. Real-time Updates: Rooms adapt to scene changes
====================================================================================
*/

export function createEnhancedRoomSystem({ THREE, scene, roomBoundaryDetection }) {
  
  // Enhanced room registry - supports both types
  const rooms = new Map(); // id -> Room instance
  const detectedRooms = new Map(); // id -> DetectedRoom instance
  const objectToRoomMap = new WeakMap(); // Three.js object -> Room instance
  let nextRoomId = 1;
  
  // Room type enumeration
  const ROOM_TYPES = {
    MANUAL: 'manual',        // User-designated mesh object
    DETECTED: 'detected',    // Automatically detected space
    HYBRID: 'hybrid'         // Detected space with manual metadata
  };
  
  /**
   * Enhanced Room class - supports multiple room types
   */
  class Room {
    constructor(options = {}) {
      this.id = options.id || `room_${nextRoomId++}`;
      this.type = options.type || ROOM_TYPES.MANUAL;
      this.name = options.name || this.generateDefaultName();
      this.number = options.number || '';
      this.department = options.department || 'Unassigned';
      
      // Geometric properties (different sources based on type)
      this.squareFootage = options.squareFootage || 0;
      this.volume = options.volume || 0;
      this.height = options.height || 8;
      this.dimensions = options.dimensions || { width: 0, depth: 0, height: 8 };
      this.position = options.position || { x: 0, y: 0, z: 0 };
      
      // Type-specific references
      this.meshObject = options.meshObject || null;           // For manual rooms
      this.detectedRoom = options.detectedRoom || null;       // For detected/hybrid rooms
      this.boundaryObjects = options.boundaryObjects || [];   // Objects forming boundaries
      
      // Enhanced metadata
      this.metadata = {
        occupancy: options.occupancy || null,
        function: options.function || '',
        notes: options.notes || '',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        confidence: options.confidence || 1.0,
        autoDetected: this.type !== ROOM_TYPES.MANUAL,
        ...options.metadata
      };
      
      // Calculate properties based on room type
      this.recalculateProperties();
      
      // Register this room
      rooms.set(this.id, this);
      if (this.meshObject) {
        objectToRoomMap.set(this.meshObject, this);
      }
    }
    
    /**
     * Generate default name based on room type and properties
     */
    generateDefaultName() {
      if (this.type === ROOM_TYPES.DETECTED && this.detectedRoom) {
        return this.detectedRoom.suggestedName;
      }
      return `Room ${this.id}`;
    }
    
    /**
     * Recalculate room properties based on type
     */
    recalculateProperties() {
      switch (this.type) {
        case ROOM_TYPES.MANUAL:
          this.calculateFromMesh();
          break;
        case ROOM_TYPES.DETECTED:
        case ROOM_TYPES.HYBRID:
          this.calculateFromDetectedRoom();
          break;
      }
      
      this.metadata.modifiedAt = Date.now();
    }
    
    /**
     * Calculate properties from mesh object (original method)
     */
    calculateFromMesh() {
      if (!this.meshObject) return;
      
      try {
        const bbox = new THREE.Box3().setFromObject(this.meshObject);
        const size = bbox.getSize(new THREE.Vector3());
        
        const isBlockingMass = this.meshObject.userData?.isBlockingMass || false;
        
        this.dimensions = {
          width: size.x,
          depth: size.z,
          height: isBlockingMass ? 
            (this.meshObject.userData?.dimensions?.height || this.height || 8) : 
            size.y
        };
        
        this.height = this.dimensions.height;
        
        // Calculate square footage and volume
        const metersToFeet = 3.28084;
        this.squareFootage = (size.x * size.z) * (metersToFeet * metersToFeet);
        this.volume = (size.x * size.z * this.dimensions.height) * (metersToFeet * metersToFeet * metersToFeet);
        
        // Update position
        const center = bbox.getCenter(new THREE.Vector3());
        this.position = { x: center.x, y: center.y, z: center.z };
        
        this.updateMeshUserData();
        
      } catch (error) {
        console.error('Error calculating room properties from mesh:', error);
      }
    }
    
    /**
     * Calculate properties from detected room
     */
    calculateFromDetectedRoom() {
      if (!this.detectedRoom) return;
      
      try {
        // Use detected room properties
        this.squareFootage = this.detectedRoom.area;
        this.height = this.detectedRoom.metadata.estimatedHeight;
        this.volume = this.squareFootage * this.height;
        
        // Convert centroid to position
        this.position = {
          x: this.detectedRoom.centroid.x,
          y: this.height / 2, // Middle of room height
          z: this.detectedRoom.centroid.z
        };
        
        // Calculate dimensions from polygon bounding box
        this.dimensions = this.calculateDimensionsFromPolygon(this.detectedRoom.polygon);
        
        // Store boundary objects
        this.boundaryObjects = [...this.detectedRoom.boundaryObjects];
        
        // Update confidence from detection
        this.metadata.confidence = this.detectedRoom.metadata.confidence;
        
      } catch (error) {
        console.error('Error calculating room properties from detected room:', error);
      }
    }
    
    /**
     * Calculate dimensions from polygon boundary
     */
    calculateDimensionsFromPolygon(polygon) {
      if (polygon.length === 0) return { width: 0, depth: 0, height: this.height };
      
      let minX = polygon[0].x, maxX = polygon[0].x;
      let minZ = polygon[0].z, maxZ = polygon[0].z;
      
      polygon.forEach(point => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      });
      
      return {
        width: maxX - minX,
        depth: maxZ - minZ,
        height: this.height
      };
    }
    
    /**
     * Update mesh userData (for manual rooms)
     */
    updateMeshUserData() {
      if (!this.meshObject) return;
      
      this.meshObject.userData.room = {
        id: this.id,
        type: this.type,
        name: this.name,
        number: this.number,
        department: this.department,
        squareFootage: this.squareFootage,
        volume: this.volume,
        height: this.height,
        dimensions: this.dimensions,
        metadata: this.metadata,
        isRoom: true
      };
      
      this.meshObject.name = `Room_${this.name.replace(/[^a-zA-Z0-9]/g, '_')}_${this.id}`;
    }
    
    /**
     * Convert detected room to hybrid (add manual metadata)
     */
    promoteToHybrid(manualMetadata = {}) {
      if (this.type !== ROOM_TYPES.DETECTED) return false;
      
      this.type = ROOM_TYPES.HYBRID;
      
      // Apply manual metadata
      Object.assign(this, manualMetadata);
      Object.assign(this.metadata, manualMetadata.metadata || {});
      
      this.metadata.modifiedAt = Date.now();
      this.recalculateProperties();
      
      return true;
    }
    
    /**
     * Update room properties
     */
    updateProperties(updates) {
      const oldValues = { ...this };
      
      Object.assign(this, updates);
      this.metadata.modifiedAt = Date.now();
      
      // Recalculate if dimensions changed
      if (updates.dimensions || updates.height) {
        this.recalculateProperties();
      }
      
      // Update mesh userData for manual rooms
      if (this.type === ROOM_TYPES.MANUAL) {
        this.updateMeshUserData();
      }
      
      this.onUpdate?.(this, oldValues);
      return this;
    }
  }
  
  /**
   * Create room from mesh object (original functionality)
   */
  function createRoomFromObject(meshObject, options = {}) {
    if (!meshObject || !meshObject.isMesh) {
      throw new Error('Invalid mesh object provided');
    }
    
    const room = new Room({
      ...options,
      type: ROOM_TYPES.MANUAL,
      meshObject
    });
    
    return room;
  }
  
  /**
   * Create room from detected space
   */
  function createRoomFromDetection(detectedRoom, options = {}) {
    if (!detectedRoom) {
      throw new Error('Invalid detected room provided');
    }
    
    const room = new Room({
      ...options,
      type: ROOM_TYPES.DETECTED,
      detectedRoom,
      name: options.name || detectedRoom.suggestedName,
      boundaryObjects: detectedRoom.boundaryObjects
    });
    
    return room;
  }

  /**
   * Create room from raw room data (for manual placement)
   */
  function createRoom(roomData) {
    if (!roomData) {
      throw new Error('Invalid room data provided');
    }
    
    // Calculate area from polygon if provided
    let area = roomData.area || 0;
    if (roomData.polygon && roomData.polygon.length > 2) {
      area = calculatePolygonArea(roomData.polygon);
    }
    
    const room = new Room({
      ...roomData,
      type: roomData.type || ROOM_TYPES.MANUAL,
      name: roomData.name || `Room ${rooms.size + 1}`,
      squareFootage: area,
      metadata: {
        polygon: roomData.polygon || [],
        placedManually: roomData.type === ROOM_TYPES.MANUAL,
        ...roomData.metadata
      }
    });
    
    return room;
  }

  /**
   * Calculate area of a polygon
   */
  function calculatePolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i].x * polygon[j].z;
      area -= polygon[j].x * polygon[i].z;
    }
    return Math.abs(area) / 2;
  }
  
  /**
   * Auto-detect rooms and create room objects
   */
  function autoDetectRooms() {
    if (!roomBoundaryDetection) {
      console.warn('Room boundary detection not available');
      return [];
    }
    
    console.log('Starting automatic room detection...');
    
    // Run boundary detection
    const detectedSpaces = roomBoundaryDetection.detectRooms();
    
    const newRooms = [];
    
    // Create room objects for each detected space
    detectedSpaces.forEach(detectedRoom => {
      try {
        const room = createRoomFromDetection(detectedRoom);
        newRooms.push(room);
        console.log(`Created detected room: ${room.name} (${room.squareFootage.toFixed(1)} sq ft)`);
      } catch (error) {
        console.warn('Error creating room from detection:', error);
      }
    });
    
    return newRooms;
  }
  
  /**
   * Update all rooms when scene changes
   */
  function updateRooms() {
    console.log('Updating room system...');
    
    // Update manual rooms
    rooms.forEach(room => {
      if (room.type === ROOM_TYPES.MANUAL) {
        room.recalculateProperties();
      }
    });
    
    // Re-run detection for detected/hybrid rooms
    if (roomBoundaryDetection) {
      roomBoundaryDetection.updateDetection();
      
      // Update detected rooms with new data
      setTimeout(() => {
        const updatedDetections = roomBoundaryDetection.getDetectedRooms();
        
        rooms.forEach(room => {
          if (room.type === ROOM_TYPES.DETECTED || room.type === ROOM_TYPES.HYBRID) {
            // Find corresponding updated detection
            const updatedDetection = updatedDetections.find(det => 
              Math.abs(det.centroid.x - room.detectedRoom.centroid.x) < 1 &&
              Math.abs(det.centroid.z - room.detectedRoom.centroid.z) < 1
            );
            
            if (updatedDetection) {
              room.detectedRoom = updatedDetection;
              room.recalculateProperties();
            }
          }
        });
      }, 1100); // Wait for detection update to complete
    }
  }
  
  /**
   * Get all rooms of a specific type
   */
  function getRoomsByType(type) {
    return Array.from(rooms.values()).filter(room => room.type === type);
  }
  
  /**
   * Get room statistics with type breakdown
   */
  function getRoomStatistics() {
    const allRooms = Array.from(rooms.values());
    
    const stats = {
      total: allRooms.length,
      byType: {
        manual: allRooms.filter(r => r.type === ROOM_TYPES.MANUAL).length,
        detected: allRooms.filter(r => r.type === ROOM_TYPES.DETECTED).length,
        hybrid: allRooms.filter(r => r.type === ROOM_TYPES.HYBRID).length
      },
      totalSquareFootage: allRooms.reduce((sum, room) => sum + room.squareFootage, 0),
      averageConfidence: allRooms.reduce((sum, room) => sum + room.metadata.confidence, 0) / allRooms.length,
      departments: [...new Set(allRooms.map(room => room.department))]
    };
    
    return stats;
  }
  
  /**
   * Find room containing a point
   */
  function getRoomContainingPoint(x, z) {
    // First check detected/hybrid rooms using polygon containment
    for (const room of rooms.values()) {
      if ((room.type === ROOM_TYPES.DETECTED || room.type === ROOM_TYPES.HYBRID) && 
          room.detectedRoom) {
        if (roomBoundaryDetection && 
            roomBoundaryDetection.getRoomContainingPoint(x, z)?.id === room.detectedRoom.id) {
          return room;
        }
      }
    }
    
    // Then check manual rooms using bounding boxes
    for (const room of rooms.values()) {
      if (room.type === ROOM_TYPES.MANUAL && room.meshObject) {
        const bbox = new THREE.Box3().setFromObject(room.meshObject);
        if (x >= bbox.min.x && x <= bbox.max.x && z >= bbox.min.z && z <= bbox.max.z) {
          return room;
        }
      }
    }
    
    return null;
  }
  
  // Expose original room system API for backward compatibility
  function getAllRooms() {
    return Array.from(rooms.values());
  }
  
  function getRoomById(id) {
    return rooms.get(id);
  }
  
  function deleteRoom(roomOrId) {
    const id = typeof roomOrId === 'string' ? roomOrId : roomOrId.id;
    const room = rooms.get(id);
    
    if (room) {
      if (room.meshObject) {
        objectToRoomMap.delete(room.meshObject);
      }
      rooms.delete(id);
      return true;
    }
    
    return false;
  }
  
  function getDepartments() {
    return [...new Set(Array.from(rooms.values()).map(room => room.department))];
  }
  
  function getTotalSquareFootage(department = null) {
    let total = 0;
    rooms.forEach(room => {
      if (!department || room.department === department) {
        total += room.squareFootage;
      }
    });
    return total;
  }
  
  // Enhanced API
  return {
    // Original API (backward compatibility)
    createRoomFromObject,
    getAllRooms,
    getRoomById,
    deleteRoom,
    getDepartments,
    getTotalSquareFootage,
    
    // Enhanced API
    createRoom,
    createRoomFromDetection,
    autoDetectRooms,
    updateRooms,
    getRoomsByType,
    getRoomStatistics,
    getRoomContainingPoint,
    ROOM_TYPES,
    
    // Room class for external access
    Room
  };
}