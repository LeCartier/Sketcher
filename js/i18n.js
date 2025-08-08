// Simple i18n helper for the app
export const dictionaries = {
  en: {
    language: { label: 'Language:', en: 'English', es: 'Spanish' },
    mode: { label: 'Mode:', create: 'Create', edit: 'Edit', import: 'Import', ar: 'AR View' },
    draw: { heightLabel: 'Height (feet):' },
    edit: {
      transformLabel: 'Transform:',
      move: 'Move',
      rotate: 'Rotate',
      snapFloor: 'Return to Floor',
      groupSelected: 'Group Selected'
    },
    buttons: { enterAR: 'Enter AR', exportOBJ: 'Export Scene (OBJ)', uploadModel: 'Upload Model' },
    importUI: { addFloor: 'Add Floor', addWall: 'Add Wall' },
    visibility: { title: 'Visibility' },
    status: { noModelSelected: 'No model selected' },
    hints: { main: 'Create: drag • Edit: select/move/rotate • Import: place • Export scene' },
    alerts: {
      arStartFailed: 'Failed to start AR session: {message}',
      arNotSupported: 'AR not supported on this device/browser. On iPhone/iPad, use Safari 16+ and "WebXR Device API" enabled in Experimental Features.'
    }
  },
  es: {
    language: { label: 'Idioma:', en: 'Inglés', es: 'Español' },
    mode: { label: 'Modo:', create: 'Crear', edit: 'Editar', import: 'Importar', ar: 'Vista AR' },
    draw: { heightLabel: 'Altura (pies):' },
    edit: {
      transformLabel: 'Transformación:',
      move: 'Mover',
      rotate: 'Rotar',
      snapFloor: 'Volver al piso',
      groupSelected: 'Agrupar seleccionados'
    },
    buttons: { enterAR: 'Entrar en AR', exportOBJ: 'Exportar escena (OBJ)', uploadModel: 'Subir modelo' },
    importUI: { addFloor: 'Agregar piso', addWall: 'Agregar pared' },
    visibility: { title: 'Visibilidad' },
    status: { noModelSelected: 'Sin modelo seleccionado' },
    hints: { main: 'Crear: arrastrar • Editar: seleccionar/mover/rotar • Importar: colocar • Exportar escena' },
    alerts: {
      arStartFailed: 'No se pudo iniciar la sesión AR: {message}',
      arNotSupported: 'AR no es compatible con este dispositivo/navegador. En iPhone/iPad, use Safari 16+ y habilite "WebXR Device API" en Funciones experimentales.'
    }
  }
};

let locale = 'en';

export function setLocale(next) {
  if (dictionaries[next]) {
    locale = next;
    try { localStorage.setItem('locale', next); } catch {}
  }
}

export function getLocale() { return locale; }

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}

export function t(key, params = {}) {
  const dict = dictionaries[locale] || dictionaries.en;
  let str = get(dict, key) ?? key;
  if (typeof str !== 'string') return key;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
}

export function applyTranslations(root = document) {
  // data-i18n => textContent
  root.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.skipI18n === 'true') return;
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });

  // data-i18n-placeholder => placeholder
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    if (el.dataset.skipI18n === 'true') return;
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.setAttribute('placeholder', t(key));
  });

  // data-i18n-attr="title" with data-i18n-key="..."
  root.querySelectorAll('[data-i18n-attr][data-i18n-key]').forEach(el => {
    if (el.dataset.skipI18n === 'true') return;
    const attr = el.getAttribute('data-i18n-attr');
    const key = el.getAttribute('data-i18n-key');
    if (attr && key) el.setAttribute(attr, t(key));
  });
}

// Initialize locale from storage or browser
export function initLocale(defaults = ['en', 'es']) {
  let initial = 'en';
  try {
    initial = localStorage.getItem('locale') || initial;
  } catch {}
  if (!dictionaries[initial]) {
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    initial = defaults.includes(nav) ? nav : 'en';
  }
  setLocale(initial);
  return initial;
}
