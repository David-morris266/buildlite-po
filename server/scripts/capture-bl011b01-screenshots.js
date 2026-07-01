/**
 * BL-011B.01 — Capture Subcontract Orders foundation screenshots.
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
  await new Promise((r) => setTimeout(r, 800));

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-01-subcontract-orders-list.png"),
    fullPage: true,
  });

  const hasAction = await page.evaluate(() =>
    Boolean(document.querySelector(".po-data-table .po-list-btn-primary"))
  );

  if (hasAction) {
    await page.evaluate(() => {
      document.querySelector(".po-data-table .po-list-btn-primary")?.click();
    });
    await page.waitForSelector(".po-matrix-page", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-011B-01-order-matrix-editor.png"),
      fullPage: true,
    });

    await page.evaluate(() => {
      document.querySelector(".po-btn-primary")?.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-011B-01-subcontract-orders-saved.png"),
      fullPage: true,
    });
  }

  await clickTab(page, "Purchase Orders");
  await page.waitForFunction(
    () => document.querySelector(".po-data-table tbody tr"),
    { timeout: 15000 }
  ).catch(() => null);

  const hasDrawerAction = await page.evaluate(() =>
    Boolean(document.querySelector(".po-data-table__actions .po-list-btn-primary"))
  );

  if (hasDrawerAction) {
    await page.evaluate(() => {
      document
        .querySelector(".po-data-table__actions .po-list-btn-primary")
        ?.click();
    });
    await page.waitForSelector(".po-drawer-header__number", { timeout: 10000 });
    await page.evaluate(() => {
      const body = document.querySelector(".po-drawer-body");
      if (body) body.scrollTop = body.scrollHeight;
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-011B-01-po-drawer-matrix.png"),
    });
  }

  await browser.close();
  console.log("Screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
