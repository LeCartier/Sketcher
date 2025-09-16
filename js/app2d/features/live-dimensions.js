// ============================================================================
// Live Dimensions Feature for 2D Canvas
// Shows real-time dimensional feedback when objects are selected or being modified
// Displays dimensions in feet and inches with quarter-inch precision
// ============================================================================

/**
 * Convert feet to feet-inches-fractions format
 * @param {number} feet - Distance in decimal feet
 * @returns {string} Formatted string like "3'-4¼""
 */
export function formatDimension(feet) {
  if (feet < 0.02) return '0"'; // Less than quarter inch, show as zero
  
  const totalInches = feet * 12;
  const wholeFeet = Math.floor(feet);
  const remainingInches = totalInches - (wholeFeet * 12);
  
  // Round to nearest quarter inch
  const quarterInches = Math.round(remainingInches * 4);
  const wholeInches = Math.floor(quarterInches / 4);
  const fractionalQuarters = quarterInches % 4;
  
  let result = '';
  
  // Add feet if present
  if (wholeFeet > 0) {
    result += wholeFeet + "'";
    if (wholeInches > 0 || fractionalQuarters > 0) {
      result += '-';
    }
  }
  
  // Add inches
  if (wholeInches > 0) {
    result += wholeInches;
  }
  
  // Add fractions
  if (fractionalQuarters > 0) {
    const fractions = ['', '¼', '½', '¾'];
    result += fractions[fractionalQuarters];
  }
  
  result += '"';
  
  return result;
}

/**
 * Draw a dimension line with text
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} start - Start point in screen coordinates {x, y}
 * @param {Object} end - End point in screen coordinates {x, y}
 * @param {string} text - Dimension text to display
 * @param {number} offset - Offset distance from the line in pixels
 */
function drawDimensionLine(ctx, start, end, text, offset = 20) {
  ctx.save();
  
  // Calculate line properties
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length < 10) {
    ctx.restore();
    return; // Too short to dimension
  }
  
  // Unit vector along the line
  const ux = dx / length;
  const uy = dy / length;
  
  // Perpendicular vector for offset
  const px = -uy;
  const py = ux;
  
  // Offset the dimension line
  const dimStart = {
    x: start.x + px * offset,
    y: start.y + py * offset
  };
  const dimEnd = {
    x: end.x + px * offset,
    y: end.y + py * offset
  };
  
  // All dimension linework in consistent style
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.9)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  
  // Extension lines - start slightly offset from object, stop at dimension line
  const extensionGap = 2; // Small gap from object
  const tickSize = 3;
  const tickOverrun = 2; // How far tick extends through dimension line
  
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
  
  // Dimension line - extends past tick marks by same amount tick extends through
  const dimExtension = tickOverrun;
  ctx.beginPath();
  ctx.moveTo(dimStart.x - ux * dimExtension, dimStart.y - uy * dimExtension);
  ctx.lineTo(dimEnd.x + ux * dimExtension, dimEnd.y + uy * dimExtension);
  ctx.stroke();
  
  // Perpendicular tick marks - extend from object side through dimension line
  // Determine the direction from object toward dimension line (same as offset direction)
  const tickDirection = offset > 0 ? 1 : -1;
  
  // Start tick mark - extends from object side through dimension line
  ctx.beginPath();
  ctx.moveTo(dimStart.x + px * tickDirection * tickSize, dimStart.y + py * tickDirection * tickSize);
  ctx.lineTo(dimStart.x - px * tickDirection * tickOverrun, dimStart.y - py * tickDirection * tickOverrun);
  ctx.stroke();
  
  // End tick mark - extends from object side through dimension line
  ctx.beginPath();
  ctx.moveTo(dimEnd.x + px * tickDirection * tickSize, dimEnd.y + py * tickDirection * tickSize);
  ctx.lineTo(dimEnd.x - px * tickDirection * tickOverrun, dimEnd.y - py * tickDirection * tickOverrun);
  ctx.stroke();
  
  // Text background and text
  
  // Text background and text
  const midX = (dimStart.x + dimEnd.x) / 2;
  const midY = (dimStart.y + dimEnd.y) / 2;
  
  // Calculate rotation angle to follow the dimension line
  const textAngle = Math.atan2(dy, dx);
  let displayAngle = textAngle;
  
  // Keep text readable by flipping it if it's upside down
  if (textAngle > Math.PI/2 || textAngle < -Math.PI/2) {
    displayAngle = textAngle + Math.PI;
  }
  
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(displayAngle);
  
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Measure text for background
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width + 12; // Extra padding for pill shape
  const textHeight = 16;
  const pillRadius = textHeight / 2;
  
  // Pill-shaped background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  if (ctx.roundRect) {
    // Use native roundRect if available
    ctx.roundRect(
      -textWidth / 2,
      -textHeight / 2,
      textWidth,
      textHeight,
      pillRadius
    );
  } else {
    // Fallback for older browsers - draw pill shape manually
    const x = -textWidth / 2;
    const y = -textHeight / 2;
    const w = textWidth;
    const h = textHeight;
    const r = pillRadius;
    
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
  ctx.fill();
  
  // Pill border
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) {
    // Use native roundRect if available
    ctx.roundRect(
      -textWidth / 2,
      -textHeight / 2,
      textWidth,
      textHeight,
      pillRadius
    );
  } else {
    // Fallback for older browsers - draw pill shape manually
    const x = -textWidth / 2;
    const y = -textHeight / 2;
    const w = textWidth;
    const h = textHeight;
    const r = pillRadius;
    
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
  ctx.stroke();
  
  // Text
  ctx.fillStyle = 'rgba(60, 60, 60, 0.95)';
  ctx.fillText(text, 0, 0);
  
  ctx.restore();
  
  ctx.restore();
}

/**
 * Draw live dimensions for a selected object
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} view - View state with scale and pxPerFt
 * @param {Object} object - Selected object
 * @param {Function} worldToScreen - Function to convert world to screen coordinates
 */
export function drawLiveDimensions(ctx, view, object, worldToScreen) {
  if (!object) return;
  
  ctx.save();
  
  try {
    switch (object.type) {
      case 'line':
        drawLineDimensions(ctx, object, worldToScreen);
        break;
      case 'rect':
        drawRectDimensions(ctx, object, worldToScreen);
        break;
      case 'ellipse':
        drawEllipseDimensions(ctx, object, worldToScreen);
        break;
      case 'path':
        if (object.pts && object.pts.length >= 2) {
          drawPathDimensions(ctx, object, worldToScreen);
        }
        break;
    }
    
    // For drawing objects with special modes, show additional context
    if (object.__mode) {
      switch (object.__mode) {
        case 'polyline':
        case 'polygon':
          // Show overall dimensions while drawing complex shapes
          if (object.pts && object.pts.length >= 2) {
            drawPathDimensions(ctx, object, worldToScreen);
          }
          break;
        case 'regpoly':
        case 'star':
          // Show radius for regular polygons and stars
          if (object.pts && object.pts.length >= 2) {
            const center = object.pts[0];
            const edge = object.pts[1] || object.pts[object.pts.length - 1];
            if (center && edge) {
              const radius = Math.sqrt(
                (edge.x - center.x) ** 2 + (edge.y - center.y) ** 2
              );
              if (radius > 0.02) {
                const centerScreen = worldToScreen(center);
                const edgeScreen = worldToScreen(edge);
                const radiusText = formatDimension(radius) + " radius";
                drawDimensionLine(ctx, centerScreen, edgeScreen, radiusText, 15);
              }
            }
          }
          break;
      }
    }
    
  } catch (error) {
    console.warn('Error drawing live dimensions:', error);
  }
  
  ctx.restore();
}

/**
 * Draw dimensions for a line object
 */
function drawLineDimensions(ctx, line, worldToScreen) {
  if (!line.a || !line.b) return; // Safety check for incomplete objects
  
  const startScreen = worldToScreen(line.a);
  const endScreen = worldToScreen(line.b);
  
  const worldDistance = Math.sqrt(
    (line.b.x - line.a.x) ** 2 + (line.b.y - line.a.y) ** 2
  );
  
  // Don't show dimensions for very short lines (less than 1/4 inch)
  if (worldDistance < 0.02) return;
  
  const dimText = formatDimension(worldDistance);
  // Use smaller offset for lines since they don't have selection handles
  drawDimensionLine(ctx, startScreen, endScreen, dimText, 15);
}

/**
 * Draw dimensions for a rectangle object
 */
function drawRectDimensions(ctx, rect, worldToScreen) {
  if (!rect.a || !rect.b) return; // Safety check for incomplete objects
  
  const topLeft = worldToScreen({ x: Math.min(rect.a.x, rect.b.x), y: Math.min(rect.a.y, rect.b.y) });
  const topRight = worldToScreen({ x: Math.max(rect.a.x, rect.b.x), y: Math.min(rect.a.y, rect.b.y) });
  const bottomLeft = worldToScreen({ x: Math.min(rect.a.x, rect.b.x), y: Math.max(rect.a.y, rect.b.y) });
  const bottomRight = worldToScreen({ x: Math.max(rect.a.x, rect.b.x), y: Math.max(rect.a.y, rect.b.y) });
  
  const width = Math.abs(rect.b.x - rect.a.x);
  const height = Math.abs(rect.b.y - rect.a.y);
  
  // Only show dimensions for rectangles with meaningful size (larger than 1/4 inch)
  if (width < 0.02 && height < 0.02) return;
  
  // Width dimension (top) - positioned just outside bounding box/grabbers
  if (width >= 0.02) {
    const widthText = formatDimension(width);
    drawDimensionLine(ctx, topLeft, topRight, widthText, -20);
  }
  
  // Height dimension (left side) - positioned just outside bounding box/grabbers to avoid selection handles
  if (height >= 0.02) {
    const heightText = formatDimension(height);
    drawDimensionLine(ctx, topRight, bottomRight, heightText, -20);
  }
}

/**
 * Draw dimensions for an ellipse object
 */
function drawEllipseDimensions(ctx, ellipse, worldToScreen) {
  if (!ellipse.a || !ellipse.b) return; // Safety check for incomplete objects
  
  const centerX = (ellipse.a.x + ellipse.b.x) / 2;
  const centerY = (ellipse.a.y + ellipse.b.y) / 2;
  const radiusX = Math.abs(ellipse.b.x - ellipse.a.x) / 2;
  const radiusY = Math.abs(ellipse.b.y - ellipse.a.y) / 2;
  
  // Only show dimensions for ellipses with meaningful size
  if (radiusX < 0.01 && radiusY < 0.01) return;
  
  // Horizontal diameter - positioned above the ellipse to stay outside
  if (radiusX >= 0.01) {
    const leftPoint = worldToScreen({ x: centerX - radiusX, y: centerY - radiusY });
    const rightPoint = worldToScreen({ x: centerX + radiusX, y: centerY - radiusY });
    const widthText = formatDimension(radiusX * 2);
    drawDimensionLine(ctx, leftPoint, rightPoint, widthText, -20);
  }
  
  // Vertical diameter - positioned to the left of the ellipse to stay outside
  if (radiusY >= 0.01) {
    const topPoint = worldToScreen({ x: centerX - radiusX, y: centerY - radiusY });
    const bottomPoint = worldToScreen({ x: centerX - radiusX, y: centerY + radiusY });
    const heightText = formatDimension(radiusY * 2);
    drawDimensionLine(ctx, topPoint, bottomPoint, heightText, -20);
  }
}

/**
 * Draw dimensions for path segments and overall dimensions
 */
function drawPathDimensions(ctx, path, worldToScreen) {
  if (!path.pts || path.pts.length < 2) return;
  
  // Calculate bounding box for overall dimensions
  const xs = path.pts.map(p => p.x);
  const ys = path.pts.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  const overallWidth = maxX - minX;
  const overallHeight = maxY - minY;
  
  // Show overall dimensions for irregular shapes (non-rectangular paths)
  if (overallWidth > 1/12 && overallHeight > 1/12) { // Only if bigger than 1 inch
    // Overall width dimension (top) - positioned just outside bounding box
    const topLeft = worldToScreen({ x: minX, y: minY });
    const topRight = worldToScreen({ x: maxX, y: minY });
    const widthText = formatDimension(overallWidth) + " overall";
    drawDimensionLine(ctx, topLeft, topRight, widthText, -25);
    
    // Overall height dimension (left side) - positioned to avoid selection handles
    const bottomRight = worldToScreen({ x: maxX, y: maxY });
    const heightText = formatDimension(overallHeight) + " overall";
    drawDimensionLine(ctx, topRight, bottomRight, heightText, -25);
  }
  
  // Show individual segment dimensions for significant segments
  let segmentCount = 0;
  for (let i = 0; i < path.pts.length - 1 && segmentCount < 4; i++) { // Limit to 4 segments to avoid clutter
    const start = path.pts[i];
    const end = path.pts[i + 1];
    
    const distance = Math.sqrt(
      (end.x - start.x) ** 2 + (end.y - start.y) ** 2
    );
    
    // Only show dimensions for segments longer than 1 inch (1/12 ft)
    if (distance > 1/12) {
      const startScreen = worldToScreen(start);
      const endScreen = worldToScreen(end);
      const dimText = formatDimension(distance);
      
      // Alternate the offset side and vary distance to avoid overlapping dimensions
      const baseOffset = 20;
      const offsetVariation = segmentCount * 5; // Stagger dimensions
      const offset = (i % 2 === 0) ? (baseOffset + offsetVariation) : -(baseOffset + offsetVariation);
      drawDimensionLine(ctx, startScreen, endScreen, dimText, offset);
      segmentCount++;
    }
  }
  
  // If it's a closed path, show dimension for the closing segment
  if (path.closed && path.pts.length > 2 && segmentCount < 4) {
    const start = path.pts[path.pts.length - 1];
    const end = path.pts[0];
    
    const distance = Math.sqrt(
      (end.x - start.x) ** 2 + (end.y - start.y) ** 2
    );
    
    if (distance > 1/12) {
      const startScreen = worldToScreen(start);
      const endScreen = worldToScreen(end);
      const dimText = formatDimension(distance);
      const offset = (segmentCount % 2 === 0) ? (20 + segmentCount * 5) : -(20 + segmentCount * 5);
      drawDimensionLine(ctx, startScreen, endScreen, dimText, offset);
    }
  }
}

/**
 * Check if live dimensions should be shown for current state
 * @param {Object} selection - Selection state
 * @param {boolean} selectToggle - Whether selection mode is active
 * @param {Object} drawing - Current drawing object (if any)
 * @returns {boolean} True if dimensions should be shown
 */
export function shouldShowLiveDimensions(selection, selectToggle, drawing = null) {
  // Show dimensions when:
  // 1. Selection mode is active and an object is selected
  // 2. An object is being actively modified (moved, scaled, etc.)
  // 3. An object is currently being drawn
  return (selectToggle && selection.index >= 0 && (
    selection.mode === null || // Object selected but not being transformed
    selection.mode === 'move' || // Object being moved
    selection.mode === 'scale' || // Object being scaled
    selection.mode === 'rotate' // Object being rotated
  )) || (drawing !== null); // Or something is being drawn
}