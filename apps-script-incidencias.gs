const SPREADSHEET_ID = "1EBG_HWQ3lp4UWjPtpMgc0UMe_mH53RWtgAtnDMCQ_nc";
const SHEET_NAME = "Incidencias";
const HEADERS = [
  "tienda",
  "pallet",
  "lpn",
  "codigos",
  "descripcion",
  "bultos",
  "precio",
  "estado",
  "fecha_incidente",
  "fecha_regularizado",
  "id",
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!e || !e.postData) {
    return jsonResponse({
      ok: false,
      message: "doPost no se ejecuta manualmente. Usa probarRegistro() para probar desde Apps Script.",
    });
  }

  try {
    if (!lock.tryLock(5000)) throw new Error("Sistema ocupado, intenta nuevamente.");
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.action === "updateStatus") {
      actualizarEstado(payload.id, payload.estado);
      return jsonResponse({ ok: true });
    }
    if (payload.action === "deleteIncidents") {
      return jsonResponse({ ok: true, deleted: eliminarIncidencias(payload.ids) });
    }

    const record = guardarIncidencia(payload);
    return jsonResponse({ ok: true, record });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || String(error) });
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

function doGet(e) {
  const action = String(e && e.parameter && e.parameter.action || "health");
  const callback = e && e.parameter && e.parameter.callback;
  const lock = LockService.getScriptLock();
  let payload;
  try {
    if (action === "list") {
      payload = {
        ok: true,
        rows: listarIncidencias(),
      };
    } else if (action === "create") {
      if (!lock.tryLock(5000)) throw new Error("Sistema ocupado, intenta nuevamente.");
      payload = {
        ok: true,
        record: guardarIncidencia(e.parameter),
      };
    } else if (action === "updateStatus") {
      if (!lock.tryLock(5000)) throw new Error("Sistema ocupado, intenta nuevamente.");
      actualizarEstado(e.parameter.id, e.parameter.estado);
      payload = { ok: true };
    } else if (action === "deleteIncidents") {
      if (!lock.tryLock(5000)) throw new Error("Sistema ocupado, intenta nuevamente.");
      payload = { ok: true, deleted: eliminarIncidencias(e.parameter.ids || e.parameter.id) };
    } else if (action === "health" || action === "setup") {
      payload = estadoServicio();
    } else {
      payload = {
        ok: true,
        message: "Servicio activo.",
      };
    }
  } catch (error) {
    payload = { ok: false, message: error.message || String(error) };
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }

  if (callback) {
    return javascriptResponse(callback, payload);
  }
  return jsonResponse(payload);
}

function probarRegistro() {
  guardarIncidencia({
    fecha_incidente: new Date().toLocaleString("es-PE"),
    usuario: "prueba",
    tienda: "TEST",
    pallet: "PALLET-PRUEBA",
    lpn: "LPN-PRUEBA",
    codigos: "COD-PRUEBA",
    descripcion: "PRODUCTO DE PRUEBA",
    bultos: "2.00",
    precio: "20.00",
    estado: "Pendiente",
  });
}

function estadoServicio() {
  const sheet = getSheet();
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String);
  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    headers,
    rows: Math.max(0, sheet.getLastRow() - 1),
    expectedHeaders: HEADERS,
  };
}

function guardarIncidencia(payload) {
  const sheet = getSheet();
  const record = normalizarIncidencia(payload);
  sheet.appendRow(HEADERS.map((header) => record[header] ?? ""));
  const precioIndex = HEADERS.indexOf("precio") + 1;
  const bultosIndex = HEADERS.indexOf("bultos") + 1;
  const newRow = sheet.getLastRow();
  if (precioIndex > 0) sheet.getRange(newRow, precioIndex).setNumberFormat("0.00");
  if (bultosIndex > 0) sheet.getRange(newRow, bultosIndex).setNumberFormat("0.00");
  formatSheet(sheet);
  return record;
}

function listarIncidencias() {
  const sheet = getSheet();
  asegurarIds(sheet);
  removeExtraColumns(sheet);
  formatSheet(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter((row) => row.some((cell) => cell !== "")).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header === "precio") {
        record[header] = normalizarNumeroReporte(row[index], 2);
      } else if (header === "bultos") {
        record[header] = normalizarNumeroReporte(row[index], 2);
      } else {
        record[header] = row[index] instanceof Date ? row[index].toLocaleString("es-PE") : row[index];
      }
    });
    return record;
  }).reverse();
}

function actualizarEstado(id, estado) {
  if (!id) throw new Error("Falta id");
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf("id");
  const estadoIndex = headers.indexOf("estado");
  const fechaRegularizadoIndex = headers.indexOf("fecha_regularizado");
  if (idIndex === -1 || estadoIndex === -1) throw new Error("Faltan columnas id/estado");

  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][idIndex]) === String(id)) {
      sheet.getRange(i + 1, estadoIndex + 1).setValue(estado || "Pendiente");
      if (fechaRegularizadoIndex !== -1) {
        sheet.getRange(i + 1, fechaRegularizadoIndex + 1).setValue(estado === "Regularizado" ? new Date() : "");
      }
      formatSheet(sheet);
      return;
    }
  }
  throw new Error("No se encontro la incidencia");
}

function eliminarIncidencias(idsInput) {
  const ids = normalizarIds(idsInput);
  if (!ids.length) throw new Error("Faltan ids");
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) throw new Error("Falta columna id");
  let deleted = 0;
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (ids.indexOf(String(values[row][idIndex])) >= 0) {
      sheet.deleteRow(row + 1);
      deleted += 1;
    }
  }
  formatSheet(sheet);
  return deleted;
}

function normalizarIds(idsInput) {
  if (Array.isArray(idsInput)) return idsInput.map(String).filter(Boolean);
  const raw = String(idsInput || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch (error) {}
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

function normalizarIncidencia(payload) {
  const bultos = normalizarNumeroReporte(payload.bultos || payload.bultosFaltantes || payload.faltante || "", 2);
  const precio = normalizarNumeroReporte(payload.precio || payload.costo || payload.importe || "", 2);
  return {
    id: payload.id || Utilities.getUuid(),
    tienda: payload.tienda || payload.destino || "",
    pallet: payload.pallet || payload.nroPallet || "",
    lpn: payload.lpn || payload.nroLpn || "",
    codigos: payload.codigos || payload.codigo || "",
    descripcion: payload.descripcion || "",
    bultos,
    precio,
    estado: "Pendiente",
    fecha_incidente: payload.fecha_incidente || payload.fechaIncidente || payload.fechaReporte || new Date(),
    fecha_regularizado: "",
  };
}

function normalizarNumeroReporte(valor, decimales) {
  const numero = numeroDesdeValor(valor);
  if (!numero) return "";
  return Number(numero.toFixed(decimales));
}

function numeroDesdeValor(valor) {
  if (valor instanceof Date) {
    return valor.getDate() + ((valor.getMonth() + 1) / 100);
  }
  if (typeof valor === "number") return isFinite(valor) ? valor : 0;
  const raw = String(valor || "").trim().replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  let normalized = raw;
  if (raw.indexOf(",") !== -1 && raw.indexOf(".") !== -1) {
    normalized = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.indexOf(",") !== -1) {
    normalized = raw.replace(",", ".");
  }
  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : 0;
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders(sheet);
  removeExtraColumns(sheet);
  formatSheet(sheet);
  return sheet;
}

function hasCurrentHeaders(sheet) {
  if (sheet.getLastColumn() !== HEADERS.length) return false;
  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  return HEADERS.every((header, index) => existing[index] === header);
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    return;
  }
  if (hasCurrentHeaders(sheet)) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const oldHeaders = values[0].map(String);
  const oldRows = values.slice(1);
  const migrated = oldRows.map((row) => {
    const record = {};
    oldHeaders.forEach((header, index) => {
      if (header) record[header] = row[index];
    });
    repararFilaConColumnasAuxiliares(record);
    if (!record.id) record.id = Utilities.getUuid();
    if (!record.estado) record.estado = "Pendiente";
    if (!record.fecha_incidente) record.fecha_incidente = "";
    if (!record.fecha_regularizado) record.fecha_regularizado = "";
    return HEADERS.map((header) => record[header] ?? "");
  });
  sheet.getRange(1, 1, migrated.length + 1, HEADERS.length).setValues([HEADERS].concat(migrated));
}

function repararFilaConColumnasAuxiliares(record) {
  const posibleEstado = String(record.costo_unitario || "").trim();
  const posibleFechaIncidente = record.unidades_faltantes;
  const posibleFechaRegularizado = record.estado;
  const posibleId = String(record.fecha_incidente || "").trim();
  const tieneEstadoCorrido = posibleEstado === "Pendiente" || posibleEstado === "Regularizado";
  const tieneIdEnFecha = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(posibleId);
  if (!tieneEstadoCorrido || !tieneIdEnFecha) return;
  record.estado = posibleEstado;
  record.fecha_incidente = posibleFechaIncidente || "";
  record.fecha_regularizado = posibleFechaRegularizado || "";
  record.id = posibleId;
}

function asegurarIds(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  const headers = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const idIndex = headers.indexOf("id");
  const estadoIndex = headers.indexOf("estado");
  if (idIndex === -1) return;
  const idRange = sheet.getRange(2, idIndex + 1, lastRow - 1, 1);
  const ids = idRange.getValues();
  let cambio = false;
  ids.forEach((row) => {
    if (!String(row[0] || "").trim()) {
      row[0] = Utilities.getUuid();
      cambio = true;
    }
  });
  if (cambio) idRange.setValues(ids);
  if (estadoIndex !== -1) {
    const estadoRange = sheet.getRange(2, estadoIndex + 1, lastRow - 1, 1);
    const estados = estadoRange.getValues();
    let cambioEstado = false;
    estados.forEach((row) => {
      if (!String(row[0] || "").trim()) {
        row[0] = "Pendiente";
        cambioEstado = true;
      }
    });
    if (cambioEstado) estadoRange.setValues(estados);
  }
}

function removeExtraColumns(sheet) {
  const extra = sheet.getMaxColumns() - HEADERS.length;
  if (extra > 0) {
    sheet.deleteColumns(HEADERS.length + 1, extra);
  }
}

function formatSheet(sheet) {
  sheet.showColumns(1, HEADERS.length);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#e9f1ec")
    .setFontColor("#17221b");
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 170);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 360);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(7, 110);
  sheet.setColumnWidth(8, 130);
  sheet.setColumnWidth(9, 170);
  sheet.setColumnWidth(10, 170);
  sheet.setColumnWidth(11, 1);
  sheet.hideColumns(11);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function javascriptResponse(callback, payload) {
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
