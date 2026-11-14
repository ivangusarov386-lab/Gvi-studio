// Static-only fixture: mirrors Pages under a project prefix, with no Node API.
import http from "node:http";
import { readFile } from "node:fs/promises";
const files = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "lib/runtime.js",
  "lib/store.js",
  "lib/cloud-tasks.js",
  "lib/catalog.js",
  "lib/gto-demo.js",
  "lib/gto-stats.js",
  "assets/gvi-studio-logo.jpeg",
]);
const mime = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  jpeg: "image/jpeg",
};
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/google/") {
      const data = await readFile(
        new URL("../.local/apps-script/Index.html", import.meta.url),
      );
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
      return;
    }
    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const file = path.startsWith("/Gvi-studio/")
      ? path.slice("/Gvi-studio/".length) || "index.html"
      : "";
    if (!files.has(file)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const data = await readFile(new URL("../" + file, import.meta.url));
      res.writeHead(200, { "Content-Type": mime[file.split(".").pop()] });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Missing test fixture");
    }
  })
  .listen(3101, "127.0.0.1");
