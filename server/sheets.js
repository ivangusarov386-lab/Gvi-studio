import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
export const READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";
export function mapRows(values, spec, kind) {
  if (!Array.isArray(values) || !values.length) throw new Error("SCHEMA");
  const headers = values[0];
  const required =
    kind === "registrations"
      ? ["id", "participant", "registeredAt", "eventDate"]
      : ["id", "participant", "resultAt", "status", "level"];
  for (const key of required)
    if (!spec.columns?.[key]) throw new Error("SCHEMA");
  for (const header of Object.values(spec.columns))
    if (headers.filter((v) => v === header).length !== 1)
      throw new Error("SCHEMA");
  return values
    .slice(1)
    .filter((row) => row.some((v) => String(v).trim()))
    .map((row) => {
      const out = Object.fromEntries(
        Object.entries(spec.columns).map(([k, h]) => [
          k,
          String(row[headers.indexOf(h)] ?? "").trim(),
        ]),
      );
      if (kind === "results") {
        out.status =
          out.status && Object.hasOwn(spec.statusMap || {}, out.status)
            ? spec.statusMap[out.status]
            : "unknown";
        out.level =
          out.level && Object.hasOwn(spec.levelMap || {}, out.level)
            ? spec.levelMap[out.level]
            : "unknown";
      }
      return out;
    });
}
export async function readSheets({ configPath, getClient } = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (
    config.rulesVersion !== 1 ||
    config.repeatRule !== "latest-in-period" ||
    !config.timeZone ||
    !config.levelMeaning
  )
    throw new Error("CONFIG");
  new Intl.DateTimeFormat("en", { timeZone: config.timeZone });
  if (
    config.allowedCategories &&
    (!Array.isArray(config.allowedCategories) ||
      config.allowedCategories.some(
        (v) => typeof v !== "string" || v.length > 100,
      ))
  )
    throw new Error("CONFIG");
  const client = await (getClient
    ? getClient()
    : new GoogleAuth({ scopes: [READONLY_SCOPE] }).getClient());
  const result = {
    timeZone: config.timeZone,
    levelMeaning: config.levelMeaning,
  };
  for (const kind of ["registrations", "results"]) {
    const spec = config[kind];
    if (
      !/^[\w-]+$/.test(spec?.spreadsheetId || "") ||
      !spec.range ||
      !spec.range.includes("!") ||
      !/[A-Z]+\d+:[A-Z]+\d+$/.test(spec.range)
    )
      throw new Error("CONFIG");
    const response = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spec.spreadsheetId)}/values/${encodeURIComponent(spec.range)}`,
      method: "GET",
      params: { valueRenderOption: "FORMATTED_VALUE" },
      timeout: 10000,
      retry: false,
    });
    const rows = response.data.values || [];
    // A full bounded range may have truncated the sheet: fail rather than silently undercount.
    const match = spec.range.match(/[A-Z]+(\d+):[A-Z]+(\d+)$/);
    if (rows.length >= Number(match[2]) - Number(match[1]) + 1)
      throw new Error("RANGE_FULL");
    result[kind] = mapRows(rows, spec, kind);
    // Only explicitly approved non-personal labels can leave the server.
    const allowed = new Set(config.allowedCategories || []);
    for (const row of result[kind])
      if (row.category)
        row.category = allowed.has(row.category)
          ? row.category
          : "Другая категория";
  }
  if (
    config.protocolSpreadsheetId &&
    /^[\w-]+$/.test(config.protocolSpreadsheetId)
  )
    result.protocolUrl = `https://docs.google.com/spreadsheets/d/${config.protocolSpreadsheetId}/edit`;
  return result;
}
