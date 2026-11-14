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
function fixture() {
  const headers = [
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
  let rows = [headers],
    email = "owner@example.invalid",
    locked = false,
    writes = 0,
    lastRequest = null;
  const sheet = { getLastRow: () => rows.length, getSheetId: () => 0, getMaxRows:()=>1000 };
  const book = {
    getId: () => "synthetic-workspace",
    getUrl: () =>
      "https://docs.google.com/spreadsheets/d/synthetic-workspace/edit",
    getSheetByName: () => sheet,
  };
  const ctx = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) =>
          k === "OWNER_EMAIL" ? "owner@example.invalid" : "synthetic-workspace",
      }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(locked, false);
          locked = true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    SpreadsheetApp: { openById: () => book },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, text) => [
        ...createHash("sha256").update(text).digest(),
      ],
    },
    Sheets: {
      Spreadsheets: {
        Values: { get: () => ({ values: rows }) },
        batchUpdate: (request) => {
          assert.equal(locked, true);
          writes++;
          lastRequest = request;
          rows = request.requests
            .find((r) => r.updateCells)
            .updateCells.rows.map((r) =>
              r.values.map(
                (c) =>
                  c.userEnteredValue.stringValue ??
                  c.userEnteredValue.boolValue,
              ),
            );
        },
      },
    },
  });
  vm.runInContext(code, ctx);
  return {
    ctx,
    get writes() {
      return writes;
    },
    get request() {
      return lastRequest;
    },
    setEmail: (v) => (email = v),
    edit: (r) => (rows = r),
  };
}
test("cloud saves/read roundtrip, deletion and exact field values without formulas", () => {
  const f = fixture(),
    initial = f.ctx.getTasks();
  assert.equal(initial.tasks.length, 0);
  const task = fresh().tasks[0];
  task.title = '=IMPORTXML("https://example.invalid","//x")';
  const saved = f.ctx.saveTasks({ revision: initial.revision, tasks: [task] });
  assert.equal(saved.tasks[0].title, task.title);
  assert.equal(f.writes, 1);
  assert.equal(
    f.request.requests[0].updateCells.rows[1].values[2].userEnteredValue
      .stringValue,
    task.title,
  );
  assert.ok(!JSON.stringify(f.request).includes("formulaValue"));
  const empty = f.ctx.saveTasks({ revision: saved.revision, tasks: [] });
  assert.equal(empty.tasks.length, 0);
  assert.equal(f.request.requests[0].updateCells.range.endRowIndex, 2);
});
test("a second device with an old snapshot cannot overwrite changes", () => {
  const f = fixture(),
    a = f.ctx.getTasks(),
    b = f.ctx.getTasks();
  f.ctx.saveTasks({ revision: a.revision, tasks: [fresh().tasks[0]] });
  assert.throws(
    () => f.ctx.saveTasks({ revision: b.revision, tasks: [] }),
    /CONFLICT/,
  );
  assert.equal(f.writes, 1);
});
test("wrong or unidentified Google user cannot read or write tasks", () => {
  const f = fixture();
  for (const email of ["other@example.invalid", ""]) {
    f.setEmail(email);
    assert.throws(() => f.ctx.getTasks(), /ACCESS_DENIED/);
    assert.throws(() => f.ctx.saveTasks({ tasks: [] }), /ACCESS_DENIED/);
  }
  assert.equal(f.writes, 0);
});
test("bad schema, duplicate IDs and invalid task dates fail before write", () => {
  const f = fixture(),
    snapshot = f.ctx.getTasks(),
    task = fresh().tasks[0];
  assert.throws(
    () => f.ctx.saveTasks({ revision: snapshot.revision, tasks: [task, task] }),
    /INVALID_TASK/,
  );
  assert.throws(
    () =>
      f.ctx.saveTasks({
        revision: snapshot.revision,
        tasks: [{ ...task, due: "2026-02-30" }],
      }),
    /INVALID_DATE/,
  );
  f.edit([["renamed"]]);
  assert.throws(() => f.ctx.getTasks(), /SCHEMA_ERROR/);
  assert.equal(f.writes, 0);
});

test("workspace setup is idempotent and creates a private empty table once", () => {
  const f = fixture(),
    props = {};
  let created = 0,
    rows = [];
  const range = {
    setValues: (value) => {
      rows = value;
      return range;
    },
    getValues: () => rows,
    setFontWeight: () => range,
    setBackground: () => range,
    setNote: () => range,
  };
  const sheet = {
    getLastRow: () => rows.length,
    getRange: () => range,
    setName: () => {},
    setFrozenRows: () => {},
    setColumnWidth: () => {},
  };
  const book = {
    getId: () => "synthetic-new",
    getUrl: () => "https://docs.google.com/spreadsheets/d/synthetic-new/edit",
    getSheetByName: () => sheet,
    getSheets: () => [sheet],
  };
  f.ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props[k] || null,
      setProperty: (k, v) => (props[k] = v),
    }),
  };
  f.ctx.Session.getEffectiveUser = () => ({
    getEmail: () => "owner@example.invalid",
  });
  f.ctx.SpreadsheetApp = {
    create: () => {
      created++;
      return book;
    },
    openById: () => book,
    flush: () => {},
  };
  assert.equal(f.ctx.setupWorkspace().created, true);
  assert.equal(f.ctx.setupWorkspace().created, false);
  assert.equal(created, 1);
  assert.equal(rows.length, 1);
  assert.equal(props.OWNER_EMAIL, "owner@example.invalid");
});
test("larger workspaces extend grid in the same atomic batch", () => {
  const f = fixture(),
    base = fresh().tasks[0],
    tasks = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: "task-" + i,
    }));
  const snapshot = f.ctx.getTasks();
  const saved = f.ctx.saveTasks({ revision: snapshot.revision, tasks });
  assert.equal(saved.tasks.length, 1000);
  assert.equal(f.request.requests[0].appendDimension.length, 1);
  assert.equal(f.request.requests[1].updateCells.rows.length, 1001);
});

test('HTTP endpoint requires a valid session and password change revokes it',()=>{
 const f=fixture(),props={OWNER_EMAIL:'owner@example.invalid',WORKSPACE_SPREADSHEET_ID:'synthetic-workspace',TASK_PASSWORD:'synthetic-password',TASK_SIGNING_KEY:'synthetic-key'};
 f.ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null})};
 const cache=new Map();f.ctx.CacheService={getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})};
 f.ctx.Utilities.base64EncodeWebSafe=x=>Buffer.from(x).toString('base64url');
 f.ctx.Utilities.base64DecodeWebSafe=x=>Buffer.from(x,'base64url');
 f.ctx.Utilities.newBlob=x=>({getDataAsString:()=>Buffer.from(x).toString()});
 f.ctx.Utilities.computeHmacSha256Signature=(body,key)=>createHmac('sha256',key).update(body).digest();
 f.ctx.Utilities.getUuid=()=> 'synthetic-nonce';
 f.ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
 const send=data=>f.ctx.doPost({postData:{contents:JSON.stringify(data)}});
 assert.equal(send({action:'getTasks'}).code,'AUTH_REQUIRED');assert.equal(send({action:'login',password:'bad'}).ok,false);
 const login=send({action:'login',password:'synthetic-password'});assert.equal(login.ok,true);
 assert.equal(send({action:'getTasks',session:login.session}).ok,true);
 props.TASK_PASSWORD='changed-password';assert.equal(send({action:'getTasks',session:login.session}).code,'AUTH_REQUIRED');
});
