import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { fresh } from "../lib/store.js";
const code = await readFile(
  new URL("../apps-script/Code.gs", import.meta.url),
  "utf8",
);
const names = ["Система ГТО", "Расширение МЭШ", "SEO сайта", "Точка старта"];
const headers = [
  "Задача",
  "Описание",
  "Статус",
  "Приоритет",
  "Срок",
  "Связанные материалы",
  "Версия / этап",
  "Дата создания",
  "Дата изменения",
  "ID задачи",
  "Пример",
];
function fixture() {
  let email = "owner@example.invalid",
    locked = false,
    writes = 0,
    lastRequest = null,
    uuid = 0;
  const data = Object.fromEntries(names.map((n) => [n, [headers.slice()]]));
  const sheets = Object.fromEntries(
    names.map((n, i) => [
      n,
      {
        getLastRow: () => data[n].length,
        getSheetId: () => i,
        getMaxRows: () => 1000,
        getMaxColumns: () => 11,
        getLastColumn: () =>
          Math.max(
            ...data[n].map((r) =>
              r.reduce(
                (last, v, i) => (v !== "" && v !== undefined ? i + 1 : last),
                0,
              ),
            ),
          ),
        getRange: () => ({
          getValues: () =>
            data[n].map((r) =>
              Array.from({ length: 11 }, (_, j) => r[j] ?? ""),
            ),
          setValues: (values) => {
            data[n][0].splice(9, 2, ...values[0]);
          },
        }),
      },
    ]),
  );
  const book = {
    getId: () => "synthetic-workspace",
    getUrl: () =>
      "https://docs.google.com/spreadsheets/d/synthetic-workspace/edit",
    getSheetByName: (n) => sheets[n],
  };
  const props = {
    OWNER_EMAIL: "owner@example.invalid",
    WORKSPACE_SPREADSHEET_ID: "synthetic-workspace",
    TASK_PASSWORD: "synthetic-password",
    TASK_SIGNING_KEY: "synthetic-key",
  };
  const ctx = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k] || null,
        setProperty: (k, v) => (props[k] = v),
      }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => email }),
      getEffectiveUser: () => ({ getEmail: () => email }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(locked, false);
          locked = true;
        },
        releaseLock: () => (locked = false),
      }),
    },
    SpreadsheetApp: {
      openById: () => book,
      getActiveSpreadsheet: () => book,
      flush: () => {},
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, text) => [
        ...createHash("sha256").update(text).digest(),
      ],
      getUuid: () => `uuid-${++uuid}`,
      base64EncodeWebSafe: (x) => Buffer.from(x).toString("base64url"),
      base64DecodeWebSafe: (x) => Buffer.from(x, "base64url"),
      newBlob: (x) => ({ getDataAsString: () => Buffer.from(x).toString() }),
      computeHmacSha256Signature: (body, key) =>
        createHmac("sha256", key).update(body).digest(),
    },
    CacheService: {
      getScriptCache: () => ({ get: () => 0, put: () => {}, remove: () => {} }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
    },
    Sheets: {
      Spreadsheets: {
        Values: {
          get: (_id, range) => ({
            values: data[range.slice(1, range.indexOf("'!"))],
          }),
        },
        batchUpdate: (request) => {
          assert.equal(locked, true);
          writes++;
          lastRequest = request;
          for (const r of request.requests) {
            if (!r.updateCells) continue;
            const u = r.updateCells,
              n = names[u.range.sheetId];
            if (u.range.startRowIndex === 0) {
              data[n] = u.rows.map((row) =>
                row.values.map(
                  (v) =>
                    v.userEnteredValue.stringValue ??
                    v.userEnteredValue.boolValue,
                ),
              );
            } else
              for (let i = 0; i < u.rows.length; i++)
                for (let j = 0; j < u.rows[i].values.length; j++)
                  data[n][u.range.startRowIndex + i][
                    u.range.startColumnIndex + j
                  ] = u.rows[i].values[j].userEnteredValue.stringValue;
          }
        },
      },
    },
  });
  vm.runInContext(code, ctx);
  return {
    ctx,
    data,
    props,
    get writes() {
      return writes;
    },
    get request() {
      return lastRequest;
    },
    setEmail: (v) => (email = v),
  };
}
test("tasks are saved to four separate project sheets without interpreting formulas", () => {
  const f = fixture(),
    initial = f.ctx.getTasks(),
    tasks = fresh().tasks.slice(0, 4);
  tasks[0].title = '=IMPORTXML("https://example.invalid","//x")';
  const saved = f.ctx.saveTasks({ revision: initial.revision, tasks });
  assert.equal(saved.tasks.length, 4);
  assert.equal(f.data["Система ГТО"][1][0], tasks[0].title);
  assert.equal(f.data["Расширение МЭШ"][1][0], tasks[3].title);
  assert.equal(f.request.requests.filter((r) => r.updateCells).length, 4);
  assert.ok(!JSON.stringify(f.request).includes("formulaValue"));
  const empty = f.ctx.saveTasks({ revision: saved.revision, tasks: [] });
  assert.equal(empty.tasks.length, 0);
});
test("manual rows get stable IDs, default status and dates; values survive reading", () => {
  const f = fixture();
  f.data["SEO сайта"].push([
    "Проверить сайт",
    "описание",
    "В работе",
    "Высокий",
    "25.12.2026",
  ]);
  const first = f.ctx.getTasks(),
    second = f.ctx.getTasks(),
    task = first.tasks[0];
  assert.equal(task.project, "seo");
  assert.equal(task.status, "в работе");
  assert.equal(task.priority, "высокий");
  assert.equal(task.due, "2026-12-25");
  assert.equal(task.id, second.tasks[0].id);
  assert.equal(f.writes, 1);
});
test("stale snapshot and manual edits cannot silently overwrite newer tasks", () => {
  const f = fixture(),
    a = f.ctx.getTasks(),
    b = f.ctx.getTasks();
  f.ctx.saveTasks({ revision: a.revision, tasks: [fresh().tasks[0]] });
  assert.throws(
    () => f.ctx.saveTasks({ revision: b.revision, tasks: [] }),
    /CONFLICT/,
  );
});
test("invalid headers or incomplete task refuse writes without deleting data", () => {
  const f = fixture();
  f.data["Точка старта"][0][0] = "изменено";
  assert.throws(() => f.ctx.getTasks(), /SCHEMA_ERROR/);
  assert.equal(f.writes, 0);
});
test("setup preserves all tasks and only adds empty metadata headers", () => {
  const f = fixture();
  for (const name of names) f.data[name][0] = headers.slice(0, 9);
  f.data["Система ГТО"].push(["Моя задача"]);
  f.ctx.setupWorkspace();
  for (const name of names) assert.deepEqual(f.data[name][0], headers);
  assert.equal(f.data["Система ГТО"][1][0], "Моя задача");
  f.ctx.setupWorkspace();
});
test("unauthorized users and invalid tasks are refused", () => {
  const f = fixture(),
    snapshot = f.ctx.getTasks(),
    task = fresh().tasks[0];
  assert.throws(
    () => f.ctx.saveTasks({ revision: snapshot.revision, tasks: [task, task] }),
    /INVALID_TASK/,
  );
  f.setEmail("other@example.invalid");
  assert.throws(() => f.ctx.getTasks(), /ACCESS_DENIED/);
});
test("HTTP endpoint requires a valid session and password change revokes it", () => {
  const f = fixture(),
    send = (data) =>
      f.ctx.doPost({ postData: { contents: JSON.stringify(data) } });
  assert.equal(send({ action: "getTasks" }).code, "AUTH_REQUIRED");
  assert.equal(send({ action: "login", password: "bad" }).ok, false);
  const login = send({ action: "login", password: "synthetic-password" });
  assert.equal(login.ok, true);
  assert.equal(send({ action: "getTasks", session: login.session }).ok, true);
  f.props.TASK_PASSWORD = "changed-password";
  assert.equal(
    send({ action: "getTasks", session: login.session }).code,
    "AUTH_REQUIRED",
  );
});
test("setup refuses occupied metadata without changing any sheet", () => {
  const f = fixture();
  for (const n of names) f.data[n][0] = headers.slice(0, 9);
  f.data["SEO сайта"].push([
    "Сохранить",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Занято",
  ]);
  assert.throws(() => f.ctx.setupWorkspace(), /SCHEMA_ERROR/);
  for (const n of names) assert.equal(f.data[n][0].length, 9);
  assert.equal(f.data["SEO сайта"][1][9], "Занято");
});
test("invalid manual task cannot cause metadata writes to earlier sheets", () => {
  const f = fixture();
  f.data["Система ГТО"].push(["Не изменять"]);
  f.data["SEO сайта"].push(["", "нет названия"]);
  assert.throws(() => f.ctx.getTasks(), /SCHEMA_ERROR/);
  assert.equal(f.writes, 0);
  assert.equal(f.data["Система ГТО"][1].length, 1);
});
