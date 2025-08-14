// Wires view buttons and plan lock to the public Views API exposed by app.js
(function(){
  function wire() {
    const api = window.sketcherViewsAPI;
    if (!api) return;
    const byId = (id)=>document.getElementById(id);
    const viewAxon = byId('viewAxon');
    const viewPlan = byId('viewPlan');
    const viewNorth = byId('viewNorth');
    const viewSouth = byId('viewSouth');
    const viewEast = byId('viewEast');
    const viewWest = byId('viewWest');
    const planLockBtn = byId('planLock');

    const safe = (el, fn) => { if (el) el.addEventListener('click', fn); };

    safe(viewAxon, () => api.setCameraView('axon'));
    safe(viewPlan, () => api.setCameraView('plan'));
    safe(viewNorth, () => api.setCameraView('north'));
    safe(viewSouth, () => api.setCameraView('south'));
    safe(viewEast, () => api.setCameraView('east'));
    safe(viewWest, () => api.setCameraView('west'));

    if (planLockBtn) {
      const sync = () => {
        try { planLockBtn.setAttribute('aria-pressed', api.isPlanViewLocked() ? 'true' : 'false'); } catch {}
      };
      sync();
      planLockBtn.addEventListener('click', () => {
        try { api.setPlanViewLocked(!api.isPlanViewLocked()); sync(); } catch {}
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
  document.addEventListener('sketcher:views-ready', wire);
})();
