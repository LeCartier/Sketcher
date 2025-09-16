/**
 * Manual Dimensions Feature Module
 * 
 * Provides user-creatable dimension strings that match the live dimension aesthetic
 * but can be positioned manually and persist with the sketch. Dimensions maintain
 * relationships with their parent shapes and update automatically when shapes change.
 */

import { formatDimension } from './live-dimensions.js';

// Manual dimension objects storage
export let manualDimensions = [];

// Dimension settings (can be overridden by external settings)
let dimensionSettings = {
  textSize: 11,
  lineColor: 'rgba(120, 120, 120, 0.9)',
  selectedColor: 'rgba(30, 136, 229, 0.9)'
};

/**
 * Update dimension settings
 */
export function setDimensionSettings(settings) {
  dimensionSettings = { ...dimensionSettings, ...settings };
}

/**
 * Get current dimension settings
 */
export function getDimensionSettings() {
  return { ...dimensionSettings };
}

/**
 * Manual dimension object structure:
 * {
 *   id: string,              // Unique identifier
 *   type: 'linear',          // Dimension type (linear for now)
 *   startPoint: {x, y},      // Start point in world coordinates
 *   endPoint: {x, y},        // End point in world coordinates
 *   offsetPoint: {x, y},     // User-positioned dimension line location
 *   parentId: string|null,   // ID of parent shape (if attached)
 *   edgeIndex: number|null,  // Which edge/segment of parent (if applicable)
 *   isSelected: boolean,     // Selection state
 *   text: string|null        // Custom text override (null = auto-calculate)
 * }
 */

/**
 * Create a new manual dimension
 */
export function createManualDimension(startPoint, endPoint, offsetPoint, startSnapInfo = null, endSnapInfo = null) {
  const dimension = {
    id: `dim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'linear',
    startPoint: { ...startPoint },
    endPoint: { ...endPoint },
    offsetPoint: { ...offsetPoint },
    
    // Enhanced parent tracking for both start and end points
    startParentId: startSnapInfo?.parentId || null,
    startEdgeIndex: startSnapInfo?.edgeIndex ?? null,
    startType: startSnapInfo?.type || null,
    
    endParentId: endSnapInfo?.parentId || null,
    endEdgeIndex: endSnapInfo?.edgeIndex ?? null, 
    endType: endSnapInfo?.type || null,
    
    // Legacy fields for backward compatibility
    parentId: startSnapInfo?.parentId || endSnapInfo?.parentId || null,
    edgeIndex: startSnapInfo?.edgeIndex ?? endSnapInfo?.edgeIndex ?? null,
    
    isSelected: false,
    text: null
  };
  
  manualDimensions.push(dimension);
  return dimension;
}

/**
 * Delete a manual dimension by ID
 */
export function deleteManualDimension(dimensionId) {
  const index = manualDimensions.findIndex(dim => dim.id === dimensionId);
  if (index !== -1) {
    manualDimensions.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Find dimension by ID
 */
export function findDimensionById(dimensionId) {
  return manualDimensions.find(dim => dim.id === dimensionId);
}

/**
 * Select/deselect a dimension
 */
export function selectDimension(dimensionId, selected = true) {
  const dimension = findDimensionById(dimensionId);
  if (dimension) {
    dimension.isSelected = selected;
  }
}

/**
 * Clear all dimension selections
 */
export function clearDimensionSelections() {
  manualDimensions.forEach(dim => dim.isSelected = false);
}

/**
 * Update dimension offset point (for repositioning)
 */
export function updateDimensionOffset(dimensionId, newOffsetPoint) {
  const dimension = findDimensionById(dimensionId);
  if (dimension) {
    dimension.offsetPoint = { ...newOffsetPoint };
    return true;
  }
  return false;
}

/**
 * Update dimensions that are attached to a parent object
 * This is called when parent shapes are modified
 */
export function updateDimensionsForObject(objects, objectIndex) {
  const obj = objects[objectIndex];
  if (!obj) return false;
  
  let updated = false;
  const objectId = obj.id || `obj_${objectIndex}`;
  
  // Find dimensions that are attached to this object
  manualDimensions.forEach(dimension => {
    if (dimension.parentId === objectId || 
        dimension.startParentId === objectId || 
        dimension.endParentId === objectId) {
      
      // Update start point if attached to this object
      if (dimension.startParentId === objectId && dimension.startEdgeIndex !== null) {
        const newStartPoint = getPointOnObject(obj, dimension.startEdgeIndex, dimension.startType);
        if (newStartPoint) {
          dimension.startPoint = newStartPoint;
          updated = true;
        }
      }
      
      // Update end point if attached to this object  
      if (dimension.endParentId === objectId && dimension.endEdgeIndex !== null) {
        const newEndPoint = getPointOnObject(obj, dimension.endEdgeIndex, dimension.endType);
        if (newEndPoint) {
          dimension.endPoint = newEndPoint;
          updated = true;
        }
      }
      
      // Update legacy single parent ID (for backward compatibility)
      if (dimension.parentId === objectId && dimension.edgeIndex !== null) {
        const newPoint = getPointOnObject(obj, dimension.edgeIndex, 'edge');
        if (newPoint) {
          // Update whichever point is closer to the calculated snap point
          const distToStart = Math.hypot(newPoint.x - dimension.startPoint.x, newPoint.y - dimension.startPoint.y);
          const distToEnd = Math.hypot(newPoint.x - dimension.endPoint.x, newPoint.y - dimension.endPoint.y);
          
          if (distToStart < distToEnd) {
            dimension.startPoint = newPoint;
          } else {
            dimension.endPoint = newPoint;
          }
          updated = true;
        }
      }
    }
  });
  
  return updated;
}

/**
 * Get a point on an object based on edge index and type
 */
function getPointOnObject(obj, edgeIndex, snapType) {
  if (!obj || edgeIndex === null) return null;
  
  switch (obj.type) {
    case 'line':
      if (snapType === 'endpoint') {
        return edgeIndex === 0 ? obj.a : obj.b;
      } else if (snapType === 'edge') {
        // For edges, return midpoint or original point
        return {
          x: (obj.a.x + obj.b.x) / 2,
          y: (obj.a.y + obj.b.y) / 2
        };
      }
      break;
      
    case 'path':
      if (obj.pts && obj.pts.length > edgeIndex) {
        if (snapType === 'endpoint') {
          return obj.pts[edgeIndex];
        } else if (snapType === 'edge' && edgeIndex < obj.pts.length - 1) {
          // Return midpoint of edge
          const p1 = obj.pts[edgeIndex];
          const p2 = obj.pts[edgeIndex + 1];
          return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
          };
        }
      }
      break;
      
    case 'rect':
    case 'ellipse':
      // For rects and ellipses, calculate points based on current geometry
      // This is more complex and would need specific implementations
      break;
  }
  
  return null;
}

/**
 * Update all dimensions (call this after any object changes)
 */
export function updateAllDimensions(objects) {
  let updated = false;
  for (let i = 0; i < objects.length; i++) {
    if (updateDimensionsForObject(objects, i)) {
      updated = true;
    }
  }
  return updated;
}
export function updateDimensionsForParent(parentId, objects) {
  const parent = objects.find(obj => obj.id === parentId);
  if (!parent) {
    // Parent object was deleted - remove attached dimensions
    manualDimensions = manualDimensions.filter(dim => dim.parentId !== parentId);
    return;
  }
  
  // Update dimensions attached to this parent
  manualDimensions.forEach(dimension => {
    if (dimension.parentId === parentId) {
      updateDimensionFromParent(dimension, parent);
    }
  });
}

/**
 * Update a single dimension based on its parent object
 */
function updateDimensionFromParent(dimension, parentObject) {
  if (!parentObject || !dimension.parentId) return;
  
  switch (parentObject.type) {
    case 'line':
      if (parentObject.a && parentObject.b) {
        dimension.startPoint = { ...parentObject.a };
        dimension.endPoint = { ...parentObject.b };
      }
      break;
      
    case 'rect':
      if (parentObject.a && parentObject.b && dimension.edgeIndex !== null) {
        const corners = [
          { x: Math.min(parentObject.a.x, parentObject.b.x), y: Math.min(parentObject.a.y, parentObject.b.y) }, // top-left
          { x: Math.max(parentObject.a.x, parentObject.b.x), y: Math.min(parentObject.a.y, parentObject.b.y) }, // top-right
          { x: Math.max(parentObject.a.x, parentObject.b.x), y: Math.max(parentObject.a.y, parentObject.b.y) }, // bottom-right
          { x: Math.min(parentObject.a.x, parentObject.b.x), y: Math.max(parentObject.a.y, parentObject.b.y) }  // bottom-left
        ];
        
        switch (dimension.edgeIndex) {
          case 0: // top edge
            dimension.startPoint = corners[0];
            dimension.endPoint = corners[1];
            break;
          case 1: // right edge
            dimension.startPoint = corners[1];
            dimension.endPoint = corners[2];
            break;
          case 2: // bottom edge
            dimension.startPoint = corners[2];
            dimension.endPoint = corners[3];
            break;
          case 3: // left edge
            dimension.startPoint = corners[3];
            dimension.endPoint = corners[0];
            break;
        }
      }
      break;
      
    case 'ellipse':
      if (parentObject.a && parentObject.b && dimension.edgeIndex !== null) {
        const centerX = (parentObject.a.x + parentObject.b.x) / 2;
        const centerY = (parentObject.a.y + parentObject.b.y) / 2;
        const radiusX = Math.abs(parentObject.b.x - parentObject.a.x) / 2;
        const radiusY = Math.abs(parentObject.b.y - parentObject.a.y) / 2;
        
        switch (dimension.edgeIndex) {
          case 0: // horizontal diameter
            dimension.startPoint = { x: centerX - radiusX, y: centerY };
            dimension.endPoint = { x: centerX + radiusX, y: centerY };
            break;
          case 1: // vertical diameter
            dimension.startPoint = { x: centerX, y: centerY - radiusY };
            dimension.endPoint = { x: centerX, y: centerY + radiusY };
            break;
        }
      }
      break;
      
    // Add more shape types as needed
  }
}

/**
 * Draw all manual dimensions using the same aesthetic as live dimensions
 */
export function drawManualDimensions(ctx, worldToScreen) {
  manualDimensions.forEach(dimension => {
    drawManualDimension(ctx, dimension, worldToScreen);
  });
}

/**
 * Draw a single manual dimension
 */
function drawManualDimension(ctx, dimension, worldToScreen) {
  const startScreen = worldToScreen(dimension.startPoint);
  const endScreen = worldToScreen(dimension.endPoint);
  const offsetScreen = worldToScreen(dimension.offsetPoint);
  
  // Calculate distance in world coordinates
  const worldDistance = Math.sqrt(
    (dimension.endPoint.x - dimension.startPoint.x) ** 2 + 
    (dimension.endPoint.y - dimension.startPoint.y) ** 2
  );
  
  // Don't draw dimensions that are too small
  if (worldDistance < 0.01) return;
  
  // Use custom text or auto-formatted dimension
  const dimText = dimension.text || formatDimension(worldDistance);
  
  // Calculate dimension line position based on user offset point
  drawManualDimensionLine(ctx, startScreen, endScreen, offsetScreen, dimText, dimension.isSelected);
  
  // Draw grabbers for selected dimensions
  if (dimension.isSelected) {
    drawDimensionGrabbers(ctx, dimension, worldToScreen);
  }
}

/**
 * Draw manual dimension line with same aesthetic as live dimensions
 * Modified version of drawDimensionLine from live-dimensions.js to work with offset point
 */
function drawManualDimensionLine(ctx, start, end, offsetPoint, text, isSelected = false) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return;
  
  // Unit vector along the line
  const ux = dx / length;
  const uy = dy / length;
  
  // Calculate the dimension line position based on offset point
  // Project offset point onto the perpendicular from the midpoint
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  // Perpendicular vector
  const px = -uy;
  const py = ux;
  
  // Calculate offset distance (signed)
  const offsetDx = offsetPoint.x - midX;
  const offsetDy = offsetPoint.y - midY;
  const offset = offsetDx * px + offsetDy * py;
  
  // Dimension line endpoints
  const dimStart = {
    x: start.x + px * offset,
    y: start.y + py * offset
  };
  const dimEnd = {
    x: end.x + px * offset,
    y: end.y + py * offset
  };
  
  // All dimension linework in consistent style using settings
  const color = isSelected ? dimensionSettings.selectedColor : dimensionSettings.lineColor;
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 1.5 : 1;
  ctx.setLineDash([]);
  
  // Extension lines - start slightly offset from object, stop at dimension line
  const extensionGap = 2;
  const tickSize = 3;
  const tickOverrun = 2;
  
  // Extension line at start
  ctx.beginPath();
  ctx.moveTo(start.x + px * extensionGap, start.y + py * extensionGap);
  ctx.lineTo(dimStart.x, dimStart.y);
  ctx.stroke();
  
  // Extension line at end
  ctx.beginPath();
  ctx.moveTo(end.x + px * extensionGap, end.y + py * extensionGap);
  ctx.lineTo(dimEnd.x, dimEnd.y);
  ctx.stroke();
  
  // Dimension line - extends past tick marks
  const dimExtension = tickOverrun;
  ctx.beginPath();
  ctx.moveTo(dimStart.x - ux * dimExtension, dimStart.y - uy * dimExtension);
  ctx.lineTo(dimEnd.x + ux * dimExtension, dimEnd.y + uy * dimExtension);
  ctx.stroke();
  
  // Perpendicular tick marks
  const tickDirection = offset > 0 ? 1 : -1;
  
  // Start tick mark
  ctx.beginPath();
  ctx.moveTo(dimStart.x + px * tickDirection * tickSize, dimStart.y + py * tickDirection * tickSize);
  ctx.lineTo(dimStart.x - px * tickDirection * tickOverrun, dimStart.y - py * tickDirection * tickOverrun);
  ctx.stroke();
  
  // End tick mark
  ctx.beginPath();
  ctx.moveTo(dimEnd.x + px * tickDirection * tickSize, dimEnd.y + py * tickDirection * tickSize);
  ctx.lineTo(dimEnd.x - px * tickDirection * tickOverrun, dimEnd.y - py * tickDirection * tickOverrun);
  ctx.stroke();
  
  // Text background and text
  const midDimX = (dimStart.x + dimEnd.x) / 2;
  const midDimY = (dimStart.y + dimEnd.y) / 2;
  
  // Calculate rotation angle to follow the dimension line
  const textAngle = Math.atan2(dy, dx);
  let displayAngle = textAngle;
  
  // Keep text readable by flipping if upside down
  if (textAngle > Math.PI/2 || textAngle < -Math.PI/2) {
    displayAngle = textAngle + Math.PI;
  }
  
  ctx.save();
  ctx.translate(midDimX, midDimY);
  ctx.rotate(displayAngle);
  
  ctx.font = `${dimensionSettings.textSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Measure text for background
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width + 12;
  const textHeight = Math.max(16, dimensionSettings.textSize + 5);
  
  // Pill-shaped background
  const bgColor = isSelected ? 'rgba(30, 136, 229, 0.1)' : 'rgba(255, 255, 255, 0.95)';
  const borderColor = isSelected ? 'rgba(30, 136, 229, 0.3)' : 'transparent';
  
  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(-textWidth / 2, -textHeight / 2, textWidth, textHeight, textHeight / 2);
  } else {
    // Fallback for older browsers
    const radius = textHeight / 2;
    ctx.moveTo(-textWidth / 2 + radius, -textHeight / 2);
    ctx.lineTo(textWidth / 2 - radius, -textHeight / 2);
    ctx.quadraticCurveTo(textWidth / 2, -textHeight / 2, textWidth / 2, -textHeight / 2 + radius);
    ctx.lineTo(textWidth / 2, textHeight / 2 - radius);
    ctx.quadraticCurveTo(textWidth / 2, textHeight / 2, textWidth / 2 - radius, textHeight / 2);
    ctx.lineTo(-textWidth / 2 + radius, textHeight / 2);
    ctx.quadraticCurveTo(-textWidth / 2, textHeight / 2, -textWidth / 2, textHeight / 2 - radius);
    ctx.lineTo(-textWidth / 2, -textHeight / 2 + radius);
    ctx.quadraticCurveTo(-textWidth / 2, -textHeight / 2, -textWidth / 2 + radius, -textHeight / 2);
  }
  ctx.fill();
  if (isSelected) {
    ctx.stroke();
  }
  
  // Draw text
  ctx.fillStyle = isSelected ? '#0b3a6e' : '#222';
  ctx.fillText(text, 0, 0);
  
  ctx.restore();
}

/**
 * Draw repositioning grabbers for selected dimensions
 */
function drawDimensionGrabbers(ctx, dimension, worldToScreen) {
  const startScreen = worldToScreen(dimension.startPoint);
  const endScreen = worldToScreen(dimension.endPoint);
  const offsetScreen = worldToScreen(dimension.offsetPoint);
  
  // Calculate dimension line position
  const dx = endScreen.x - startScreen.x;
  const dy = endScreen.y - startScreen.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return;
  
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  
  // Calculate offset distance for dimension line
  const midX = (startScreen.x + endScreen.x) / 2;
  const midY = (startScreen.y + endScreen.y) / 2;
  const offsetDx = offsetScreen.x - midX;
  const offsetDy = offsetScreen.y - midY;
  const offset = offsetDx * px + offsetDy * py;
  
  // Dimension line endpoints and text position
  const dimStart = {
    x: startScreen.x + px * offset,
    y: startScreen.y + py * offset
  };
  const dimEnd = {
    x: endScreen.x + px * offset,
    y: endScreen.y + py * offset
  };
  const textPos = {
    x: (dimStart.x + dimEnd.x) / 2,
    y: (dimStart.y + dimEnd.y) / 2
  };
  
  const grabberSize = 6;
  const strokeColor = 'rgba(30, 136, 229, 0.8)';
  const fillColor = 'rgba(255, 255, 255, 0.9)';
  
  // Helper function to draw a single grabber
  function drawGrabber(x, y, isAttached = false) {
    ctx.save();
    
    // Different colors for attached vs unattached endpoints
    const grabberFill = isAttached ? 'rgba(46, 204, 113, 0.9)' : fillColor;
    const grabberStroke = isAttached ? 'rgba(39, 174, 96, 1)' : strokeColor;
    
    ctx.fillStyle = grabberFill;
    ctx.strokeStyle = grabberStroke;
    ctx.lineWidth = 1.5;
    
    ctx.beginPath();
    ctx.arc(x, y, grabberSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Small inner dot for better visibility
    ctx.fillStyle = grabberStroke;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
  
  // Start point grabber (check if attached to shape)
  const startAttached = dimension.startParentId !== null;
  drawGrabber(startScreen.x, startScreen.y, startAttached);
  
  // End point grabber (check if attached to shape)
  const endAttached = dimension.endParentId !== null;
  drawGrabber(endScreen.x, endScreen.y, endAttached);
  
  // Text/dimension line grabber (for repositioning the entire dimension line)
  drawGrabber(textPos.x, textPos.y, false);
  
  // Dimension line grabber (for repositioning along the perpendicular)
  drawGrabber(offsetScreen.x, offsetScreen.y, false);
}

/**
 * Hit test for dimension grabbers
 * Returns object with dimension ID and grabber type, or null
 * Grabber types: 'start', 'end', 'text', 'offset'
 */
export function hitTestDimensionGrabbers(screenPoint, worldToScreen, tolerance = 8) {
  // Only test selected dimensions
  for (let i = manualDimensions.length - 1; i >= 0; i--) {
    const dimension = manualDimensions[i];
    if (!dimension.isSelected) continue;
    
    const startScreen = worldToScreen(dimension.startPoint);
    const endScreen = worldToScreen(dimension.endPoint);
    const offsetScreen = worldToScreen(dimension.offsetPoint);
    
    // Calculate dimension line position for text grabber
    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 0) {
      const ux = dx / length;
      const uy = dy / length;
      const px = -uy;
      const py = ux;
      
      const midX = (startScreen.x + endScreen.x) / 2;
      const midY = (startScreen.y + endScreen.y) / 2;
      const offsetDx = offsetScreen.x - midX;
      const offsetDy = offsetScreen.y - midY;
      const offset = offsetDx * px + offsetDy * py;
      
      const dimStart = {
        x: startScreen.x + px * offset,
        y: startScreen.y + py * offset
      };
      const dimEnd = {
        x: endScreen.x + px * offset,
        y: endScreen.y + py * offset
      };
      const textPos = {
        x: (dimStart.x + dimEnd.x) / 2,
        y: (dimStart.y + dimEnd.y) / 2
      };
      
      // Test grabbers in order of priority
      const grabberTests = [
        { point: startScreen, type: 'start' },
        { point: endScreen, type: 'end' },
        { point: textPos, type: 'text' },
        { point: offsetScreen, type: 'offset' }
      ];
      
      for (const test of grabberTests) {
        const distance = Math.sqrt(
          (screenPoint.x - test.point.x) ** 2 + 
          (screenPoint.y - test.point.y) ** 2
        );
        
        if (distance <= tolerance) {
          return {
            dimensionId: dimension.id,
            grabberType: test.type
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * Hit test for dimension selection
 * Returns the dimension ID if hit, null otherwise
 */
export function hitTestDimensions(screenPoint, worldToScreen, tolerance = 10) {
  // Test dimensions in reverse order (most recently created first)
  for (let i = manualDimensions.length - 1; i >= 0; i--) {
    const dimension = manualDimensions[i];
    
    if (hitTestDimension(dimension, screenPoint, worldToScreen, tolerance)) {
      return dimension.id;
    }
  }
  return null;
}

/**
 * Hit test a single dimension
 */
function hitTestDimension(dimension, screenPoint, worldToScreen, tolerance) {
  const startScreen = worldToScreen(dimension.startPoint);
  const endScreen = worldToScreen(dimension.endPoint);
  const offsetScreen = worldToScreen(dimension.offsetPoint);
  
  // Calculate dimension line position
  const midX = (startScreen.x + endScreen.x) / 2;
  const midY = (startScreen.y + endScreen.y) / 2;
  
  const dx = endScreen.x - startScreen.x;
  const dy = endScreen.y - startScreen.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return false;
  
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  
  // Calculate offset
  const offsetDx = offsetScreen.x - midX;
  const offsetDy = offsetScreen.y - midY;
  const offset = offsetDx * px + offsetDy * py;
  
  const dimStart = {
    x: startScreen.x + px * offset,
    y: startScreen.y + py * offset
  };
  const dimEnd = {
    x: endScreen.x + px * offset,
    y: endScreen.y + py * offset
  };
  
  // Test distance from point to dimension line
  const distToLine = distancePointToLineSegment(screenPoint, dimStart, dimEnd);
  return distToLine <= tolerance;
}

/**
 * Calculate distance from point to line segment
 */
function distancePointToLineSegment(point, lineStart, lineEnd) {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // Line start and end are the same point
    return Math.sqrt(A * A + B * B);
  }
  
  let param = dot / lenSq;
  
  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Serialize manual dimensions for persistence
 */
export function serializeManualDimensions() {
  return manualDimensions.map(dim => ({ ...dim }));
}

/**
 * Restore manual dimensions from serialized data
 */
export function restoreManualDimensions(serializedDimensions) {
  manualDimensions = serializedDimensions.map(dim => ({ ...dim }));
}

/**
 * Clear all manual dimensions
 */
export function clearManualDimensions() {
  manualDimensions = [];
}

/**
 * Reposition a dimension grabber
 * @param {string} dimensionId - The dimension to modify
 * @param {string} grabberType - Type of grabber: 'start', 'end', 'text', 'offset'
 * @param {Object} newWorldPoint - New position in world coordinates
 * @param {Array} objects - Objects array for re-snapping
 */
export function repositionDimensionGrabber(dimensionId, grabberType, newWorldPoint, objects = []) {
  const dimension = manualDimensions.find(d => d.id === dimensionId);
  if (!dimension) return false;
  
  switch (grabberType) {
    case 'start':
      dimension.startPoint = { ...newWorldPoint };
      // Try to find new snap target
      const startSnap = findNearbySnapTarget(newWorldPoint, objects);
      if (startSnap) {
        dimension.startParentId = startSnap.parentId;
        dimension.startEdgeIndex = startSnap.edgeIndex;
        dimension.startType = startSnap.type;
        // Update legacy fields for backward compatibility
        if (!dimension.endParentId) {
          dimension.parentId = startSnap.parentId;
          dimension.edgeIndex = startSnap.edgeIndex;
        }
      } else {
        dimension.startParentId = null;
        dimension.startEdgeIndex = null;
        dimension.startType = null;
        // Update legacy fields
        if (!dimension.endParentId) {
          dimension.parentId = null;
          dimension.edgeIndex = null;
        }
      }
      break;
      
    case 'end':
      dimension.endPoint = { ...newWorldPoint };
      // Try to find new snap target
      const endSnap = findNearbySnapTarget(newWorldPoint, objects);
      if (endSnap) {
        dimension.endParentId = endSnap.parentId;
        dimension.endEdgeIndex = endSnap.edgeIndex;
        dimension.endType = endSnap.type;
        // Update legacy fields for backward compatibility
        if (!dimension.startParentId) {
          dimension.parentId = endSnap.parentId;
          dimension.edgeIndex = endSnap.edgeIndex;
        }
      } else {
        dimension.endParentId = null;
        dimension.endEdgeIndex = null;
        dimension.endType = null;
        // Update legacy fields
        if (!dimension.startParentId) {
          dimension.parentId = null;
          dimension.edgeIndex = null;
        }
      }
      break;
      
    case 'text':
      // Move both start and end points by the same offset to reposition the entire dimension
      const textDx = newWorldPoint.x - ((dimension.startPoint.x + dimension.endPoint.x) / 2);
      const textDy = newWorldPoint.y - ((dimension.startPoint.y + dimension.endPoint.y) / 2);
      
      dimension.startPoint.x += textDx;
      dimension.startPoint.y += textDy;
      dimension.endPoint.x += textDx;
      dimension.endPoint.y += textDy;
      
      // Keep the offset relationship the same
      dimension.offsetPoint.x += textDx;
      dimension.offsetPoint.y += textDy;
      
      // Clear attachments when moving the entire dimension
      dimension.startParentId = null;
      dimension.startEdgeIndex = null;
      dimension.startType = null;
      dimension.endParentId = null;
      dimension.endEdgeIndex = null;
      dimension.endType = null;
      dimension.parentId = null;
      dimension.edgeIndex = null;
      break;
      
    case 'offset':
      dimension.offsetPoint = { ...newWorldPoint };
      break;
  }
  
  return true;
}

/**
 * Find nearby snap target for repositioning
 */
function findNearbySnapTarget(worldPoint, objects, tolerance = 0.1) {
  // This is a simplified version - in a full implementation you'd want
  // to reuse the snap detection logic from the main app
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.type === 'path' && obj.pts && obj.pts.length >= 2) {
      // Check distance to each line segment
      for (let j = 0; j < obj.pts.length - 1; j++) {
        const start = obj.pts[j];
        const end = obj.pts[j + 1];
        const distance = distancePointToLineSegment(worldPoint, start, end);
        
        if (distance <= tolerance) {
          return {
            parentId: `obj_${i}`,
            edgeIndex: j,
            type: 'edge',
            point: worldPoint // Simplified - should project to nearest point on edge
          };
        }
      }
    }
  }
  return null;
}

/**
 * Get cursor style for grabber type
 */
export function getCursorForGrabber(grabberType) {
  switch (grabberType) {
    case 'start':
    case 'end':
      return 'move';
    case 'text':
      return 'move';
    case 'offset':
      return 'ns-resize';
    default:
      return 'default';
  }
}