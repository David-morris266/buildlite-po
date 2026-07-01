/**
 * BL-011C.01 — Capture Subcontract Package Workspace screenshots.
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

async function openFirstPackage(page) {
  const opened = await page.evaluate(() => {
    const btn = document.querySelector(
      ".po-subcontract-orders-page .po-data-table .po-list-btn-primary"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) return false;
  await page.waitForSelector(".po-package-workspace", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await clickTab(page, "Payment Certificates");
  await page.waitForFunction(
    () =>
      document.querySelector(".po-subcontract-orders-page") ||
      document.querySelector(".po-empty-state"),
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 600));

  const hasPackage = await openFirstPackage(page);
  if (!hasPackage) {
    console.warn("No subcontract package found — skipping workspace screenshots.");
    await browser.close();
    return;
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011C-01-package-overview.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll(".po-package-tabs__tab")).find(
      (el) => el.textContent.trim() === "Order Matrix"
    );
    tab?.click();
  });
  await page.waitForSelector(".po-matrix-empty--housebuilder, .po-matrix-imported", {
    timeout: 10000,
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011C-02-housebuilder-matrix-empty.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll(".po-package-tabs__tab")).find(
      (el) => el.textContent.trim() === "Certificates"
    );
    tab?.click();
  });
  await page.waitForSelector(".po-package-placeholder", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011C-01-package-certificates-placeholder.png"),
    fullPage: true,
  });

  await clickTab(page, "Purchase Orders");
  await page.waitForFunction(
    () => document.querySelector(".po-data-table tbody tr"),
    { timeout: 15000 }
  ).catch(() => null);

  const openedDrawer = await page.evaluate(() => {
    const btn = document.querySelector(
      ".po-data-table__actions .po-list-btn-primary, .po-data-table__actions button"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (openedDrawer) {
    await page.waitForSelector(".po-drawer-section--package", { timeout: 10000 }).catch(
      () => null
    );
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-011C-01-po-drawer-open-package.png"),
      fullPage: false,
    });
  }

  await browser.close();
  console.log("BL-011C.01 screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
