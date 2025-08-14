// UI wiring for the Materials popup. Safe, additive module that consumes app.js public API.
// No functional changes: just delegates button clicks to window.sketcherMaterialsAPI.

function wireMaterialsPopup() {
  const api = window.sketcherMaterialsAPI;
  if (!api) return; // app not ready yet
  const btnOriginal = document.getElementById('matOriginal');
  const btnCardboard = document.getElementById('matCardboard');
  const btnMdf = document.getElementById('matMdf');
  const btnSketch = document.getElementById('matSketch');
  if (btnOriginal) btnOriginal.addEventListener('click', () => { api.applyMaterialStyle('original'); api.setMaterialButtons('original'); });
  if (btnCardboard) btnCardboard.addEventListener('click', () => { api.applyMaterialStyle('cardboard'); api.setMaterialButtons('cardboard'); });
  if (btnMdf) btnMdf.addEventListener('click', () => { api.applyMaterialStyle('mdf'); api.setMaterialButtons('mdf'); });
  if (btnSketch) btnSketch.addEventListener('click', () => { api.applyMaterialStyle('sketch'); api.setMaterialButtons('sketch'); });
}

// Initialize immediately if app is ready; otherwise wait for signal
if (window.sketcherMaterialsAPI) {
  try { wireMaterialsPopup(); } catch {}
} else {
  document.addEventListener('sketcher:materials-ready', () => { try { wireMaterialsPopup(); } catch {} });
}
