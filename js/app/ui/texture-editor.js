// Texture Editor UI module: draggable/resizable shell and minimal wiring to app materials API
(function(){
  const editor = document.getElementById('textureEditor');
  if (!editor) return;
  const header = editor.querySelector('.te-header');
  const resizer = editor.querySelector('.te-resizer');
  const body = editor.querySelector('.te-body');
  const compactBtn = document.getElementById('teCompact');
  const chooseFolderBtn = document.getElementById('teChooseFolder');
  const folderNameEl = document.getElementById('teFolderName');
  const applyBtn = document.getElementById('teApply');
  const clearBtn = document.getElementById('teClear');
  // New pick buttons mapping to hidden file inputs
  const pickMap = [
    { btn: 'teBasePick', input: 'teBaseColor' },
    { btn: 'teNormalPick', input: 'teNormal' },
    { btn: 'teRoughnessPick', input: 'teRoughness' },
    { btn: 'teMetalnessPick', input: 'teMetalness' },
    { btn: 'teAOPick', input: 'teAO' },
    { btn: 'teEmissivePick', input: 'teEmissive' },
    { btn: 'teAlphaPick', input: 'teAlpha' },
  ];

  // Dragging
  let drag = null;
  header?.addEventListener('pointerdown', (e)=>{
    // Don't start dragging if the pointerdown originated on an interactive control in the header
    const isInteractive = !!(e.target && (e.target.closest('button, input, select, textarea, a, [role="button"]')));
    if (isInteractive) return;
    const rect = editor.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { header.setPointerCapture(e.pointerId); } catch {}
  });
  header?.addEventListener('pointermove', (e)=>{
    if (!drag) return;
    const left = Math.max(8, Math.min(window.innerWidth - editor.offsetWidth - 8, e.clientX - drag.dx));
    const top = Math.max(8, Math.min(window.innerHeight - editor.offsetHeight - 8, e.clientY - drag.dy));
    editor.style.left = left + 'px';
    editor.style.top = top + 'px';
  });
  header?.addEventListener('pointerup', ()=>{ drag = null; });

  // Resizing
  let resize = null;
  resizer?.addEventListener('pointerdown', (e)=>{
    const rect = editor.getBoundingClientRect();
    resize = { startX: e.clientX, startY: e.clientY, w: rect.width, h: rect.height };
    resizer.setPointerCapture(e.pointerId);
  });
  resizer?.addEventListener('pointermove', (e)=>{
    if (!resize) return;
    const w = Math.min(Math.max(260, resize.w + (e.clientX - resize.startX)), Math.round(window.innerWidth * 0.9));
    const h = Math.min(Math.max(180, resize.h + (e.clientY - resize.startY)), Math.round(window.innerHeight * 0.9));
    editor.style.width = w + 'px';
    editor.style.height = h + 'px';
    // Keep internal body scrollable within the popup height
    try {
      const headerH = header ? header.offsetHeight : 0;
      const resizerH = 16; // approx
      const pad = 12; // borders/margins
      const avail = h - headerH - resizerH - pad;
      if (body && avail > 80) body.style.maxHeight = avail + 'px';
    } catch {}
  });
  resizer?.addEventListener('pointerup', ()=>{ resize = null; });
  // Initial sizing
  try {
    const rect = editor.getBoundingClientRect();
    const headerH = header ? header.offsetHeight : 0;
    const resizerH = 16; const pad = 12;
    const avail = rect.height - headerH - resizerH - pad;
    if (body && avail > 80) body.style.maxHeight = avail + 'px';
  } catch {}

  // Compact toggle with persistence
  try {
    const saved = localStorage.getItem('sketcher:teCompact');
    if (saved === '1') { editor.classList.add('compact'); if (compactBtn) compactBtn.setAttribute('aria-pressed','true'); }
  } catch {}
  compactBtn?.addEventListener('click', ()=>{
    const on = !editor.classList.contains('compact');
    if (on) editor.classList.add('compact'); else editor.classList.remove('compact');
    try { localStorage.setItem('sketcher:teCompact', on ? '1' : '0'); } catch {}
    compactBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // Hook up pick buttons to click their corresponding hidden file inputs
  try {
    pickMap.forEach(({ btn, input }) => {
      const b = document.getElementById(btn);
      const i = document.getElementById(input);
      if (b && i) b.addEventListener('click', () => i.click());
    });
  } catch {}

  // Folder choose wiring and live name updates
  chooseFolderBtn?.addEventListener('click', ()=>{
    document.dispatchEvent(new CustomEvent('sketcher:chooseTextureFolder'));
  });
  document.addEventListener('sketcher:texture-folder-updated', (e)=>{
    try { const name = (e.detail && e.detail.name) ? e.detail.name : 'No folder'; if (folderNameEl) folderNameEl.textContent = name; } catch {}
  });

  // No explicit Pick Face button; face target applies to the last clicked face on Apply.

  // Apply/Clear stub: emit an event with current UI values; app.js can listen and act
  function getVals(){
    const val = (id, def=null) => {
      const el = document.getElementById(id); if(!el) return def;
      if (el.type === 'file') return el.files && el.files[0] ? el.files[0] : null;
      const n = parseFloat(el.value); return isFinite(n) ? n : def;
    };
    const target = (document.querySelector('input[name="teTarget"]:checked')?.value)||'object';
    return {
      target,
      files: {
        base: document.getElementById('teBaseColor')?.files?.[0]||null,
        normal: document.getElementById('teNormal')?.files?.[0]||null,
        roughness: document.getElementById('teRoughness')?.files?.[0]||null,
        metalness: document.getElementById('teMetalness')?.files?.[0]||null,
        ao: document.getElementById('teAO')?.files?.[0]||null,
        emissive: document.getElementById('teEmissive')?.files?.[0]||null,
        alpha: document.getElementById('teAlpha')?.files?.[0]||null,
      },
      repeat: { x: getVals.num('teRepeatX',1), y: getVals.num('teRepeatY',1) },
      offset: { x: getVals.num('teOffsetX',0), y: getVals.num('teOffsetY',0) },
      rotation: getVals.num('teRotation',0),
      normalScale: getVals.num('teNormalScale',1),
      scalars: { roughness: getVals.num('teRoughnessScalar',1), metalness: getVals.num('teMetalnessScalar',0) },
    };
  }
  getVals.num = (id, def)=>{ const el = document.getElementById(id); const n = parseFloat(el?.value); return isFinite(n)?n:def; };

  applyBtn?.addEventListener('click', ()=>{
    document.dispatchEvent(new CustomEvent('sketcher:texture-editor:apply', { detail: getVals() }));
  });
  clearBtn?.addEventListener('click', ()=>{
    document.dispatchEvent(new CustomEvent('sketcher:texture-editor:clear'));
  });
})();
