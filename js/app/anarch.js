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
  // Freeze motion subtly
  document.documentElement.style.scrollBehavior = 'auto';
  document.body.style.filter = 'contrast(1.05) saturate(1.2)';
  document.body.style.transition = 'filter 120ms ease';
  document.body.appendChild(overlay);
  // Add CRT class immediately
  overlay.classList.add('crt');
  // Schedule chromatic aberration bursts synced to sequence
  const burst = (delay)=> setTimeout(()=>{ overlay.classList.add('ao-burst'); setTimeout(()=>overlay.classList.remove('ao-burst'), 150); }, delay);
  burst(1100); // during ext slide-in
  burst(2250); // before ext slide-out
  burst(2700); // at y drop
  // Natural cleanup occurs on overlay's aoOverlayOut animation end
}
