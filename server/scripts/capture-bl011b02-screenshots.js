/**
 * BL-011B.02 — Capture Order Matrix Editor screenshots.
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

  const hasOrder = await page.evaluate(() =>
    Boolean(document.querySelector(".po-data-table .po-list-btn-primary"))
  );

  if (!hasOrder) {
    fs.writeFileSync(
      path.join(OUT_DIR, "BL-011B-02-NO-DATA.txt"),
      "No Subcontract Order available — approve a Subcontract PO (type S) and re-run.\n"
    );
    console.warn("No subcontract order — limited screenshots.");
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-011B-02-subcontract-orders-empty.png"),
      fullPage: true,
    });
    await browser.close();
    return;
  }

  await page.evaluate(() => {
    document.querySelector(".po-data-table .po-list-btn-primary")?.click();
  });
  await page.waitForSelector(".po-matrix-page", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-02-order-matrix-editor.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    document.querySelector(".po-btn-primary")?.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  await page.type("#matrix-row-" + (await page.evaluate(() => {
    const input = document.querySelector('[id^="matrix-row-"][id$="-description"]');
    return input?.id?.replace("-description", "") || "";
  })) + "-description", "Earthworks", { delay: 20 }).catch(() => {});

  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011B-02-order-matrix-unsaved.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("Screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
