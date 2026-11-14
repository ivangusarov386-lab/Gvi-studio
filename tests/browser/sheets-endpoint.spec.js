import { test, expect } from "@playwright/test";
test("GitHub Pages connects to password protected task endpoint", async ({
  page,
}) => {
  let tasks = [],
    revision = 0;
  await page.route(
    "https://script.google.com/macros/s/test-deployment/exec",
    async (route) => {
      const body = route.request().postDataJSON();
      let data;
      if (body.action === "login")
        data =
          body.password === "synthetic-password"
            ? { ok: true, session: "synthetic-session" }
            : { ok: false, error: "Неверный пароль." };
      else if (body.session !== "synthetic-session")
        data = { ok: false, code: "AUTH_REQUIRED" };
      else {
        if (body.action === "saveTasks") {
          tasks = body.payload.tasks;
          revision++;
        }
        data = {
          ok: true,
          data: {
            tasks,
            revision: String(revision),
            spreadsheetUrl:
              "https://docs.google.com/spreadsheets/d/synthetic/edit",
            syncedAt: new Date().toISOString(),
          },
        };
      }
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    },
  );
  await page.goto("http://127.0.0.1:3101/Gvi-studio/#settings");
  await page
    .getByLabel("Адрес Apps Script")
    .fill("https://script.google.com/macros/s/test-deployment/exec");
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByLabel("Пароль таблицы задач")).toBeVisible();
  await page.getByLabel("Пароль таблицы задач").fill("synthetic-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByText("Задачи · Google Sheets", { exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3101/Gvi-studio/#projects/gto/tasks");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Тест таблицы");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.locator("article").filter({ hasText: "Тест таблицы" }),
  ).toBeVisible();
  expect(tasks).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("Пароль таблицы задач")).toBeVisible();
  await page.getByLabel("Пароль таблицы задач").fill("synthetic-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.locator("article").filter({ hasText: "Тест таблицы" }),
  ).toBeVisible();
});
