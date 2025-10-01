# Enhanced Room System Integration Guide

## Overview

The enhanced room system provides a hybrid approach where rooms can be:

1. **Manual Rooms** - Traditional mesh-based rooms (backward compatible)
2. **Detected Rooms** - Automatically found spaces bounded by walls/objects
3. **Hybrid Rooms** - Detected spaces with manual metadata added

## Integration Steps

### 1. Update Main Application

```javascript
// In js/app/app.js, update imports:

import { createRoomBoundaryDetection } from './services/room-boundary-detection.js';
import { createEnhancedRoomSystem } from './services/room-system-v2.js';
import { createEnhancedRoomManager } from './services/room-manager-v2.js';
import { createEnhancedRoomDesignationUI } from './services/room-designation-ui-v2.js';

// Replace existing room system initialization with:

// Create boundary detection system
const roomBoundaryDetection = createRoomBoundaryDetection({ THREE, scene });

// Create enhanced room system
const roomSystem = createEnhancedRoomSystem({ 
    THREE, 
    scene, 
    roomBoundaryDetection 
});

// Create enhanced room manager
const roomManager = createEnhancedRoomManager({ 
    THREE, 
    scene, 
    roomSystem, 
    roomBoundaryDetection, 
    persistence 
});

// Create enhanced UI
const roomDesignationUI = createEnhancedRoomDesignationUI({ 
    roomSystem, 
    roomManager, 
    roomBoundaryDetection,
    selectedObjects, 
    transformControls, 
    isOverlayOrChild: __isOverlayOrChild 
});
```

### 2. Room Detection Usage

```javascript
// Manual detection
roomManager.triggerDetection();

// Enable automatic detection
roomManager.setAutoDetectionEnabled(true);

// Get detected rooms
const allRooms = roomSystem.getAllRooms();
const detectedRooms = roomSystem.getRoomsByType(roomSystem.ROOM_TYPES.DETECTED);
const manualRooms = roomSystem.getRoomsByType(roomSystem.ROOM_TYPES.MANUAL);

// Find room containing a point
const room = roomSystem.getRoomContainingPoint(x, z);
```

### 3. Room Promotion Workflow

```javascript
// Promote detected room to hybrid (add manual metadata)
roomManager.promoteDetectedRoom(roomId, {
    name: 'Conference Room A',
    number: '101',
    department: 'Executive',
    metadata: {
        function: 'Meeting Space',
        notes: 'Has AV equipment'
    }
});
```

### 4. Boundary Object Setup

Objects that can form room boundaries should have appropriate userData:

```javascript
// Mark object as boundary
mesh.userData.isBoundary = true;

// For walls (detected automatically if tall and thin)
mesh.userData.type = 'wall';

// For furniture that blocks space
mesh.userData.type = 'furniture';
mesh.userData.canBlockRoom = true;
```

## Key Features

### Automatic Room Detection

- **Boundary Analysis**: Detects walls, furniture, and blocking masses
- **Spatial Algorithm**: Finds enclosed polygonal spaces
- **Size Filtering**: Ignores spaces too small or too large
- **Confidence Scoring**: Rates detection quality

### Real-time Updates

- **Movement Tracking**: Detects when boundary objects move
- **Dynamic Recalculation**: Updates room boundaries automatically
- **Visual Feedback**: Shows boundary visualizations

### Enhanced UI

- **Detection Controls**: Manual and automatic detection modes
- **Room Type Indicators**: Visual distinction between room types
- **Promotion Workflow**: Easy conversion of detected to managed rooms
- **Boundary Visualization**: Toggle room boundary overlays

## Configuration

Adjust detection parameters in `roomBoundaryDetection.DETECTION_SETTINGS`:

```javascript
DETECTION_SETTINGS = {
    floorLevel: 0,           // Y level considered "floor"
    minRoomArea: 25,         // Minimum square footage
    maxRoomArea: 10000,      // Maximum square footage
    boundaryTolerance: 0.1,  // Object proximity for boundaries
    doorwayMinWidth: 2,      // Minimum doorway width
    doorwayMaxWidth: 8,      // Maximum doorway width
    gridResolution: 0.5,     // Spatial analysis resolution
    wallThickness: 0.5       // Assumed wall thickness
}
```

## Backward Compatibility

The enhanced system maintains full backward compatibility:

- Existing room workflows continue to work unchanged
- Original API methods are preserved
- Existing room data is automatically migrated
- UI remains familiar with enhanced features added

## Room Statistics

```javascript
const stats = roomSystem.getRoomStatistics();
console.log(stats);
/*
{
    total: 15,
    byType: {
        manual: 8,
        detected: 5,
        hybrid: 2
    },
    totalSquareFootage: 2450,
    averageConfidence: 0.85,
    departments: ['Office', 'Conference', 'Storage']
}
*/
```

## Event Handling

```javascript
// Listen for room events
roomManager.addEventListener('roomAdded', (event) => {
    console.log(`New ${event.type} room: ${event.room.name}`);
});

roomManager.addEventListener('roomModified', (event) => {
    console.log(`Modified ${event.type} room: ${event.room.name}`);
});

roomManager.addEventListener('roomDeleted', (event) => {
    console.log(`Deleted ${event.type} room: ${event.room.name}`);
});
```

## Benefits

1. **Automatic Detection**: No manual room designation needed for most spaces
2. **Architectural Accuracy**: Rooms defined by actual spatial boundaries
3. **Real-time Updates**: Rooms adapt when objects move
4. **Progressive Enhancement**: Start with detection, add manual details
5. **Better Visualization**: See actual room boundaries and shapes
6. **Improved Workflows**: Faster room setup and management

## Use Cases

- **Architectural Planning**: Automatically identify spaces in building models
- **Space Management**: Track real room boundaries, not approximations
- **Facility Management**: Monitor how spaces change over time
- **Design Validation**: Ensure rooms meet size and access requirements
- **Export/Import**: Generate accurate floor plans and room schedules

The enhanced room system transforms room management from a manual object-designation process into an intelligent spatial analysis system that understands architectural principles and building layouts.