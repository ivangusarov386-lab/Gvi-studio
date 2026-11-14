import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
const output = ".local/apps-script";
await mkdir(output, { recursive: true });
const bundled = await build({
  entryPoints: ["app.js"],
  bundle: true,
  write: false,
  format: "iife",
  target: ["safari15.4"],
  define: { __GVI_APPS_SCRIPT__: "true" },
});
const css = await readFile("styles.css", "utf8");
const logo = (await readFile("assets/gvi-studio-logo.jpeg")).toString("base64");
let html = await readFile("index.html", "utf8");
html = html
  .replace(
    '<link rel="stylesheet" href="./styles.css" />',
    "<style>" + css.replace(/<\/style/gi, "<\\/style") + "</style>",
  )
  .replace('<script type="module" src="./app.js"></script>', "")
  .replace("./assets/gvi-studio-logo.jpeg", "data:image/jpeg;base64," + logo)
  .replace(
    "</body>",
    "<script>" +
      bundled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script") +
      "</script></body>",
  );
await writeFile("apps-script/Index.html", html);
await writeFile(output + "/Index.html", html);
await copyFile("apps-script/Code.gs", output + "/Code.gs");
await copyFile("apps-script/appsscript.json", output + "/appsscript.json");
console.log(
  "Apps Script files updated in apps-script/ and " +
    output +
    " (no credentials, no external frontend requests).",
);
