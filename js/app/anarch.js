// AnArch glitch sequence overlay
export function triggerAnArchSequence() {
  if (document.getElementById('anarchOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'anarchOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="ao-bg"></div>
    <div class="ao-scanlines"></div>
  <div class="ao-vignette"></div>
  <div class="ao-flash"></div>
    <div class="ao-static" aria-hidden="true"></div>
    <div class="ao-bars" aria-hidden="true"></div>
    <div class="ao-center">
      <span class="ao-line">
        <span class="ao-word ao-base" aria-hidden="true" data-text="AnArch">AnArch</span>
        <span class="ao-word ao-ext" aria-hidden="true">itecture</span>
        <span class="ao-word ao-y" aria-hidden="true">y</span>
      </span>
    </div>
  `;
  const cleanup = () => {
    if (!overlay.isConnected) return;
    overlay.removeEventListener('animationend', onAnimEnd, true);
    overlay.parentElement && overlay.parentElement.removeChild(overlay);
    document.body.classList.remove('anarch-active');
  document.body.classList.remove('anarch-force-anim');
  document.body.style.filter = '';
  };
  const onAnimEnd = (e) => {
  if (e.target === overlay && e.animationName === 'aoOverlayOut') {
      cleanup();
    }
  };
  overlay.addEventListener('animationend', onAnimEnd, true);
  overlay.addEventListener('click', cleanup);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cleanup(); }, { once: true });
  document.body.classList.add('anarch-active');
  document.body.classList.add('anarch-force-anim');
  // Freeze motion subtly
  document.documentElement.style.scrollBehavior = 'auto';
  document.body.style.filter = 'contrast(1.05) saturate(1.2)';
  document.body.style.transition = 'filter 120ms ease';
  document.body.appendChild(overlay);
  // Add CRT class immediately
  overlay.classList.add('crt');
  // Start text animations (slide/glitch words)
  requestAnimationFrame(() => overlay.classList.add('run'));
  // Deterministic sequence:
  // 1) Quick static
  setTimeout(() => { overlay.classList.add('show-static'); }, 150);
  setTimeout(() => { overlay.classList.remove('show-static'); }, 550);
  // 2) "AnArchitecture" slides in (handled by CSS delay on .run)
  // 3) Quick color bars burst shortly after ext is visible
  setTimeout(() => { overlay.classList.add('show-bars'); }, 1500);
  setTimeout(() => { overlay.classList.remove('show-bars'); }, 1800);
  // 4) Immediately transition to "AnArchy" (drop y, remove ext)
  setTimeout(() => { overlay.classList.add('to-archy'); }, 1800);
  // Remove the mode before we fade out to avoid lingering visuals
  setTimeout(() => {
    overlay.classList.remove('show-bars', 'show-static');
  }, 3200);
  // Schedule chromatic aberration bursts synced to sequence
  const burst = (delay, dur=130)=> setTimeout(()=>{ overlay.classList.add('ao-burst'); setTimeout(()=>overlay.classList.remove('ao-burst'), dur); }, delay);
  burst(980, 140);   // during ext slide-in (earlier, shorter)
  burst(2140, 120);  // before ext slide-out
  burst(2740, 150);  // at y drop
  // Natural cleanup occurs on overlay's aoOverlayOut animation end
}
