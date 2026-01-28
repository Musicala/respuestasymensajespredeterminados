/* ============================================================================
  app.js — Mensajes Predeterminados · Musicala (Ruta A) — PRO (FIX POST + SEARCH)
  -----------------------------------------------------------------------------
  - Carga desde Apps Script (JSON)
  - Búsqueda en vivo + filtro categoría (con debounce)
    * case-insensitive
    * acento-insensitive
    * multi-palabra por tokens (orden libre)
    * orden por relevancia (score)
  - Copiar mensaje (robusto)
  - CRUD básico:
      create (modal)
      update (modal)
      archive (botón)
  - Modo edición ON/OFF (solo UI)
  - FIX CLAVE: POST sin preflight (Content-Type text/plain)
  - Robustez: timeout, lock de acciones, mejor manejo de errores
============================================================================ */

'use strict';

/** =========================
 *  CONFIG
 *  ========================= */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxI42hKsyafe6CwWS_38i1RHdt3SPq8kXI3-f8f4DvJyRaoC4PXHeydgtF-bjYCLkEydA/exec';
const API_KEY = 'MUSICALA_MSGS_2026';
const HTTP_TIMEOUT_MS = 15000;

// Búsqueda: tokens muy cortos tienden a meter ruido ("a", "y", "de")
const MIN_TOKEN_LEN = 2;

/** =========================
 *  STATE
 *  ========================= */
let allMessages = [];      // [{id,categoria,atajo,mensaje,...}]
let filtered = [];
let editMode = false;

let isLoading = false;
let isSaving = false;

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
const btnNew           = $('#btnNew');
const btnToggleEdit    = $('#btnToggleEdit');
const editStateBadge   = $('#editState');

const toastEl          = $('#toast');

const modalBackdrop    = $('#modalBackdrop');
const modalEl          = $('#modal');
const btnCloseModal    = $('#btnCloseModal');
const btnCancel        = $('#btnCancel');
const form             = $('#messageForm');
const modalTitle       = $('#modalTitle');

const msgId            = $('#msgId');
const msgCategoria     = $('#msgCategoria');
const msgAtajo         = $('#msgAtajo');
const msgMensaje       = $('#msgMensaje');

const logoFab          = document.querySelector('.logo-fab');

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

function setDisabled(el, on) {
  if (!el) return;
  el.disabled = !!on;
  el.setAttribute('aria-disabled', on ? 'true' : 'false');
}

function lockUI() {
  // Bloquea acciones que disparan fetch
  setDisabled(btnReload, isLoading || isSaving);
  setDisabled(btnNew,    isLoading || isSaving);
  setDisabled(btnToggleEdit, isLoading || isSaving);

  // Modal submit
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  setDisabled(submitBtn, isSaving);

  // Inputs modal
  setDisabled(msgCategoria, isSaving);
  setDisabled(msgAtajo,     isSaving);
  setDisabled(msgMensaje,   isSaving);
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

function toast(msg, kind = 'info') {
  if (!toastEl) return;

  toastEl.textContent = String(msg || '');

  // kind: info | ok | warn | bad
  toastEl.classList.remove('show', 'is-ok', 'is-warn', 'is-bad');
  if (kind === 'ok') toastEl.classList.add('is-ok');
  if (kind === 'warn') toastEl.classList.add('is-warn');
  if (kind === 'bad') toastEl.classList.add('is-bad');

  toastEl.classList.add('show');
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function safeMessageToNodes(message) {
  // Render seguro: convierte \n en <br> SIN innerHTML
  const frag = document.createDocumentFragment();
  const parts = String(message || '').split('\n');
  parts.forEach((p, idx) => {
    frag.appendChild(document.createTextNode(p));
    if (idx < parts.length - 1) frag.appendChild(document.createElement('br'));
  });
  return frag;
}

/** =========================
 *  SEARCH HELPERS (nuevo)
 *  ========================= */
function stripDiacritics(s) {
  // "público" -> "publico"
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normSearch(s) {
  // minúsculas + sin tildes + trim
  return stripDiacritics(s).toLowerCase().trim();
}

function tokenize(q) {
  // tokens por espacios, filtra vacíos y tokens muy cortos
  return normSearch(q)
    .split(/\s+/)
    .filter(Boolean)
    .filter(tok => tok.length >= MIN_TOKEN_LEN);
}

function scoreMatch(haystack, tokens) {
  // Score simple:
  // +2 si token aparece en atajo (suele ser más “intención”)
  // +1 si aparece en categoría o mensaje
  // Extra: +1 si aparece al inicio de palabra (mejor “feeling”)
  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (!haystack.all.includes(tok)) continue;

    score += 1;
    if (haystack.short.includes(tok)) score += 1;

    // inicio de palabra en cualquier campo
    const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    if (re.test(haystack.all)) score += 1;
  }
  return score;
}

/** =========================
 *  API HELPERS
 *  ========================= */
function apiUrl(action) {
  const u = new URL(WEB_APP_URL);
  u.searchParams.set('action', action);
  u.searchParams.set('key', API_KEY);
  return u.toString();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  } catch (err) {
    const msg = (err && err.name === 'AbortError')
      ? `Se demoró mucho (>${Math.round(HTTP_TIMEOUT_MS/1000)}s). Intenta de nuevo.`
      : String(err && err.message ? err.message : err);
    throw new Error(msg);
  } finally {
    clearTimeout(to);
  }
}

async function apiGetList() {
  const data = await fetchJson(apiUrl('list'), { method: 'GET' });
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) ? data.error : 'Error cargando mensajes');
  }
  return data.data || [];
}

async function apiPost(action, payload) {
  // FIX CLAVE: evitar preflight (CORS) desde GitHub Pages
  const data = await fetchJson(apiUrl(action), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload || {})
  });

  if (!data || data.ok !== true) {
    throw new Error((data && data.error) ? data.error : 'Error en la operación');
  }
  return data.data;
}

/** =========================
 *  MODAL
 *  ========================= */
function openModal(mode, data = null) {
  if (!modalBackdrop || !modalEl) return;

  modalTitle.textContent = (mode === 'edit') ? 'Editar mensaje' : 'Nuevo mensaje';

  msgId.value        = data?.id || '';
  msgCategoria.value = data?.categoria || '';
  msgAtajo.value     = data?.atajo || '';
  msgMensaje.value   = data?.mensaje || '';

  modalBackdrop.hidden = false;
  modalEl.hidden = false;

  window.setTimeout(() => {
    const target = (msgCategoria && !msgCategoria.value) ? msgCategoria : msgAtajo;
    if (target) target.focus();
  }, 50);
}

function closeModal() {
  if (!modalBackdrop || !modalEl) return;
  modalBackdrop.hidden = true;
  modalEl.hidden = true;
  if (form) form.reset();
  if (msgId) msgId.value = '';
}

/** =========================
 *  EDIT MODE
 *  ========================= */
function setEditMode(on) {
  editMode = !!on;
  if (editStateBadge) {
    editStateBadge.textContent = editMode ? 'ON' : 'OFF';
    editStateBadge.style.background = editMode ? 'rgba(22,163,74,.15)' : 'rgba(0,0,0,.06)';
    editStateBadge.style.color = editMode ? '#166534' : '#111827';
  }
  render();
}

/** =========================
 *  FILTERS / RENDER
 *  ========================= */
function populateCategoryFilter() {
  if (!categorySelect) return;

  const keepFirst = categorySelect.querySelector('option[value=""]');
  categorySelect.innerHTML = '';
  if (keepFirst) categorySelect.appendChild(keepFirst);

  const cats = Array.from(new Set(
    allMessages.map(m => (m.categoria || '').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  for (const cat of cats) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  }
}

function applyFilters() {
  const rawQ = searchInput ? searchInput.value : '';
  const tokens = tokenize(rawQ);
  const cat = (categorySelect ? categorySelect.value : '').trim();

  if (!tokens.length && !cat) {
    filtered = allMessages.slice();
    return;
  }

  // Filtra por tokens (todas las palabras) y categoría
  filtered = allMessages.filter(m => {
    const c = normSearch(m.categoria);
    const a = normSearch(m.atajo);
    const t = normSearch(m.mensaje);

    const all = `${c} ${a} ${t}`;

    const matchesText = tokens.length === 0
      ? true
      : tokens.every(tok => all.includes(tok)); // todas las palabras, en cualquier orden

    const matchesCat = !cat || (m.categoria || '').trim() === cat;

    return matchesText && matchesCat;
  });

  // Orden por relevancia si hay query
  if (tokens.length) {
    filtered.sort((m1, m2) => {
      const h1 = {
        cat: normSearch(m1.categoria),
        short: normSearch(m1.atajo),
        msg: normSearch(m1.mensaje),
      };
      h1.all = `${h1.cat} ${h1.short} ${h1.msg}`;

      const h2 = {
        cat: normSearch(m2.categoria),
        short: normSearch(m2.atajo),
        msg: normSearch(m2.mensaje),
      };
      h2.all = `${h2.cat} ${h2.short} ${h2.msg}`;

      const s1 = scoreMatch(h1, tokens);
      const s2 = scoreMatch(h2, tokens);

      if (s2 !== s1) return s2 - s1;

      // desempate: categoría, luego atajo
      const c = (m1.categoria || '').localeCompare(m2.categoria || '', 'es', { sensitivity: 'base' });
      if (c !== 0) return c;
      return (m1.atajo || '').localeCompare(m2.atajo || '', 'es', { sensitivity: 'base' });
    });
  }
}

function renderEmpty() {
  if (!tbody) return;
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 4;
  td.style.padding = '18px';

  const span = document.createElement('span');
  span.style.color = '#6B7280';
  span.textContent = 'No hay resultados. Prueba otra búsqueda o categoría.';
  td.appendChild(span);

  tr.appendChild(td);
  tbody.appendChild(tr);
}

function render() {
  if (!tbody || !resultCount) return;

  applyFilters();

  tbody.innerHTML = '';
  resultCount.textContent = String(filtered.length);

  if (filtered.length === 0) {
    renderEmpty();
    return;
  }

  for (const m of filtered) {
    const tr = document.createElement('tr');

    // Categoría
    const tdCat = document.createElement('td');
    tdCat.textContent = m.categoria || '';
    tr.appendChild(tdCat);

    // Atajo
    const tdAtajo = document.createElement('td');
    tdAtajo.textContent = m.atajo || '';
    tr.appendChild(tdAtajo);

    // Mensaje + copiar
    const tdMsg = document.createElement('td');

    const msgWrap = document.createElement('div');
    msgWrap.appendChild(safeMessageToNodes(m.mensaje || ''));

    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'copy-btn';
    btnCopy.textContent = 'Copiar';
    btnCopy.addEventListener('click', () => copyMessage(m.mensaje || ''));

    tdMsg.appendChild(msgWrap);
    tdMsg.appendChild(btnCopy);
    tr.appendChild(tdMsg);

    // Acciones
    const tdAct = document.createElement('td');
    tdAct.className = 'col-actions';

    if (editMode) {
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-ghost';
      btnEdit.style.padding = '7px 10px';
      btnEdit.style.borderRadius = '12px';
      btnEdit.textContent = 'Editar';
      btnEdit.addEventListener('click', () => openModal('edit', m));

      const btnArch = document.createElement('button');
      btnArch.type = 'button';
      btnArch.className = 'btn btn-ghost';
      btnArch.style.padding = '7px 10px';
      btnArch.style.borderRadius = '12px';
      btnArch.style.marginLeft = '8px';
      btnArch.textContent = 'Archivar';
      btnArch.addEventListener('click', () => archiveMessage(m));

      if (isLoading || isSaving) {
        btnEdit.disabled = true;
        btnArch.disabled = true;
      }

      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnArch);
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
 *  ACTIONS
 *  ========================= */
async function copyMessage(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
    toast('¡Mensaje copiado!', 'ok');
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
      toast('¡Mensaje copiado!', 'ok');
    } catch (e2) {
      alert('No pude copiar el mensaje. Tu navegador se puso exquisito.');
    }
  }
}

async function load() {
  if (isLoading) return;
  isLoading = true;
  lockUI();

  setStatus('Cargando mensajes…');
  try {
    allMessages = await apiGetList();

    // Orden base: categoría, atajo
    allMessages.sort((a, b) => {
      const c = (a.categoria || '').localeCompare(b.categoria || '', 'es', { sensitivity: 'base' });
      if (c !== 0) return c;
      return (a.atajo || '').localeCompare(b.atajo || '', 'es', { sensitivity: 'base' });
    });

    populateCategoryFilter();
    render();

    setStatus(`Cargado: ${allMessages.length} mensajes.`);
  } catch (err) {
    console.error(err);
    setStatus('Error cargando.');
    toast(String(err.message || err), 'bad');
  } finally {
    isLoading = false;
    lockUI();
  }
}

async function saveFromModal() {
  if (isSaving) return;

  const id = (msgId ? msgId.value : '').trim();
  const categoria = (msgCategoria ? msgCategoria.value : '').trim();
  const atajo = (msgAtajo ? msgAtajo.value : '').trim();
  const mensaje = (msgMensaje ? msgMensaje.value : '').trim();

  if (!categoria || !atajo || !mensaje) {
    toast('Completa categoría, atajo y mensaje.', 'warn');
    return;
  }

  isSaving = true;
  lockUI();
  setStatus('Guardando…');

  try {
    if (id) {
      await apiPost('update', { id, categoria, atajo, mensaje });
      toast('Mensaje actualizado ✅', 'ok');
    } else {
      await apiPost('create', { categoria, atajo, mensaje });
      toast('Mensaje creado ✅', 'ok');
    }

    closeModal();
    await load();
  } catch (err) {
    console.error(err);
    setStatus('Error guardando.');
    toast(String(err.message || err), 'bad');
  } finally {
    isSaving = false;
    lockUI();
  }
}

async function archiveMessage(m) {
  if (!m || !m.id) {
    toast('No encuentro el id para archivar.', 'bad');
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
    toast('Archivado ✅', 'ok');
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

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      if (!editMode) setEditMode(true);
      openModal('create');
    });
  }

  if (btnToggleEdit) btnToggleEdit.addEventListener('click', () => setEditMode(!editMode));

  // Modal
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFromModal();
    });
  }

  // Logo FAB: scroll top
  if (logoFab) {
    logoFab.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

/** =========================
 *  INIT
 *  ========================= */
(function init(){
  wireEvents();
  setEditMode(false);
  lockUI();
  load();
})();
