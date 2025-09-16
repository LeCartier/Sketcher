// Excel Parser Service for Blocking and Stacking
// Parses Excel files and extracts room data for mass creation

export function createExcelParser() {
  
  /**
   * Parse Excel file and extract room data
   * @param {File} file - The Excel file to parse
   * @returns {Promise<Array>} Promise that resolves to array of room objects
   */
  async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get the first worksheet
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1,  // Use array format to get raw data
            defval: ''  // Default empty value
          });
          
          resolve({
            sheetName: firstSheetName,
            data: jsonData,
            headers: jsonData[0] || []
          });
        } catch (error) {
          reject(new Error(`Failed to parse Excel file: ${error.message}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Extract room data from parsed Excel data
   * @param {Array} data - Raw Excel data array
   * @param {Object} columnMapping - Mapping of columns { roomName: 0, squareFootage: 1, department: 2 }
   * @returns {Array} Array of room objects with { name, squareFootage, department }
   */
  function extractRoomData(data, columnMapping) {
    if (!data || data.length < 2) {
      throw new Error('Excel file must have at least a header row and one data row');
    }
    
    const { roomName, squareFootage, department } = columnMapping;
    const rooms = [];
    
    // Skip header row (index 0)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip empty rows
      if (!row || row.length === 0) continue;
      
      const name = row[roomName]?.toString().trim();
      const sqft = parseFloat(row[squareFootage]);
      const dept = row[department]?.toString().trim() || 'Unassigned';
      
      // Skip rows with missing essential data
      if (!name || isNaN(sqft) || sqft <= 0) {
        console.warn(`Skipping row ${i + 1}: missing or invalid data`, { name, sqft, dept });
        continue;
      }
      
      rooms.push({
        name: name,
        squareFootage: sqft,
        department: dept,
        id: `room_${i}_${Date.now()}` // Unique ID for tracking
      });
    }
    
    if (rooms.length === 0) {
      throw new Error('No valid room data found. Please check that you have room names, square footage numbers, and department names in the specified columns.');
    }
    
    return rooms;
  }

  /**
   * Group rooms by department
   * @param {Array} rooms - Array of room objects
   * @returns {Object} Object with department names as keys and arrays of rooms as values
   */
  function groupRoomsByDepartment(rooms) {
    const departments = {};
    
    rooms.forEach(room => {
      const dept = room.department || 'Unassigned';
      if (!departments[dept]) {
        departments[dept] = [];
      }
      departments[dept].push(room);
    });
    
    return departments;
  }

  /**
   * Validate column mapping
   * @param {Array} headers - Array of column headers
   * @param {Object} mapping - Column mapping object
   * @returns {Object} Validation result with isValid flag and error message
   */
  function validateColumnMapping(headers, mapping) {
    const { roomName, squareFootage, department } = mapping;
    
    // Check if all required columns are specified and within bounds
    const maxIndex = headers.length - 1;
    
    if (roomName < 0 || roomName > maxIndex) {
      return { isValid: false, error: 'Room name column index is out of range' };
    }
    
    if (squareFootage < 0 || squareFootage > maxIndex) {
      return { isValid: false, error: 'Square footage column index is out of range' };
    }
    
    if (department < 0 || department > maxIndex) {
      return { isValid: false, error: 'Department column index is out of range' };
    }
    
    return { isValid: true };
  }

  /**
   * Load SheetJS library dynamically
   * @returns {Promise} Promise that resolves when library is loaded
   */
  async function loadSheetJSLibrary() {
    if (typeof XLSX !== 'undefined') {
      return; // Already loaded
    }
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Excel parsing library'));
      document.head.appendChild(script);
    });
  }

  return {
    parseExcelFile,
    extractRoomData,
    groupRoomsByDepartment,
    validateColumnMapping,
    loadSheetJSLibrary
  };
}