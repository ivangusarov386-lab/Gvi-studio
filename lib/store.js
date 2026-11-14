import { projects, originalProjects, statuses, priorities } from "./catalog.js";
export const KEY = "gvi-studio-v1";
export const kinds = ["tasks", "materials", "versions", "issues", "videos"];
export const fields = {
  tasks: ["description", "status", "priority", "due", "materials", "stage"],
  materials: ["type", "text", "url", "comment", "fileName", "fileData"],
  versions: ["date", "description", "url", "materials", "checks"],
  issues: [
    "description",
    "steps",
    "expected",
    "actual",
    "severity",
    "status",
    "stage",
    "url",
  ],
  videos: [
    "topic",
    "format",
    "status",
    "script",
    "scenes",
    "storyboard",
    "prompts",
    "generations",
    "selected",
    "publicationDate",
    "url",
    "metricsPeriod",
    "views",
    "retention",
    "completion",
    "replays",
    "shares",
    "saves",
    "subscriptions",
    "metricDefinition",
  ],
};
export function fresh() {
  const state = {
    schemaVersion: 1,
    tasks: [],
    materials: [],
    versions: [],
    issues: [],
    videos: [],
    history: [],
  };
  const now = new Date().toISOString();
  for (const p of projects)
    for (const [title, description] of originalProjects[p.id].tasks)
      state.tasks.push({
        id: crypto.randomUUID(),
        project: p.id,
        title,
        description,
        status: "запланировано",
        priority: "средний",
        due: "",
        materials: "",
        stage: "Тестовый этап",
        createdAt: now,
        updatedAt: now,
        sample: true,
      });
  return state;
}
export function safeURL(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
export function validate(input) {
  if (!input || input.schemaVersion !== 1)
    throw new Error("Неизвестный формат резервной копии.");
  const out = { schemaVersion: 1 };
  const ids = new Set();
  for (const kind of kinds) {
    if (!Array.isArray(input[kind]) || input[kind].length > 2000)
      throw new Error("Некорректная коллекция: " + kind);
    out[kind] = input[kind].map((r) => {
      if (
        !r ||
        typeof r.id !== "string" ||
        !r.id ||
        r.id.length > 100 ||
        ids.has(r.id) ||
        !projects.some((p) => p.id === r.project) ||
        typeof r.title !== "string" ||
        !r.title.trim() ||
        r.title.length > 250
      )
        throw new Error("Некорректная карточка.");
      ids.add(r.id);
      const v = {
        id: r.id,
        project: r.project,
        title: r.title,
        sample: r.sample === true,
      };
      for (const key of ["createdAt", "updatedAt"]) {
        if (typeof r[key] !== "string" || isNaN(Date.parse(r[key])))
          throw new Error("Некорректная дата карточки.");
        v[key] = r[key];
      }
      for (const key of fields[kind]) {
        const val = r[key] ?? "";
        if (
          typeof val !== "string" ||
          val.length > (key === "fileData" ? 2800000 : 50000)
        )
          throw new Error("Некорректное поле: " + key);
        v[key] = val;
      }
      if (v.url && !safeURL(v.url))
        throw new Error("Допустимы только HTTP/HTTPS-ссылки.");
      if (
        v.fileData &&
        !/^data:application\/octet-stream;base64,[A-Za-z0-9+/]*={0,2}$/.test(
          v.fileData,
        )
      )
        throw new Error("Некорректное вложение.");
      if (
        kind === "tasks" &&
        (!statuses.includes(v.status) || !priorities.includes(v.priority))
      )
        throw new Error("Некорректный статус или приоритет.");
      for (const key of ["due", "date", "publicationDate"])
        if (
          v[key] &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(v[key]) ||
            isNaN(Date.parse(v[key])) ||
            new Date(v[key]).toISOString().slice(0, 10) !== v[key])
        )
          throw new Error("Некорректная календарная дата.");
      if (kind === "videos") {
        for (const key of [
          "views",
          "retention",
          "completion",
          "replays",
          "shares",
          "saves",
          "subscriptions",
        ])
          if (
            v[key] &&
            (!Number.isFinite(Number(v[key])) ||
              Number(v[key]) < 0 ||
              (["retention", "completion"].includes(key)
                ? Number(v[key]) > 100
                : !Number.isInteger(Number(v[key]))))
          )
            throw new Error("Некорректная метрика.");
        if (
          (v.retention || v.completion) &&
          (!v.metricsPeriod.trim() || !v.metricDefinition.trim())
        )
          throw new Error("Укажите период и определение процентов.");
      }
      return v;
    });
  }
  if (!Array.isArray(input.history) || input.history.length > 300)
    throw new Error("Некорректная история.");
  out.history = input.history.map((h) => {
    if (
      !h ||
      typeof h.text !== "string" ||
      h.text.length > 1000 ||
      typeof h.at !== "string" ||
      isNaN(Date.parse(h.at)) ||
      !projects.some((p) => p.id === h.project)
    )
      throw new Error("Некорректное событие.");
    return { text: h.text, at: h.at, project: h.project };
  });
  return out;
}
export function load() {
  const raw = localStorage.getItem(KEY);
  return raw ? validate(JSON.parse(raw)) : fresh();
}
export function persist(next) {
  const clean = validate(next);
  localStorage.setItem(KEY, JSON.stringify(clean));
  return clean;
}
