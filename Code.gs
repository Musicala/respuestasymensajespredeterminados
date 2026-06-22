/**
 * Code.gs — Backend Apps Script para Mensajes Predeterminados · Musicala
 * ----------------------------------------------------------------------
 * Acciones:
 *   GET  ?action=list&key=...
 *   POST ?action=create&key=...
 *   POST ?action=update&key=...
 *   POST ?action=archive&key=...
 *
 * Estructura recomendada de hoja:
 *   id | categoria | atajo | mensaje | activo | archivado | createdAt | updatedAt
 *
 * Importante, porque aparentemente toca recordarlo como si fuera magia negra:
 * - update NUNCA crea fila nueva.
 * - archive NUNCA crea fila nueva.
 * - create sí crea, pero evita duplicados por categoria + atajo.
 */

const CONFIG = {
  API_KEY: 'MUSICALA_MSGS_2026',
  SHEET_NAME: 'Mensajes',
  HEADERS: ['id', 'categoria', 'atajo', 'mensaje', 'activo', 'archivado', 'createdAt', 'updatedAt']
};

const HEADER_ALIASES = {
  id: ['id', 'ID', 'Id'],
  categoria: ['categoria', 'categoría', 'Categoria', 'Categoría', 'category'],
  atajo: ['atajo', 'Atajo', 'shortcut', 'comando'],
  mensaje: ['mensaje', 'Mensaje', 'mensajes', 'Mensajes', 'texto', 'Texto', 'respuesta', 'Respuesta'],
  activo: ['activo', 'Activo', 'active'],
  archivado: ['archivado', 'Archivado', 'archive', 'archived'],
  createdAt: ['createdAt', 'creado', 'Creado', 'fechaCreacion', 'fecha creación'],
  updatedAt: ['updatedAt', 'actualizado', 'Actualizado', 'fechaActualizacion', 'fecha actualización']
};

function doGet(e) {
  try {
    assertKey_(e);
    const action = String(e.parameter.action || 'list').trim();

    if (action === 'list') {
      return json_({ ok: true, data: listMessages_() });
    }

    return json_({ ok: false, error: 'Acción GET no soportada: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    assertKey_(e);
    const action = String(e.parameter.action || '').trim();
    const payload = parsePayload_(e);

    if (action === 'create') {
      return json_({ ok: true, data: createMessage_(payload) });
    }

    if (action === 'update') {
      return json_({ ok: true, data: updateMessage_(payload) });
    }

    if (action === 'archive') {
      return json_({ ok: true, data: archiveMessage_(payload) });
    }

    if (action === 'setActive') {
      return json_({ ok: true, data: setActiveMessage_(payload) });
    }

    if (action === 'import') {
      return json_({ ok: true, data: importMessages_(payload) });
    }

    return json_({ ok: false, error: 'Acción POST no soportada: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function assertKey_(e) {
  const key = String((e && e.parameter && e.parameter.key) || '').trim();
  if (key !== CONFIG.API_KEY) throw new Error('API key inválida.');
}

function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('No se pudo leer el JSON enviado.');
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME);
  ensureHeaders_(sh);
  return sh;
}

function normalize_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function headerKey_(value) {
  return normalize_(value).replace(/[^a-z0-9]/g, '');
}

function canonicalHeader_(header) {
  const key = headerKey_(header);
  for (const canonical in HEADER_ALIASES) {
    const aliases = HEADER_ALIASES[canonical].map(headerKey_);
    if (aliases.indexOf(key) !== -1) return canonical;
  }
  return '';
}

function ensureHeaders_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());

  if (sh.getLastRow() === 0 || existing.every(v => !v)) {
    sh.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    sh.setFrozenRows(1);
    return;
  }

  const existingCanonical = existing.map(canonicalHeader_).filter(Boolean);
  const missing = CONFIG.HEADERS.filter(h => existingCanonical.indexOf(h) === -1);

  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
}

function headerMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
  const map = {};

  headers.forEach((h, i) => {
    const canonical = canonicalHeader_(h);
    if (canonical && !map[canonical]) map[canonical] = i + 1;
  });

  CONFIG.HEADERS.forEach(h => {
    if (!map[h]) throw new Error('Falta la columna obligatoria: ' + h);
  });

  return map;
}

function rowToObject_(row, map) {
  const obj = {};
  Object.keys(map).forEach(key => {
    obj[key] = row[map[key] - 1];
  });
  return obj;
}

function isActive_(obj) {
  const activo = normalize_(obj.activo);
  const archivado = normalize_(obj.archivado);
  return activo !== 'false' && activo !== 'no' && activo !== '0' && archivado !== 'true' && archivado !== 'si' && archivado !== 'sí' && archivado !== '1';
}

function isArchived_(obj) {
  const archivado = normalize_(obj.archivado);
  return archivado === 'true' || archivado === 'si' || archivado === 'sí' || archivado === '1';
}

function isDisabled_(obj) {
  const activo = normalize_(obj.activo);
  return activo === 'false' || activo === 'no' || activo === '0';
}

function listMessages_() {
  const sh = sheet_();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];

  const map = headerMap_(sh);
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values
    .map(row => rowToObject_(row, map))
    .filter(obj => !isArchived_(obj))
    .map(obj => ({
      id: String(obj.id || '').trim(),
      categoria: String(obj.categoria || '').trim(),
      atajo: String(obj.atajo || '').trim(),
      mensaje: String(obj.mensaje || '').trim(),
      activo: !isDisabled_(obj)
    }))
    .filter(obj => obj.id || obj.categoria || obj.atajo || obj.mensaje);
}

function findRowById_(sh, id) {
  id = String(id || '').trim();
  if (!id) return -1;

  const map = headerMap_(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  const values = sh.getRange(2, map.id, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === id) return i + 2;
  }
  return -1;
}

function findDuplicateRow_(sh, categoria, atajo, excludeId) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return -1;

  const map = headerMap_(sh);
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const wantedCat = normalize_(categoria);
  const wantedAtajo = normalize_(atajo);
  const excluded = String(excludeId || '').trim();

  for (let i = 0; i < values.length; i++) {
    const obj = rowToObject_(values[i], map);
    if (isArchived_(obj)) continue;
    if (excluded && String(obj.id || '').trim() === excluded) continue;
    if (normalize_(obj.categoria) === wantedCat && normalize_(obj.atajo) === wantedAtajo) return i + 2;
  }
  return -1;
}

function validateMessagePayload_(payload, requireId) {
  const id = String(payload.id || '').trim();
  const categoria = String(payload.categoria || '').trim();
  const atajo = String(payload.atajo || '').trim();
  const mensaje = String(payload.mensaje || '').trim();

  if (requireId && !id) throw new Error('Falta id del mensaje.');
  if (!categoria) throw new Error('Falta categoría.');
  if (!atajo) throw new Error('Falta atajo.');
  if (!mensaje) throw new Error('Falta mensaje.');

  return { id, categoria, atajo, mensaje };
}

function createMessage_(payload) {
  const data = validateMessagePayload_(payload, false);
  const sh = sheet_();
  const map = headerMap_(sh);

  const duplicateRow = findDuplicateRow_(sh, data.categoria, data.atajo, '');
  if (duplicateRow > -1) {
    throw new Error('Ya existe un mensaje activo con esa categoría y ese atajo. Edita el existente.');
  }

  const now = new Date();
  const row = new Array(sh.getLastColumn()).fill('');
  row[map.id - 1] = Utilities.getUuid();
  row[map.categoria - 1] = data.categoria;
  row[map.atajo - 1] = data.atajo;
  row[map.mensaje - 1] = data.mensaje;
  row[map.activo - 1] = true;
  row[map.archivado - 1] = false;
  row[map.createdAt - 1] = now;
  row[map.updatedAt - 1] = now;

  sh.appendRow(row);
  return { id: row[map.id - 1] };
}

function updateMessage_(payload) {
  const data = validateMessagePayload_(payload, true);
  const sh = sheet_();
  const map = headerMap_(sh);
  const row = findRowById_(sh, data.id);

  if (row < 0) {
    throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
  }

  const duplicateRow = findDuplicateRow_(sh, data.categoria, data.atajo, data.id);
  if (duplicateRow > -1) {
    throw new Error('Ya existe otro mensaje activo con esa categoría y ese atajo.');
  }

  sh.getRange(row, map.categoria).setValue(data.categoria);
  sh.getRange(row, map.atajo).setValue(data.atajo);
  sh.getRange(row, map.mensaje).setValue(data.mensaje);
  sh.getRange(row, map.activo).setValue(true);
  sh.getRange(row, map.archivado).setValue(false);
  sh.getRange(row, map.updatedAt).setValue(new Date());

  return { id: data.id, row: row };
}

function archiveMessage_(payload) {
  const id = String(payload.id || '').trim();
  if (!id) throw new Error('Falta id del mensaje.');

  const sh = sheet_();
  const map = headerMap_(sh);
  const row = findRowById_(sh, id);

  if (row < 0) {
    throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
  }

  sh.getRange(row, map.activo).setValue(false);
  sh.getRange(row, map.archivado).setValue(true);
  sh.getRange(row, map.updatedAt).setValue(new Date());

  return { id: id, row: row, archived: true };
}

/**
 * Habilita o inhabilita un mensaje SIN archivarlo (reversible).
 * payload: { id, activo: true|false }
 */
function setActiveMessage_(payload) {
  const id = String(payload.id || '').trim();
  if (!id) throw new Error('Falta id del mensaje.');

  const activo = (payload.activo === true) || (normalize_(payload.activo) === 'true');

  const sh = sheet_();
  const map = headerMap_(sh);
  const row = findRowById_(sh, id);

  if (row < 0) {
    throw new Error('No se encontró el mensaje con ese ID. No se creó ningún registro nuevo.');
  }

  sh.getRange(row, map.activo).setValue(activo);
  // No tocamos 'archivado': habilitar/inhabilitar es independiente de archivar.
  sh.getRange(row, map.updatedAt).setValue(new Date());

  return { id: id, row: row, activo: activo };
}

/**
 * Importa una lista de mensajes (por ejemplo desde messages-backup.json) a la hoja.
 * - Conserva el id que traiga cada mensaje. Si no trae id, genera uno.
 * - NO crea duplicados: omite los que ya existen por id o por categoría + atajo activos.
 * payload: { messages: [{ id, categoria, atajo, mensaje, activo }] }
 */
function importMessages_(payload) {
  const items = Array.isArray(payload && payload.messages) ? payload.messages : [];
  if (!items.length) throw new Error('No se enviaron mensajes para importar.');

  const sh = sheet_();
  const map = headerMap_(sh);
  const now = new Date();
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  const existingIds = {};
  const existingKeys = {};
  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    values.forEach(r => {
      const obj = rowToObject_(r, map);
      const id = String(obj.id || '').trim();
      if (id) existingIds[id] = true;
      if (!isArchived_(obj)) {
        existingKeys[normalize_(obj.categoria) + '||' + normalize_(obj.atajo)] = true;
      }
    });
  }

  const rowsToAppend = [];
  let imported = 0;
  let skipped = 0;

  items.forEach(item => {
    const id = String((item && item.id) || '').trim() || Utilities.getUuid();
    const categoria = String((item && item.categoria) || '').trim();
    const atajo = String((item && item.atajo) || '').trim();
    const mensaje = String((item && item.mensaje) || '').trim();

    if (!categoria || !atajo || !mensaje) { skipped++; return; }

    const key = normalize_(categoria) + '||' + normalize_(atajo);
    if (existingIds[id] || existingKeys[key]) { skipped++; return; }

    const row = new Array(lastCol).fill('');
    row[map.id - 1] = id;
    row[map.categoria - 1] = categoria;
    row[map.atajo - 1] = atajo;
    row[map.mensaje - 1] = mensaje;
    row[map.activo - 1] = (item && item.activo === false) ? false : true;
    row[map.archivado - 1] = false;
    row[map.createdAt - 1] = now;
    row[map.updatedAt - 1] = now;

    rowsToAppend.push(row);
    existingIds[id] = true;
    existingKeys[key] = true;
    imported++;
  });

  if (rowsToAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, lastCol).setValues(rowsToAppend);
  }

  return { imported: imported, skipped: skipped, total: items.length };
}

/**
 * Ejecutar manualmente una sola vez si hay mensajes antiguos sin ID.
 * No borra ni crea duplicados. Solo rellena IDs faltantes.
 */
function backfillMissingIds() {
  const sh = sheet_();
  const map = headerMap_(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 'No hay filas para revisar.';

  const range = sh.getRange(2, map.id, lastRow - 1, 1);
  const values = range.getValues();
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][0] || '').trim()) {
      values[i][0] = Utilities.getUuid();
      count++;
    }
  }

  range.setValues(values);
  return 'IDs agregados: ' + count;
}
