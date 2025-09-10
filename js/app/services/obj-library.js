// OBJ Library Service: Load and manage 3D objects from the obj-library folder
export function createOBJLibrary({ THREE, OBJLoader, scene }) {
  const objLibrary = {
    objects: [],
    previews: new Map(),
    loadPromises: new Map()
  };

  // List of OBJ files to load (you can replace these with actual file discovery)
  const OBJ_FILES = [
    'chair.obj',
    'table.obj',
    'lamp.obj',
    'plant.obj',
    'book.obj',
    'vase.obj',
    'frame.obj',
    'bottle.obj',
    'box.obj'
  ];

  async function loadOBJFile(filename) {
    const path = `./assets/obj-library/${filename}`;
    
    // Return existing promise if already loading
    if (objLibrary.loadPromises.has(filename)) {
      return objLibrary.loadPromises.get(filename);
    }

    const loadPromise = new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      
      loader.load(
        path,
        (object) => {
          // Process loaded object
          object.traverse((child) => {
            if (child.isMesh) {
              // Ensure materials are set up properly
              if (!child.material) {
                child.material = new THREE.MeshLambertMaterial({ color: 0x888888 });
              }
              
              // Enable shadow casting and receiving
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Center the object at origin
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          object.position.sub(center);

          // Store the original object data
          const objData = {
            filename,
            object: object.clone(),
            boundingBox: box,
            size: box.getSize(new THREE.Vector3())
          };

          objLibrary.objects.push(objData);
          console.log(`Loaded OBJ: ${filename}`);
          resolve(objData);
        },
        (progress) => {
          // Loading progress
          if (progress.lengthComputable) {
            const percent = (progress.loaded / progress.total) * 100;
            console.log(`Loading ${filename}: ${percent.toFixed(1)}%`);
          }
        },
        (error) => {
          console.warn(`Failed to load OBJ: ${filename}`, error);
          // Don't reject - just resolve with null so menu can continue
          resolve(null);
        }
      );
    });

    objLibrary.loadPromises.set(filename, loadPromise);
    return loadPromise;
  }

  function createPreviewMesh(objData, scale = 0.4) {
    if (!objData || !objData.object) return null;

    try {
      // Clone the object for preview
      const preview = objData.object.clone();
      
      // Scale to fit in button
      const maxDimension = Math.max(objData.size.x, objData.size.y, objData.size.z);
      const targetSize = scale * 0.01905; // Scale relative to button size
      const scaleRatio = maxDimension > 0 ? targetSize / maxDimension : 1;
      
      preview.scale.setScalar(scaleRatio);
      
      // Make materials slightly emissive for better visibility
      preview.traverse((child) => {
        if (child.isMesh && child.material) {
          const material = child.material.clone();
          if (material.emissive) {
            material.emissive.setRGB(0.1, 0.1, 0.1);
          }
          material.depthTest = false;
          material.depthWrite = false;
          material.toneMapped = false;
          child.material = material;
        }
      });

      // Store reference to original data
      preview.userData.objData = objData;
      preview.userData.isPreview = true;
      
      return preview;
    } catch (error) {
      console.error(`Failed to create preview for ${objData.filename}:`, error);
      return null;
    }
  }

  function createFullScaleObject(objData) {
    if (!objData || !objData.object) return null;

    try {
      // Clone the object at full scale
      const fullObject = objData.object.clone();
      
      // Restore materials for scene placement
      fullObject.traverse((child) => {
        if (child.isMesh && child.material) {
          // Reset material properties for scene use
          child.material.depthTest = true;
          child.material.depthWrite = true;
          child.material.toneMapped = true;
          
          if (child.material.emissive) {
            child.material.emissive.setRGB(0, 0, 0);
          }
        }
      });

      // Add metadata
      fullObject.userData.objData = objData;
      fullObject.userData.fromOBJLibrary = true;
      fullObject.userData.filename = objData.filename;
      fullObject.name = `OBJ_${objData.filename}`;

      return fullObject;
    } catch (error) {
      console.error(`Failed to create full object for ${objData.filename}:`, error);
      return null;
    }
  }

  async function loadAllObjects() {
    console.log('Loading OBJ library...');
    
    const loadPromises = OBJ_FILES.map(filename => loadOBJFile(filename));
    const results = await Promise.allSettled(loadPromises);
    
    // Filter out failed loads
    objLibrary.objects = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value);
    
    console.log(`OBJ library loaded: ${objLibrary.objects.length} objects available`);
    return objLibrary.objects;
  }

  function getAvailableObjects() {
    return objLibrary.objects;
  }

  function getObjectByFilename(filename) {
    return objLibrary.objects.find(obj => obj.filename === filename);
  }

  function placeObjectInScene(objData, position = new THREE.Vector3()) {
    const object = createFullScaleObject(objData);
    if (!object) return null;

    object.position.copy(position);
    scene.add(object);
    
    console.log(`Placed ${objData.filename} in scene at`, position);
    return object;
  }

  // Don't preload immediately - let it happen on demand
  // loadAllObjects().catch(error => {
  //   console.error('Failed to load OBJ library:', error);
  // });

  return {
    loadAllObjects,
    getAvailableObjects,
    getObjectByFilename,
    createPreviewMesh,
    createFullScaleObject,
    placeObjectInScene,
    
    // For debugging
    get objects() { return objLibrary.objects; },
    get previews() { return objLibrary.previews; }
  };
}
