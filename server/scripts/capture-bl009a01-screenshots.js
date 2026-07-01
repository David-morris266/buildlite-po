/**
 * BL-009A — Capture Development Setup and Workspace screenshots.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

async function clickTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(document.querySelectorAll(".nav .tab")).find((el) =>
      el.textContent.includes(text)
    );
    tab?.click();
  }, label);
}

async function fillDevelopmentForm(page) {
  const values = [
    "JOB-2401",
    "Riverside Quarter",
    "Harbour Homes Ltd",
    "Worcester",
    "14 Canal Wharf",
    "WR1 2AB",
  ];
  const inputs = await page.$$(".dev-form__field input");
  for (let i = 0; i < values.length && i < inputs.length; i += 1) {
    await inputs[i].click({ clickCount: 3 });
    await inputs[i].type(values[i], { delay: 20 });
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await clickTab(page, "Developments");
  await page.waitForSelector(".dev-list-page", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-01-developments-list-empty.png"),
    fullPage: true,
  });

  await page.click(".dev-list-page__action, .po-empty-state .po-btn-primary");
  await page.waitForSelector(".dev-form-page", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-01-new-development-form.png"),
    fullPage: true,
  });

  await fillDevelopmentForm(page);
  await page.click(".dev-form__footer .po-btn-primary");
  await page.waitForSelector(".dev-workspace", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-01-development-workspace.png"),
    fullPage: true,
  });

  await page.click(".dev-workspace__back");
  await page.waitForSelector(".dev-list-page .po-data-table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-01-developments-list.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("BL-009A screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
