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
function setupWorkspace() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const active = Session.getActiveUser().getEmail().toLowerCase();
    const effective = Session.getEffectiveUser().getEmail().toLowerCase();
    if (!active || active !== effective)
      throw new Error("Run setup from your own Apps Script editor.");
    if (
      props.getProperty("OWNER_EMAIL") &&
      props.getProperty("OWNER_EMAIL").toLowerCase() !== active
    )
      throw new Error("ACCESS_DENIED");
    props.setProperty("OWNER_EMAIL", active);
    let id = props.getProperty("WORKSPACE_SPREADSHEET_ID");
    const created = !id;
    const book = id
      ? SpreadsheetApp.openById(id)
      : (typeof SpreadsheetApp.getActiveSpreadsheet === "function" &&
          SpreadsheetApp.getActiveSpreadsheet()) ||
        SpreadsheetApp.create("GVI Studio — рабочие задачи");
    // Persist the ID first; a retry repairs only an empty, newly created sheet.
    if (!id) props.setProperty("WORKSPACE_SPREADSHEET_ID", book.getId());
    let sheet = book.getSheetByName("Tasks");
    if (!sheet) {
      const sheets = book.getSheets();
      if (sheets.length !== 1 || sheets[0].getLastRow() !== 0)
        throw new Error("SCHEMA_ERROR");
      sheet = sheets[0];
      sheet.setName("Tasks");
    }
    if (sheet.getLastRow() === 0)
      sheet.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
    else if (
      JSON.stringify(
        sheet.getRange(1, 1, 1, TASK_HEADERS.length).getValues()[0],
      ) !== JSON.stringify(TASK_HEADERS)
    )
      throw new Error("SCHEMA_ERROR");
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, 1, TASK_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#f57900");
    sheet.setColumnWidth(3, 280);
    sheet.setColumnWidth(4, 400);
    sheet
      .getRange(1, 1)
      .setNote(
        "Use the GVI Studio panel to edit. Do not rename headers. No GTO participant data belongs here.",
      );
    SpreadsheetApp.flush();
    return { spreadsheetUrl: book.getUrl(), created: created };
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
function read_() {
  const book = book_(),
    sheet = book.getSheetByName("Tasks");
  if (!sheet || sheet.getLastRow() > 2001) throw new Error("SCHEMA_ERROR");
  const values =
    Sheets.Spreadsheets.Values.get(book.getId(), "'Tasks'!A:L", {
      valueRenderOption: "UNFORMATTED_VALUE",
    }).values || [];
  if (values.length > 2001) throw new Error("SCHEMA_ERROR");
  const rows = values.map((r) =>
    TASK_HEADERS.map((_, i) => (r[i] === undefined ? "" : r[i])),
  );
  if (JSON.stringify(rows[0]) !== JSON.stringify(TASK_HEADERS))
    throw new Error("SCHEMA_ERROR");
  const tasks = normalizeTasks_(
    rows
      .slice(1)
      .filter((r) => r.some((v) => v !== ""))
      .map((row) =>
        Object.fromEntries(
          TASK_HEADERS.map((k, i) => [
            k,
            k === "sample" ? row[i] === true : String(row[i] ?? ""),
          ]),
        ),
      ),
  );
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(rows),
    Utilities.Charset.UTF_8,
  )
    .map((b) => ("0" + ((b + 256) % 256).toString(16)).slice(-2))
    .join("");
  return {
    book: book,
    sheet: sheet,
    tasks: tasks,
    revision: digest,
    rowCount: rows.length,
  };
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
    const matrix = [
      TASK_HEADERS,
      ...tasks.map((t) => TASK_HEADERS.map((k) => t[k])),
    ];
    // Atomic Sheets API request. Explicit stringValue prevents formula injection.
    const requests = [];
    if (matrix.length > current.sheet.getMaxRows())
      requests.push({
        appendDimension: {
          sheetId: current.sheet.getSheetId(),
          dimension: "ROWS",
          length: matrix.length - current.sheet.getMaxRows(),
        },
      });
    requests.push({
      updateCells: {
        range: {
          sheetId: current.sheet.getSheetId(),
          startRowIndex: 0,
          endRowIndex: Math.max(matrix.length, current.rowCount),
          startColumnIndex: 0,
          endColumnIndex: TASK_HEADERS.length,
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
    Sheets.Spreadsheets.batchUpdate(
      { requests: requests },
      current.book.getId(),
    );
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
