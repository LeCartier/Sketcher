// Lightweight geometry simplifier (vertex clustering). MIT License.
// Not quadric error metrics, but fast and good enough for large OBJ meshes.

import * as THREE from './three.module.js';

export function simplifyVertexClustering( geometry, voxelSize = 0.01 ) {
    // Ensure indexed
    const geo = geometry.index ? geometry.clone() : geometry.toNonIndexed();
    const pos = geo.getAttribute('position');
    const index = geo.index ? geo.index.array : null;

    const groups = geo.groups && geo.groups.length ? geo.groups.slice() : [{ start:0, count: pos.count, materialIndex:0 }];

    const map = new Map();
    const newPositions = [];
    const newIndices = [];
    const keyVec = new THREE.Vector3();
    const tri = [0,0,0];

    const addVertex = (x,y,z)=>{
        keyVec.set( Math.floor(x/voxelSize), Math.floor(y/voxelSize), Math.floor(z/voxelSize) );
        const key = keyVec.x + ',' + keyVec.y + ',' + keyVec.z;
        let idx = map.get(key);
        if (idx === undefined){ idx = newPositions.length/3; newPositions.push(x,y,z); map.set(key, idx); }
        return idx;
    };

    for (const g of groups){
        const start = g.start; const end = start + g.count;
        for (let i = start; i < end; i += 3){
            const a = i + 0, b = i + 1, c = i + 2;
            const ia = index ? index[a] : a;
            const ib = index ? index[b] : b;
            const ic = index ? index[c] : c;
            const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
            const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
            const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
            tri[0] = addVertex(ax,ay,az);
            tri[1] = addVertex(bx,by,bz);
            tri[2] = addVertex(cx,cy,cz);
            if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[2] !== tri[0]){
                newIndices.push(tri[0], tri[1], tri[2]);
            }
        }
    }

    const out = new THREE.BufferGeometry();
    out.setIndex(newIndices);
    out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    out.computeVertexNormals();
    return out;
}

export default { simplifyVertexClustering };
