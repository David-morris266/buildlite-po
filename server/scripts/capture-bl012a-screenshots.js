/**
 * BL-012A — Purchase Ledger Import Foundation screenshots.
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
OTHER-SITE,BRK01,Test Supplier,06/07/2026,1000.00,Wrong development,INV-999,200.00
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
          jobNumber: "RIV-2401",
          developmentName: "Riverside Quarter",
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
  }, DEV_ID);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const csvPath = path.join(os.tmpdir(), "buildlite-ledger-sample.csv");
  fs.writeFileSync(csvPath, SAMPLE_CSV, "utf8");

  const browser = await puppeteer.launch({ headless: "new" });
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

  await page.click(".po-import-step__actions .po-btn-primary");
  await page.waitForSelector(".po-import-step__actions .po-btn-primary", {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-import-complete.png"),
    fullPage: true,
  });

  await page.evaluate((devId) => {
    const now = new Date().toISOString();
    localStorage.setItem(
      "buildlite_purchase_ledgers_v1",
      JSON.stringify({
        [devId]: {
          transactions: [
            {
              id: "txn-shot-1",
              developmentId: devId,
              supplier: "ABC Brickwork Ltd",
              supplierCode: "SUP-001",
              costCode: "BRK01",
              description: "Brickwork phase 1",
              transactionDate: "2026-07-03",
              invoiceNumber: "INV-1001",
              netAmount: 12500,
              vat: 2500,
              grossAmount: 15000,
              source: "COINS Purchase Ledger",
              documentType: "Invoice",
              importBatch: "batch-shot-1",
              createdAt: now,
              importedBy: "Commercial Manager",
            },
            {
              id: "txn-shot-2",
              developmentId: devId,
              supplier: "PlumbRight Ltd",
              supplierCode: "SUP-014",
              costCode: "PLM01",
              description: "First fix plumbing",
              transactionDate: "2026-07-05",
              invoiceNumber: "INV-2204",
              netAmount: 4200,
              vat: 840,
              grossAmount: 5040,
              source: "COINS Purchase Ledger",
              documentType: "Invoice",
              importBatch: "batch-shot-1",
              createdAt: now,
              importedBy: "Commercial Manager",
            },
          ],
          importHistory: [
            {
              id: "import-shot-1",
              importDate: now,
              importedBy: "Commercial Manager",
              rowsImported: 2,
              rowsRejected: 2,
              totalValue: 16700,
              fileName: "purchase-ledger-july.csv",
              importProfile: "COINS Purchase Ledger",
              importBatch: "batch-shot-1",
            },
          ],
          importProfiles: [],
          actualCostsByCostCode: { brk01: 12500, plm01: 4200 },
          updatedAt: now,
        },
      })
    );
  }, DEV_ID);

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await clickNavTab(page, "Developments");
  await page.waitForSelector(".dev-list-page .po-data-table", { timeout: 15000 });
  await page.click(".dev-list-page .po-data-table button");
  await page.waitForSelector(".dev-workspace", { timeout: 15000 });
  await clickWorkspaceTab(page, "Ledger");
  await page.waitForSelector(".dev-ledger__table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012A-ledger-populated.png"),
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
