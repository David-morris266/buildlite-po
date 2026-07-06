/**
 * BL-012B — CVR Foundation screenshots.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

const DEV_ID = "dev-cvr-screenshot-1";

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

async function seedData(page) {
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

    localStorage.setItem(
      "buildlite_cvr_v1",
      JSON.stringify({
        [devId]: {
          activePeriodKey: "current",
          periods: {
            current: {
              costCentres: [
                {
                  id: "cc-brk01",
                  costCodeKey: "brk01",
                  costCodeLabel: "BRK01 — Brickwork",
                  originalBudget: 180000,
                  currentBudget: 175000,
                  forecastFinalCost: 168000,
                  commercialNotes:
                    "Brickwork package currently ahead of programme.",
                  forecastNotes:
                    "Expect £12,000 saving due to revised scaffold sequence.",
                  active: true,
                  createdAt: now,
                  updatedAt: now,
                },
                {
                  id: "cc-plm01",
                  costCodeKey: "plm01",
                  costCodeLabel: "PLM01 — Plumbing",
                  originalBudget: 92000,
                  currentBudget: 92000,
                  forecastFinalCost: 94500,
                  commercialNotes: "",
                  forecastNotes: "Allowance for additional soil pipe runs.",
                  active: true,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              developmentNotes:
                "Month-end review: brickwork tracking under budget, plumbing marginally over forecast.",
              updatedAt: now,
            },
          },
          updatedAt: now,
        },
      })
    );

    localStorage.setItem(
      "buildlite_purchase_ledgers_v1",
      JSON.stringify({
        [devId]: {
          transactions: [
            {
              id: "txn-cvr-1",
              developmentId: devId,
              supplier: "ABC Brickwork Ltd",
              costCode: "BRK01",
              description: "Brickwork phase 1",
              transactionDate: "2026-07-03",
              invoiceNumber: "INV-1001",
              netAmount: 62000,
              source: "Purchase Ledger",
              createdAt: now,
              importedBy: "Commercial Manager",
            },
            {
              id: "txn-cvr-2",
              developmentId: devId,
              supplier: "PlumbRight Ltd",
              costCode: "PLM01",
              description: "First fix plumbing",
              transactionDate: "2026-07-05",
              invoiceNumber: "INV-2204",
              netAmount: 28500,
              source: "Purchase Ledger",
              createdAt: now,
              importedBy: "Commercial Manager",
            },
          ],
          importHistory: [],
          importProfiles: [],
          actualCostsByCostCode: { brk01: 62000, plm01: 28500 },
          updatedAt: now,
        },
      })
    );
  }, DEV_ID);
}

async function mockApprovedPos(page) {
  const mockPos = [
    {
      poNumber: "PO-S-CVR-01",
      type: "S",
      supplierId: "supplier-brick-1",
      supplierSnapshot: { name: "ABC Brickwork Ltd" },
      supplierName: "ABC Brickwork Ltd",
      developmentId: DEV_ID,
      developmentName: "Riverside Quarter",
      developmentNumber: "RIV-2401",
      development: {
        id: DEV_ID,
        developmentName: "Riverside Quarter",
        developmentNumber: "RIV-2401",
      },
      status: "approved",
      approval: { status: "approved", decidedAt: new Date().toISOString() },
      subtotal: 125000,
      totals: { net: 125000, gross: 150000 },
      costRef: { costCode: "BRK01 — Brickwork", developmentId: DEV_ID },
      items: [{ costCode: "BRK01", amount: 125000 }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      poNumber: "PO-S-CVR-02",
      type: "S",
      supplierId: "supplier-plumb-1",
      supplierSnapshot: { name: "PlumbRight Ltd" },
      supplierName: "PlumbRight Ltd",
      developmentId: DEV_ID,
      developmentName: "Riverside Quarter",
      developmentNumber: "RIV-2401",
      development: {
        id: DEV_ID,
        developmentName: "Riverside Quarter",
        developmentNumber: "RIV-2401",
      },
      status: "approved",
      approval: { status: "approved", decidedAt: new Date().toISOString() },
      subtotal: 48000,
      totals: { net: 48000, gross: 57600 },
      costRef: { costCode: "PLM01 — Plumbing", developmentId: DEV_ID },
      items: [{ costCode: "PLM01", amount: 48000 }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  await page.evaluateOnNewDocument((payload) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/api/po") && (url.endsWith("/api/po") || url.includes("/api/po?"))) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, mockPos);
}

async function openCvrTab(page) {
  await clickNavTab(page, "Developments");
  await page.waitForSelector(".dev-list-page .po-data-table", { timeout: 15000 });
  await page.click(".dev-list-page .po-data-table button");
  await page.waitForSelector(".dev-workspace", { timeout: 15000 });
  await clickWorkspaceTab(page, "CVR");
  await page.waitForSelector(".dev-cvr", { timeout: 15000 });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

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

  await mockApprovedPos(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await seedData(page);
  await page.reload({ waitUntil: "networkidle2" });

  await openCvrTab(page);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012B-cvr-workspace.png"),
    fullPage: true,
  });

  await page.click(".dev-cvr__row-link");
  await page.waitForSelector(".dev-cvr-drawer", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012B-cost-centre-drawer.png"),
    fullPage: false,
  });

  await page.click(".po-drawer-header__close");
  await new Promise((r) => setTimeout(r, 400));

  await page.click(".dev-cvr__header .po-btn-primary");
  await page.waitForSelector(".dev-cvr-add", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-012B-add-cost-centre.png"),
    fullPage: false,
  });

  await browser.close();
  console.log("BL-012B screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
