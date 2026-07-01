/**
 * BL-009A.03 — Capture Development-aware Purchase Order screenshots.
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

async function clearDevelopments(page) {
  await page.evaluate(() => {
    localStorage.removeItem("buildlite_developments_v1");
  });
}

async function seedDevelopment(page) {
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "buildlite_developments_v1",
      JSON.stringify([
        {
          id: "dev-screenshot-1",
          jobNumber: "0001",
          developmentName: "Test Site 1",
          client: "ABC Homes",
          location: "Worcester",
          address: "14 Canal Wharf",
          postcode: "WR1 2AB",
          startDate: "",
          targetCompletion: "",
          status: "planning",
          plotCount: 30,
          packageCount: 0,
          purchaseOrderCount: 0,
          certificateCount: 0,
          plotMaster: {
            plots: Array.from({ length: 30 }, (_, index) => ({
              id: `plot-${index + 1}`,
              plotNumber: String(index + 1),
              houseType: "The Maple",
              bedrooms: 3,
              gia: 92.5,
              phase: "Phase 1",
              tenure: "Freehold",
              status: "Active",
              createdAt: now,
              updatedAt: now,
            })),
            updatedAt: now,
          },
          createdAt: now,
          updatedAt: now,
        },
      ])
    );
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await clearDevelopments(page);
  await clickTab(page, "New PO");
  await page.waitForSelector(".po-form-container", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-03-po-form-no-developments.png"),
    fullPage: true,
  });

  await seedDevelopment(page);
  await page.reload({ waitUntil: "networkidle2" });
  await clickTab(page, "New PO");
  await page.waitForSelector(".dev-po-select__input", { timeout: 15000 });
  await page.select(".dev-po-select__input", "dev-screenshot-1");
  await page.waitForSelector(".dev-po-summary", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-03-po-form-development-selected.png"),
    fullPage: true,
  });

  await clickTab(page, "Purchase Orders");
  await page.waitForSelector(".po-module-card, .po-empty-state", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-009A-03-po-list-development-column.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("BL-009A.03 screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
