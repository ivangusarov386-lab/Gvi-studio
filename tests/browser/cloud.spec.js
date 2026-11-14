import { test, expect } from "@playwright/test";
const url = "http://127.0.0.1:3101/google/";
async function bridge(page, backend) {
  await page.exposeFunction("__cloudMock", backend);
  await page.addInitScript(() => {
    const runner = (success = () => {}, failure = () => {}) => ({
      withSuccessHandler: (fn) => runner(fn, failure),
      withFailureHandler: (fn) => runner(success, fn),
      getTasks: () =>
        window
          .__cloudMock("getTasks")
          .then(success, (e) => failure({ message: e.message })),
      saveTasks: (data) =>
        window
          .__cloudMock("saveTasks", data)
          .then(success, (e) => failure({ message: e.message })),
    });
    window.google = { script: { run: runner() } };
  });
}
test("private build uses shared tasks, detects conflict and preserves entered text", async ({
  page,
  browser,
}, info) => {
  let tasks = [],
    revision = 0;
  const backend = async (method, payload) => {
    if (method === "saveTasks") {
      if (payload.revision !== String(revision)) throw new Error("CONFLICT");
      tasks = payload.tasks;
      revision++;
    }
    return {
      tasks,
      revision: String(revision),
      spreadsheetUrl:
        "https://docs.google.com/spreadsheets/d/synthetic-test/edit",
      syncedAt: new Date().toISOString(),
    };
  };
  const second = await browser.newPage();
  try {
    for (const p of [page, second]) {
      await bridge(p, backend);
      await p.goto(url + "#projects/gto/tasks");
      await expect(
        p.getByText("Задачи · Google Sheets", { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await page
      .getByLabel("Название", { exact: true })
      .fill("Синтетическая облачная задача");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Сохранено в Google Sheets",
    );
    await second.getByRole("button", { name: "Добавить", exact: true }).click();
    await second
      .getByLabel("Название", { exact: true })
      .fill("Черновик второго устройства");
    await second
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(second.locator("#form-error")).toContainText(
      "другом устройстве",
    );
    await expect(second.getByLabel("Название", { exact: true })).toHaveValue(
      "Черновик второго устройства",
    );
    await second.getByRole("button", { name: "Отмена", exact: true }).click();
    await second
      .getByRole("button", { name: "Обновить облако", exact: true })
      .click();
    await expect(
      second
        .locator("article")
        .filter({ hasText: "Синтетическая облачная задача" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Синтетическая облачная задача" }),
    ).toBeVisible();
    const local = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("gvi-studio-v1")),
    );
    expect(local.tasks).toEqual([]);
    await page.screenshot({
      path: `screenshots/cloud-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await second.close();
  }
});
test("Google connection error never reports local success for a cloud task", async ({
  page,
}) => {
  await bridge(page, async () => {
    throw new Error("ACCESS_DENIED");
  });
  await page.goto(url + "#projects/gto/tasks");
  await expect(page.locator("#workspace [role=alert]")).toContainText(
    "Google-аккаунт",
  );
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Не должна сохраняться");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("#form-error")).toContainText("загрузки облака");
  await expect(page.locator("article")).toHaveCount(0);
});
