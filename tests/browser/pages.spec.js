import { test, expect } from "@playwright/test";
const url = "http://127.0.0.1:3101/Gvi-studio/";
test("Pages subdirectory loads CSS, logo and modules without API or root requests", async ({
  page,
}, testInfo) => {
  const badResponses = [],
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(r.url());
  });
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  await page.goto(url + "#projects/gto/summary");
  await expect(page.getByText("ДЕМО · синтетические данные")).toBeVisible();
  await expect(
    page.getByText(/Статическое демо ГТО · источники ГТО не подключены/),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(250, 247, 242)",
  );
  const logo = await page
    .locator(".gvi-logo img")
    .evaluate((img) => ({
      loaded: img.complete && img.naturalWidth > 0,
      width: img.clientWidth,
      height: img.clientHeight,
      fit: getComputedStyle(img).objectFit,
    }));
  expect(logo.loaded).toBe(true);
  expect(logo.width).toBe(logo.height);
  expect(logo.fit).toBe("contain");
  await expect(page.locator("#projects button")).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(requests.every((p) => p.startsWith("/Gvi-studio/"))).toBe(true);
  expect(requests.some((p) => p.includes("/api/"))).toBe(false);
  expect(badResponses).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `screenshots/pages-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("Pages keeps tasks after reload and filters synthetic GTO without a backend", async ({
  page,
}) => {
  await page.goto(url + "#projects/gto/tasks");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Тест задачи на Pages");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await expect(
    page.locator("article").filter({ hasText: "Тест задачи на Pages" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Регистрации", exact: true }).click();
  await page.locator("[name=from]").fill("2030-01-01");
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(
    page.getByText("Нет записей для выбранных фильтров.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.getByText("2026-11-02", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Пересчитать демо", exact: true })
    .click();
  await expect(page.getByText(/Это не обновление Google Sheets/)).toBeVisible();
});
