import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync } from "node:crypto";
import { createServer } from "../server/index.js";
import { mapRows, readSheets, READONLY_SCOPE } from "../server/sheets.js";
import { demoSource } from "../server/demo.js";
async function withServer(options, fn) {
  const s = createServer(options);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${s.address().port}`);
  } finally {
    await new Promise((r) => s.close(r));
  }
}
test("public API only emits aggregates; static routes cannot expose environment or server code", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(base + "/api/gto");
    const text = await response.text();
    const data = JSON.parse(text);
    assert.equal(data.mode, "demo");
    assert.equal(data.stats.registrations.total, 5);
    assert.ok(!text.includes("demo-a"));
    assert.ok(!text.includes("registeredAt"));
    for (const path of [
      "/.env",
      "/server/demo.js",
      "/server/sheets.js",
      "/package.json",
      "/docs/source.example.json",
    ])
      assert.equal((await fetch(base + path)).status, 404);
    assert.equal(
      (await fetch(base + "/api/gto", { method: "POST" })).status,
      405,
    );
    assert.equal((await fetch(base + "/api/gto?from=bad")).status, 400);
    assert.match(
      (await fetch(base + "/")).headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  });
});
test("source failure does not fall back to demo", async () => {
  await withServer(
    {
      loadSource: async () => {
        throw new Error("private content");
      },
    },
    async (base) => {
      const r = await fetch(base + "/api/gto");
      assert.equal(r.status, 503);
      const text = await r.text();
      assert.ok(!text.includes("private content"));
      assert.equal(JSON.parse(text).stats, null);
    },
  );
});
test("stale cached data stays identified after a later failure", async () => {
  let calls = 0;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await withServer(
      {
        loadSource: async () => {
          if (calls++) throw new Error("offline");
          return structuredClone(demoSource);
        },
      },
      async (base) => {
        const a = await (await fetch(base + "/api/gto")).json();
        now += 31000;
        const b = await (await fetch(base + "/api/gto")).json();
        assert.equal(b.stale, true);
        assert.equal(b.lastSuccess, a.lastSuccess);
        assert.equal(b.stats.registrations.total, 5);
      },
    );
  } finally {
    Date.now = originalNow;
  }
});
test("live mode requires auth and confirmed rules, credentials never sent in response", async () => {
  assert.throws(() => createServer({ mode: "sheets" }));
  const salt = "synthetic-test-salt",
    password = "synthetic-test-password",
    hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  await withServer(
    { mode: "sheets", authUser: "test", authHash: hash, confirmed: false },
    async (base) => {
      assert.equal((await fetch(base + "/")).status, 401);
      assert.equal((await fetch(base + "/api/gto")).status, 401);
      const r = await fetch(base + "/api/gto", {
        headers: {
          Authorization:
            "Basic " + Buffer.from("test:" + password).toString("base64"),
        },
      });
      assert.equal(r.status, 503);
      assert.match((await r.json()).error, /не подтверждены/);
    },
  );
});
test("mapping requires explicit unique headers and leaves unknown status unknown", () => {
  const spec = {
    columns: {
      id: "ID",
      participant: "Participant",
      resultAt: "Time",
      status: "Status",
      level: "Level",
    },
    statusMap: { yes: "passed" },
    levelMap: { G: "gold" },
  };
  assert.equal(
    mapRows(
      [
        ["ID", "Participant", "Time", "Status", "Level"],
        ["a", "b", "now", "unrecognized", ""],
      ],
      spec,
      "results",
    )[0].status,
    "unknown",
  );
  assert.throws(() => mapRows([["ID"]], spec, "results"));
  assert.throws(() =>
    mapRows(
      [["ID", "ID", "Participant", "Time", "Status", "Level"]],
      spec,
      "results",
    ),
  );
  assert.equal(
    READONLY_SCOPE,
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  );
});
test("adapter makes only GET values requests against separate configured synthetic sheets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gvi-"));
  try {
    const config = {
      rulesVersion: 1,
      repeatRule: "latest-in-period",
      timeZone: "Europe/Moscow",
      levelMeaning: "Synthetic",
      registrations: {
        spreadsheetId: "synthetic-reg",
        range: "'Registration'!A1:E100",
        columns: {
          id: "ID",
          participant: "P",
          registeredAt: "Created",
          eventDate: "Event",
        },
      },
      results: {
        spreadsheetId: "synthetic-result",
        range: "'Results'!A1:E100",
        columns: {
          id: "ID",
          participant: "P",
          resultAt: "Time",
          status: "S",
          level: "L",
        },
        statusMap: { yes: "passed" },
        levelMap: { gold: "gold" },
      },
    };
    const path = join(dir, "source.json");
    await writeFile(path, JSON.stringify(config));
    const requests = [];
    const source = await readSheets({
      configPath: path,
      getClient: async () => ({
        request: async (req) => {
          requests.push(req);
          return {
            data: {
              values:
                requests.length === 1
                  ? [
                      ["ID", "P", "Created", "Event"],
                      ["r", "p", "2026-11-01T12:00:00Z", "2026-11-20"],
                    ]
                  : [
                      ["ID", "P", "Time", "S", "L"],
                      ["a", "p", "2026-11-12T12:00:00Z", "yes", "gold"],
                    ],
            },
          };
        },
      }),
    });
    assert.equal(source.results[0].status, "passed");
    assert.equal(requests.length, 2);
    assert.ok(
      requests.every(
        (r) =>
          r.method === "GET" &&
          r.url.startsWith("https://sheets.googleapis.com/"),
      ),
    );
    assert.ok(requests.every((r) => !r.url.includes("A2")));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('empty mapped statuses remain unknown, even if a mapping attempts to classify blanks', () => {
  const spec={columns:{id:'ID',participant:'P',resultAt:'Time',status:'S',level:'L'},statusMap:{'':'passed'},levelMap:{'':'gold'}};
  const [row]=mapRows([['ID','P','Time','S','L'],['a','p','2026-11-01T10:00:00Z','','']],spec,'results');
  assert.equal(row.status,'unknown'); assert.equal(row.level,'unknown');
});
test('failed initial source reads are throttled without cached demo substitution', async () => {
  let calls=0;
  await withServer({loadSource:async()=>{calls++;throw new Error('offline');}},async base=>{
    for(let i=0;i<3;i++)assert.equal((await fetch(base+'/api/gto')).status,503);
    assert.equal(calls,1);
  });
});
