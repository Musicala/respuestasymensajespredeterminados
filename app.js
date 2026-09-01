/* ============================================================================
  app.js — Mensajes Predeterminados · Musicala — PRO + MusiAsistente local
  -----------------------------------------------------------------------------
  - Carga mensajes desde Firebase Firestore.
  - Búsqueda en vivo acento-insensitive.
  - CRUD con prevención de duplicados accidentales.
  - MusiAsistente local: recomienda mensajes según contexto usando la base cargada.
  - Sin IA real.
============================================================================ */

'use strict';

/** =========================
 *  CONFIG
 *  ========================= */
const FIREBASE_MESSAGES_COLLECTION = (window.MUSICALA_MESSAGES_FIREBASE && window.MUSICALA_MESSAGES_FIREBASE.collection) || 'respuestasPredeterminadas';
const FIREBASE_AUDIO_STORAGE_PATH = (window.MUSICALA_MESSAGES_FIREBASE && window.MUSICALA_MESSAGES_FIREBASE.audioStoragePath) || 'respuestas-predeterminadas-audios';
const FIREBASE_IMAGE_STORAGE_PATH = (window.MUSICALA_MESSAGES_FIREBASE && window.MUSICALA_MESSAGES_FIREBASE.imageStoragePath) || 'respuestas-predeterminadas-imagenes';
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_TOKEN_LEN = 2;
const MAX_ASSISTANT_RESULTS = 5;
const ASSISTANT_FAVORITES_KEY = 'musicala.assistant.favorites.v1';
const ASSISTANT_RECENTS_KEY = 'musicala.assistant.recents.v1';

/** =========================
 *  STATE
 *  ========================= */
let allMessages = [];
let filtered = [];
let editMode = false;
let isLoading = false;
let isSaving = false;
let modalMode = 'create';
// true solo cuando Firebase respondió y los datos en pantalla son los reales.
let editableSource = false;
// Último error real de lectura de Firebase, para poder explicar el bloqueo.
let firebaseLoadError = null;
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let firebaseStorage = null;
let firebaseUser = null;
let firebaseReady = false;
let currentModalMessage = null;
// true solo si el correo de la sesion es administrador (Alek y Cata por defecto,
// mas quien tenga admin:true en la coleccion `usuarios`). Solo ellos exportan.
let isAdminUser = false;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordedAudioFile = null;
let recordedAudioUrl = '';

/** =========================
 *  DOM
 *  ========================= */
const $ = (sel) => document.querySelector(sel);

const searchInput      = $('#searchInput');
const categorySelect   = $('#categorySelect');
const resultCount      = $('#resultCount');
const tbody            = $('#messageTableBody');
const statusText       = $('#statusText');
const btnReload        = $('#btnReload');
const btnExport        = $('#btnExport');
const btnNew           = $('#btnNew');
const btnSignIn        = $('#btnSignIn');
const btnSignOut       = $('#btnSignOut');
const btnToggleEdit    = $('#btnToggleEdit');
const editStateBadge   = $('#editState');
const toastEl          = $('#toast');

const modalBackdrop    = $('#modalBackdrop');
const modalEl          = $('#modal');
const btnCloseModal    = $('#btnCloseModal');
const btnCancel        = $('#btnCancel');
const form             = $('#messageForm');
const modalTitle       = $('#modalTitle');
const btnSave          = $('#btnSave');
const msgId            = $('#msgId');
const msgCategoria     = $('#msgCategoria');
const msgAtajo         = $('#msgAtajo');
const msgMensaje       = $('#msgMensaje');
const msgAudio         = $('#msgAudio');
const msgRemoveAudio   = $('#msgRemoveAudio');
const currentAudioBox  = $('#currentAudioBox');
const msgImage = $('#msgImage'), msgRemoveImage = $('#msgRemoveImage'), currentImageBox = $('#currentImageBox');
const btnRecordAudio   = $('#btnRecordAudio');
const btnStopRecordAudio = $('#btnStopRecordAudio');
const btnDiscardRecording = $('#btnDiscardRecording');
const recordingStatus  = $('#recordingStatus');
const recordingPreview = $('#recordingPreview');

const assistantInput   = $('#assistantInput');
const btnAskAssistant  = $('#btnAskAssistant');
const btnClearAssistant = $('#btnClearAssistant');
const assistantResults = $('#assistantResults');
const assistantMeta    = $('#assistantMeta');
const assistantPanel   = $('#assistantPanel');
const btnAssistantWidget = $('#btnAssistantWidget');
const btnCloseAssistant = $('#btnCloseAssistant');
const assistantQuickChips = $('#assistantQuickChips');

/** =========================
 *  CONOCIMIENTO LOCAL
 *  =========================
 *  Este bloque no redacta respuestas nuevas. Ayuda a interpretar intención y
 *  encontrar mensajes existentes relacionados con el caso escrito por el usuario.
 */
const KNOWLEDGE_INTENTS = [
  {
    id: 'puntualidad-docente',
    label: 'Puntualidad / llegada tarde de docente',
    keywords: ['profe','profesor','profesora','docente','maestro','maestra','tarde','retraso','llego tarde','llegada tarde','puntualidad','incumplimiento','horario','demora','llegada','entrada'],
    priorityFields: ['docente','puntualidad','llegada','horario','tarde','retraso'],
    reason: 'El caso parece estar relacionado con puntualidad, docentes o llegadas tarde.'
  },
  {
    id: 'pagos-cobranza',
    label: 'Pagos / cartera / cobros',
    keywords: ['pago','pagos','cobro','cobranza','cartera','factura','facturacion','pendiente','mensualidad','mora','recibo','transferencia','consignacion','nequi','daviplata','banco','valor','precio'],
    priorityFields: ['pago','cobro','cartera','factura','pendiente','mensualidad','mora'],
    reason: 'El caso apunta a pagos, saldos, cartera o recordatorios de cobro.'
  },
  {
    id: 'confirmacion-clase',
    label: 'Confirmación de clase o sesión',
    keywords: ['confirmar','confirmacion','clase','sesion','programacion','agenda','horario','asistencia','asistir','recordatorio','hoy','mañana','virtual','sede','hogar'],
    priorityFields: ['confirmar','confirmacion','clase','sesion','programacion','agenda','recordatorio'],
    reason: 'La pregunta parece pedir confirmación o recordatorio de una clase.'
  },
  {
    id: 'cancelacion-reprogramacion',
    label: 'Cancelación / reprogramación',
    keywords: ['cancelar','cancelacion','reprogramar','reprogramacion','aplazar','cambiar','cambio','posponer','inasistencia','no puede','no asistir','recuperar','recuperacion'],
    priorityFields: ['cancelacion','reprogramacion','aplazar','cambiar','recuperar','inasistencia'],
    reason: 'El caso menciona cancelación, cambio de horario o reprogramación.'
  },
  {
    id: 'ventas-info',
    label: 'Ventas / información comercial',
    keywords: ['venta','ventas','informacion','curso','clases','inscripcion','matricula','interesado','interesada','precio','planes','modalidad','sede','hogar','virtual','disponibilidad','cupo','cupos'],
    priorityFields: ['venta','informacion','curso','inscripcion','matricula','planes','modalidad','cupo'],
    reason: 'La consulta parece comercial o de información para un interesado.'
  },
  {
    id: 'seguimiento-lead',
    label: 'Seguimiento a interesados',
    keywords: ['seguimiento','lead','interesado','interesada','cliente','whatsapp','responder','retomar','contactar','preguntar','escribir','cotizacion','cotización'],
    priorityFields: ['seguimiento','interesado','cliente','whatsapp','contactar','cotizacion'],
    reason: 'El caso suena a seguimiento de una persona interesada o posible cliente.'
  },
  {
    id: 'acudientes-familias',
    label: 'Acudientes / familias',
    keywords: ['acudiente','papa','papá','mama','mamá','familia','familias','padres','madre','padre','niño','niña','estudiante','alumno','hijo','hija'],
    priorityFields: ['acudiente','familia','padres','estudiante','niño','niña'],
    reason: 'El caso involucra comunicación con familias, acudientes o estudiantes.'
  },
  {
    id: 'app-soporte',
    label: 'Soporte de app / datos pendientes',
    keywords: ['app','aplicativo','plataforma','bitacora','bitácora','informe','diagnostico','diagnóstico','proyecto','muestra','foto','video','asistencia','datos','registro','actualizar'],
    priorityFields: ['app','bitacora','informe','diagnostico','proyecto','muestra','foto','video','asistencia'],
    reason: 'La pregunta parece relacionada con la app, bitácoras, informes o registros.'
  },
  {
    id: 'queja-molestia',
    label: 'Queja / inconformidad / tono delicado',
    keywords: ['queja','molesto','molesta','inconforme','inconformidad','reclamo','problema','grave','delicado','disgusto','malestar','enojo','enojado','enojada'],
    priorityFields: ['queja','inconformidad','reclamo','problema','malestar','delicado'],
    reason: 'El caso parece requerir una respuesta cuidadosa ante inconformidad o reclamo.'
  },
  {
    id: 'bienvenida',
    label: 'Bienvenida / primer contacto',
    keywords: ['hola','bienvenido','bienvenida','saludo','primer contacto','inicio','empezar','nuevo','nueva','presentacion','presentación'],
    priorityFields: ['hola','bienvenido','bienvenida','saludo','inicio','nuevo'],
    reason: 'La consulta parece de saludo, bienvenida o primer contacto.'
  }
];

const SYNONYM_GROUPS = [
  ['profe','profesor','profesora','docente','maestro','maestra'],
  ['tarde','retraso','demora','puntualidad','llegada','entrada'],
  ['pago','pagos','cobro','cobranza','cartera','factura','mensualidad','mora'],
  ['acudiente','familia','familias','padres','papa','papá','mama','mamá','cliente'],
  ['clase','sesion','sesión','programacion','programación','agenda','horario'],
  ['cancelar','cancelacion','cancelación','reprogramar','reprogramacion','reprogramación','aplazar','posponer','cambiar'],
  ['inscripcion','inscripción','matricula','matrícula','registro','cupo','cupos'],
  ['app','aplicativo','plataforma','sistema'],
  ['bitacora','bitácora','informe','diagnostico','diagnóstico','proyecto','muestra'],
  ['foto','fotos','video','videos','evidencia','evidencias'],
  ['queja','reclamo','inconformidad','molestia','malestar','problema']
];

const STOPWORDS = new Set([
  'que','qué','le','les','la','el','los','las','un','una','uno','unos','unas','de','del','al','a','y','o','en','por','para','con','sin','como','cómo','me','se','su','sus','mi','mis','tu','tus','lo','si','sí','ya','pero','es','son','esta','este','esto','esa','ese','eso','digo','decir','respondo','responder','mensaje','usar','uso','recomienda','recomendar'
].map(normSearch));

/** =========================
 *  UTILS
 *  ========================= */
function debounce(fn, wait = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normSearch(s) {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9ñ\s/_-]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(q, { removeStopwords = false } = {}) {
  const rawTokens = normSearch(q)
    .split(/\s+/)
    .filter(Boolean)
    .filter(tok => tok.length >= MIN_TOKEN_LEN);

  if (!removeStopwords) return rawTokens;
  return rawTokens.filter(tok => !STOPWORDS.has(tok));
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function uniqueByNorm(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const key = normSearch(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setDisabled(el, on) {
  if (!el) return;
  el.disabled = !!on;
  el.setAttribute('aria-disabled', on ? 'true' : 'false');
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

function setAssistantMeta(text) {
  if (assistantMeta) assistantMeta.textContent = text;
}

function toast(msg, kind = 'info') {
  if (!toastEl) return;
  toastEl.textContent = String(msg || '');
  toastEl.classList.remove('show', 'is-ok', 'is-warn', 'is-bad');
  if (kind === 'ok') toastEl.classList.add('is-ok');
  if (kind === 'warn') toastEl.classList.add('is-warn');
  if (kind === 'bad') toastEl.classList.add('is-bad');
  toastEl.classList.add('show');
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function safeMessageToNodes(message) {
  const frag = document.createDocumentFragment();
  const parts = String(message || '').split('\n');
  parts.forEach((p, idx) => {
    frag.appendChild(document.createTextNode(p));
    if (idx < parts.length - 1) frag.appendChild(document.createElement('br'));
  });
  return frag;
}

function getMessageKey(m) {
  return `${normSearch(m?.categoria)}|${normSearch(m?.atajo)}`;
}

function getMessageStorageKey(m) {
  return `${normSearch(m?.categoria)}|${normSearch(m?.atajo)}|${normSearch(m?.mensaje).slice(0, 80)}`;
}

function hasDuplicateMessage({ id, categoria, atajo }) {
  const key = `${normSearch(categoria)}|${normSearch(atajo)}`;
  return allMessages.some(m => String(m.id || '') !== String(id || '') && getMessageKey(m) === key);
}

function mergeMessages(primary, backup) {
  const merged = [];
  const seen = new Set();

  [...(primary || []), ...(backup || [])].forEach(m => {
    if (!m) return;
    const key = `${normSearch(m.categoria)}|${normSearch(m.atajo)}|${normSearch(m.mensaje)}`;
    if (!key.replace(/\|/g, '')) return;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(m);
  });

  return merged;
}

function getProjectKnowledge() {
  const knowledge = window.MUSICALA_PROJECT_KNOWLEDGE;
  return knowledge && typeof knowledge === 'object' ? knowledge : {};
}

function getRealCategories() {
  return uniqueByNorm(allMessages.map(m => (m.categoria || '').trim()).filter(Boolean));
}

function normalizeIntent(intent, source = 'base') {
  return {
    id: String(intent?.id || intent?.label || source).trim(),
    label: String(intent?.label || intent?.id || 'Contexto relacionado').trim(),
    keywords: uniqueByNorm(intent?.keywords || []),
    priorityFields: uniqueByNorm(intent?.priorityFields || intent?.keywords || []),
    reason: intent?.reason || '',
    source
  };
}

// Cache del conocimiento del asistente: es costoso de construir y solo cambia
// cuando cambian los mensajes cargados o el conocimiento del proyecto.
let _knowledgeCache = null;
function invalidateSearchCaches() {
  _knowledgeCache = null;
  _haystackCache = new WeakMap();
}

function buildAssistantKnowledge() {
  if (_knowledgeCache) return _knowledgeCache;
  _knowledgeCache = buildAssistantKnowledgeUncached();
  return _knowledgeCache;
}

function buildAssistantKnowledgeUncached() {
  const project = getProjectKnowledge();
  const projectIntents = Array.isArray(project.intents) ? project.intents : [];
  const projectSynonyms = Array.isArray(project.synonymGroups) ? project.synonymGroups : [];
  const categoryAliases = project.categoryAliases && typeof project.categoryAliases === 'object'
    ? project.categoryAliases
    : {};
  const realCategories = getRealCategories();
  const categoryKeywordGroups = realCategories.map(cat => uniqueByNorm([
    cat,
    ...tokenize(cat),
    ...(categoryAliases[cat] || [])
  ]));

  return {
    project,
    intents: [...KNOWLEDGE_INTENTS.map(i => normalizeIntent(i, 'base')), ...projectIntents.map(i => normalizeIntent(i, 'project'))],
    synonymGroups: [...SYNONYM_GROUPS, ...projectSynonyms, ...categoryKeywordGroups],
    categoryAliases,
    realCategories,
    audiences: project.organization?.audiences || [],
    tone: project.tone || [],
    rules: project.responseRules || [],
    quickSearches: project.quickSearches || []
  };
}

function getCategoryAliases(category) {
  const knowledge = getProjectKnowledge();
  const aliases = knowledge.categoryAliases && typeof knowledge.categoryAliases === 'object'
    ? knowledge.categoryAliases
    : {};
  const catNorm = normSearch(category);
  const out = [];

  Object.entries(aliases).forEach(([canonical, values]) => {
    const group = [canonical, ...(Array.isArray(values) ? values : [])];
    if (group.map(normSearch).includes(catNorm)) out.push(...group);
  });

  return uniqueByNorm(out);
}

function expandTokensWithKnowledge(tokens, knowledge = buildAssistantKnowledge()) {
  const expanded = new Set(tokens);
  for (const tok of tokens) {
    for (const group of knowledge.synonymGroups || []) {
      const normalizedGroup = (group || []).map(normSearch).filter(Boolean);
      if (normalizedGroup.includes(tok)) normalizedGroup.forEach(v => expanded.add(v));
    }
  }
  return Array.from(expanded);
}

function getStorageArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function setStorageArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value || []));
  } catch (_) {}
}

function getFavoriteKeys() {
  return getStorageArray(ASSISTANT_FAVORITES_KEY);
}

function isFavoriteMessage(message) {
  return getFavoriteKeys().includes(getMessageStorageKey(message));
}

function toggleFavoriteMessage(message) {
  const key = getMessageStorageKey(message);
  const favorites = getFavoriteKeys();
  const next = favorites.includes(key) ? favorites.filter(item => item !== key) : [key, ...favorites].slice(0, 80);
  setStorageArray(ASSISTANT_FAVORITES_KEY, next);
  renderQuickChips();
  if (assistantInput && assistantInput.value.trim()) askAssistant();
}

function addRecentMessage(message) {
  if (!message) return;
  const entry = {
    key: getMessageStorageKey(message),
    categoria: message.categoria || '',
    atajo: message.atajo || '',
    mensaje: message.mensaje || '',
    copiedAt: new Date().toISOString()
  };
  const current = getStorageArray(ASSISTANT_RECENTS_KEY).filter(item => item && item.key !== entry.key);
  setStorageArray(ASSISTANT_RECENTS_KEY, [entry, ...current].slice(0, 10));
  renderQuickChips();
}

// Cache por mensaje del haystack normalizado (evita re-normalizar en cada tecla).
let _haystackCache = new WeakMap();
function messageHaystack(m) {
  if (!m || typeof m !== 'object') return buildHaystack(m || {});
  const cached = _haystackCache.get(m);
  if (cached) return cached;
  const built = buildHaystack(m);
  _haystackCache.set(m, built);
  return built;
}

function buildHaystack(m) {
  const cat = normSearch(m.categoria);
  const short = normSearch(m.atajo);
  const msg = normSearch(m.mensaje);
  const aliases = getCategoryAliases(m.categoria).map(normSearch).join(' ');
  return { cat, short, msg, aliases, all: `${cat} ${short} ${msg} ${aliases}` };
}

// `tokens` ya debe venir expandido (expandTokensWithKnowledge) para no rehacer
// el trabajo por cada mensaje. Acepta tokens crudos como respaldo.
function scoreMatch(haystack, tokens, preExpanded = false) {
  let score = 0;
  const expanded = preExpanded ? tokens : expandTokensWithKnowledge(tokens);
  for (const tok of expanded) {
    if (!tok) continue;
    if (!haystack.all.includes(tok)) continue;
    score += 1;
    if (haystack.short.includes(tok)) score += 2;
    if (haystack.cat.includes(tok)) score += 2;
    if (haystack.aliases.includes(tok)) score += 2;
    const re = new RegExp(`\\b${escapeRegExp(tok)}`, 'g');
    if (re.test(haystack.all)) score += 1;
  }
  return score;
}

function lockUI() {
  setDisabled(btnReload, isLoading || isSaving);
  if (btnExport) setDisabled(btnExport, isLoading || isSaving);
  setDisabled(btnSignIn, isLoading || isSaving);
  setDisabled(btnSignOut, isLoading || isSaving);
  setDisabled(btnNew, isLoading || isSaving);
  setDisabled(btnToggleEdit, isLoading || isSaving);
  setDisabled(btnAskAssistant, isLoading || isSaving);
  setDisabled(btnClearAssistant, isLoading || isSaving);

  setDisabled(btnSave, isSaving);
  setDisabled(msgCategoria, isSaving);
  setDisabled(msgAtajo, isSaving);
  setDisabled(msgMensaje, isSaving);
  setDisabled(msgAudio, isSaving);
  setDisabled(msgRemoveAudio, isSaving || !(currentModalMessage && currentModalMessage.audio && currentModalMessage.audio.url));
  setRecordingControls(mediaRecorder && mediaRecorder.state === 'recording');
}

function setSavingButton(on) {
  if (!btnSave) return;
  if (on) {
    btnSave.dataset.originalText = btnSave.textContent || 'Guardar';
    btnSave.textContent = 'Guardando…';
    return;
  }
  const fallback = modalMode === 'edit' ? 'Guardar cambios' : 'Crear mensaje';
  btnSave.textContent = btnSave.dataset.originalText || fallback;
  delete btnSave.dataset.originalText;
}

function initAssistantAvatars() {
  document.querySelectorAll('.assistant-avatar-img').forEach(img => {
    img.addEventListener('error', () => {
      img.closest('.assistant-avatar, .assistant-fab-avatar')?.classList.add('avatar-failed');
    }, { once: true });
    img.addEventListener('load', () => {
      img.closest('.assistant-avatar, .assistant-fab-avatar')?.classList.remove('avatar-failed');
    }, { once: true });
    if (img.complete && img.naturalWidth === 0) {
      img.closest('.assistant-avatar, .assistant-fab-avatar')?.classList.add('avatar-failed');
    }
  });
}

/** =========================
 *  API HELPERS
 *  ========================= */
function ensureFirebaseReady() {
  if (!window.firebase || !window.MUSICALA_FIREBASE_CONFIG) {
    throw new Error('Firebase no está cargado. Revisa firebase-config.js y los scripts del SDK.');
  }

  if (!firebaseApp) {
    firebaseApp = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(window.MUSICALA_FIREBASE_CONFIG);
    firebaseAuth = window.firebase.auth();
    firebaseDb = window.firebase.firestore();
    firebaseStorage = window.firebase.storage();

    // Sesión persistente entre recargas y pestañas. Sin esto, algunos
    // navegadores (Edge/Safari con cookies de terceros restringidas)
    // pierden la sesión al recargar y la app cae a solo lectura.
    try {
      firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL)
        .catch((err) => console.warn('No se pudo fijar la persistencia de sesión:', err));
    } catch (err) {
      console.warn('No se pudo fijar la persistencia de sesión:', err);
    }
  }

  return { auth: firebaseAuth, db: firebaseDb, storage: firebaseStorage };
}

function updateAuthButton() {
  const signedIn = !!(firebaseUser && firebaseUser.email);

  if (btnSignIn) {
    if (signedIn) {
      btnSignIn.textContent = firebaseUser.email;
      btnSignIn.title = editableSource
        ? 'Sesión iniciada. Puedes editar los mensajes.'
        : 'Sesión iniciada, pero este correo no tiene permiso de edición.';
      btnSignIn.classList.toggle('is-signed-in', true);
    } else {
      btnSignIn.textContent = 'Entrar con Google';
      btnSignIn.title = 'Iniciar sesión para editar desde Firebase';
      btnSignIn.classList.toggle('is-signed-in', false);
    }
  }

  if (btnSignOut) btnSignOut.hidden = !signedIn;
}

/** Cierra sesión y vuelve a cargar para que la vista refleje el estado real. */
async function signOutFromFirebase() {
  const { auth } = ensureFirebaseReady();
  await auth.signOut();
  firebaseUser = null;
  firebaseReady = false;
  isAdminUser = false;
  updateExportButton();
  updateAuthButton();
  toast('Sesión cerrada.', 'ok');
}

async function signInToFirebaseIfNeeded({ interactive = false } = {}) {
  const { auth } = ensureFirebaseReady();
  if (auth.currentUser) {
    firebaseUser = auth.currentUser;
    firebaseReady = true;
    updateAuthButton();
    return firebaseUser;
  }

  await new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged((user) => {
      unsub();
      resolve(user || null);
    });
  });

  if (auth.currentUser) {
    firebaseUser = auth.currentUser;
    firebaseReady = true;
    updateAuthButton();
    return firebaseUser;
  }

  if (!interactive) {
    updateAuthButton();
    throw new Error('Inicia sesión con Google para cargar los mensajes de Firebase.');
  }

  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let result;
  try {
    result = await auth.signInWithPopup(provider);
  } catch (err) {
    const code = String(err && err.code || '');
    // Si el navegador bloquea la ventana emergente, seguimos por redirección.
    const popupFallo = code === 'auth/popup-blocked'
      || code === 'auth/popup-closed-by-user'
      || code === 'auth/cancelled-popup-request'
      || code === 'auth/operation-not-supported-in-this-environment';
    if (!popupFallo) throw err;
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Cerraste la ventana de Google antes de terminar. Intenta de nuevo.');
    }
    await auth.signInWithRedirect(provider);
    // La página se recarga; el resultado se recoge con getRedirectResult al iniciar.
    return null;
  }

  firebaseUser = result.user;
  firebaseReady = true;
  updateAuthButton();
  return firebaseUser;
}

function messagesCollection() {
  const { db } = ensureFirebaseReady();
  return db.collection(FIREBASE_MESSAGES_COLLECTION);
}

function audioStorageRef(messageId, fileName) {
  return attachmentStorageRef(FIREBASE_AUDIO_STORAGE_PATH, messageId, fileName);
}
function imageStorageRef(messageId, fileName) { return attachmentStorageRef(FIREBASE_IMAGE_STORAGE_PATH, messageId, fileName); }
function attachmentStorageRef(basePath, messageId, fileName) {
  const { storage } = ensureFirebaseReady();
  const safeName = String(fileName || 'audio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
  const stamp = Date.now();
  return storage.ref().child(`${basePath}/${messageId}/${stamp}-${safeName}`);
}

function cleanMessagePayload(payload = {}) {
  return {
    categoria: String(payload.categoria || '').trim(),
    atajo: String(payload.atajo || '').trim(),
    mensaje: String(payload.mensaje || '').trim()
  };
}

function validateMessagePayload(payload = {}, requireId = false) {
  const id = String(payload.id || '').trim();
  const data = cleanMessagePayload(payload);
  if (requireId && !id) throw new Error('Falta id del mensaje.');
  if (!data.categoria) throw new Error('Falta categoría.');
  if (!data.atajo) throw new Error('Falta atajo.');
  if (!data.mensaje) throw new Error('Falta mensaje.');
  return { id, ...data };
}

function firebaseMessageFromDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    categoria: String(data.categoria || '').trim(),
    atajo: String(data.atajo || '').trim(),
    mensaje: String(data.mensaje || '').trim(),
    activo: data.activo !== false,
    archivado: data.archivado === true,
    tipo: data.tipo || 'texto',
    audio: data.audio || null, image: data.image || null
  };
}

async function findDuplicateDoc(categoria, atajo, excludeId = '') {
  const wantedCat = normSearch(categoria);
  const wantedAtajo = normSearch(atajo);
  // Sin filtro de 'archivado' en el servidor: los documentos antiguos no tienen
  // ese campo y Firestore los excluiría de la consulta.
  const snap = await messagesCollection()
    .where('key', '==', `${wantedCat}||${wantedAtajo}`)
    .limit(10)
    .get();

  let duplicate = null;
  snap.forEach((doc) => {
    if (duplicate || doc.id === excludeId) return;
    if ((doc.data() || {}).archivado === true) return;
    duplicate = doc;
  });
  return duplicate;
}

async function apiGetList() {
  await signInToFirebaseIfNeeded({ interactive: false });
  // Traemos todo y filtramos aquí: los documentos sin campo 'archivado'
  // (los importados antes de que existiera) no aparecen en un where del servidor.
  const snap = await messagesCollection().get();
  const messages = [];
  snap.forEach((doc) => {
    const msg = firebaseMessageFromDoc(doc);
    if (!msg.archivado) messages.push(msg);
  });
  return messages;
}

async function apiPost(action, payload) {
  await signInToFirebaseIfNeeded({ interactive: true });
  const now = window.firebase.firestore.FieldValue.serverTimestamp();

  if (action === 'create') {
    const data = validateMessagePayload(payload, false);
    const duplicate = await findDuplicateDoc(data.categoria, data.atajo);
    if (duplicate) {
      throw new Error('Ya existe un mensaje activo con esa categoría y ese atajo. Edita el existente.');
    }
    const ref = await messagesCollection().add({
      categoria: data.categoria,
      atajo: data.atajo,
      mensaje: data.mensaje,
      key: `${normSearch(data.categoria)}||${normSearch(data.atajo)}`,
      tipo: 'texto',
      activo: true,
      archivado: false,
      createdAt: now,
      updatedAt: now,
      createdBy: firebaseUser ? firebaseUser.email : '',
      updatedBy: firebaseUser ? firebaseUser.email : ''
    });
    return { id: ref.id };
  }

  if (action === 'update') {
    const data = validateMessagePayload(payload, true);
    const duplicate = await findDuplicateDoc(data.categoria, data.atajo, data.id);
    if (duplicate) throw new Error('Ya existe otro mensaje activo con esa categoría y ese atajo.');
    const ref = messagesCollection().doc(data.id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
    await ref.update({
      categoria: data.categoria,
      atajo: data.atajo,
      mensaje: data.mensaje,
      key: `${normSearch(data.categoria)}||${normSearch(data.atajo)}`,
      activo: true,
      archivado: false,
      updatedAt: now,
      updatedBy: firebaseUser ? firebaseUser.email : ''
    });
    return { id: data.id };
  }

  if (action === 'archive') {
    const id = String(payload && payload.id || '').trim();
    if (!id) throw new Error('Falta id del mensaje.');
    const ref = messagesCollection().doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
    await ref.update({
      activo: false,
      archivado: true,
      updatedAt: now,
      updatedBy: firebaseUser ? firebaseUser.email : ''
    });
    return { id, archived: true };
  }

  if (action === 'setActive') {
    const id = String(payload && payload.id || '').trim();
    if (!id) throw new Error('Falta id del mensaje.');
    const activo = payload && payload.activo === true;
    const ref = messagesCollection().doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
    await ref.update({
      activo,
      updatedAt: now,
      updatedBy: firebaseUser ? firebaseUser.email : ''
    });
    return { id, activo };
  }

  if (action === 'setAudio') {
    const id = String(payload && payload.id || '').trim();
    if (!id) throw new Error('Falta id del mensaje.');
    const ref = messagesCollection().doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
    await ref.update({
      audio: payload && payload.audio ? payload.audio : null,
      tipo: payload && payload.audio ? 'mixto' : 'texto',
      updatedAt: now,
      updatedBy: firebaseUser ? firebaseUser.email : ''
    });
    return { id, audio: payload && payload.audio ? payload.audio : null };
  }
  if (action === 'setImage') { const id = String(payload && payload.id || '').trim(); const ref = messagesCollection().doc(id); const doc = await ref.get(); if (!doc.exists) throw new Error('No se encontró el mensaje.'); const image = payload && payload.image ? payload.image : null; await ref.update({ image, tipo: (image || (doc.data() || {}).audio) ? 'mixto' : 'texto', updatedAt: now, updatedBy: firebaseUser ? firebaseUser.email : '' }); return { id, image }; }

  throw new Error('Acción no soportada: ' + action);
}

function validateAudioFile(file) {
  if (!file) return;
  if (!String(file.type || '').startsWith('audio/')) {
    throw new Error('El archivo seleccionado no parece ser audio.');
  }
  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    throw new Error('El audio supera 25 MB. Usa una nota de voz mas corta o comprimida.');
  }
}

async function uploadAudioForMessage(messageId, file) {
  validateAudioFile(file);
  const ref = audioStorageRef(messageId, file.name);
  const snap = await ref.put(file, {
    contentType: file.type || 'audio/mpeg',
    customMetadata: {
      messageId,
      uploadedBy: firebaseUser ? firebaseUser.email || '' : ''
    }
  });
  const url = await snap.ref.getDownloadURL();
  return {
    url,
    path: snap.ref.fullPath,
    name: file.name || 'audio',
    contentType: file.type || 'audio/mpeg',
    size: file.size || 0,
    uploadedAt: new Date().toISOString(),
    uploadedBy: firebaseUser ? firebaseUser.email || '' : ''
  };
}

async function deleteAudioByPath(path) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return;
  try {
    const { storage } = ensureFirebaseReady();
    await storage.ref().child(cleanPath).delete();
  } catch (err) {
    console.warn('No se pudo borrar el audio anterior:', err);
  }
}
async function uploadImageForMessage(messageId, file) { if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > MAX_IMAGE_SIZE_BYTES) throw new Error('La imagen debe ser JPG, PNG, WEBP o GIF y pesar máximo 10 MB.'); const ref = imageStorageRef(messageId, file.name); const snap = await ref.put(file, { contentType: file.type }); return { url: await snap.ref.getDownloadURL(), path: snap.ref.fullPath, name: file.name, contentType: file.type, size: file.size }; }

function setRecordingStatus(text) {
  if (recordingStatus) recordingStatus.textContent = text;
}

function setRecordingControls(recording = false) {
  if (btnRecordAudio) btnRecordAudio.hidden = recording;
  if (btnStopRecordAudio) btnStopRecordAudio.hidden = !recording;
  if (btnDiscardRecording) btnDiscardRecording.hidden = !recordedAudioFile;
  setDisabled(btnRecordAudio, isSaving || recording);
  setDisabled(btnStopRecordAudio, isSaving || !recording);
  setDisabled(btnDiscardRecording, isSaving || !recordedAudioFile);
}

function stopRecordingStream() {
  if (recordingStream) {
    recordingStream.getTracks().forEach(track => track.stop());
  }
  recordingStream = null;
}

function clearRecordedAudio() {
  if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
  recordedAudioUrl = '';
  recordedAudioFile = null;
  recordingChunks = [];
  if (recordingPreview) {
    recordingPreview.removeAttribute('src');
    recordingPreview.hidden = true;
  }
  setRecordingStatus('También puedes grabar el audio aquí mismo.');
  setRecordingControls(false);
}

function getSupportedRecordingMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg'
  ];
  if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) return '';
  return candidates.find(type => window.MediaRecorder.isTypeSupported(type)) || '';
}

function recordedExtension(type) {
  if (String(type || '').includes('mp4')) return 'm4a';
  if (String(type || '').includes('mpeg')) return 'mp3';
  return 'webm';
}

function downloadFileNameForAudio(message, audio) {
  const base = [
    'musicala',
    normSearch(message && message.atajo ? message.atajo : 'nota-voz').replace(/[^a-z0-9]+/g, '-'),
    normSearch(message && message.categoria ? message.categoria : '').replace(/[^a-z0-9]+/g, '-')
  ].filter(Boolean).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const original = String(audio && audio.name || '');
  const extMatch = original.match(/\.([a-z0-9]{2,5})$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'webm';
  return `${base || 'musicala-nota-voz'}.${ext}`;
}

async function startAudioRecording() {
  if (isSaving) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    toast('Este navegador no permite grabar audio desde la app.', 'warn');
    return;
  }

  try {
    clearRecordedAudio();
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getSupportedRecordingMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream);
    recordingChunks = [];

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) recordingChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', () => {
      const type = mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : 'audio/webm';
      const blob = new Blob(recordingChunks, { type });
      const ext = recordedExtension(type);
      recordedAudioFile = new File([blob], `nota-voz-${Date.now()}.${ext}`, { type });
      recordedAudioUrl = URL.createObjectURL(blob);
      if (recordingPreview) {
        recordingPreview.src = recordedAudioUrl;
        recordingPreview.hidden = false;
      }
      stopRecordingStream();
      mediaRecorder = null;
      if (msgAudio) msgAudio.value = '';
      setRecordingStatus('Grabación lista. Escúchala antes de guardar.');
      setRecordingControls(false);
    });

    mediaRecorder.start();
    setRecordingStatus('Grabando... habla cerca del micrófono.');
    setRecordingControls(true);
  } catch (err) {
    console.error(err);
    stopRecordingStream();
    mediaRecorder = null;
    setRecordingControls(false);
    toast('No pude activar el micrófono. Revisa permisos del navegador.', 'bad');
  }
}

function stopAudioRecording() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  setRecordingStatus('Procesando grabación...');
  setRecordingControls(false);
}

function renderCurrentAudio(audio) {
  if (!currentAudioBox) return;
  currentAudioBox.innerHTML = '';
  if (!audio || !audio.url) {
    currentAudioBox.hidden = true;
    if (msgRemoveAudio) {
      msgRemoveAudio.checked = false;
      msgRemoveAudio.disabled = true;
    }
    return;
  }

  const label = document.createElement('div');
  label.className = 'current-audio-label';
  label.textContent = `Audio actual: ${audio.name || 'nota de voz'}`;

  const player = document.createElement('audio');
  player.controls = true;
  player.preload = 'metadata';
  player.src = audio.url;

  currentAudioBox.appendChild(label);
  currentAudioBox.appendChild(player);
  currentAudioBox.hidden = false;
  if (msgRemoveAudio) msgRemoveAudio.disabled = false;
}

/** =========================
 *  MODAL
 *  ========================= */
function openModal(mode, data = null) {
  if (!modalBackdrop || !modalEl) return;

  modalMode = mode === 'edit' ? 'edit' : 'create';
  currentModalMessage = data || null;
  modalTitle.textContent = modalMode === 'edit' ? 'Editar mensaje' : 'Nuevo mensaje';
  if (btnSave) btnSave.textContent = modalMode === 'edit' ? 'Guardar cambios' : 'Crear mensaje';

  msgId.value        = data?.id || '';
  msgCategoria.value = data?.categoria || '';
  msgAtajo.value     = data?.atajo || '';
  msgMensaje.value   = data?.mensaje || '';
  if (msgAudio) msgAudio.value = '';
  if (msgRemoveAudio) msgRemoveAudio.checked = false;
  clearRecordedAudio();
  renderCurrentAudio(data?.audio || null);

  modalBackdrop.hidden = false;
  modalEl.hidden = false;

  window.setTimeout(() => {
    const target = (msgCategoria && !msgCategoria.value) ? msgCategoria : msgAtajo;
    if (target) target.focus();
  }, 50);
}

function resetModalState() {
  if (!modalBackdrop || !modalEl) return;
  modalBackdrop.hidden = true;
  modalEl.hidden = true;
  if (form) form.reset();
  if (msgId) msgId.value = '';
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  stopRecordingStream();
  currentModalMessage = null;
  clearRecordedAudio();
  renderCurrentAudio(null);
  modalMode = 'create';
  if (btnSave) btnSave.textContent = 'Crear mensaje';
}

function closeModal({ force = false } = {}) {
  if (!modalBackdrop || !modalEl) return;
  if (isSaving && !force) return;
  resetModalState();
}

/** =========================
 *  EDIT MODE
 *  ========================= */
function setEditMode(on) {
  editMode = !!on;
  if (editStateBadge) editStateBadge.textContent = editMode ? 'ON' : 'OFF';
  if (btnToggleEdit) {
    btnToggleEdit.classList.toggle('is-on', editMode);
    btnToggleEdit.setAttribute('aria-pressed', String(editMode));
  }
  render();
}

/** =========================
 *  FILTERS / RENDER TABLA
 *  ========================= */
function populateCategoryFilter() {
  if (!categorySelect) return;
  const current = categorySelect.value;
  categorySelect.innerHTML = '';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Todas';
  categorySelect.appendChild(first);

  const cats = Array.from(new Set(allMessages.map(m => (m.categoria || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  for (const cat of cats) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  }

  if (cats.includes(current)) categorySelect.value = current;
}

function applyFilters() {
  const rawQ = searchInput ? searchInput.value : '';
  const tokens = tokenize(rawQ, { removeStopwords: true });
  // Para INCLUIR un mensaje exigimos que aparezcan todas las palabras escritas
  // (AND): así el buscador se va afinando a medida que escribes, en vez de
  // mostrar todo por culpa de los sinónimos. Los sinónimos solo sirven para
  // ordenar por relevancia.
  const expandedTokens = expandTokensWithKnowledge(tokens);
  const cat = (categorySelect ? categorySelect.value : '').trim();

  if (tokens.length) {
    // Calcula el score una sola vez por mensaje y reutilízalo al ordenar.
    const scored = [];
    for (const m of allMessages) {
      if (cat && (m.categoria || '').trim() !== cat) continue;
      const h = messageHaystack(m);
      if (!tokens.every(tok => h.all.includes(tok))) continue;
      const score = scoreMatch(h, expandedTokens, true);
      if (score > 0) scored.push({ m, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const c = (a.m.categoria || '').localeCompare(b.m.categoria || '', 'es', { sensitivity: 'base' });
      if (c !== 0) return c;
      return (a.m.atajo || '').localeCompare(b.m.atajo || '', 'es', { sensitivity: 'base' });
    });
    filtered = scored.map(entry => entry.m);
  } else {
    filtered = allMessages
      .filter(m => !cat || (m.categoria || '').trim() === cat)
      .sort(sortMessages);
  }
}

function sortMessages(a, b) {
  const c = (a.categoria || '').localeCompare(b.categoria || '', 'es', { sensitivity: 'base' });
  if (c !== 0) return c;
  return (a.atajo || '').localeCompare(b.atajo || '', 'es', { sensitivity: 'base' });
}

function renderEmpty() {
  if (!tbody) return;
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 4;
  td.style.padding = '18px';

  const span = document.createElement('span');
  span.style.color = '#6B7280';
  // Sin datos y sin conexión no es lo mismo que "no hay resultados":
  // decirlo mal fue justo lo que hizo que se editara sobre una copia vieja.
  span.textContent = (!editableSource && !allMessages.length)
    ? `No se están mostrando mensajes. ${readOnlyReason()}`
    : 'No hay resultados. Prueba otra búsqueda o categoría.';
  td.appendChild(span);

  tr.appendChild(td);
  tbody.appendChild(tr);
}

function render() {
  if (!tbody || !resultCount) return;
  applyFilters();
  // Fuera de modo edición ocultamos la columna de acciones para no dejar una
  // franja de 260px en blanco a la derecha de cada fila.
  const tableEl = tbody.closest('table');
  if (tableEl) tableEl.classList.toggle('hide-actions', !editMode);
  tbody.innerHTML = '';
  resultCount.textContent = String(filtered.length);

  if (filtered.length === 0) {
    renderEmpty();
    return;
  }

  for (const m of filtered) {
    const tr = document.createElement('tr');
    const disabled = m.activo === false;
    if (disabled) tr.classList.add('row-disabled');

    const tdCat = document.createElement('td');
    tdCat.textContent = m.categoria || '';
    tr.appendChild(tdCat);

    const tdAtajo = document.createElement('td');
    tdAtajo.textContent = m.atajo || '';
    if (disabled) {
      const badge = document.createElement('span');
      badge.className = 'badge-off';
      badge.textContent = 'Inhabilitado';
      tdAtajo.appendChild(badge);
    }
    tr.appendChild(tdAtajo);

    const tdMsg = document.createElement('td');
    const msgWrap = document.createElement('div');
    msgWrap.className = 'message-text';
    msgWrap.appendChild(safeMessageToNodes(m.mensaje || ''));
    if (m.image && m.image.url) { const wrap=document.createElement('div'), link=document.createElement('a'), img=document.createElement('img'); wrap.className='message-image'; link.href=m.image.url; link.target='_blank'; link.rel='noopener noreferrer'; img.src=m.image.url; img.alt='Imagen adjunta'; img.loading='lazy'; link.appendChild(img); wrap.appendChild(link); msgWrap.appendChild(wrap); }

    if (m.audio && m.audio.url) {
      const audioWrap = document.createElement('div');
      audioWrap.className = 'message-audio';

      const audioLabel = document.createElement('div');
      audioLabel.className = 'message-audio-label';
      audioLabel.textContent = m.audio.name || 'Nota de voz';

      const player = document.createElement('audio');
      player.controls = true;
      player.preload = 'metadata';
      player.src = m.audio.url;

      const downloadLink = document.createElement('a');
      downloadLink.className = 'audio-download-btn';
      downloadLink.href = m.audio.url;
      downloadLink.download = downloadFileNameForAudio(m, m.audio);
      downloadLink.textContent = 'Descargar para WhatsApp';

      const helper = document.createElement('div');
      helper.className = 'message-audio-helper';
      helper.textContent = 'Descárgalo y arrástralo a WhatsApp Web.';

      audioWrap.appendChild(audioLabel);
      audioWrap.appendChild(player);
      audioWrap.appendChild(downloadLink);
      audioWrap.appendChild(helper);
      msgWrap.appendChild(audioWrap);
    }

    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'copy-btn';
    btnCopy.textContent = 'Copiar';
    btnCopy.addEventListener('click', () => copyMessage(m.mensaje || '', m));

    tdMsg.appendChild(msgWrap);
    tdMsg.appendChild(btnCopy);
    tr.appendChild(tdMsg);

    const tdAct = document.createElement('td');
    tdAct.className = 'col-actions';

    if (editMode) {
      const actionWrap = document.createElement('div');
      actionWrap.className = 'row-actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-ghost btn-compact';
      btnEdit.textContent = 'Editar';
      btnEdit.addEventListener('click', () => {
        // Avisamos antes de que escriban, no después de perder el trabajo.
        if (!requireEditableSource()) return;
        if (!m.id) {
          toast('Este mensaje no tiene ID. Revisa Firebase o recarga la fuente.', 'bad');
          return;
        }
        openModal('edit', m);
      });

      const btnToggle = document.createElement('button');
      btnToggle.type = 'button';
      btnToggle.className = 'btn btn-ghost btn-compact';
      btnToggle.textContent = disabled ? 'Habilitar' : 'Inhabilitar';
      btnToggle.addEventListener('click', () => setMessageActive(m, disabled));

      const btnArch = document.createElement('button');
      btnArch.type = 'button';
      btnArch.className = 'btn btn-danger btn-compact';
      btnArch.textContent = 'Archivar';
      btnArch.addEventListener('click', () => archiveMessage(m));

      if (isLoading || isSaving) {
        btnEdit.disabled = true;
        btnToggle.disabled = true;
        btnArch.disabled = true;
      }

      actionWrap.appendChild(btnEdit);
      actionWrap.appendChild(btnToggle);
      actionWrap.appendChild(btnArch);
      tdAct.appendChild(actionWrap);
    } else {
      const muted = document.createElement('span');
      muted.className = 'muted';
      muted.textContent = '—';
      tdAct.appendChild(muted);
    }

    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
}

/** =========================
 *  MUSIASISTENTE LOCAL
 *  ========================= */
function expandTokens(tokens) {
  return expandTokensWithKnowledge(tokens);
}

function detectIntents(queryTokens, rawQuery, knowledge = buildAssistantKnowledge()) {
  const queryNorm = normSearch(rawQuery);
  const expanded = expandTokensWithKnowledge(queryTokens, knowledge);

  return knowledge.intents
    .map(intent => {
      const normalizedKeywords = (intent.keywords || []).map(normSearch);
      let score = 0;
      const matched = [];

      for (const kw of normalizedKeywords) {
        if (!kw) continue;
        const kwTokens = kw.split(/\s+/).filter(Boolean);
        const phraseMatch = kw.includes(' ') && queryNorm.includes(kw);
        const tokenMatch = kwTokens.every(t => expanded.includes(t) || queryNorm.includes(t));
        if (phraseMatch || tokenMatch) {
          score += phraseMatch ? 4 : 2;
          matched.push(kw);
        }
      }

      return { ...intent, score, matched: unique(matched) };
    })
    .filter(intent => intent.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function detectCaseContext(query, intents = []) {
  const q = normSearch(query);
  const hit = words => words.some(w => q.includes(normSearch(w)));
  const labels = [];
  const guide = {
    type: 'Caso general',
    audience: 'Por definir',
    tone: 'Claro, cercano y respetuoso.',
    recommended: intents[0]?.label || 'Usar el mensaje mas cercano de la base.',
    review: ['nombre de la persona', 'datos especificos del caso']
  };

  if (hit(['venta', 'comercial', 'interesado', 'cliente', 'cotizacion', 'precio', 'inscripcion', 'matricula'])) labels.push('Caso comercial');
  if (hit(['pago', 'cartera', 'factura', 'mora', 'mensualidad', 'cuenta de cobro'])) labels.push('Caso administrativo');
  if (hit(['clase', 'docente', 'estudiante', 'academico', 'bitacora', 'diagnostico', 'asistencia'])) labels.push('Caso academico');
  if (hit(['queja', 'reclamo', 'inconformidad', 'molesto', 'grave', 'delicado', 'malestar'])) labels.push('Delicado');
  if (hit(['urgente', 'ya', 'hoy', 'inmediato', 'emergencia', 'prioritario'])) labels.push('Urgente');
  if (hit(['interno', 'equipo', 'coordinacion', 'asistente', 'reporte', 'protocolo'])) labels.push('Interno');
  if (hit(['familia', 'acudiente', 'mama', 'papa', 'padre', 'madre'])) labels.push('Acudiente/familia');
  if (hit(['docente', 'profe', 'profesor', 'profesora'])) labels.push('Docente');
  if (hit(['estudiante', 'alumno', 'nino', 'nina', 'joven'])) labels.push('Estudiante');
  if (hit(['empresa', 'aliado', 'fsa', 'colegio', 'jardin', 'fondo'])) labels.push('Empresa/aliado');
  if (!labels.some(label => ['Interno', 'Docente'].includes(label))) labels.push('Externo');

  const topIntent = intents[0]?.id || '';
  if (topIntent.includes('queja') || labels.includes('Delicado')) {
    guide.type = 'Reclamo / inconformidad';
    guide.tone = 'Responder con empatia, no discutir y no prometer solucion sin validar.';
    guide.review = ['estudiante', 'sede', 'fecha', 'docente involucrado', 'antecedentes del caso'];
  } else if (topIntent.includes('pago') || labels.includes('Caso administrativo')) {
    guide.type = 'Cartera / pago pendiente';
    guide.tone = 'Cordial, claro y firme, sin sonar agresivo.';
    guide.review = ['valor', 'fecha limite', 'medio de pago', 'estado real de cartera'];
  } else if (topIntent.includes('docente') || hit(['docente enfermo', 'profe enfermo', 'llego tarde', 'ausencia docente'])) {
    guide.type = 'Reemplazo / novedad docente';
    guide.tone = labels.includes('Interno') ? 'Interno, claro y rapido.' : 'Sereno y cuidadoso con la informacion.';
    guide.review = ['horario', 'sede', 'grupo o estudiante', 'disponibilidad de reemplazo'];
  } else if (topIntent.includes('venta') || labels.includes('Caso comercial')) {
    guide.type = 'Informacion comercial / seguimiento';
    guide.tone = 'Cercano, claro y orientado a resolver la duda sin presionar de mas.';
    guide.review = ['modalidad', 'edad', 'area artistica', 'sede o ciudad', 'datos que faltan'];
  }

  if (labels.includes('Acudiente/familia')) guide.audience = 'Familia / acudiente';
  else if (labels.includes('Docente')) guide.audience = 'Docente';
  else if (labels.includes('Estudiante')) guide.audience = 'Estudiante';
  else if (labels.includes('Empresa/aliado')) guide.audience = 'Empresa / aliado';

  return { labels: unique(labels), guide };
}

function getPlaceholders(text) {
  const value = String(text || '');
  const patterns = [
    /\[Nombre\]/gi,
    /\[Nombre del estudiante\]/gi,
    /\[Nombre del docente\]/gi,
    /\*Estudiante\*/gi,
    /\*Docente\*/gi,
    /\[Fecha\]/gi,
    /\[Hora\]/gi,
    /\[Sede\]/gi,
    /\[Valor\]/gi,
    /\[Link\]/gi
  ];
  return unique(patterns.flatMap(re => value.match(re) || []));
}

function formatForWhatsApp(text) {
  return String(text || '').replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '*$1*');
}

function scoreAssistantMessage(message, tokens, intents, context, knowledge = buildAssistantKnowledge(), rawQuery = '') {
  const h = messageHaystack(message);
  const expanded = expandTokensWithKnowledge(tokens, knowledge);
  const queryNorm = normSearch(rawQuery);
  let score = 0;
  const reasons = [];

  for (const tok of expanded) {
    if (!tok || STOPWORDS.has(tok)) continue;
    if (h.short.includes(tok)) {
      score += 6;
      reasons.push(`atajo: ${tok}`);
    }
    if (h.cat.includes(tok)) {
      score += 5;
      reasons.push(`categoria: ${tok}`);
    }
    if (h.aliases.includes(tok)) {
      score += 4;
      reasons.push(`alias: ${tok}`);
    }
    if (h.msg.includes(tok)) {
      score += 2;
      reasons.push(`mensaje: ${tok}`);
    }
  }

  for (const intent of intents) {
    let intentHits = 0;
    const fields = [...(intent.priorityFields || []), ...(intent.keywords || [])].map(normSearch);
    for (const kw of fields) {
      if (!kw) continue;
      if (h.cat.includes(kw)) intentHits += 4;
      if (h.short.includes(kw)) intentHits += 4;
      if (h.aliases.includes(kw)) intentHits += 3;
      if (h.msg.includes(kw)) intentHits += 1;
    }
    if (intentHits > 0) {
      score += intentHits + intent.score;
      reasons.push(intent.label);
    }
  }

  const queryPhraseBoost = tokens.join(' ');
  if (queryPhraseBoost && h.all.includes(queryPhraseBoost)) {
    score += 8;
    reasons.push('frase casi literal');
  }

  const meaningfulPhrases = queryNorm
    .split(/\s+(?:y|o|para|con|de|a|que)\s+/)
    .filter(p => p.length > 8);
  meaningfulPhrases.forEach(phrase => {
    if (phrase && h.all.includes(phrase)) {
      score += 5;
      reasons.push('frase completa');
    }
  });

  for (const audience of knowledge.audiences || []) {
    const a = normSearch(audience);
    if (a && queryNorm.includes(a) && h.all.includes(a)) {
      score += 3;
      reasons.push(`publico: ${audience}`);
    }
  }

  if (context.labels.includes('Urgente') && /urgente|emergencia|hoy|inmediato|prioritario/.test(h.all)) {
    score += 5;
    reasons.push('urgencia');
  }
  if (context.labels.includes('Delicado') && /queja|reclamo|inconformidad|disculpa|lamentamos|validar|coordinacion/.test(h.all)) {
    score += 6;
    reasons.push('tono delicado');
  }

  return { score, reasons: unique(reasons).slice(0, 4) };
}

function assistantSearch(query) {
  const baseTokens = tokenize(query, { removeStopwords: true });
  const knowledge = buildAssistantKnowledge();
  const intents = detectIntents(baseTokens, query, knowledge);
  const context = detectCaseContext(query, intents);

  if (!baseTokens.length && !intents.length) {
    return { intents, results: [], tokens: baseTokens, context, knowledge };
  }

  const scored = allMessages
    .filter(message => message.activo !== false)
    .map(message => {
      const scoring = scoreAssistantMessage(message, baseTokens, intents, context, knowledge, query);
      return { message, score: scoring.score, reasons: scoring.reasons };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return sortMessages(a.message, b.message);
    })
    .slice(0, MAX_ASSISTANT_RESULTS);

  return { intents, results: scored, tokens: baseTokens, context, knowledge };
}
function clearAssistantResults() {
  if (assistantInput) assistantInput.value = '';
  if (assistantResults) assistantResults.innerHTML = '';
  setAssistantMeta('Escribe un caso para ver sugerencias basadas en los mensajes cargados.');
  if (assistantInput) assistantInput.focus();
}

function setAssistantOpen(isOpen) {
  if (!assistantPanel || !btnAssistantWidget) return;
  assistantPanel.hidden = !isOpen;
  btnAssistantWidget.hidden = isOpen;
  btnAssistantWidget.setAttribute('aria-expanded', String(isOpen));

  if (isOpen && assistantInput) {
    setTimeout(() => assistantInput.focus(), 0);
  } else if (!isOpen) {
    btnAssistantWidget.focus();
  }
}

function toggleAssistant() {
  setAssistantOpen(!!assistantPanel && assistantPanel.hidden);
}

function renderAssistantEmpty(text) {
  if (!assistantResults) return;
  assistantResults.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'assistant-empty';
  div.textContent = text;
  assistantResults.appendChild(div);
}

function getFavoriteMessages() {
  const keys = new Set(getFavoriteKeys());
  return allMessages.filter(m => m.activo !== false && keys.has(getMessageStorageKey(m)));
}

function getRecentMessages() {
  return getStorageArray(ASSISTANT_RECENTS_KEY).map(item => ({
    id: '',
    categoria: item.categoria || '',
    atajo: item.atajo || '',
    mensaje: item.mensaje || '',
    activo: true
  })).filter(m => m.categoria || m.atajo || m.mensaje);
}

function renderSavedAssistantList(title, messages) {
  if (!assistantResults) return;
  assistantResults.innerHTML = '';
  setAssistantMeta(`${title}: ${messages.length} mensaje(s) guardados localmente.`);
  if (!messages.length) {
    renderAssistantEmpty(title === 'Favoritos'
      ? 'Todavia no hay favoritos. Marca mensajes recomendados para tenerlos a mano.'
      : 'Todavia no hay recientes. Los ultimos mensajes copiados apareceran aqui.');
    return;
  }
  renderAssistantResults({
    intents: [],
    tokens: ['guardados'],
    context: { labels: [title], guide: { type: title, audience: 'Uso interno', tone: 'Revisar datos antes de enviar.', recommended: 'Mensajes guardados localmente', review: ['placeholders', 'datos del caso'] } },
    results: messages.map(message => ({ message, score: 20, reasons: [title] })),
    knowledge: buildAssistantKnowledge()
  });
}

function renderQuickChips() {
  if (!assistantQuickChips) return;
  const knowledge = buildAssistantKnowledge();
  const base = knowledge.quickSearches.length ? knowledge.quickSearches : [
    { label: 'Favoritos', query: '__favorites__' },
    { label: 'Recientes', query: '__recent__' },
    { label: 'Ventas', query: 'ventas informacion comercial interesado' },
    { label: 'Pagos', query: 'recordar pago pendiente cartera' },
    { label: 'Reprogramacion', query: 'cancelar reprogramar recuperar clase' },
    { label: 'Docentes', query: 'docente profe reemplazo tarde enfermo' },
    { label: 'FSA', query: 'FSA empresa aliado fondo empleados' },
    { label: 'Vacacionales', query: 'vacacionales talleres informacion' }
  ];
  assistantQuickChips.innerHTML = '';
  base.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      if (!assistantInput) return;
      assistantInput.value = item.query;
      askAssistant();
    });
    assistantQuickChips.appendChild(btn);
  });
}

function renderAssistantGuide(context, topMessage) {
  const guide = context?.guide;
  if (!assistantResults || !guide) return;

  const box = document.createElement('section');
  box.className = 'assistant-guide';

  const title = document.createElement('h2');
  title.textContent = 'Guia rapida para responder';
  box.appendChild(title);

  const rows = [
    ['Tipo de caso', guide.type],
    ['A quien va dirigido', guide.audience],
    ['Cuidado de tono', guide.tone],
    ['Mensaje recomendado', topMessage ? `${topMessage.categoria || 'Sin categoria'} - ${topMessage.atajo || 'Sin atajo'}` : guide.recommended],
    ['Que revisar antes de enviar', (guide.review || []).join(', ')]
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.appendChild(strong);
    row.appendChild(document.createTextNode(value || 'Por definir'));
    box.appendChild(row);
  });

  assistantResults.appendChild(box);
}

function createMessageSimilar(message) {
  const baseAtajo = String(message?.atajo || 'mensaje similar').trim();
  openModal('create', {
    categoria: message?.categoria || '',
    atajo: `${baseAtajo} similar`.slice(0, 90),
    mensaje: message?.mensaje || ''
  });
  if (modalTitle) modalTitle.textContent = 'Crear mensaje similar';
  if (btnSave) btnSave.textContent = 'Crear mensaje';
}

function renderAssistantResults(payload) {
  if (!assistantResults) return;
  assistantResults.innerHTML = '';

  const { intents, results, tokens, context } = payload;

  if (!allMessages.length) {
    renderAssistantEmpty('Primero hay que cargar mensajes. Sin base de conocimiento, MusiAsistente no tiene de donde recomendar.');
    return;
  }

  if (!tokens.length && !intents.length) {
    renderAssistantEmpty('Escribe un caso un poco mas especifico. Por ejemplo: "profe llego tarde", "recordar pago" o "confirmar clase".');
    return;
  }

  if (!results.length) {
    const intentLabel = intents.length ? ` Detecte posible contexto: ${intents.map(i => i.label).join(', ')}.` : '';
    renderAssistantEmpty(`No encontre un mensaje exacto en la base cargada.${intentLabel} Crea un mensaje predeterminado para este caso y luego el asistente podra recomendarlo.`);
    return;
  }

  const contextLabels = context?.labels?.length ? context.labels : ['Coincidencias de texto'];
  const intentLabels = intents.map(i => i.label).slice(0, 2);
  const summaryParts = [...contextLabels, ...intentLabels].slice(0, 4);
  setAssistantMeta(`Contexto detectado: ${summaryParts.join(' · ')}. ${results.length} sugerencias encontradas.`);
  renderAssistantGuide(context, results[0]?.message);

  for (const item of results) {
    const { message, score, reasons } = item;
    const card = document.createElement('article');
    card.className = 'recommendation-card';

    const top = document.createElement('div');
    top.className = 'recommendation-top';

    const title = document.createElement('h3');
    title.className = 'recommendation-title';
    title.textContent = `${message.categoria || 'Sin categoria'} · ${message.atajo || 'Sin atajo'}`;

    const scorePill = document.createElement('span');
    scorePill.className = 'score-pill';
    scorePill.textContent = `Afinidad ${Math.min(99, Math.max(1, Math.round(score * 3)))}%`;

    top.appendChild(title);
    top.appendChild(scorePill);

    const badges = document.createElement('div');
    badges.className = 'assistant-badges';
    [...(context?.labels || []), ...reasons].slice(0, 5).forEach(label => {
      const badge = document.createElement('span');
      badge.className = 'assistant-badge';
      badge.textContent = label;
      badges.appendChild(badge);
    });

    const reason = document.createElement('p');
    reason.className = 'recommendation-reason';
    reason.textContent = reasons.length
      ? `Recomendado por: ${reasons.join(', ')}.`
      : 'Recomendado por coincidencia general con tu busqueda.';

    const body = document.createElement('div');
    body.className = 'recommendation-message';
    body.appendChild(safeMessageToNodes(message.mensaje || ''));

    const placeholders = getPlaceholders(message.mensaje || '');
    let placeholderNote = null;
    if (placeholders.length) {
      placeholderNote = document.createElement('div');
      placeholderNote.className = 'placeholder-alert';
      placeholderNote.textContent = 'Este mensaje tiene datos por completar antes de enviarlo.';
    }

    const actions = document.createElement('div');
    actions.className = 'recommendation-actions';

    const favoriteBtn = document.createElement('button');
    favoriteBtn.type = 'button';
    favoriteBtn.className = 'btn btn-ghost';
    favoriteBtn.textContent = isFavoriteMessage(message) ? 'Favorito' : 'Marcar favorito';
    favoriteBtn.addEventListener('click', () => toggleFavoriteMessage(message));

    const draftBtn = document.createElement('button');
    draftBtn.type = 'button';
    draftBtn.className = 'btn btn-ghost';
    draftBtn.textContent = 'Editar antes de copiar';
    draftBtn.addEventListener('click', () => openDraftModal(message));

    const similarBtn = document.createElement('button');
    similarBtn.type = 'button';
    similarBtn.className = 'btn btn-ghost';
    similarBtn.textContent = 'Crear mensaje similar';
    similarBtn.addEventListener('click', () => createMessageSimilar(message));

    const locateBtn = document.createElement('button');
    locateBtn.type = 'button';
    locateBtn.className = 'btn btn-ghost';
    locateBtn.textContent = 'Ver en tabla';
    locateBtn.addEventListener('click', () => focusMessageInTable(message));

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-primary';
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', () => copyMessage(message.mensaje || '', message));

    actions.appendChild(favoriteBtn);
    actions.appendChild(draftBtn);
    actions.appendChild(locateBtn);
    actions.appendChild(similarBtn);
    actions.appendChild(copyBtn);

    card.appendChild(top);
    card.appendChild(badges);
    card.appendChild(reason);
    card.appendChild(body);
    if (placeholderNote) card.appendChild(placeholderNote);
    card.appendChild(actions);
    assistantResults.appendChild(card);
  }
}

function askAssistant() {
  const query = (assistantInput ? assistantInput.value : '').trim();
  if (!query) {
    renderAssistantEmpty('Escribe el caso primero. Todavia necesito texto para recomendar bien.');
    return;
  }
  if (query === '__favorites__') {
    renderSavedAssistantList('Favoritos', getFavoriteMessages());
    return;
  }
  if (query === '__recent__') {
    renderSavedAssistantList('Recientes', getRecentMessages());
    return;
  }
  const payload = assistantSearch(query);
  renderAssistantResults(payload);
}
function openDraftModal(message) {
  modalMode = 'draft';
  modalTitle.textContent = 'Editar antes de copiar';
  if (btnSave) btnSave.textContent = 'Copiar borrador';

  msgId.value = '';
  msgCategoria.value = message?.categoria || '';
  msgAtajo.value = message?.atajo || '';
  msgMensaje.value = message?.mensaje || '';

  modalBackdrop.hidden = false;
  modalEl.hidden = false;
  window.setTimeout(() => msgMensaje?.focus(), 50);
}

function focusMessageInTable(message) {
  if (!message) return;
  if (searchInput) searchInput.value = message.atajo || message.categoria || '';
  if (categorySelect) categorySelect.value = '';
  render();
  document.querySelector('.table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** =========================
 *  ACTIONS
 *  ========================= */
async function copyMessage(text, message = null) {
  const value = formatForWhatsApp(text);
  try {
    await navigator.clipboard.writeText(value);
    if (message) addRecentMessage(message);
    toast('Mensaje copiado ✅', 'ok');
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      if (message) addRecentMessage(message);
      toast('Mensaje copiado ✅', 'ok');
    } catch (e2) {
      alert('No pude copiar el mensaje. Tu navegador eligió drama.');
    }
  }
}

/** =========================
 *  EXPORTAR (SOLO ADMINS)
 *  ========================= */
// Respaldo de arranque, igual que en firestore.rules: si la coleccion
// `usuarios` falla, Alek y Cata siguen siendo admins.
const ADMIN_EMAILS_BASE = [
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com'
];

/**
 * Averigua si el correo de la sesion es admin y muestra u oculta el boton
 * de exportar. La consulta a `usuarios/{correo}` esta permitida por las
 * reglas para el propio correo, asi que no rompe a nadie mas.
 */
async function refreshAdminStatus() {
  const email = String(firebaseUser && firebaseUser.email || '').trim().toLowerCase();
  let admin = !!email && ADMIN_EMAILS_BASE.includes(email);

  if (email && !admin) {
    try {
      const { db } = ensureFirebaseReady();
      const doc = await db.collection('usuarios').doc(email).get();
      const data = doc.exists ? (doc.data() || {}) : {};
      admin = data.activo !== false && data.admin === true;
    } catch (err) {
      console.warn('No se pudo verificar el perfil de administrador:', err);
    }
  }

  isAdminUser = admin;
  updateExportButton();
  return admin;
}

function updateExportButton() {
  if (!btnExport) return;
  btnExport.hidden = !isAdminUser;
  setDisabled(btnExport, isLoading || isSaving);
}

/** Descarga un JSON en el navegador sin depender de servidor. */
function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Exporta TODO lo guardado en Firestore (incluidos archivados e inactivos),
 * tal cual esta en la base, para tener un respaldo real.
 */
async function exportMessagesJson() {
  if (isLoading || isSaving) return;
  if (!(await refreshAdminStatus())) {
    toast('Solo los administradores pueden exportar la base.', 'warn');
    return;
  }

  try {
    setStatus('Preparando exportación…');
    setDisabled(btnExport, true);

    const snap = await messagesCollection().get();
    const mensajes = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const plano = {};
      Object.keys(data).forEach((k) => {
        const v = data[k];
        // Las marcas de tiempo de Firestore no sobreviven a JSON.stringify.
        plano[k] = (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : v;
      });
      mensajes.push({ id: doc.id, ...plano });
    });

    mensajes.sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || ''), 'es')
      || String(a.atajo || '').localeCompare(String(b.atajo || ''), 'es'));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadJson(`mensajes-predeterminados-${stamp}.json`, {
      exportadoEn: new Date().toISOString(),
      exportadoPor: firebaseUser ? firebaseUser.email : '',
      coleccion: FIREBASE_MESSAGES_COLLECTION,
      total: mensajes.length,
      mensajes
    });

    setStatus(`Exportados ${mensajes.length} mensajes en JSON.`);
    toast(`Exportados ${mensajes.length} mensajes.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('No se pudo exportar.');
    toast(String(err.message || err), 'bad');
  } finally {
    updateExportButton();
  }
}

async function load() {
  if (isLoading) return;
  isLoading = true;
  lockUI();
  setStatus('Cargando mensajes…');
  setAssistantMeta('Cargando base de conocimiento…');

  try {
    let messages = [];

    // Firebase es la única fuente. Si no responde no mostramos nada: es
    // preferible una pantalla vacía a una copia vieja que parece la verdad.
    try {
      messages = await apiGetList();
      editableSource = true;
      firebaseLoadError = null;
    } catch (err) {
      console.error('No se pudo leer Firebase:', err);
      firebaseLoadError = err;
      editableSource = false;
      messages = [];
    }

    allMessages = messages
      .filter(m => m)
      .map(m => ({
        id: String(m.id || '').trim(),
        categoria: String(m.categoria || '').trim(),
        atajo: String(m.atajo || '').trim(),
        mensaje: String(m.mensaje || '').trim(),
        activo: m.activo !== false,
        audio: m.audio && m.audio.url ? m.audio : null, image: m.image && m.image.url ? m.image : null
      }))
      .filter(m => m.categoria || m.atajo || m.mensaje)
      .sort(sortMessages);

    invalidateSearchCaches();
    populateCategoryFilter();
    renderQuickChips();
    render();
    if (assistantResults && assistantResults.children.length) askAssistant();

    updateAuthButton();
    refreshAdminStatus();

    if (!editableSource) {
      setStatus(`Sin conexión con la base. ${readOnlyReason()}`);
      setAssistantMeta('Sin conexión con la base: no puedo recomendar mensajes.');
    } else {
      setStatus(`Cargado: ${allMessages.length} mensajes desde Firebase.`);
      setAssistantMeta(`Base oficial lista: ${allMessages.length} mensajes disponibles para recomendar.`);
    }
  } catch (err) {
    console.error(err);
    setStatus('Error cargando.');
    setAssistantMeta('No pude cargar la base de mensajes. Revisa Firebase Auth, Firestore o permisos.');
    toast(String(err.message || err), 'bad');
  } finally {
    isLoading = false;
    lockUI();
  }
}

/**
 * Explica por qué no hay datos editables en pantalla: sin sesión, sin permiso
 * o sin conexión. No existe respaldo: si Firebase no responde, no se ve nada.
 */
function readOnlyReason() {
  const code = String(firebaseLoadError && firebaseLoadError.code || '');
  if (!firebaseUser) {
    return 'Inicia sesión con Google para ver los mensajes.';
  }
  if (code === 'permission-denied') {
    return `Firebase está negando el acceso a ${firebaseUser.email}. Pide que agreguen tu cuenta a los editores de mensajes.`;
  }
  const detalle = firebaseLoadError ? ` (${firebaseLoadError.message || firebaseLoadError})` : '';
  return `No se pudo conectar con la base${detalle}. Usa Recargar para reintentar.`;
}

function requireEditableSource() {
  if (editableSource) return true;
  toast(readOnlyReason(), 'warn');
  return false;
}

async function saveFromModal() {
  if (isSaving) return;

  const id = (msgId ? msgId.value : '').trim();
  const categoria = (msgCategoria ? msgCategoria.value : '').trim();
  const atajo = (msgAtajo ? msgAtajo.value : '').trim();
  const mensaje = (msgMensaje ? msgMensaje.value : '').trim();
  const selectedAudioFile = msgAudio && msgAudio.files && msgAudio.files[0] ? msgAudio.files[0] : null;
  const audioFile = selectedAudioFile || recordedAudioFile;
  const shouldRemoveAudio = !!(msgRemoveAudio && msgRemoveAudio.checked);
  const imageFile = msgImage && msgImage.files && msgImage.files[0] ? msgImage.files[0] : null;
  const shouldRemoveImage = !!(msgRemoveImage && msgRemoveImage.checked);

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    toast('Detén la grabación antes de guardar.', 'warn');
    return;
  }

  if (modalMode === 'draft') {
    if (!mensaje) {
      toast('El borrador está vacío.', 'warn');
      return;
    }
    await copyMessage(mensaje);
    closeModal();
    return;
  }

  if (!categoria || !atajo || !mensaje) {
    toast('Completa categoría, atajo y mensaje.', 'warn');
    return;
  }

  try {
    if (audioFile) validateAudioFile(audioFile);
    if (imageFile && (!/^image\/(jpeg|png|webp|gif)$/.test(imageFile.type) || imageFile.size > MAX_IMAGE_SIZE_BYTES)) throw new Error('La imagen debe ser JPG, PNG, WEBP o GIF y pesar máximo 10 MB.');
  } catch (err) {
    toast(String(err.message || err), 'bad');
    return;
  }

  if (!requireEditableSource()) return;

  if (modalMode === 'edit' && !id) {
    toast('No se puede editar: este mensaje no tiene ID. Revisa la fuente de datos.', 'bad');
    return;
  }

  if (hasDuplicateMessage({ id, categoria, atajo })) {
    toast('Ya existe un mensaje con esa categoría y ese atajo. Edita el existente.', 'warn');
    return;
  }

  isSaving = true;
  setSavingButton(true);
  lockUI();
  setStatus(audioFile ? 'Guardando y subiendo audio…' : 'Guardando cambios…');

  try {
    let savedId = id;
    if (id) {
      await apiPost('update', { id, categoria, atajo, mensaje });
      toast('Mensaje actualizado ✅', 'ok');
    } else {
      const created = await apiPost('create', { categoria, atajo, mensaje });
      savedId = created && created.id ? created.id : '';
      toast('Mensaje creado ✅', 'ok');
    }

    if (audioFile && savedId) {
      if (currentModalMessage && currentModalMessage.audio && currentModalMessage.audio.path) {
        await deleteAudioByPath(currentModalMessage.audio.path);
      }
      const audio = await uploadAudioForMessage(savedId, audioFile);
      await apiPost('setAudio', { id: savedId, audio });
      toast('Mensaje y audio guardados ✅', 'ok');
    } else if (shouldRemoveAudio && savedId) {
      if (currentModalMessage && currentModalMessage.audio && currentModalMessage.audio.path) {
        await deleteAudioByPath(currentModalMessage.audio.path);
      }
      await apiPost('setAudio', { id: savedId, audio: null });
      toast('Audio quitado ✅', 'ok');
    }
    if (imageFile && savedId) { const image = await uploadImageForMessage(savedId, imageFile); await apiPost('setImage', { id: savedId, image }); }
    else if (shouldRemoveImage && savedId) { await apiPost('setImage', { id: savedId, image: null }); }

    isSaving = false;
    setSavingButton(false);
    closeModal();
    await load();
  } catch (err) {
    console.error(err);
    setStatus('Error guardando.');
    toast(String(err.message || err), 'bad');
  } finally {
    isSaving = false;
    setSavingButton(false);
    lockUI();
  }
}

async function setMessageActive(m, active) {
  if (!requireEditableSource()) return;
  if (!m || !m.id) {
    toast('No encuentro el ID para cambiar el estado. Revisa la fuente de datos.', 'bad');
    return;
  }
  if (isSaving) return;

  isSaving = true;
  lockUI();
  setStatus(active ? 'Habilitando…' : 'Inhabilitando…');

  // Reflejo optimista para que se sienta inmediato.
  m.activo = active;
  render();

  try {
    await apiPost('setActive', { id: m.id, activo: active });
    toast(active ? 'Mensaje habilitado ✅' : 'Mensaje inhabilitado 🚫', 'ok');
    await load();
  } catch (err) {
    console.error(err);
    m.activo = !active; // revertir
    render();
    setStatus('Error cambiando el estado.');
    toast(String(err.message || err), 'bad');
  } finally {
    isSaving = false;
    lockUI();
  }
}

async function archiveMessage(m) {
  if (!requireEditableSource()) return;
  if (!m || !m.id) {
    toast('No encuentro el ID para archivar. Revisa la fuente de datos.', 'bad');
    return;
  }
  if (isSaving) return;

  const ok = confirm(`¿Archivar este mensaje?\n\n[${m.categoria}] ${m.atajo}`);
  if (!ok) return;

  isSaving = true;
  lockUI();
  setStatus('Archivando…');

  try {
    await apiPost('archive', { id: m.id });
    toast('Mensaje archivado ✅', 'ok');
    await load();
  } catch (err) {
    console.error(err);
    setStatus('Error archivando.');
    toast(String(err.message || err), 'bad');
  } finally {
    isSaving = false;
    lockUI();
  }
}

/** =========================
 *  EVENTS
 *  ========================= */
function wireEvents() {
  if (searchInput) {
    const rerender = debounce(() => render(), 90);
    searchInput.addEventListener('input', rerender);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        render();
      }
    });
  }

  if (categorySelect) categorySelect.addEventListener('change', () => render());
  if (btnReload) btnReload.addEventListener('click', () => load());
  if (btnExport) btnExport.addEventListener('click', () => exportMessagesJson());

  if (btnSignIn) {
    btnSignIn.addEventListener('click', async () => {
      if (isLoading || isSaving) return;
      try {
        setStatus('Conectando con Firebase…');
        const user = await signInToFirebaseIfNeeded({ interactive: true });
        // Con redirección devuelve null y la página se recarga sola.
        if (user) await load();
      } catch (err) {
        console.error(err);
        setStatus('No se pudo iniciar sesión.');
        toast(String(err.message || err), 'bad');
      }
    });
  }

  if (btnSignOut) {
    btnSignOut.addEventListener('click', async () => {
      if (isLoading || isSaving) return;
      try {
        await signOutFromFirebase();
        await load();
      } catch (err) {
        console.error(err);
        toast(String(err.message || err), 'bad');
      }
    });
  }

  if (btnRecordAudio) btnRecordAudio.addEventListener('click', startAudioRecording);
  if (btnStopRecordAudio) btnStopRecordAudio.addEventListener('click', stopAudioRecording);
  if (btnDiscardRecording) btnDiscardRecording.addEventListener('click', clearRecordedAudio);
  if (msgAudio) {
    msgAudio.addEventListener('change', () => {
      if (msgAudio.files && msgAudio.files[0]) clearRecordedAudio();
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      if (isLoading || isSaving) return;
      if (!requireEditableSource()) return;
      if (!editMode) setEditMode(true);
      openModal('create');
    });
  }

  if (btnToggleEdit) btnToggleEdit.addEventListener('click', () => setEditMode(!editMode));

  if (btnAskAssistant) btnAskAssistant.addEventListener('click', askAssistant);
  if (btnClearAssistant) btnClearAssistant.addEventListener('click', clearAssistantResults);
  if (btnAssistantWidget) btnAssistantWidget.addEventListener('click', toggleAssistant);
  if (btnCloseAssistant) btnCloseAssistant.addEventListener('click', () => setAssistantOpen(false));
  if (assistantInput) {
    assistantInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askAssistant();
      }
    });
  }

  document.querySelectorAll('[data-example]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!assistantInput) return;
      assistantInput.value = btn.dataset.example || '';
      askAssistant();
    });
  });

  if (btnCloseModal) btnCloseModal.addEventListener('click', () => closeModal({ force: true }));
  if (btnCancel) btnCancel.addEventListener('click', () => closeModal({ force: true }));
  if (modalBackdrop) modalBackdrop.addEventListener('click', () => closeModal({ force: true }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal({ force: true });
    else if (e.key === 'Escape' && assistantPanel && !assistantPanel.hidden) setAssistantOpen(false);
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFromModal();
    });
  }

}

/** =========================
 *  INIT
 *  ========================= */
(function init(){
  resetModalState();
  initAssistantAvatars();
  wireEvents();
  renderQuickChips();
  setEditMode(false);
  lockUI();

  let authArrancado = false;
  let ultimoUid = null;

  try {
    const { auth } = ensureFirebaseReady();

    // Si el inicio de sesión se hizo por redirección, recogemos el resultado.
    auth.getRedirectResult().catch((err) => {
      console.warn('No se pudo completar el inicio de sesión por redirección:', err);
    });

    // Una sola fuente de verdad: cada cambio de sesión recarga los datos.
    auth.onAuthStateChanged((user) => {
      firebaseUser = user || null;
      firebaseReady = !!user;
      const uid = user ? user.uid : null;
      updateAuthButton();

      if (!authArrancado) {
        authArrancado = true;
        ultimoUid = uid;
        load();
        return;
      }
      if (uid !== ultimoUid) {
        ultimoUid = uid;
        load();
      }
    });
  } catch (err) {
    console.warn('Firebase no quedó listo al iniciar:', err);
    authArrancado = true;
    load();
  }
})();
