// Mass Creation Service for Blocking and Stacking
// Creates Three.js geometries for architectural masses

export function createMassSystem({ THREE, scene }) {
  
  /**
   * Create a room mass geometry
   * @param {Object} room - Room data with position, dimensions, etc.
   * @param {Object} options - Creation options
   * @returns {THREE.Mesh} Three.js mesh representing the room mass
   */
  function createRoomMass(room, options = {}) {
    const {
      position,
      dimensions,
      height,
      name,
      department,
      squareFootage
    } = room;
    
    const {
      material = null,
      wireframe = false,
      opacity = 0.8
    } = options;
    
    // Create box geometry (width, height, depth)
    const geometry = new THREE.BoxGeometry(
      dimensions.width,
      height,
      dimensions.depth
    );
    
    // Create material based on department or use provided material
    let roomMaterial;
    if (material) {
      roomMaterial = material;
    } else {
      roomMaterial = createDepartmentMaterial(department, { opacity, wireframe });
    }
    
    // Create mesh
    const mesh = new THREE.Mesh(geometry, roomMaterial);
    
    // Position the mesh
    mesh.position.set(position.x, position.y, position.z);
    
    // Add metadata for selection and interaction
    mesh.userData = {
      type: 'room_mass',
      roomId: room.id,
      roomName: name,
      department: department,
      squareFootage: squareFootage,
      dimensions: dimensions,
      originalPosition: { ...position },
      isBlockingMass: true
    };
    
    // Set name for debugging and scene management
    mesh.name = `Room_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    return mesh;
  }

  /**
   * Create material for a department with consistent coloring
   * @param {string} departmentName - Name of the department
   * @param {Object} options - Material options
   * @returns {THREE.Material} Three.js material
   */
  function createDepartmentMaterial(departmentName, options = {}) {
    const { opacity = 0.8, wireframe = false } = options;
    
    // Generate consistent color based on department name
    const color = getDepartmentColor(departmentName);
    
    if (wireframe) {
      return new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: opacity < 1,
        opacity: opacity
      });
    } else {
      return new THREE.MeshLambertMaterial({
        color: color,
        transparent: opacity < 1,
        opacity: opacity,
        side: THREE.DoubleSide
      });
    }
  }

  /**
   * Generate consistent color for department
   * @param {string} departmentName - Department name
   * @returns {number} Hex color value
   */
  function getDepartmentColor(departmentName) {
    // Predefined colors for common department types
    const departmentColors = {
      'administrative': 0x4A90E2,      // Blue
      'admin': 0x4A90E2,
      'office': 0x4A90E2,
      'reception': 0x7ED321,          // Green
      'lobby': 0x7ED321,
      'conference': 0xF5A623,         // Orange
      'meeting': 0xF5A623,
      'break room': 0xBD10E0,         // Purple
      'kitchen': 0xBD10E0,
      'storage': 0x9013FE,            // Violet
      'warehouse': 0x9013FE,
      'production': 0xD0021B,         // Red
      'manufacturing': 0xD0021B,
      'retail': 0x50E3C2,             // Teal
      'sales': 0x50E3C2,
      'restroom': 0xB8E986,           // Light green
      'bathroom': 0xB8E986,
      'circulation': 0xC0C0C0,        // Gray
      'corridor': 0xC0C0C0,
      'hallway': 0xC0C0C0,
      'unassigned': 0x95A5A6          // Medium gray
    };
    
    // Check for exact or partial matches
    const lowerName = departmentName.toLowerCase();
    for (const [key, color] of Object.entries(departmentColors)) {
      if (lowerName.includes(key) || key.includes(lowerName)) {
        return color;
      }
    }
    
    // Generate hash-based color for consistency
    let hash = 0;
    for (let i = 0; i < departmentName.length; i++) {
      hash = departmentName.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Convert to pleasant colors (avoid too bright/dark)
    const hue = Math.abs(hash) % 360;
    const saturation = 0.6; // 60% saturation
    const lightness = 0.5;  // 50% lightness
    
    return hslToHex(hue, saturation, lightness);
  }

  /**
   * Convert HSL to hex color
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-1)
   * @param {number} l - Lightness (0-1)
   * @returns {number} Hex color
   */
  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    
    let r, g, b;
    
    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Create department group container
   * @param {Array} roomMeshes - Array of room meshes in the department
   * @param {Object} departmentInfo - Department metadata
   * @returns {THREE.Group} Group containing all room masses
   */
  function createDepartmentGroup(roomMeshes, departmentInfo) {
    const group = new THREE.Group();
    group.name = `Department_${departmentInfo.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Add all room meshes to the group
    roomMeshes.forEach(mesh => group.add(mesh));
    
    // Store department metadata
    group.userData = {
      type: 'department_group',
      departmentName: departmentInfo.name,
      roomCount: roomMeshes.length,
      totalSquareFootage: departmentInfo.totalSquareFootage,
      bounds: departmentInfo.bounds,
      isBlockingGroup: true
    };
    
    return group;
  }

  /**
   * Create label for room mass
   * @param {Object} room - Room data
   * @param {Object} options - Label options
   * @returns {THREE.Mesh} Text mesh for labeling
   */
  function createRoomLabel(room, options = {}) {
    const {
      fontSize = 0.5,
      color = 0x000000,
      backgroundColor = 0xffffff,
      showSquareFootage = true
    } = options;
    
    // Create text content
    let text = room.name;
    if (showSquareFootage) {
      text += `\n${room.squareFootage} SF`;
    }
    
    // Create canvas for text texture
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = 256;
    canvas.height = 128;
    
    // Style text
    context.font = '16px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Draw background
    context.fillStyle = `#${backgroundColor.toString(16).padStart(6, '0')}`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    const lines = text.split('\n');
    const lineHeight = 20;
    const startY = (canvas.height / 2) - ((lines.length - 1) * lineHeight / 2);
    
    lines.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });
    
    // Create texture and material
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide
    });
    
    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(
      room.dimensions.width * 0.8,
      room.dimensions.width * 0.4
    );
    
    const label = new THREE.Mesh(geometry, material);
    
    // Position above the room mass
    label.position.set(
      room.position.x,
      room.position.y + room.height / 2 + fontSize,
      room.position.z
    );
    
    // Make label face up
    label.rotation.x = -Math.PI / 2;
    
    label.userData = {
      type: 'room_label',
      roomId: room.id,
      parentRoomName: room.name
    };
    
    label.name = `Label_${room.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    return label;
  }

  /**
   * Generate all masses from layout data
   * @param {Object} layout - Layout data from blocking-stacking service
   * @param {Object} options - Creation options
   * @returns {Object} Created geometry data with groups and individual meshes
   */
  function generateAllMasses(layout, options = {}) {
    const {
      showLabels = true,
      wireframe = false,
      opacity = 0.8,
      groupByDepartment = true
    } = options;
    
    const { rooms, departments } = layout;
    
    const allMeshes = [];
    const allLabels = [];
    const departmentGroups = [];
    
    if (groupByDepartment) {
      // Create department-grouped structure
      departments.forEach(dept => {
        const departmentRooms = rooms.filter(room => room.department === dept.name);
        const roomMeshes = departmentRooms.map(room => 
          createRoomMass(room, { wireframe, opacity })
        );
        
        const departmentGroup = createDepartmentGroup(roomMeshes, dept);
        departmentGroups.push(departmentGroup);
        allMeshes.push(...roomMeshes);
        
        // Create labels if requested
        if (showLabels) {
          const labels = departmentRooms.map(room => createRoomLabel(room));
          labels.forEach(label => departmentGroup.add(label));
          allLabels.push(...labels);
        }
      });
    } else {
      // Create individual masses without grouping
      rooms.forEach(room => {
        const mesh = createRoomMass(room, { wireframe, opacity });
        allMeshes.push(mesh);
        
        if (showLabels) {
          const label = createRoomLabel(room);
          allLabels.push(label);
        }
      });
    }
    
    return {
      allMeshes,
      allLabels,
      departmentGroups,
      layout: layout,
      options: options
    };
  }

  /**
   * Add masses to scene
   * @param {Object} massData - Data from generateAllMasses
   * @param {Object} sceneOptions - Scene-specific options
   */
  function addMassesToScene(massData, sceneOptions = {}) {
    const { 
      addToSelection = true,
      centerView = true 
    } = sceneOptions;
    
    const { departmentGroups, allMeshes, allLabels } = massData;
    
    // Add to scene
    if (departmentGroups.length > 0) {
      departmentGroups.forEach(group => scene.add(group));
    } else {
      allMeshes.forEach(mesh => scene.add(mesh));
      allLabels.forEach(label => scene.add(label));
    }
    
    // Store reference for later management
    scene.userData.blockingMasses = {
      groups: departmentGroups,
      meshes: allMeshes,
      labels: allLabels,
      layout: massData.layout,
      createdAt: Date.now()
    };
    
    console.log(`Added ${allMeshes.length} room masses to scene in ${departmentGroups.length} department groups`);
    
    return {
      addedGroups: departmentGroups.length,
      addedMeshes: allMeshes.length,
      addedLabels: allLabels.length
    };
  }

  /**
   * Remove all blocking masses from scene
   */
  function clearBlockingMasses() {
    const blockingData = scene.userData.blockingMasses;
    if (!blockingData) return;
    
    // Remove groups (which contain meshes and labels)
    blockingData.groups.forEach(group => {
      scene.remove(group);
      // Dispose of geometries and materials
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
    
    // Remove individual meshes and labels if not in groups
    [...blockingData.meshes, ...blockingData.labels].forEach(obj => {
      if (obj.parent === scene) {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });
    
    delete scene.userData.blockingMasses;
    console.log('Cleared all blocking masses from scene');
  }

  return {
    createRoomMass,
    createDepartmentGroup,
    createRoomLabel,
    generateAllMasses,
    addMassesToScene,
    clearBlockingMasses,
    getDepartmentColor
  };
}