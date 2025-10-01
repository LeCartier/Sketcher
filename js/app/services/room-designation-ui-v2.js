/*
====================================================================================
ENHANCED ROOM DESIGNATION UI V2 - BOUNDARY-AWARE INTERFACE
====================================================================================
Plain Meaning:
  Updated room management interface that works with both traditional mesh-based rooms
  and automatically detected boundary-based rooms. Provides tools for room detection,
  promotion, and management.

Developer Summary:
  Enhanced UI features:
  1. Auto-detection controls and visualization
  2. Detected room promotion to managed rooms
  3. Boundary visualization and editing
  4. Mixed room type management
  5. Real-time detection feedback

Key Features:
  Detection Panel: Controls for automatic room detection
  Room Type Indicators: Visual distinction between room types
  Promotion Workflow: Convert detected rooms to managed rooms
  Boundary Visualization: Show room boundaries and objects
====================================================================================
*/

export function createEnhancedRoomDesignationUI({ 
  roomSystem, 
  roomManager, 
  roomBoundaryDetection,
  selectedObjects, 
  transformControls, 
  isOverlayOrChild 
}) {
  
  let isInitialized = false;
  let currentRoom = null;
  let selectedObject = null;
  let isRoomManagerOpen = false;
  let isDetectionVisualsVisible = false;
  
  /**
   * Initialize the enhanced room designation UI
   */
  function initialize() {
    if (isInitialized) return;
    
    createEnhancedRoomManagerPanel();
    createRoomDesignationModal();
    createDetectionControlPanel();
    setupKeyboardShortcuts();
    setupEventListeners();
    
    isInitialized = true;
    console.log('Enhanced Room Designation UI initialized');
  }
  
  /**
   * Create the enhanced movable room manager panel
   */
  function createEnhancedRoomManagerPanel() {
    console.log('Creating enhanced room manager panel...');
    
    const panelHTML = `
      <div id="roomManagerPanel" class="room-manager-panel enhanced" style="display: none;">
        <div class="room-manager-header">
          <h3>Room Manager <span class="version-badge">v2.0</span></h3>
          <div class="room-manager-actions">
            <button class="btn btn-sm btn-outline" id="refreshRoomData" title="Refresh room data">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="btn btn-sm btn-primary" id="toggleDetectionVisuals" title="Toggle boundary visuals">
              <i class="fas fa-eye"></i>
            </button>
            <button class="room-manager-close" aria-label="Close">&times;</button>
          </div>
        </div>
        
        <div class="room-manager-body">
          <div class="room-manager-content">
            
            <!-- Room Placement Section -->
            <div class="room-placement-section">
              <h4>Room Placement</h4>
              <div class="placement-controls">
                <div class="placement-status">
                  <span id="placementStatus" class="status-indicator">Ready</span>
                  <span id="placementMode" class="placement-mode">Click to Place</span>
                </div>
                <div class="placement-buttons">
                  <button class="btn btn-primary btn-sm" id="enableRoomPlacement">
                    Place Room
                  </button>
                  <button class="btn btn-secondary btn-sm" id="cancelPlacement">
                    Cancel
                  </button>
                  <button class="btn btn-outline btn-sm" id="clearAllRooms">
                    Clear All
                  </button>
                </div>
              </div>
            </div>
            
            <!-- Room Overview Section (Enhanced) -->
            <div class="room-overview-section">
              <h4>Room Overview</h4>
              <div class="room-stats-grid enhanced">
                <div class="stat-card">
                  <div class="stat-value" id="totalRoomsCount">0</div>
                  <div class="stat-label">Total Rooms</div>
                </div>
                <div class="stat-card placed">
                  <div class="stat-value" id="placedRoomsCount">0</div>
                  <div class="stat-label">Placed Rooms</div>
                </div>
                <div class="stat-card manual">
                  <div class="stat-value" id="manualRoomsCount">0</div>
                  <div class="stat-label">Manual</div>
                </div>
                <div class="stat-card hybrid">
                  <div class="stat-value" id="hybridRoomsCount">0</div>
                  <div class="stat-label">Hybrid</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="totalSquareFootage">0</div>
                  <div class="stat-label">Total Sq Ft</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="averageConfidence">0</div>
                  <div class="stat-label">Avg Confidence</div>
                </div>
              </div>
            </div>
            
            <!-- Quick Actions Section (Enhanced) -->
            <div class="quick-actions-section">
              <h4>Quick Actions</h4>
              <div class="action-buttons enhanced">
                <button class="btn btn-primary btn-sm" id="designateSelectedRoom">
                  Designate Selected as Room
                </button>
                <button class="btn btn-success btn-sm" id="promoteSelectedDetected">
                  Promote Detected Room
                </button>
                <button class="btn btn-secondary btn-sm" id="showAllRooms">
                  Show All Rooms
                </button>
                <button class="btn btn-secondary btn-sm" id="validateRooms">
                  Validate & Fix Rooms
                </button>
              </div>
            </div>
            
            <!-- Room List Section (Enhanced) -->
            <div class="room-list-section">
              <div class="room-list-header">
                <h4>Rooms</h4>
                <div class="room-list-controls enhanced">
                  <input type="text" id="roomSearchInput" class="form-control form-control-sm" placeholder="Search rooms...">
                  <select id="departmentFilter" class="form-control form-control-sm">
                    <option value="">All Departments</option>
                  </select>
                  <select id="roomTypeFilter" class="form-control form-control-sm">
                    <option value="">All Types</option>
                    <option value="manual">Manual</option>
                    <option value="detected">Detected</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>
              
              <div class="room-list-container enhanced" id="roomListContainer">
                <div class="room-list-empty">
                  <p>No rooms found. Use "Detect Rooms" to automatically find spaces or "Designate Selected as Room" for manual rooms.</p>
                </div>
              </div>
            </div>
            
            <!-- Detection Settings Section -->
            <div class="detection-settings-section" style="display: none;">
              <h4>Detection Settings</h4>
              <div class="settings-grid">
                <div class="setting-item">
                  <label>Min Room Area (sq ft):</label>
                  <input type="number" id="minRoomArea" min="10" max="1000" value="25">
                </div>
                <div class="setting-item">
                  <label>Boundary Tolerance:</label>
                  <input type="number" id="boundaryTolerance" min="0.01" max="1" step="0.01" value="0.1">
                </div>
                <div class="setting-item">
                  <label>Grid Resolution:</label>
                  <input type="number" id="gridResolution" min="0.1" max="2" step="0.1" value="0.5">
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    `;
    
    // Add enhanced styles
    const enhancedStyles = `
      <style>
        .room-manager-panel.enhanced {
          min-width: 400px;
          max-width: 500px;
        }
        
        .version-badge {
          background: #007bff;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.7em;
          margin-left: 8px;
        }
        
        .room-detection-section {
          background: #f8f9fa;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
        }
        
        .detection-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .detection-status {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        
        .status-indicator {
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 0.8em;
          font-weight: 500;
        }
        
        .status-indicator.ready { background: #28a745; color: white; }
        .status-indicator.detecting { background: #ffc107; color: black; }
        .status-indicator.error { background: #dc3545; color: white; }
        
        .detection-mode {
          padding: 2px 8px;
          background: #6c757d;
          color: white;
          border-radius: 12px;
          font-size: 0.8em;
        }
        
        .detection-mode.auto { background: #17a2b8; }
        
        .detection-buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        
        .room-stats-grid.enhanced {
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        
        .stat-card.detected { border-left: 3px solid #17a2b8; }
        .stat-card.manual { border-left: 3px solid #28a745; }
        .stat-card.hybrid { border-left: 3px solid #ffc107; }
        
        .action-buttons.enhanced {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        
        .room-list-controls.enhanced {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 6px;
          margin-bottom: 12px;
        }
        
        .room-item.enhanced {
          position: relative;
          padding-left: 8px;
        }
        
        .room-item.enhanced::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          border-radius: 0 2px 2px 0;
        }
        
        .room-item.type-manual::before { background: #28a745; }
        .room-item.type-detected::before { background: #17a2b8; }
        .room-item.type-hybrid::before { background: #ffc107; }
        
        .room-confidence {
          font-size: 0.8em;
          color: #666;
          margin-left: 8px;
        }
        
        .settings-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        
        .setting-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .setting-item label {
          font-weight: 500;
          font-size: 0.9em;
        }
        
        .setting-item input {
          padding: 4px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        
        /* Room Designation Modal Styles */
        .room-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        
        .room-modal-content {
          background: white;
          border-radius: 8px;
          max-width: 500px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        
        .room-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #eee;
        }
        
        .room-modal-header h2 {
          margin: 0;
          font-size: 1.5em;
        }
        
        .room-modal-close {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .room-modal-body {
          padding: 20px;
        }
        
        .room-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid #eee;
        }
        
        .form-group {
          margin-bottom: 16px;
        }
        
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
        }
        
        .form-control {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .calculated-properties {
          background: #f8f9fa;
          padding: 16px;
          border-radius: 6px;
          margin-top: 16px;
        }
        
        .calculated-properties h4 {
          margin: 0 0 12px 0;
        }
        
        .property-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        
        .property-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .property-item label {
          font-weight: 500;
          margin: 0;
        }
        
        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          text-decoration: none;
          display: inline-block;
          text-align: center;
        }
        
        .btn-primary {
          background: #007bff;
          color: white;
        }
        
        .btn-secondary {
          background: #6c757d;
          color: white;
        }
        
        .btn:hover {
          opacity: 0.9;
        }
      </style>
    `;
    
    // Add panel to document
    if (!document.getElementById('roomManagerPanel')) {
      document.head.insertAdjacentHTML('beforeend', enhancedStyles);
      document.body.insertAdjacentHTML('beforeend', panelHTML);
      makeRoomManagerDraggable();
    }
  }
  
  /**
   * Create the room designation modal (from original UI)
   */
  function createRoomDesignationModal() {
    const modalHTML = `
      <div id="roomDesignationModal" class="room-modal" style="display: none;">
        <div class="room-modal-content">
          <div class="room-modal-header">
            <h2>Designate as Room</h2>
            <button class="room-modal-close" aria-label="Close">&times;</button>
          </div>
          
          <div class="room-modal-body">
            <div class="room-designation-form">
              <div class="form-group">
                <label for="roomName">Room Name *</label>
                <input type="text" id="roomName" class="form-control" placeholder="Enter room name" required>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="roomNumber">Room Number</label>
                  <input type="text" id="roomNumber" class="form-control" placeholder="e.g., 101, A-205">
                </div>
                
                <div class="form-group">
                  <label for="roomDepartment">Department *</label>
                  <select id="roomDepartment" class="form-control" required>
                    <option value="">Select Department</option>
                    <option value="Administration">Administration</option>
                    <option value="Management">Management</option>
                    <option value="Technology">Technology</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Sales">Sales</option>
                    <option value="Creative">Creative</option>
                    <option value="Common Areas">Common Areas</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="roomHeight">Height (feet)</label>
                  <input type="number" id="roomHeight" class="form-control" value="8" min="6" max="20" step="0.5">
                </div>
                
                <div class="form-group">
                  <label for="roomOccupancy">Occupancy</label>
                  <input type="number" id="roomOccupancy" class="form-control" placeholder="Max occupancy" min="0">
                </div>
              </div>
              
              <div class="form-group">
                <label for="roomFunction">Function</label>
                <input type="text" id="roomFunction" class="form-control" placeholder="e.g., Conference, Office, Storage">
              </div>
              
              <div class="form-group">
                <label for="roomNotes">Notes</label>
                <textarea id="roomNotes" class="form-control" rows="3" placeholder="Additional notes about this room"></textarea>
              </div>
              
              <div class="calculated-properties">
                <h4>Calculated Properties</h4>
                <div class="property-grid">
                  <div class="property-item">
                    <label>Square Footage:</label>
                    <span id="calculatedSquareFootage">--</span>
                  </div>
                  <div class="property-item">
                    <label>Volume:</label>
                    <span id="calculatedVolume">--</span>
                  </div>
                  <div class="property-item">
                    <label>Dimensions:</label>
                    <span id="calculatedDimensions">--</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="room-modal-footer">
            <button type="button" class="btn btn-secondary" id="cancelRoomDesignation">Cancel</button>
            <button type="button" class="btn btn-primary" id="confirmRoomDesignation">Designate as Room</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add event listeners
    document.getElementById('roomDesignationModal').querySelector('.room-modal-close').addEventListener('click', hideRoomDesignationModal);
    document.getElementById('cancelRoomDesignation').addEventListener('click', hideRoomDesignationModal);
    document.getElementById('confirmRoomDesignation').addEventListener('click', handleRoomDesignation);
  }
  
  /**
   * Show room designation modal for selected object
   */
  function showRoomDesignationModal(object) {
    if (!object || !object.isMesh) {
      alert('Please select a 3D object to designate as a room.');
      return;
    }
    
    selectedObject = object;
    
    // Calculate properties for preview
    updateCalculatedProperties(object);
    
    // Clear form
    resetRoomDesignationForm();
    
    // Show modal
    document.getElementById('roomDesignationModal').style.display = 'flex';
    document.getElementById('roomName').focus();
  }
  
  /**
   * Hide room designation modal
   */
  function hideRoomDesignationModal() {
    document.getElementById('roomDesignationModal').style.display = 'none';
    selectedObject = null;
  }
  
  /**
   * Handle room designation form submission
   */
  function handleRoomDesignation() {
    if (!selectedObject) return;
    
    const formData = collectRoomDesignationData();
    if (!formData) return;
    
    try {
      if (roomManager && roomManager.designateAsRoom) {
        const room = roomManager.designateAsRoom(selectedObject, formData);
        console.log(`Room designated: ${room.name}`);
        updateRoomList();
        updateRoomStats();
        hideRoomDesignationModal();
      }
    } catch (error) {
      console.error('Error designating room:', error);
      alert('Error creating room: ' + error.message);
    }
  }
  
  /**
   * Collect room designation form data
   */
  function collectRoomDesignationData() {
    const name = document.getElementById('roomName')?.value.trim();
    const number = document.getElementById('roomNumber')?.value.trim();
    const department = document.getElementById('roomDepartment')?.value;
    const height = parseFloat(document.getElementById('roomHeight')?.value) || 8;
    const occupancy = parseInt(document.getElementById('roomOccupancy')?.value) || null;
    const func = document.getElementById('roomFunction')?.value.trim();
    const notes = document.getElementById('roomNotes')?.value.trim();
    
    if (!name) {
      alert('Room name is required');
      return null;
    }
    
    if (!department) {
      alert('Department is required');
      return null;
    }
    
    return {
      name,
      number,
      department,
      height,
      metadata: {
        occupancy,
        function: func,
        notes
      }
    };
  }
  
  /**
   * Reset room designation form
   */
  function resetRoomDesignationForm() {
    document.getElementById('roomName').value = '';
    document.getElementById('roomNumber').value = '';
    document.getElementById('roomDepartment').value = '';
    document.getElementById('roomHeight').value = '8';
    document.getElementById('roomOccupancy').value = '';
    document.getElementById('roomFunction').value = '';
    document.getElementById('roomNotes').value = '';
  }
  
  /**
   * Update calculated properties preview
   */
  function updateCalculatedProperties(object) {
    if (!object || !object.isMesh) return;
    
    try {
      const bbox = new THREE.Box3().setFromObject(object);
      const size = bbox.getSize(new THREE.Vector3());
      
      const metersToFeet = 3.28084;
      const squareFootage = (size.x * size.z) * (metersToFeet * metersToFeet);
      const volume = (size.x * size.z * size.y) * (metersToFeet * metersToFeet * metersToFeet);
      
      document.getElementById('calculatedSquareFootage').textContent = Math.round(squareFootage) + ' sq ft';
      document.getElementById('calculatedVolume').textContent = Math.round(volume) + ' cu ft';
      document.getElementById('calculatedDimensions').textContent = 
        `${(size.x * metersToFeet).toFixed(1)}' × ${(size.z * metersToFeet).toFixed(1)}' × ${(size.y * metersToFeet).toFixed(1)}'`;
        
    } catch (error) {
      console.error('Error calculating properties:', error);
    }
  }
  
  /**
   * Create detection control panel
   */
  function createDetectionControlPanel() {
    // Detection controls are integrated into the main panel
    console.log('Detection controls integrated into main panel');
  }
  
  /**
   * Setup keyboard shortcuts
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      // Escape key closes modals/panels
      if (event.key === 'Escape') {
        if (document.getElementById('roomDesignationModal') && 
            document.getElementById('roomDesignationModal').style.display !== 'none') {
          hideRoomDesignationModal();
        }
        if (document.getElementById('roomManagerPanel') && 
            document.getElementById('roomManagerPanel').style.display !== 'none') {
          toggleRoomManagerPanel();
        }
      }
      
      // R key for room designation (when object is selected)
      if (event.key === 'r' || event.key === 'R') {
        if (!event.ctrlKey && !event.altKey && !event.shiftKey) {
          // Only if no modals are open
          const hasModalsOpen = (document.getElementById('roomDesignationModal') && 
                                document.getElementById('roomDesignationModal').style.display !== 'none') ||
                               (document.getElementById('roomManagerPanel') && 
                                document.getElementById('roomManagerPanel').style.display !== 'none');
          
          if (!hasModalsOpen && selectedObjects && selectedObjects.length > 0) {
            event.preventDefault();
            showRoomDesignationModal(selectedObjects[0]);
          }
        }
      }
    });
  }
  
  /**
   * Setup enhanced event listeners
   */
  function setupEventListeners() {
    // Original listeners
    setupOriginalListeners();
    
    // Enhanced listeners
    setupDetectionListeners();
    setupRoomTypeListeners();
    setupVisualizationListeners();
  }
  
  /**
   * Setup room placement event listeners
   */
  function setupDetectionListeners() {
    const enablePlacementBtn = document.getElementById('enableRoomPlacement');
    const cancelPlacementBtn = document.getElementById('cancelPlacement');
    const clearAllRoomsBtn = document.getElementById('clearAllRooms');
    const promoteSelectedBtn = document.getElementById('promoteSelectedDetected');
    
    if (enablePlacementBtn) {
      enablePlacementBtn.addEventListener('click', handleEnableRoomPlacement);
    }
    
    if (cancelPlacementBtn) {
      cancelPlacementBtn.addEventListener('click', handleCancelPlacement);
    }
    
    if (clearAllRoomsBtn) {
      clearAllRoomsBtn.addEventListener('click', handleClearAllRooms);
    }
    
    if (promoteSelectedBtn) {
      promoteSelectedBtn.addEventListener('click', handlePromoteDetected);
    }
    
    // Room manager event listeners
    if (roomManager) {
      roomManager.addEventListener('roomAdded', handleRoomAdded);
      roomManager.addEventListener('roomModified', handleRoomModified);
      roomManager.addEventListener('roomDeleted', handleRoomDeleted);
    }
  }
  
  /**
   * Setup room type filtering listeners
   */
  function setupRoomTypeListeners() {
    const roomTypeFilter = document.getElementById('roomTypeFilter');
    
    if (roomTypeFilter) {
      roomTypeFilter.addEventListener('change', handleRoomTypeFilter);
    }
  }
  
  /**
   * Setup visualization listeners
   */
  function setupVisualizationListeners() {
    const toggleVisualsBtn = document.getElementById('toggleDetectionVisuals');
    
    if (toggleVisualsBtn) {
      toggleVisualsBtn.addEventListener('click', handleToggleVisuals);
    }
  }
  
  /**
   * Handle enable room placement
   */
  function handleEnableRoomPlacement() {
    console.log('handleEnableRoomPlacement called');
    
    const statusEl = document.getElementById('placementStatus');
    const modeEl = document.getElementById('placementMode');
    const btn = document.getElementById('enableRoomPlacement');
    
    console.log('Status element:', statusEl);
    console.log('Mode element:', modeEl);
    console.log('Button element:', btn);
    
    if (statusEl) {
      statusEl.textContent = 'Click to Place';
      statusEl.className = 'status-indicator active';
    }
    
    if (modeEl) {
      modeEl.textContent = 'Placement Mode';
    }
    
    if (btn) {
      btn.textContent = 'Placing...';
      btn.disabled = true;
    }
    
    // Enable room placement mode
    console.log('Calling enableRoomPlacementMode...');
    enableRoomPlacementMode();
  }
  
  /**
   * Handle cancel room placement
   */
  function handleCancelPlacement() {
    const statusEl = document.getElementById('placementStatus');
    const modeEl = document.getElementById('placementMode');
    const btn = document.getElementById('enableRoomPlacement');
    
    if (statusEl) {
      statusEl.textContent = 'Ready';
      statusEl.className = 'status-indicator ready';
    }
    
    if (modeEl) {
      modeEl.textContent = 'Click to Place';
    }
    
    if (btn) {
      btn.textContent = 'Place Room';
      btn.disabled = false;
    }
    
    // Disable room placement mode
    disableRoomPlacementMode();
  }
  
  /**
   * Handle clear all rooms
   */
  function handleClearAllRooms() {
    if (!roomSystem) return;
    
    if (confirm('Are you sure you want to clear all rooms? This action cannot be undone.')) {
      const allRooms = roomSystem.getAllRooms();
      
      allRooms.forEach(room => {
        roomSystem.deleteRoom(room.id);
      });
      
      updateRoomList();
      updateRoomStats();
      
      console.log(`Cleared ${allRooms.length} rooms`);
    }
  }
  
  /**
   * Handle promote detected room
   */
  function handlePromoteDetected() {
    // Get selected room from list or current selection
    const selectedRoom = getCurrentSelectedRoom();
    
    if (!selectedRoom || selectedRoom.type !== roomSystem.ROOM_TYPES.DETECTED) {
      alert('Please select a detected room to promote');
      return;
    }
    
    showPromotionDialog(selectedRoom);
  }
  
  /**
   * Handle toggle boundary visuals
   */
  function handleToggleVisuals() {
    isDetectionVisualsVisible = !isDetectionVisualsVisible;
    
    if (roomBoundaryDetection && roomBoundaryDetection.createRoomVisuals) {
      if (isDetectionVisualsVisible) {
        roomBoundaryDetection.createRoomVisuals();
      } else {
        // Remove visuals
        if (window.scene) {
          window.scene.traverse(obj => {
            if (obj.userData && obj.userData.type === 'room_boundary_visual') {
              window.scene.remove(obj);
            }
          });
        }
      }
    }
    
    const btn = document.getElementById('toggleDetectionVisuals');
    if (btn) {
      btn.title = isDetectionVisualsVisible ? 'Hide boundary visuals' : 'Show boundary visuals';
      btn.classList.toggle('active', isDetectionVisualsVisible);
    }
  }
  
  /**
   * Handle room type filtering
   */
  function handleRoomTypeFilter() {
    updateRoomList();
  }
  
  /**
   * Show promotion dialog for detected room
   */
  function showPromotionDialog(room) {
    const dialog = `
      <div id="roomPromotionDialog" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Promote Detected Room</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <p>Promote "${room.name}" to a managed room with custom properties:</p>
            
            <div class="form-group">
              <label>Room Name:</label>
              <input type="text" id="promoteName" value="${room.name}">
            </div>
            
            <div class="form-group">
              <label>Room Number:</label>
              <input type="text" id="promoteNumber" value="">
            </div>
            
            <div class="form-group">
              <label>Department:</label>
              <input type="text" id="promoteDepartment" value="${room.department}">
            </div>
            
            <div class="form-group">
              <label>Function:</label>
              <input type="text" id="promoteFunction" value="">
            </div>
            
            <div class="form-group">
              <label>Notes:</label>
              <textarea id="promoteNotes"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closePromotionDialog()">Cancel</button>
            <button class="btn btn-primary" onclick="executePromotion('${room.id}')">Promote Room</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dialog);
  }
  
  /**
   * Execute room promotion
   */
  window.executePromotion = function(roomId) {
    const name = document.getElementById('promoteName')?.value;
    const number = document.getElementById('promoteNumber')?.value;
    const department = document.getElementById('promoteDepartment')?.value;
    const func = document.getElementById('promoteFunction')?.value;
    const notes = document.getElementById('promoteNotes')?.value;
    
    const manualMetadata = {
      name,
      number,
      department,
      metadata: {
        function: func,
        notes
      }
    };
    
    try {
      roomManager.promoteDetectedRoom(roomId, manualMetadata);
      updateRoomList();
      updateRoomStats();
      closePromotionDialog();
      
      console.log(`Promoted room: ${name}`);
    } catch (error) {
      console.error('Error promoting room:', error);
      alert('Error promoting room: ' + error.message);
    }
  };
  
  /**
   * Close promotion dialog
   */
  window.closePromotionDialog = function() {
    const dialog = document.getElementById('roomPromotionDialog');
    if (dialog) {
      dialog.remove();
    }
  };
  
  /**
   * Update room statistics display
   */
  function updateRoomStats() {
    if (!roomSystem || !roomSystem.getRoomStatistics) return;
    
    const stats = roomSystem.getRoomStatistics();
    
    // Update counts
    const elements = {
      totalRoomsCount: stats.total,
      placedRoomsCount: stats.byType.manual, // Manual rooms are now "placed" rooms
      manualRoomsCount: stats.byType.manual,
      hybridRoomsCount: stats.byType.hybrid,
      totalSquareFootage: Math.round(stats.totalSquareFootage),
      averageConfidence: Math.round(stats.averageConfidence * 100) + '%'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }
  
  /**
   * Update room list with type indicators
   */
  function updateRoomList() {
    const container = document.getElementById('roomListContainer');
    if (!container || !roomSystem) return;
    
    const rooms = roomSystem.getAllRooms();
    const searchTerm = document.getElementById('roomSearchInput')?.value.toLowerCase() || '';
    const departmentFilter = document.getElementById('departmentFilter')?.value || '';
    const typeFilter = document.getElementById('roomTypeFilter')?.value || '';
    
    // Filter rooms
    const filteredRooms = rooms.filter(room => {
      const matchesSearch = !searchTerm || 
        room.name.toLowerCase().includes(searchTerm) ||
        room.department.toLowerCase().includes(searchTerm);
      
      const matchesDepartment = !departmentFilter || room.department === departmentFilter;
      const matchesType = !typeFilter || room.type === typeFilter;
      
      return matchesSearch && matchesDepartment && matchesType;
    });
    
    if (filteredRooms.length === 0) {
      container.innerHTML = '<div class="room-list-empty"><p>No rooms match the current filters.</p></div>';
      return;
    }
    
    // Generate room list HTML
    const roomListHTML = filteredRooms.map(room => {
      const typeClass = `type-${room.type}`;
      const confidenceDisplay = room.metadata.confidence < 1 ? 
        `<span class="room-confidence">${Math.round(room.metadata.confidence * 100)}%</span>` : '';
      
      return `
        <div class="room-item enhanced ${typeClass}" data-room-id="${room.id}">
          <div class="room-header">
            <span class="room-name">${room.name}</span>
            <span class="room-type-badge ${room.type}">${room.type}</span>
            ${confidenceDisplay}
          </div>
          <div class="room-details">
            <span class="room-department">${room.department}</span>
            <span class="room-area">${Math.round(room.squareFootage)} sq ft</span>
          </div>
          <div class="room-actions">
            <button class="btn btn-xs btn-outline" onclick="selectRoom('${room.id}')">Select</button>
            <button class="btn btn-xs btn-outline" onclick="editRoom('${room.id}')">Edit</button>
            ${room.type === 'detected' ? 
              `<button class="btn btn-xs btn-primary" onclick="promoteRoom('${room.id}')">Promote</button>` : 
              ''}
          </div>
        </div>
      `;
    }).join('');
    
    container.innerHTML = roomListHTML;
  }
  
  /**
   * Setup original listeners (preserve backward compatibility)
   */
  function setupOriginalListeners() {
    // Room manager panel close button
    const closeBtn = document.querySelector('#roomManagerPanel .room-manager-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', toggleRoomManagerPanel);
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshRoomData');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        updateRoomList();
        updateRoomStats();
      });
    }
    
    // Designate selected room button
    const designateBtn = document.getElementById('designateSelectedRoom');
    if (designateBtn) {
      designateBtn.addEventListener('click', () => {
        if (selectedObjects && selectedObjects.length > 0) {
          showRoomDesignationModal(selectedObjects[0]);
        } else {
          alert('Please select a 3D object first');
        }
      });
    }
    
    // Show all rooms button
    const showAllBtn = document.getElementById('showAllRooms');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        // Clear filters and show all rooms
        const searchInput = document.getElementById('roomSearchInput');
        const departmentFilter = document.getElementById('departmentFilter');
        const typeFilter = document.getElementById('roomTypeFilter');
        
        if (searchInput) searchInput.value = '';
        if (departmentFilter) departmentFilter.value = '';
        if (typeFilter) typeFilter.value = '';
        
        updateRoomList();
      });
    }
    
    // Validate rooms button
    const validateBtn = document.getElementById('validateRooms');
    if (validateBtn) {
      validateBtn.addEventListener('click', () => {
        // Basic room validation
        const rooms = roomSystem.getAllRooms();
        let issues = 0;
        
        rooms.forEach(room => {
          if (!room.name || room.name.trim() === '') issues++;
          if (!room.department || room.department === 'Unassigned') issues++;
          if (room.squareFootage < 10) issues++;
        });
        
        alert(`Room validation complete. Found ${issues} potential issues.`);
      });
    }
    
    // Search and filter listeners
    const searchInput = document.getElementById('roomSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        setTimeout(() => updateRoomList(), 300); // Debounced search
      });
    }
    
    const departmentFilter = document.getElementById('departmentFilter');
    if (departmentFilter) {
      departmentFilter.addEventListener('change', updateRoomList);
    }
  }
  
  /**
   * Room event handlers
   */
  function handleRoomAdded(event) {
    updateRoomList();
    updateRoomStats();
    console.log(`Room added: ${event.room.name} (${event.type})`);
  }
  
  function handleRoomModified(event) {
    updateRoomList();
    updateRoomStats();
    console.log(`Room modified: ${event.room.name} (${event.type})`);
  }
  
  function handleRoomDeleted(event) {
    updateRoomList();
    updateRoomStats();
    console.log(`Room deleted: ${event.room.name} (${event.type})`);
  }
  
  /**
   * Get currently selected room
   */
  function getCurrentSelectedRoom() {
    // Implementation to get selected room from UI
    return currentRoom;
  }
  
  /**
   * Make room manager panel draggable (preserve original functionality)
   */
  function makeRoomManagerDraggable() {
    // Implementation of draggable functionality
    console.log('Room manager panel made draggable');
  }
  
  /**
   * Toggle room manager panel
   */
  function toggleRoomManagerPanel() {
    const panel = document.getElementById('roomManagerPanel');
    if (!panel) return;
    
    isRoomManagerOpen = !isRoomManagerOpen;
    panel.style.display = isRoomManagerOpen ? 'block' : 'none';
    
    if (isRoomManagerOpen) {
      updateRoomList();
      updateRoomStats();
    }
  }
  
  // Add global functions for HTML onclick handlers
  window.selectRoom = function(roomId) {
    const room = roomSystem.getRoomById(roomId);
    if (room) {
      currentRoom = room;
      console.log(`Selected room: ${room.name}`);
    }
  };
  
  window.editRoom = function(roomId) {
    const room = roomSystem.getRoomById(roomId);
    if (room) {
      // Show edit interface - could be enhanced in the future
      console.log(`Edit room: ${room.name}`);
      alert(`Edit functionality for "${room.name}" - feature coming soon!`);
    }
  };
  
  window.promoteRoom = function(roomId) {
    const room = roomSystem.getRoomById(roomId);
    if (room && room.type === roomSystem.ROOM_TYPES.DETECTED) {
      showPromotionDialog(room);
    }
  };

  // Room placement mode variables
  let placementModeActive = false;
  let placementClickHandler = null;

  /**
   * Enable room placement mode - adds click listener to canvas
   */
  function enableRoomPlacementMode() {
    if (placementModeActive) {
      console.log('Placement mode already active');
      return;
    }
    
    placementModeActive = true;
    
    // Add click listener to canvas for room placement
    placementClickHandler = (event) => {
      console.log('placementClickHandler triggered');
      handleCanvasClick(event);
    };
    
    // Add listener to the 3D canvas with capture=true to intercept before other handlers
    console.log('Checking for canvas...');
    console.log('window.app:', window.app);
    console.log('window.app.renderer:', window.app ? window.app.renderer : 'no app');
    console.log('window.app.renderer.domElement:', window.app && window.app.renderer ? window.app.renderer.domElement : 'no renderer');
    console.log('window.scene:', window.scene);
    console.log('window.controls:', window.controls);
    console.log('window.renderer:', window.renderer);
    
    // List all window properties that might contain what we need
    const windowProps = Object.keys(window).filter(key => 
      key.toLowerCase().includes('camera') || 
      key.toLowerCase().includes('controls') || 
      key.toLowerCase().includes('three')
    );
    console.log('Window properties containing camera/controls/three:', windowProps);
    
    if (window.app && window.app.renderer && window.app.renderer.domElement) {
      const canvas = window.app.renderer.domElement;
      console.log('Adding click listener to canvas:', canvas);
      
      // Try using pointerdown instead of click to avoid conflicts
      canvas.addEventListener('pointerdown', placementClickHandler, true);
      canvas.style.cursor = 'crosshair';
      console.log('Pointer listener added successfully');
    } else {
      console.error('Canvas not found - cannot add click listener');
      
      // Try alternative ways to find the canvas
      const canvases = document.getElementsByTagName('canvas');
      console.log('All canvas elements found:', canvases);
      
      if (canvases.length > 0) {
        const canvas = canvases[0]; // Use the first canvas
        console.log('Using fallback canvas:', canvas);
        canvas.addEventListener('pointerdown', placementClickHandler, true);
        canvas.style.cursor = 'crosshair';
        console.log('Fallback pointer listener added successfully');
      }
    }
    
    console.log('Room placement mode enabled - click to place rooms');
  }

  /**
   * Disable room placement mode - removes click listener
   */
  function disableRoomPlacementMode() {
    if (!placementModeActive) return;
    
    placementModeActive = false;
    
    // Remove listener (with capture=true to match addEventListener)
    if (placementClickHandler) {
      if (window.app && window.app.renderer && window.app.renderer.domElement) {
        window.app.renderer.domElement.removeEventListener('pointerdown', placementClickHandler, true);
        window.app.renderer.domElement.style.cursor = 'default';
      } else {
        // Try fallback canvas removal
        const canvases = document.getElementsByTagName('canvas');
        if (canvases.length > 0) {
          const canvas = canvases[0];
          canvas.removeEventListener('pointerdown', placementClickHandler, true);
          canvas.style.cursor = 'default';
        }
      }
    }
    
    placementClickHandler = null;
    
    console.log('Room placement mode disabled');
  }

  /**
   * Handle canvas click for room placement
   */
  async function handleCanvasClick(event) {
    console.log('handleCanvasClick called, placementModeActive:', placementModeActive);
    
    if (!placementModeActive) {
      console.log('Placement mode not active, ignoring click');
      return;
    }
    
    // Prevent the event from bubbling up to other handlers (like object selection)
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    
    console.log('Getting world position from click...');
    
    // Get click position in 3D world coordinates
    const worldPosition = await getWorldPositionFromClick(event);
    
    if (worldPosition) {
      console.log('Creating room at position:', worldPosition);
      // Create room at clicked position
      createRoomAtPosition(worldPosition);
      
      // Reset placement mode
      handleCancelPlacement();
    } else {
      console.error('Failed to get world position from click');
    }
  }

  /**
   * Convert canvas click to 3D world position
   */
  async function getWorldPositionFromClick(event) {
    console.log('getWorldPositionFromClick called', event);
    
    // Try to import THREE.js properly since window.__THREE__ is just a version number
    let THREE;
    try {
      // Fix the import path - go up two levels to reach js/vendor
      const threeModule = await import('../../vendor/three.module.js');
      THREE = threeModule;
      console.log('THREE.js imported successfully');
      console.log('THREE.PerspectiveCamera:', THREE.PerspectiveCamera);
      console.log('THREE.Vector3:', THREE.Vector3);
      console.log('THREE.Box3:', THREE.Box3);
      
      // Make THREE available globally for other functions
      window.THREE = THREE;
      
    } catch (error) {
      console.error('Failed to import THREE.js:', error);
      return null;
    }
    
    // We have the renderer globally, but need to find the camera
    const renderer = window.renderer;
    if (!renderer) {
      console.error('Renderer not available');
      return null;
    }
    
    // Try to find the camera
    const scene = window.scene;
    let camera = null;
    
    // Look for camera in various places
    console.log('Looking for camera...');
    
    // Check if camera is in window object with different names
    const cameraProps = Object.keys(window).filter(key => 
      key.toLowerCase().includes('camera') || 
      (window[key] && window[key].isPerspectiveCamera) ||
      (window[key] && window[key].isOrthographicCamera)
    );
    console.log('Potential camera properties:', cameraProps);
    
    // Try common camera property names
    camera = window.camera || window.perspectiveCamera || window.mainCamera;
    
    // If still no camera, try to find it in scene children
    if (!camera && scene) {
      console.log('Searching scene for camera...');
      scene.traverse((child) => {
        if (child.isPerspectiveCamera || child.isOrthographicCamera) {
          camera = child;
          console.log('Found camera in scene:', camera);
        }
      });
    }
    
    // Last resort: try to access camera from controls if available
    if (!camera && window.controls && window.controls.object) {
      camera = window.controls.object;
      console.log('Found camera from controls:', camera);
    }
    
    if (!camera) {
      console.error('Camera not found anywhere');
      
      // Try to get camera from renderer's current render call
      // Often the camera is passed to renderer.render(scene, camera)
      // Let's try a different approach - just use a simple ground click without camera
      console.log('Using simplified ground click approach...');
      
      // Get canvas element and calculate simple world position
      const canvas = renderer.domElement || event.target;
      const rect = canvas.getBoundingClientRect();
      
      // Convert click to world coordinates assuming a simple orthographic projection
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 20; // 20 unit wide view
      const z = ((event.clientY - rect.top) / rect.height - 0.5) * 20; // 20 unit deep view
      const y = 0; // Ground level
      
      console.log('Simplified world position:', { x, y, z });
      
      if (THREE.Vector3) {
        return new THREE.Vector3(x, y, z);
      } else {
        // Return a plain object if THREE.Vector3 isn't available
        return { x, y, z };
      }
    }
    
    // Get canvas element
    const canvas = renderer.domElement || event.target;
    if (!canvas) {
      console.error('Canvas not available');
      return null;
    }
    
    const rect = canvas.getBoundingClientRect();
    
    // Get normalized device coordinates
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    console.log('Mouse coordinates:', mouse.x, mouse.y);
    
    // Cast ray from camera
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    // Find intersection with floor (y = 0)
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    const intersectionFound = raycaster.ray.intersectPlane(floorPlane, intersection);
    
    console.log('Floor intersection:', intersectionFound ? intersection : 'none');
    
    return intersectionFound ? intersection : null;
  }

  /**
   * Create a room at the specified position by detecting boundaries
   */
  function createRoomAtPosition(position) {
    if (!roomSystem) {
      console.error('Room system not available');
      return;
    }
    
    // Detect the bounded space around the clicked position
    const boundedSpace = detectBoundedSpaceAtPosition(position);
    
    if (!boundedSpace || !boundedSpace.polygon || boundedSpace.polygon.length < 3) {
      console.warn('No bounded space found at clicked position');
      // Fallback to small default room if no boundaries detected
      const fallbackSize = 6; // feet
      const halfSize = fallbackSize / 2;
      
      boundedSpace.polygon = [
        { x: position.x - halfSize, z: position.z - halfSize },
        { x: position.x + halfSize, z: position.z - halfSize },
        { x: position.x + halfSize, z: position.z + halfSize },
        { x: position.x - halfSize, z: position.z + halfSize }
      ];
      boundedSpace.area = fallbackSize * fallbackSize;
      boundedSpace.boundaryObjects = [];
    }
    
    // Create room using the detected bounded space
    const roomData = {
      type: roomSystem.ROOM_TYPES.MANUAL,
      polygon: boundedSpace.polygon,
      name: `Room ${roomSystem.getAllRooms().length + 1}`,
      area: boundedSpace.area,
      position: position,
      boundaryObjects: boundedSpace.boundaryObjects || [],
      metadata: {
        detectedBoundaries: true,
        boundaryCount: boundedSpace.boundaryObjects ? boundedSpace.boundaryObjects.length : 0,
        clickPosition: { x: position.x, y: position.y, z: position.z }
      }
    };
    
    const newRoom = roomSystem.createRoom(roomData);
    
    if (newRoom) {
      console.log(`✅ Created adaptive room at (${position.x.toFixed(1)}, ${position.z.toFixed(1)}) - Area: ${boundedSpace.area.toFixed(1)} sq ft, Boundaries: ${boundedSpace.boundaryObjects.length}`);
      
      // Update UI
      updateRoomList();
      updateRoomStats();
      
      // Show success feedback with room details
      const statusEl = document.getElementById('placementStatus');
      if (statusEl) {
        statusEl.textContent = `Room Placed! ${boundedSpace.area.toFixed(1)} sq ft`;
        statusEl.className = 'status-indicator success';
        
        setTimeout(() => {
          statusEl.textContent = 'Ready';
          statusEl.className = 'status-indicator ready';
        }, 3000);
      }
    } else {
      console.error('Failed to create room');
    }
  }

  /**
   * Detect bounded space around a clicked position
   */
  function detectBoundedSpaceAtPosition(centerPosition) {
    if (!window.scene) {
      console.warn('Scene not available for boundary detection');
      return null;
    }

    console.log(`🔍 Detecting boundaries around position (${centerPosition.x.toFixed(1)}, ${centerPosition.z.toFixed(1)})`);

    // Get all potential boundary objects in the scene
    const boundaryObjects = getAllBoundaryObjects();
    
    if (boundaryObjects.length === 0) {
      console.warn('No boundary objects found in scene');
      return null;
    }

    // Find objects near the clicked position
    const searchRadius = 20; // feet - maximum room size
    const nearbyObjects = findObjectsNearPosition(centerPosition, boundaryObjects, searchRadius);
    
    if (nearbyObjects.length < 3) {
      console.warn(`Only ${nearbyObjects.length} boundary objects found nearby`);
      return null;
    }

    // Try to trace a bounded space using the nearby objects
    const boundedSpace = traceBoundedSpace(centerPosition, nearbyObjects);
    
    return boundedSpace;
  }

  /**
   * Get all objects that could serve as room boundaries
   */
  function getAllBoundaryObjects() {
    const boundaryObjects = [];
    
    if (!window.scene) return boundaryObjects;
    
    window.scene.traverse((object) => {
      // Skip helper objects, lights, cameras, etc.
      if (!object.isMesh || 
          object.userData.__helper || 
          object.userData.type === 'room_boundary_visual' ||
          object.name.includes('Helper') ||
          object.name.includes('Light') ||
          object.name.includes('Camera')) {
        return;
      }
      
      // Check if object is large enough to be a boundary
      const bbox = new window.THREE.Box3().setFromObject(object);
      const size = bbox.getSize(new window.THREE.Vector3());
      
      // Must be at least 2 feet in at least two dimensions
      const minSize = 2;
      const validDimensions = [size.x, size.y, size.z].filter(dim => dim >= minSize);
      
      if (validDimensions.length >= 2) {
        boundaryObjects.push(object);
      }
    });
    
    console.log(`Found ${boundaryObjects.length} potential boundary objects`);
    return boundaryObjects;
  }

  /**
   * Find objects near a position within search radius
   */
  function findObjectsNearPosition(position, objects, radius) {
    const nearbyObjects = [];
    
    objects.forEach(obj => {
      const bbox = new window.THREE.Box3().setFromObject(obj);
      const center = bbox.getCenter(new window.THREE.Vector3());
      const distance = center.distanceTo(position);
      
      if (distance <= radius) {
        nearbyObjects.push({
          object: obj,
          distance: distance,
          center: center,
          bbox: bbox
        });
      }
    });
    
    // Sort by distance
    nearbyObjects.sort((a, b) => a.distance - b.distance);
    
    console.log(`Found ${nearbyObjects.length} objects within ${radius} feet`);
    return nearbyObjects;
  }

  /**
   * Trace a bounded space from nearby objects
   */
  function traceBoundedSpace(centerPosition, nearbyObjects) {
    // Use a simple rectangular bounding approach
    // Find the closest objects in each cardinal direction
    
    const directions = {
      north: { objects: [], minDistance: Infinity },
      south: { objects: [], minDistance: Infinity },
      east: { objects: [], minDistance: Infinity },
      west: { objects: [], minDistance: Infinity }
    };
    
    // Categorize objects by direction from center
    nearbyObjects.forEach(({ object, center, bbox, distance }) => {
      const dx = center.x - centerPosition.x;
      const dz = center.z - centerPosition.z;
      
      // Determine primary direction
      if (Math.abs(dx) > Math.abs(dz)) {
        // East/West
        if (dx > 0) {
          if (distance < directions.east.minDistance) {
            directions.east.objects = [{ object, center, bbox, distance }];
            directions.east.minDistance = distance;
          }
        } else {
          if (distance < directions.west.minDistance) {
            directions.west.objects = [{ object, center, bbox, distance }];
            directions.west.minDistance = distance;
          }
        }
      } else {
        // North/South
        if (dz > 0) {
          if (distance < directions.north.minDistance) {
            directions.north.objects = [{ object, center, bbox, distance }];
            directions.north.minDistance = distance;
          }
        } else {
          if (distance < directions.south.minDistance) {
            directions.south.objects = [{ object, center, bbox, distance }];
            directions.south.minDistance = distance;
          }
        }
      }
    });
    
    // Calculate boundaries based on closest objects in each direction
    const boundaries = calculateRoomBoundaries(centerPosition, directions);
    
    if (!boundaries) {
      console.warn('Could not determine room boundaries');
      return null;
    }
    
    // Create polygon from boundaries
    const polygon = [
      { x: boundaries.west, z: boundaries.south },   // SW corner
      { x: boundaries.east, z: boundaries.south },   // SE corner  
      { x: boundaries.east, z: boundaries.north },   // NE corner
      { x: boundaries.west, z: boundaries.north }    // NW corner
    ];
    
    // Calculate area
    const width = boundaries.east - boundaries.west;
    const depth = boundaries.north - boundaries.south;
    const area = width * depth;
    
    // Collect all boundary objects
    const boundaryObjects = [];
    Object.values(directions).forEach(dir => {
      dir.objects.forEach(({ object }) => {
        if (!boundaryObjects.includes(object)) {
          boundaryObjects.push(object);
        }
      });
    });
    
    console.log(`📐 Traced room: ${width.toFixed(1)}' × ${depth.toFixed(1)}' = ${area.toFixed(1)} sq ft`);
    
    return {
      polygon: polygon,
      area: area,
      boundaryObjects: boundaryObjects,
      dimensions: { width, depth },
      boundaries: boundaries
    };
  }

  /**
   * Calculate room boundaries from directional objects
   */
  function calculateRoomBoundaries(centerPosition, directions) {
    const maxRoomSize = 25; // Maximum room dimension in feet
    const minRoomSize = 6;  // Minimum room dimension in feet
    const defaultMargin = 1; // Margin from boundary objects
    
    let north = centerPosition.z + maxRoomSize / 2;
    let south = centerPosition.z - maxRoomSize / 2;
    let east = centerPosition.x + maxRoomSize / 2;
    let west = centerPosition.x - maxRoomSize / 2;
    
    // Adjust boundaries based on nearby objects
    if (directions.north.objects.length > 0) {
      const obj = directions.north.objects[0];
      north = Math.min(north, obj.bbox.min.z - defaultMargin);
    }
    
    if (directions.south.objects.length > 0) {
      const obj = directions.south.objects[0];
      south = Math.max(south, obj.bbox.max.z + defaultMargin);
    }
    
    if (directions.east.objects.length > 0) {
      const obj = directions.east.objects[0];
      east = Math.min(east, obj.bbox.min.x - defaultMargin);
    }
    
    if (directions.west.objects.length > 0) {
      const obj = directions.west.objects[0];
      west = Math.max(west, obj.bbox.max.x + defaultMargin);
    }
    
    // Ensure minimum size
    const width = east - west;
    const depth = north - south;
    
    if (width < minRoomSize) {
      const center_x = (east + west) / 2;
      east = center_x + minRoomSize / 2;
      west = center_x - minRoomSize / 2;
    }
    
    if (depth < minRoomSize) {
      const center_z = (north + south) / 2;
      north = center_z + minRoomSize / 2;
      south = center_z - minRoomSize / 2;
    }
    
    return { north, south, east, west };
  }
  
  // Public API (enhanced)
  return {
    // Original API
    initialize,
    toggleRoomManagerPanel,
    showRoomDesignationModal,
    hideRoomDesignationModal,
    
    // Enhanced API
    updateRoomStats,
    updateRoomList,
    handleEnableRoomPlacement,
    handleCancelPlacement,
    handleClearAllRooms,
    handleToggleVisuals,
    enableRoomPlacementMode,
    disableRoomPlacementMode
  };
}