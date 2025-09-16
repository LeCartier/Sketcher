// Room Designation UI: Interface for designating objects as rooms and managing room properties
// Provides movable room manager panel and modal dialogs for room management

export function createRoomDesignationUI({ roomSystem, roomManager }) {
  
  let isInitialized = false;
  let currentRoom = null;
  let selectedObject = null;
  let isRoomManagerOpen = false;
  
  /**
   * Initialize the room designation UI
   */
  function initialize() {
    if (isInitialized) return;
    
    createRoomManagerPanel();
    createRoomDesignationModal();
    createRoomPropertiesPanel();
    setupKeyboardShortcuts();
    
    isInitialized = true;
    console.log('Room Designation UI initialized');
  }
  
  /**
   * Create the main movable room manager panel
   */
  function createRoomManagerPanel() {
    console.log('Creating room manager panel...');
    
    const panelHTML = `
      <div id="roomManagerPanel" class="room-manager-panel" style="display: none;">
        <div class="room-manager-header">
          <h3>Room Manager</h3>
          <div class="room-manager-actions">
            <button class="btn btn-sm btn-outline" id="refreshRoomData" title="Refresh room data">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="room-manager-close" aria-label="Close">&times;</button>
          </div>
        </div>
        
        <div class="room-manager-body">
          <div class="room-manager-content">
            
            <!-- Room Overview Section -->
            <div class="room-overview-section">
              <h4>Room Overview</h4>
              <div class="room-stats-grid">
                <div class="stat-card">
                  <div class="stat-value" id="totalRoomsCount">0</div>
                  <div class="stat-label">Total Rooms</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="totalSquareFootage">0</div>
                  <div class="stat-label">Total Sq Ft</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="departmentCount">0</div>
                  <div class="stat-label">Departments</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="roomIssuesCount">0</div>
                  <div class="stat-label">Issues</div>
                </div>
              </div>
            </div>
            
            <!-- Quick Actions Section -->
            <div class="quick-actions-section">
              <h4>Quick Actions</h4>
              <div class="action-buttons">
                <button class="btn btn-primary btn-sm" id="designateSelectedRoom">
                  Designate Selected as Room
                </button>
                <button class="btn btn-secondary btn-sm" id="showAllRooms">
                  Show All Rooms
                </button>
                <button class="btn btn-secondary btn-sm" id="validateRooms">
                  Validate & Fix Rooms
                </button>
              </div>
            </div>
            
            <!-- Room List Section -->
            <div class="room-list-section">
              <div class="room-list-header">
                <h4>Rooms</h4>
                <div class="room-list-controls">
                  <input type="text" id="roomSearchInput" class="form-control form-control-sm" placeholder="Search rooms...">
                  <select id="departmentFilter" class="form-control form-control-sm">
                    <option value="">All Departments</option>
                  </select>
                </div>
              </div>
              
              <div class="room-list-container" id="roomListContainer">
                <div class="room-list-empty">
                  <p>No rooms found. Select a 3D object and click "Designate Selected as Room" to get started.</p>
                </div>
              </div>
            </div>
            
            <!-- Department Summary Section -->
            <div class="department-summary-section" style="display: none;">
              <h4>Department Summary</h4>
              <div id="departmentSummaryContainer"></div>
            </div>
            
          </div>
        </div>
        
        <div class="room-manager-resizer"></div>
      </div>
    `;
    
    console.log('Appending panel HTML to body...');
    document.body.insertAdjacentHTML('beforeend', panelHTML);
    
    const panel = document.getElementById('roomManagerPanel');
    console.log('Panel found after creation:', !!panel);
    
    if (!panel) {
      console.error('Failed to find room manager panel after creation!');
      return;
    }
    if (!panel) {
      console.error('Failed to find room manager panel after creation!');
      return;
    }
    
    const header = panel.querySelector('.room-manager-header');
    const resizer = panel.querySelector('.room-manager-resizer');
    const body = panel.querySelector('.room-manager-body');
    
    console.log('Panel components found:', { header: !!header, resizer: !!resizer, body: !!body });
    
    // Make panel draggable
    try {
      makePanelDraggable(panel, header);
      console.log('Panel made draggable');
    } catch (error) {
      console.error('Error making panel draggable:', error);
    }
    
    // Make panel resizable  
    try {
      makePanelResizable(panel, resizer, body);
      console.log('Panel made resizable');
    } catch (error) {
      console.error('Error making panel resizable:', error);
    }
    
    // Add event listeners
    try {
      document.getElementById('roomManagerPanel').querySelector('.room-manager-close').addEventListener('click', hideRoomManagerPanel);
      document.getElementById('refreshRoomData').addEventListener('click', refreshRoomManagerData);
      document.getElementById('designateSelectedRoom').addEventListener('click', handleDesignateSelected);
      document.getElementById('showAllRooms').addEventListener('click', handleShowAllRooms);
      document.getElementById('validateRooms').addEventListener('click', handleValidateRooms);
      document.getElementById('roomSearchInput').addEventListener('input', handleRoomSearch);
      document.getElementById('departmentFilter').addEventListener('change', handleDepartmentFilter);
      console.log('Event listeners added successfully');
    } catch (error) {
      console.error('Error adding event listeners:', error);
    }
    
    // Initial positioning
    try {
      positionRoomManagerPanel();
      console.log('Panel positioned successfully');
    } catch (error) {
      console.error('Error positioning panel:', error);
    }
    
    console.log('Room manager panel creation completed');
  }
  
  /**
   * Make panel draggable
   */
  function makePanelDraggable(panel, header) {
    let drag = null;
    
    header.addEventListener('pointerdown', (e) => {
      // Don't start dragging if clicked on interactive elements
      const isInteractive = !!(e.target && e.target.closest('button, input, select, textarea, a, [role="button"]'));
      if (isInteractive) return;
      
      const rect = panel.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      
      try { 
        header.setPointerCapture(e.pointerId); 
        header.style.cursor = 'grabbing';
      } catch {}
    });
    
    header.addEventListener('pointermove', (e) => {
      if (!drag) return;
      
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, e.clientX - drag.dx));
      const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, e.clientY - drag.dy));
      
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    });
    
    header.addEventListener('pointerup', () => {
      drag = null;
      header.style.cursor = '';
    });
  }
  
  /**
   * Make panel resizable
   */
  function makePanelResizable(panel, resizer, body) {
    let resize = null;
    
    resizer.addEventListener('pointerdown', (e) => {
      const rect = panel.getBoundingClientRect();
      resize = { 
        startX: e.clientX, 
        startY: e.clientY, 
        w: rect.width, 
        h: rect.height 
      };
      resizer.setPointerCapture(e.pointerId);
    });
    
    resizer.addEventListener('pointermove', (e) => {
      if (!resize) return;
      
      const w = Math.min(Math.max(320, resize.w + (e.clientX - resize.startX)), Math.round(window.innerWidth * 0.9));
      const h = Math.min(Math.max(240, resize.h + (e.clientY - resize.startY)), Math.round(window.innerHeight * 0.9));
      
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      
      // Adjust body height for scrolling
      try {
        const headerH = panel.querySelector('.room-manager-header')?.offsetHeight || 0;
        const resizerH = 16;
        const pad = 12;
        const availableHeight = h - headerH - resizerH - pad;
        
        if (body && availableHeight > 120) {
          body.style.maxHeight = availableHeight + 'px';
        }
      } catch {}
    });
    
    resizer.addEventListener('pointerup', () => {
      resize = null;
    });
  }
  
  /**
   * Position room manager panel initially
   */
  function positionRoomManagerPanel() {
    const panel = document.getElementById('roomManagerPanel');
    if (!panel) return;
    
    // Position to the right side of the screen
    const width = 400;
    const height = 600;
    
    panel.style.width = width + 'px';
    panel.style.height = height + 'px';
    panel.style.left = (window.innerWidth - width - 20) + 'px';
    panel.style.top = '80px';
  }
  
  /**
   * Show room manager panel
   */
  function showRoomManagerPanel() {
    console.log('showRoomManagerPanel called');
    const panel = document.getElementById('roomManagerPanel');
    console.log('Panel element found:', !!panel);
    
    if (!panel) {
      console.error('Room manager panel not found! Creating it now...');
      createRoomManagerPanel();
      return;
    }
    
    if (panel.style.display === 'none' || panel.style.display === '') {
      panel.style.display = 'block';
      isRoomManagerOpen = true;
      
      // Refresh data when opened
      refreshRoomManagerData();
      
      // Position if needed
      requestAnimationFrame(() => {
        if (panel.offsetLeft + panel.offsetWidth > window.innerWidth) {
          positionRoomManagerPanel();
        }
      });
      
      console.log('Room Manager panel opened');
    }
  }
  
  /**
   * Hide room manager panel
   */
  function hideRoomManagerPanel() {
    const panel = document.getElementById('roomManagerPanel');
    if (panel) {
      panel.style.display = 'none';
      isRoomManagerOpen = false;
      console.log('Room Manager panel closed');
    }
  }
  
  /**
   * Toggle room manager panel
   */
  function toggleRoomManagerPanel() {
    console.log('toggleRoomManagerPanel called, isRoomManagerOpen:', isRoomManagerOpen);
    if (isRoomManagerOpen) {
      hideRoomManagerPanel();
    } else {
      showRoomManagerPanel();
    }
  }  /**
   * Refresh room manager data and update displays
   */
  function refreshRoomManagerData() {
    try {
      const stats = roomSystem.getRoomStatistics();
      const issues = roomManager.getRoomIssues();
      
      // Update overview stats
      document.getElementById('totalRoomsCount').textContent = stats.totalRooms;
      document.getElementById('totalSquareFootage').textContent = Math.round(stats.totalSquareFootage).toLocaleString();
      document.getElementById('departmentCount').textContent = stats.departments;
      document.getElementById('roomIssuesCount').textContent = issues.length;
      
      // Update room list
      updateRoomList();
      
      // Update department filter
      updateDepartmentFilter();
      
      // Update department summary
      updateDepartmentSummary(stats);
      
    } catch (error) {
      console.error('Error refreshing room manager data:', error);
    }
  }
  
  /**
   * Update the room list display
   */
  function updateRoomList() {
    const container = document.getElementById('roomListContainer');
    const searchTerm = document.getElementById('roomSearchInput').value.toLowerCase();
    const departmentFilter = document.getElementById('departmentFilter').value;
    
    let rooms = roomSystem.getAllRooms();
    
    // Apply filters
    if (searchTerm) {
      rooms = rooms.filter(room => 
        room.name.toLowerCase().includes(searchTerm) ||
        room.number.toLowerCase().includes(searchTerm) ||
        room.department.toLowerCase().includes(searchTerm)
      );
    }
    
    if (departmentFilter) {
      rooms = rooms.filter(room => room.department === departmentFilter);
    }
    
    if (rooms.length === 0) {
      container.innerHTML = '<div class="room-list-empty"><p>No rooms match the current filters.</p></div>';
      return;
    }
    
    // Sort rooms by name
    rooms.sort((a, b) => a.name.localeCompare(b.name));
    
    // Generate room list HTML
    const roomListHTML = rooms.map(room => `
      <div class="room-list-item" data-room-id="${room.id}">
        <div class="room-item-header">
          <div class="room-item-name">${room.name}</div>
          <div class="room-item-actions">
            <button class="btn btn-xs btn-outline" onclick="selectRoom('${room.id}')" title="Select in 3D">
              <i class="fas fa-crosshairs"></i>
            </button>
            <button class="btn btn-xs btn-outline" onclick="editRoom('${room.id}')" title="Edit properties">
              <i class="fas fa-edit"></i>
            </button>
          </div>
        </div>
        <div class="room-item-details">
          <div class="room-detail">
            <span class="room-detail-label">Number:</span>
            <span class="room-detail-value">${room.number || 'N/A'}</span>
          </div>
          <div class="room-detail">
            <span class="room-detail-label">Department:</span>
            <span class="room-detail-value">${room.department}</span>
          </div>
          <div class="room-detail">
            <span class="room-detail-label">Area:</span>
            <span class="room-detail-value">${Math.round(room.squareFootage)} sq ft</span>
          </div>
          <div class="room-detail">
            <span class="room-detail-label">Volume:</span>
            <span class="room-detail-value">${Math.round(room.volume)} cu ft</span>
          </div>
        </div>
      </div>
    `).join('');
    
    container.innerHTML = roomListHTML;
    
    // Add click handlers for room items
    container.querySelectorAll('.room-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // Don't trigger on action buttons
        const roomId = item.dataset.roomId;
        selectRoomById(roomId);
      });
    });
  }
  
  /**
   * Update department filter dropdown
   */
  function updateDepartmentFilter() {
    const filter = document.getElementById('departmentFilter');
    const departments = roomSystem.getDepartments();
    
    // Keep current selection
    const currentValue = filter.value;
    
    filter.innerHTML = '<option value="">All Departments</option>';
    
    departments.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept;
      option.textContent = dept;
      if (dept === currentValue) option.selected = true;
      filter.appendChild(option);
    });
  }
  
  /**
   * Update department summary
   */
  function updateDepartmentSummary(stats) {
    const container = document.getElementById('departmentSummaryContainer');
    const summarySection = document.querySelector('.department-summary-section');
    
    if (!stats.departmentBreakdown || Object.keys(stats.departmentBreakdown).length === 0) {
      summarySection.style.display = 'none';
      return;
    }
    
    summarySection.style.display = 'block';
    
    const summaryHTML = Object.entries(stats.departmentBreakdown)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, data]) => `
        <div class="department-summary-item">
          <div class="department-name">${dept}</div>
          <div class="department-stats">
            <span>${data.roomCount} rooms</span>
            <span>${Math.round(data.squareFootage).toLocaleString()} sq ft</span>
            <span>Avg: ${Math.round(data.averageSize)} sq ft</span>
          </div>
        </div>
      `).join('');
    
    container.innerHTML = summaryHTML;
  }
  
  /**
   * Handle quick action: designate selected object
   */
  function handleDesignateSelected() {
    // This would need access to the main app's selected objects
    // For now, show a message
    alert('Please select a 3D object in the scene first, then use this button or press \'R\' to designate it as a room.');
  }
  
  /**
   * Handle show all rooms
   */
  function handleShowAllRooms() {
    // Clear filters
    document.getElementById('roomSearchInput').value = '';
    document.getElementById('departmentFilter').value = '';
    updateRoomList();
  }
  
  /**
   * Handle validate and fix rooms
   */
  function handleValidateRooms() {
    try {
      const results = roomManager.validateAndFixRooms();
      
      let message = `Validation complete:\\n`;
      message += `- Validated: ${results.validated} rooms\\n`;
      message += `- Fixed: ${results.fixed} issues\\n`;
      
      if (results.errors.length > 0) {
        message += `- Errors: ${results.errors.length}\\n`;
        console.warn('Room validation errors:', results.errors);
      }
      
      alert(message);
      
      // Refresh data
      refreshRoomManagerData();
      
    } catch (error) {
      console.error('Error validating rooms:', error);
      alert('Error during validation: ' + error.message);
    }
  }
  
  /**
   * Handle room search
   */
  function handleRoomSearch() {
    updateRoomList();
  }
  
  /**
   * Handle department filter change
   */
  function handleDepartmentFilter() {
    updateRoomList();
  }
  
  /**
   * Select room by ID
   */
  function selectRoomById(roomId) {
    const room = roomSystem.getRoomById(roomId);
    if (!room) return;
    
    // Show room properties panel
    showRoomPropertiesPanel(room);
    
    // Could also select the 3D object in the scene if we had access to selection system
    console.log('Selected room:', room.name);
  }
  
  // Make functions available globally for onclick handlers
  window.selectRoom = selectRoomById;
  window.editRoom = (roomId) => {
    const room = roomSystem.getRoomById(roomId);
    if (room) showRoomPropertiesPanel(room);
  };
  
  /**
   * Create the main room designation modal
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
    
    // Auto-populate department dropdown with existing departments
    updateDepartmentDropdown();
  }
  
  /**
   * Create the room properties panel for editing existing rooms
   */
  function createRoomPropertiesPanel() {
    const panelHTML = `
      <div id="roomPropertiesPanel" class="room-panel" style="display: none;">
        <div class="room-panel-header">
          <h3>Room Properties</h3>
          <div class="room-panel-actions">
            <button class="btn btn-sm btn-outline" id="refreshRoomCalc" title="Recalculate properties">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="room-panel-close" aria-label="Close">&times;</button>
          </div>
        </div>
        
        <div class="room-panel-body">
          <div class="room-info-section">
            <div class="form-group">
              <label for="editRoomName">Room Name</label>
              <input type="text" id="editRoomName" class="form-control">
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label for="editRoomNumber">Room Number</label>
                <input type="text" id="editRoomNumber" class="form-control">
              </div>
              
              <div class="form-group">
                <label for="editRoomDepartment">Department</label>
                <select id="editRoomDepartment" class="form-control">
                  <option value="">Select Department</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label for="editRoomHeight">Height (feet)</label>
                <input type="number" id="editRoomHeight" class="form-control" min="6" max="20" step="0.5">
              </div>
              
              <div class="form-group">
                <label for="editRoomOccupancy">Occupancy</label>
                <input type="number" id="editRoomOccupancy" class="form-control" min="0">
              </div>
            </div>
            
            <div class="form-group">
              <label for="editRoomFunction">Function</label>
              <input type="text" id="editRoomFunction" class="form-control">
            </div>
            
            <div class="form-group">
              <label for="editRoomNotes">Notes</label>
              <textarea id="editRoomNotes" class="form-control" rows="2"></textarea>
            </div>
          </div>
          
          <div class="room-stats-section">
            <h4>Current Properties</h4>
            <div class="stats-grid">
              <div class="stat-item">
                <label>Square Footage:</label>
                <span id="currentSquareFootage">--</span>
              </div>
              <div class="stat-item">
                <label>Volume:</label>
                <span id="currentVolume">--</span>
              </div>
              <div class="stat-item">
                <label>Width:</label>
                <span id="currentWidth">--</span>
              </div>
              <div class="stat-item">
                <label>Depth:</label>
                <span id="currentDepth">--</span>
              </div>
              <div class="stat-item">
                <label>Height:</label>
                <span id="currentHeight">--</span>
              </div>
            </div>
          </div>
          
          <div class="room-actions-section">
            <button class="btn btn-sm btn-primary" id="saveRoomProperties">Save Changes</button>
            <button class="btn btn-sm btn-danger" id="removeRoomDesignation">Remove Room Designation</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', panelHTML);
    
    // Add event listeners
    document.getElementById('roomPropertiesPanel').querySelector('.room-panel-close').addEventListener('click', hideRoomPropertiesPanel);
    document.getElementById('refreshRoomCalc').addEventListener('click', refreshRoomCalculations);
    document.getElementById('saveRoomProperties').addEventListener('click', saveRoomProperties);
    document.getElementById('removeRoomDesignation').addEventListener('click', handleRemoveRoomDesignation);
  }
  
  /**
   * Show room designation modal for selected object
   * @param {THREE.Object3D} object - Selected object
   */
  function showRoomDesignationModal(object) {
    if (!object || !object.isMesh) {
      alert('Please select a 3D object to designate as a room.');
      return;
    }
    
    // Check if already a room
    const existingRoom = roomSystem.getRoomFromObject(object);
    if (existingRoom) {
      showRoomPropertiesPanel(existingRoom);
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
   * Show room properties panel for existing room
   * @param {Room} room - Room to edit
   */
  function showRoomPropertiesPanel(room) {
    if (!room) return;
    
    currentRoom = room;
    
    // Populate form with room data
    populateRoomPropertiesForm(room);
    
    // Update department dropdown
    updateEditDepartmentDropdown();
    
    // Show panel
    document.getElementById('roomPropertiesPanel').style.display = 'block';
  }
  
  /**
   * Hide room properties panel
   */
  function hideRoomPropertiesPanel() {
    document.getElementById('roomPropertiesPanel').style.display = 'none';
    currentRoom = null;
  }
  
  /**
   * Handle room designation confirmation
   */
  function handleRoomDesignation() {
    if (!selectedObject) return;
    
    // Validate form
    const formData = collectRoomDesignationData();
    if (!formData) return;
    
    try {
      // Create room
      const room = roomManager.designateAsRoom(selectedObject, formData);
      
      if (room) {
        alert(`Successfully designated "${room.name}" as a room with ${room.squareFootage.toFixed(1)} sq ft.`);
        hideRoomDesignationModal();
        
        // Show properties panel for further editing
        setTimeout(() => showRoomPropertiesPanel(room), 100);
      } else {
        alert('Failed to designate object as room. Please try again.');
      }
      
    } catch (error) {
      console.error('Error designating room:', error);
      alert('Error designating room: ' + error.message);
    }
  }
  
  /**
   * Handle room properties save
   */
  function saveRoomProperties() {
    if (!currentRoom) return;
    
    const formData = collectRoomPropertiesData();
    if (!formData) return;
    
    try {
      roomManager.updateRoom(currentRoom, formData);
      alert('Room properties saved successfully.');
      
      // Refresh display
      populateRoomPropertiesForm(currentRoom);
      
    } catch (error) {
      console.error('Error saving room properties:', error);
      alert('Error saving properties: ' + error.message);
    }
  }
  
  /**
   * Handle remove room designation
   */
  function handleRemoveRoomDesignation() {
    if (!currentRoom) return;
    
    const confirmMessage = `Are you sure you want to remove room designation from "${currentRoom.name}"?\\n\\nThis will remove all room metadata but keep the 3D object.`;
    
    if (confirm(confirmMessage)) {
      try {
        const success = roomManager.removeRoomDesignation(currentRoom);
        
        if (success) {
          alert('Room designation removed successfully.');
          hideRoomPropertiesPanel();
        } else {
          alert('Failed to remove room designation.');
        }
        
      } catch (error) {
        console.error('Error removing room designation:', error);
        alert('Error removing designation: ' + error.message);
      }
    }
  }
  
  /**
   * Collect room designation form data
   * @returns {Object|null} Form data or null if validation fails
   */
  function collectRoomDesignationData() {
    const name = document.getElementById('roomName').value.trim();
    const number = document.getElementById('roomNumber').value.trim();
    const department = document.getElementById('roomDepartment').value;
    const height = parseFloat(document.getElementById('roomHeight').value);
    const occupancy = parseInt(document.getElementById('roomOccupancy').value) || null;
    const roomFunction = document.getElementById('roomFunction').value.trim();
    const notes = document.getElementById('roomNotes').value.trim();
    
    // Validation
    if (!name) {
      alert('Please enter a room name.');
      document.getElementById('roomName').focus();
      return null;
    }
    
    if (!department) {
      alert('Please select a department.');
      document.getElementById('roomDepartment').focus();
      return null;
    }
    
    if (isNaN(height) || height < 6 || height > 20) {
      alert('Please enter a valid height between 6 and 20 feet.');
      document.getElementById('roomHeight').focus();
      return null;
    }
    
    return {
      name,
      number,
      department,
      height,
      metadata: {
        occupancy,
        function: roomFunction,
        notes
      }
    };
  }
  
  /**
   * Collect room properties form data
   * @returns {Object|null} Form data or null if validation fails
   */
  function collectRoomPropertiesData() {
    const name = document.getElementById('editRoomName').value.trim();
    const number = document.getElementById('editRoomNumber').value.trim();
    const department = document.getElementById('editRoomDepartment').value;
    const height = parseFloat(document.getElementById('editRoomHeight').value);
    const occupancy = parseInt(document.getElementById('editRoomOccupancy').value) || null;
    const roomFunction = document.getElementById('editRoomFunction').value.trim();
    const notes = document.getElementById('editRoomNotes').value.trim();
    
    // Validation
    if (!name) {
      alert('Please enter a room name.');
      document.getElementById('editRoomName').focus();
      return null;
    }
    
    if (!department) {
      alert('Please select a department.');
      document.getElementById('editRoomDepartment').focus();
      return null;
    }
    
    if (isNaN(height) || height < 6 || height > 20) {
      alert('Please enter a valid height between 6 and 20 feet.');
      document.getElementById('editRoomHeight').focus();
      return null;
    }
    
    return {
      name,
      number,
      department,
      height,
      metadata: {
        occupancy,
        function: roomFunction,
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
   * Populate room properties form with room data
   * @param {Room} room - Room to populate form with
   */
  function populateRoomPropertiesForm(room) {
    document.getElementById('editRoomName').value = room.name;
    document.getElementById('editRoomNumber').value = room.number;
    document.getElementById('editRoomDepartment').value = room.department;
    document.getElementById('editRoomHeight').value = room.height;
    document.getElementById('editRoomOccupancy').value = room.metadata.occupancy || '';
    document.getElementById('editRoomFunction').value = room.metadata.function || '';
    document.getElementById('editRoomNotes').value = room.metadata.notes || '';
    
    // Update stats
    updateCurrentStats(room);
  }
  
  /**
   * Update calculated properties preview
   * @param {THREE.Object3D} object - Object to calculate properties for
   */
  function updateCalculatedProperties(object) {
    if (!object) return;
    
    try {
      const bbox = new THREE.Box3().setFromObject(object);
      const size = bbox.getSize(new THREE.Vector3());
      
      // Convert to feet
      const metersToFeet = 3.28084;
      const widthFt = size.x * metersToFeet;
      const depthFt = size.z * metersToFeet;
      const heightFt = size.y * metersToFeet;
      
      const squareFootage = widthFt * depthFt;
      const volume = widthFt * depthFt * heightFt;
      
      document.getElementById('calculatedSquareFootage').textContent = `${squareFootage.toFixed(1)} sq ft`;
      document.getElementById('calculatedVolume').textContent = `${volume.toFixed(1)} cu ft`;
      document.getElementById('calculatedDimensions').textContent = 
        `${widthFt.toFixed(1)}'W × ${depthFt.toFixed(1)}'D × ${heightFt.toFixed(1)}'H`;
        
    } catch (error) {
      console.error('Error calculating properties:', error);
      document.getElementById('calculatedSquareFootage').textContent = 'Error';
      document.getElementById('calculatedVolume').textContent = 'Error';
      document.getElementById('calculatedDimensions').textContent = 'Error';
    }
  }
  
  /**
   * Update current stats display
   * @param {Room} room - Room to display stats for
   */
  function updateCurrentStats(room) {
    document.getElementById('currentSquareFootage').textContent = `${room.squareFootage.toFixed(1)} sq ft`;
    document.getElementById('currentVolume').textContent = `${room.volume.toFixed(1)} cu ft`;
    document.getElementById('currentWidth').textContent = `${(room.dimensions.width * 3.28084).toFixed(1)} ft`;
    document.getElementById('currentDepth').textContent = `${(room.dimensions.depth * 3.28084).toFixed(1)} ft`;
    document.getElementById('currentHeight').textContent = `${(room.dimensions.height * 3.28084).toFixed(1)} ft`;
  }
  
  /**
   * Refresh room calculations
   */
  function refreshRoomCalculations() {
    if (!currentRoom) return;
    
    try {
      currentRoom.calculateFromMesh();
      updateCurrentStats(currentRoom);
      alert('Room calculations refreshed.');
    } catch (error) {
      console.error('Error refreshing calculations:', error);
      alert('Error refreshing calculations: ' + error.message);
    }
  }
  
  /**
   * Update department dropdown with existing departments
   */
  function updateDepartmentDropdown() {
    const dropdown = document.getElementById('roomDepartment');
    const existingDepartments = roomSystem.getDepartments();
    
    // Keep default options but add any new departments
    const defaultDepartments = ['Administration', 'Management', 'Technology', 'Marketing', 'Sales', 'Creative', 'Common Areas', 'Other'];
    
    existingDepartments.forEach(dept => {
      if (!defaultDepartments.includes(dept)) {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        dropdown.appendChild(option);
      }
    });
  }
  
  /**
   * Update edit department dropdown
   */
  function updateEditDepartmentDropdown() {
    const dropdown = document.getElementById('editRoomDepartment');
    dropdown.innerHTML = '<option value="">Select Department</option>';
    
    // Add default departments
    const departments = ['Administration', 'Management', 'Technology', 'Marketing', 'Sales', 'Creative', 'Common Areas', 'Other'];
    
    // Add existing departments
    roomSystem.getDepartments().forEach(dept => {
      if (!departments.includes(dept)) {
        departments.push(dept);
      }
    });
    
    departments.sort().forEach(dept => {
      const option = document.createElement('option');
      option.value = dept;
      option.textContent = dept;
      dropdown.appendChild(option);
    });
  }
  
  /**
   * Setup keyboard shortcuts
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      // Escape key closes modals/panels
      if (event.key === 'Escape') {
        if (document.getElementById('roomDesignationModal').style.display !== 'none') {
          hideRoomDesignationModal();
        }
        if (document.getElementById('roomPropertiesPanel').style.display !== 'none') {
          hideRoomPropertiesPanel();
        }
      }
      
      // R key for room designation (when object is selected)
      if (event.key === 'r' || event.key === 'R') {
        if (!event.ctrlKey && !event.altKey && !event.shiftKey) {
          // Only if no modals are open and we have a selected object
          const hasModalsOpen = document.getElementById('roomDesignationModal').style.display !== 'none' ||
                               document.getElementById('roomPropertiesPanel').style.display !== 'none';
          
          if (!hasModalsOpen) {
            // This would need to be connected to the main app's selection system
            event.preventDefault();
            // showRoomDesignationModal(selectedObject);
          }
        }
      }
    });
  }
  
  // Return public API
  return {
    initialize,
    showRoomDesignationModal,
    showRoomPropertiesPanel,
    hideRoomDesignationModal,
    hideRoomPropertiesPanel,
    updateDepartmentDropdown,
    refreshRoomCalculations,
    showRoomManagerPanel,
    hideRoomManagerPanel,
    toggleRoomManagerPanel
  };
}