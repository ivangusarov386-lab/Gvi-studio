import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { aggregate } from "./stats.js";
import { demoSource } from "./demo.js";
import { readSheets } from "./sheets.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/lib/store.js", "lib/store.js"],
  ["/lib/catalog.js", "lib/catalog.js"],
  ["/assets/gvi-studio-logo.jpeg", "assets/gvi-studio-logo.jpeg"],
]);
const mime = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  jpeg: "image/jpeg",
};
export function createServer({
  mode = process.env.GTO_MODE || "demo",
  loadSource,
  authUser = process.env.GVI_AUTH_USER,
  authHash = process.env.GVI_AUTH_PASSWORD_HASH,
  confirmed = process.env.GTO_RULES_CONFIRMED === "true",
} = {}) {
  const live = mode === "sheets";
  if (!["demo", "sheets"].includes(mode))
    throw new Error("Unsupported GTO_MODE");
  if (live && (!authUser || !/^.{16,}:[0-9a-f]{128}$/.test(authHash || "")))
    throw new Error("Live mode requires user and scrypt password hash");
  let snapshot = null,
    lastSuccess = null,
    pending = null,
    lastRead = 0,
    lastFailure = false;
  const authorized = (req) => {
    if (!live) return true;
    const value = Buffer.from(
      (req.headers.authorization || "").replace(/^Basic /, ""),
      "base64",
    ).toString();
    const split = value.indexOf(":");
    if (split < 0 || value.length > 1024) return false;
    const [salt, hash] = authHash.split(":");
    return (
      value.slice(0, split) === authUser &&
      timingSafeEqual(
        scryptSync(value.slice(split + 1), salt, 64),
        Buffer.from(hash, "hex"),
      )
    );
  };
  return http.createServer(async (req, res) => {
    const send = (code, data, type = "application/json; charset=utf-8") => {
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      });
      res.end(
        type.startsWith("application/json") ? JSON.stringify(data) : data,
      );
    };
    if (!authorized(req)) {
      res.setHeader(
        "WWW-Authenticate",
        'Basic realm="GVI Studio", charset="UTF-8"',
      );
      return send(401, { error: "Требуется вход" });
    }
    if (req.method !== "GET")
      return send(405, { error: "Доступно только чтение" });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/gto") {
      const filters = Object.fromEntries(
        ["from", "to", "eventDate", "category"].map((k) => [
          k,
          url.searchParams.get(k) || "",
        ]),
      );
      try {
        aggregate({ registrations: [], results: [], timeZone: "UTC" }, filters);
      } catch {
        return send(400, { error: "Проверьте границы периода и даты." });
      }
      if (live && !confirmed)
        return send(503, {
          mode,
          error: "Правила расчёта и схема источников ещё не подтверждены.",
          stale: false,
          lastSuccess: null,
        });
      try {
        if (!lastRead || Date.now() - lastRead > 30000) {
          if (!pending)
            pending = (async () => {
              lastRead = Date.now();
              try {
                const source = await (loadSource
                  ? loadSource()
                  : live
                    ? readSheets({ configPath: process.env.GTO_CONFIG_PATH })
                    : structuredClone(demoSource));
                aggregate(source, {});
                snapshot = source;
                lastSuccess = new Date().toISOString();
                lastFailure = false;
              } catch {
                lastFailure = true;
                throw new Error("SOURCE");
              } finally {
                pending = null;
              }
            })();
        }
        if (pending) await pending;
        if (lastFailure || !snapshot) throw new Error("SOURCE");
        const stats = aggregate(snapshot, filters);
        if (snapshot.protocolUrl) stats.protocol.url = snapshot.protocolUrl;
        return send(200, { mode, stale: false, lastSuccess, stats });
      } catch {
        let stats = null;
        if (snapshot) stats = aggregate(snapshot, filters);
        return send(503, {
          mode,
          stale: !!snapshot,
          lastSuccess,
          stats,
          error:
            "Источник недоступен или его структура не соответствует настройкам. Демо вместо реальных данных не подставлено.",
        });
      }
    }
    const file = publicFiles.get(url.pathname);
    if (!file) return send(404, { error: "Не найдено" });
    try {
      return send(
        200,
        await readFile(resolve(root, file)),
        mime[file.split(".").pop()],
      );
    } catch {
      return send(500, { error: "Не удалось загрузить файл" });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  if (process.env.GTO_MODE === "sheets" && host !== "127.0.0.1")
    throw new Error("Live server must bind to loopback behind HTTPS proxy");
  createServer().listen(Number(process.env.PORT) || 3000, host, () =>
    console.log("GVI Studio server started"),
  );
}
