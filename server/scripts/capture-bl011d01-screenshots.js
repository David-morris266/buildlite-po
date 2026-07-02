/**
 * BL-011D.01 — Capture Payment Certificate Workspace screenshots.
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

async function mockApprovedSubcontractPo(page) {
  const mockPo = {
    poNumber: "PO-S-BL011D01",
    type: "S",
    supplierId: "supplier-screenshot-1",
    supplierSnapshot: { name: "ABC Brickwork Ltd" },
    supplierName: "ABC Brickwork Ltd",
    developmentId: "dev-screenshot-1",
    developmentName: "Test Site 1",
    developmentNumber: "0001",
    development: {
      id: "dev-screenshot-1",
      developmentName: "Test Site 1",
      developmentNumber: "0001",
      status: "planning",
      client: "ABC Homes",
    },
    status: "approved",
    approval: { status: "approved", decidedAt: new Date().toISOString() },
    subtotal: 50000,
    totals: { net: 50000, vat: 10000, gross: 60000 },
    title: "Brickwork Package",
    items: [
      {
        description: "Brickwork envelope",
        qty: 1,
        rate: 50000,
        amount: 50000,
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

async function seedPackageWithMatrix(page) {
  await page.evaluate(() => {
    const orderKey = "dev-screenshot-1::supplier-screenshot-1";
    const now = new Date().toISOString();

    localStorage.setItem(
      "buildlite_subcontract_packages_v1",
      JSON.stringify({
        [orderKey]: {
          orderKey,
          jobId: "dev-screenshot-1",
          supplierId: "supplier-screenshot-1",
          projectLabel: "Test Site 1",
          supplierLabel: "ABC Brickwork Ltd",
          developmentId: "dev-screenshot-1",
          developmentNumber: "0001",
          developmentName: "Test Site 1",
          createdAt: now,
          updatedAt: now,
          activity: [],
          certificates: [],
        },
      })
    );

    localStorage.setItem(
      "buildlite_order_matrices_v1",
      JSON.stringify({
        [orderKey]: {
          orderKey,
          layout: "plot-stage",
          stages: ["Foundations", "Superstructure"],
          plots: [
            { label: "1", values: [10000, 15000] },
            { label: "2", values: [10000, 15000] },
          ],
          updatedAt: now,
        },
      })
    );
  });
}

async function openCertificatesTab(page) {
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll(".po-package-tabs button")).find(
      (el) => el.textContent.trim() === "Certificates"
    );
    tab?.click();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await mockApprovedSubcontractPo(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await seedPackageWithMatrix(page);
  await page.reload({ waitUntil: "networkidle2" });

  await clickTab(page, "Payment Certificates");
  await page.waitForSelector(".po-subcontract-orders-page .po-data-table", {
    timeout: 15000,
  });

  await page.click(".po-subcontract-orders-page .po-data-table button");
  await page.waitForSelector(".po-package-workspace", { timeout: 15000 });
  await openCertificatesTab(page);
  await page.waitForSelector(".po-cert-workspace__empty", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-01-certificate-workspace-empty.png"),
    fullPage: true,
  });

  await page.click(".po-cert-workspace__empty .po-btn-primary");
  await page.waitForSelector(".po-cert-detail", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-01-certificate-detail-draft.png"),
    fullPage: true,
  });

  await page.click(".po-cert-detail__back");
  await page.waitForSelector(".po-cert-workspace__table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-01-certificate-workspace-list.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("BL-011D.01 screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
