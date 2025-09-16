// Blocking and Stacking Algorithm Service
// Converts room data to positioned 3D masses

export function createBlockingStacking() {
  const DEFAULT_HEIGHT = 8; // 8 feet default height
  const DEPARTMENT_GAP = 5;  // 5 feet between department groups
  const ROOM_GAP = 1;        // 1 foot between individual rooms
  const MIN_WIDTH = 6;       // Minimum room width in feet
  const MAX_WIDTH = 40;      // Maximum room width in feet

  /**
   * Calculate rectangular dimensions from square footage
   * Uses reasonable architectural proportions
   * @param {number} squareFootage - Room area in square feet
   * @returns {Object} { width, depth } in feet
   */
  function calculateRoomDimensions(squareFootage) {
    // For architectural spaces, aim for reasonable proportions
    // Most rooms are not perfect squares, slight rectangle is more realistic
    
    let width, depth;
    
    if (squareFootage < 50) {
      // Small rooms: closer to square (bathrooms, closets)
      const side = Math.sqrt(squareFootage);
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, side * 1.1));
      depth = squareFootage / width;
    } else if (squareFootage < 200) {
      // Medium rooms: slight rectangle (offices, bedrooms)
      const side = Math.sqrt(squareFootage);
      const ratio = 1.3; // 1.3:1 ratio
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, side * Math.sqrt(ratio)));
      depth = squareFootage / width;
    } else if (squareFootage < 500) {
      // Large rooms: more rectangular (conference rooms, living areas)
      const side = Math.sqrt(squareFootage);
      const ratio = 1.6; // 1.6:1 ratio
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, side * Math.sqrt(ratio)));
      depth = squareFootage / width;
    } else {
      // Very large rooms: long rectangles (open offices, warehouses)
      const side = Math.sqrt(squareFootage);
      const ratio = 2.0; // 2:1 ratio
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, side * Math.sqrt(ratio)));
      depth = squareFootage / width;
    }
    
    // Ensure minimum dimensions
    width = Math.max(MIN_WIDTH, width);
    depth = Math.max(MIN_WIDTH, depth);
    
    // Round to reasonable increments (6 inch increments)
    width = Math.round(width * 2) / 2;
    depth = Math.round(depth * 2) / 2;
    
    return { width, depth };
  }

  /**
   * Layout rooms within a department group
   * @param {Array} rooms - Rooms in the department
   * @param {Object} startPosition - Starting position { x, z }
   * @returns {Array} Array of positioned room objects
   */
  function layoutDepartment(rooms, startPosition) {
    const positionedRooms = [];
    let currentX = startPosition.x;
    let currentZ = startPosition.z;
    let maxHeightInRow = 0;
    let rowWidth = 0;
    const MAX_ROW_WIDTH = 100; // Maximum width before wrapping to new row
    
    // Sort rooms by size (largest first) for better packing
    const sortedRooms = [...rooms].sort((a, b) => b.squareFootage - a.squareFootage);
    
    sortedRooms.forEach((room, index) => {
      const dimensions = calculateRoomDimensions(room.squareFootage);
      
      // Check if we need to wrap to a new row
      if (index > 0 && rowWidth + dimensions.width + ROOM_GAP > MAX_ROW_WIDTH) {
        currentX = startPosition.x;
        currentZ += maxHeightInRow + ROOM_GAP;
        rowWidth = 0;
        maxHeightInRow = 0;
      }
      
      positionedRooms.push({
        ...room,
        dimensions,
        position: {
          x: currentX + dimensions.width / 2,
          y: DEFAULT_HEIGHT / 2, // Center the mass vertically
          z: currentZ + dimensions.depth / 2
        },
        height: DEFAULT_HEIGHT
      });
      
      // Update position for next room
      currentX += dimensions.width + ROOM_GAP;
      rowWidth += dimensions.width + ROOM_GAP;
      maxHeightInRow = Math.max(maxHeightInRow, dimensions.depth);
    });
    
    return positionedRooms;
  }

  /**
   * Calculate the bounding box of positioned rooms
   * @param {Array} rooms - Array of positioned rooms
   * @returns {Object} Bounding box { minX, maxX, minZ, maxZ, width, depth }
   */
  function calculateBoundingBox(rooms) {
    if (rooms.length === 0) {
      return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, depth: 0 };
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    rooms.forEach(room => {
      const halfWidth = room.dimensions.width / 2;
      const halfDepth = room.dimensions.depth / 2;
      
      minX = Math.min(minX, room.position.x - halfWidth);
      maxX = Math.max(maxX, room.position.x + halfWidth);
      minZ = Math.min(minZ, room.position.z - halfDepth);
      maxZ = Math.max(maxZ, room.position.z + halfDepth);
    });
    
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      width: maxX - minX,
      depth: maxZ - minZ
    };
  }

  /**
   * Position department groups with spacing
   * @param {Object} departmentGroups - Object with department names as keys
   * @returns {Array} Array of all positioned rooms with department grouping
   */
  function positionDepartments(departmentGroups) {
    const allPositionedRooms = [];
    const departmentBounds = [];
    let currentZ = 0;
    
    // Get department names and sort by total square footage (largest first)
    const departmentNames = Object.keys(departmentGroups).sort((a, b) => {
      const totalA = departmentGroups[a].reduce((sum, room) => sum + room.squareFootage, 0);
      const totalB = departmentGroups[b].reduce((sum, room) => sum + room.squareFootage, 0);
      return totalB - totalA;
    });
    
    departmentNames.forEach((deptName, deptIndex) => {
      const rooms = departmentGroups[deptName];
      
      // Layout this department's rooms
      const positionedRooms = layoutDepartment(rooms, { x: 0, z: currentZ });
      
      // Calculate this department's bounding box
      const bounds = calculateBoundingBox(positionedRooms);
      
      // Store department info
      departmentBounds.push({
        name: deptName,
        bounds,
        roomCount: rooms.length,
        totalSquareFootage: rooms.reduce((sum, room) => sum + room.squareFootage, 0)
      });
      
      // Add rooms to the total list with department info
      positionedRooms.forEach(room => {
        allPositionedRooms.push({
          ...room,
          departmentBounds: bounds,
          departmentIndex: deptIndex
        });
      });
      
      // Move to next department position
      currentZ += bounds.depth + DEPARTMENT_GAP;
    });
    
    // Center all rooms around origin
    const overallBounds = calculateBoundingBox(allPositionedRooms);
    const offsetX = -overallBounds.minX - overallBounds.width / 2;
    const offsetZ = -overallBounds.minZ - overallBounds.depth / 2;
    
    allPositionedRooms.forEach(room => {
      room.position.x += offsetX;
      room.position.z += offsetZ;
    });
    
    // Update department bounds with offset
    departmentBounds.forEach(dept => {
      dept.bounds.minX += offsetX;
      dept.bounds.maxX += offsetX;
      dept.bounds.minZ += offsetZ;
      dept.bounds.maxZ += offsetZ;
    });
    
    return {
      rooms: allPositionedRooms,
      departments: departmentBounds,
      overallBounds: {
        ...overallBounds,
        minX: overallBounds.minX + offsetX,
        maxX: overallBounds.maxX + offsetX,
        minZ: overallBounds.minZ + offsetZ,
        maxZ: overallBounds.maxZ + offsetZ
      }
    };
  }

  /**
   * Generate masses from room data
   * @param {Array} rooms - Room data from Excel
   * @returns {Object} Complete layout with positioned rooms and department info
   */
  function generateMasses(rooms) {
    if (!rooms || rooms.length === 0) {
      throw new Error('No room data provided');
    }
    
    // Group rooms by department
    const departmentGroups = {};
    rooms.forEach(room => {
      const dept = room.department || 'Unassigned';
      if (!departmentGroups[dept]) {
        departmentGroups[dept] = [];
      }
      departmentGroups[dept].push(room);
    });
    
    // Position departments and rooms
    const layout = positionDepartments(departmentGroups);
    
    // Add summary statistics
    layout.summary = {
      totalRooms: rooms.length,
      totalSquareFootage: rooms.reduce((sum, room) => sum + room.squareFootage, 0),
      departmentCount: layout.departments.length,
      averageRoomSize: rooms.reduce((sum, room) => sum + room.squareFootage, 0) / rooms.length
    };
    
    return layout;
  }

  /**
   * Calculate metrics for the generated layout
   * @param {Object} layout - Layout object from generateMasses
   * @returns {Object} Layout metrics and statistics
   */
  function calculateLayoutMetrics(layout) {
    const { rooms, departments, summary } = layout;
    
    return {
      efficiency: {
        averageRoomUtilization: summary.averageRoomSize,
        largestRoom: Math.max(...rooms.map(r => r.squareFootage)),
        smallestRoom: Math.min(...rooms.map(r => r.squareFootage)),
        departmentSpread: departments.map(d => ({
          name: d.name,
          roomCount: d.roomCount,
          totalArea: d.totalSquareFootage,
          averageRoomSize: d.totalSquareFootage / d.roomCount
        }))
      },
      spatial: {
        overallFootprint: layout.overallBounds.width * layout.overallBounds.depth,
        aspectRatio: layout.overallBounds.width / layout.overallBounds.depth,
        departmentSeparation: DEPARTMENT_GAP,
        roomSeparation: ROOM_GAP
      }
    };
  }

  return {
    generateMasses,
    calculateRoomDimensions,
    calculateLayoutMetrics,
    constants: {
      DEFAULT_HEIGHT,
      DEPARTMENT_GAP,
      ROOM_GAP,
      MIN_WIDTH,
      MAX_WIDTH
    }
  };
}