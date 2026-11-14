import { CLOUD_TASKS, cloudCall } from "./lib/cloud-tasks.js";
import { SOURCE_MODE } from "./lib/runtime.js";
import {
  projects,
  originalProjects,
  statuses,
  priorities,
} from "./lib/catalog.js";
import {
  KEY,
  kinds,
  fields,
  load,
  persist,
  safeURL,
  validate,
} from "./lib/store.js";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const projectName = (id) => projects.find((p) => p.id === id)?.name || id;
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("ru", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Moscow",
      }).format(new Date(v))
    : "Ещё не было";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const names = {
  tasks: "Задачи",
  materials: "Материалы",
  versions: "Версии и сравнение",
  issues: "Ошибки",
  videos: "Ролики",
};
const tabs = {
  summary: "Обзор",
  tasks: "Задачи",
  materials: "Материалы",
  versions: "Версии и сравнение",
  issues: "Ошибки",
  next: "Следующие действия",
};
const gtoTabs = {
  registrations: "Регистрации",
  results: "Результаты",
  protocol: "Протокол",
  connection: "Подключение",
};
const cloud = {
  ready: false,
  busy: false,
  revision: "",
  syncedAt: "",
  spreadsheetUrl: "",
  error: "",
};
let state,
  storageError = "",
  editing = null,
  section = "overview",
  project = "gto",
  tab = "summary",
  filterProject = "",
  taskStatus = "",
  taskPriority = "";
let gto = null,
  gtoLoading = false,
  gtoError = "",
  requestId = 0;
const gtoFilters = { from: "", to: "", eventDate: "", category: "" };
try {
  state = load();
  if (CLOUD_TASKS) state.tasks = [];
  else state = persist(state);
} catch {
  storageError =
    "Локальное хранилище недоступно или повреждено. Существующие данные не перезаписаны. Экспортируйте исходную копию в настройках.";
  state = {
    schemaVersion: 1,
    ...Object.fromEntries(kinds.map((k) => [k, []])),
    history: [],
  };
}
const option = (v, label, selected) =>
  `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(label)}</option>`;
const select = (name, label, values, current, blank = "") =>
  `<label>${esc(label)}<select name="${name}">${blank ? option("", blank, current) : ""}${values.map((v) => option(typeof v === "string" ? v : v.id, typeof v === "string" ? v : v.name, current)).join("")}</select></label>`;
const button = (text, action, extra = "", primary = false) =>
  `<button type="button" data-action="${action}" ${extra} class="${primary ? "primary" : ""}">${esc(text)}</button>`;
const link = (url, label) =>
  safeURL(url)
    ? `<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : "";
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
function toast(text) {
  $("#notification").textContent = text;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#notification").textContent = ""), 5000);
}
function cloudSnapshot(value) {
  const checked = validate({ ...state, tasks: value.tasks });
  if (typeof value.revision !== "string" || !value.revision)
    throw new Error("Некорректный ответ облака.");
  state = { ...state, tasks: checked.tasks };
  Object.assign(cloud, {
    ready: true,
    revision: value.revision,
    syncedAt: value.syncedAt,
    spreadsheetUrl: value.spreadsheetUrl,
    error: "",
  });
}
async function syncTasks() {
  if (!CLOUD_TASKS || cloud.busy) return;
  cloud.busy = true;
  render();
  try {
    cloudSnapshot(await cloudCall("getTasks"));
  } catch (err) {
    cloud.error = err.message;
  } finally {
    cloud.busy = false;
    render();
  }
}
async function save(next, text, p = project) {
  const taskChanged =
    JSON.stringify(next.tasks) !== JSON.stringify(state.tasks);
  if (CLOUD_TASKS && taskChanged) {
    if (!cloud.ready || cloud.busy)
      throw new Error("Дождитесь загрузки облака и повторите сохранение.");
    cloud.busy = true;
    try {
      const result = await cloudCall("saveTasks", {
        revision: cloud.revision,
        tasks: next.tasks,
      });
      cloudSnapshot(result);
      next.tasks = state.tasks;
    } catch (err) {
      cloud.error = err.message;
      throw err;
    } finally {
      cloud.busy = false;
    }
  } else if (storageError) throw new Error(storageError);
  next.history.unshift({ text, project: p, at: new Date().toISOString() });
  next.history = next.history.slice(0, 300);
  try {
    if (CLOUD_TASKS) {
      persist({ ...next, tasks: [] });
      state = next;
    } else state = persist(next);
  } catch {
    if (CLOUD_TASKS && taskChanged) {
      state = next;
      storageError =
        "Задачи сохранены в Google Sheets. Локальное хранилище материалов недоступно.";
    } else
      throw new Error(
        "Не удалось сохранить. Возможно, хранилище заполнено. Экспортируйте копию и уменьшите вложения.",
      );
  }
}
function cloudStatus() {
  if (!CLOUD_TASKS) return "";
  return `<div class="notice"><strong>${cloud.busy ? "Связь с Google…" : cloud.ready ? "Задачи · Google Sheets" : "Облачные задачи ещё не загружены"}</strong><p>Последнее подтверждение: ${date(cloud.syncedAt)} (Москва). Материалы, версии, ошибки, ролики и история пока локальные.</p><div class="actions">${button("Обновить облако", "cloud-refresh", cloud.busy ? "disabled" : "")}${link(cloud.spreadsheetUrl, "Открыть таблицу задач")}</div>${cloud.error ? `<p class="error" role="alert">${esc(cloud.error)} ${cloud.ready ? "Показаны ранее полученные задачи." : ""}</p>` : ""}</div>`;
}

function route() {
  const [s, p, t] = location.hash.slice(1).split("/");
  section = [
    "overview",
    "projects",
    "materials",
    "history",
    "settings",
  ].includes(s)
    ? s
    : "overview";
  if (projects.some((x) => x.id === p)) project = p;
  tab = [...Object.keys(tabs), ...Object.keys(gtoTabs), "videos"].includes(t)
    ? t
    : "summary";
  render();
}
function render() {
  if (CLOUD_TASKS) {
    $(".os-foot span:last-child").textContent =
      "Задачи в Google Sheets · остальные разделы локально";
    $(".os-private").textContent = "Личное облако · задачи в Google Sheets";
    $("#storage-notice").textContent =
      "Задачи общие для компьютера и iPhone после входа в ваш Google-аккаунт. Остальные разделы пока сохраняются в браузере.";
  }
  $("#navigation").innerHTML = Object.entries({
    overview: "Обзор",
    projects: "Проекты",
    materials: "Материалы",
    history: "История",
    settings: "Настройки",
  })
    .map(
      ([id, label]) =>
        `<a href="#${id}${id === "projects" ? "/" + project + "/" + tab : ""}" ${section === id ? 'aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  $("#projects").innerHTML = projects
    .map(
      (p, i) =>
        `<button class="os-project" data-action="project" data-id="${p.id}" aria-pressed="${section === "projects" && project === p.id}"><span class="os-icon"><span class="project-number">0${i + 1}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span><strong>${p.name}</strong><small>${p.sub}</small></button>`,
    )
    .join("");
  let html =
    cloudStatus() +
    (storageError
      ? `<p class="error" role="alert">${esc(storageError)}</p>`
      : "");
  if (section === "overview") html += overview();
  if (section === "projects") {
    const available = {
      ...tabs,
      ...(project === "gto" ? gtoTabs : {}),
      ...(project === "start" ? { videos: "Ролики" } : {}),
    };
    if (!available[tab]) tab = "summary";
    html += `<div class="os-workhead"><h2>${projectName(project)}</h2><span class="eyebrow">Рабочее пространство</span></div><div class="os-tabs" aria-label="Разделы проекта">${Object.entries(
      available,
    )
      .map(
        ([id, label]) =>
          `<button class="os-tab" data-action="tab" data-id="${id}" aria-pressed="${tab === id}">${label}</button>`,
      )
      .join("")}</div>`;
    if (tab === "summary")
      html += project === "gto" ? gtoView("summary") : projectSummary();
    else if (kinds.includes(tab)) html += collection(tab, project);
    else if (tab === "next")
      html += `<h3>Ближайшие задачи</h3>${taskRows(nextTasks(project))}`;
    else html += gtoView(tab);
  }
  if (section === "materials")
    html += `<h2>Библиотека материалов</h2>${projectFilter()}${collection("materials", filterProject)}`;
  if (section === "history")
    html += `<h2>История изменений</h2>${projectFilter()}${history()}`;
  if (section === "settings") html += settings();
  $("#workspace").innerHTML = html;
  renderNext();
}
function projectFilter() {
  return `<div class="filters">${select("projectFilter", "Проект", projects, filterProject, "Все проекты")}</div>`;
}
function nextTasks(p = "") {
  return state.tasks
    .filter((t) => (!p || t.project === p) && t.status !== "выполнено")
    .sort(
      (a, b) =>
        priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
        (a.due || "9999").localeCompare(b.due || "9999"),
    );
}
function overview() {
  const tasks = nextTasks(filterProject),
    urgent = tasks.filter(
      (t) => t.priority === "высокий" || (t.due && t.due < today()),
    );
  return `<h2>Обзор студии</h2>${projectFilter()}<div class="stats"><div class="stat accent"><strong>${tasks.length}</strong><span>Открытых задач</span></div><div class="stat"><strong>${urgent.length}</strong><span>Высокий приоритет / просрочено</span></div><div class="stat"><strong>${state.materials.filter((m) => !filterProject || m.project === filterProject).length}</strong><span>Материалов</span></div></div>
 <h3>Требуют внимания</h3>${taskRows(urgent.slice(0, 5))}<h3>Ближайшие действия</h3>${taskRows(tasks.slice(0, 4))}${!filterProject || filterProject === "gto" ? `<h3>ГТО / кратко</h3>${gtoStatus()}<p class="muted">Учитываются текущие фильтры раздела ГТО.</p>${gto?.stats ? statsCards(gto.stats, true) : empty(gtoLoading ? "Загрузка статистики…" : "Статистика пока не получена.")}` : ""}<h3>Последние изменения</h3>${history(5)}`;
}
function projectSummary() {
  const d = originalProjects[project];
  const notes = {
    mesh: "Manifest V3 → TDD → несколько и скрытые оценки → подсветка → Free / PRO → Chromium → GitHub Actions → security-review. Реальные аккаунты и данные учеников не подключены.",
    seo: "Технический аудит → Wordstat → кластеризация → коммерческий кластер → карта SEO-страниц. Ветка Demo1 и существующая SEO-версия требуют отдельной проверки в репозитории сайта. Здесь они не изменяются.",
    start:
      "Идея → исследование → сценарий → сцены → раскадровка → видеопромты Veo 3 → публикация → аналитика. Метрики вводятся вручную; подключения к TikTok нет.",
  };
  return `<p class="notice">${notes[project]}</p><h3>${esc(d.focus)}</h3><p>${esc(d.extra)}</p><h3>Задачи проекта</h3>${taskRows(nextTasks(project))}`;
}
function renderNext() {
  const t = nextTasks(section === "projects" ? project : filterProject)[0];
  $("#next-action").innerHTML =
    `<div class="os-nexttop"><div class="os-kicker">02 / Следующее действие</div><h4>${esc(t?.title || "Выберите следующий шаг")}</h4><p>${esc(t?.description || "Добавьте задачу и определите её приоритет.")}</p></div><div class="os-bottom"><div class="os-detail">${t ? esc(projectName(t.project)) : "Всё начинается с одной задачи"}</div>${t ? `<div class="os-detail">Приоритет: ${esc(t.priority)}</div><div class="os-detail">Срок: ${esc(t.due || "не задан")}</div>${button("Открыть задачу", "edit", `data-kind="tasks" data-id="${esc(t.id)}"`, true)}` : button("Создать задачу", "new", 'data-kind="tasks"', true)}<p class="muted section">${t?.sample ? "Это стартовый пример из макета. Измените его под свою работу." : CLOUD_TASKS ? "Задачи сохраняются в Google Sheets." : "Изменения сохраняются в этом браузере."}</p></div>`;
}
function taskRows(rows) {
  return rows.length
    ? rows.map((t) => row("tasks", t)).join("")
    : empty("Таких задач пока нет.");
}
function row(kind, r) {
  const meta =
    kind === "tasks"
      ? `${r.status} · ${r.priority} приоритет${r.due ? " · до " + r.due : ""}`
      : kind === "materials"
        ? r.type
        : kind === "issues"
          ? `${r.severity} · ${r.status}`
          : kind === "videos"
            ? `${r.format} · ${r.status}`
            : r.date;
  return `<article class="os-row"><div class="os-rowbody"><strong>${esc(r.title)}</strong><p>${esc((r.description || r.comment || r.topic || r.text || "").slice(0, 220))}</p><div class="meta">${esc(projectName(r.project))} · ${esc(meta)}${r.sample ? " · стартовый пример" : ""}</div>${kind === "tasks" && r.due && r.due < today() && r.status !== "выполнено" ? '<span class="overdue">Просрочено</span>' : ""}${r.url ? link(r.url, "Открыть ссылку ↗") : ""}${r.fileData ? button("Скачать файл", "download", `data-id="${esc(r.id)}"`) : ""}<details><summary>Подробности и даты</summary>${fields[
    kind
  ]
    .filter((k) => r[k] && !["fileData", "url", "fileName"].includes(k))
    .map(
      (k) => `<p class="text"><b>${esc(labels[k] || k)}:</b> ${esc(r[k])}</p>`,
    )
    .join(
      "",
    )}<p class="muted">Создано: ${date(r.createdAt)} · Изменено: ${date(r.updatedAt)} (Москва)</p></details></div><div class="row-actions">${button("Изменить", "edit", `data-kind="${kind}" data-id="${esc(r.id)}"`)}${button("Удалить", "delete", `data-kind="${kind}" data-id="${esc(r.id)}"`)}</div></article>`;
}
function collection(kind, p) {
  let rows = state[kind].filter((r) => !p || r.project === p);
  let html = `<div class="toolbar"><h3>${names[kind]}</h3>${button("Добавить", "new", `data-kind="${kind}"`, true)}</div>`;
  if (kind === "tasks") {
    html += `<div class="filters">${select("taskStatus", "Статус", statuses, taskStatus, "Все статусы")}${select("taskPriority", "Приоритет", priorities, taskPriority, "Все приоритеты")}</div>`;
    rows = rows.filter(
      (t) =>
        (!taskStatus || t.status === taskStatus) &&
        (!taskPriority || t.priority === taskPriority),
    );
  }
  if (kind === "materials")
    html +=
      '<p class="muted">Текст, ссылки и файлы до 2 МБ. Хранение локальное; не загружайте персональные данные участников.</p>';
  if (kind === "versions") html += comparison(rows);
  if (kind === "videos")
    html +=
      '<p class="notice">Ручной учёт. Укажите период и определение каждого процента. Аналитические сервисы не подключены.</p>';
  return (
    html +
    (rows.length
      ? rows.map((r) => row(kind, r)).join("")
      : empty("Здесь пока пусто. Добавьте первую запись."))
  );
}
function history(limit = 300) {
  const rows = state.history
    .filter((h) => !filterProject || h.project === filterProject)
    .slice(0, limit);
  return rows.length
    ? rows
        .map(
          (h) =>
            `<div class="history-item"><p>${esc(h.text)}</p><time>${date(h.at)} · ${esc(projectName(h.project))}</time></div>`,
        )
        .join("")
    : empty("Изменений пока нет. История начнётся после первого сохранения.");
}
function comparison(rows) {
  return `<p class="notice">Сопоставление описаний и результатов проверок вручную. Автоматического сравнения файлов нет.</p>${
    rows.length < 2
      ? '<p class="muted">Для сравнения добавьте две версии.</p>'
      : `<div class="filters">${select(
          "compareA",
          "Первая версия",
          rows.map((r) => ({ id: r.id, name: r.title })),
          rows[0].id,
        )}${select(
          "compareB",
          "Вторая версия",
          rows.map((r) => ({ id: r.id, name: r.title })),
          rows[1].id,
        )}</div><div class="comparison" id="comparison">${compareCards(rows[0], rows[1])}</div>`
  }`;
}
function compareCards(a, b) {
  if (!a || !b) return "";
  if (a.id === b.id) return '<p class="error">Выберите две разные версии.</p>';
  return [a, b]
    .map(
      (r) =>
        `<article><h3>${esc(r.title)}</h3><p>${esc(r.date)}</p><p class="text">${esc(r.description)}</p><h4>Проверки</h4><p class="text">${esc(r.checks || "Не указаны")}</p><p class="text">${esc(r.materials)}</p>${link(r.url, "GitHub / отчёт ↗")}</article>`,
    )
    .join("");
}
function settings() {
  return `<h2>Настройки и резервная копия</h2><p class="notice">${CLOUD_TASKS ? "Задачи хранятся в вашей Google-таблице. Остальные разделы пока локальные. Экспорт включает текущий снимок облачных задач и локальные материалы." : "Данные привязаны к браузеру и адресу панели. Очистка данных сайта удалит их. Компьютер и iPhone не синхронизируются."} Резервная копия содержит ваши тексты и файлы — храните её приватно.</p><div class="actions">${button("Экспортировать копию", "export", "", true)}${button("Скачать исходное хранилище", "raw")}</div><label class="field">Импорт резервной копии (JSON, до 10 МБ)<input type="file" id="import" accept="application/json,.json"></label><p class="muted">${CLOUD_TASKS ? "Импорт добавляет новые задачи в Google Sheets. Материалы и стартовые примеры не переносятся; существующие задачи не заменяются." : "Импорт заменяет все локальные данные после подтверждения. Сначала экспортируйте текущую копию."}</p><h3>Подключение ГТО</h3>${gtoStatus()}<p>Рабочий режим выбирается на сервере. Учётные данные Google в браузере не хранятся.</p><h3>Следующий этап хранения</h3><p>${CLOUD_TASKS ? "Материалы и версии можно перенести в Google Sheets, а файлы — в приватную папку Google Drive. Сейчас синхронизируются только задачи." : "SQLite на том же сервере за авторизацией: одна база задач, материалов и истории для всех ваших устройств. В этой версии серверного хранения ещё нет."}</p>`;
}
function gtoStatus() {
  return `${SOURCE_MODE === "static-demo" ? '<p class="notice">Статическое демо ГТО · источники ГТО не подключены. Показаны только синтетические данные.</p>' : ""}<div class="toolbar"><span class="badge ${gto?.mode === "demo" ? "demo" : ""}">${gto?.mode === "demo" ? "ДЕМО · синтетические данные" : gto?.mode === "sheets" ? "Google Sheets · только чтение" : "Источник ещё не определён"}</span>${button(gtoLoading ? "Обновление…" : SOURCE_MODE === "static-demo" ? "Пересчитать демо" : "Обновить", "refresh", gtoLoading ? "disabled" : "")}</div><p class="muted">${SOURCE_MODE === "static-demo" ? `Демо пересчитано: ${date(gto?.lastSuccess)} (Москва). Это не обновление Google Sheets.` : `Последнее успешное обновление: ${date(gto?.lastSuccess)} (Москва). Сервер обновляет источник не чаще раза в 30 секунд.`}</p>${gtoLoading ? '<p role="status">Загрузка статистики…</p>' : ""}${gtoError ? `<p class="error" role="alert">${esc(gtoError)} ${gto?.stats ? "Показаны устаревшие данные." : ""}</p>` : ""}`;
}
function statsCards(s, short = false) {
  const entries = short
    ? [
        ["Регистраций всего", s.registrations.total],
        ["Уникальных участников с результатом", s.results.uniqueParticipants],
        ["Сдало по источнику", s.results.passed],
      ]
    : [
        ["Регистраций всего", s.registrations.total],
        ["Регистраций за период", s.registrations.period],
        ["На дату мероприятия / за период", s.registrations.event],
        ["Сдало за период", s.results.passed],
        ["Золото · уровень источника", s.results.levels.gold],
        ["Серебро", s.results.levels.silver],
        ["Бронза", s.results.levels.bronze],
        ["Неизвестный статус", s.results.unknownStatus],
        ["Уровень не определён", s.results.levels.unknown],
      ];
  return `<div class="stats">${entries.map(([label, n], i) => `<div class="stat ${i === 0 ? "accent" : ""}"><strong>${n}</strong><span>${label}</span></div>`).join("")}</div>`;
}
function chart(title, rows) {
  return `<h3>${title}</h3>${rows.length ? rows.map((r) => `<div class="chart-row"><span>${esc(r.date)}</span><meter min="0" max="${Math.max(...rows.map((x) => x.count), 1)}" value="${r.count}" aria-label="${esc(r.date)}: ${r.count}">${r.count}</meter><b>${r.count}</b></div>`).join("") : empty("Нет записей для выбранных фильтров.")}`;
}
function gtoView(view) {
  let html = gtoStatus();
  if (view === "connection")
    return (
      html +
      `<h3>Безопасное чтение</h3><p>Приватные Google Sheets → серверный адаптер → агрегированная статистика. Панель не получает ФИО и УИН. При сбое источник остаётся прежним.</p><h3>Для реального подключения</h3><p>Нужны ссылки и названия листов, заголовки столбцов без данных участников, правила уникальности и повторных сдач, значения статусов, смысл уровня и часовой пояс. Доступ сервисному аккаунту — только читатель. Подробности в docs/SOURCES.md.</p>`
    );
  html += `<form id="gto-filters" class="filters"><label>${view === "results" ? "Дата результата" : "Дата регистрации / результата"}: с<input type="date" name="from" value="${esc(gtoFilters.from)}"></label><label>По (включительно)<input type="date" name="to" value="${esc(gtoFilters.to)}"></label><label>Дата мероприятия (регистрации)<input type="date" name="eventDate" value="${esc(gtoFilters.eventDate)}"></label>${select("category", "Категория источника", gto?.stats?.categories || [], gtoFilters.category, "Все категории")}<button type="submit" class="primary">Применить</button>${button("Сбросить", "resetFilters")}</form><p class="muted">Дата регистрации — день заполнения формы; дата мероприятия — отдельное поле. Дата мероприятия не фильтрует результаты. Часовой пояс: ${esc(gto?.stats?.timeZone || "ещё не получен")}.</p>`;
  const s = gto?.stats;
  if (!s)
    return (
      html +
      empty(
        gtoLoading
          ? "Ожидаем источник…"
          : "Данные не получены. Проверьте раздел «Подключение».",
      )
    );
  if (view === "summary") html += statsCards(s);
  if (view === "registrations" || view === "summary")
    html +=
      chart("Регистрации по дням заполнения", s.registrations.byDay) +
      chart("По датам мероприятий", s.registrations.byEvent);
  if (view === "results")
    html += `<div class="stats"><div class="stat accent"><strong>${s.results.uniqueParticipants}</strong><span>Уникальных участников за период</span></div><div class="stat"><strong>${s.results.passed}</strong><span>Сдало</span></div><div class="stat"><strong>${s.results.notPassed}</strong><span>Явно «не сдал»</span></div></div>${chart(
      "Уровень из источника",
      [
        ["Золото", s.results.levels.gold],
        ["Серебро", s.results.levels.silver],
        ["Бронза", s.results.levels.bronze],
        ["Не определён", s.results.levels.unknown],
      ].map(([date, count]) => ({ date, count })),
    )}`;
  if (view === "protocol")
    html += `<h3>Протокол / ${esc(gtoFilters.eventDate || "дата не выбрана")}</h3><p class="notice">Фильтр панели не меняет A2. Существующий выбор даты и формулы сохраняются в таблице.</p><p>${esc(s.protocol.message)}</p>${s.protocol.url ? link(s.protocol.url, "Открыть приватную таблицу ↗") : '<p class="muted">Ссылка на таблицу ещё не настроена.</p>'}<p class="section">Проверка регистраций: ${s.registrations.event} за выбранный период${gtoFilters.eventDate ? " на " + esc(gtoFilters.eventDate) : " по всем датам"}. Это не проверка содержимого листа «Протокол».</p>`;
  html += `<details><summary>Какие записи учтены</summary><p>${esc(s.levelMeaning)}. Это не подтверждение официального присвоения знака.</p><p>Регистрация — уникальный ID записи; участник — отдельный стабильный ID. В результатах выбрана последняя сдача каждого участника внутри периода. Неизвестные статусы не превращаются в «не сдал».</p><p>Исключено дублей регистраций: ${s.quality.registrationDuplicates}; конфликтных ID: ${s.quality.registrationConflicts}; некорректных строк: ${s.quality.invalidRegistrations}.</p><p>Результаты: дублей ${s.quality.resultDuplicates}, конфликтных ID ${s.quality.resultConflicts}, некорректных строк ${s.quality.invalidResults}; предыдущих попыток в периоде ${s.results.repeatedAttempts}. Противоречивых результатов: ${s.results.conflictingResults}.</p><p>Уникальных зарегистрированных участников: ${s.registrations.uniqueParticipants}. Счётчики качества относятся ко всему загруженному источнику.</p></details>`;
  return html;
}
async function refresh() {
  const id = ++requestId;
  gtoLoading = true;
  gtoError = "";
  render();
  try {
    let body;
    let ok = true;
    if (SOURCE_MODE === "static-demo") {
      const [{ demoSource }, { aggregate }] = await Promise.all([
        import("./lib/gto-demo.js"),
        import("./lib/gto-stats.js"),
      ]);
      body = {
        mode: "demo",
        stale: false,
        lastSuccess: new Date().toISOString(),
        stats: aggregate(demoSource, gtoFilters),
      };
    } else if (SOURCE_MODE === "server") {
      const endpoint = new URL("./api/gto", import.meta.url);
      endpoint.search = new URLSearchParams(gtoFilters).toString();
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(15000),
      });
      body = await response.json();
      ok = response.ok;
    } else {
      throw new Error(
        "Неизвестный режим источника. Проверьте настройку размещения.",
      );
    }
    if (id !== requestId) return;
    if (body.mode) gto = body;
    else gto = null;
    if (!ok) throw new Error(body.error || "Не удалось обновить статистику.");
  } catch (e) {
    if (id !== requestId) return;
    if (
      gto?.stats &&
      JSON.stringify(gto.stats.filters) !== JSON.stringify(gtoFilters)
    )
      gto = { ...gto, stats: null };
    gtoError =
      e.name === "TimeoutError"
        ? "Источник не ответил вовремя."
        : e instanceof TypeError
          ? "Сеть недоступна. Проверьте соединение и повторите обновление."
          : e.message || "Не удалось обновить статистику.";
  } finally {
    if (id === requestId) {
      gtoLoading = false;
      render();
    }
  }
}
const labels = {
  title: "Название",
  description: "Описание",
  project: "Проект",
  status: "Статус",
  priority: "Приоритет",
  due: "Срок",
  materials: "Связанные материалы (названия или ссылки)",
  stage: "Версия или этап",
  type: "Тип",
  text: "Текст",
  url: "Ссылка HTTP/HTTPS",
  comment: "Комментарий",
  date: "Дата версии",
  checks: "Результаты проверок",
  steps: "Шаги воспроизведения",
  expected: "Ожидаемый результат",
  actual: "Фактический результат",
  severity: "Серьёзность",
  topic: "Тема",
  format: "Формат",
  script: "Сценарий",
  scenes: "Сцены и длительности",
  storyboard: "Раскадровка и референсы",
  prompts: "Видеопромты Veo 3",
  generations: "Версии генераций",
  selected: "Выбранная версия",
  publicationDate: "Дата публикации",
  metricsPeriod: "Период измерения метрик",
  views: "Просмотры",
  retention: "Удержание (%)",
  completion: "Досмотры (%)",
  replays: "Повторные просмотры",
  shares: "Репосты",
  saves: "Сохранения",
  subscriptions: "Подписки",
  metricDefinition: "Что измеряет каждый процент (числитель / знаменатель)",
  fileName: "Имя файла",
};
const textFields = [
  "description",
  "text",
  "comment",
  "checks",
  "steps",
  "expected",
  "actual",
  "script",
  "scenes",
  "storyboard",
  "prompts",
  "generations",
  "metricDefinition",
];
function openEditor(kind, id) {
  const existing = state[kind].find((r) => r.id === id);
  editing = { kind, id, existing };
  const r = existing || {
    project: section === "materials" ? filterProject || project : project,
  };
  $("#editor-title").textContent =
    (existing ? "Изменить: " : "Добавить: ") + names[kind];
  $("#form-error").textContent = "";
  const inputs = [
    "title",
    "project",
    ...fields[kind].filter((f) => !["fileName", "fileData"].includes(f)),
  ];
  $("#editor-fields").innerHTML =
    inputs
      .map((key) => {
        const label = labels[key] || key,
          value = r[key] || "";
        let options =
          key === "project"
            ? projects
            : key === "priority"
              ? priorities
              : key === "status"
                ? kind === "videos"
                  ? [
                      "идея",
                      "исследование",
                      "сценарий",
                      "сцены",
                      "раскадровка",
                      "промпты",
                      "генерация",
                      "публикация",
                      "аналитика",
                    ]
                  : kind === "issues"
                    ? ["открыта", "в работе", "на проверке", "закрыта"]
                    : statuses
                : key === "severity"
                  ? ["низкая", "средняя", "высокая", "критическая"]
                  : key === "type"
                    ? ["текст", "ссылка", "файл"]
                    : key === "format"
                      ? [
                          "познавательный · 30–60 секунд",
                          "мультфильм · около 3 минут",
                        ]
                      : null;
        if (options)
          return `<div class="field">${select(key, label, options, value)}</div>`;
        const numeric = [
          "views",
          "retention",
          "completion",
          "replays",
          "shares",
          "saves",
          "subscriptions",
        ].includes(key);
        return `<label class="field">${label}${textFields.includes(key) ? `<textarea name="${key}" maxlength="50000">${esc(value)}</textarea>` : `<input name="${key}" type="${["due", "date", "publicationDate"].includes(key) ? "date" : key === "url" ? "url" : numeric ? "number" : "text"}" value="${esc(value)}" ${key === "title" ? 'required maxlength="250"' : numeric ? `min="0" ${["retention", "completion"].includes(key) ? 'max="100" step="0.01"' : 'step="1"'}` : 'maxlength="50000"'}>`}</label>`;
      })
      .join("") +
    (kind === "materials"
      ? `<label class="field">Файл до 2 МБ<input type="file" name="attachment"></label><p class="muted">${esc(r.fileName || "Файл не выбран")}. Файл включается в резервную копию.</p>`
      : "");
  $("#editor").showModal();
}
$("#editor").addEventListener("cancel", (e) => {
  if ($("#editor-form [type=submit]").disabled) e.preventDefault();
});
$("#editor-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = e.submitter;
  submit.disabled = true;
  try {
    const { kind, id, existing } = editing,
      form = new FormData(e.target),
      now = new Date().toISOString();
    const item = {
      id: id || crypto.randomUUID(),
      project: String(form.get("project")),
      title: String(form.get("title")).trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      sample: false,
    };
    for (const key of fields[kind])
      item[key] = String(form.get(key) ?? existing?.[key] ?? "");
    if (!item.title) throw new Error("Введите название.");
    if (
      kind === "videos" &&
      (item.retention || item.completion) &&
      (!item.metricDefinition.trim() || !item.metricsPeriod.trim())
    )
      throw new Error("Для процентов укажите период и определение метрик.");
    if (kind === "materials") {
      const file = form.get("attachment");
      if (file?.size) {
        if (file.size > 2 * 1024 * 1024)
          throw new Error("Размер файла превышает 2 МБ.");
        item.fileName = file.name;
        item.fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(
              "data:application/octet-stream;base64," +
                String(reader.result).split(",")[1],
            );
          reader.onerror = () =>
            reject(new Error("Не удалось прочитать файл."));
          reader.readAsDataURL(file);
        });
        item.type = "файл";
      }
      if (item.type === "ссылка" && !safeURL(item.url))
        throw new Error("Укажите ссылку HTTP/HTTPS.");
      if (item.type === "файл" && !item.fileData)
        throw new Error("Выберите файл.");
    }
    const next = structuredClone(state);
    if (id) next[kind] = next[kind].map((r) => (r.id === id ? item : r));
    else next[kind].unshift(item);
    if (
      CLOUD_TASKS &&
      kind === "tasks" &&
      id &&
      JSON.stringify(existing) !==
        JSON.stringify(state.tasks.find((t) => t.id === id))
    )
      throw new Error(
        "Задача обновилась на другом устройстве. Скопируйте введённый текст и откройте актуальную карточку заново.",
      );
    await save(
      next,
      `${id ? "Изменено" : "Создано"}: ${item.title}`,
      item.project,
    );
    $("#editor").close();
    render();
    toast(
      CLOUD_TASKS && kind === "tasks"
        ? "Сохранено в Google Sheets."
        : "Сохранено на этом устройстве.",
    );
  } catch (err) {
    $("#form-error").textContent = err.message;
    $("#form-error").tabIndex = -1;
    $("#form-error").focus();
  } finally {
    submit.disabled = false;
  }
});
function download(data, name, type = "application/json") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) {
    if ($("#editor-form [type=submit]").disabled) return;
    $("#editor").close();
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id, kind } = b.dataset;
  if (action === "project") location.hash = `projects/${id}/summary`;
  if (action === "tab") location.hash = `projects/${project}/${id}`;
  if (action === "new" || action === "edit")
    openEditor(kind, action === "edit" ? id : null);
  if (action === "cloud-refresh") await syncTasks();
  if (action === "refresh") refresh();
  if (action === "resetFilters") {
    Object.keys(gtoFilters).forEach((k) => (gtoFilters[k] = ""));
    refresh();
  }
  if (action === "delete") {
    const item = state[kind].find((r) => r.id === id);
    if (!confirm(`Удалить «${item.title}»?`)) return;
    try {
      const next = structuredClone(state);
      next[kind] = next[kind].filter((r) => r.id !== id);
      await save(next, `Удалено: ${item.title}`, item.project);
      render();
      toast("Запись удалена.");
    } catch (err) {
      toast(err.message);
    }
  }
  if (action === "export")
    download(JSON.stringify(state, null, 2), `gvi-backup-${today()}.json`);
  if (action === "raw") {
    try {
      download(localStorage.getItem(KEY) || "{}", "gvi-raw-backup.json");
    } catch {
      toast("Хранилище недоступно.");
    }
  }
  if (action === "download") {
    const r = state.materials.find((m) => m.id === id);
    const bytes = Uint8Array.from(atob(r.fileData.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    download(bytes, r.fileName, "application/octet-stream");
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "gto-filters") {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get("from") && f.get("to") && f.get("from") > f.get("to")) {
      toast("Начало периода должно быть не позже окончания.");
      return;
    }
    for (const k of Object.keys(gtoFilters))
      gtoFilters[k] = String(f.get(k) || "");
    refresh();
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.name === "projectFilter") {
    filterProject = e.target.value;
    render();
  }
  if (e.target.name === "taskStatus") {
    taskStatus = e.target.value;
    render();
  }
  if (e.target.name === "taskPriority") {
    taskPriority = e.target.value;
    render();
  }
  if (["compareA", "compareB"].includes(e.target.name))
    $("#comparison").innerHTML = compareCards(
      state.versions.find((r) => r.id === $("[name=compareA]").value),
      state.versions.find((r) => r.id === $("[name=compareB]").value),
    );
  if (e.target.id === "import") {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw new Error("Копия больше 10 МБ.");
      const incoming = validate(JSON.parse(await file.text()));
      if (CLOUD_TASKS) {
        const rows = incoming.tasks.filter((t) => !t.sample);
        const known = new Map(state.tasks.map((t) => [t.id, t]));
        if (
          rows.some(
            (t) =>
              known.has(t.id) &&
              JSON.stringify(known.get(t.id)) !== JSON.stringify(t),
          )
        )
          throw new Error(
            "В копии есть другая версия существующей задачи. Сначала устраните конфликт; облако не изменено.",
          );
        const additions = rows.filter((t) => !known.has(t.id));
        if (!additions.length) {
          toast(
            "Новых задач для переноса нет. Стартовые примеры не переносятся.",
          );
          return;
        }
        if (
          !confirm(
            `Добавить ${additions.length} задач в Google Sheets? Существующие задачи останутся. Материалы и примеры не переносятся.`,
          )
        )
          return;
        const next = structuredClone(state);
        next.tasks.push(...additions);
        await save(
          next,
          "Перенесены задачи из резервной копии",
          additions[0].project,
        );
        render();
        toast("Задачи перенесены в Google Sheets.");
        return;
      }
      if (
        !confirm(
          "Заменить все локальные данные этой копией? Текущие записи будут заменены.",
        )
      )
        return;
      state = persist(incoming);
      storageError = "";
      render();
      toast("Копия восстановлена.");
    } catch (err) {
      toast("Импорт отклонён: " + err.message);
    } finally {
      if ($("#import")) $("#import").value = "";
    }
  }
});
let keyboardNavigation = false;
window.addEventListener("keydown", () => (keyboardNavigation = true));
window.addEventListener("pointerdown", () => (keyboardNavigation = false));
window.addEventListener("hashchange", () => {
  route();
  if (keyboardNavigation) $("#workspace").focus({ preventScroll: true });
});
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    try {
      const local = load();
      state = CLOUD_TASKS ? { ...local, tasks: state.tasks } : local;
      storageError = "";
      render();
      toast("Данные обновлены в другой вкладке.");
    } catch {
      toast("Не удалось прочитать изменения другой вкладки.");
    }
  }
});
route();
refresh();
if (CLOUD_TASKS) {
  syncTasks();
  setInterval(() => {
    if (!document.hidden && !$("#editor").open) syncTasks();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("#editor").open) syncTasks();
  });
}
