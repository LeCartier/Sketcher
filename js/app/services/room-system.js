// Room System Service: Manages room objects with metadata tracking
// Provides comprehensive room management with square footage, volume, departments, etc.

export function createRoomSystem({ THREE, scene }) {
  
  // Room registry to track all rooms
  const roomRegistry = new Map(); // id -> Room instance
  const objectToRoomMap = new WeakMap(); // Three.js object -> Room instance
  let nextRoomId = 1;
  
  /**
   * Room class - represents a room with full architectural metadata
   */
  class Room {
    constructor(options = {}) {
      this.id = options.id || `room_${nextRoomId++}`;
      this.name = options.name || `Room ${this.id}`;
      this.number = options.number || '';
      this.department = options.department || 'Unassigned';
      this.squareFootage = options.squareFootage || 0;
      this.volume = options.volume || 0;
      this.height = options.height || 8; // Default 8 feet
      
      // Geometric properties
      this.dimensions = options.dimensions || { width: 0, depth: 0, height: 8 };
      this.position = options.position || { x: 0, y: 0, z: 0 };
      
      // Three.js object reference
      this.meshObject = options.meshObject || null;
      
      // Additional metadata
      this.metadata = {
        occupancy: options.occupancy || null,
        function: options.function || '',
        notes: options.notes || '',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        ...options.metadata
      };
      
      // Automatically calculate properties if mesh is provided
      if (this.meshObject) {
        this.calculateFromMesh();
      }
      
      // Register this room
      roomRegistry.set(this.id, this);
      if (this.meshObject) {
        objectToRoomMap.set(this.meshObject, this);
      }
    }
    
    /**
     * Calculate room properties from the associated 3D mesh
     */
    calculateFromMesh() {
      if (!this.meshObject) return;
      
      try {
        // Get bounding box for dimensions
        const bbox = new THREE.Box3().setFromObject(this.meshObject);
        const size = bbox.getSize(new THREE.Vector3());
        
        // Determine if this is a blocking mass or regular object
        const isBlockingMass = this.meshObject.userData?.isBlockingMass || false;
        
        this.dimensions = {
          width: size.x,
          depth: size.z,
          // For blocking masses, preserve user-defined height from userData
          // For regular objects, use geometry height from mesh
          height: isBlockingMass ? 
            (this.meshObject.userData?.dimensions?.height || this.height || 8) : 
            size.y
        };
        
        // Update the room's height property to match dimensions
        this.height = this.dimensions.height;
        
        // Calculate square footage (width * depth, converted from meters to sq ft)
        const metersToFeet = 3.28084;
        this.squareFootage = (size.x * size.z) * (metersToFeet * metersToFeet);
        
        // Calculate volume using the room height (width * depth * height in cubic feet)
        this.volume = (size.x * size.z * this.dimensions.height) * (metersToFeet * metersToFeet * metersToFeet);
        
        // Update position
        const center = bbox.getCenter(new THREE.Vector3());
        this.position = { x: center.x, y: center.y, z: center.z };
        
        this.metadata.modifiedAt = Date.now();
        
        // Update mesh userData
        this.updateMeshUserData();
        
      } catch (error) {
        console.error('Error calculating room properties:', error);
      }
    }
    
    /**
     * Update the Three.js mesh userData with current room information
     */
    updateMeshUserData() {
      if (!this.meshObject) return;
      
      this.meshObject.userData.room = {
        id: this.id,
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
      
      // Update mesh name for clarity
      this.meshObject.name = `Room_${this.name.replace(/[^a-zA-Z0-9]/g, '_')}_${this.id}`;
    }
    
    /**
     * Update room properties
     */
    updateProperties(updates) {
      const oldValues = { ...this };
      
      Object.assign(this, updates);
      this.metadata.modifiedAt = Date.now();
      
      // If dimensions changed, update mesh geometry
      if (updates.dimensions && this.meshObject) {
        this.updateMeshGeometry();
      }
      
      // Always update userData
      this.updateMeshUserData();
      
      // Trigger update event
      this.onUpdate?.(this, oldValues);
      
      return this;
    }
    
    /**
     * Update mesh geometry based on room dimensions
     */
    updateMeshGeometry() {
      if (!this.meshObject || !this.meshObject.isMesh) return;
      
      try {
        // Dispose old geometry
        if (this.meshObject.geometry) {
          this.meshObject.geometry.dispose();
        }
        
        // Create new geometry with updated dimensions
        const geometry = new THREE.BoxGeometry(
          this.dimensions.width,
          this.dimensions.height,
          this.dimensions.depth
        );
        
        this.meshObject.geometry = geometry;
        
        // Update position to match room position
        this.meshObject.position.set(
          this.position.x,
          this.position.y,
          this.position.z
        );
        
      } catch (error) {
        console.error('Error updating mesh geometry:', error);
      }
    }
    
    /**
     * Calculate square footage from dimensions
     */
    calculateSquareFootage() {
      const metersToFeet = 3.28084;
      this.squareFootage = (this.dimensions.width * this.dimensions.depth) * (metersToFeet * metersToFeet);
      return this.squareFootage;
    }
    
    /**
     * Calculate volume from dimensions
     */
    calculateVolume() {
      const metersToFeet = 3.28084;
      this.volume = (this.dimensions.width * this.dimensions.depth * this.dimensions.height) * 
                   (metersToFeet * metersToFeet * metersToFeet);
      return this.volume;
    }
    
    /**
     * Get room summary for display
     */
    getSummary() {
      return {
        id: this.id,
        name: this.name,
        number: this.number,
        department: this.department,
        squareFootage: Math.round(this.squareFootage * 100) / 100,
        volume: Math.round(this.volume * 100) / 100,
        height: this.height,
        dimensions: {
          width: Math.round(this.dimensions.width * 100) / 100,
          depth: Math.round(this.dimensions.depth * 100) / 100,
          height: Math.round(this.dimensions.height * 100) / 100
        },
        position: this.position,
        metadata: this.metadata
      };
    }
    
    /**
     * Export room data for persistence
     */
    export() {
      return {
        id: this.id,
        name: this.name,
        number: this.number,
        department: this.department,
        squareFootage: this.squareFootage,
        volume: this.volume,
        height: this.height,
        dimensions: this.dimensions,
        position: this.position,
        metadata: this.metadata
      };
    }
    
    /**
     * Destroy room and cleanup
     */
    destroy() {
      // Remove from registry
      roomRegistry.delete(this.id);
      
      // Remove from object map
      if (this.meshObject) {
        objectToRoomMap.delete(this.meshObject);
      }
      
      // Clear references
      this.meshObject = null;
      this.onUpdate = null;
    }
  }
  
  /**
   * Create a new room from a 3D object
   * @param {THREE.Object3D} meshObject - Three.js object to convert to room
   * @param {Object} options - Room properties
   * @returns {Room} Created room instance
   */
  function createRoomFromObject(meshObject, options = {}) {
    if (!meshObject) {
      throw new Error('Mesh object is required to create a room');
    }
    
    const room = new Room({
      ...options,
      meshObject
    });
    
    console.log(`Created room "${room.name}" with ${room.squareFootage.toFixed(1)} sq ft`);
    return room;
  }
  
  /**
   * Create a new room with specified dimensions
   * @param {Object} options - Room creation options
   * @returns {Room} Created room instance
   */
  function createRoom(options = {}) {
    const room = new Room(options);
    
    // Create mesh if dimensions are provided
    if (options.dimensions && (options.dimensions.width > 0 && options.dimensions.depth > 0)) {
      const geometry = new THREE.BoxGeometry(
        options.dimensions.width,
        options.dimensions.height || 8,
        options.dimensions.depth
      );
      
      // Create material based on department
      const material = createRoomMaterial(options.department);
      const mesh = new THREE.Mesh(geometry, material);
      
      // Position the mesh
      if (options.position) {
        mesh.position.set(options.position.x, options.position.y, options.position.z);
      }
      
      room.meshObject = mesh;
      room.updateMeshUserData();
      objectToRoomMap.set(mesh, room);
    }
    
    return room;
  }
  
  /**
   * Get room associated with a Three.js object
   * @param {THREE.Object3D} object - Three.js object
   * @returns {Room|null} Room instance or null
   */
  function getRoomFromObject(object) {
    return objectToRoomMap.get(object) || null;
  }
  
  /**
   * Get room by ID
   * @param {string} id - Room ID
   * @returns {Room|null} Room instance or null
   */
  function getRoomById(id) {
    return roomRegistry.get(id) || null;
  }
  
  /**
   * Get all rooms
   * @returns {Array<Room>} Array of all rooms
   */
  function getAllRooms() {
    return Array.from(roomRegistry.values());
  }
  
  /**
   * Get rooms by department
   * @param {string} department - Department name
   * @returns {Array<Room>} Array of rooms in department
   */
  function getRoomsByDepartment(department) {
    return getAllRooms().filter(room => room.department === department);
  }
  
  /**
   * Get all unique departments
   * @returns {Array<string>} Array of department names
   */
  function getDepartments() {
    const departments = new Set();
    getAllRooms().forEach(room => departments.add(room.department));
    return Array.from(departments).sort();
  }
  
  /**
   * Delete a room
   * @param {string|Room} roomOrId - Room instance or room ID
   * @returns {boolean} True if deleted successfully
   */
  function deleteRoom(roomOrId) {
    const room = typeof roomOrId === 'string' ? getRoomById(roomOrId) : roomOrId;
    if (!room) return false;
    
    // Remove mesh from scene if it exists
    if (room.meshObject && room.meshObject.parent) {
      room.meshObject.parent.remove(room.meshObject);
      
      // Dispose geometry and material
      if (room.meshObject.geometry) room.meshObject.geometry.dispose();
      if (room.meshObject.material) {
        if (Array.isArray(room.meshObject.material)) {
          room.meshObject.material.forEach(mat => mat.dispose());
        } else {
          room.meshObject.material.dispose();
        }
      }
    }
    
    // Destroy room
    room.destroy();
    
    return true;
  }
  
  /**
   * Create material for room based on department
   * @param {string} department - Department name
   * @returns {THREE.Material} Three.js material
   */
  function createRoomMaterial(department) {
    // Department color mapping
    const departmentColors = {
      'Management': 0x8B4513,      // Brown
      'Administration': 0x4169E1,   // Royal Blue
      'Technology': 0x00CED1,       // Dark Turquoise
      'Marketing': 0xFF69B4,        // Hot Pink
      'Sales': 0x32CD32,            // Lime Green
      'Creative': 0xFF6347,         // Tomato
      'Common Areas': 0x9370DB,     // Medium Purple
      'Unassigned': 0x808080        // Gray
    };
    
    const color = departmentColors[department] || departmentColors['Unassigned'];
    
    return new THREE.MeshLambertMaterial({
      color: color,
      transparent: true,
      opacity: 0.8
    });
  }
  
  /**
   * Calculate total square footage for all rooms or by department
   * @param {string} department - Optional department filter
   * @returns {number} Total square footage
   */
  function getTotalSquareFootage(department = null) {
    const rooms = department ? getRoomsByDepartment(department) : getAllRooms();
    return rooms.reduce((total, room) => total + room.squareFootage, 0);
  }
  
  /**
   * Get room statistics
   * @returns {Object} Room statistics
   */
  function getRoomStatistics() {
    const rooms = getAllRooms();
    const departments = getDepartments();
    
    const stats = {
      totalRooms: rooms.length,
      totalSquareFootage: getTotalSquareFootage(),
      totalVolume: rooms.reduce((total, room) => total + room.volume, 0),
      departments: departments.length,
      departmentBreakdown: {}
    };
    
    // Department breakdown
    departments.forEach(dept => {
      const deptRooms = getRoomsByDepartment(dept);
      stats.departmentBreakdown[dept] = {
        roomCount: deptRooms.length,
        squareFootage: getTotalSquareFootage(dept),
        averageSize: deptRooms.length > 0 ? getTotalSquareFootage(dept) / deptRooms.length : 0
      };
    });
    
    return stats;
  }
  
  /**
   * Export all rooms data
   * @returns {Array<Object>} Array of room data for persistence
   */
  function exportRoomsData() {
    return getAllRooms().map(room => room.export());
  }
  
  /**
   * Import rooms data
   * @param {Array<Object>} roomsData - Array of room data
   * @returns {Array<Room>} Array of created rooms
   */
  function importRoomsData(roomsData) {
    if (!Array.isArray(roomsData)) return [];
    
    const importedRooms = [];
    
    roomsData.forEach(data => {
      try {
        const room = createRoom(data);
        importedRooms.push(room);
      } catch (error) {
        console.error('Error importing room data:', error, data);
      }
    });
    
    console.log(`Imported ${importedRooms.length} rooms`);
    return importedRooms;
  }
  
  /**
   * Search rooms by name or number
   * @param {string} query - Search query
   * @returns {Array<Room>} Array of matching rooms
   */
  function searchRooms(query) {
    if (!query) return getAllRooms();
    
    const searchTerm = query.toLowerCase();
    return getAllRooms().filter(room => 
      room.name.toLowerCase().includes(searchTerm) ||
      room.number.toLowerCase().includes(searchTerm) ||
      room.department.toLowerCase().includes(searchTerm)
    );
  }
  
  // Return public API
  return {
    // Room creation and management
    createRoom,
    createRoomFromObject,
    deleteRoom,
    
    // Room retrieval
    getRoomFromObject,
    getRoomById,
    getAllRooms,
    getRoomsByDepartment,
    getDepartments,
    searchRooms,
    
    // Statistics and analysis
    getRoomStatistics,
    getTotalSquareFootage,
    
    // Data persistence
    exportRoomsData,
    importRoomsData,
    
    // Utilities
    createRoomMaterial,
    
    // Internal access for debugging
    _registry: roomRegistry,
    _objectMap: objectToRoomMap,
    Room: Room
  };
}