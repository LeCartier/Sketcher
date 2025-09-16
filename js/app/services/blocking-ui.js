// Blocking and Stacking UI Workflow
// Step-by-step interface for Excel upload and mass generation
// Updated to create proper Room objects with full metadata tracking

export function createBlockingUI({ excelParser, blockingStacking, massSystem, scene, roomSystem, roomManager }) {

  /**
   * Create and show the blocking workflow modal
   */
  function showBlockingWorkflow() {
    // Remove existing modal if any
    removeBlockingModal();
    
    // Create modal structure
    const modal = createModalStructure();
    document.body.appendChild(modal);
    
    // Start with step 1
    showStep(1);
    
    // Focus on modal for accessibility
    setTimeout(() => modal.focus(), 100);
  }

  /**
   * Create the modal DOM structure
   */
  function createModalStructure() {
    const modal = document.createElement('div');
    modal.id = 'blockingModal';
    modal.className = 'blocking-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'blockingModalTitle');
    modal.setAttribute('tabindex', '-1');
    
    modal.innerHTML = `
      <div class="blocking-modal-overlay" onclick="closeBlockingModal()"></div>
      <div class="blocking-modal-content">
        <div class="blocking-modal-header">
          <h2 id="blockingModalTitle">Blocking & Stacking</h2>
          <button class="blocking-modal-close" onclick="closeBlockingModal()" aria-label="Close">&times;</button>
        </div>
        <div class="blocking-modal-body">
          <div class="blocking-progress">
            <div class="progress-step active" data-step="1">
              <div class="step-number">1</div>
              <div class="step-label">Upload Excel</div>
            </div>
            <div class="progress-step" data-step="2">
              <div class="step-number">2</div>
              <div class="step-label">Map Columns</div>
            </div>
            <div class="progress-step" data-step="3">
              <div class="step-number">3</div>
              <div class="step-label">Preview & Generate</div>
            </div>
          </div>
          
          <!-- Step 1: File Upload -->
          <div id="blockingStep1" class="blocking-step active">
            <h3>Upload Excel File</h3>
            <p>Upload an Excel file (.xlsx, .xls) containing room data with room names, square footage, and departments.</p>
            
            <div class="file-upload-area" id="fileUploadArea">
              <input type="file" id="excelFileInput" accept=".xlsx,.xls" hidden>
              <div class="upload-content">
                <svg class="upload-icon" viewBox="0 0 24 24" width="48" height="48">
                  <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" fill="#666"/>
                </svg>
                <p>Click to select Excel file or drag and drop</p>
                <p class="upload-hint">Supported: .xlsx, .xls files</p>
              </div>
            </div>
            
            <div class="file-requirements">
              <h4>File Requirements:</h4>
              <ul>
                <li>Excel file with headers in the first row</li>
                <li>Room names in one column</li>
                <li>Square footage (numbers) in another column</li>
                <li>Department names in a third column</li>
                <li>At least one data row after headers</li>
              </ul>
            </div>
            
            <div class="step-actions">
              <button class="btn btn-secondary" onclick="closeBlockingModal()">Cancel</button>
              <button class="btn btn-primary" id="step1Next" disabled>Next: Map Columns</button>
            </div>
          </div>
          
          <!-- Step 2: Column Mapping -->
          <div id="blockingStep2" class="blocking-step">
            <h3>Map Excel Columns</h3>
            <p>Tell us which columns contain your room data.</p>
            
            <div class="excel-preview" id="excelPreview">
              <!-- Excel data preview will be inserted here -->
            </div>
            
            <div class="column-mapping">
              <div class="mapping-row">
                <label for="roomNameColumn">Room Name Column:</label>
                <select id="roomNameColumn" class="mapping-select">
                  <option value="">Select column...</option>
                </select>
              </div>
              <div class="mapping-row">
                <label for="squareFootageColumn">Square Footage Column:</label>
                <select id="squareFootageColumn" class="mapping-select">
                  <option value="">Select column...</option>
                </select>
              </div>
              <div class="mapping-row">
                <label for="departmentColumn">Department Column:</label>
                <select id="departmentColumn" class="mapping-select">
                  <option value="">Select column...</option>
                </select>
              </div>
            </div>
            
            <div class="validation-message" id="mappingValidation"></div>
            
            <div class="step-actions">
              <button class="btn btn-secondary" onclick="showStep(1)">Back</button>
              <button class="btn btn-primary" id="step2Next" disabled>Next: Preview</button>
            </div>
          </div>
          
          <!-- Step 3: Preview and Generate -->
          <div id="blockingStep3" class="blocking-step">
            <h3>Preview & Generate Masses</h3>
            <p>Review your room data and generate the 3D masses.</p>
            
            <div class="data-summary" id="dataSummary">
              <!-- Data summary will be inserted here -->
            </div>
            
            <div class="generation-options">
              <h4>Generation Options:</h4>
              <div class="option-row">
                <label>
                  <input type="checkbox" id="showLabels" checked>
                  Show room labels
                </label>
              </div>
              <div class="option-row">
                <label>
                  <input type="checkbox" id="wireframeMode">
                  Wireframe mode
                </label>
              </div>
              <div class="option-row">
                <label for="massOpacity">Mass opacity:</label>
                <input type="range" id="massOpacity" min="0.1" max="1" step="0.1" value="0.8">
                <span id="opacityValue">80%</span>
              </div>
            </div>
            
            <div class="generation-progress" id="generationProgress" style="display:none;">
              <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
              </div>
              <div class="progress-text" id="progressText">Generating masses...</div>
            </div>
            
            <div class="step-actions">
              <button class="btn btn-secondary" onclick="showStep(2)">Back</button>
              <button class="btn btn-primary" id="generateMasses">Generate Masses</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    return modal;
  }

  /**
   * Show specific step in the workflow
   */
  function showStep(stepNumber) {
    // Update progress indicators
    document.querySelectorAll('.progress-step').forEach((step, index) => {
      const num = index + 1;
      if (num === stepNumber) {
        step.classList.add('active');
      } else if (num < stepNumber) {
        step.classList.add('completed');
        step.classList.remove('active');
      } else {
        step.classList.remove('active', 'completed');
      }
    });
    
    // Show correct step content
    document.querySelectorAll('.blocking-step').forEach(step => {
      step.classList.remove('active');
    });
    document.getElementById(`blockingStep${stepNumber}`).classList.add('active');
    
    // Initialize step-specific functionality
    if (stepNumber === 1) {
      initializeStep1();
    } else if (stepNumber === 2) {
      initializeStep2();
    } else if (stepNumber === 3) {
      initializeStep3();
    }
  }

  /**
   * Initialize step 1 (file upload)
   */
  function initializeStep1() {
    const fileInput = document.getElementById('excelFileInput');
    const uploadArea = document.getElementById('fileUploadArea');
    const nextButton = document.getElementById('step1Next');
    
    // File input change handler
    fileInput.addEventListener('change', handleFileSelection);
    
    // Drag and drop handlers
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleFileDrop);
    
    function handleFileSelection(event) {
      const file = event.target.files[0];
      if (file) {
        processUploadedFile(file);
      }
    }
    
    function handleDragOver(event) {
      event.preventDefault();
      uploadArea.classList.add('drag-over');
    }
    
    function handleDragLeave(event) {
      event.preventDefault();
      uploadArea.classList.remove('drag-over');
    }
    
    function handleFileDrop(event) {
      event.preventDefault();
      uploadArea.classList.remove('drag-over');
      
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
          processUploadedFile(file);
        } else {
          showError('Please upload an Excel file (.xlsx or .xls)');
        }
      }
    }
    
    async function processUploadedFile(file) {
      try {
        // Load SheetJS library if not already loaded
        await excelParser.loadSheetJSLibrary();
        
        // Show processing state
        updateUploadArea('Processing...', true);
        nextButton.disabled = true;
        
        // Parse the file
        const parsedData = await excelParser.parseExcelFile(file);
        
        // Store parsed data for next steps
        window.blockingWorkflowData = {
          file: file,
          parsedData: parsedData
        };
        
        // Update UI
        updateUploadArea(`✓ ${file.name} loaded (${parsedData.data.length - 1} rows)`, false);
        nextButton.disabled = false;
        
        // Auto-advance on successful upload
        setTimeout(() => showStep(2), 500);
        
      } catch (error) {
        console.error('Error processing file:', error);
        showError(error.message);
        updateUploadArea('Click to select Excel file or drag and drop', false);
        nextButton.disabled = true;
      }
    }
    
    function updateUploadArea(text, isProcessing) {
      const content = uploadArea.querySelector('.upload-content p');
      content.textContent = text;
      
      if (isProcessing) {
        uploadArea.classList.add('processing');
      } else {
        uploadArea.classList.remove('processing');
      }
    }
  }

  /**
   * Initialize step 2 (column mapping)
   */
  function initializeStep2() {
    const data = window.blockingWorkflowData;
    if (!data || !data.parsedData) {
      showStep(1);
      return;
    }
    
    const { headers } = data.parsedData;
    const preview = document.getElementById('excelPreview');
    const nextButton = document.getElementById('step2Next');
    
    // Show excel preview
    showExcelPreview(data.parsedData);
    
    // Populate column dropdowns
    populateColumnSelects(headers);
    
    // Validate mapping on change
    ['roomNameColumn', 'squareFootageColumn', 'departmentColumn'].forEach(id => {
      document.getElementById(id).addEventListener('change', validateMapping);
    });
    
    // Next button handler
    nextButton.onclick = () => {
      if (validateAndStoreMapping()) {
        showStep(3);
      }
    };
    
    function showExcelPreview(parsedData) {
      const { data, headers } = parsedData;
      const previewRows = Math.min(6, data.length); // Show up to 6 rows
      
      let html = '<table class="excel-table"><thead><tr>';
      
      // Headers
      headers.forEach((header, index) => {
        html += `<th data-column="${index}">${header || `Column ${index + 1}`}</th>`;
      });
      html += '</tr></thead><tbody>';
      
      // Data rows (skip header row)
      for (let i = 1; i < previewRows; i++) {
        html += '<tr>';
        if (data[i]) {
          headers.forEach((_, colIndex) => {
            const cellData = data[i][colIndex] || '';
            html += `<td>${cellData}</td>`;
          });
        }
        html += '</tr>';
      }
      
      if (data.length > previewRows) {
        html += `<tr><td colspan="${headers.length}" class="more-rows">... and ${data.length - previewRows} more rows</td></tr>`;
      }
      
      html += '</tbody></table>';
      preview.innerHTML = html;
    }
    
    function populateColumnSelects(headers) {
      const selects = ['roomNameColumn', 'squareFootageColumn', 'departmentColumn'];
      
      selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        select.innerHTML = '<option value="">Select column...</option>';
        
        headers.forEach((header, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = header || `Column ${index + 1}`;
          
          // Auto-select based on header names
          if (selectId === 'roomNameColumn' && 
              (header.toLowerCase().includes('room') || header.toLowerCase().includes('name'))) {
            option.selected = true;
          } else if (selectId === 'squareFootageColumn' && 
                     (header.toLowerCase().includes('sq') || header.toLowerCase().includes('area') || 
                      header.toLowerCase().includes('size') || header.toLowerCase().includes('footage'))) {
            option.selected = true;
          } else if (selectId === 'departmentColumn' && 
                     (header.toLowerCase().includes('dept') || header.toLowerCase().includes('department') || 
                      header.toLowerCase().includes('group'))) {
            option.selected = true;
          }
          
          select.appendChild(option);
        });
      });
      
      // Validate after auto-selection
      setTimeout(validateMapping, 100);
    }
    
    function validateMapping() {
      const roomNameCol = document.getElementById('roomNameColumn').value;
      const squareFootageCol = document.getElementById('squareFootageColumn').value;
      const departmentCol = document.getElementById('departmentColumn').value;
      const validation = document.getElementById('mappingValidation');
      
      // Clear previous validation
      validation.innerHTML = '';
      validation.className = 'validation-message';
      
      // Check if all required columns are selected
      if (!roomNameCol || !squareFootageCol || !departmentCol) {
        validation.innerHTML = '<p class="error">Please select all required columns.</p>';
        validation.classList.add('error');
        nextButton.disabled = true;
        return false;
      }
      
      // Check for duplicates
      if (roomNameCol === squareFootageCol || roomNameCol === departmentCol || squareFootageCol === departmentCol) {
        validation.innerHTML = '<p class="error">Each column must be different.</p>';
        validation.classList.add('error');
        nextButton.disabled = true;
        return false;
      }
      
      // Validate column mapping with parser
      const mapping = {
        roomName: parseInt(roomNameCol),
        squareFootage: parseInt(squareFootageCol),
        department: parseInt(departmentCol)
      };
      
      const validationResult = excelParser.validateColumnMapping(headers, mapping);
      if (!validationResult.isValid) {
        validation.innerHTML = `<p class="error">${validationResult.error}</p>`;
        validation.classList.add('error');
        nextButton.disabled = true;
        return false;
      }
      
      validation.innerHTML = '<p class="success">✓ Column mapping looks good!</p>';
      validation.classList.add('success');
      nextButton.disabled = false;
      return true;
    }
    
    function validateAndStoreMapping() {
      if (!validateMapping()) return false;
      
      const mapping = {
        roomName: parseInt(document.getElementById('roomNameColumn').value),
        squareFootage: parseInt(document.getElementById('squareFootageColumn').value),
        department: parseInt(document.getElementById('departmentColumn').value)
      };
      
      try {
        // Extract room data using the mapping
        const rooms = excelParser.extractRoomData(data.parsedData.data, mapping);
        window.blockingWorkflowData.rooms = rooms;
        window.blockingWorkflowData.mapping = mapping;
        return true;
      } catch (error) {
        document.getElementById('mappingValidation').innerHTML = `<p class="error">${error.message}</p>`;
        return false;
      }
    }
  }

  /**
   * Initialize step 3 (preview and generate)
   */
  function initializeStep3() {
    const data = window.blockingWorkflowData;
    if (!data || !data.rooms) {
      showStep(2);
      return;
    }
    
    // Show data summary
    showDataSummary(data.rooms);
    
    // Initialize option handlers
    initializeGenerationOptions();
    
    // Generate button handler
    document.getElementById('generateMasses').onclick = generateMasses;
    
    function showDataSummary(rooms) {
      const summary = document.getElementById('dataSummary');
      const departments = excelParser.groupRoomsByDepartment(rooms);
      const totalSqFt = rooms.reduce((sum, room) => sum + room.squareFootage, 0);
      
      let html = `
        <div class="summary-stats">
          <div class="stat">
            <div class="stat-number">${rooms.length}</div>
            <div class="stat-label">Total Rooms</div>
          </div>
          <div class="stat">
            <div class="stat-number">${Object.keys(departments).length}</div>
            <div class="stat-label">Departments</div>
          </div>
          <div class="stat">
            <div class="stat-number">${totalSqFt.toLocaleString()}</div>
            <div class="stat-label">Total Sq Ft</div>
          </div>
        </div>
        
        <div class="department-breakdown">
          <h4>Department Breakdown:</h4>
      `;
      
      Object.entries(departments).forEach(([deptName, deptRooms]) => {
        const deptSqFt = deptRooms.reduce((sum, room) => sum + room.squareFootage, 0);
        html += `
          <div class="dept-row">
            <span class="dept-name">${deptName}</span>
            <span class="dept-stats">${deptRooms.length} rooms, ${deptSqFt.toLocaleString()} sq ft</span>
          </div>
        `;
      });
      
      html += '</div>';
      summary.innerHTML = html;
    }
    
    function initializeGenerationOptions() {
      const opacitySlider = document.getElementById('massOpacity');
      const opacityValue = document.getElementById('opacityValue');
      
      opacitySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        opacityValue.textContent = `${Math.round(value * 100)}%`;
      });
    }
    
    async function generateMasses() {
      const generateButton = document.getElementById('generateMasses');
      const progress = document.getElementById('generationProgress');
      const progressFill = document.getElementById('progressFill');
      const progressText = document.getElementById('progressText');
      
      try {
        // Disable button and show progress
        generateButton.disabled = true;
        progress.style.display = 'block';
        
        // Get generation options
        const options = {
          showLabels: document.getElementById('showLabels').checked,
          wireframe: document.getElementById('wireframeMode').checked,
          opacity: parseFloat(document.getElementById('massOpacity').value)
        };
        
        // Step 1: Generate layout
        progressText.textContent = 'Calculating room layout...';
        progressFill.style.width = '20%';
        await delay(100);
        
        const layout = blockingStacking.generateMasses(data.rooms);
        
        // Step 2: Create masses
        progressText.textContent = 'Creating 3D masses...';
        progressFill.style.width = '40%';
        await delay(100);
        
        const massData = massSystem.generateAllMasses(layout, options);
        
        // Step 3: Clear existing and add to scene
        progressText.textContent = 'Adding to scene...';
        progressFill.style.width = '60%';
        await delay(100);
        
        // Clear existing masses if any
        massSystem.clearBlockingMasses();
        
        // Add new masses
        const result = massSystem.addMassesToScene(massData);
        
        // Step 4: Create Room objects if room system is available
        if (roomSystem && roomManager) {
          progressText.textContent = 'Creating room objects...';
          progressFill.style.width = '80%';
          await delay(100);
          
          // Convert masses to Room objects
          const createdRooms = await convertMassesToRooms(massData, layout);
          
          // Log success
          console.log(`Created ${createdRooms.length} Room objects from blocking masses`);
        }
        
        // Step 5: Complete
        progressText.textContent = 'Complete!';
        progressFill.style.width = '100%';
        await delay(500);
        
        // Close modal and show success
        closeBlockingModal();
        showSuccessMessage(result);
        
      } catch (error) {
        console.error('Error generating masses:', error);
        showError(`Failed to generate masses: ${error.message}`);
        generateButton.disabled = false;
        progress.style.display = 'none';
      }
    }
    
    /**
     * Convert generated masses to Room objects with proper metadata
     * @param {Object} massData - Mass data from mass system
     * @param {Object} layout - Layout data from blocking system
     * @returns {Array<Room>} Array of created Room objects
     */
    async function convertMassesToRooms(massData, layout) {
      if (!roomSystem || !roomManager) return [];
      
      const createdRooms = [];
      
      try {
        // Process each mesh and create Room objects
        massData.allMeshes.forEach((mesh, index) => {
          if (!mesh.userData || mesh.userData.type !== 'room_mass') return;
          
          // Find corresponding room data from layout
          const roomData = findRoomDataForMesh(mesh, layout);
          if (!roomData) return;
          
          try {
            // Create Room object
            const room = roomManager.designateAsRoom(mesh, {
              name: roomData.name,
              number: '', // Could be extracted from name if it follows a pattern
              department: roomData.department,
              height: roomData.height || 8,
              metadata: {
                squareFootage: roomData.squareFootage,
                function: 'Generated from blocking study',
                notes: `Created from Excel import on ${new Date().toLocaleDateString()}`,
                source: 'blocking_stacking',
                originalData: roomData
              }
            });
            
            if (room) {
              createdRooms.push(room);
            }
            
          } catch (error) {
            console.warn('Error creating Room object for mesh:', error);
          }
        });
        
        // Set up room management if rooms were created
        if (createdRooms.length > 0) {
          // Initialize room manager if not already done
          if (roomManager && typeof roomManager.initialize === 'function') {
            roomManager.initialize();
          }
          
          // Add event listener for room updates
          if (roomManager && typeof roomManager.addEventListener === 'function') {
            roomManager.addEventListener('roomModified', (event) => {
              console.log('Room modified:', event.room.name);
            });
          }
        }
        
      } catch (error) {
        console.error('Error converting masses to rooms:', error);
      }
      
      return createdRooms;
    }
    
    /**
     * Find room data corresponding to a mesh
     * @param {THREE.Mesh} mesh - Three.js mesh
     * @param {Object} layout - Layout data
     * @returns {Object|null} Room data or null
     */
    function findRoomDataForMesh(mesh, layout) {
      if (!mesh.userData || !layout.rooms) return null;
      
      const meshRoomId = mesh.userData.roomId;
      const meshRoomName = mesh.userData.roomName;
      
      // Try to find by ID first
      if (meshRoomId) {
        const roomById = layout.rooms.find(room => room.id === meshRoomId);
        if (roomById) return roomById;
      }
      
      // Try to find by name
      if (meshRoomName) {
        const roomByName = layout.rooms.find(room => room.name === meshRoomName);
        if (roomByName) return roomByName;
      }
      
      // If mesh has position, try to find closest room
      if (mesh.position && layout.rooms.length > 0) {
        let closestRoom = null;
        let closestDistance = Infinity;
        
        layout.rooms.forEach(room => {
          if (room.position) {
            const distance = mesh.position.distanceTo(room.position);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestRoom = room;
            }
          }
        });
        
        return closestRoom;
      }
      
      return null;
    }
  }

  /**
   * Close the blocking modal
   */
  function closeBlockingModal() {
    const modal = document.getElementById('blockingModal');
    if (modal) {
      modal.remove();
    }
    
    // Clean up workflow data
    delete window.blockingWorkflowData;
  }

  /**
   * Remove existing modal if present
   */
  function removeBlockingModal() {
    const existing = document.getElementById('blockingModal');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    // Create or update error display
    let errorDiv = document.querySelector('.blocking-error');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.className = 'blocking-error';
      const modalBody = document.querySelector('.blocking-modal-body');
      if (modalBody) {
        modalBody.insertBefore(errorDiv, modalBody.firstChild);
      }
    }
    
    errorDiv.innerHTML = `<p class="error">${message}</p>`;
    errorDiv.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }

  /**
   * Show success message after generation
   */
  function showSuccessMessage(result) {
    const message = `Successfully generated ${result.addedMeshes} room masses in ${result.addedGroups} department groups!`;
    
    // You could integrate with the existing notification system here
    console.log(message);
    
    // Create temporary success notification
    const notification = document.createElement('div');
    notification.className = 'blocking-success-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <h4>✓ Masses Generated</h4>
        <p>${message}</p>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-hide after 4 seconds
    setTimeout(() => {
      notification.remove();
    }, 4000);
  }

  /**
   * Utility delay function
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Make functions globally available for onclick handlers
  window.closeBlockingModal = closeBlockingModal;
  window.showStep = showStep;

  return {
    showBlockingWorkflow,
    closeBlockingModal
  };
}