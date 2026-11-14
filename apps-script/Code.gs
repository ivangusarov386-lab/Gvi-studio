/** Private single-owner workspace. GTO sources are never opened by this script. */
const TASK_HEADERS = [
  "id",
  "project",
  "title",
  "description",
  "status",
  "priority",
  "due",
  "materials",
  "stage",
  "createdAt",
  "updatedAt",
  "sample",
];
const PROJECTS = ["gto", "mesh", "seo", "start"];
function owner_() {
  const owner =
    PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL");
  const active = Session.getActiveUser().getEmail().toLowerCase();
  if (!owner || !active || active !== owner.toLowerCase())
    throw new Error("ACCESS_DENIED");
}
const PROJECT_SHEETS = {
  gto: "Система ГТО",
  mesh: "Расширение МЭШ",
  seo: "SEO сайта",
  start: "Точка старта",
};
const SHEET_HEADERS = [
  "Задача",
  "Описание",
  "Статус",
  "Приоритет",
  "Срок",
  "Связанные материалы",
  "Версия / этап",
  "Дата создания",
  "Дата изменения",
];
const META_HEADERS = ["ID задачи", "Пример"];
function setupWorkspace() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const active = Session.getActiveUser().getEmail().toLowerCase();
    const effective = Session.getEffectiveUser().getEmail().toLowerCase();
    if (!active || active !== effective) throw new Error("ACCESS_DENIED");
    if (
      props.getProperty("OWNER_EMAIL") &&
      props.getProperty("OWNER_EMAIL").toLowerCase() !== active
    )
      throw new Error("ACCESS_DENIED");
    const existing = props.getProperty("WORKSPACE_SPREADSHEET_ID");
    const book = existing
      ? SpreadsheetApp.openById(existing)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!book)
      throw new Error(
        "Откройте импортированную таблицу и запустите скрипт из неё.",
      );
    const sheets = Object.keys(PROJECT_SHEETS).map((id) => {
      const sh = book.getSheetByName(PROJECT_SHEETS[id]);
      if (!sh || sh.getLastColumn() > 11 || sh.getMaxColumns() < 9)
        throw new Error("SCHEMA_ERROR");
      const rows = sh
        .getRange(
          1,
          1,
          Math.max(sh.getLastRow(), 1),
          Math.min(sh.getMaxColumns(), 11),
        )
        .getValues()
        .map((row) =>
          Array.from({ length: 11 }, (_, i) =>
            row[i] === undefined ? "" : row[i],
          ),
        );
      if (JSON.stringify(rows[0].slice(0, 9)) !== JSON.stringify(SHEET_HEADERS))
        throw new Error("SCHEMA_ERROR");
      const meta = rows[0].slice(9, 11);
      const empty = meta.every((x) => x === "");
      if (!empty && JSON.stringify(meta) !== JSON.stringify(META_HEADERS))
        throw new Error("SCHEMA_ERROR");
      if (empty && rows.slice(1).some((r) => r[9] !== "" || r[10] !== ""))
        throw new Error("SCHEMA_ERROR");
      return { sh, empty };
    });
    // Only the two empty metadata headers are added. Existing task cells remain untouched.
    for (const { sh, empty } of sheets) {
      if (sh.getMaxColumns() < 11)
        sh.insertColumnsAfter(sh.getMaxColumns(), 11 - sh.getMaxColumns());
      if (empty) sh.getRange(1, 10, 1, 2).setValues([META_HEADERS]);
    }
    SpreadsheetApp.flush();
    props.setProperty("OWNER_EMAIL", active);
    props.setProperty("WORKSPACE_SPREADSHEET_ID", book.getId());
    return { spreadsheetUrl: book.getUrl(), created: !existing };
  } finally {
    lock.releaseLock();
  }
}
function doGet() {
  owner_();
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("GVI Studio — облачные задачи")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty(
    "WORKSPACE_SPREADSHEET_ID",
  );
  if (!id) throw new Error("NOT_CONFIGURED");
  return SpreadsheetApp.openById(id);
}
function normalizeTasks_(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 2000)
    throw new Error("INVALID_TASKS");
  const seen = {};
  return tasks.map((t) => {
    if (
      !t ||
      typeof t.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(t.id) ||
      seen[t.id] ||
      PROJECTS.indexOf(t.project) < 0
    )
      throw new Error("INVALID_TASK");
    seen[t.id] = true;
    const out = {};
    TASK_HEADERS.forEach((k) => {
      if (k === "sample") {
        out[k] = t[k] === true;
        return;
      }
      const v = t[k] === undefined ? "" : t[k];
      if (typeof v !== "string" || v.length > 40000)
        throw new Error("INVALID_FIELD");
      out[k] = v;
    });
    if (
      !out.title.trim() ||
      out.title.length > 250 ||
      ["запланировано", "в работе", "на проверке", "выполнено"].indexOf(
        out.status,
      ) < 0 ||
      ["низкий", "средний", "высокий"].indexOf(out.priority) < 0
    )
      throw new Error("INVALID_TASK");
    ["createdAt", "updatedAt"].forEach((k) => {
      if (!/^\d{4}-\d{2}-\d{2}T/.test(out[k]) || isNaN(Date.parse(out[k])))
        throw new Error("INVALID_DATE");
    });
    if (
      out.due &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(out.due) ||
        isNaN(Date.parse(out.due)) ||
        new Date(out.due).toISOString().slice(0, 10) !== out.due)
    )
      throw new Error("INVALID_DATE");
    return out;
  });
}
function sheetDate_(value, timestamp) {
  if (value === "" || value == null) return "";
  let str = String(value);
  if (typeof value === "number")
    str = new Date(Math.round((value - 25569) * 86400000)).toISOString();
  const match = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) str = match[3] + "-" + match[2] + "-" + match[1];
  if (timestamp && /^\d{4}-\d{2}-\d{2}$/.test(str)) str += "T00:00:00.000Z";
  if (timestamp) {
    if (isNaN(Date.parse(str))) throw new Error("SCHEMA_ERROR");
    return new Date(str).toISOString();
  }
  const day = str.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    isNaN(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    throw new Error("SCHEMA_ERROR");
  return day;
}
function read_() {
  const book = book_(),
    projects = [],
    tasks = [],
    pending = [];
  for (const id of Object.keys(PROJECT_SHEETS)) {
    const sheet = book.getSheetByName(PROJECT_SHEETS[id]);
    if (!sheet || sheet.getLastRow() > 2001 || sheet.getLastColumn() > 11)
      throw new Error("SCHEMA_ERROR");
    const values =
      Sheets.Spreadsheets.Values.get(
        book.getId(),
        "'" + PROJECT_SHEETS[id] + "'!A:K",
        { valueRenderOption: "UNFORMATTED_VALUE" },
      ).values || [];
    if (values.length > 2001) throw new Error("SCHEMA_ERROR");
    const rows = values.map((row) =>
      Array.from({ length: 11 }, (_, i) =>
        row[i] === undefined ? "" : row[i],
      ),
    );
    if (
      JSON.stringify(rows[0]) !==
      JSON.stringify([...SHEET_HEADERS, ...META_HEADERS])
    )
      throw new Error("SCHEMA_ERROR");
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((v) => v === "")) continue;
      if (!String(row[0]).trim()) throw new Error("SCHEMA_ERROR");
      const now = new Date().toISOString();
      for (const col of [7, 8, 9])
        if (!row[col]) {
          row[col] = col === 9 ? Utilities.getUuid() : now;
          pending.push({
            updateCells: {
              range: {
                sheetId: sheet.getSheetId(),
                startRowIndex: i,
                endRowIndex: i + 1,
                startColumnIndex: col,
                endColumnIndex: col + 1,
              },
              rows: [
                { values: [{ userEnteredValue: { stringValue: row[col] } }] },
              ],
              fields: "userEnteredValue",
            },
          });
        }
      const status = String(row[2] || "Запланировано")
        .trim()
        .toLowerCase();
      const priority = String(row[3] || "Средний")
        .trim()
        .toLowerCase();
      tasks.push({
        id: String(row[9]),
        project: id,
        title: String(row[0]),
        description: String(row[1]),
        status,
        priority,
        due: sheetDate_(row[4], false),
        materials: String(row[5]),
        stage: String(row[6]),
        createdAt: sheetDate_(row[7], true),
        updatedAt: sheetDate_(row[8], true),
        sample: row[10] === true || String(row[10]).toLowerCase() === "true",
      });
    }
    projects.push({ id, sheet, rows });
  }
  const checked = normalizeTasks_(tasks);
  if (pending.length)
    Sheets.Spreadsheets.batchUpdate({ requests: pending }, book.getId());
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(projects.map((p) => p.rows)),
    Utilities.Charset.UTF_8,
  )
    .map((b) => ("0" + ((b + 256) % 256).toString(16)).slice(-2))
    .join("");
  return { book, projects, tasks: checked, revision: digest };
}
function snapshot_(data) {
  return {
    tasks: data.tasks,
    revision: data.revision,
    spreadsheetUrl: data.book.getUrl(),
    syncedAt: new Date().toISOString(),
  };
}
function getTasks() {
  owner_();
  return getTasks_();
}
function getTasks_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return snapshot_(read_());
  } finally {
    lock.releaseLock();
  }
}
function saveTasks(request) {
  owner_();
  return saveTasks_(request);
}
function saveTasks_(request) {
  if (!request || typeof request.revision !== "string")
    throw new Error("INVALID_REQUEST");
  const tasks = normalizeTasks_(request.tasks);
  if (JSON.stringify(tasks).length > 2000000)
    throw new Error("WORKSPACE_TOO_LARGE");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const current = read_();
    if (current.revision !== request.revision) throw new Error("CONFLICT");
    const requests = [];
    const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
    for (const project of current.projects) {
      const matrix = [
        [...SHEET_HEADERS, ...META_HEADERS],
        ...tasks
          .filter((t) => t.project === project.id)
          .map((t) => [
            t.title,
            t.description,
            titleCase(t.status),
            titleCase(t.priority),
            t.due,
            t.materials,
            t.stage,
            t.createdAt,
            t.updatedAt,
            t.id,
            t.sample,
          ]),
      ];
      const end = Math.max(matrix.length, project.rows.length);
      if (end > project.sheet.getMaxRows())
        requests.push({
          appendDimension: {
            sheetId: project.sheet.getSheetId(),
            dimension: "ROWS",
            length: end - project.sheet.getMaxRows(),
          },
        });
      requests.push({
        updateCells: {
          range: {
            sheetId: project.sheet.getSheetId(),
            startRowIndex: 0,
            endRowIndex: end,
            startColumnIndex: 0,
            endColumnIndex: 11,
          },
          rows: matrix.map((row) => ({
            values: row.map((v) => ({
              userEnteredValue:
                typeof v === "boolean" ? { boolValue: v } : { stringValue: v },
            })),
          })),
          fields: "userEnteredValue",
        },
      });
    }
    Sheets.Spreadsheets.batchUpdate({ requests }, current.book.getId());
    return snapshot_(read_());
  } finally {
    lock.releaseLock();
  }
}

// Отдельный пароль для панели GVI Studio; функция выполняется владельцем в редакторе таблицы.
function setupTaskPassword() {
  owner_();
  const ui = SpreadsheetApp.getUi();
  const prompt = ui.prompt(
    "Пароль GVI Studio",
    "Введите новый пароль не короче 12 символов. Он не сохраняется в коде.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  const password = prompt.getResponseText();
  if (password.length < 12)
    throw new Error("Пароль должен содержать не менее 12 символов.");
  const properties = PropertiesService.getScriptProperties();
  properties.setProperties({
    TASK_PASSWORD: password,
    TASK_SIGNING_KEY: Utilities.getUuid() + Utilities.getUuid(),
  });
}
function taskEqual_(a, b) {
  a = String(a);
  b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function taskSign_(body, key, password) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, key + ":" + password),
  );
}
function taskJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents),
      props = PropertiesService.getScriptProperties();
    const password = props.getProperty("TASK_PASSWORD"),
      key = props.getProperty("TASK_SIGNING_KEY");
    if (!password || !key)
      return taskJson_({
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Пароль таблицы не настроен.",
      });
    if (data.action === "login") {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const cache = CacheService.getScriptCache(),
          count = Number(cache.get("task_login_failures") || 0);
        if (count >= 20)
          return taskJson_({
            ok: false,
            error: "Слишком много попыток. Подождите минуту.",
          });
        if (!taskEqual_(data.password || "", password)) {
          cache.put("task_login_failures", String(count + 1), 60);
          return taskJson_({ ok: false, error: "Неверный пароль." });
        }
        cache.remove("task_login_failures");
        const body = Utilities.base64EncodeWebSafe(
          JSON.stringify({
            scope: "gvi-tasks",
            exp: Date.now() + 8 * 60 * 60 * 1000,
            nonce: Utilities.getUuid(),
          }),
        );
        return taskJson_({
          ok: true,
          session: body + "." + taskSign_(body, key, password),
        });
      } finally {
        lock.releaseLock();
      }
    }
    const parts = String(data.session || "").split(".");
    if (
      parts.length !== 2 ||
      !taskEqual_(parts[1], taskSign_(parts[0], key, password))
    )
      return taskJson_({
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Войдите с паролем.",
      });
    const token = JSON.parse(
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(parts[0]),
      ).getDataAsString(),
    );
    if (
      token.scope !== "gvi-tasks" ||
      token.exp <= Date.now() ||
      token.exp > Date.now() + 8 * 60 * 60 * 1000
    )
      return taskJson_({
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Сеанс истёк.",
      });
    if (data.action === "getTasks")
      return taskJson_({ ok: true, data: getTasks_() });
    if (data.action === "saveTasks")
      return taskJson_({ ok: true, data: saveTasks_(data.payload) });
    return taskJson_({ ok: false, error: "Неизвестное действие." });
  } catch (err) {
    const code = [
      "CONFLICT",
      "SCHEMA_ERROR",
      "NOT_CONFIGURED",
      "INVALID_TASK",
      "INVALID_FIELD",
      "INVALID_DATE",
      "WORKSPACE_TOO_LARGE",
    ].find((c) => String(err.message || err).includes(c));
    return taskJson_({
      ok: false,
      code: code || "ERROR",
      error: "Операция не выполнена. Проверьте настройки и повторите.",
    });
  }
}
