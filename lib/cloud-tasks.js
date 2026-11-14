// Endpoint is a public deployment URL, never a password or credential.
const endpointKey = "gvi-tasks-endpoint";
let endpoint = "",
  session = "";
try {
  endpoint = localStorage.getItem(endpointKey) || "";
} catch {}
export const SCRIPT_PANEL =
  typeof __GVI_APPS_SCRIPT__ !== "undefined" && __GVI_APPS_SCRIPT__;
export const CLOUD_TASKS = SCRIPT_PANEL || !!endpoint;
export const REMOTE_TASKS = !SCRIPT_PANEL && !!endpoint;
export function setTaskEndpoint(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw new Error(
      "Укажите HTTPS-адрес развёртывания script.google.com/macros/s/.../exec.",
    );
  const previous = localStorage.getItem("gvi-studio-v1");
  if (previous && !localStorage.getItem("gvi-local-before-sheets"))
    localStorage.setItem("gvi-local-before-sheets", previous);
  localStorage.setItem(endpointKey, u.href);
}
export function clearTaskEndpoint() {
  localStorage.removeItem(endpointKey);
  session = "";
}
export function signOutTasks() {
  session = "";
}
export async function loginTasks(password) {
  const r = await remoteRequest({ action: "login", password });
  if (!r.ok || !r.session) throw new Error(r.error || "Не удалось войти.");
  session = r.session;
}
async function remoteRequest(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Сервер Google недоступен.");
  return response.json();
}
const messages = {
  CONFLICT:
    "Задачи изменились на другом устройстве. Обновите облако, затем повторите изменение. Текст формы сохранён.",
  ACCESS_DENIED: "Войдите в Google-аккаунт владельца этой панели.",
  NOT_CONFIGURED: "Сначала выполните setupWorkspace в Apps Script.",
  SCHEMA_ERROR:
    "Проверьте названия четырёх листов, заголовки и значения задач в таблице.",
  WORKSPACE_TOO_LARGE:
    "Объём задач превышает 2 МБ. Экспортируйте архив и сократите описания.",
  INVALID_FIELD:
    "Поле задачи слишком длинное (максимум 40 000 символов) или имеет неверный формат.",
  INVALID_TASK: "Проверьте поля задачи.",
  INVALID_DATE: "Проверьте даты задачи.",
};
export function cloudCall(method, payload) {
  if (REMOTE_TASKS)
    return (async () => {
      if (!session) throw new Error("Для доступа к задачам введите пароль.");
      const result = await remoteRequest({
        action: method,
        session,
        ...(method === "saveTasks" ? { payload } : {}),
      });
      if (!result.ok) {
        if (result.code === "AUTH_REQUIRED") session = "";
        throw new Error(
          messages[result.code] ||
            result.error ||
            "Google не подтвердил операцию.",
        );
      }
      return result.data;
    })();
  return new Promise((resolve, reject) => {
    if (!globalThis.google?.script?.run)
      return reject(
        new Error(
          "Нет защищённого соединения Apps Script. Откройте рабочую панель по её Google-адресу.",
        ),
      );
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "Google не ответил. Результат записи неизвестен: обновите облако перед повтором.",
          ),
        ),
      30000,
    );
    const runner = google.script.run
      .withSuccessHandler((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .withFailureHandler((error) => {
        clearTimeout(timeout);
        const code = Object.keys(messages).find((k) =>
          String(error?.message || "").includes(k),
        );
        reject(
          new Error(
            code
              ? messages[code]
              : "Не удалось обратиться к Google. Проверьте вход и соединение; обновите облако перед повторной записью.",
          ),
        );
      });
    if (method === "getTasks") runner.getTasks();
    else if (method === "saveTasks") runner.saveTasks(payload);
    else {
      clearTimeout(timeout);
      reject(new Error("Неизвестная операция"));
    }
  });
}
