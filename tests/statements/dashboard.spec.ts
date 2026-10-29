import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.protocol === "data:"
      ? route.continue()
      : route.abort();
  });
});
test("nine workspaces, account filtering, sorting and responsive layouts", async ({
  page,
}) => {
  await page.goto("/statements");
  const nav = page.getByRole("navigation", {
    name: "Company and account workspaces",
  });
  await expect(nav.getByRole("button")).toHaveCount(9);
  await expect(
    page
      .getByRole("button", { name: "Generate AI Invoice", exact: true })
      .first(),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Revolut LMD", exact: true }).click();
  await expect(page).toHaveURL(/company=revolut-lmd/);
  await expect(
    page.locator(".statement-transactions-table tbody tr"),
  ).toHaveCount(10);
  await expect(page.locator(".statement-transactions-table")).not.toContainText(
    "Amex LMD",
  );
  await page.getByRole("button", { name: /Date/ }).first().click();
  await expect(page).toHaveURL(/transactionsOrder=asc/);
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 834, 1112],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `output/playwright/statements-${name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});
test("one click creates a saved internal document and repeated requests reuse it", async ({
  page,
}) => {
  await page.goto("/statements?company=artec&search=Synthetic%20hosting%2015");
  await expect(
    page
      .getByRole("button", { name: "Generate AI Invoice", exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate AI Invoice", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Document saved" }),
  ).toBeVisible({ timeout: 30000 });
  const first = await page
    .getByRole("link", { name: "View", exact: true })
    .getAttribute("href");
  expect(first).toMatch(/created-invoices/);
  await page.screenshot({
    path: "output/playwright/document-saved.png",
    fullPage: true,
  });
  const pdf = await page.request.get(first!);
  expect(pdf.ok()).toBeTruthy();
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    "output/pdf/synthetic-supporting-document.pdf",
    await pdf.body(),
  );
  await page.getByRole("button", { name: "Close Document saved" }).click();
  await page
    .getByRole("button", { name: "Generate AI Invoice", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Document saved" }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("link", { name: "View", exact: true })
      .getAttribute("href"),
  ).toBe(first);
});
test("missing company facts use one compact correction form", async ({
  page,
}) => {
  await page.goto("/statements?company=artec&search=Unresolved%20Merchant");
  await page
    .getByRole("button", { name: "Generate AI Invoice", exact: true })
    .first()
    .click();
  await expect(page.getByRole("group", { name: "Legal issuer" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Counterparty" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate and save", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
test("library filters and account settings are available", async ({ page }) => {
  await page.goto("/statements?view=documents");
  await expect(
    page.getByRole("textbox", { name: "Search document library" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download all matching" }),
  ).toBeVisible();
  await page.goto("/statements?view=settings");
  await expect(
    page.getByRole("heading", { name: "Company and account settings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Document designs" }),
  ).toBeVisible();
});

test("saved-data pagination covers records beyond the former 2000-row boundary", async ({
  page,
}) => {
  const response = await page.request.get(
    "/api/statements/transactions?companyId=artec&search=Volume%20fixture&sort=description&order=asc&offset=2100&limit=10",
  );
  expect(response.ok()).toBeTruthy();
  const list = await response.json();
  expect(list.total).toBe(2101);
  const exported = await (
    await page.request.get(
      "/api/statements/transactions/export?companyId=artec&search=Volume%20fixture",
    )
  ).json();
  expect(exported.transactions).toHaveLength(2101);
  expect(exported.hasMore).toBe(false);
  expect(list.transactions).toHaveLength(1);
  expect(list.truncated).toBe(false);
  expect(list.totals).toEqual([
    { currency: "EUR", inMinor: "0", outMinor: "210100" },
  ]);
});
test("manual multirow entry preserves the named financial account", async ({
  page,
}) => {
  await page.goto("/statements?company=revolut-lmd");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Amount", { exact: true }).fill("123.47");
  await modal
    .getByLabel("Description", { exact: true })
    .fill("Synthetic manual browser entry");
  await modal
    .getByLabel("Paid to / received from", { exact: true })
    .fill("Synthetic Hosting");
  await modal
    .getByRole("button", { name: "Copy transaction 1", exact: true })
    .click();
  await expect(modal.locator(".statement-entry")).toHaveCount(2);
  await modal
    .locator(".statement-entry")
    .nth(1)
    .getByLabel("Amount", { exact: true })
    .fill("123.48");
  await modal
    .getByRole("button", { name: "Save 2 transactions", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("Synthetic manual browser entry");
  await expect(
    page.locator(".statement-transactions-table tbody tr"),
  ).toHaveCount(2);
  await expect(page.locator(".statement-transactions-table")).toContainText(
    "Revolut LMD",
  );
});
test("CSV files retain individual previews and safe import results", async ({
  page,
}) => {
  await page.goto("/statements?company=artec");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.locator('input[type="file"]').setInputFiles(
    [1, 2].map((n) => ({
      name: `synthetic-${n}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Date,Description,Amount,Currency,Direction,Transaction ID\n2026-10-20,Synthetic CSV browser ${n},${70 + n}.31,EUR,out,csv-browser-${n}\n`,
      ),
    })),
  );
  await expect(modal).toContainText("1 more files queued");
  for (let n = 1; n <= 2; n++) {
    await expect(modal).toContainText(`synthetic-${n}.csv`);
    await modal
      .getByRole("button", { name: "Check and preview", exact: true })
      .click();
    await expect(
      modal.getByRole("button", {
        name: "Add these transactions",
        exact: true,
      }),
    ).toBeVisible();
    await modal
      .getByRole("button", { name: "Add these transactions", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Close Upload statement or document" })
    .click();
  const imports = await (
    await page.request.get("/api/statements/imports?companyId=artec")
  ).json();
  expect(
    imports.imports
      .filter((r: { fileName: string }) => r.fileName.startsWith("synthetic-"))
      .every(
        (r: { status: string; inserted: number }) =>
          r.status === "imported" && r.inserted === 1,
      ),
  ).toBeTruthy();
  await page.goto("/statements?company=artec&search=Synthetic%20CSV%20browser");
  await expect(
    page.locator(".statement-transactions-table tbody tr"),
  ).toHaveCount(2, { timeout: 15000 });
});
test("regeneration saves a new version while preserving the original PDF", async ({
  page,
}) => {
  await page.goto("/statements?company=artec&search=Synthetic%20hosting%2014");
  await page
    .getByRole("button", { name: "Generate AI Invoice", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Document saved" }),
  ).toBeVisible();
  const original = await page
    .getByRole("link", { name: "View", exact: true })
    .getAttribute("href");
  const bytes = await (await page.request.get(original!)).body();
  await page
    .getByRole("button", { name: "Edit / history", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Regenerate with approved template",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Replacement description")
    .fill("Web hosting services — approved synthetic correction");
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save new version", exact: true }),
  ).not.toBeVisible();
  const replacement = await page
    .getByRole("link", { name: "Download invoice PDF", exact: true })
    .getAttribute("href");
  expect(replacement).not.toBe(original);
  expect(await (await page.request.get(original!)).body()).toEqual(bytes);
  await page.screenshot({
    path: "output/playwright/document-history.png",
    fullPage: true,
  });
});

test("saved design previews, reference attachments and reminders work with isolated evidence", async ({
  page,
}) => {
  await page.goto("/statements?view=settings");
  const design = page
    .locator("form")
    .filter({ has: page.locator("strong", { hasText: "AMG Holding" }) });
  await design.locator('select[name="style"]').selectOption("minimal");
  await design
    .getByRole("button", { name: "Save version", exact: true })
    .click();
  await expect(
    design.getByRole("button", { name: "Preview saved design", exact: true }),
  ).toBeEnabled();
  await design
    .getByRole("button", { name: "Preview saved design", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Approved template preview" }),
  ).toBeVisible();
  await expect(page.getByTitle("Template PDF")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page
    .getByRole("button", { name: "Close Approved template preview" })
    .click();
  await page.goto("/statements?view=contacts&company=artec");
  const merchant = page
    .locator("tbody tr")
    .filter({ hasText: "Synthetic Hosting" })
    .first();
  await merchant
    .getByRole("button", { name: "Edit Synthetic Hosting", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reference PDF or image").setInputFiles({
    name: "synthetic-reference.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nSYNTHETIC reference fixture\n%%EOF"),
  });
  await dialog
    .getByRole("button", { name: "Attach reference", exact: true })
    .click();
  const reference = dialog.getByRole("link", {
    name: "synthetic-reference.pdf",
  });
  await expect(reference).toBeVisible();
  expect(
    (await page.request.get((await reference.getAttribute("href"))!)).ok(),
  ).toBeTruthy();
  await page.goto("/statements?company=artec&search=Synthetic%20hosting%2013");
  await page
    .getByRole("button", {
      name: "Actions for Synthetic hosting 13",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Set reminder", exact: true })
    .click();
  const reminder = page.getByRole("dialog");
  await reminder
    .getByLabel("Remind me at", { exact: true })
    .fill("2027-01-02T12:30");
  await reminder
    .getByRole("textbox", { name: "Reminder", exact: true })
    .fill("Synthetic browser reminder");
  await reminder
    .getByRole("button", { name: "Save reminder", exact: true })
    .click();
  await expect(reminder).not.toBeVisible();
  await page.goto("/statements?view=settings");
  await expect(page.getByText(/Synthetic browser reminder ·/)).toBeVisible();
});

test("bulk completion reports outcomes and Done can be reversed independently", async ({
  page,
}) => {
  await page.goto("/statements?company=artec&search=Synthetic%20hosting%2012");
  await page
    .getByRole("checkbox", { name: "Select Synthetic hosting 12", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Complete selected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Review note", { exact: true })
    .fill("Manual synthetic review");
  await dialog.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "1 of 1 changes confirmed.",
  );
  await dialog
    .locator("summary")
    .filter({ hasText: "Individual results" })
    .click();
  await expect(dialog.locator("pre")).toContainText("success");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Actions for Synthetic hosting 12",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Mark Done", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark Done", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "1 of 1 changes confirmed.",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Actions for Synthetic hosting 12",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Undo Done", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Undo Done", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "1 of 1 changes confirmed.",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.locator(".statement-transactions-table tbody"),
  ).toContainText("Completed");
  await expect(
    page.locator(".statement-transactions-table tbody"),
  ).not.toContainText("Done");
});
