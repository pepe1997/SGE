const SHEET_ID = "1j-20Ewgg0kXbOCaV6V8Jo8s6icYgB1eZRhy_YwnVGRc";
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
const SHEETS = {
  cartons: "CARTONES",
  products: "PRODUCTOS",
  sent: "ENVIADO",
  cargo: "CARGA",
};
const REPORT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1EBG_HWQ3lp4UWjPtpMgc0UMe_mH53RWtgAtnDMCQ_nc/edit";
const REPORT_ENDPOINT = "https://script.google.com/macros/s/AKfycbxhIP_3ELlWmKtmvOK7o7I_vdCqEpH2OeR8ObOImeSbvaB_yrQi3Z9qQHtNjNasc221/exec";
const REPORT_REFRESH_MS = 3000;
const STORAGE_KEYS = {
  session: "palletValidator.session",
  incidents: "palletValidator.incidents",
  reportPing: "palletValidator.reportPing",
  validations: "palletValidator.validations",
  validationVersion: "palletValidator.validationVersion",
  validatorView: "palletValidator.validatorView",
  supervisorView: "palletValidator.supervisorView",
};
const VALIDATION_VERSION = "bultos-v4";

const USERS = [
  { user: "supervisor", pass: "validacion", role: "Supervisor" },
  { user: "validador", pass: "1234", role: "Validador" },
  { user: "CD_Oslo", pass: "Oslo.2027", role: "Invitado" },
];

const state = {
  user: loadJson(STORAGE_KEYS.session, null),
  rows: [],
  productCosts: new Map(),
  groups: [],
  selectedKey: "",
  selectedMode: "pallet",
  query: "",
  tableQuery: "",
  groupCacheMode: "",
  groupCache: [],
  status: "idle",
  reportStatus: "idle",
  sentStatus: "idle",
  cargoStatus: "idle",
  impactStatus: "idle",
  error: "",
  reportError: "",
  sentError: "",
  cargoError: "",
  impactError: "",
  incidents: [],
  sentRows: [],
  cargoRows: [],
  impactHistory: [],
  supervisorView: localStorage.getItem(STORAGE_KEYS.supervisorView) || "",
  reportModule: "summary",
  dashboardTurn: "todos",
  dashboardTrend: "hours",
  summaryQuery: "",
  summaryDateFrom: "",
  summaryDateTo: "",
  summaryStore: "todos",
  summaryStatus: "todos",
  advancePeriod: "day",
  advanceStore: "todos",
  advanceStatus: "todos",
  sentQuery: "",
  sentDateFrom: "",
  sentDateTo: "",
  sentStore: "todos",
  sentStatusFilter: "todos",
  sentDetailKey: "",
  impactDate: "",
  impactHistoryDate: "",
  impactSaving: false,
  selectedIncidentIds: new Set(),
  validatorView: localStorage.getItem(STORAGE_KEYS.validatorView) || "",
  validations: loadValidations(),
  missingModalRowKey: "",
};

const app = document.querySelector("#app");
let reportRefreshTimer = null;
let queryRenderTimer = null;

function canViewSupervisorReport() {
  return state.user?.role === "Supervisor" || state.user?.role === "Invitado";
}

function canManageIncidents() {
  return state.user?.role === "Supervisor";
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `inc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadValidations() {
  if (localStorage.getItem(STORAGE_KEYS.validationVersion) !== VALIDATION_VERSION) {
    localStorage.removeItem(STORAGE_KEYS.validations);
    localStorage.setItem(STORAGE_KEYS.validationVersion, VALIDATION_VERSION);
    return {};
  }
  const validations = loadJson(STORAGE_KEYS.validations, {});
  let changed = false;
  Object.entries(validations).forEach(([key, validation]) => {
    if (validation?.status === "incidence" || validation?.status === "reported") {
      delete validations[key];
      changed = true;
    }
  });
  if (changed) saveJson(STORAGE_KEYS.validations, validations);
  return validations;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (value instanceof Date) {
    return value.getDate() + ((value.getMonth() + 1) / 100);
  }
  const raw = normalize(value).replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return toNumber(value).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function priceToNumber(value) {
  const text = normalize(value);
  const dateLike = text.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
  if (dateLike) return Number(`${dateLike[1]}.${dateLike[2].padStart(2, "0")}`);
  return toNumber(value);
}

function field(row, names) {
  return names.map((name) => row[name]).find((value) => normalize(value)) || "";
}

function bultos(row) {
  if (row._bultosTotal !== undefined) return toNumber(row._bultosTotal);
  const unAct = toNumber(row.UnAct);
  const undCaja = toNumber(row["Und x Caja"]);
  if (!undCaja) return unAct;
  return unAct / undCaja;
}

function unitCost(row) {
  const code = normalize(row.Codigo);
  return toNumber(row._costoUnidad ?? state.productCosts.get(code));
}

function totalPrice(row) {
  return toNumber(row.UnAct) * unitCost(row);
}

function missingPrice(row, missingBultos) {
  const totalBultos = bultos(row);
  const missing = toNumber(missingBultos);
  const units = toNumber(row.UnAct);
  const cost = unitCost(row);
  const unitsPerBulto = totalBultos > 0 && units > 0
    ? units / totalBultos
    : toNumber(row["Und x Caja"]);
  const calculated = missing * unitsPerBulto * cost;
  if (calculated > 0) return calculated;
  if (totalBultos > 0 && totalPrice(row) > 0) {
    return totalPrice(row) * Math.min(1, missing / totalBultos);
  }
  return 0;
}

function missingUnits(row, missingBultos) {
  const totalBultos = bultos(row);
  const units = toNumber(row.UnAct);
  if (totalBultos > 0 && units > 0) return toNumber(missingBultos) * (units / totalBultos);
  return toNumber(missingBultos) * toNumber(row["Und x Caja"]);
}

function missingPreview(row, missingBultos) {
  const missing = Math.max(0, toNumber(missingBultos));
  return {
    units: missingUnits(row, missing),
    price: missingPrice(row, missing),
    unitCost: unitCost(row),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cell !== "")) rows.push(row);
  const headers = rows.shift()?.map(normalize) || [];
  return rows.map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = normalize(cells[index]);
    });
    return record;
  });
}

function rowsFromGviz(table) {
  const headers = table.cols.map((col, index) => normalize(col.label || col.id || `col_${index}`));
  return table.rows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      const cell = row.c?.[index];
      record[header] = normalize(cell?.f ?? cell?.v ?? "");
    });
    return record;
  });
}

function sheetUrl(sheetName, options = {}) {
  const url = new URL(GVIZ_URL);
  url.searchParams.set("sheet", sheetName);
  if (options.csv) url.searchParams.set("tqx", "out:csv");
  return url;
}

function loadSheetViaJsonp(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = `__palletSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo agotado leyendo Google Sheets."));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.status === "ok" && payload.table) {
        resolve(rowsFromGviz(payload.table));
      } else {
        reject(new Error(payload?.errors?.[0]?.detailed_message || "Google Sheets no devolvio data valida."));
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("No se pudo conectar con Google Sheets."));
    };

    const url = sheetUrl(sheetName);
    url.searchParams.set("tqx", `responseHandler:${callbackName}`);
    url.searchParams.set("cacheBust", Date.now());
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function loadReportViaJsonp() {
  return callReportApi("list").then((payload) => payload.rows || []);
}

function loadImpactHistoryViaJsonp() {
  return callReportApi("listImpact").then((payload) => payload.rows || []);
}

function callReportApi(action, params = {}) {
  if (action === "create" || action === "updateStatus" || action === "deleteIncidents" || action === "saveImpact") {
    return callReportApiPost(action, params).catch(() => callReportApiJsonp(action, params));
  }
  return callReportApiJsonp(action, params);
}

async function callReportApiPost(action, params = {}) {
  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...params }),
    redirect: "follow",
  });
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(payload?.message || "No se pudo conectar con el reporte.");
  }
  return payload;
}

function callReportApiJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `__palletReport_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let settled = false;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo agotado conectando con el reporte."));
    }, 20000);

    function cleanup() {
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("error", handleScriptExecutionError, true);
      script.remove();
      delete window[callbackName];
    }

    function fail(error) {
      if (settled) return;
      cleanup();
      reject(error);
    }

    function handleScriptExecutionError(event) {
      if (event.filename && event.filename !== script.src) return;
      event.preventDefault();
      fail(new Error(event.message || "El Apps Script devolvio un error al leer el reporte."));
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.ok) {
        resolve(payload);
      } else {
        reject(new Error(payload?.message || "No se pudo conectar con el reporte."));
      }
    };

    script.onerror = () => {
      fail(new Error("No se pudo conectar con el reporte."));
    };

    const url = new URL(REPORT_ENDPOINT);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("cacheBust", Date.now());
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    script.src = url.toString();
    window.addEventListener("error", handleScriptExecutionError, true);
    document.body.appendChild(script);
  });
}

async function loadReportIncidents(options = {}) {
  const silent = Boolean(options.silent);
  if (!REPORT_ENDPOINT) return;
  state.reportStatus = silent ? state.reportStatus : "loading";
  state.reportError = "";
  if (!silent) render();
  try {
    const previousSignature = JSON.stringify(state.incidents);
    const [remoteRows] = await Promise.all([
      loadReportViaJsonp(),
      canViewSupervisorReport() ? loadSentRows({ silent: true }) : Promise.resolve(),
      canViewSupervisorReport() ? loadCargoRows({ silent: true }) : Promise.resolve(),
      canViewSupervisorReport() ? loadOperationalRows({ silent: true }) : Promise.resolve(),
      canViewSupervisorReport() ? loadImpactHistory({ silent: true }) : Promise.resolve(),
    ]);
    const nextIncidents = remoteRows.map(normalizeIncidentForExport).filter(isCleanIncident);
    const nextSignature = JSON.stringify(nextIncidents);
    const activeElement = document.activeElement;
    const isEditing = silent && activeElement && activeElement.matches("input, select, textarea");
    const windowScroll = window.scrollY;
    const historyScroll = document.querySelector(".history-list")?.scrollTop || 0;

    state.incidents = nextIncidents;
    state.reportStatus = "ready";
    if (silent && (isEditing || previousSignature === nextSignature)) return;
    render();
    window.requestAnimationFrame(() => {
      window.scrollTo(0, windowScroll);
      const historyList = document.querySelector(".history-list");
      if (historyList) historyList.scrollTop = historyScroll;
    });
    return;
  } catch (error) {
    if (silent) return;
    state.reportStatus = "error";
    state.reportError = "No se pudo refrescar el reporte en este momento. La app sigue funcionando; intenta actualizar nuevamente.";
    toast("No se pudo refrescar el reporte.");
  }
  render();
}

async function loadOperationalRows(options = {}) {
  const force = Boolean(options.force);
  if (!force && state.rows.length && state.productCosts.size) return;
  try {
    const [cartonRows, productRows] = await Promise.all([
      loadSheetRows(SHEETS.cartons),
      loadSheetRows(SHEETS.products),
    ]);
    state.productCosts = buildProductCosts(productRows);
    state.rows = cartonRows
      .filter((row) => row.Codigo || row["Nro LPN"] || row["Nro Pallet"])
      .map((row) => ({
        ...row,
        _costoUnidad: state.productCosts.get(normalize(row.Codigo)) || 0,
      }));
    state.groupCacheMode = "";
    state.groupCache = [];
  } catch (error) {
    if (!options.silent) throw error;
  }
}

async function loadImpactHistory(options = {}) {
  const silent = Boolean(options.silent);
  if (!canViewSupervisorReport()) return;
  state.impactStatus = silent ? state.impactStatus : "loading";
  state.impactError = "";
  try {
    state.impactHistory = (await loadImpactHistoryViaJsonp()).map(normalizeImpactHistoryRow);
    state.impactStatus = "ready";
  } catch (error) {
    state.impactStatus = "error";
    state.impactError = "No se pudo leer el historico de impacto en este momento.";
    if (!silent) toast("No se pudo leer Impacto_Turnos.");
  }
}

function startReportAutoRefresh() {
  if (reportRefreshTimer || !canViewSupervisorReport()) return;
  reportRefreshTimer = window.setInterval(() => loadReportIncidents({ silent: true }), REPORT_REFRESH_MS);
}

function stopReportAutoRefresh() {
  if (!reportRefreshTimer) return;
  window.clearInterval(reportRefreshTimer);
  reportRefreshTimer = null;
}

async function loadSheetRows(sheetName) {
  try {
    return await loadSheetViaJsonp(sheetName);
  } catch (jsonpError) {
    const url = sheetUrl(sheetName, { csv: true });
    url.searchParams.set("cacheBust", Date.now());
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo leer la hoja (${response.status})`);
    return parseCsv(await response.text());
  }
}

async function loadSentRows(options = {}) {
  const silent = Boolean(options.silent);
  if (!canViewSupervisorReport()) return;
  state.sentStatus = silent ? state.sentStatus : "loading";
  state.sentError = "";
  try {
    state.sentRows = (await loadSheetRows(SHEETS.sent)).map(normalizeSentRow).filter((row) => row.pallet);
    state.sentStatus = "ready";
  } catch (error) {
    state.sentStatus = "error";
    state.sentError = "No se pudo leer la hoja ENVIADO en este momento.";
    if (!silent) toast("No se pudo leer ENVIADO.");
  }
}

async function loadCargoRows(options = {}) {
  const silent = Boolean(options.silent);
  if (!canViewSupervisorReport()) return;
  state.cargoStatus = silent ? state.cargoStatus : "loading";
  state.cargoError = "";
  try {
    state.cargoRows = (await loadSheetRows(SHEETS.cargo)).map(normalizeCargoRow).filter((row) => row.carga);
    state.cargoStatus = "ready";
  } catch (error) {
    state.cargoStatus = "error";
    state.cargoError = "No se pudo leer la hoja CARGA en este momento.";
    if (!silent) toast("No se pudo leer CARGA.");
  }
}

function buildProductCosts(rows) {
  return new Map(
    rows
      .map((row) => [
        normalize(field(row, ["Cod Barra", "Cod. Barra", "CodBarra", "Codigo", "Código"])),
        toNumber(field(row, ["Costo Unidad", "Costo unidad", "Costo Unitario", "Costo", "Precio"])),
      ])
      .filter(([code, cost]) => code && cost > 0),
  );
}

function groupRows(rows, mode = "pallet") {
  const map = new Map();
  rows.forEach((row, index) => {
    const pallet = normalize(row["Nro Pallet"]) || "SIN PALLET";
    const lpn = normalize(row["Nro LPN"]) || "SIN LPN";
    const product = normalize(row.Codigo || row.Estilo || row["Descrip ArtÃ­c"]) || "SIN PRODUCTO";
    const key = mode === "lpn" ? lpn : mode === "codigo" ? product : pallet;
    if (!map.has(key)) {
      map.set(key, {
        key,
        mode,
        pallet,
        lpn,
        rows: [],
        lpns: new Set(),
        pallets: new Set(),
        destino: normalize(row.Destino),
      });
    }
    const group = map.get(key);
    group.rows.push({ ...row, _rowId: `row-${index}` });
    group.lpns.add(lpn);
    group.pallets.add(pallet);
  });

  return [...map.values()]
    .map((group) => ({
      ...group,
      lpns: [...group.lpns],
      pallets: [...group.pallets],
      unidades: group.rows.reduce((sum, row) => sum + toNumber(row.UnAct), 0),
      bultos: group.rows.reduce((sum, row) => sum + bultos(row), 0),
    }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

function filteredGroups() {
  const q = state.query.trim().toLowerCase();
  if (!q) return [];
  const base = baseGroups();

  return base
    .filter((group) =>
      group.rows.some((row) => {
        const haystack = [
          row["Nro Pallet"],
          row["Nro LPN"],
          row.Codigo,
          row.Estilo,
          row["Descrip ArtÃ­c"],
          row.Destino,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return haystack.includes(q);
      }),
    )
    .slice(0, 12);
}

function baseGroups() {
  if (state.groupCacheMode !== state.selectedMode) {
    state.groupCache = groupRows(state.rows, state.selectedMode);
    state.groupCacheMode = state.selectedMode;
  }
  return state.groupCache;
}

function selectedGroup() {
  if (!state.selectedKey) return null;
  const groups = filteredGroups();
  return groups.find((group) => group.key === state.selectedKey) || null;
}

async function loadData() {
  state.status = "loading";
  state.error = "";
  state.tableQuery = "";
  render();
  try {
    await loadOperationalRows({ force: true });
    state.status = "ready";
    state.selectedKey = "";
    state.groupCacheMode = "";
    state.groupCache = [];
    render();
    loadReportIncidents({ silent: true });
  } catch (error) {
    state.status = "error";
    state.error = error.message || "No se pudo cargar la Google Sheet.";
    render();
  }
}

function setMode(mode) {
  state.selectedMode = mode;
  state.selectedKey = "";
  state.tableQuery = "";
  state.groupCacheMode = "";
  state.groupCache = [];
  render();
}

function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const user = normalize(form.get("user"));
  const pass = normalize(form.get("pass"));
  const found = USERS.find((item) => item.user === user && item.pass === pass);
  if (!found) {
    toast("Usuario o clave incorrectos.");
    return;
  }
  state.user = { user: found.user, role: found.role, at: new Date().toISOString() };
  if (found.role === "Invitado") {
    state.supervisorView = "report";
    state.reportModule = "summary";
  }
  saveJson(STORAGE_KEYS.session, state.user);
  render();
  if (canViewSupervisorReport()) {
    if (state.supervisorView) loadReportIncidents();
  } else if (state.validatorView) {
    loadData();
  }
}

function chooseValidatorView(view) {
  state.validatorView = view;
  localStorage.setItem(STORAGE_KEYS.validatorView, view);
  render();
  if (!state.rows.length) {
    loadData();
  } else {
    render();
  }
}

function changeValidatorView() {
  state.validatorView = "";
  localStorage.removeItem(STORAGE_KEYS.validatorView);
  state.selectedKey = "";
  state.tableQuery = "";
  render();
}

function chooseSupervisorView(view) {
  state.supervisorView = view;
  localStorage.setItem(STORAGE_KEYS.supervisorView, view);
  startReportAutoRefresh();
  render();
  loadReportIncidents({ silent: true });
}

function changeSupervisorView() {
  if (!canManageIncidents()) return;
  state.supervisorView = "";
  localStorage.removeItem(STORAGE_KEYS.supervisorView);
  render();
}

function logout() {
  stopReportAutoRefresh();
  localStorage.removeItem(STORAGE_KEYS.session);
  state.user = null;
  render();
}

function resetPage() {
  state.query = "";
  state.selectedKey = "";
  state.selectedMode = "pallet";
  state.validations = {};
  state.missingModalRowKey = "";
  state.groupCacheMode = "";
  state.groupCache = [];
  saveJson(STORAGE_KEYS.validations, state.validations);
  toast("Validaciones reiniciadas. Las incidencias se leen desde el reporte.");
  render();
}

function renderValidatorViewPicker() {
  app.innerHTML = `
    <section class="login-shell">
      <div class="login-card view-card">
        <div class="view-hero">
          <div class="brand-mark">SGE</div>
          <div>
            <span class="eyebrow">Validador de pallets</span>
            <h1>Escoge la vista</h1>
          </div>
        </div>
        <div class="view-options">
          <button class="view-option" data-validator-view="mobile">
            <strong>Vista movil</strong>
          </button>
          <button class="view-option" data-validator-view="desktop">
            <strong>Vista escritorio</strong>
          </button>
        </div>
        <button class="btn ghost" id="logoutBtn">Salir</button>
      </div>
    </section>
  `;
  document.querySelector("#logoutBtn").addEventListener("click", logout);
  document.querySelectorAll("[data-validator-view]").forEach((button) => {
    button.addEventListener("click", () => chooseValidatorView(button.dataset.validatorView));
  });
}

function renderSupervisorViewPicker() {
  app.innerHTML = `
    <section class="login-shell">
      <div class="login-card view-card supervisor-view-card">
        <div class="view-hero">
          <div class="brand-mark">SGE</div>
          <div>
            <span class="eyebrow">Supervisor</span>
            <h1>Escoge la vista</h1>
          </div>
        </div>
        <div class="view-options">
          <button class="view-option" data-supervisor-view-choice="data">
            <strong>Data</strong>
          </button>
          <button class="view-option" data-supervisor-view-choice="report">
            <strong>Reporte</strong>
          </button>
        </div>
        <button class="btn ghost" id="logoutBtn">Salir</button>
      </div>
    </section>
  `;
  document.querySelector("#logoutBtn").addEventListener("click", logout);
  document.querySelectorAll("[data-supervisor-view-choice]").forEach((button) => {
    button.addEventListener("click", () => chooseSupervisorView(button.dataset.supervisorViewChoice));
  });
}

function validationKey(row) {
  return `${row["Nro Pallet"] || "SIN PALLET"}|${row["Nro LPN"] || "SIN LPN"}|${row.Codigo}|${row.Estilo}|${row._rowId}`;
}

function productKey(row, scope = "lpn") {
  return [
    row["Nro Pallet"] || "SIN PALLET",
    scope === "pallet" ? "TODO-EL-PALLET" : row["Nro LPN"] || "SIN LPN",
    row.Codigo || "",
    row.Estilo || "",
    row["Descrip ArtÃ­c"] || "",
  ].join("|");
}

function consolidateProductRows(rows, scope = "lpn") {
  const map = new Map();
  rows.forEach((row) => {
    const key = productKey(row, scope);
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        _rowId: `sum-${key}`,
        _sourceRows: 0,
        _lpns: new Set(),
        _pallets: new Set(),
        _undCajas: new Set(),
        _bultosTotal: 0,
        _costoUnidad: unitCost(row),
        UnAct: "0",
      });
    }
    const item = map.get(key);
    item.UnAct = String(toNumber(item.UnAct) + toNumber(row.UnAct));
    item._bultosTotal += bultos(row);
    item._sourceRows += 1;
    item._lpns.add(row["Nro LPN"] || "SIN LPN");
    item._pallets.add(row["Nro Pallet"] || "SIN PALLET");
    item._undCajas.add(row["Und x Caja"] || "");
    if (!item._costoUnidad && unitCost(row)) item._costoUnidad = unitCost(row);

    if (row["LPN Fe Y Hr Modif"] > item["LPN Fe Y Hr Modif"]) {
      item["LPN Fe Y Hr Modif"] = row["LPN Fe Y Hr Modif"];
    }
  });
  return [...map.values()].map((row) => ({
    ...row,
    "Nro LPN": [...row._lpns].join(", "),
    "Nro Pallet": [...row._pallets].join(", "),
    "Und x Caja": [...row._undCajas].filter(Boolean).join(", "),
  }));
}

function rowHasReportIncident(row) {
  const rowPallets = normalize(row["Nro Pallet"]).split(",").map(normalize).filter(Boolean);
  const rowLpns = normalize(row["Nro LPN"]).split(",").map(normalize).filter(Boolean);
  const rowCode = normalize(row.Codigo);
  if (!rowCode) return false;

  return state.incidents.some((incident) => {
    const normalized = normalizeIncidentForExport(incident);
    const sameCode = normalize(normalized.codigos) === rowCode;
    const samePallet = rowPallets.includes(normalize(normalized.pallet));
    const sameLpn = rowLpns.includes(normalize(normalized.lpn));
    return sameCode && (samePallet || sameLpn);
  });
}

function markOk(row) {
  const key = validationKey(row);
  state.validations[key] = {
    found: Number(bultos(row).toFixed(2)),
    status: "ok",
    at: new Date().toISOString(),
    user: state.user.user,
  };
  saveJson(STORAGE_KEYS.validations, state.validations);
  render();
}

function openMissingModal(rowKey) {
  state.missingModalRowKey = rowKey;
  render();
}

function closeMissingModal() {
  state.missingModalRowKey = "";
  render();
}

async function reportIncident(row, missingBultosValue) {
  const key = validationKey(row);
  const expectedBultos = bultos(row);
  const missing = Math.max(0, toNumber(missingBultosValue));
  const incidentPrice = missingPrice(row, missing);
  const rowTotalPrice = totalPrice(row);

  if (!missing) {
    toast("Ingresa la cantidad de bultos faltantes.");
    return;
  }

  if (missing > expectedBultos) {
    toast("El faltante no puede ser mayor que los bultos esperados.");
    return;
  }

  if (rowTotalPrice > 0 && incidentPrice <= 0) {
    toast("No se pudo calcular el precio del faltante. Revisa el costo del producto.");
    return;
  }

  const incident = {
    id: makeId(),
    fecha_incidente: new Date().toLocaleString("es-PE"),
    tienda: row.Destino || "",
    pallet: row["Nro Pallet"] || "",
    lpn: row["Nro LPN"] || "",
    codigos: row.Codigo || "",
    descripcion: row["Descrip ArtÃ­c"] || "",
    bultos: missing.toFixed(2),
    precio: incidentPrice.toFixed(2),
    estado: "Pendiente",
  };

  state.missingModalRowKey = "";
  render();

  if (REPORT_ENDPOINT) {
    try {
      await callReportApi("create", incident);
      state.validations[key] = {
        found: Number(Math.max(0, expectedBultos - missing).toFixed(2)),
        missing: Number(missing.toFixed(2)),
        status: "reported",
        at: new Date().toISOString(),
        user: state.user.user,
      };
      saveJson(STORAGE_KEYS.validations, state.validations);
      localStorage.setItem(STORAGE_KEYS.reportPing, String(Date.now()));
      toast("Incidencia enviada al reporte.");
      loadReportIncidents({ silent: true });
    } catch {
      toast("No se pudo enviar la incidencia al Google Sheet.");
      render();
    }
  } else {
    toast("No hay endpoint de reporte configurado.");
    render();
  }
}

function validateAll(group) {
  consolidateProductRows(group.rows, group.mode === "pallet" ? "pallet" : "lpn").forEach((row) => {
    const key = validationKey(row);
    state.validations[key] = {
      found: Number(bultos(row).toFixed(2)),
      status: "ok",
      at: new Date().toISOString(),
      user: state.user.user,
    };
  });
  saveJson(STORAGE_KEYS.validations, state.validations);
  render();
  toast("Productos del grupo marcados como validados.");
}

function exportIncidents() {
  const validIncidents = state.incidents.map(normalizeIncidentForExport).filter(isCleanIncident);
  if (!validIncidents.length) {
    toast("Todavia no hay incidencias para exportar.");
    return;
  }
  const headers = [
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
  ];
  const tableRows = validIncidents.map((normalized) => {
    return `<tr>${headers.map((header) => `<td>${escapeHtml(normalized[header])}</td>`).join("")}</tr>`;
  });
  const html = `
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows.join("")}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `incidencias-pallets-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadExcelFile(filename, headers, rows) {
  const tableRows = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`).join("")}</tr>`);
  const html = `
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows.join("")}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSentReport() {
  const rows = filteredSentIncidentRows(sentIncidentRows());
  if (!rows.length) {
    toast("No hay data filtrada para exportar.");
    return;
  }
  const headers = [
    "estado_envio",
    "tienda_envio",
    "pallet",
    "lpn",
    "codigo",
    "descripcion",
    "estado_incidencia",
    "bultos",
    "costo_bruto",
    "costo_neto",
    "costo_descontado",
    "fecha_incidencia",
    "fecha_regularizado",
    "nro_carga",
    "placa",
    "chofer",
    "fecha_envio",
    "paletas_carga",
  ];
  const tableRows = rows.map((row) => {
    const shipment = row._shipment || {};
    const regularized = row.estado === "Regularizado";
    return {
      estado_envio: row._sent ? "Enviado" : "En CD",
      tienda_envio: shipment.tienda || row.tienda || "",
      pallet: row.pallet || "",
      lpn: row.lpn || "",
      codigo: row.codigos || "",
      descripcion: row.descripcion || "",
      estado_incidencia: row.estado || "",
      bultos: row._bultos.toFixed(2),
      costo_bruto: money(row._precio),
      costo_neto: money(regularized ? 0 : row._precio),
      costo_descontado: regularized ? money(row._precio) : "0.00",
      fecha_incidencia: row.fecha_incidente || "",
      fecha_regularizado: row.fecha_regularizado || "",
      nro_carga: shipment.carga || "",
      placa: shipment.placa || "",
      chofer: shipment.chofer || "",
      fecha_envio: shipment.fechaDespacho || "",
      paletas_carga: shipment.paletasCarga || "",
    };
  });
  downloadExcelFile(`reporte-enviado-filtrado-${new Date().toISOString().slice(0, 10)}.xls`, headers, tableRows);
}

function normalizeIncidentForExport(row) {
  const estado = normalize(row.estado) === "Regularizado" ? "Regularizado" : "Pendiente";
  const bultosValue = row.bultos ?? row.bultosFaltantes ?? row.faltante ?? "";
  const precioValue = row.precio ?? row.costo ?? row.importe ?? "";
  const bultosNumber = toNumber(bultosValue);
  const precioNumber = priceToNumber(precioValue);
  return {
    id: row.id || "",
    tienda: row.tienda || row.destino || "",
    pallet: row.pallet || row.nroPallet || "",
    lpn: row.lpn || row.nroLpn || "",
    codigos: row.codigos || row.codigo || "",
    descripcion: row.descripcion && !["Pendiente", "Regularizado"].includes(row.descripcion) ? row.descripcion : row.codigos || row.codigo || "",
    bultos: bultosNumber > 0 ? bultosNumber.toFixed(2) : bultosValue,
    precio: precioNumber > 0 ? precioNumber.toFixed(2) : precioValue,
    estado,
    fecha_incidente: row.fecha_incidente || row.fechaIncidente || row.fechaReporte || row.createdAt || "",
    fecha_regularizado: row.fecha_regularizado || row.fechaRegularizado || "",
  };
}

function isCleanIncident(row) {
  return (
    row.tienda &&
    row.pallet &&
    row.lpn &&
    row.codigos &&
    row.descripcion &&
    Number.isFinite(toNumber(row.bultos)) &&
    toNumber(row.bultos) > 0 &&
    !String(row.tienda).includes("-") &&
    !String(row.pallet).startsWith("CT") &&
    !/^\d{10,}$/.test(String(row.lpn))
  );
}

function updateIncidentStatus(id, estado) {
  const incident = state.incidents.find((item) => String(item.id) === String(id));
  if (incident) {
    incident.estado = estado;
    incident.fecha_regularizado = estado === "Regularizado" ? new Date().toLocaleString("es-PE") : "";
    render();
  }

  if (REPORT_ENDPOINT) {
    callReportApi("updateStatus", { id, estado })
      .then(() => toast("Estado actualizado en el reporte."))
      .catch(() => toast("No se pudo actualizar el estado en Google Sheet."));
  }
}

function toggleIncidentSelection(id, checked) {
  if (checked) {
    state.selectedIncidentIds.add(String(id));
  } else {
    state.selectedIncidentIds.delete(String(id));
  }
}

async function deleteSelectedIncidents() {
  const ids = [...state.selectedIncidentIds];
  if (!ids.length) {
    toast("Selecciona una o mas incidencias.");
    return;
  }
  if (!window.confirm(`Eliminar ${ids.length} incidencia(s) del Google Sheet?`)) return;

  try {
    await callReportApi("deleteIncidents", { ids: JSON.stringify(ids) });
    state.selectedIncidentIds.clear();
    state.incidents = state.incidents.filter((item) => !ids.includes(String(item.id)));
    toast("Incidencias eliminadas del reporte.");
    render();
    loadReportIncidents({ silent: true });
  } catch {
    toast("No se pudo eliminar en Google Sheet.");
  }
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3300);
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-shell">
      <form class="login-card" id="loginForm">
        <div class="brand-mark">SGE</div>
        <h1>SGE Pallets</h1>
        <div class="form-row">
          <label for="user">Usuario</label>
          <input id="user" name="user" autocomplete="username" required />
        </div>
        <div class="form-row">
          <label for="pass">Clave</label>
          <input id="pass" name="pass" type="password" autocomplete="current-password" required />
        </div>
        <div class="form-row">
          <button class="btn primary" type="submit">Ingresar</button>
        </div>
        
      </form>
    </section>
  `;
  document.querySelector("#loginForm").addEventListener("submit", login);
}

function renderApp() {
  if (canViewSupervisorReport()) {
    startReportAutoRefresh();
    renderSupervisorApp();
    return;
  }
  if (!state.validatorView) {
    stopReportAutoRefresh();
    renderValidatorViewPicker();
    return;
  }
  stopReportAutoRefresh();

  const groups = filteredGroups();
  const group = selectedGroup();
  const lpns = new Set(state.rows.map((row) => row["Nro LPN"]).filter(Boolean)).size;
  const pallets = new Set(state.rows.map((row) => row["Nro Pallet"]).filter(Boolean)).size;

  app.innerHTML = `
    <section class="app-shell validator-${escapeAttr(state.validatorView)}">
      <header class="topbar">
        <div class="topbar-title">
          <div class="brand-mark">SGE</div>
          <div>
            <strong>SGE Validacion de Pallets y Cartones</strong>
            <div class="muted">${state.user.role} · ${state.user.user}</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="btn ghost" id="changeViewBtn">Cambiar vista</button>
          <button class="btn ghost" id="logoutBtn">Salir</button>
        </div>
      </header>
      <div class="layout">
        <section class="search-panel">
          <div class="search-title">
            <h2>Busqueda</h2>
            <div class="status-grid">
              <div class="metric"><strong>${pallets}</strong><span class="muted">Pallets</span></div>
              <div class="metric"><strong>${lpns}</strong><span class="muted">LPN</span></div>
              <div class="metric"><strong>${state.rows.length}</strong><span class="muted">Lineas</span></div>
              <div class="metric"><strong>${state.incidents.length}</strong><span class="muted">Incidencias</span></div>
            </div>
          </div>
          <div class="search-controls">
            <div class="tabs">
              <button class="tab ${state.selectedMode === "pallet" ? "active" : ""}" data-mode="pallet">Pallet</button>
              <button class="tab ${state.selectedMode === "lpn" ? "active" : ""}" data-mode="lpn">LPN</button>
              <button class="tab ${state.selectedMode === "codigo" ? "active" : ""}" data-mode="codigo">Producto</button>
            </div>
            <div class="filters">
              <input id="query" value="${escapeHtml(state.query)}" placeholder="Pallet, LPN, codigo, estilo o descripcion" />
              <button class="btn primary" id="reloadBtn">Actualizar data</button>
              <button class="btn ghost" id="resetBtn">Reiniciar</button>
            </div>
            ${state.status === "loading" ? `<p class="notice">Cargando Google Sheet...</p>` : ""}
            ${state.status === "error" ? `<p class="notice">${escapeHtml(state.error)}</p>` : ""}
          </div>
          <div id="searchResults">
            ${renderSearchResults(groups)}
          </div>
        </section>
        <section>
          <div class="workbench" id="workbench">
            ${group ? renderGroup(group) : renderEmpty()}
          </div>
        </section>
      </div>
      ${renderMissingModal()}
    </section>
  `;

  bindAppEvents(group);
}

function renderSupervisorApp() {
  if (state.user.role === "Invitado") {
    state.supervisorView = "report";
  }
  if (!state.supervisorView) {
    renderSupervisorViewPicker();
    return;
  }

  app.innerHTML = `
    <section class="app-shell">
      <header class="topbar">
        <div class="topbar-title">
          <div class="brand-mark">SGE</div>
          <div>
            <strong>SGE Validacion de Pallets y Cartones</strong>
            <div class="muted">${state.user.role} · ${state.user.user}</div>
          </div>
        </div>
        <div class="topbar-actions">
          ${canManageIncidents() ? `<button class="btn ghost" id="changeSupervisorViewBtn">Cambiar vista</button>` : ""}
          <button class="btn ghost" id="logoutBtn">Salir</button>
        </div>
      </header>
      <div class="layout">
        ${state.supervisorView === "report" || state.user.role === "Invitado" ? renderDashboard() : renderHistory()}
      </div>
    </section>
  `;

  bindAppEvents(null);
}

function renderSearchResults(groups) {
  if (!state.query.trim()) {
    return `<div class="search-hint">Busqueda lista.</div>`;
  }
  return `
    <div class="result-summary">
      <strong>${groups.length ? `${groups.length} coincidencias` : "Sin coincidencias"}</strong>
    </div>
    <div class="result-list">
      ${groups.map(renderResultCard).join("") || `<p class="muted">No se encontro data con ese criterio.</p>`}
    </div>
  `;
}

function renderResultCard(group) {
  const active = group.key === state.selectedKey;
  const first = group.rows[0] || {};
  const label = group.mode === "lpn" ? "LPN" : group.mode === "codigo" ? "Producto" : "Pallet";
  return `
    <button class="result-card ${active ? "active" : ""}" data-key="${escapeAttr(group.key)}">
      <strong>${label} ${escapeHtml(group.key)}</strong>
      <span>${escapeHtml(first.Destino || "Sin destino")} · ${group.lpns.length} LPN · ${group.rows.length} lineas</span>
      <small>${group.bultos.toFixed(2)} bultos · ${group.unidades} und</small>
    </button>
  `;
}

function renderGroup(group) {
  const consolidatedRows = consolidateProductRows(group.rows, group.mode === "pallet" ? "pallet" : "lpn");
  const consolidatedUnits = consolidatedRows.reduce((sum, row) => sum + toNumber(row.UnAct), 0);
  const consolidatedBultos = consolidatedRows.reduce((sum, row) => sum + bultos(row), 0);
  const consolidatedCost = consolidatedRows.reduce((sum, row) => sum + totalPrice(row), 0);
  const destinos = [...new Set(group.rows.map((row) => normalize(row.Destino)).filter(Boolean))];
  const destinoLabel = destinos.length ? destinos.slice(0, 4).join(", ") : "Sin destino";

  return `
    <div class="hero-strip">
      <div>
        <h2>${escapeHtml(group.mode === "lpn" ? "LPN" : group.mode === "codigo" ? "Producto" : "Pallet")} ${escapeHtml(group.key)}</h2>
        <p class="muted">Destino ${escapeHtml(destinoLabel)} · ${group.pallets.length} pallet · ${group.lpns.length} LPN · ${consolidatedRows.length} productos · ${consolidatedUnits} unidades · ${consolidatedBultos.toFixed(2)} cartones · Total S/ ${money(consolidatedCost)}</p>
        <div class="chips">
          <span class="chip">Destino ${escapeHtml(destinoLabel)}</span>
          <span class="chip">Total S/ ${money(consolidatedCost)}</span>
          ${group.pallets.map((item) => `<span class="chip">Pallet ${escapeHtml(item)}</span>`).join("")}
          ${group.lpns.slice(0, 8).map((item) => `<span class="chip">LPN ${escapeHtml(item)}</span>`).join("")}
          ${group.lpns.length > 8 ? `<span class="chip">+${group.lpns.length - 8} LPN</span>` : ""}
        </div>
      </div>
      <div class="quick-actions">
        <button class="btn primary" id="validateAllBtn">Validar todos</button>
        <button class="btn warning" id="exportBtn">Exportar incidencias</button>
      </div>
    </div>
    ${renderValidationTable(consolidatedRows)}
  `;
}

function renderValidationTable(rows) {
  if (state.validatorView === "mobile") {
    return renderMobileValidationList(rows);
  }

  return `
    <section class="lpn-section">
      <div class="lpn-header">
        <div>
          <h3>Hoja de validacion</h3>
          <p class="muted"><span id="tableVisibleCount">${rows.length}</span> de ${rows.length} productos consolidados</p>
        </div>
        <div class="table-search">
          <input id="tableQuery" value="${escapeHtml(state.tableQuery)}" placeholder="Buscar codigo, estilo o descripcion..." />
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Descrip Artic</th>
              <th>UnAct</th>
              <th>Und x Caja</th>
              <th>Bultos</th>
              <th>Precio</th>
              <th>Estado</th>
              <th>Bultos encontrados</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(renderProductRow).join("")}
            <tr id="tableEmptyRow" hidden><td colspan="9" class="empty-row">Sin productos con ese filtro.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMobileValidationList(rows) {
  return `
    <section class="lpn-section mobile-validation">
      <div class="lpn-header">
        <div>
          <h3>Hoja de validacion</h3>
          <p class="muted"><span id="tableVisibleCount">${rows.length}</span> de ${rows.length} productos</p>
        </div>
        <div class="table-search">
          <input id="tableQuery" value="${escapeHtml(state.tableQuery)}" placeholder="Buscar codigo o descripcion..." />
        </div>
      </div>
      <div class="mobile-product-list">
        ${rows.map(renderMobileProductCard).join("")}
        <div id="tableEmptyRow" class="empty-row" hidden>Sin productos con ese filtro.</div>
      </div>
    </section>
  `;
}

function renderMobileProductCard(row) {
  const key = validationKey(row);
  const saved = state.validations[key] || {};
  const hasReportIncident = rowHasReportIncident(row);
  const status = hasReportIncident ? "incidence" : saved.status === "ok" ? "ok" : "pending";
  const statusLabel = status === "incidence" ? "Incidencia" : status === "ok" ? "Validado" : "Pendiente";
  const searchText = [row.Codigo, row["Descrip ArtÃ­c"]].join(" ").toLowerCase();

  return `
    <article class="mobile-product-card ${status}" data-row="${escapeAttr(key)}" data-table-search="${escapeAttr(searchText)}">
      <div class="mobile-product-main">
        <span class="mobile-status">${statusLabel}</span>
        <strong>${escapeHtml(row.Codigo)}</strong>
        <p>${escapeHtml(row["Descrip ArtÃ­c"])}</p>
        <div class="mobile-bultos">
          <span>Bultos</span>
          <b>${bultos(row).toFixed(2)}</b>
        </div>
        <div class="mobile-price">
          <span>Precio</span>
          <b>S/ ${money(totalPrice(row))}</b>
        </div>
      </div>
      <div class="mobile-product-actions">
        <button class="btn compact primary" data-ok="${escapeAttr(key)}">OK</button>
        <button class="btn compact danger" data-incident="${escapeAttr(key)}">Faltante</button>
      </div>
    </article>
  `;
}

function renderProductRow(row) {
  const key = validationKey(row);
  const saved = state.validations[key] || {};
  const expected = toNumber(row.UnAct);
  const expectedBultos = bultos(row);
  const found = Number(expectedBultos.toFixed(2));
  const hasReportIncident = rowHasReportIncident(row);
  const status = hasReportIncident ? "incidence" : saved.status === "ok" ? "ok" : "pending";
  const statusLabel = status === "incidence" ? "Incidencia" : status === "ok" ? "Validado" : "Pendiente";
  const searchText = [row.Codigo, row.Estilo, row["Descrip ArtÃ­c"]].join(" ").toLowerCase();
  return `
    <tr data-row="${escapeAttr(key)}" data-table-search="${escapeAttr(searchText)}">
      <td>${escapeHtml(row.Codigo)}</td>
      <td class="desc">${escapeHtml(row["Descrip ArtÃ­c"])}</td>
      <td>${expected}</td>
      <td>${escapeHtml(row["Und x Caja"])}</td>
      <td>${expectedBultos.toFixed(2)}</td>
      <td>S/ ${money(totalPrice(row))}</td>
      <td><span class="badge ${status === "ok" ? "ok" : status === "incidence" ? "incidence" : ""}">${statusLabel}</span></td>
      <td class="found-cell">${toNumber(found).toFixed(2)}</td>
      <td class="action-cell">
        <button class="btn compact primary" data-ok="${escapeAttr(key)}">OK</button>
        <button class="btn compact danger" data-incident="${escapeAttr(key)}">Faltante</button>
      </td>
    </tr>
  `;
}

function refreshSearchResultsOnly() {
  const results = document.querySelector("#searchResults");
  const workbench = document.querySelector("#workbench");
  if (!results || !workbench) {
    render();
    return;
  }
  const groups = filteredGroups();
  results.innerHTML = renderSearchResults(groups);
  workbench.innerHTML = renderEmpty();
  state.rowsForBinding = [];
  bindSearchResultEvents();
}

function bindSearchResultEvents() {
  document.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedKey = button.dataset.key;
      state.tableQuery = "";
      render();
    });
  });
}

function filterValidationTable(query) {
  const q = normalize(query).toLowerCase();
  const rows = [...document.querySelectorAll("[data-table-search]")];
  let visible = 0;
  rows.forEach((row) => {
    const match = !q || row.dataset.tableSearch.includes(q);
    row.hidden = !match;
    row.style.display = match ? "" : "none";
    if (match) visible += 1;
  });
  const counter = document.querySelector("#tableVisibleCount");
  if (counter) counter.textContent = visible;
  const empty = document.querySelector("#tableEmptyRow");
  if (empty) empty.hidden = visible > 0;
}

function renderMissingModal() {
  if (!state.missingModalRowKey) return "";
  const row = state.rowsForBinding.find((item) => validationKey(item) === state.missingModalRowKey);
  if (!row) return "";
  const expectedBultos = bultos(row);

  return `
    <div class="modal-backdrop" role="presentation">
      <form class="modal" id="missingForm" role="dialog" aria-modal="true" aria-labelledby="missingTitle">
        <div class="modal-header">
          <div>
            <h2 id="missingTitle">Registrar faltante</h2>
            <p class="muted">${escapeHtml(row.Codigo)} · ${escapeHtml(row["Descrip ArtÃ­c"])}</p>
          </div>
          <button class="btn ghost compact" type="button" id="closeMissingBtn">Cerrar</button>
        </div>
        <div class="modal-summary">
          <div><span>UnAct</span><strong>${escapeHtml(row.UnAct)}</strong></div>
          <div><span>Und x Caja</span><strong>${escapeHtml(row["Und x Caja"])}</strong></div>
          <div><span>Bultos esperados</span><strong>${expectedBultos.toFixed(2)}</strong></div>
          <div><span>Precio total</span><strong>S/ ${money(totalPrice(row))}</strong></div>
        </div>
        <div class="form-row">
          <label for="missingBultos">Bultos faltantes</label>
          <input id="missingBultos" name="missingBultos" type="number" min="0.01" step="0.01" max="${expectedBultos.toFixed(2)}" required />
        </div>
        <div class="missing-cost-preview" id="missingCostPreview">
          <div><span>Unidades faltantes</span><strong>0.00</strong></div>
          <div><span>Precio a reportar</span><strong>S/ 0.00</strong></div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" id="cancelMissingBtn">Cancelar</button>
          <button class="btn danger" type="submit">Guardar faltante</button>
        </div>
      </form>
    </div>
  `;
}

function parseIncidentDate(value) {
  if (value instanceof Date) return value;
  const raw = normalize(value);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,\s*)?(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?\s*(a\.\s*m\.|p\.\s*m\.|AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const meridian = normalize(match[7]).toLowerCase();
  if (meridian.includes("p") && hour < 12) hour += 12;
  if (meridian.includes("a") && hour === 12) hour = 0;
  return new Date(year, Number(match[2]) - 1, Number(match[1]), hour, minute, second);
}

function dateInputValue(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function rowOperationalDate(row) {
  return parseIncidentDate(row?._shipment?.fechaDespacho) || row?._date || null;
}

function normalizeSearch(value) {
  return normalize(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function incidentTurn(date) {
  if (!date) return "sin_fecha";
  const hour = date.getHours();
  if (hour >= 7 && hour < 16) return "dia";
  if (hour >= 16 && hour < 21) return "tarde";
  return "noche";
}

function turnLabel(turn) {
  return {
    todos: "Todos",
    dia: "Dia",
    tarde: "Tarde",
    noche: "Noche",
    sin_fecha: "Sin fecha",
  }[turn] || "Todos";
}

function impactTurn(date) {
  if (!date) return "sin_fecha";
  const hour = date.getHours();
  return hour >= 7 && hour < 19 ? "dia" : "noche";
}

function impactLevel(percent) {
  if (percent >= 2) return "Alto";
  if (percent >= 1) return "Medio";
  return "Bajo";
}

function normalizeImpactHistoryRow(row) {
  return {
    fecha: row.fecha || "",
    turno: row.turno || "",
    pallets_enviados: toNumber(row.pallets_enviados),
    costo_despachado: toNumber(row.costo_despachado),
    incidencias: toNumber(row.incidencias),
    bultos_faltantes: toNumber(row.bultos_faltantes),
    costo_incidencias_bruto: toNumber(row.costo_incidencias_bruto),
    costo_regularizado: toNumber(row.costo_regularizado),
    costo_incidencias_neto: toNumber(row.costo_incidencias_neto),
    pallets_con_incidencia: toNumber(row.pallets_con_incidencia),
    pallets_incidencia_enviados: toNumber(row.pallets_incidencia_enviados),
    pallets_incidencia_cd: toNumber(row.pallets_incidencia_cd),
    costo_incidencias_enviadas_neto: toNumber(row.costo_incidencias_enviadas_neto),
    costo_incidencias_cd_neto: toNumber(row.costo_incidencias_cd_neto),
    porcentaje_impacto: toNumber(row.porcentaje_impacto),
    nivel_impacto: row.nivel_impacto || "",
    fecha_calculo: row.fecha_calculo || "",
    id: row.id || "",
  };
}

function shipmentDate(shipment) {
  return parseIncidentDate(shipment?.fechaDespacho) || parseIncidentDate(shipment?.hora);
}

function sentLineCode(row) {
  return normalize(field(row.raw || row, ["Codigo", "Código", "Cod Barra", "Cod. Barra", "CodBarra", "CODIGO", "COD BARRA"]));
}

function sentLineUnits(row) {
  return toNumber(field(row.raw || row, ["UnAct", "UN ACT", "Un Act", "Unidades", "UNIDADES", "Qty", "QTY"]));
}

function sentLineBultos(row) {
  const raw = row.raw || row;
  const explicitBultos = toNumber(field(raw, ["Bultos", "BULTOS", "QtyAsgn Cases", "Cases"]));
  if (explicitBultos > 0) return explicitBultos;
  const units = sentLineUnits(row);
  const unitsPerBox = toNumber(field(raw, ["Und x Caja", "UND X CAJA", "Und Caja", "UxC"]));
  return unitsPerBox > 0 ? units / unitsPerBox : units;
}

function sentLineCost(row) {
  const code = sentLineCode(row);
  const units = sentLineUnits(row);
  const cost = toNumber(state.productCosts.get(code));
  return units * cost;
}

function impactRowsForDate(dateValue) {
  const selectedDate = dateValue || dateInputValue(new Date());
  const cargos = cargoMap();
  const sentMap = sentPalletMap();
  const sentByTurn = {
    dia: { pallets: new Map(), missingCostPallets: new Set(), costo: 0, bultos: 0 },
    noche: { pallets: new Map(), missingCostPallets: new Set(), costo: 0, bultos: 0 },
  };

  state.sentRows.forEach((row) => {
    const shipment = enrichShipmentWithCargo(row, cargos);
    const date = shipmentDate(shipment);
    if (dateInputValue(date) !== selectedDate) return;
    const turn = impactTurn(date);
    if (!sentByTurn[turn]) return;
    const pallet = palletKey(shipment.pallet);
    if (!pallet) return;
    if (!sentByTurn[turn].pallets.has(pallet)) sentByTurn[turn].pallets.set(pallet, shipment);
    const lineCost = sentLineCost(row);
    sentByTurn[turn].costo += lineCost;
    sentByTurn[turn].bultos += sentLineBultos(row);
    if (lineCost <= 0) sentByTurn[turn].missingCostPallets.add(pallet);
  });

  const incidentsByTurn = {
    dia: { rows: [], sentRows: [], cdRows: [], bruto: 0, regularizado: 0, neto: 0, enviadoNeto: 0, cdNeto: 0, bultos: 0, pallets: new Set(), sentPallets: new Set(), cdPallets: new Set() },
    noche: { rows: [], sentRows: [], cdRows: [], bruto: 0, regularizado: 0, neto: 0, enviadoNeto: 0, cdNeto: 0, bultos: 0, pallets: new Set(), sentPallets: new Set(), cdPallets: new Set() },
  };

  allDashboardRows().forEach((row) => {
    if (dateInputValue(row._date) !== selectedDate) return;
    const turn = impactTurn(row._date);
    if (!incidentsByTurn[turn]) return;
    const incident = incidentsByTurn[turn];
    const pallet = palletKey(row.pallet);
    const matches = (sentMap.get(pallet) || []).map((shipment) => enrichShipmentWithCargo(shipment, cargos));
    const shipment = matches[0] || null;
    const isSent = Boolean(shipment);
    const enriched = {
      ...row,
      _sent: isSent,
      _shipment: shipment,
    };
    incident.rows.push(enriched);
    incident.bruto += row._precio;
    incident.bultos += row._bultos;
    if (pallet) incident.pallets.add(pallet);
    if (row.estado === "Regularizado") {
      incident.regularizado += row._precio;
    } else {
      incident.neto += row._precio;
      if (isSent) {
        incident.sentRows.push(enriched);
        incident.enviadoNeto += row._precio;
        if (pallet) incident.sentPallets.add(pallet);
      } else {
        incident.cdRows.push(enriched);
        incident.cdNeto += row._precio;
        if (pallet) incident.cdPallets.add(pallet);
      }
    }
  });

  return ["dia", "noche"].map((turn) => {
    const sent = sentByTurn[turn];
    const incidents = incidentsByTurn[turn];
    const percent = sent.costo > 0 ? (incidents.neto / sent.costo) * 100 : 0;
    return {
      fecha: selectedDate,
      turno: turnLabel(turn),
      turnKey: turn,
      pallets_enviados: sent.pallets.size,
      costo_despachado: sent.costo,
      bultos_despachados: sent.bultos,
      pallets_sin_costo: sent.missingCostPallets.size,
      pallets_con_incidencia: incidents.pallets.size,
      pallets_incidencia_enviados: incidents.sentPallets.size,
      pallets_incidencia_cd: incidents.cdPallets.size,
      incidencias: incidents.rows.length,
      bultos_faltantes: incidents.bultos,
      costo_incidencias_bruto: incidents.bruto,
      costo_regularizado: incidents.regularizado,
      costo_incidencias_neto: incidents.neto,
      costo_incidencias_enviadas_neto: incidents.enviadoNeto,
      costo_incidencias_cd_neto: incidents.cdNeto,
      porcentaje_impacto: percent,
      nivel_impacto: impactLevel(percent),
      incidentRows: incidents.rows,
    };
  });
}

async function saveImpactSnapshot() {
  if (!canManageIncidents()) return;
  const rows = impactRowsForDate(state.impactDate || dateInputValue(new Date()));
  state.impactSaving = true;
  render();
  try {
    const payloadRows = rows.map((row) => ({
      fecha: row.fecha,
      turno: row.turno,
      pallets_enviados: row.pallets_enviados,
      costo_despachado: row.costo_despachado.toFixed(2),
      incidencias: row.incidencias,
      bultos_faltantes: row.bultos_faltantes.toFixed(2),
      costo_incidencias_bruto: row.costo_incidencias_bruto.toFixed(2),
      costo_regularizado: row.costo_regularizado.toFixed(2),
      costo_incidencias_neto: row.costo_incidencias_neto.toFixed(2),
      pallets_con_incidencia: row.pallets_con_incidencia,
      pallets_incidencia_enviados: row.pallets_incidencia_enviados,
      pallets_incidencia_cd: row.pallets_incidencia_cd,
      costo_incidencias_enviadas_neto: row.costo_incidencias_enviadas_neto.toFixed(2),
      costo_incidencias_cd_neto: row.costo_incidencias_cd_neto.toFixed(2),
      porcentaje_impacto: row.porcentaje_impacto.toFixed(4),
      nivel_impacto: row.nivel_impacto,
      fecha_calculo: new Date().toLocaleString("es-PE"),
    }));
    const response = await callReportApi("saveImpact", { rows: JSON.stringify(payloadRows) });
    toast(`Historico actualizado: ${response.saved || payloadRows.length} turnos.`);
    await loadImpactHistory({ silent: true });
  } catch (error) {
    toast("No se pudo guardar el historico de impacto.");
  } finally {
    state.impactSaving = false;
    render();
  }
}

function palletKey(value) {
  return normalize(value).toUpperCase().replace(/\s+/g, "");
}

function cargoKey(value) {
  return normalize(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeSentRow(row) {
  const fechaDespacho = field(row, [
    "Fe y Hr de Despacho",
    "FECHA DESPACHO",
    "Fecha Despacho",
    "FECHA_DESPACHO",
    "LPN Fe Y Hr Modif",
    "LPN Fe y Hr Modif",
    "Hora de asignación de carga",
    "Hora de asignacion de carga",
    "Fe Hr Packing",
    "Fe Hr Crea Asign",
    "Fecha",
    "FECHA",
  ]);
  return {
    raw: row,
    pallet: field(row, ["Nro Pallet", "NroPallet", "NRO PALLET", "PALLET", "Pallet", "Nro pallet"]),
    lpn: field(row, ["Nro LPNs", "Nro LPN", "LPN", "NRO LPN", "NRO LPNS"]),
    tienda: field(row, ["Destino", "DESTINO", "Tienda", "TIENDA", "Cod Destino", "COD DESTINO"]),
    local: field(row, ["Nombre Destino", "NOMBRE DESTINO", "Local", "LOCAL", "Tienda", "TIENDA"]),
    placa: field(row, ["Placa", "PLACA", "Vehiculo", "VEHICULO", "Camion", "CAMION"]),
    carga: field(row, ["Nro Carga", "NRO CARGA", "Carga", "CARGA", "Nro Ola", "OLA"]),
    fechaDespacho,
    hora: field(row, ["Hora", "HORA", "Turno", "TURNO"]),
  };
}

function normalizeCargoRow(row) {
  return {
    raw: row,
    carga: field(row, ["Nro Carga", "NRO CARGA", "Carga", "CARGA", "Nro Ola", "OLA"]),
    placa: field(row, [
      "Nro Camión",
      "Nro Camion",
      "Nro CamiÃ³n",
      "NRO CAMION",
      "NRO CAMIÓN",
      "Placa",
      "PLACA",
      "Vehiculo",
      "VEHICULO",
    ]),
    chofer: field(row, ["Chofer", "CHOFER", "NOMBRE DEL CHOFER", "Nombre del Chofer", "Nombre Chofer"]),
    fechaEnvio: field(row, [
      "Fe Y Hr Modif",
      "Fe y Hr Modif",
      "FE Y HR MODIF",
      "Fecha de Envio",
      "FECHA DE ENVIO",
      "Fecha Envio",
      "FECHA ENVIO",
    ]),
    paletas: field(row, ["No-LPN Paletas", "NO-LPN PALETAS", "No LPN Paletas", "Nro Paletas", "Paletas", "PALETAS"]),
  };
}

function sentPalletMap() {
  const map = new Map();
  state.sentRows.forEach((row) => {
    const key = palletKey(row.pallet);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function cargoMap() {
  const map = new Map();
  state.cargoRows.forEach((row) => {
    const key = cargoKey(row.carga);
    if (key && !map.has(key)) map.set(key, row);
  });
  return map;
}

function enrichShipmentWithCargo(shipment, cargos = cargoMap()) {
  if (!shipment) return null;
  const cargo = cargos.get(cargoKey(shipment.carga));
  return {
    ...shipment,
    _cargo: cargo || null,
    carga: shipment.carga || cargo?.carga || "",
    placa: cargo?.placa || shipment.placa || "",
    chofer: cargo?.chofer || "",
    fechaDespacho: cargo?.fechaEnvio || shipment.fechaDespacho || "",
    paletasCarga: cargo?.paletas || "",
  };
}

function dashboardRows() {
  return state.incidents
    .map(normalizeIncidentForExport)
    .filter(isCleanIncident)
    .map((incident) => {
      const date = parseIncidentDate(incident.fecha_incidente);
      return {
        ...incident,
        _date: date,
        _turn: incidentTurn(date),
        _bultos: toNumber(incident.bultos),
        _precio: priceToNumber(incident.precio),
      };
    })
    .filter((incident) => state.dashboardTurn === "todos" || incident._turn === state.dashboardTurn);
}

function allDashboardRows() {
  return state.incidents
    .map(normalizeIncidentForExport)
    .filter(isCleanIncident)
    .map((incident) => {
      const date = parseIncidentDate(incident.fecha_incidente);
      return {
        ...incident,
        _date: date,
        _regularizedDate: parseIncidentDate(incident.fecha_regularizado),
        _turn: incidentTurn(date),
        _bultos: toNumber(incident.bultos),
        _precio: priceToNumber(incident.precio),
      };
    });
}

function summaryStores(rows) {
  return [...new Set(rows.map((row) => normalize(row.tienda)).filter(Boolean))].sort();
}

function filteredSummaryDashboardRows(rows) {
  const query = normalizeSearch(state.summaryQuery);
  return rows.filter((row) => {
    const text = normalizeSearch([row.tienda, row.pallet, row.lpn, row.codigos, row.descripcion, row.estado].join(" "));
    const dateValue = dateInputValue(row._date);
    const turnMatch = state.dashboardTurn === "todos" || row._turn === state.dashboardTurn;
    const queryMatch = !query || text.includes(query);
    const storeMatch = state.summaryStore === "todos" || normalize(row.tienda) === state.summaryStore;
    const statusMatch = state.summaryStatus === "todos" || row.estado === state.summaryStatus;
    const fromMatch = !state.summaryDateFrom || (dateValue && dateValue >= state.summaryDateFrom);
    const toMatch = !state.summaryDateTo || (dateValue && dateValue <= state.summaryDateTo);
    return turnMatch && queryMatch && storeMatch && statusMatch && fromMatch && toMatch;
  });
}

function groupSum(rows, keyGetter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row) || "Sin dato";
    const current = map.get(key) || { key, count: 0, bultos: 0, precio: 0 };
    current.count += 1;
    current.bultos += row._bultos;
    current.precio += row._precio;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.precio - a.precio || b.bultos - a.bultos || b.count - a.count);
}

function weekNumber(date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil(((copy - yearStart) / 86400000 + 1) / 7);
}

function periodKey(date, period) {
  if (!date) return { key: "Sin fecha", label: "Sin fecha", time: 0 };
  if (period === "month") {
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("es-PE", { month: "short", year: "2-digit" }),
      time: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    };
  }
  if (period === "week") {
    const week = weekNumber(date);
    return {
      key: `${date.getFullYear()}-S${String(week).padStart(2, "0")}`,
      label: `Sem ${week}`,
      time: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    };
  }
  return {
    key: date.toLocaleDateString("es-PE"),
    label: date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" }),
    time: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
  };
}

function trendByDate(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const date = row._date;
    const key = date ? date.toLocaleDateString("es-PE") : "Sin fecha";
    const current = map.get(key) || { key, count: 0, bultos: 0, time: date ? date.getTime() : 0 };
    current.count += 1;
    current.bultos += row._bultos;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function trendByHour(rows) {
  return Array.from({ length: 24 }, (_, hour) => {
    const hourRows = rows.filter((row) => row._date && row._date.getHours() === hour);
    return {
      key: `${String(hour).padStart(2, "0")}:00`,
      count: hourRows.length,
      bultos: hourRows.reduce((sum, row) => sum + row._bultos, 0),
      time: hour,
    };
  }).filter((point) => point.bultos > 0 || point.count > 0);
}

function impactTrendByDate(selectedDate, currentRows) {
  const map = new Map();
  state.impactHistory.forEach((row) => {
    if (!row.fecha) return;
    const current = map.get(row.fecha) || {
      key: row.fecha,
      time: parseIncidentDate(row.fecha)?.getTime() || 0,
      dispatch: 0,
      net: 0,
      count: 0,
      bultos: 0,
    };
    current.dispatch += row.costo_despachado;
    current.net += row.costo_incidencias_neto;
    current.count += row.incidencias;
    current.bultos += row.bultos_faltantes;
    map.set(row.fecha, current);
  });

  if (selectedDate) {
    const dispatch = currentRows.reduce((sum, row) => sum + row.costo_despachado, 0);
    const net = currentRows.reduce((sum, row) => sum + row.costo_incidencias_neto, 0);
    map.set(selectedDate, {
      key: selectedDate,
      time: parseIncidentDate(selectedDate)?.getTime() || Date.now(),
      dispatch,
      net,
      count: currentRows.reduce((sum, row) => sum + row.incidencias, 0),
      bultos: currentRows.reduce((sum, row) => sum + row.bultos_faltantes, 0),
    });
  }

  return [...map.values()]
    .map((point) => ({
      ...point,
      porcentaje_impacto: point.dispatch ? (point.net / point.dispatch) * 100 : 0,
    }))
    .filter((point) => point.dispatch > 0 || point.net > 0 || point.count > 0)
    .sort((a, b) => a.time - b.time)
    .slice(-10);
}

function renderLineChart(points, valueKey = "count", valueLabel = "incidencias") {
  if (!points.length) return `<div class="chart-empty">Sin data.</div>`;
  const width = 720;
  const height = 220;
  const pad = 28;
  const max = Math.max(...points.map((point) => toNumber(point[valueKey])), 1);
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (points.length - 1);
    const value = toNumber(point[valueKey]);
    const y = height - pad - (value / max) * (height - pad * 2);
    const label = valueKey === "count" ? String(value) : value.toFixed(2);
    return { ...point, x, y, label };
  });
  const path = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${height - pad} L ${coords[0].x.toFixed(1)} ${height - pad} Z`;
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia por fecha">
      <path class="chart-grid" d="M ${pad} ${height - pad} H ${width - pad} M ${pad} ${pad} H ${width - pad}" />
      <path class="chart-area" d="${area}" />
      <path class="chart-line" d="${path}" />
      ${coords.map((point) => `
        <g>
          <circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4"><title>${escapeHtml(point.key)}: ${escapeHtml(point.label)} ${escapeHtml(valueLabel)}</title></circle>
          <text class="chart-value" x="${point.x.toFixed(1)}" y="${Math.max(14, point.y - 10).toFixed(1)}">${escapeHtml(point.label)}</text>
        </g>
      `).join("")}
    </svg>
    <div class="chart-axis">${coords.slice(-5).map((point) => `<span>${escapeHtml(point.key)}</span>`).join("")}</div>
  `;
}

function advanceRows() {
  return allDashboardRows().filter((row) => {
    const storeMatch = state.advanceStore === "todos" || normalize(row.tienda) === state.advanceStore;
    const statusMatch = state.advanceStatus === "todos" || row.estado === state.advanceStatus;
    return storeMatch && statusMatch;
  });
}

function advancePoints(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const period = periodKey(row._date, state.advancePeriod);
    const current = map.get(period.key) || {
      key: period.key,
      label: period.label,
      time: period.time,
      total: 0,
      regularized: 0,
      pending: 0,
      cost: 0,
      regularizedCost: 0,
      pendingCost: 0,
    };
    current.total += 1;
    current.cost += row._precio;
    if (row.estado === "Regularizado") {
      current.regularized += 1;
      current.regularizedCost += row._precio;
    }
    if (row.estado === "Pendiente") {
      current.pending += 1;
      current.pendingCost += row._precio;
    }
    map.set(period.key, current);
  });
  return [...map.values()]
    .sort((a, b) => a.time - b.time)
    .map((point) => ({
      ...point,
      percent: point.total ? (point.regularized / point.total) * 100 : 0,
    }));
}

function trendDirection(points) {
  if (points.length < 2) return "Necesitamos mas periodos para leer la tendencia.";
  const first = points[0].percent;
  const last = points[points.length - 1].percent;
  const diff = last - first;
  if (diff > 5) return `La regularizacion viene subiendo ${diff.toFixed(1)} puntos.`;
  if (diff < -5) return `La regularizacion viene bajando ${Math.abs(diff).toFixed(1)} puntos.`;
  return "La regularizacion se mantiene estable.";
}

function renderAdvanceChart(points) {
  if (!points.length) return `<div class="chart-empty">Sin data.</div>`;
  const width = 760;
  const height = 300;
  const padX = 46;
  const padTop = 58;
  const padBottom = 38;
  const maxTotal = Math.max(...points.map((point) => point.total), 1);
  const coords = points.map((point, index) => {
    const chartHeight = height - padTop - padBottom;
    const step = (width - padX * 2) / Math.max(1, points.length - 1);
    const x = points.length === 1 ? width / 2 : padX + index * step;
    const lineY = height - padBottom - (point.percent / 100) * chartHeight;
    const totalHeight = (point.total / maxTotal) * chartHeight;
    const regularizedHeight = (point.regularized / maxTotal) * chartHeight;
    return { ...point, x, lineY, totalHeight, regularizedHeight };
  });
  const path = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.lineY.toFixed(1)}`).join(" ");
  return `
    <svg class="advance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Avance de regularizacion">
      <path class="chart-grid" d="M ${padX} ${height - padBottom} H ${width - padX} M ${padX} ${padTop} H ${width - padX}" />
      ${coords.map((point) => `
        <g>
          <rect class="advance-bar total" x="${(point.x - 30).toFixed(1)}" y="${(height - padBottom - point.totalHeight).toFixed(1)}" width="18" height="${point.totalHeight.toFixed(1)}" rx="5" />
          <rect class="advance-bar ok" x="${(point.x + 12).toFixed(1)}" y="${(height - padBottom - point.regularizedHeight).toFixed(1)}" width="18" height="${point.regularizedHeight.toFixed(1)}" rx="5" />
          <text class="advance-count" x="${(point.x - 21).toFixed(1)}" y="${Math.max(18, height - padBottom - point.totalHeight - 10).toFixed(1)}">${point.total}</text>
          <text class="advance-count ok" x="${(point.x + 21).toFixed(1)}" y="${Math.max(18, height - padBottom - point.regularizedHeight - 10).toFixed(1)}">${point.regularized}</text>
        </g>
      `).join("")}
      <path class="advance-line" d="${path}" />
      ${coords.map((point) => `
        <g>
          <circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.lineY.toFixed(1)}" r="4"><title>${escapeHtml(point.label)}: ${point.percent.toFixed(1)}% regularizado</title></circle>
        </g>
      `).join("")}
    </svg>
    <div class="chart-axis">${coords.slice(-7).map((point) => `<span>${escapeHtml(point.label)}</span>`).join("")}</div>
  `;
}

function renderAdvanceReport() {
  const rows = advanceRows();
  const points = advancePoints(rows);
  const stores = [...new Set(allDashboardRows().map((row) => normalize(row.tienda)).filter(Boolean))].sort();
  const total = rows.length;
  const regularized = rows.filter((row) => row.estado === "Regularizado").length;
  const pending = rows.filter((row) => row.estado === "Pendiente").length;
  const totalCost = rows.reduce((sum, row) => sum + row._precio, 0);
  const regularizedCost = rows.filter((row) => row.estado === "Regularizado").reduce((sum, row) => sum + row._precio, 0);
  const pendingCost = rows.filter((row) => row.estado === "Pendiente").reduce((sum, row) => sum + row._precio, 0);

  return `
    <div class="advance-report">
      <div class="advance-filters">
        <label>
          <span>Tienda</span>
          <select id="advanceStore">
            <option value="todos">Todas</option>
            ${stores.map((store) => `<option value="${escapeAttr(store)}" ${state.advanceStore === store ? "selected" : ""}>${escapeHtml(store)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select id="advanceStatus">
            <option value="todos" ${state.advanceStatus === "todos" ? "selected" : ""}>Todos</option>
            <option value="Pendiente" ${state.advanceStatus === "Pendiente" ? "selected" : ""}>Pendientes</option>
            <option value="Regularizado" ${state.advanceStatus === "Regularizado" ? "selected" : ""}>Regularizadas</option>
          </select>
        </label>
        <label>
          <span>Periodo</span>
          <select id="advancePeriod">
            <option value="day" ${state.advancePeriod === "day" ? "selected" : ""}>Dia</option>
            <option value="week" ${state.advancePeriod === "week" ? "selected" : ""}>Semana</option>
            <option value="month" ${state.advancePeriod === "month" ? "selected" : ""}>Mes</option>
          </select>
        </label>
      </div>
      <div class="advance-summary">
        <div><span>Total filtrado</span><strong>${total}</strong></div>
        <div><span>Regularizadas</span><strong>${regularized}</strong></div>
        <div><span>Pendientes</span><strong>${pending}</strong></div>
        <div><span>Costo total</span><strong>S/ ${money(totalCost)}</strong></div>
        <div><span>Costo regularizado</span><strong>S/ ${money(regularizedCost)}</strong></div>
        <div><span>Costo pendiente</span><strong>S/ ${money(pendingCost)}</strong></div>
        <div><span>Lectura</span><strong>${escapeHtml(trendDirection(points))}</strong></div>
      </div>
      <article class="chart-card wide">
        <div class="chart-title">
          <div>
            <h3>Avance de regularizacion</h3>
            <span>Barras: total vs regularizadas · Linea: % regularizado</span>
          </div>
        </div>
        ${renderAdvanceChart(points)}
        <div class="chart-legend">
          <span><i class="legend-total"></i>Total incidencias</span>
          <span><i class="legend-ok"></i>Regularizadas</span>
          <span><i class="legend-line"></i>% regularizado</span>
        </div>
      </article>
    </div>
  `;
}

function sentIncidentRows() {
  const sentMap = sentPalletMap();
  const cargos = cargoMap();
  return allDashboardRows().map((row) => {
    const matches = (sentMap.get(palletKey(row.pallet)) || []).map((shipment) => enrichShipmentWithCargo(shipment, cargos));
    return {
      ...row,
      _sent: matches.length > 0,
      _shipment: matches[0] || null,
      _shipments: matches,
    };
  });
}

function filteredSentIncidentRows(rows) {
  const query = normalizeSearch(state.sentQuery);
  const from = state.sentDateFrom;
  const to = state.sentDateTo;
  return rows.filter((row) => {
    const shipment = row._shipment || {};
    const text = normalizeSearch([
      row.pallet,
      row.lpn,
      row.codigos,
      row.descripcion,
      row.tienda,
      shipment.tienda,
      shipment.local,
      shipment.carga,
      shipment.placa,
      shipment.chofer,
    ].join(" "));
    const textMatch = !query || text.includes(query);
    const statusMatch =
      state.sentStatusFilter === "todos" ||
      (state.sentStatusFilter === "enviado" && row._sent) ||
      (state.sentStatusFilter === "cd" && !row._sent) ||
      row.estado === state.sentStatusFilter;
    const storeValue = normalize(shipment.tienda || row.tienda || "Sin tienda");
    const storeMatch = state.sentStore === "todos" || storeValue === state.sentStore;
    const dateValue = dateInputValue(rowOperationalDate(row));
    const fromMatch = !from || (dateValue && dateValue >= from);
    const toMatch = !to || (dateValue && dateValue <= to);
    return textMatch && statusMatch && storeMatch && fromMatch && toMatch;
  });
}

function shipmentStoreSummaries(incidentRows = null) {
  const cargos = cargoMap();
  const allowedKeys = incidentRows
    ? new Set(
        incidentRows
          .filter((row) => row._sent && row._shipment)
          .map((row) => `${cargoKey(row._shipment.carga) || "SIN CARGA"}|${normalize(row._shipment.tienda || "Sin tienda")}`),
      )
    : null;
  const map = new Map();
  state.sentRows.forEach((row) => {
    const shipment = enrichShipmentWithCargo(row, cargos);
    const pallet = palletKey(shipment?.pallet);
    if (!pallet) return;
    const carga = cargoKey(shipment.carga) || "SIN CARGA";
    const tienda = normalize(shipment.tienda || "Sin tienda");
    const key = `${carga}|${tienda}`;
    if (allowedKeys && !allowedKeys.has(key)) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        carga: shipment.carga || "Sin carga",
        tienda,
        local: shipment.local || "",
        placa: shipment.placa || "",
        chofer: shipment.chofer || "",
        fechaEnvio: shipment.fechaDespacho || "",
        paletasCarga: shipment.paletasCarga || "",
        pallets: new Set(),
      });
    }
    map.get(key).pallets.add(pallet);
  });
  return [...map.values()]
    .map((row) => ({ ...row, count: row.pallets.size }))
    .sort((a, b) => b.count - a.count || a.tienda.localeCompare(b.tienda));
}

function sentStores(rows) {
  return [...new Set(rows.map((row) => normalize(row._shipment?.tienda || row.tienda)).filter(Boolean))].sort();
}

function sentDetailRows(detailKey) {
  const cargos = cargoMap();
  const incidentsByPallet = new Map();
  allDashboardRows().forEach((row) => {
    const key = palletKey(row.pallet);
    if (!key) return;
    if (!incidentsByPallet.has(key)) incidentsByPallet.set(key, []);
    incidentsByPallet.get(key).push(row);
  });

  const map = new Map();
  state.sentRows.forEach((row) => {
    const shipment = enrichShipmentWithCargo(row, cargos);
    const key = `${cargoKey(shipment.carga) || "SIN CARGA"}|${normalize(shipment.tienda || "Sin tienda")}`;
    if (key !== detailKey) return;
    const pallet = palletKey(shipment.pallet);
    if (!pallet || map.has(pallet)) return;
    map.set(pallet, {
      pallet: shipment.pallet,
      lpn: shipment.lpn,
      tienda: shipment.tienda,
      local: shipment.local,
      carga: shipment.carga,
      placa: shipment.placa,
      chofer: shipment.chofer,
      fechaDespacho: shipment.fechaDespacho,
      paletasCarga: shipment.paletasCarga,
      incidents: incidentsByPallet.get(pallet) || [],
    });
  });

  return [...map.values()].sort((a, b) => Number(Boolean(b.incidents.length)) - Number(Boolean(a.incidents.length)) || palletKey(a.pallet).localeCompare(palletKey(b.pallet)));
}

function renderSentDetailModal() {
  if (!state.sentDetailKey) return "";
  const rows = sentDetailRows(state.sentDetailKey);
  const first = rows[0] || {};
  const affected = rows.filter((row) => row.incidents.length);
  const affectedCost = affected.reduce((sum, row) => {
    return sum + row.incidents.filter((incident) => incident.estado !== "Regularizado").reduce((subtotal, incident) => subtotal + incident._precio, 0);
  }, 0);
  return `
    <div class="modal-backdrop">
      <section class="sent-detail-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Detalle de carga enviada</span>
            <h3>Tienda ${escapeHtml(first.tienda || "Sin tienda")}</h3>
            <p class="muted">Carga ${escapeHtml(first.carga || "-")} · Placa ${escapeHtml(first.placa || "-")} · ${escapeHtml(first.chofer || "Sin chofer")}</p>
          </div>
          <button class="icon-btn" id="closeSentDetailBtn" type="button" aria-label="Cerrar">×</button>
        </div>
        <div class="sent-detail-kpis">
          <div><span>Pallets enviados</span><strong>${rows.length}</strong></div>
          <div><span>Pallets afectados</span><strong>${affected.length}</strong></div>
          <div><span>Costo pendiente</span><strong>S/ ${money(affectedCost)}</strong></div>
          <div><span>Fecha envio</span><strong>${escapeHtml(first.fechaDespacho || "-")}</strong></div>
        </div>
        <div class="sent-detail-list">
          ${rows.map((row) => {
            const incident = row.incidents[0];
            const affectedClass = incident ? "affected" : "";
            return `
              <article class="sent-detail-item ${affectedClass}">
                <div>
                  <span class="badge ${incident ? "missing" : "ok"}">${incident ? "Pallet afectado" : "Sin incidencia"}</span>
                  <strong>${escapeHtml(row.pallet || "-")}</strong>
                  <small>${escapeHtml(row.lpn || "")}</small>
                </div>
                <div>
                  ${incident ? `<b>${escapeHtml(incident.descripcion)}</b><small>${escapeHtml(incident.estado)} · ${incident._bultos.toFixed(2)} bultos · S/ ${money(incident.estado === "Regularizado" ? 0 : incident._precio)}</small>` : `<span class="muted">Pallet enviado sin incidencia registrada.</span>`}
                </div>
              </article>
            `;
          }).join("") || `<div class="chart-empty">No se encontraron pallets para esta carga.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderPalletBars(items) {
  if (!items.length) return `<div class="chart-empty">Sin cargas.</div>`;
  const total = Math.max(...items.map((item) => item.count), 1);
  return `
    <div class="shipment-store-list">
      ${items
        .map((item) => {
          const percent = Math.max(6, (item.count / total) * 100);
          return `
            <button class="shipment-store-row" type="button" data-sent-detail="${escapeAttr(item.key)}">
              <div>
                <strong>Tienda ${escapeHtml(item.tienda)}</strong>
                <small>Carga ${escapeHtml(item.carga)}${item.placa ? ` · Placa ${escapeHtml(item.placa)}` : ""}${item.chofer ? ` · ${escapeHtml(item.chofer)}` : ""}</small>
              </div>
              <span>${item.count} pallets</span>
              <i><b style="width:${percent}%"></b></i>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSentLogisticsDonut(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const fallbackTotal = items.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const basis = total || fallbackTotal || 1;
    const value = total ? item.value : item.count;
    const start = cursor;
    const end = cursor + (value / basis) * 100;
    cursor = end;
    return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `
    <div class="sent-logistics-donut">
      <div class="sent-donut" style="--segments:${segments.join(", ")}">
        <strong>${total ? "100%" : "0%"}</strong>
        <span>Total</span>
      </div>
      <div class="sent-donut-legend">
        ${items.map((item) => {
          const percent = total ? (item.value / total) * 100 : fallbackTotal ? (item.count / fallbackTotal) * 100 : 0;
          return `
            <div class="sent-donut-row">
              <i style="background:${item.color}"></i>
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${percent.toFixed(1)}%</small>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderSentIncidentsReport() {
  const rows = sentIncidentRows();
  const filteredRows = filteredSentIncidentRows(rows);
  const sentRows = filteredRows.filter((row) => row._sent);
  const cdRows = filteredRows.filter((row) => !row._sent);
  const sentGrossCost = sentRows.reduce((sum, row) => sum + row._precio, 0);
  const sentRegularizedRows = sentRows.filter((row) => row.estado === "Regularizado");
  const sentPendingRows = sentRows.filter((row) => row.estado === "Pendiente");
  const sentDiscountCost = sentRegularizedRows.reduce((sum, row) => sum + row._precio, 0);
  const sentNetCost = sentPendingRows.reduce((sum, row) => sum + row._precio, 0);
  const cdPendingRows = cdRows.filter((row) => row.estado === "Pendiente");
  const cdCost = cdPendingRows.reduce((sum, row) => sum + row._precio, 0);
  const sentPallets = new Set(sentRows.map((row) => palletKey(row.pallet)).filter(Boolean)).size;
  const topStores = groupSum(sentPendingRows, (row) => {
    const shipment = row._shipment || {};
    const store = shipment.tienda || row.tienda || "Sin tienda";
    const local = shipment.local && shipment.local !== shipment.tienda ? ` · ${shipment.local}` : "";
    return `Tienda ${store}${local}`;
  }).slice(0, 6);
  const storesByCargo = shipmentStoreSummaries(filteredRows).slice(0, 8);
  const stores = sentStores(rows);

  return `
    <div class="sent-report">
      ${state.sentStatus === "error" ? `<p class="notice">${escapeHtml(state.sentError)}</p>` : ""}
      ${state.cargoStatus === "error" ? `<p class="notice">${escapeHtml(state.cargoError)}</p>` : ""}
      <div class="sent-hero">
        <div>
          <span class="eyebrow">Cruce incidencias vs enviado + carga</span>
          <h3>Pallets con incidencia enviados a tienda</h3>
        </div>
        <strong>${sentPallets}<small>pallets enviados</small></strong>
      </div>
      <div class="sent-filters">
        <label class="span-2">
          <span>Buscar</span>
          <input id="sentQuery" value="${escapeAttr(state.sentQuery)}" placeholder="Pallet, carga, placa, chofer, tienda o producto" />
        </label>
        <label>
          <span>Tienda</span>
          <select id="sentStore">
            <option value="todos">Todas</option>
            ${stores.map((store) => `<option value="${escapeAttr(store)}" ${state.sentStore === store ? "selected" : ""}>${escapeHtml(store)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select id="sentStatusFilter">
            <option value="todos" ${state.sentStatusFilter === "todos" ? "selected" : ""}>Todos</option>
            <option value="enviado" ${state.sentStatusFilter === "enviado" ? "selected" : ""}>Enviados</option>
            <option value="cd" ${state.sentStatusFilter === "cd" ? "selected" : ""}>En CD</option>
            <option value="Pendiente" ${state.sentStatusFilter === "Pendiente" ? "selected" : ""}>Pendientes</option>
            <option value="Regularizado" ${state.sentStatusFilter === "Regularizado" ? "selected" : ""}>Regularizados</option>
          </select>
        </label>
        <label>
          <span>Desde</span>
          <input id="sentDateFrom" type="date" value="${escapeAttr(state.sentDateFrom)}" />
        </label>
        <label>
          <span>Hasta</span>
          <input id="sentDateTo" type="date" value="${escapeAttr(state.sentDateTo)}" />
        </label>
        <button class="btn warning" id="sentExportBtn" type="button">Exportar filtrado</button>
      </div>
      <div class="dashboard-kpis">
        <div class="kpi-card"><span>Incidencias enviadas</span><strong>${sentRows.length}</strong><small>${sentPallets} pallets cruzados</small></div>
        <div class="kpi-card"><span>Costo enviado pendiente</span><strong>S/ ${money(sentNetCost)}</strong><small>Neto</small></div>
        <div class="kpi-card"><span>Regularizado descontado</span><strong>S/ ${money(sentDiscountCost)}</strong><small>Bruto: S/ ${money(sentGrossCost)}</small></div>
        <div class="kpi-card"><span>Costo pendiente en CD</span><strong>S/ ${money(cdCost)}</strong><small>${cdPendingRows.length} pendientes</small></div>
      </div>
      <div class="dashboard-grid">
        <article class="chart-card">
          <div class="chart-title"><h3>Estado logistico</h3><span>Enviado vs en CD</span></div>
          ${renderSentLogisticsDonut([
            { label: "Enviado pendiente", count: sentPendingRows.length, value: sentNetCost, color: "#e8792e" },
            { label: "Enviado regularizado", count: sentRegularizedRows.length, value: sentDiscountCost, color: "#42784f" },
            { label: "Aun en CD / sin cruce", count: cdRows.length, value: cdCost, color: "#a83224" },
          ])}
          ${renderBars([
            { key: "Enviado pendiente", count: sentPendingRows.length, bultos: sentPendingRows.reduce((sum, row) => sum + row._bultos, 0), precio: sentNetCost },
            { key: "Enviado regularizado", count: sentRegularizedRows.length, bultos: sentRegularizedRows.reduce((sum, row) => sum + row._bultos, 0), precio: sentDiscountCost },
            { key: "Aun en CD / sin cruce", count: cdRows.length, bultos: cdRows.reduce((sum, row) => sum + row._bultos, 0), precio: cdCost },
          ], sentGrossCost + cdCost, "precio")}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Tiendas impactadas</h3><span>Costo enviado pendiente</span></div>
          ${renderBars(topStores, sentNetCost, "precio")}
        </article>
        <article class="chart-card wide">
          <div class="chart-title"><h3>Pallets enviados por tienda</h3><span>Por carga, sin duplicar pallet</span></div>
          ${renderPalletBars(storesByCargo)}
        </article>
        <article class="chart-card wide">
          <div class="chart-title">
            <div>
              <h3>Detalle ejecutivo</h3>
              <span>${filteredRows.length} de ${rows.length} incidencias</span>
            </div>
          </div>
          ${renderSentIncidentsTable(filteredRows)}
        </article>
      </div>
      ${renderSentDetailModal()}
    </div>
  `;
}

function renderSentIncidentsTable(rows) {
  if (!rows.length) return `<div class="chart-empty">Sin incidencias.</div>`;
  return `
    <div class="sent-table-wrap">
      <table class="sent-table">
        <thead>
          <tr>
            <th>Estado envio</th>
            <th>Pallet</th>
            <th>Producto</th>
            <th>Incidencia</th>
            <th>Despacho</th>
            <th>Carga / placa</th>
            <th>Chofer</th>
            <th>Costo neto</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice()
            .sort((a, b) => Number(b._sent) - Number(a._sent) || b._precio - a._precio)
            .slice(0, 80)
            .map((row) => {
              const shipment = row._shipment || {};
              const isRegularized = row.estado === "Regularizado";
              return `
                <tr class="${row._sent ? "sent" : "not-sent"}">
                  <td><span class="badge ${row._sent ? "ok" : "missing"}">${row._sent ? "Enviado" : "En CD"}</span></td>
                  <td><strong>${escapeHtml(row.pallet || "SIN PALLET")}</strong><small>${escapeHtml(row.lpn || "")}</small></td>
                  <td>${escapeHtml(row.descripcion)}<small>Codigo ${escapeHtml(row.codigos)}</small></td>
                  <td>${escapeHtml(row.estado)}<small>${escapeHtml(row.fecha_incidente || "Sin fecha")}</small></td>
                  <td>${row._sent ? `${escapeHtml(shipment.tienda || row.tienda)}<small>${escapeHtml(shipment.fechaDespacho || shipment.hora || "Sin fecha despacho")}</small>` : `<span class="muted">Sin cruce en ENVIADO</span>`}</td>
                  <td>${row._sent ? `<strong>${escapeHtml(shipment.carga || "-")}</strong><small>Placa ${escapeHtml(shipment.placa || "-")}</small>` : "-"}</td>
                  <td>${row._sent ? `${escapeHtml(shipment.chofer || "-")}<small>${shipment.paletasCarga ? `${escapeHtml(shipment.paletasCarga)} paletas carga` : "Sin paletas carga"}</small>` : "-"}</td>
                  <td><strong>S/ ${money(isRegularized ? 0 : row._precio)}</strong><small>${isRegularized ? `Descontado: S/ ${money(row._precio)}` : `${row._bultos.toFixed(2)} bultos`}</small></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStatusChart(rows) {
  const regularizedRows = rows.filter((row) => row.estado === "Regularizado");
  const pendingRows = rows.filter((row) => row.estado === "Pendiente");
  const regularizados = regularizedRows.length;
  const pendientes = pendingRows.length;
  const regularizedCost = regularizedRows.reduce((sum, row) => sum + row._precio, 0);
  const pendingCost = pendingRows.reduce((sum, row) => sum + row._precio, 0);
  const totalCost = regularizedCost + pendingCost;
  const total = Math.max(rows.length, 1);
  const percent = totalCost ? (regularizedCost / totalCost) * 100 : (regularizados / total) * 100;
  const pendingPercent = totalCost ? (pendingCost / totalCost) * 100 : rows.length ? (pendientes / rows.length) * 100 : 0;
  const statusText = rows.length
    ? regularizados === rows.length
      ? "Todo regularizado"
      : `S/ ${money(pendingCost)} pendientes de cierre`
    : "Sin incidencias";
  return `
    <div class="status-chart">
      <div class="donut" style="--regularized:${percent.toFixed(1)}%">
        <strong>${percent.toFixed(1)}%</strong>
        <span>Regularizado</span>
      </div>
      <div class="status-breakdown">
        <div><span class="dot ok"></span><b>S/ ${money(regularizedCost)}</b><small>${regularizados} regularizadas</small></div>
        <div><span class="dot pending"></span><b>S/ ${money(pendingCost)}</b><small>${pendientes} pendientes</small></div>
        <div><span class="dot total"></span><b>S/ ${money(totalCost)}</b><small>Total reportado</small></div>
      </div>
    </div>
    <div class="status-progress">
      <div class="bar-head">
        <strong>${escapeHtml(statusText)}</strong>
        <span>${pendingPercent.toFixed(1)}% pendiente</span>
      </div>
      <div class="bar-track split">
        <span class="ok" style="width:${percent.toFixed(1)}%"></span>
        <span class="pending" style="width:${pendingPercent.toFixed(1)}%"></span>
      </div>
    </div>
  `;
}

function renderBars(items, total, label = "bultos") {
  if (!items.length) return `<div class="chart-empty">Sin data.</div>`;
  const isMoney = label === "precio";
  const valueKey = isMoney ? "precio" : "bultos";
  const max = Math.max(...items.map((item) => item[valueKey]), 1);
  return `
    <div class="bar-list">
      ${items.map((item) => {
        const value = item[valueKey];
        const percent = total ? (value / total) * 100 : 0;
        return `
          <div class="bar-item">
            <div class="bar-head">
              <strong>${escapeHtml(item.key)}</strong>
              <span>${isMoney ? `S/ ${money(value)}` : `${value.toFixed(2)} ${label}`}</span>
            </div>
            <div class="bar-track"><span style="width:${Math.max(3, (value / max) * 100).toFixed(1)}%"></span></div>
            <small>${percent.toFixed(1)}% · ${item.count} incidencias · ${item.bultos.toFixed(2)} bultos</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderTurnChart(rows) {
  const items = ["dia", "tarde", "noche"].map((turn) => {
    const turnRows = rows.filter((row) => row._turn === turn);
    return {
      key: turnLabel(turn),
      count: turnRows.length,
      bultos: turnRows.reduce((sum, row) => sum + row._bultos, 0),
    };
  });
  const total = items.reduce((sum, item) => sum + item.bultos, 0);
  return renderBars(items, total);
}

function renderRecentIncidents(rows) {
  const recent = [...rows]
    .sort((a, b) => (b._date?.getTime() || 0) - (a._date?.getTime() || 0))
    .slice(0, 6);
  if (!recent.length) return `<div class="chart-empty">Sin incidencias.</div>`;
  return `
    <div class="recent-grid">
      ${recent.map((row) => `
        <article class="recent-item ${row.estado === "Regularizado" ? "ok" : "pending"}">
          <div>
            <span>${escapeHtml(row.fecha_incidente || "Sin fecha")}</span>
            <strong>${escapeHtml(row.descripcion)}</strong>
            <small>Tienda ${escapeHtml(row.tienda)} · Pallet ${escapeHtml(row.pallet)} · Codigo ${escapeHtml(row.codigos)}</small>
          </div>
          <b>S/ ${money(row._precio)}<small>${row._bultos.toFixed(2)} bul</small></b>
        </article>
      `).join("")}
    </div>
  `;
}

function renderImpactReport() {
  const selectedDate = state.impactDate || dateInputValue(new Date());
  if (!state.impactDate) state.impactDate = selectedDate;
  const rows = impactRowsForDate(selectedDate);
  const impactTrend = impactTrendByDate(selectedDate, rows);
  const totalDispatch = rows.reduce((sum, row) => sum + row.costo_despachado, 0);
  const totalNetIncidents = rows.reduce((sum, row) => sum + row.costo_incidencias_neto, 0);
  const totalGrossIncidents = rows.reduce((sum, row) => sum + row.costo_incidencias_bruto, 0);
  const totalRegularized = rows.reduce((sum, row) => sum + row.costo_regularizado, 0);
  const totalSentIncidentCost = rows.reduce((sum, row) => sum + row.costo_incidencias_enviadas_neto, 0);
  const totalCdIncidentCost = rows.reduce((sum, row) => sum + row.costo_incidencias_cd_neto, 0);
  const totalIncidentPallets = rows.reduce((sum, row) => sum + row.pallets_con_incidencia, 0);
  const totalSentIncidentPallets = rows.reduce((sum, row) => sum + row.pallets_incidencia_enviados, 0);
  const totalCdIncidentPallets = rows.reduce((sum, row) => sum + row.pallets_incidencia_cd, 0);
  const totalImpact = totalDispatch ? (totalNetIncidents / totalDispatch) * 100 : 0;
  return `
    <div class="impact-report">
      ${state.impactStatus === "error" ? `<p class="notice">${escapeHtml(state.impactError)}</p>` : ""}
      <div class="impact-hero">
        <div>
          <span class="eyebrow">Impacto economico por turno</span>
          <h3>Despacho total vs incidencias</h3>
          </div>
        <div class="impact-actions">
          <label>
            <span>Fecha</span>
            <input id="impactDate" type="date" value="${escapeAttr(selectedDate)}" />
          </label>
          ${canManageIncidents() ? `<button class="btn warning" id="saveImpactBtn" type="button" ${state.impactSaving ? "disabled" : ""}>${state.impactSaving ? "Guardando..." : "Guardar historico"}</button>` : ""}
        </div>
      </div>
      <div class="dashboard-kpis">
        <div class="kpi-card"><span>Costo despachado</span><strong>S/ ${money(totalDispatch)}</strong><small>Dia + Noche</small></div>
        <div class="kpi-card"><span>Incidencias netas</span><strong>S/ ${money(totalNetIncidents)}</strong><small>Pendiente real</small></div>
        <div class="kpi-card"><span>Regularizado</span><strong>S/ ${money(totalRegularized)}</strong><small>Descontado de impacto</small></div>
        <div class="kpi-card ${totalImpact >= 2 ? "risk-high" : totalImpact >= 1 ? "risk-mid" : "risk-low"}"><span>% impacto</span><strong>${totalImpact.toFixed(2)}%</strong><small>${escapeHtml(impactLevel(totalImpact))}</small></div>
      </div>
      <div class="dashboard-grid">
        <article class="chart-card wide">
          <div class="chart-title"><h3>Comparativa del turno</h3><span>Dia / Noche</span></div>
          <div class="impact-turn-grid">
            ${rows.map((row) => `
              <article class="impact-turn-card ${row.nivel_impacto.toLowerCase()}">
                <div class="bar-head">
                  <strong>Turno ${escapeHtml(row.turno)}</strong>
                  <span>${row.porcentaje_impacto.toFixed(2)}%</span>
                </div>
                <div class="impact-money">
                  <div><span>Despachado</span><b>S/ ${money(row.costo_despachado)}</b></div>
                  <div><span>Incidencia neta</span><b>S/ ${money(row.costo_incidencias_neto)}</b></div>
                  <div><span>Enviado con incidencia</span><b>S/ ${money(row.costo_incidencias_enviadas_neto)}</b></div>
                  <div><span>Aun en CD</span><b>S/ ${money(row.costo_incidencias_cd_neto)}</b></div>
                </div>
                <div class="bar-track"><span style="width:${Math.min(100, Math.max(3, row.porcentaje_impacto * 25)).toFixed(1)}%"></span></div>
                <small>${row.pallets_enviados} pallets despachados · ${row.pallets_con_incidencia} pallets con incidencia · ${row.pallets_incidencia_enviados} enviados · ${row.pallets_incidencia_cd} en CD ${row.pallets_sin_costo ? `· ${row.pallets_sin_costo} pallets sin costo` : ""}</small>
              </article>
            `).join("")}
          </div>
        </article>
        <article class="chart-card wide">
          <div class="chart-title"><h3>Tendencia de impacto</h3><span>Por fecha</span></div>
          ${renderLineChart(impactTrend, "porcentaje_impacto", "% impacto")}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Nivel de impacto</h3><span>Semaforo</span></div>
          ${renderBars(rows.map((row) => ({
            key: `Turno ${row.turno}`,
            count: row.incidencias,
            bultos: row.bultos_faltantes,
            precio: row.costo_incidencias_neto,
          })), Math.max(totalNetIncidents, 1), "precio")}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Salida de incidencias</h3><span>Enviado vs CD</span></div>
          ${renderImpactLocationChart({
            sentCost: totalSentIncidentCost,
            cdCost: totalCdIncidentCost,
            sentPallets: totalSentIncidentPallets,
            cdPallets: totalCdIncidentPallets,
            totalPallets: totalIncidentPallets,
          })}
        </article>
        <article class="chart-card wide">
          <div class="chart-title"><h3>Detalle del corte</h3><span>Se guarda por fecha y turno</span></div>
          <div class="sent-table-wrap compact-table">
            <table class="sent-table">
              <thead>
                <tr>
                  <th>Turno</th>
                  <th>Pallets enviados</th>
                  <th>Costo despachado</th>
                  <th>Incidencias</th>
                  <th>Enviado / CD</th>
                  <th>Costo neto</th>
                  <th>% impacto</th>
                  <th>Nivel</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td><strong>${escapeHtml(row.turno)}</strong><small>${escapeHtml(row.fecha)}</small></td>
                    <td>${row.pallets_enviados}<small>${row.pallets_sin_costo ? `${row.pallets_sin_costo} sin costo` : "Costo completo"}</small></td>
                    <td><strong>S/ ${money(row.costo_despachado)}</strong><small>${row.bultos_despachados.toFixed(2)} bultos</small></td>
                    <td>${row.incidencias}<small>${row.pallets_con_incidencia} pallets · ${row.bultos_faltantes.toFixed(2)} bultos falt.</small></td>
                    <td>${row.pallets_incidencia_enviados} / ${row.pallets_incidencia_cd}<small>S/ ${money(row.costo_incidencias_enviadas_neto)} env. · S/ ${money(row.costo_incidencias_cd_neto)} CD</small></td>
                    <td><strong>S/ ${money(row.costo_incidencias_neto)}</strong><small>Bruto S/ ${money(row.costo_incidencias_bruto)}</small></td>
                    <td><strong>${row.porcentaje_impacto.toFixed(2)}%</strong></td>
                    <td><span class="badge ${row.nivel_impacto === "Alto" ? "missing" : "ok"}">${escapeHtml(row.nivel_impacto)}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
        <article class="chart-card wide">
          <div class="chart-title"><h3>Pallets con incidencia</h3><span>Cruce ENVIADO + CARGA</span></div>
          ${renderImpactIncidentDetail(rows)}
        </article>
      </div>
    </div>
  `;
}

function renderImpactHistoryReport() {
  const historyRows = state.impactHistoryDate
    ? state.impactHistory.filter((row) => dateInputValue(parseIncidentDate(row.fecha)) === state.impactHistoryDate)
    : state.impactHistory;
  return `
    <div class="impact-report">
      <div class="impact-hero">
        <div>
          <span class="eyebrow">Impacto_Turnos</span>
          <h3>Dashboard historico</h3>
        </div>
        <div class="impact-actions">
          <label>
            <span>Fecha</span>
            <input id="impactHistoryDate" type="date" value="${escapeAttr(state.impactHistoryDate)}" />
          </label>
        </div>
      </div>
      <div class="dashboard-grid">
        <article class="chart-card wide">
          ${renderImpactHistoryDashboard(historyRows)}
        </article>
      </div>
    </div>
  `;
}

function renderImpactLocationChart(summary) {
  const total = summary.sentCost + summary.cdCost;
  const sentPercent = total ? (summary.sentCost / total) * 100 : 0;
  const cdPercent = total ? (summary.cdCost / total) * 100 : 0;
  const segments = total
    ? `#42784f 0% ${sentPercent.toFixed(2)}%, #a83224 ${sentPercent.toFixed(2)}% 100%`
    : "#e8dccf 0% 100%";
  return `
    <div class="impact-location-card">
      <div class="impact-mini-donut" style="--segments:${segments}">
        <strong>${summary.totalPallets}</strong>
        <span>pallets</span>
      </div>
      <div class="impact-location-list">
        <div>
          <i class="sent"></i>
          <span>Enviado</span>
          <strong>S/ ${money(summary.sentCost)}</strong>
          <small>${summary.sentPallets} pallets · ${sentPercent.toFixed(1)}%</small>
        </div>
        <div>
          <i class="cd"></i>
          <span>Aun en CD</span>
          <strong>S/ ${money(summary.cdCost)}</strong>
          <small>${summary.cdPallets} pallets · ${cdPercent.toFixed(1)}%</small>
        </div>
      </div>
    </div>
  `;
}

function impactHistorySorted(history) {
  return history
    .slice()
    .filter((row) => row.fecha && row.turno)
    .sort((a, b) => {
      const dateA = parseIncidentDate(a.fecha)?.getTime() || 0;
      const dateB = parseIncidentDate(b.fecha)?.getTime() || 0;
      if (dateA !== dateB) return dateA - dateB;
      return String(a.turno).localeCompare(String(b.turno));
    });
}

function renderImpactHistoryDashboard(history) {
  const rows = impactHistorySorted(history);
  if (!rows.length) return `<div class="chart-empty">Aun no hay cortes guardados.</div>`;
  const recent = rows.slice(-20);
  const totalDispatch = recent.reduce((sum, row) => sum + row.costo_despachado, 0);
  const totalNet = recent.reduce((sum, row) => sum + row.costo_incidencias_neto, 0);
  const totalSent = recent.reduce((sum, row) => sum + row.costo_incidencias_enviadas_neto, 0);
  const totalCd = recent.reduce((sum, row) => sum + row.costo_incidencias_cd_neto, 0);
  const weightedImpact = totalDispatch ? (totalNet / totalDispatch) * 100 : 0;
  const last = recent[recent.length - 1];
  const highest = recent.reduce((max, row) => row.porcentaje_impacto > max.porcentaje_impacto ? row : max, recent[0]);
  const turnGroups = ["Dia", "Noche"].map((turn) => {
    const turnRows = recent.filter((row) => row.turno === turn);
    const dispatch = turnRows.reduce((sum, row) => sum + row.costo_despachado, 0);
    const net = turnRows.reduce((sum, row) => sum + row.costo_incidencias_neto, 0);
    return {
      key: turn,
      count: turnRows.reduce((sum, row) => sum + row.incidencias, 0),
      bultos: turnRows.reduce((sum, row) => sum + row.bultos_faltantes, 0),
      precio: net,
      impact: dispatch ? (net / dispatch) * 100 : 0,
    };
  });
  const trend = recent.map((row) => ({
    key: `${row.fecha} ${row.turno}`,
    porcentaje_impacto: row.porcentaje_impacto,
    count: row.incidencias,
    bultos: row.bultos_faltantes,
  }));

  return `
    <div class="impact-history-dashboard">
      <div class="impact-history-kpis">
        <div><span>Promedio</span><strong>${weightedImpact.toFixed(2)}%</strong></div>
        <div><span>Ultimo</span><strong>${last.porcentaje_impacto.toFixed(2)}%</strong></div>
        <div><span>Pico</span><strong>${highest.porcentaje_impacto.toFixed(2)}%</strong></div>
        <div><span>Cortes</span><strong>${rows.length}</strong></div>
      </div>
      <div class="impact-history-grid">
        <div class="impact-history-panel trend">
          <div class="impact-history-label"><strong>Tendencia</strong><span>% impacto</span></div>
          ${renderLineChart(trend, "porcentaje_impacto", "% impacto")}
        </div>
        <div class="impact-history-panel">
          <div class="impact-history-label"><strong>Impacto por corte</strong><span>cortes</span></div>
          ${renderImpactDispatchBars(recent)}
        </div>
        <div class="impact-history-panel turn-pie">
          <div class="impact-history-label"><strong>Dia / noche</strong><span>neto</span></div>
          ${renderImpactTurnSplit(turnGroups)}
        </div>
        <div class="impact-history-panel location">
          <div class="impact-history-label"><strong>Salida</strong><span>enviado / CD</span></div>
          ${renderImpactHistoryLocationChart({
            sentCost: totalSent,
            cdCost: totalCd,
            sentPallets: recent.reduce((sum, row) => sum + row.pallets_incidencia_enviados, 0),
            cdPallets: recent.reduce((sum, row) => sum + row.pallets_incidencia_cd, 0),
            totalPallets: recent.reduce((sum, row) => sum + row.pallets_con_incidencia, 0),
          })}
        </div>
      </div>
    </div>
  `;
}

function renderImpactDispatchBars(rows) {
  if (!rows.length) return `<div class="chart-empty">Sin historico.</div>`;
  const maxImpact = Math.max(...rows.map((row) => row.porcentaje_impacto), 0.1);
  return `
    <div class="impact-dispatch-bars">
      ${rows.map((row) => `
        <div class="impact-dual-bar" title="${escapeHtml(row.fecha)} · ${escapeHtml(row.turno)}">
          <span>${escapeHtml(row.turno.slice(0, 1))}</span>
          <strong>${escapeHtml(row.fecha)}</strong>
          <b>${row.porcentaje_impacto.toFixed(2)}%</b>
          <div>
            <i class="incident" style="width:${Math.max(4, (row.porcentaje_impacto / maxImpact) * 100).toFixed(1)}%"></i>
          </div>
          <small>S/ ${money(row.costo_incidencias_neto)} inc. · S/ ${money(row.costo_despachado)} desp.</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderImpactTurnSplit(items) {
  const total = items.reduce((sum, item) => sum + item.precio, 0);
  let accumulated = 0;
  const colors = ["#e8792e", "#42784f"];
  const segments = total
    ? items.map((item, index) => {
      const start = accumulated;
      const end = accumulated + (item.precio / total) * 100;
      accumulated = end;
      return `${colors[index % colors.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    }).join(", ")
    : "#e8dccf 0% 100%";
  return `
    <div class="impact-turn-split">
      <div class="impact-turn-donut" style="--segments:${segments}">
        <span>Total neto</span>
        <strong>S/ ${money(total)}</strong>
      </div>
      <div class="impact-turn-legend">
        ${items.map((item, index) => `
          <div>
            <i style="background:${colors[index % colors.length]}"></i>
            <span>${escapeHtml(item.key)}</span>
            <strong>${total ? ((item.precio / total) * 100).toFixed(1) : "0.0"}%</strong>
            <small>S/ ${money(item.precio)} · ${item.count} inc.</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderImpactHistoryLocationChart(summary) {
  const total = summary.sentCost + summary.cdCost;
  const sentPercent = total ? (summary.sentCost / total) * 100 : 0;
  const cdPercent = total ? (summary.cdCost / total) * 100 : 0;
  const segments = total
    ? `#42784f 0% ${sentPercent.toFixed(2)}%, #a83224 ${sentPercent.toFixed(2)}% 100%`
    : "#e8dccf 0% 100%";
  return `
    <div class="impact-history-location">
      <div class="impact-history-donut" style="--segments:${segments}">
        <span>Total</span>
        <strong>${summary.totalPallets}</strong>
        <em>pallets</em>
      </div>
      <div class="impact-history-location-list">
        <div>
          <i class="sent"></i>
          <span>Enviado</span>
          <strong>${sentPercent.toFixed(1)}%</strong>
          <small>S/ ${money(summary.sentCost)} · ${summary.sentPallets} pallets</small>
        </div>
        <div>
          <i class="cd"></i>
          <span>En CD</span>
          <strong>${cdPercent.toFixed(1)}%</strong>
          <small>S/ ${money(summary.cdCost)} · ${summary.cdPallets} pallets</small>
        </div>
      </div>
    </div>
  `;
}

function renderImpactIncidentDetail(turnRows) {
  const rows = turnRows.flatMap((turn) => turn.incidentRows.map((row) => ({ ...row, _impactTurn: turn.turno })));
  if (!rows.length) return `<div class="chart-empty">Sin incidencias para esta fecha.</div>`;
  return `
    <div class="sent-table-wrap compact-table">
      <table class="sent-table">
        <thead>
          <tr>
            <th>Turno</th>
            <th>Estado envio</th>
            <th>Pallet / LPN</th>
            <th>Producto</th>
            <th>Carga / placa</th>
            <th>Chofer</th>
            <th>Costo neto</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice()
            .sort((a, b) => Number(b._sent) - Number(a._sent) || b._precio - a._precio)
            .slice(0, 80)
            .map((row) => {
              const shipment = row._shipment || {};
              const isRegularized = row.estado === "Regularizado";
              return `
                <tr class="${row._sent ? "sent" : "not-sent"}">
                  <td><strong>${escapeHtml(row._impactTurn)}</strong><small>${escapeHtml(row.fecha_incidente || "")}</small></td>
                  <td><span class="badge ${row._sent ? "ok" : "missing"}">${row._sent ? "Enviado" : "En CD"}</span></td>
                  <td><strong>${escapeHtml(row.pallet || "SIN PALLET")}</strong><small>${escapeHtml(row.lpn || "")}</small></td>
                  <td>${escapeHtml(row.descripcion)}<small>Codigo ${escapeHtml(row.codigos)}</small></td>
                  <td>${row._sent ? `<strong>${escapeHtml(shipment.carga || "-")}</strong><small>Placa ${escapeHtml(shipment.placa || "-")}</small>` : "-"}</td>
                  <td>${row._sent ? `${escapeHtml(shipment.chofer || "-")}<small>${escapeHtml(shipment.fechaDespacho || "Sin fecha despacho")}</small>` : "-"}</td>
                  <td><strong>S/ ${money(isRegularized ? 0 : row._precio)}</strong><small>${escapeHtml(row.estado)} · ${row._bultos.toFixed(2)} bultos</small></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboard() {
  const allRows = allDashboardRows();
  const rows = filteredSummaryDashboardRows(allRows);
  const stores = summaryStores(allRows);
  const totalBultos = rows.reduce((sum, row) => sum + row._bultos, 0);
  const totalPrecio = rows.reduce((sum, row) => sum + row._precio, 0);
  const precioPendiente = rows.filter((row) => row.estado === "Pendiente").reduce((sum, row) => sum + row._precio, 0);
  const precioRegularizado = rows.filter((row) => row.estado === "Regularizado").reduce((sum, row) => sum + row._precio, 0);
  const pendientes = rows.filter((row) => row.estado === "Pendiente").length;
  const regularizados = rows.filter((row) => row.estado === "Regularizado").length;
  const pallets = new Set(rows.map((row) => row.pallet).filter(Boolean)).size;
  const tendencia = state.dashboardTrend === "dates" ? trendByDate(rows) : trendByHour(rows);
  const topTiendas = groupSum(rows, (row) => `Tienda ${row.tienda}`).slice(0, 8);
  const topProductos = groupSum(rows, (row) => row.descripcion).slice(0, 8);

  return `
    <section class="panel dashboard">
      <div class="dashboard-header">
        <div>
          <span class="eyebrow">Dashboard de incidencias</span>
          <h2>${
            state.reportModule === "advance"
              ? "Reporte de avance"
              : state.reportModule === "sent"
                ? "Incidencias enviadas"
                : state.reportModule === "impact"
                  ? "Impacto economico"
                  : state.reportModule === "impactHistory"
                    ? "Impacto Turnos"
                    : "Reporte ejecutivo"
          }</h2>
          <p class="muted">${
            state.reportModule === "impactHistory"
              ? `${state.impactHistory.length} cortes guardados`
              : `${rows.length} de ${allRows.length} registros · ${escapeHtml(turnLabel(state.dashboardTurn))}`
          }</p>
        </div>
        <div class="report-module-tabs">
          <button class="tab ${state.reportModule === "summary" ? "active" : ""}" data-report-module="summary">Resumen</button>
          <button class="tab ${state.reportModule === "advance" ? "active" : ""}" data-report-module="advance">Avance</button>
          <button class="tab ${state.reportModule === "sent" ? "active" : ""}" data-report-module="sent">Enviado</button>
          <button class="tab ${state.reportModule === "impact" ? "active" : ""}" data-report-module="impact">Impacto</button>
          <button class="tab ${state.reportModule === "impactHistory" ? "active" : ""}" data-report-module="impactHistory">Impacto Turnos</button>
        </div>
      </div>
      ${state.reportStatus === "loading" ? `<p class="notice">Actualizando reporte...</p>` : ""}
      ${state.reportStatus === "error" ? `<p class="notice">${escapeHtml(state.reportError)}</p>` : ""}
      ${
        state.reportModule === "advance"
          ? renderAdvanceReport()
          : state.reportModule === "sent"
            ? renderSentIncidentsReport()
            : state.reportModule === "impact"
              ? renderImpactReport()
              : state.reportModule === "impactHistory"
                ? renderImpactHistoryReport()
          : `
      <div class="summary-filters">
        <label class="span-2">
          <span>Buscar</span>
          <input id="summaryQuery" value="${escapeAttr(state.summaryQuery)}" placeholder="Pallet, LPN, codigo, tienda o producto" />
        </label>
        <label>
          <span>Tienda</span>
          <select id="summaryStore">
            <option value="todos">Todas</option>
            ${stores.map((store) => `<option value="${escapeAttr(store)}" ${state.summaryStore === store ? "selected" : ""}>${escapeHtml(store)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select id="summaryStatus">
            <option value="todos" ${state.summaryStatus === "todos" ? "selected" : ""}>Todos</option>
            <option value="Pendiente" ${state.summaryStatus === "Pendiente" ? "selected" : ""}>Pendientes</option>
            <option value="Regularizado" ${state.summaryStatus === "Regularizado" ? "selected" : ""}>Regularizados</option>
          </select>
        </label>
        <label>
          <span>Desde</span>
          <input id="summaryDateFrom" type="date" value="${escapeAttr(state.summaryDateFrom)}" />
        </label>
        <label>
          <span>Hasta</span>
          <input id="summaryDateTo" type="date" value="${escapeAttr(state.summaryDateTo)}" />
        </label>
      </div>
      <div class="dashboard-filters">
        <button class="tab ${state.dashboardTurn === "todos" ? "active" : ""}" data-dashboard-turn="todos">Todos</button>
        <button class="tab ${state.dashboardTurn === "dia" ? "active" : ""}" data-dashboard-turn="dia">Dia 7-16</button>
        <button class="tab ${state.dashboardTurn === "tarde" ? "active" : ""}" data-dashboard-turn="tarde">Tarde 16-21</button>
        <button class="tab ${state.dashboardTurn === "noche" ? "active" : ""}" data-dashboard-turn="noche">Noche 21-6</button>
      </div>
      <div class="dashboard-kpis">
        <div class="kpi-card"><span>Incidencias</span><strong>${rows.length}</strong><small>${pendientes} pendientes</small></div>
        <div class="kpi-card"><span>Costo pendiente</span><strong>S/ ${money(precioPendiente)}</strong><small>Pendiente</small></div>
        <div class="kpi-card"><span>Costo regularizado</span><strong>S/ ${money(precioRegularizado)}</strong><small>${rows.length ? ((regularizados / rows.length) * 100).toFixed(1) : "0.0"}% incidencias</small></div>
        <div class="kpi-card"><span>Costo total</span><strong>S/ ${money(totalPrecio)}</strong><small>${totalBultos.toFixed(2)} bultos · ${pallets} pallets</small></div>
      </div>
      <div class="dashboard-grid">
        <article class="chart-card wide">
          <div class="chart-title">
            <div>
              <h3>Tendencia de incidencias</h3>
              <span>${state.dashboardTrend === "dates" ? "Por fechas" : "Por horas del dia"}</span>
            </div>
            <div class="mini-tabs">
              <button class="${state.dashboardTrend === "hours" ? "active" : ""}" data-dashboard-trend="hours">Horas</button>
              <button class="${state.dashboardTrend === "dates" ? "active" : ""}" data-dashboard-trend="dates">Fechas</button>
            </div>
          </div>
          ${renderLineChart(tendencia, "count", "incidencias")}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Bultos por turno</h3><span>Dia · Tarde · Noche</span></div>
          ${renderTurnChart(rows)}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Regularizacion</h3><span>Soles</span></div>
          ${renderStatusChart(rows)}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Top productos</h3><span>Costo</span></div>
          ${renderBars(topProductos, totalPrecio, "precio")}
        </article>
        <article class="chart-card">
          <div class="chart-title"><h3>Top tiendas</h3><span>Costo</span></div>
          ${renderBars(topTiendas, totalPrecio, "precio")}
        </article>
        <article class="chart-card wide recent-card">
          <div class="chart-title"><h3>Ultimas incidencias</h3><span>Recientes</span></div>
          ${renderRecentIncidents(rows)}
        </article>
      </div>
      `
      }
    </section>
  `;
}

function renderHistory() {
  return `
    <section class="panel history">
      <div class="history-header">
        <div>
          <h2>Reporte de incidencias</h2>
        </div>
        <div class="quick-actions">
          ${canManageIncidents() ? `<button class="btn danger" id="deleteSelectedBtn">Eliminar seleccionadas</button>` : ""}
          ${canManageIncidents() ? `<button class="btn ghost" id="refreshReportBtn">Actualizar data Google Sheet</button>` : ""}
          <button class="btn warning" id="historyExportBtn">Exportar Excel</button>
        </div>
      </div>
      <a class="report-link" href="${REPORT_SHEET_URL}" target="_blank" rel="noreferrer">Abrir Google Sheet de reportes</a>
      ${state.reportStatus === "loading" ? `<p class="notice">Actualizando reporte...</p>` : ""}
      ${state.reportStatus === "error" ? `<p class="notice">${escapeHtml(state.reportError)}</p>` : ""}
      <div class="history-list">
        ${
          state.incidents
            .map(normalizeIncidentForExport)
            .filter(isCleanIncident)
            .slice(0, 30)
            .map(
              (normalized) => {
                return `
                <article class="incident">
                  ${
                    canManageIncidents() && normalized.id
                      ? `<label class="incident-check" title="Seleccionar incidencia">
                          <input type="checkbox" data-incident-select="${escapeAttr(normalized.id)}" ${state.selectedIncidentIds.has(String(normalized.id)) ? "checked" : ""} />
                        </label>`
                      : ""
                  }
                  <div>
                    <strong>${escapeHtml(normalized.descripcion)}</strong>
                    <div class="muted">Tienda ${escapeHtml(normalized.tienda)} · Pallet ${escapeHtml(normalized.pallet || "SIN PALLET")} · LPN ${escapeHtml(normalized.lpn)} · Codigo ${escapeHtml(normalized.codigos)}</div>
                    ${normalized.fecha_incidente ? `<div class="muted">Incidencia: ${escapeHtml(normalized.fecha_incidente)}</div>` : ""}
                    ${normalized.fecha_regularizado ? `<div class="muted">Regularizado: ${escapeHtml(normalized.fecha_regularizado)}</div>` : ""}
                  </div>
                  <div class="incident-actions">
                    <span class="badge missing">${escapeHtml(normalized.bultos || "0.00")} bultos falt.</span>
                    ${normalized.precio ? `<span class="badge">S/ ${money(normalized.precio)}</span>` : ""}
                    ${
                      canManageIncidents() && normalized.id
                        ? `<select class="status-select" data-status-id="${escapeAttr(normalized.id)}">
                            <option value="Pendiente" ${normalized.estado === "Pendiente" ? "selected" : ""}>Pendiente</option>
                            <option value="Regularizado" ${normalized.estado === "Regularizado" ? "selected" : ""}>Regularizado</option>
                          </select>`
                        : `<span class="badge">${escapeHtml(normalized.estado)}</span>`
                    }
                  </div>
                </article>
              `;
              },
            )
            .join("") || `<p class="muted">Sin incidencias.</p>`
        }
      </div>
    </section>
  `;
}

function renderEmpty() {
  return `
    <div class="empty">
      <h2>Sin seleccion</h2>
    </div>
  `;
}

function bindAppEvents(group) {
  document.querySelector("#logoutBtn").addEventListener("click", logout);
  document.querySelector("#changeSupervisorViewBtn")?.addEventListener("click", changeSupervisorView);
  document.querySelector("#changeViewBtn")?.addEventListener("click", changeValidatorView);
  document.querySelector("#reloadBtn")?.addEventListener("click", loadData);
  document.querySelector("#resetBtn")?.addEventListener("click", resetPage);
  document.querySelector("#query")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedKey = "";
    state.tableQuery = "";
    window.clearTimeout(queryRenderTimer);
    queryRenderTimer = window.setTimeout(refreshSearchResultsOnly, 80);
  });
  document.querySelector("#tableQuery")?.addEventListener("input", (event) => {
    state.tableQuery = event.target.value;
    filterValidationTable(state.tableQuery);
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.querySelectorAll("[data-dashboard-turn]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboardTurn = button.dataset.dashboardTurn;
      render();
    });
  });
  document.querySelectorAll("[data-dashboard-trend]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboardTrend = button.dataset.dashboardTrend;
      render();
    });
  });
  document.querySelectorAll("[data-report-module]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reportModule = button.dataset.reportModule;
      render();
    });
  });
  document.querySelector("#summaryQuery")?.addEventListener("input", (event) => {
    state.summaryQuery = event.target.value;
    const cursor = event.target.selectionStart ?? state.summaryQuery.length;
    window.clearTimeout(queryRenderTimer);
    queryRenderTimer = window.setTimeout(() => {
      render();
      window.requestAnimationFrame(() => {
        const input = document.querySelector("#summaryQuery");
        if (!input) return;
        input.focus();
        const nextCursor = Math.min(cursor, input.value.length);
        input.setSelectionRange(nextCursor, nextCursor);
      });
    }, 120);
  });
  document.querySelector("#summaryStore")?.addEventListener("change", (event) => {
    state.summaryStore = event.target.value;
    render();
  });
  document.querySelector("#summaryStatus")?.addEventListener("change", (event) => {
    state.summaryStatus = event.target.value;
    render();
  });
  document.querySelector("#summaryDateFrom")?.addEventListener("change", (event) => {
    state.summaryDateFrom = event.target.value;
    render();
  });
  document.querySelector("#summaryDateTo")?.addEventListener("change", (event) => {
    state.summaryDateTo = event.target.value;
    render();
  });
  document.querySelector("#advanceStore")?.addEventListener("change", (event) => {
    state.advanceStore = event.target.value;
    render();
  });
  document.querySelector("#advanceStatus")?.addEventListener("change", (event) => {
    state.advanceStatus = event.target.value;
    render();
  });
  document.querySelector("#advancePeriod")?.addEventListener("change", (event) => {
    state.advancePeriod = event.target.value;
    render();
  });
  document.querySelector("#sentQuery")?.addEventListener("input", (event) => {
    state.sentQuery = event.target.value;
    const cursor = event.target.selectionStart ?? state.sentQuery.length;
    window.clearTimeout(queryRenderTimer);
    queryRenderTimer = window.setTimeout(() => {
      render();
      window.requestAnimationFrame(() => {
        const input = document.querySelector("#sentQuery");
        if (!input) return;
        input.focus();
        const nextCursor = Math.min(cursor, input.value.length);
        input.setSelectionRange(nextCursor, nextCursor);
      });
    }, 120);
  });
  document.querySelector("#sentStore")?.addEventListener("change", (event) => {
    state.sentStore = event.target.value;
    render();
  });
  document.querySelector("#sentStatusFilter")?.addEventListener("change", (event) => {
    state.sentStatusFilter = event.target.value;
    render();
  });
  document.querySelector("#sentDateFrom")?.addEventListener("change", (event) => {
    state.sentDateFrom = event.target.value;
    render();
  });
  document.querySelector("#sentDateTo")?.addEventListener("change", (event) => {
    state.sentDateTo = event.target.value;
    render();
  });
  document.querySelector("#sentExportBtn")?.addEventListener("click", exportSentReport);
  document.querySelector("#impactDate")?.addEventListener("change", (event) => {
    state.impactDate = event.target.value;
    render();
  });
  document.querySelector("#impactHistoryDate")?.addEventListener("change", (event) => {
    state.impactHistoryDate = event.target.value;
    render();
  });
  document.querySelector("#saveImpactBtn")?.addEventListener("click", saveImpactSnapshot);
  document.querySelectorAll("[data-sent-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sentDetailKey = button.dataset.sentDetail;
      render();
    });
  });
  document.querySelector("#closeSentDetailBtn")?.addEventListener("click", () => {
    state.sentDetailKey = "";
    render();
  });
  bindSearchResultEvents();
  document.querySelectorAll("[data-ok]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = state.rowsForBinding.find((item) => validationKey(item) === button.dataset.ok);
      if (row) markOk(row);
    });
  });
  document.querySelectorAll("[data-incident]").forEach((button) => {
    button.addEventListener("click", () => {
      openMissingModal(button.dataset.incident);
    });
  });
  document.querySelector("#historyExportBtn")?.addEventListener("click", exportIncidents);
  document.querySelector("#refreshReportBtn")?.addEventListener("click", loadReportIncidents);
  document.querySelector("#deleteSelectedBtn")?.addEventListener("click", deleteSelectedIncidents);
  document.querySelectorAll("[data-incident-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleIncidentSelection(checkbox.dataset.incidentSelect, checkbox.checked));
  });
  document.querySelectorAll("[data-status-id]").forEach((select) => {
    select.addEventListener("change", () => updateIncidentStatus(select.dataset.statusId, select.value));
  });
  document.querySelector("#exportBtn")?.addEventListener("click", exportIncidents);
  document.querySelector("#validateAllBtn")?.addEventListener("click", () => validateAll(group));
  document.querySelector("#closeMissingBtn")?.addEventListener("click", closeMissingModal);
  document.querySelector("#cancelMissingBtn")?.addEventListener("click", closeMissingModal);
  document.querySelector("#missingForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const row = state.rowsForBinding.find((item) => validationKey(item) === state.missingModalRowKey);
    if (!row) return;
    const form = new FormData(event.currentTarget);
    reportIncident(row, form.get("missingBultos"));
  });
  document.querySelector("#missingBultos")?.addEventListener("input", (event) => {
    const row = state.rowsForBinding.find((item) => validationKey(item) === state.missingModalRowKey);
    const preview = document.querySelector("#missingCostPreview");
    if (!row || !preview) return;
    const totals = missingPreview(row, event.target.value);
    preview.innerHTML = `
      <div><span>Unidades faltantes</span><strong>${money(totals.units)}</strong></div>
      <div><span>Precio a reportar</span><strong>S/ ${money(totals.price)}</strong></div>
    `;
  });
  if (state.tableQuery) filterValidationTable(state.tableQuery);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function render() {
  if (state.user && !USERS.some((item) => item.user === state.user.user)) {
    localStorage.removeItem(STORAGE_KEYS.session);
    state.user = null;
  }

  if (!state.user) {
    renderLogin();
    return;
  }
  if (state.user.role === "Invitado") {
    state.supervisorView = "report";
  }
  if (state.user.role === "Supervisor" && !state.supervisorView) {
    renderSupervisorViewPicker();
    return;
  }
  if (!canViewSupervisorReport() && !state.validatorView) {
    renderValidatorViewPicker();
    return;
  }
  const group = selectedGroup();
  state.rowsForBinding = group ? consolidateProductRows(group.rows, group.mode === "pallet" ? "pallet" : "lpn") : [];
  renderApp();
}

render();
if (canViewSupervisorReport()) {
  if (state.user.role === "Invitado") state.supervisorView = "report";
  if (state.supervisorView) {
    startReportAutoRefresh();
    loadReportIncidents();
  }
} else if (state.user && state.validatorView) {
  loadData();
}

window.addEventListener("storage", (event) => {
  if (!canViewSupervisorReport()) return;
  if (event.key === STORAGE_KEYS.reportPing) {
    loadReportIncidents({ silent: true });
  }
});
