/*
====================================================================================
ROOM BOUNDARY DETECTION SERVICE
====================================================================================
Plain Meaning:
  Automatically finds enclosed spaces (rooms) by analyzing the arrangement of 
  boundary objects like walls, furniture, and blocking masses. Treats rooms as
  the "negative space" between objects, not as objects themselves.

Developer Summary:
  Implements spatial analysis algorithms to detect enclosed regions by:
  1. Creating a 2D floor plan projection from 3D objects
  2. Finding closed polygonal boundaries formed by object edges
  3. Computing room areas, access points, and adjacency relationships
  4. Validating room completeness and detecting openings/doors

Key Concepts:
  Boundary Object: Any mesh that can form room boundaries (walls, furniture, etc.)
  Enclosed Space: A 2D polygonal region completely surrounded by boundary objects
  Room Polygon: The mathematical representation of a room's floor area
  Access Point: Gaps in boundaries that represent doors or openings
  Adjacency: Which rooms share boundaries or access points

Design Goals:
  1. Automatic Detection: No manual room designation needed
  2. Dynamic Updates: Rooms recalculate when boundary objects move
  3. Realistic Behavior: Respects architectural principles
  4. Performance: Efficient algorithms for real-time updates
====================================================================================
*/

export function createRoomBoundaryDetection({ THREE, scene }) {
  
  // Room detection parameters
  const DETECTION_SETTINGS = {
    floorLevel: 0,           // Y level considered "floor"
    wallAnalysisHeight: 3,   // Height above floor to analyze walls (feet)
    maxGapSize: 1,           // Maximum allowed gap in walls (feet)
    minRoomArea: 25,         // Minimum square footage for a valid room
    maxRoomArea: 10000,      // Maximum square footage (prevents huge detections)
    boundaryTolerance: 0.1,  // How close objects need to be to form boundaries
    doorwayMinWidth: 2,      // Minimum width for valid doorway (feet)
    doorwayMaxWidth: 8,      // Maximum width for valid doorway (feet)
    gridResolution: 0.5,     // Grid resolution for spatial analysis (feet)
    wallThickness: 0.5       // Assumed wall thickness for analysis
  };
  
  // Detected room registry
  const detectedRooms = new Map(); // id -> DetectedRoom
  let nextRoomId = 1;
  
  /**
   * DetectedRoom class - represents a space bounded by objects
   */
  class DetectedRoom {
    constructor(polygon, boundaryObjects = []) {
      this.id = `detected_room_${nextRoomId++}`;
      this.polygon = polygon;           // Array of {x, z} points defining room boundary
      this.boundaryObjects = boundaryObjects; // Objects that form the boundaries
      this.area = this.calculateArea();
      this.centroid = this.calculateCentroid();
      this.accessPoints = [];          // Detected doorways/openings
      this.adjacentRooms = new Set();  // IDs of adjacent rooms
      this.suggestedName = this.generateSuggestedName();
      
      // Metadata
      this.metadata = {
        detectedAt: Date.now(),
        confidence: this.calculateConfidence(),
        boundaryComplete: this.isBoundaryComplete(),
        estimatedHeight: this.estimateRoomHeight()
      };
      
      detectedRooms.set(this.id, this);
    }
    
    /**
     * Calculate room area from polygon
     */
    calculateArea() {
      if (this.polygon.length < 3) return 0;
      
      let area = 0;
      for (let i = 0; i < this.polygon.length; i++) {
        const j = (i + 1) % this.polygon.length;
        area += this.polygon[i].x * this.polygon[j].z;
        area -= this.polygon[j].x * this.polygon[i].z;
      }
      
      // Convert from square meters to square feet
      const metersToFeet = 3.28084;
      return Math.abs(area) * 0.5 * (metersToFeet * metersToFeet);
    }
    
    /**
     * Calculate room centroid
     */
    calculateCentroid() {
      if (this.polygon.length === 0) return { x: 0, z: 0 };
      
      let cx = 0, cz = 0;
      this.polygon.forEach(point => {
        cx += point.x;
        cz += point.z;
      });
      
      return {
        x: cx / this.polygon.length,
        z: cz / this.polygon.length
      };
    }
    
    /**
     * Generate suggested room name based on size and location
     */
    generateSuggestedName() {
      if (this.area < 50) return 'Closet';
      if (this.area < 100) return 'Small Office';
      if (this.area < 200) return 'Office';
      if (this.area < 400) return 'Large Office';
      if (this.area < 800) return 'Conference Room';
      return 'Large Space';
    }
    
    /**
     * Calculate detection confidence based on boundary completeness
     */
    calculateConfidence() {
      const boundaryRatio = this.boundaryObjects.length / this.polygon.length;
      const areaFactor = Math.min(this.area / 100, 1); // Higher confidence for reasonable sizes
      const completeness = this.isBoundaryComplete() ? 1 : 0.5;
      
      return Math.min(boundaryRatio * areaFactor * completeness, 1);
    }
    
    /**
     * Check if the room has complete 4-wall enclosure with acceptable gaps
     */
    isBoundaryComplete() {
      if (!this.polygon || this.polygon.length < 3 || !this.boundaryObjects || this.boundaryObjects.length < 4) {
        return false;
      }
      
      // Create a test area from the floor polygon
      const testArea = this.createTestAreaFromPolygon();
      if (!testArea) {
        return false;
      }
      
      // Analyze wall enclosure at the specified height
      const wallAnalysis = testWallBoundaries(testArea, this.boundaryObjects);
      
      // Analyze the results
      const enclosureAnalysis = analyzeWallEnclosure(wallAnalysis);
      
      // Store analysis results for debugging
      this.enclosureAnalysis = enclosureAnalysis;
      
      // Check minimum area (at least 25 square feet)
      const area = this.calculateArea();
      const hasMinimumArea = area >= DETECTION_SETTINGS.minRoomArea;
      
      return enclosureAnalysis.isFullyEnclosed && 
             hasMinimumArea && 
             enclosureAnalysis.maxGapSize <= DETECTION_SETTINGS.maxGapSize &&
             enclosureAnalysis.confidence > 0.6; // At least 60% confidence
    }
    
    /**
     * Create a test area from the floor polygon for wall boundary testing
     */
    createTestAreaFromPolygon() {
      if (!this.polygon || this.polygon.length < 3) {
        return null;
      }
      
      // Calculate polygon bounds
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      this.polygon.forEach(point => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      });
      
      // Use floor level and wall analysis height
      const minY = DETECTION_SETTINGS.floorLevel;
      const maxY = DETECTION_SETTINGS.floorLevel + DETECTION_SETTINGS.wallAnalysisHeight;
      
      return new THREE.Box3(
        new THREE.Vector3(minX, minY, minZ),
        new THREE.Vector3(maxX, maxY, maxZ)
      );
    }
    
    /**
     * Estimate room height from boundary objects
     */
    estimateRoomHeight() {
      if (this.boundaryObjects.length === 0) return 8; // Default height
      
      let totalHeight = 0;
      let validObjects = 0;
      
      this.boundaryObjects.forEach(obj => {
        if (obj.userData && obj.userData.dimensions && obj.userData.dimensions.height) {
          totalHeight += obj.userData.dimensions.height;
          validObjects++;
        } else {
          // Use mesh bounding box
          const bbox = new THREE.Box3().setFromObject(obj);
          totalHeight += bbox.getSize(new THREE.Vector3()).y;
          validObjects++;
        }
      });
      
      return validObjects > 0 ? totalHeight / validObjects : 8;
    }
    
    /**
     * Update room properties when boundaries change
     */
    recalculate() {
      this.area = this.calculateArea();
      this.centroid = this.calculateCentroid();
      this.suggestedName = this.generateSuggestedName();
      this.metadata.confidence = this.calculateConfidence();
      this.metadata.boundaryComplete = this.isBoundaryComplete();
      this.metadata.estimatedHeight = this.estimateRoomHeight();
      this.metadata.detectedAt = Date.now();
    }
  }
  
  /**
   * Main detection function - find all rooms with 4-wall enclosures at wall height
   */
  function detectRooms() {
    console.log(`🏠 Starting 4-wall room detection at ${DETECTION_SETTINGS.wallAnalysisHeight}ft height...`);
    
    // Clear previous detections
    detectedRooms.clear();
    nextRoomId = 1;
    
    // Step 1: Get all potential boundary objects
    const boundaryObjects = getBoundaryObjects();
    console.log(`Found ${boundaryObjects.length} potential boundary objects`);
    
    if (boundaryObjects.length < 4) { // Need at least 4 objects for wall enclosure
      console.log('Insufficient boundary objects for 4-wall room detection (need at least 4)');
      return Array.from(detectedRooms.values());
    }
    
    // Step 2: Find potential enclosed spaces using wall analysis
    const enclosedSpaces = find3DEnclosedSpaces(boundaryObjects);
    console.log(`Found ${enclosedSpaces.length} potential wall-enclosed spaces`);
    
    // Step 3: Validate each space for complete 4-wall enclosure with acceptable gaps
    enclosedSpaces.forEach(spaceData => {
      const enclosureAnalysis = analyzeWallEnclosure(spaceData.wallAnalysis);
      
      if (enclosureAnalysis.isFullyEnclosed && 
          enclosureAnalysis.maxGapSize <= DETECTION_SETTINGS.maxGapSize) {
        
        const room = new DetectedRoom(spaceData.floorPolygon, spaceData.boundaryObjects);
        
        // Add wall enclosure metadata
        room.metadata.enclosureAnalysis = enclosureAnalysis;
        room.metadata.has4WallBoundaries = true;
        room.metadata.maxGapSize = enclosureAnalysis.maxGapSize;
        room.metadata.wallAnalysisHeight = DETECTION_SETTINGS.wallAnalysisHeight;
        
        // Filter out rooms that are too small or too large
        if (room.area >= DETECTION_SETTINGS.minRoomArea && 
            room.area <= DETECTION_SETTINGS.maxRoomArea) {
          detectedRooms.set(room.id, room);
          console.log(`✅ Detected 4-wall room: ${room.suggestedName} (${room.area.toFixed(1)} sq ft) - Max Gap: ${enclosureAnalysis.maxGapSize.toFixed(1)}ft - Confidence: ${(enclosureAnalysis.confidence * 100).toFixed(0)}%`);
        } else {
          console.log(`❌ Room size out of bounds: ${room.area.toFixed(1)} sq ft (min: ${DETECTION_SETTINGS.minRoomArea}, max: ${DETECTION_SETTINGS.maxRoomArea})`);
        }
      } else {
        const reasons = [];
        if (!enclosureAnalysis.isFullyEnclosed) reasons.push('incomplete walls');
        if (enclosureAnalysis.maxGapSize > DETECTION_SETTINGS.maxGapSize) reasons.push(`gaps too large (${enclosureAnalysis.maxGapSize.toFixed(1)}ft > ${DETECTION_SETTINGS.maxGapSize}ft)`);
        
        console.log(`❌ Rejected space: ${reasons.join(', ')}`);
      }
    });
    
    // Step 4: Detect access points and adjacency
    detectAccessPoints();
    calculateAdjacency();
    
    console.log(`🎯 4-wall room detection complete: ${detectedRooms.size} rooms found with max ${DETECTION_SETTINGS.maxGapSize}ft gaps`);
    return Array.from(detectedRooms.values());
  }
  
  /**
   * Get all objects that could form room boundaries
   */
  function getBoundaryObjects() {
    const boundaryObjects = [];
    
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.userData && obj.userData.__helper) return; // Skip helper objects
      
      // Check if object could be a boundary
      if (isPotentialBoundary(obj)) {
        boundaryObjects.push(obj);
      }
    });
    
    return boundaryObjects;
  }
  
  /**
   * Check if an object can form room boundaries
   */
  function isPotentialBoundary(obj) {
    // Check if it's a wall-like object (tall and thin)
    const bbox = new THREE.Box3().setFromObject(obj);
    const size = bbox.getSize(new THREE.Vector3());
    
    // Wall-like: height > width or depth, and reasonably thin
    const isWallLike = (size.y > Math.max(size.x, size.z)) && 
                       (Math.min(size.x, size.z) < 1); // Less than 1 meter thick
    
    // Large furniture that could block spaces
    const isLargeFurniture = size.x * size.z > 4; // At least 4 square meters footprint
    
    // Blocking masses from the blocking system
    const isBlockingMass = obj.userData && 
                          (obj.userData.type === 'room_mass' || 
                           obj.userData.isBlockingMass);
    
    // Objects designated as room boundaries
    const isDesignatedBoundary = obj.userData && obj.userData.isBoundary;
    
    return isWallLike || isLargeFurniture || isBlockingMass || isDesignatedBoundary;
  }
  
  /**
   * Project 3D objects to 2D floor plan edges
   */
  function projectObjectsTo2D(objects) {
    const edges = [];
    
    objects.forEach(obj => {
      const bbox = new THREE.Box3().setFromObject(obj);
      const min = bbox.min;
      const max = bbox.max;
      
      // Create rectangle edges at floor level
      const corners = [
        { x: min.x, z: min.z },
        { x: max.x, z: min.z },
        { x: max.x, z: max.z },
        { x: min.x, z: max.z }
      ];
      
      // Add edges for this object
      for (let i = 0; i < corners.length; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % corners.length];
        
        edges.push({
          start,
          end,
          object: obj,
          length: Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.z - start.z, 2))
        });
      }
    });
    
    return edges;
  }
  
  /**
   * Find enclosed spaces with 4 walls at analysis height
   */
  function find3DEnclosedSpaces(boundaryObjects) {
    const enclosedVolumes = [];
    
    // Group objects by approximate spatial regions using a grid-based approach
    const spatialGrid = createSpatialGrid(boundaryObjects);
    
    // For each grid cell that contains objects, try to find 4-wall enclosures
    Object.keys(spatialGrid).forEach(gridKey => {
      const cellObjects = spatialGrid[gridKey];
      if (cellObjects.length < 4) return; // Need at least 4 objects for wall enclosure
      
      // Try to find a complete 4-wall enclosure using these objects
      const enclosure = attemptWallEnclosureDetection(cellObjects, boundaryObjects);
      if (enclosure) {
        enclosedVolumes.push(enclosure);
      }
    });
    
    return enclosedVolumes;
  }
  
  /**
   * Create a spatial grid to group nearby objects
   */
  function createSpatialGrid(objects) {
    const grid = {};
    const cellSize = 5; // 5 meter grid cells
    
    objects.forEach(obj => {
      const bbox = new THREE.Box3().setFromObject(obj);
      const center = bbox.getCenter(new THREE.Vector3());
      
      const gridX = Math.floor(center.x / cellSize);
      const gridZ = Math.floor(center.z / cellSize);
      const gridKey = `${gridX},${gridZ}`;
      
      if (!grid[gridKey]) {
        grid[gridKey] = [];
      }
      grid[gridKey].push(obj);
    });
    
    return grid;
  }
  
  /**
   * Attempt to detect a 4-wall enclosure at the specified wall height
   */
  function attemptWallEnclosureDetection(candidateObjects, allObjects) {
    // Find the bounding box of all candidate objects
    const overallBBox = new THREE.Box3();
    candidateObjects.forEach(obj => {
      const objBBox = new THREE.Box3().setFromObject(obj);
      overallBBox.union(objBBox);
    });
    
    // Expand slightly to create a test area
    const margin = 0.5;
    overallBBox.expandByScalar(margin);
    
    // Test for walls in 4 horizontal directions at the specified height
    const wallAnalysis = testWallBoundaries(overallBBox, allObjects);
    
    if (wallAnalysis.hasAllWalls && wallAnalysis.maxGapSize <= DETECTION_SETTINGS.maxGapSize) {
      // Create floor polygon from the area
      const floorPolygon = createFloorPolygonFromBoundingBox(overallBBox);
      
      return {
        boundingBox: overallBBox,
        floorPolygon: floorPolygon,
        boundaryObjects: wallAnalysis.contributingObjects,
        wallAnalysis: wallAnalysis
      };
    }
    
    return null;
  }
  
  /**
   * Test for wall boundaries in 4 horizontal directions at wall height
   */
  function testWallBoundaries(bbox, allObjects) {
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    // Set test height to wall analysis height
    const testHeight = DETECTION_SETTINGS.floorLevel + DETECTION_SETTINGS.wallAnalysisHeight;
    const testDistance = Math.min(size.x, size.z) * 0.4; // Test within room area
    
    // Create test points for 4 wall directions at the specified height
    const testPoints = {
      north: new THREE.Vector3(center.x, testHeight, center.z + testDistance),
      south: new THREE.Vector3(center.x, testHeight, center.z - testDistance),
      east: new THREE.Vector3(center.x + testDistance, testHeight, center.z),
      west: new THREE.Vector3(center.x - testDistance, testHeight, center.z)
    };
    
    const directions = ['north', 'south', 'east', 'west'];
    const wallResults = {};
    const contributingObjects = new Set();
    const gaps = [];
    
    // Test each wall direction
    directions.forEach(direction => {
      const result = analyzeWallDirection(testPoints[direction], direction, bbox, allObjects);
      wallResults[direction] = result;
      
      if (result.boundaries.length > 0) {
        result.boundaries.forEach(boundary => contributingObjects.add(boundary.object));
      }
      
      // Record gaps larger than tolerance
      result.gaps.forEach(gap => {
        if (gap.size > DETECTION_SETTINGS.boundaryTolerance) {
          gaps.push({ direction, ...gap });
        }
      });
    });
    
    const hasAllWalls = directions.every(dir => wallResults[dir].hasCoverage);
    const maxGapSize = gaps.length > 0 ? Math.max(...gaps.map(g => g.size)) : 0;
    
    return {
      hasAllWalls,
      maxGapSize,
      gaps,
      wallResults,
      contributingObjects: Array.from(contributingObjects)
    };
  }
  
  /**
   * Analyze wall coverage in a specific direction by casting rays and detecting gaps
   */
  function analyzeWallDirection(fromPoint, direction, roomBBox, allObjects) {
    const boundaries = [];
    const gaps = [];
    
    // Determine the direction vector and scan parameters
    const directionConfig = getDirectionConfig(direction);
    const scanLine = generateScanLine(fromPoint, directionConfig, roomBBox);
    
    // Cast rays along the scan line to find boundaries
    scanLine.forEach((rayPoint, index) => {
      const hit = castRayForBoundary(rayPoint, directionConfig.rayDirection, allObjects);
      
      if (hit) {
        boundaries.push({
          point: rayPoint,
          object: hit.object,
          distance: hit.distance,
          scanIndex: index
        });
      }
    });
    
    // Analyze gaps between boundaries
    const coverage = analyzeCoverage(scanLine, boundaries);
    gaps.push(...coverage.gaps);
    
    return {
      hasCoverage: coverage.totalCoverage > 0.7, // At least 70% wall coverage
      boundaries,
      gaps,
      totalCoverage: coverage.totalCoverage,
      scanLine
    };
  }
  
  /**
   * Get configuration for scanning in a specific direction
   */
  function getDirectionConfig(direction) {
    switch (direction) {
      case 'north':
        return {
          rayDirection: new THREE.Vector3(0, 0, 1),
          scanAxis: 'x',
          perpAxis: 'z'
        };
      case 'south':
        return {
          rayDirection: new THREE.Vector3(0, 0, -1),
          scanAxis: 'x',
          perpAxis: 'z'
        };
      case 'east':
        return {
          rayDirection: new THREE.Vector3(1, 0, 0),
          scanAxis: 'z',
          perpAxis: 'x'
        };
      case 'west':
        return {
          rayDirection: new THREE.Vector3(-1, 0, 0),
          scanAxis: 'z',
          perpAxis: 'x'
        };
      default:
        return null;
    }
  }
  
  /**
   * Generate a line of scan points along the wall direction
   */
  function generateScanLine(centerPoint, directionConfig, roomBBox) {
    const scanPoints = [];
    const scanResolution = 0.5; // Scan every 0.5 feet
    const size = roomBBox.getSize(new THREE.Vector3());
    
    const scanLength = directionConfig.scanAxis === 'x' ? size.x : size.z;
    const numPoints = Math.ceil(scanLength / scanResolution);
    
    for (let i = 0; i < numPoints; i++) {
      const offset = (i - numPoints / 2) * scanResolution;
      const scanPoint = centerPoint.clone();
      
      if (directionConfig.scanAxis === 'x') {
        scanPoint.x += offset;
      } else {
        scanPoint.z += offset;
      }
      
      scanPoints.push(scanPoint);
    }
    
    return scanPoints;
  }
  
  /**
   * Cast a ray to find the nearest boundary object
   */
  function castRayForBoundary(fromPoint, direction, allObjects) {
    const maxDistance = 10; // Maximum 10 feet to look for walls
    let nearestHit = null;
    let nearestDistance = maxDistance;
    
    allObjects.forEach(obj => {
      // Skip helper objects
      if (obj.userData && obj.userData.__helper) return;
      
      const hit = rayIntersectObject(fromPoint, direction, obj);
      if (hit && hit.distance < nearestDistance) {
        nearestDistance = hit.distance;
        nearestHit = hit;
      }
    });
    
    return nearestHit;
  }
  
  /**
   * Simple ray-object intersection test
   */
  function rayIntersectObject(rayOrigin, rayDirection, object) {
    const raycaster = new THREE.Raycaster(rayOrigin, rayDirection);
    const intersections = raycaster.intersectObject(object, true);
    
    if (intersections.length > 0) {
      return {
        object: object,
        distance: intersections[0].distance,
        point: intersections[0].point
      };
    }
    
    return null;
  }
  
  /**
   * Analyze coverage and detect gaps in wall boundaries
   */
  function analyzeCoverage(scanLine, boundaries) {
    if (scanLine.length === 0) {
      return { totalCoverage: 0, gaps: [] };
    }
    
    const covered = new Array(scanLine.length).fill(false);
    const gaps = [];
    
    // Mark covered areas
    boundaries.forEach(boundary => {
      // Mark a small area around each boundary as covered
      const coverageRadius = 2; // Cover 2 scan points on each side
      const start = Math.max(0, boundary.scanIndex - coverageRadius);
      const end = Math.min(scanLine.length - 1, boundary.scanIndex + coverageRadius);
      
      for (let i = start; i <= end; i++) {
        covered[i] = true;
      }
    });
    
    // Find gaps
    let gapStart = null;
    for (let i = 0; i < covered.length; i++) {
      if (!covered[i] && gapStart === null) {
        gapStart = i;
      } else if (covered[i] && gapStart !== null) {
        const gapSize = (i - gapStart) * 0.5; // Convert to feet
        gaps.push({
          start: gapStart,
          end: i - 1,
          size: gapSize,
          startPoint: scanLine[gapStart],
          endPoint: scanLine[i - 1]
        });
        gapStart = null;
      }
    }
    
    // Handle gap that extends to the end
    if (gapStart !== null) {
      const gapSize = (covered.length - gapStart) * 0.5;
      gaps.push({
        start: gapStart,
        end: covered.length - 1,
        size: gapSize,
        startPoint: scanLine[gapStart],
        endPoint: scanLine[covered.length - 1]
      });
    }
    
    const coveredPoints = covered.filter(c => c).length;
    const totalCoverage = coveredPoints / covered.length;
    
    return { totalCoverage, gaps };
  }
  

  
  /**
   * Create a floor polygon from a bounding box
   */
  function createFloorPolygonFromBoundingBox(bbox) {
    const min = bbox.min;
    const max = bbox.max;
    
    return [
      { x: min.x, z: min.z },
      { x: max.x, z: min.z },
      { x: max.x, z: max.z },
      { x: min.x, z: max.z }
    ];
  }
  
  /**
   * Analyze wall enclosure completeness
   */
  function analyzeWallEnclosure(wallAnalysis) {
    const directions = ['north', 'south', 'east', 'west'];
    
    // Calculate confidence based on wall coverage and gap sizes
    let totalCoverage = 0;
    let validWalls = 0;
    
    directions.forEach(direction => {
      const wallResult = wallAnalysis.wallResults[direction];
      if (wallResult.hasCoverage) {
        totalCoverage += wallResult.totalCoverage;
        validWalls++;
      }
    });
    
    const averageCoverage = validWalls > 0 ? totalCoverage / validWalls : 0;
    
    // Penalize large gaps
    const gapPenalty = Math.min(wallAnalysis.maxGapSize / DETECTION_SETTINGS.maxGapSize, 1);
    const finalConfidence = averageCoverage * (1 - gapPenalty * 0.5);
    
    return {
      isFullyEnclosed: wallAnalysis.hasAllWalls,
      maxGapSize: wallAnalysis.maxGapSize,
      confidence: finalConfidence,
      wallResults: wallAnalysis.wallResults,
      gaps: wallAnalysis.gaps,
      boundaryCount: wallAnalysis.contributingObjects.length
    };
  }
  
  /**
   * Trace a polygon starting from a given edge
   */
  function tracePolygon(startEdge, allEdges, usedEdges) {
    // Simplified polygon tracing - real implementation would be more robust
    const polygon = [
      { ...startEdge.start, sourceObject: startEdge.object },
      { ...startEdge.end, sourceObject: startEdge.object }
    ];
    
    let currentPoint = startEdge.end;
    let attempts = 0;
    const maxAttempts = 20; // Prevent infinite loops
    
    while (attempts < maxAttempts) {
      // Find next connecting edge
      const nextEdge = findConnectingEdge(currentPoint, allEdges, usedEdges);
      if (!nextEdge) break;
      
      // Check if we've closed the loop
      if (isPointNear(nextEdge.end, startEdge.start, DETECTION_SETTINGS.boundaryTolerance)) {
        return polygon; // Closed polygon found
      }
      
      polygon.push({ ...nextEdge.end, sourceObject: nextEdge.object });
      currentPoint = nextEdge.end;
      attempts++;
    }
    
    return null; // No closed polygon found
  }
  
  /**
   * Find an edge that connects to the given point
   */
  function findConnectingEdge(point, edges, usedEdges) {
    for (let i = 0; i < edges.length; i++) {
      if (usedEdges.has(i)) continue;
      
      const edge = edges[i];
      if (isPointNear(edge.start, point, DETECTION_SETTINGS.boundaryTolerance)) {
        usedEdges.add(i);
        return edge;
      }
    }
    return null;
  }
  
  /**
   * Check if two points are near each other
   */
  function isPointNear(p1, p2, tolerance) {
    const dx = p1.x - p2.x;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dz * dz) <= tolerance;
  }
  
  /**
   * Detect access points (doorways) between rooms
   */
  function detectAccessPoints() {
    // TODO: Implement doorway detection by finding gaps in boundaries
    console.log('Access point detection not yet implemented');
  }
  
  /**
   * Calculate room adjacency relationships
   */
  function calculateAdjacency() {
    // TODO: Implement adjacency calculation based on shared boundaries
    console.log('Adjacency calculation not yet implemented');
  }
  
  /**
   * Get all detected rooms
   */
  function getDetectedRooms() {
    return Array.from(detectedRooms.values());
  }
  
  /**
   * Get room containing a specific point
   */
  function getRoomContainingPoint(x, z) {
    for (const room of detectedRooms.values()) {
      if (isPointInPolygon({ x, z }, room.polygon)) {
        return room;
      }
    }
    return null;
  }
  
  /**
   * Check if point is inside polygon using ray casting algorithm
   */
  function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, zi = polygon[i].z;
      const xj = polygon[j].x, zj = polygon[j].z;
      
      if (((zi > point.z) !== (zj > point.z)) &&
          (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  
  /**
   * Update detection when objects change
   */
  function updateDetection() {
    // Debounced re-detection
    clearTimeout(updateDetection.timer);
    updateDetection.timer = setTimeout(() => {
      console.log('Updating room detection due to scene changes...');
      detectRooms();
    }, 1000);
  }
  
  /**
   * Create visual debugging helpers for detected rooms
   */
  function createRoomVisuals() {
    // Remove existing room visuals
    scene.traverse(obj => {
      if (obj.userData && obj.userData.type === 'room_boundary_visual') {
        scene.remove(obj);
      }
    });
    
    // Create new visuals for each detected room
    detectedRooms.forEach(room => {
      const visual = createRoomBoundaryMesh(room);
      scene.add(visual);
    });
  }
  
  /**
   * Create a visual mesh for room boundary
   */
  function createRoomBoundaryMesh(room) {
    // Create a simple floor plane for the room
    const shape = new THREE.Shape();
    
    if (room.polygon.length > 0) {
      shape.moveTo(room.polygon[0].x, room.polygon[0].z);
      for (let i = 1; i < room.polygon.length; i++) {
        shape.lineTo(room.polygon[i].x, room.polygon[i].z);
      }
      shape.lineTo(room.polygon[0].x, room.polygon[0].z); // Close the shape
    }
    
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Rotate to lie flat on floor
    mesh.position.y = DETECTION_SETTINGS.floorLevel + 0.01; // Slightly above floor
    
    mesh.userData = {
      type: 'room_boundary_visual',
      roomId: room.id,
      __helper: true // Mark as helper so it's not included in boundary detection
    };
    
    mesh.name = `RoomBoundary_${room.id}`;
    
    return mesh;
  }
  
  // Public API
  return {
    detectRooms,
    getDetectedRooms,
    getRoomContainingPoint,
    updateDetection,
    createRoomVisuals,
    DETECTION_SETTINGS
  };
}