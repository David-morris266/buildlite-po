/**
 * BL-011B.03 — Capture Excel import wizard screenshots.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const SAMPLE = path.join(ROOT, "docs", "samples", "buildlite-order-matrix-sample.xlsx");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

async function clickTab(page, label) {
  await page.evaluate((text) => {
    Array.from(document.querySelectorAll(".nav .tab"))
      .find((el) => el.textContent.includes(text))
      ?.click();
  }, label);
}

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    require("./generate-sample-matrix-xlsx.js");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await clickTab(page, "Payment Certificates");
  await page.waitForFunction(
    () => document.querySelector(".po-data-table .po-list-btn-primary"),
    { timeout: 15000 }
  );

  await page.evaluate(() => {
    document.querySelector(".po-data-table .po-list-btn-primary")?.click();
  });
  await page.waitForSelector(".po-matrix-page", { timeout: 10000 });

  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button"))
      .find((btn) => btn.textContent.includes("Import from Excel"))
      ?.click();
  });
  await page.waitForSelector(".po-import-wizard", { timeout: 10000 });

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-03-import-upload.png"),
    fullPage: true,
  });

  const input = await page.$(".po-import-dropzone__input");
  await input.uploadFile(SAMPLE);
  await page.waitForSelector(".po-import-preview-table, .po-import-mapping", {
    timeout: 15000,
  });
  await new Promise((r) => setTimeout(r, 800));

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-03-import-preview.png"),
    fullPage: true,
  });

  while (true) {
    const onReview = await page.$(".po-import-step__actions .po-btn-primary");
    const label = await page.evaluate(
      () =>
        document.querySelector(".po-import-step__actions .po-btn-primary")
          ?.textContent || ""
    );
    if (label.includes("Import Matrix")) break;
    if (label.includes("Continue")) {
      await onReview.click();
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    break;
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-03-import-review.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    document.querySelector(".po-import-step__actions .po-btn-primary")?.click();
  });
  await page.waitForSelector(".po-matrix-table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-03-import-complete.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("Screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
