/* guion.js — Guión de ventas, ENCAPSULADO (IIFE) y acotado a #viewGuion */
(function(){
'use strict';

/* =============================================================================
  app.js — Guión de ventas Musicala (v0.3)
  -----------------------------------------------------------------------------
  Mejoras v0.3:
  - Flow cargado desde JSON (flow.json / data/flow.json) con fallback inteligente
  - Notas: histórico (CRUD) en localStorage + render en panel derecho (no solo modal)
  - Compartir: SOLO COPIAR (sin abrir WhatsApp, como pidieron)
  - Templates: usa #tplOption, #tplPathItem, #tplHistoryItem del index.html
  - Más robusto: validaciones, manejo de errores, autosave de borrador, delegación de eventos
============================================================================= */

/* =========================
   Config
========================= */
// Intentamos primero ./flow.json (como lo tienen), y si no, ./data/flow.json
const FLOW_URLS = ['./data/flow.json', './flow.json'];

const LS_STATE_KEY = 'musicala_sales_script_state_v03';
const LS_NOTES_KEY = 'musicala_sales_notes_history_v03';
const LS_DRAFT_KEY = 'musicala_sales_notes_draft_v03';

/* =========================
   Helpers
========================= */
const ROOT = document.getElementById('viewGuion') || document;
const $ = (sel, el = ROOT) => el.querySelector(sel);
const $$ = (sel, el = ROOT) => Array.from(el.querySelectorAll(sel));

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function safeText(el, text){
  if (!el) return;
  el.textContent = text ?? '';
}

function escapeHTML(str){
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nowISO(){ return new Date().toISOString(); }

function uid(prefix = 'id'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function prettifyId(id){
  return (id || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function toTitleCase(s){
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

function normalizeSpaces(s){
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    // fallback antiguo, pero sirve
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(err){
      return false;
    }
  }
}

function loadJSON(key, fallback = null){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  }catch(e){
    return fallback;
  }
}

function saveJSON(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }catch(e){
    return false;
  }
}

function removeKey(key){
  try{ localStorage.removeItem(key); }catch(e){}
}

/* =========================
   UI refs
========================= */
const els = {
  // Top
  chips: $$('.chip'),
  btnReset: $('#btnReset'),
  btnAyuda: $('#btnAyuda'),
  btnNotas: $('#btnNotas'),

  // Status
  phaseBadge: $('#phaseBadge'),
  phaseHint: $('#phaseHint'),
  progressBar: $('.progress__bar'),
  progressWrap: $('.progress'),
  progressText: $('#progressText'),

  // Flow
  nodePrompt: $('#nodePrompt'),
  sayText: $('#sayText'),
  dontSayBox: $('#dontSayBox'),
  options: $('#options'),
  path: $('#path'),

  // Support KV
  kvChannel: $('#kvChannel'),
  kvInterest: $('#kvInterest'),
  kvService: $('#kvService'),
  kvStatus: $('#kvStatus'),

  // Notes form (panel derecho)
  noteName: $('#noteName'),
  noteGoal: $('#noteGoal'),
  noteObjection: $('#noteObjection'),
  noteExtra: $('#noteExtra'),
  btnSaveNotes: $('#btnSaveNotes'),
  btnClearNotes: $('#btnClearNotes'),
  btnShareCopy: $('#btnShareWa'), // mantenemos el id para no romper HTML

  // History container (panel derecho)
  notesHistory: $('#notesHistory'),

  // Modals
  helpModal: $('#helpModal'),
  notesModal: $('#notesModal'),

  // Templates
  tplOption: $('#tplOption'),
  tplPathItem: $('#tplPathItem'),
  tplHistoryItem: $('#tplHistoryItem'),

  // FAQ container
  faq: $('#faq'),
};

/* =========================
   Runtime Flow Data (from JSON)
========================= */
let FLOW = null;
let PHASES = {};
let CHANNELS = {};
let FAQ_BANK = [];
let TREE = {};

/* =========================
   App State
========================= */
const state = {
  channel: 'llamada',
  currentId: 'inicio',
  path: ['inicio'],
  kv: {
    status: 'Explorando',
    interest: '—',
    service: '—',
    objection: '',
  }
};

/* =========================
   Notes State
========================= */
const notesState = {
  editingId: null,
};

/* =========================
   Storage: state + draft + history
========================= */
function loadState(){
  const parsed = loadJSON(LS_STATE_KEY, null);
  if (!parsed || typeof parsed !== 'object') return;

  state.channel   = parsed.channel   || state.channel;
  state.currentId = parsed.currentId || state.currentId;
  state.path      = Array.isArray(parsed.path) ? parsed.path : state.path;
  state.kv        = { ...state.kv, ...(parsed.kv || {}) };
}

function saveState(){
  saveJSON(LS_STATE_KEY, {
    channel: state.channel,
    currentId: state.currentId,
    path: state.path,
    kv: state.kv,
    savedAt: nowISO(),
  });
}

function loadDraftNotes(){
  const draft = loadJSON(LS_DRAFT_KEY, null);
  if (!draft) return;

  if (els.noteName) els.noteName.value = draft.name || '';
  if (els.noteGoal) els.noteGoal.value = draft.goal || '';
  if (els.noteObjection) els.noteObjection.value = draft.objection || '';
  if (els.noteExtra) els.noteExtra.value = draft.extra || '';

  notesState.editingId = draft.editingId || null;
  syncSaveButtonLabel();
}

function saveDraftNotes(){
  saveJSON(LS_DRAFT_KEY, {
    name: (els.noteName?.value || '').trim(),
    goal: (els.noteGoal?.value || '').trim(),
    objection: (els.noteObjection?.value || '').trim(),
    extra: (els.noteExtra?.value || '').trim(),
    editingId: notesState.editingId,
    savedAt: nowISO(),
  });
}

function clearDraftNotes(){
  if (els.noteName) els.noteName.value = '';
  if (els.noteGoal) els.noteGoal.value = '';
  if (els.noteObjection) els.noteObjection.value = '';
  if (els.noteExtra) els.noteExtra.value = '';

  notesState.editingId = null;
  removeKey(LS_DRAFT_KEY);
  syncSaveButtonLabel();
}

function getNotesHistory(){
  return loadJSON(LS_NOTES_KEY, []);
}

function setNotesHistory(arr){
  saveJSON(LS_NOTES_KEY, Array.isArray(arr) ? arr : []);
}

/* =========================
   Flow utils
========================= */
function getNode(id){
  return TREE?.[id] || TREE?.inicio || null;
}

function getSayText(node){
  if (!node) return '';
  const byChannel = node.say?.[state.channel];
  return byChannel || node.say?.base || '';
}

function setPhase(phaseKey){
  const p = PHASES?.[phaseKey] || PHASES?.exploracion || {
    name: 'Exploración',
    hint: 'Inicia con preguntas cortas y claras.'
  };
  safeText(els.phaseBadge, p.name);
  safeText(els.phaseHint, p.hint);
}

/* =========================
   Rendering: progress, path, kv, options, faqs
========================= */
function renderProgress(){
  const node = getNode(state.currentId);
  const phaseOrder = ['exploracion', 'conexion', 'propuesta', 'cierre', 'seguimiento', 'final'];
  const idx = Math.max(0, phaseOrder.indexOf(node?.phase || 'exploracion'));

  const x = clamp(idx + 1, 1, 6);
  const y = 6;
  const pct = clamp(Math.round((x / y) * 100), 5, 100);

  if (els.progressBar) els.progressBar.style.width = `${pct}%`;
  if (els.progressWrap) els.progressWrap.setAttribute('aria-valuenow', String(pct));
  safeText(els.progressText, `Paso ${x} de ${y}`);
}

function renderPath(){
  if (!els.path || !els.tplPathItem) return;

  els.path.innerHTML = '';
  state.path.forEach((id, i) => {
    const node = getNode(id);
    const frag = els.tplPathItem.content.cloneNode(true);
    const item = frag.querySelector('.path__item');

    item.textContent = (node?.id === 'inicio') ? 'Inicio' : prettifyId(node?.id || id);
    if (i === state.path.length - 1) item.classList.add('is-active');

    // volver a un punto anterior
    item.tabIndex = 0;
    item.role = 'button';
    item.addEventListener('click', () => jumpToIndex(i));
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        jumpToIndex(i);
      }
    });

    els.path.appendChild(frag);
  });
}

function renderKV(){
  safeText(els.kvChannel, CHANNELS?.[state.channel]?.label || 'Llamada');
  safeText(els.kvInterest, state.kv.interest || '—');
  safeText(els.kvService, state.kv.service || '—');

  if (els.kvStatus){
    const explain = state.kv.status || '—';
    els.kvStatus.innerHTML = `<span class="pill">${escapeHTML(explain)}</span>`;
  }
}

function applyKv(kvPatch, opts = {}){
  if (!kvPatch || typeof kvPatch !== 'object') return;
  state.kv = { ...state.kv, ...kvPatch };
  if (!opts.silent) renderKV();
}

function renderOptions(node){
  if (!els.options || !els.tplOption) return;
  els.options.innerHTML = '';

  (node?.options || []).forEach(opt => {
    const frag = els.tplOption.content.cloneNode(true);
    const btn = frag.querySelector('.opt');

    btn.textContent = opt.label || 'Opción';
    if (opt.primary) btn.classList.add('opt--primary');

    btn.addEventListener('click', () => {
      if (opt.setKv) applyKv(opt.setKv);

      // si la opción trae objeción y el campo está vacío, la ponemos
      if (opt.setKv?.objection && els.noteObjection && !els.noteObjection.value.trim()){
        els.noteObjection.value = opt.setKv.objection;
        saveDraftNotes();
      }

      goTo(opt.next);
    });

    els.options.appendChild(frag);
  });
}

function renderFAQs(node){
  if (!els.faq) return;

  const tags = new Set(node?.tags || []);
  // fallback útil
  tags.add('como-funciona');

  const chosen = (FAQ_BANK || [])
    .filter(f => tags.has(f.tag))
    .slice(0, 4);

  if (!chosen.length){
    // si no hay banco, no rompemos el layout
    return;
  }

  els.faq.innerHTML = chosen.map((f, idx) => {
    const openAttr = idx === 0 ? ' open' : '';
    return `
      <details class="faq__item"${openAttr}>
        <summary class="faq__q">${escapeHTML(f.q)}</summary>
        <div class="faq__a">
          <span class="mono">${escapeHTML(f.a)}</span>
        </div>
      </details>
    `;
  }).join('');
}

function renderNode(){
  const node = getNode(state.currentId);
  if (!node){
    safeText(els.nodePrompt, 'No se pudo cargar el flujo 😅');
    safeText(els.sayText, 'Revisa que flow.json exista y esté bien.');
    return;
  }

  safeText(els.nodePrompt, node.prompt || '');
  safeText(els.sayText, getSayText(node) || '');

  if (els.dontSayBox){
    if (node.tip){
      els.dontSayBox.style.display = '';
      els.dontSayBox.innerHTML = `<strong>Tip interno:</strong> ${escapeHTML(node.tip)}`;
    } else {
      els.dontSayBox.style.display = 'none';
    }
  }

  setPhase(node.phase);
  renderProgress();
  renderPath();
  renderOptions(node);

  if (node.kv) applyKv(node.kv, { silent: true });
  renderKV();
  renderFAQs(node);

  saveState();
}

/* =========================
   Navigation
========================= */
function goTo(nextId){
  const next = getNode(nextId);
  if (!next) return;

  state.currentId = next.id;

  const last = state.path[state.path.length - 1];
  if (last !== next.id){
    state.path.push(next.id);
  }

  renderNode();
}

function jumpToIndex(i){
  const idx = clamp(i, 0, state.path.length - 1);
  const id = state.path[idx];
  state.currentId = id;
  state.path = state.path.slice(0, idx + 1);
  renderNode();
}

function resetFlow(){
  state.currentId = 'inicio';
  state.path = ['inicio'];
  state.kv = {
    status: 'Explorando',
    interest: '—',
    service: '—',
    objection: '',
  };
  renderNode();
}

/* =========================
   Channel handling
========================= */
function setChannel(ch){
  if (!CHANNELS?.[ch]) return;
  state.channel = ch;

  els.chips.forEach(btn => {
    const is = btn.dataset.channel === ch;
    btn.classList.toggle('is-active', is);
    btn.setAttribute('aria-pressed', is ? 'true' : 'false');
  });

  renderKV();
  renderNode();
}

/* =========================
   Notes: CRUD + Copy
========================= */
function getNoteFormData(){
  const name = normalizeSpaces(els.noteName?.value || '');
  const goal = normalizeSpaces(els.noteGoal?.value || '');
  const objection = normalizeSpaces(els.noteObjection?.value || '');
  const extra = normalizeSpaces(els.noteExtra?.value || '');

  return {
    name: toTitleCase(name),
    goal,
    objection,
    extra,
  };
}

function isNoteEmpty(n){
  return !n.name && !n.goal && !n.objection && !n.extra;
}

function buildShareText(note){
  // Formato corto, claro y copiables para su WhatsApp “Información Musicala”
  const parts = [];
  parts.push('📌 *Lead / Nota*');
  if (note.name) parts.push(`👤 *Nombre:* ${note.name}`);
  if (note.goal) parts.push(`🎯 *Qué quiere:* ${note.goal}`);
  if (note.objection) parts.push(`🧱 *Objeción:* ${note.objection}`);
  if (state.kv?.service && state.kv.service !== '—') parts.push(`✨ *Servicio sugerido:* ${state.kv.service}`);
  if (state.channel) parts.push(`📍 *Canal:* ${CHANNELS?.[state.channel]?.label || state.channel}`);
  if (note.extra) parts.push(`📝 *Notas:* ${note.extra}`);

  const d = new Date();
  const stamp = d.toLocaleString('es-CO', { hour12: true });
  parts.push(`⏱️ ${stamp}`);

  return parts.join('\n');
}

function syncSaveButtonLabel(){
  if (!els.btnSaveNotes) return;
  els.btnSaveNotes.textContent = notesState.editingId ? 'Actualizar' : 'Guardar';
}

function saveOrUpdateNote(){
  const data = getNoteFormData();
  if (isNoteEmpty(data)){
    toast('No hay nada para guardar 😶');
    return;
  }

  const history = getNotesHistory();

  if (notesState.editingId){
    const idx = history.findIndex(n => n.id === notesState.editingId);
    if (idx >= 0){
      history[idx] = {
        ...history[idx],
        ...data,
        kvSnapshot: {
          channel: state.channel,
          status: state.kv.status,
          interest: state.kv.interest,
          service: state.kv.service,
        },
        updatedAt: nowISO(),
      };
      setNotesHistory(history);
      saveDraftNotes();
      toast('Nota actualizada ✅');
      renderNotesHistoryAll();
      return;
    } else {
      // si no aparece, lo tratamos como nuevo
      notesState.editingId = null;
      syncSaveButtonLabel();
    }
  }

  const newNote = {
    id: uid('note'),
    ...data,
    kvSnapshot: {
      channel: state.channel,
      status: state.kv.status,
      interest: state.kv.interest,
      service: state.kv.service,
    },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  history.unshift(newNote);
  setNotesHistory(history);

  notesState.editingId = newNote.id;
  syncSaveButtonLabel();
  saveDraftNotes();

  toast('Nota guardada ✅');
  renderNotesHistoryAll();
}

function deleteNote(noteId){
  const history = getNotesHistory();
  const next = history.filter(n => n.id !== noteId);
  setNotesHistory(next);

  if (notesState.editingId === noteId){
    clearDraftNotes();
  }

  toast('Nota eliminada 🗑️');
  renderNotesHistoryAll();
}

function loadNoteToForm(noteId){
  const history = getNotesHistory();
  const n = history.find(x => x.id === noteId);
  if (!n) return;

  if (els.noteName) els.noteName.value = n.name || '';
  if (els.noteGoal) els.noteGoal.value = n.goal || '';
  if (els.noteObjection) els.noteObjection.value = n.objection || '';
  if (els.noteExtra) els.noteExtra.value = n.extra || '';

  notesState.editingId = n.id;
  syncSaveButtonLabel();
  saveDraftNotes();

  toast('Editando nota ✏️');
}

async function copyCurrentNote(){
  const data = getNoteFormData();
  if (isNoteEmpty(data)){
    toast('No hay nota para copiar 😅');
    return;
  }

  const text = buildShareText(data);
  const ok = await copyToClipboard(text);

  if (ok) toast('Copiado ✅ Pégalo donde quieras');
  else toast('No pude copiar 😭 (el navegador se puso intenso)');
}

/* =========================
   Notes History UI (panel derecho + opcional modal)
========================= */
function formatShortDate(iso){
  try{
    return new Date(iso).toLocaleString('es-CO', { hour12: true });
  }catch(e){
    return '';
  }
}

function renderHistoryInto(container){
  if (!container) return;

  const history = getNotesHistory();
  if (!history.length){
    container.innerHTML = `<div class="muted small">Aún no hay notas guardadas.</div>`;
    return;
  }

  // Si hay template, úsalo (mejor)
  if (els.tplHistoryItem){
    container.innerHTML = '';

    history.slice(0, 50).forEach(n => {
      const frag = els.tplHistoryItem.content.cloneNode(true);

      const titleEl = frag.querySelector('.history__title');
      const subEl = frag.querySelector('.history__sub');

      const btnLoad = frag.querySelector('[data-action="load"]');
      const btnShare = frag.querySelector('[data-action="share"]');
      const btnDelete = frag.querySelector('[data-action="delete"]');

      const title = n.name ? n.name : 'Sin nombre';
      const when = n.updatedAt ? formatShortDate(n.updatedAt) : '';
      const goal = n.goal ? n.goal : '—';

      if (titleEl) titleEl.textContent = title;

      // Sub: objetivo + fecha
      if (subEl){
        const service = n.kvSnapshot?.service && n.kvSnapshot.service !== '—' ? ` · ✨ ${n.kvSnapshot.service}` : '';
        const ob = n.objection ? ` · 🧱 ${n.objection}` : '';
        const time = when ? ` · ⏱️ ${when}` : '';
        subEl.textContent = `🎯 ${goal}${service}${ob}${time}`;
      }

      // Botones
      if (btnLoad){
        btnLoad.dataset.id = n.id;
      }
      if (btnShare){
        btnShare.dataset.id = n.id;
        btnShare.textContent = 'Copiar';
      }
      if (btnDelete){
        btnDelete.dataset.id = n.id;
      }

      container.appendChild(frag);
    });

    return;
  }

  // Fallback sin template (por si borran el template sin querer)
  container.innerHTML = history.slice(0, 50).map(n => {
    const title = escapeHTML(n.name || 'Sin nombre');
    const goal = escapeHTML(n.goal || '—');
    const when = escapeHTML(n.updatedAt ? formatShortDate(n.updatedAt) : '');
    return `
      <div class="history__item">
        <div class="history__meta">
          <div class="history__title">${title}</div>
          <div class="history__sub muted small">🎯 ${goal}${when ? ` · ⏱️ ${when}` : ''}</div>
        </div>
        <div class="history__actions">
          <button class="btn btn--ghost history__btn" data-action="load" data-id="${escapeHTML(n.id)}">Cargar</button>
          <button class="btn btn--ghost history__btn" data-action="share" data-id="${escapeHTML(n.id)}">Copiar</button>
          <button class="btn btn--ghost history__btn" data-action="delete" data-id="${escapeHTML(n.id)}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderNotesHistoryAll(){
  // Panel derecho
  renderHistoryInto(els.notesHistory);

  // Modal (si algún día lo usan para mobile)
  if (els.notesModal){
    const list = $('#notesHistoryList', els.notesModal);
    if (list) renderHistoryInto(list);
  }
}

function wireHistoryDelegation(){
  // Delegación de eventos en panel derecho
  if (els.notesHistory){
    els.notesHistory.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (!id) return;

      if (action === 'load'){
        loadNoteToForm(id);
        return;
      }

      if (action === 'delete'){
        const ok = confirm('¿Borrar esta nota?');
        if (ok) deleteNote(id);
        return;
      }

      if (action === 'share'){
        // Copiar esa nota sin redirigir a nada
        loadNoteToForm(id);
        await copyCurrentNote();
        return;
      }
    });
  }

  // Delegación en modal si existe su lista
  if (els.notesModal){
    els.notesModal.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'load'){
        loadNoteToForm(id);
        return;
      }
      if (action === 'delete'){
        const ok = confirm('¿Borrar esta nota?');
        if (ok) deleteNote(id);
        return;
      }
      if (action === 'share'){
        loadNoteToForm(id);
        await copyCurrentNote();
        return;
      }
    });
  }
}

/* =========================
   Modals
========================= */
function openDialog(dlg){
  if (!dlg) return;
  if (typeof dlg.showModal === 'function') dlg.showModal();
}

function wireModals(){
  if (els.btnAyuda){
    els.btnAyuda.addEventListener('click', () => openDialog(els.helpModal));
  }

  if (els.btnNotas){
    els.btnNotas.addEventListener('click', () => {
      openDialog(els.notesModal);

      // Si quieren lista dentro del modal, se la creamos "de una"
      ensureNotesModalList();
      renderNotesHistoryAll();
    });
  }
}

function ensureNotesModalList(){
  if (!els.notesModal) return;

  // Si ya existe, no hacemos nada
  if ($('#notesHistoryList', els.notesModal)) return;

  const body = els.notesModal.querySelector('.modal__body');
  if (!body) return;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="divider" style="margin: 12px 0;"></div>
    <div class="card__title">🗂️ Histórico</div>
    <div class="card__desc muted" style="margin-bottom:10px;">
      Copia, carga o borra notas. Sí, el histórico existe. Qué milagro.
    </div>
    <div id="notesHistoryList" class="history"></div>
  `;
  body.appendChild(wrap);
}

/* =========================
   Toast
========================= */
let toastTimer = null;
function toast(msg){
  const el = els.phaseHint;
  if (!el) return;

  el.textContent = msg;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    const node = getNode(state.currentId);
    const p = PHASES?.[node?.phase] || PHASES?.exploracion || { hint: 'Inicia con preguntas cortas y claras.' };
    el.textContent = p.hint;
  }, 1600);
}

/* =========================
   Wiring: notes & events
========================= */
function wireNotes(){
  if (els.btnSaveNotes){
    els.btnSaveNotes.addEventListener('click', () => saveOrUpdateNote());
  }

  if (els.btnClearNotes){
    els.btnClearNotes.addEventListener('click', () => {
      clearDraftNotes();
      toast('Notas limpiadas 🧽');
    });
  }

  // Botón "Copiar nota" (id btnShareWa por compatibilidad)
  if (els.btnShareCopy){
    els.btnShareCopy.addEventListener('click', copyCurrentNote);
  }

  // Autosave suave
  const autosave = () => saveDraftNotes();
  [els.noteName, els.noteGoal, els.noteObjection, els.noteExtra].forEach(el => {
    if (!el) return;
    el.addEventListener('input', autosave);
    el.addEventListener('change', autosave);
  });

  syncSaveButtonLabel();
}

function bindEvents(){
  // Chips canal
  els.chips.forEach(btn => {
    btn.addEventListener('click', () => setChannel(btn.dataset.channel));
  });

  // Reset
  if (els.btnReset){
    els.btnReset.addEventListener('click', () => {
      resetFlow();
      toast('Flujo reiniciado 🔄');
    });
  }

  wireNotes();
  wireModals();
  wireHistoryDelegation();
}

/* =========================
   Load Flow JSON
========================= */
async function tryFetchJSON(url){
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.json();
}

async function loadFlow(){
  let lastErr = null;

  for (const url of FLOW_URLS){
    try{
      const json = await tryFetchJSON(url);

      FLOW = json;
      PHASES = json.phases || {};
      CHANNELS = json.channels || {};
      FAQ_BANK = json.faqBank || [];
      TREE = json.tree || {};

      if (!TREE.inicio && TREE['inicio']) TREE.inicio = TREE['inicio'];
      if (!TREE.inicio) throw new Error('flow.tree.inicio no existe');

      console.log('[Flow] Cargado desde:', url);
      return true;

    }catch(e){
      lastErr = e;
    }
  }

  console.error('[Flow] No se pudo cargar flow.json:', lastErr);

  // Fallback ultra básico para no dejar la app muerta
  PHASES = {
    exploracion: { name: 'Exploración', hint: 'Inicia con preguntas cortas y claras.' },
    conexion:    { name: 'Conexión', hint: 'Aterriza objetivo, edad y contexto.' },
    propuesta:   { name: 'Propuesta', hint: 'Ofrece la opción más simple y concreta.' },
    cierre:      { name: 'Cierre', hint: 'Siguiente paso concreto: agendar / inscribir.' },
    seguimiento: { name: 'Seguimiento', hint: 'Deja claridad y fecha del próximo contacto.' },
  };

  CHANNELS = {
    llamada:  { label: 'Llamada' },
    whatsapp: { label: 'WhatsApp' },
    redes:    { label: 'Redes / Formulario' },
  };

  FAQ_BANK = [];
  TREE = {
    inicio: {
      id: 'inicio',
      phase: 'exploracion',
      prompt: 'No cargó flow.json 😅 (pero la app no se muere).',
      say: { base: 'Revisa que exista ./flow.json o ./data/flow.json y que sea JSON válido.' },
      tip: 'Tip: JSON mal puesto = lágrimas.',
      tags: [],
      kv: { status: 'Error', interest: '—', service: '—' },
      options: [
        { label: '🔄 Intentar de nuevo', next: 'inicio', primary: true }
      ]
    }
  };

  return false;
}

/* =========================
   Init
========================= */
async function init(){
  // 1) Flow
  await loadFlow();

  // 2) Estado + draft
  loadState();
  loadDraftNotes();

  // 3) Validar node actual
  if (!TREE[state.currentId]) state.currentId = 'inicio';
  if (!Array.isArray(state.path) || state.path.length === 0) state.path = ['inicio'];

  // 4) Canal válido
  if (!CHANNELS[state.channel]) state.channel = 'llamada';

  // 5) Render inicial (primero setChannel para que sayText use canal)
  setChannel(state.channel);
  renderNode();

  // 6) Render histórico al arrancar (panel derecho)
  renderNotesHistoryAll();

  // 7) Eventos
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
})();
