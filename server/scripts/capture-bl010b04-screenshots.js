/**
 * BL-010B.04 — Capture PO review drawer screenshots.
 * Usage: node scripts/capture-bl010b04-screenshots.js
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:5173";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });

  const listTab = await page.waitForSelector(
    '.nav .tab:nth-of-type(2)'
  );
  await listTab.click();

  await page.waitForFunction(
    () =>
      document.querySelector(".po-data-table tbody tr") ||
      document.querySelector(".po-empty-state") ||
      document.querySelector(".po-list-error"),
    { timeout: 15000 }
  );

  const debug = await page.evaluate(() => ({
    activeTab: document.querySelector(".nav .tab.active")?.textContent?.trim(),
    rowCount: document.querySelectorAll(".po-data-table tbody tr").length,
    empty: Boolean(document.querySelector(".po-empty-state")),
    error: document.querySelector(".po-list-error")?.textContent || "",
    loading: Boolean(document.querySelector(".po-loading")),
    hasTable: Boolean(document.querySelector(".po-data-table")),
  }));
  console.log("Page state:", debug);

  if (!debug.rowCount) {
    fs.writeFileSync(
      path.join(OUT_DIR, "BL-010B-04-NO-DATA.txt"),
      "No PO rows available for drawer screenshot.\n"
    );
    console.warn("No PO data — skipped drawer screenshot.");
    await browser.close();
    return;
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-010B-04-po-list-after.png"),
    fullPage: true,
  });

  await page.click(".po-data-table__actions .po-list-btn-primary");
  await page.waitForSelector(".po-drawer-header__number", { timeout: 10000 });

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-010B-04-po-drawer-after.png"),
  });

  await browser.close();
  console.log("Screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
