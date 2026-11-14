// Enabled only in the private Apps Script build, never by an API failure.
export const CLOUD_TASKS =
  typeof __GVI_APPS_SCRIPT__ !== "undefined" && __GVI_APPS_SCRIPT__;
const messages = {
  CONFLICT:
    "Задачи изменились на другом устройстве. Обновите облако, затем повторите изменение. Текст формы сохранён.",
  ACCESS_DENIED: "Войдите в Google-аккаунт владельца этой панели.",
  NOT_CONFIGURED: "Сначала выполните setupWorkspace в Apps Script.",
  SCHEMA_ERROR: "Структура листа Tasks изменена. Верните исходные заголовки.",
  WORKSPACE_TOO_LARGE:
    "Объём задач превышает 2 МБ. Экспортируйте архив и сократите описания.",
  INVALID_FIELD:
    "Поле задачи слишком длинное (максимум 40 000 символов) или имеет неверный формат.",
  INVALID_TASK: "Проверьте поля задачи.",
  INVALID_DATE: "Проверьте даты задачи.",
};
export function cloudCall(method, payload) {
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
