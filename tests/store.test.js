import test from "node:test";
import assert from "node:assert/strict";
import { fresh, validate, safeURL } from "../lib/store.js";
test("initial tasks and JSON backups roundtrip without losing fields", () => {
  const s = fresh();
  assert.equal(s.tasks.length, 12);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(s))), s);
});
test("malformed imports and unsafe links are rejected", () => {
  assert.throws(() => validate({}));
  const s = fresh();
  s.tasks[1].id = s.tasks[0].id;
  assert.throws(() => validate(s));
  assert.equal(safeURL("javascript:alert(1)"), "");
  assert.equal(safeURL("data:text/html,hi"), "");
  assert.equal(safeURL("https://example.com/"), "https://example.com/");
});

test('invalid calendar values in an otherwise valid backup are rejected',()=>{
 const state=fresh();state.tasks[0].due='2026-02-30';assert.throws(()=>validate(state));
});
