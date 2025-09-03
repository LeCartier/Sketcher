// Optimize imported models to reduce memory & draw calls
// - For OBJ: weld vertices, optional simplification, split by materials is preserved
// - For heavy textures (if GLTF path), we leave to KTX2 during load

import * as THREE from '../../vendor/three.module.js';
import { mergeVertices } from '../../vendor/BufferGeometryUtils.js';
import { simplifyVertexClustering } from '../../vendor/Simplify.js';

export function optimizeObject3D(root, opts = {}){
    const { weldTolerance = 1e-4, simplify = false, voxelSize = 0.01, onProgress } = opts;

    // Traverse meshes only
    const meshes = [];
    root.traverse(o=>{ if (o.isMesh && o.geometry) meshes.push(o); });
    const total = meshes.length || 1;
    let i = 0;

    for (const m of meshes){
        try {
            let geo = m.geometry;
            if (weldTolerance > 0){
                geo = mergeVertices(geo, weldTolerance);
            }
            if (simplify){
                // Use voxel clustering sized relative to bbox
                const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
                const size = new THREE.Vector3(); box.getSize(size);
                const targetVoxel = Math.max(voxelSize, Math.min(size.x, size.y, size.z) * 0.005);
                geo = simplifyVertexClustering(geo, targetVoxel);
            }
            geo.computeBoundingBox(); geo.computeBoundingSphere();
            m.geometry.dispose && m.geometry.dispose();
            m.geometry = geo;
        } catch(e){
            console.warn('Geometry optimize failed for mesh', m.name || m.uuid, e);
        }
        i++; if (onProgress) try { onProgress(i/total); } catch {}
    }
}

export default { optimizeObject3D };
