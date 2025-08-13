// Session draft autosave helper
// Factory returns debounced save methods that write to sessionStorage
// without imposing any app-level behavior.

export function createSessionDraft({ serializeScene, sessionKey = 'sketcher:sessionDraft', onAfterSave } = {}) {
  let timer = null;

  function saveNow() {
    try {
      const json = serializeScene();
      sessionStorage.setItem(sessionKey, JSON.stringify({ json }));
      if (typeof onAfterSave === 'function') onAfterSave({ json });
    } catch {
      // ignore
    }
  }

  function saveSoon(delay = 250) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveNow, delay);
  }

  function cancelPending() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { saveNow, saveSoon, cancelPending };
}
