// Grid, material helpers

/**
 * Enhance grid material by fading line color toward screen edges.
 * Accepts a single material or array; applies in-place.
 */
export function enhanceGridMaterial(THREE, mat) {
  const mats = Array.isArray(mat) ? mat : [mat];
  mats.forEach(m => {
    if (!m || !m.isLineBasicMaterial) return;
    m.transparent = false;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeStart = { value: 0.72 };
      shader.uniforms.uFadeEnd = { value: 1.0 };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec2 vNDC;\nvoid main() {')
        .replace(/\}\s*$/, '  vNDC = gl_Position.xy / gl_Position.w;\n}');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec2 vNDC;\nuniform float uFadeStart;\nuniform float uFadeEnd;\nvoid main() {')
        .replace('#include <output_fragment>', `
          float r = length(vNDC);
          float fade = smoothstep(uFadeStart, uFadeEnd, r);
          outgoingLight = mix(outgoingLight, vec3(0.0), fade);
          #include <output_fragment>
        `);
    };
    m.needsUpdate = true;
  });
}

/** Dispose a GridHelper’s geometry and materials safely. */
export function disposeGrid(THREE, g) {
  try { g.geometry && g.geometry.dispose && g.geometry.dispose(); } catch {}
  try {
    if (Array.isArray(g.material)) g.material.forEach(m=>m && m.dispose && m.dispose());
    else g.material && g.material.dispose && g.material.dispose();
  } catch {}
}
