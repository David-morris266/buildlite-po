/**
 * BL-011D.02B — Capture valuation grid UX polish screenshots.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4173";

const STAGES = ["1st Lift", "2nd Lift", "Roof", "1st Fix", "Finals"];
const PLOT_COUNT = 24;

async function clickTab(page, label) {
  await page.evaluate((text) => {
    const tab = Array.from(document.querySelectorAll(".nav .tab")).find((el) =>
      el.textContent.includes(text)
    );
    tab?.click();
  }, label);
}

async function mockApprovedSubcontractPo(page) {
  const mockPo = {
    poNumber: "PO-S-BL011D02B",
    type: "S",
    supplierId: "supplier-screenshot-1",
    supplierSnapshot: { name: "ABC Brickwork Ltd" },
    supplierName: "ABC Brickwork Ltd",
    developmentId: "dev-screenshot-1",
    developmentName: "Riverside Phase 2",
    developmentNumber: "0001",
    development: {
      id: "dev-screenshot-1",
      developmentName: "Riverside Phase 2",
      developmentNumber: "0001",
      status: "planning",
      client: "ABC Homes",
    },
    status: "approved",
    approval: { status: "approved", decidedAt: new Date().toISOString() },
    subtotal: 960000,
    totals: { net: 960000, vat: 192000, gross: 1152000 },
    title: "Brickwork Package",
    costRef: { costCode: "BRK01", developmentId: "dev-screenshot-1" },
    items: [
      {
        description: "Brickwork envelope",
        qty: 1,
        rate: 960000,
        amount: 960000,
        costCode: "BRK01",
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await page.evaluateOnNewDocument((payload) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      const isPoList =
        url.includes("/api/po") &&
        (url.endsWith("/api/po") || url.includes("/api/po?"));
      if (isPoList) {
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, mockPo);
}

function buildPlots() {
  const plots = [];
  for (let i = 1; i <= PLOT_COUNT; i += 1) {
    plots.push({
      label: String(i),
      values: [8000, 8000, 6000, 5000, 3000],
    });
  }
  return plots;
}

function buildProgress() {
  const progress = {};
  for (let plot = 0; plot < PLOT_COUNT; plot += 1) {
    for (let stage = 0; stage < STAGES.length; stage += 1) {
      const pattern = (plot + stage) % 5;
      let pct = 0;
      if (pattern === 0) pct = 100;
      else if (pattern === 1) pct = 75;
      else if (pattern === 2) pct = 40;
      else if (pattern === 3) pct = 25;
      if (pct > 0) {
        progress[`${plot}::${stage}`] = { thisCertificatePct: pct };
      }
    }
  }
  return progress;
}

async function seedPackageWithMatrix(page) {
  await page.evaluate(
    ({ stages, plots, progress }) => {
      const orderKey = "dev-screenshot-1::supplier-screenshot-1::brk01";
      const now = new Date().toISOString();

      localStorage.setItem(
        "buildlite_subcontract_packages_v1",
        JSON.stringify({
          [orderKey]: {
            orderKey,
            scopeId: "dev-screenshot-1",
            supplierId: "supplier-screenshot-1",
            costCode: "BRK01",
            projectLabel: "Riverside Phase 2",
            supplierLabel: "ABC Brickwork Ltd",
            developmentId: "dev-screenshot-1",
            developmentNumber: "0001",
            developmentName: "Riverside Phase 2",
            createdAt: now,
            updatedAt: now,
            activity: [],
            certificates: [
              {
                id: "cert-seed-02b",
                certificateNumber: 1,
                status: "draft",
                certificateDate: "2026-06-01",
                createdBy: "Commercial Manager",
                approvedBy: null,
                grossValue: null,
                netValue: null,
                progress,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        })
      );

      localStorage.setItem(
        "buildlite_order_matrices_v1",
        JSON.stringify({
          [orderKey]: {
            orderKey,
            layout: "plot-stage",
            stages,
            plots,
            updatedAt: now,
          },
        })
      );
    },
    { stages: STAGES, plots: buildPlots(), progress: buildProgress() }
  );
}

async function openCertificatesTab(page) {
  await page.evaluate(() => {
    const tab = Array.from(
      document.querySelectorAll(".po-package-tabs button")
    ).find((el) => el.textContent.trim() === "Certificates");
    tab?.click();
  });
}

async function openCertificateDetail(page) {
  await clickTab(page, "Payment Certificates");
  await page.waitForSelector(".po-subcontract-orders-page .po-data-table", {
    timeout: 15000,
  });
  await page.click(".po-subcontract-orders-page .po-data-table button");
  await page.waitForSelector(".po-package-workspace", { timeout: 15000 });
  await openCertificatesTab(page);
  await page.waitForSelector(".po-cert-workspace__table", { timeout: 10000 });
  await page.click(".po-cert-workspace__link");
  await page.waitForSelector(".po-cert-grid__table", { timeout: 15000 });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  await mockApprovedSubcontractPo(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await seedPackageWithMatrix(page);
  await page.reload({ waitUntil: "networkidle2" });

  await openCertificateDetail(page);
  await page.click(".po-cert-grid__cell:nth-child(3)");
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-02B-floating-toolbar-status-bar.png"),
    fullPage: false,
  });

  await page.evaluate(() => {
    const cell = document.querySelector(".po-cert-grid__cell:nth-child(3)");
    cell?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  await page.waitForSelector(".po-cert-grid__detail-panel", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-02B-stage-details-panel.png"),
    fullPage: false,
  });

  await page.click(".po-cert-grid__toolbar-btn:nth-child(2)");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-02B-progress-chips.png"),
    fullPage: false,
  });

  await browser.close();
  console.log("BL-011D.02B screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
