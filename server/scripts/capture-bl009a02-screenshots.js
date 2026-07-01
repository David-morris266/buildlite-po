/**
 * BL-009A.02 — Capture Plot Master foundation screenshots.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const SAMPLE_XLSX = path.join(ROOT, "docs", "samples", "buildlite-plot-schedule-sample.xlsx");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

async function clickTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(document.querySelectorAll(".nav .tab")).find((el) =>
      el.textContent.includes(text)
    );
    tab?.click();
  }, label);
}

async function clickWorkspaceTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(document.querySelectorAll(".dev-workspace__tabs button")).find(
      (el) => el.textContent.trim() === text
    );
    tab?.click();
  }, label);
}

async function fillDevelopmentForm(page) {
  const values = [
    "JOB-2402",
    "Canal View",
    "Harbour Homes Ltd",
    "Worcester",
    "22 Canal Wharf",
    "WR1 2AB",
  ];
  const inputs = await page.$$(".dev-form__field input");
  for (let i = 0; i < values.length && i < inputs.length; i += 1) {
    await inputs[i].click({ clickCount: 3 });
    await inputs[i].type(values[i], { delay: 15 });
  }
}

async function openDevelopmentWorkspace(page) {
  await clickTab(page, "Developments");
  await page.waitForSelector(".dev-list-page, .po-empty-state", { timeout: 15000 });

  const hasRows = await page.$(".dev-list-page .po-data-table tbody tr");
  if (hasRows) {
    await page.click(".dev-list-page .po-data-table tbody tr button");
    await page.waitForSelector(".dev-workspace", { timeout: 10000 });
    return;
  }

  await page.click(".dev-list-page__action, .po-empty-state .po-btn-primary");
  await page.waitForSelector(".dev-form-page", { timeout: 10000 });
  await fillDevelopmentForm(page);
  await page.click(".dev-form__footer .po-btn-primary");
  await page.waitForSelector(".dev-workspace", { timeout: 10000 });
}

async function main() {
  if (!fs.existsSync(SAMPLE_XLSX)) {
    require("./generate-sample-plot-schedule-xlsx");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await openDevelopmentWorkspace(page);
  await clickWorkspaceTab(page, "Plot Master");
  await page.waitForSelector(".dev-plot-master__empty", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-02-plot-master-empty.png"),
    fullPage: true,
  });

  await page.click(".dev-plot-master__empty .po-btn-primary");
  await page.waitForSelector(".dev-plot-import", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-02-plot-import-upload.png"),
    fullPage: true,
  });

  const input = await page.$(".po-import-dropzone__input");
  await input.uploadFile(SAMPLE_XLSX);
  await page.waitForFunction(
    () => document.querySelector(".dev-plot-import__preview, .po-import-step__title"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 800));

  let previewVisible = await page.$(".dev-plot-import__preview");
  if (!previewVisible) {
    const continueBtn = await page.$(".po-import-step__actions .po-btn-primary");
    if (continueBtn) await continueBtn.click();
    await page.waitForSelector(".dev-plot-import__preview", { timeout: 10000 });
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-02-plot-import-preview.png"),
    fullPage: true,
  });

  const continueButtons = await page.$$(".po-import-step__actions .po-btn-primary");
  if (continueButtons.length) {
    await continueButtons[continueButtons.length - 1].click();
    await new Promise((r) => setTimeout(r, 400));
  }

  const mappingContinue = await page.$(".po-import-mapping");
  if (mappingContinue) {
    await page.click(".po-import-step__actions .po-btn-primary");
    await page.waitForSelector(".dev-plot-import__summary", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-009A-02-plot-import-review.png"),
      fullPage: true,
    });

    await page.click(".po-import-step__actions .po-btn-primary");
    await page.waitForSelector(".dev-plot-master__table", { timeout: 10000 });
  }

  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-02-plot-master-table.png"),
    fullPage: true,
  });

  await clickWorkspaceTab(page, "Overview");
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-02-development-workspace-overview.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("BL-009A.02 screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
