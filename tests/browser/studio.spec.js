import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ДЕМО · синтетические данные")).toBeVisible();
});
const navigate = async (page, hash) => {
  await page.goto("/#" + hash);
};
test("navigation, tasks CRUD and persistence, filters, keyboard dialog", async ({
  page,
}) => {
  for (const [id, name] of [
    ["gto", "Система ГТО"],
    ["mesh", "Расширение МЭШ"],
    ["seo", "SEO сайта"],
    ["start", "Точка старта"],
  ]) {
    await page.locator(`[data-action=project][data-id=${id}]`).click();
    await expect(page.locator("#workspace h2")).toHaveText(name);
  }
  await navigate(page, "projects/gto/tasks");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Синтетическая тестовая задача");
  await page
    .getByLabel("Описание", { exact: true })
    .fill("Проверить сохранение");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Приоритет", exact: true })
    .selectOption("высокий");
  await page.getByLabel("Срок", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  const row = page
    .locator("article.os-row")
    .filter({ hasText: "Синтетическая тестовая задача" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Просрочено", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Изменить" }).click();
  await page.locator("dialog [name=status]").selectOption("выполнено");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.locator("[name=taskStatus]").selectOption("выполнено");
  await expect(page.locator("article.os-row")).toHaveCount(1);
  await row.getByRole("button", { name: "Изменить" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
});
test("materials file roundtrip, versions compare, issue and video forms", async ({
  page,
}) => {
  await navigate(page, "projects/gto/materials");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Синтетический материал");
  await page
    .locator("[name=attachment]")
    .setInputFiles({
      name: "example.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic example"),
    });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Скачать файл" }),
  ).toBeVisible();
  await navigate(page, "projects/gto/versions");
  for (const name of ["V1", "V2"]) {
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await page.getByLabel("Название", { exact: true }).fill(name);
    await page
      .getByLabel("Описание", { exact: true })
      .fill("Изменения " + name);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  }
  await expect(page.locator("#comparison article")).toHaveCount(2);
  await navigate(page, "projects/gto/issues");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Тестовая ошибка");
  await page.getByLabel("Шаги воспроизведения").fill("1. Открыть демо");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("article.os-row")).toContainText("Тестовая ошибка");
  await navigate(page, "projects/start/videos");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Тестовый ролик");
  await page.getByLabel("Удержание (%)", { exact: true }).fill("70");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("#form-error")).toContainText("период");
  await page.getByLabel("Период измерения метрик").fill("Первые 7 дней");
  await page
    .getByLabel("Что измеряет каждый процент")
    .fill("Удержание: средняя длительность просмотра / длительность ролика");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("article.os-row")).toContainText("Тестовый ролик");
});
test("GTO filters, empty, loading, network error and stale state", async ({
  page,
}) => {
  await navigate(page, "projects/gto/registrations");
  await page.locator("[name=from]").fill("2030-01-01");
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(
    page.getByText("Нет записей для выбранных фильтров.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.getByText("2026-11-02", { exact: true })).toBeVisible();
  await page.route("**/api/gto?**", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.abort();
  });
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Загрузка статистики…")).toBeVisible();
  await expect(page.locator("#workspace [role=alert]")).toContainText(
    "устаревшие",
  );
});
test("backup export/import and hostile text remains inert", async ({
  page,
}) => {
  await navigate(page, "settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспортировать копию" }).click();
  const downloaded = await downloadPromise;
  expect(downloaded.suggestedFilename()).toMatch(/gvi-backup/);
  const backup = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gvi-studio-v1")),
  );
  backup.tasks[0].title = "<img src=x onerror=alert(1)>";
  page.on("dialog", (d) => d.accept());
  await page
    .locator("#import")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(page.getByRole("status")).toContainText("восстановлена");
  await navigate(page, "projects/gto/tasks");
  await expect(
    page.getByText("<img src=x onerror=alert(1)>", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("article img")).toHaveCount(0);
});
test("responsive logo, keyboard focus and screenshots", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await navigate(page, "projects/gto/summary");
  for (const width of [375, 390, 844, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const logo = await page
      .locator(".gvi-logo img")
      .evaluate((img) => ({
        width: img.clientWidth,
        height: img.clientHeight,
        fit: getComputedStyle(img).objectFit,
        left: img.getBoundingClientRect().left,
        right: img.getBoundingClientRect().right,
      }));
    expect(logo.width).toBe(logo.height);
    expect(logo.fit).toBe("contain");
    expect(logo.left).toBeGreaterThanOrEqual(0);
    expect(logo.right).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 1440 : 390,
    height: testInfo.project.name === "desktop" ? 1100 : 844,
  });
  await page.screenshot({
    path: `screenshots/${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  expect(errors).toEqual([]);
});
