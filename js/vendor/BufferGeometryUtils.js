// From three.js examples (MIT License). Trimmed to export mergeVertices used by Sketcher.
// Source: https://github.com/mrdoob/three.js/blob/r155/examples/jsm/utils/BufferGeometryUtils.js
// License: MIT — Copyright (c) 2010-2023 three.js / mrdoob

import * as THREE from './three.module.js';

// Quantize a value for tolerant vertex welding
function _quantize( v, tol ) {
    return Math.round( v / tol ) * tol;
}

// Creates an indexed geometry by merging vertices that are within tolerance
export function mergeVertices( geometry, tolerance = 1e-4 ) {
    if ( tolerance <= 0 ) return geometry;

    const geo = geometry.index ? geometry.clone() : geometry.toNonIndexed();
    const posAttr = geo.getAttribute( 'position' );
    const normAttr = geo.getAttribute( 'normal' );
    const uvAttr = geo.getAttribute( 'uv' );

    const hashToNewIndex = new Map();
    const newPositions = [];
    const newNormals = normAttr ? [] : null;
    const newUVs = uvAttr ? [] : null;
    const normalsAcc = normAttr ? [] : null; // accumulate then normalize

    const indexArray = [];

    const v = new THREE.Vector3();
    const n = new THREE.Vector3();

    for ( let i = 0; i < posAttr.count; i ++ ) {
        v.fromBufferAttribute( posAttr, i );
        const hx = _quantize( v.x, tolerance );
        const hy = _quantize( v.y, tolerance );
        const hz = _quantize( v.z, tolerance );
        const key = `${hx}|${hy}|${hz}`;

        let newIndex = hashToNewIndex.get( key );
        if ( newIndex === undefined ) {
            newIndex = newPositions.length / 3;
            newPositions.push( hx, hy, hz );
            if ( newNormals ) {
                n.set( 0, 0, 0 );
                newNormals.push( 0, 0, 0 );
                normalsAcc.push( 0, 0, 0 );
            }
            if ( newUVs ) {
                newUVs.push( uvAttr.getX( i ), uvAttr.getY( i ) );
            }
            hashToNewIndex.set( key, newIndex );
        }
        indexArray.push( newIndex );

        if ( normalsAcc && normAttr ) {
            // Sum normals for all merged verts; will normalize later
            normalsAcc[ 3 * newIndex + 0 ] += normAttr.getX( i );
            normalsAcc[ 3 * newIndex + 1 ] += normAttr.getY( i );
            normalsAcc[ 3 * newIndex + 2 ] += normAttr.getZ( i );
        }
    }

    const out = new THREE.BufferGeometry();
    out.setIndex( indexArray );
    out.setAttribute( 'position', new THREE.Float32BufferAttribute( newPositions, 3 ) );
    if ( newUVs ) out.setAttribute( 'uv', new THREE.Float32BufferAttribute( newUVs, 2 ) );
    if ( normalsAcc ) {
        // Normalize accumulated normals
        for ( let i = 0; i < normalsAcc.length; i += 3 ) {
            n.set( normalsAcc[ i ], normalsAcc[ i + 1 ], normalsAcc[ i + 2 ] );
            n.normalize();
            newNormals[ i ] = n.x; newNormals[ i + 1 ] = n.y; newNormals[ i + 2 ] = n.z;
        }
        out.setAttribute( 'normal', new THREE.Float32BufferAttribute( newNormals, 3 ) );
    } else if ( posAttr ) {
        out.computeVertexNormals();
    }

    // Preserve groups if present
    if ( geo.groups && geo.groups.length ) {
        for ( const g of geo.groups ) out.addGroup( g.start, g.count, g.materialIndex );
    }

    out.boundingBox = null; out.boundingSphere = null;
    return out;
}

export default { mergeVertices };
