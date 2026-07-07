/**
 * BL-012A — Purchase Ledger Import Foundation screenshots.
 * Includes development-scoped import + unknown cost code creation (refinement).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

const DEV_ID = "dev-ledger-screenshot-1";

const SAMPLE_CSV = `Job,Cost Code,Supplier,Date,Amount,Description,Invoice No,VAT
RIV-2401,BRK01,ABC Brickwork Ltd,03/07/2026,12500.00,Brickwork phase 1,INV-1001,2500.00
RIV-2401,PLM01,PlumbRight Ltd,05/07/2026,4200.00,First fix plumbing,INV-2204,840.00
CZ557,BRK01,Test Supplier,06/07/2026,1000.00,Wrong development contract,INV-999,200.00
RIV-2401,BRK01,ABC Brickwork Ltd,07/07/2026,,Missing amount row,INV-1001,0.00
`;

async function clickNavTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(document.querySelectorAll(".nav .tab")).find((el) =>
      el.textContent.includes(text)
    );
    tab?.click();
  }, label);
}

async function clickWorkspaceTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(
      document.querySelectorAll(".dev-workspace__tabs button")
    ).find((el) => el.textContent.trim() === text);
    tab?.click();
  }, label);
}

async function seedDevelopment(page) {
  await page.evaluate((devId) => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "buildlite_developments_v1",
      JSON.stringify([
        {
          id: devId,
          jobNumber: "0001",
          developmentName: "Test Site 1",
          client: "Harbour Homes Ltd",
          location: "Worcester",
          address: "14 Canal Wharf",
          postcode: "WR1 2AB",
          startDate: "2026-01-15",
          targetCompletion: "2027-06-30",
          status: "live",
          plotCount: 0,
          packageCount: 0,
          purchaseOrderCount: 0,
          certificateCount: 0,
          plotMaster: { plots: [], updatedAt: now },
          createdAt: now,
          updatedAt: now,
        },
      ])
    );
    localStorage.setItem(
      "buildlite_cvr_v1",
      JSON.stringify({
        [devId]: {
          activePeriodKey: "current",
          periods: {
            current: {
              costCentres: [],
              developmentNotes: "",
              updatedAt: now,
            },
          },
          updatedAt: now,
        },
      })
    );
    localStorage.removeItem("buildlite_purchase_ledgers_v1");
  }, DEV_ID);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const csvPath = path.join(os.tmpdir(), "buildlite-ledger-sample.csv");
  fs.writeFileSync(csvPath, SAMPLE_CSV, "utf8");

  const chromePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean);

  const executablePath = chromePaths.find((p) => fs.existsSync(p));

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: executablePath || undefined,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await seedDevelopment(page);
  await page.reload({ waitUntil: "networkidle2" });

  await clickNavTab(page, "Developments");
  await page.waitForSelector(".dev-list-page .po-data-table", { timeout: 15000 });
  await page.click(".dev-list-page .po-data-table button");
  await page.waitForSelector(".dev-workspace", { timeout: 15000 });

  await clickWorkspaceTab(page, "Ledger");
  await page.waitForSelector(".dev-ledger__empty", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-ledger-empty.png"),
    fullPage: true,
  });

  await page.click(".dev-ledger__empty .po-btn-primary");
  await page.waitForSelector(".dev-ledger-import", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-upload.png"),
    fullPage: true,
  });

  const input = await page.$(".po-import-dropzone__input");
  await input.uploadFile(csvPath);
  await page.waitForSelector(".dev-ledger-import__preview", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-preview.png"),
    fullPage: true,
  });

  await page.click(".po-import-step__actions .po-btn-primary");
  await page.waitForSelector(".po-import-mapping", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-mapping.png"),
    fullPage: true,
  });

  await page.click(".po-import-step__actions .po-btn-primary");
  await page.waitForSelector(".dev-ledger-import__summary", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-validation.png"),
    fullPage: true,
  });

  const createCheckbox = await page.$(".dev-ledger-import__create-cost-centres input");
  if (createCheckbox) {
    await createCheckbox.click();
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: path.join(OUT_DIR, "BL-012A-import-validation-create-cost-centres.png"),
      fullPage: true,
    });
  }

  await page.click(".po-import-step__actions .po-btn-primary");
  await page.waitForSelector(".po-import-step__actions .po-btn-primary", {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-confirm.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(".po-import-step__actions .po-btn-primary")
    );
    const importBtn = buttons.find((btn) =>
      btn.textContent.includes("Import Purchase Ledger")
    );
    importBtn?.click();
  });
  await page.waitForSelector(".dev-ledger-import", { timeout: 10000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("Import Complete"),
    { timeout: 10000 }
  );
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-complete.png"),
    fullPage: true,
  });

  await page.click(".po-import-step__actions .po-btn-primary");
  await page.waitForSelector(".dev-ledger__table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-ledger-populated.png"),
    fullPage: true,
  });

  await clickWorkspaceTab(page, "CVR");
  await page.waitForSelector(".dev-cvr", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-cvr-after-import.png"),
    fullPage: true,
  });

  await browser.close();
  fs.unlinkSync(csvPath);
  console.log("BL-012A screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
