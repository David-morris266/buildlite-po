/**
 * BL-011D.03 — Payment Certificate Approval & Locking screenshots.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const BASE_URL = process.env.PO_SCREENSHOT_URL || "http://127.0.0.1:4175";

const ORDER_KEY = "dev-screenshot-1::supplier-screenshot-1::brk01";

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
    poNumber: "PO-S-BL011D03",
    type: "S",
    supplierId: "supplier-screenshot-1",
    supplierSnapshot: { name: "ABC Brickwork Ltd" },
    supplierName: "ABC Brickwork Ltd",
    developmentId: "dev-screenshot-1",
    developmentName: "Test Site 1",
    developmentNumber: "0001",
    costCode: "BRK01",
    development: {
      id: "dev-screenshot-1",
      developmentName: "Test Site 1",
      developmentNumber: "0001",
      status: "planning",
      client: "ABC Homes",
    },
    status: "approved",
    approval: { status: "approved", decidedAt: new Date().toISOString() },
    subtotal: 125000,
    totals: { net: 125000, vat: 25000, gross: 150000 },
    title: "Brickwork Package",
    costRef: { costCode: "BRK01", developmentId: "dev-screenshot-1" },
    items: [
      {
        description: "Brickwork envelope",
        qty: 1,
        rate: 125000,
        amount: 125000,
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

async function seedPackageWithDraftCertificate(page) {
  await page.evaluate((orderKey) => {
    const now = new Date().toISOString();

    localStorage.setItem(
      "buildlite_subcontract_packages_v1",
      JSON.stringify({
        [orderKey]: {
          orderKey,
          scopeId: "dev-screenshot-1",
          jobId: "dev-screenshot-1",
          supplierId: "supplier-screenshot-1",
          costCode: "BRK01",
          projectLabel: "Test Site 1",
          supplierLabel: "ABC Brickwork Ltd",
          developmentId: "dev-screenshot-1",
          developmentNumber: "0001",
          developmentName: "Test Site 1",
          createdAt: now,
          updatedAt: now,
          activity: [],
          certificates: [
            {
              id: "cert-seed-1",
              certificateNumber: 1,
              status: "draft",
              certificateDate: "2026-07-03",
              createdBy: "Dave Morris",
              submittedBy: null,
              submittedAt: null,
              approvedBy: null,
              approvedAt: null,
              grossValue: null,
              netValue: null,
              progress: {
                "0::0": { thisCertificatePct: 60 },
                "0::1": { thisCertificatePct: 25 },
                "1::0": { thisCertificatePct: 100 },
              },
              auditHistory: [
                {
                  id: "audit-created-1",
                  action: "created",
                  actor: "Dave Morris",
                  at: "2026-07-03T09:41:00.000Z",
                },
              ],
              createdAt: "2026-07-03T09:41:00.000Z",
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
          stages: ["1st Lift", "2nd Lift", "Roof", "1st Fix", "Finals"],
          plots: [
            { label: "Plot 1", values: [8000, 8000, 6000, 5000, 3000] },
            { label: "Plot 2", values: [8000, 8000, 6000, 5000, 3000] },
            { label: "Plot 3", values: [8000, 8000, 6000, 5000, 3000] },
          ],
          updatedAt: now,
        },
      })
    );
  }, ORDER_KEY);
}

async function openCertificatesTab(page) {
  await page.evaluate(() => {
    const tab = Array.from(
      document.querySelectorAll(".po-package-tabs button")
    ).find((el) => el.textContent.trim() === "Certificates");
    tab?.click();
  });
}

async function openFirstCertificate(page, actionLabel = "Open") {
  await page.waitForSelector(".po-cert-workspace__table", { timeout: 10000 });
  await page.evaluate((label) => {
    const btn = Array.from(
      document.querySelectorAll(".po-cert-workspace__link")
    ).find((el) => el.textContent.trim() === label);
    btn?.click();
  }, actionLabel);
  await page.waitForSelector(".po-cert-detail", { timeout: 15000 });
}

async function navigateToCertificateWorkspace(page) {
  await clickTab(page, "Payment Certificates");
  await page.waitForSelector(".po-subcontract-orders-page .po-data-table", {
    timeout: 15000,
  });
  await page.click(".po-subcontract-orders-page .po-data-table button");
  await page.waitForSelector(".po-package-workspace", { timeout: 15000 });
  await openCertificatesTab(page);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  await mockApprovedSubcontractPo(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await seedPackageWithDraftCertificate(page);
  await page.reload({ waitUntil: "networkidle2" });

  await navigateToCertificateWorkspace(page);
  await page.waitForSelector(".po-cert-workspace__table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-certificate-list-draft.png"),
    fullPage: true,
  });

  await openFirstCertificate(page, "Open");
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-draft-submit-actions.png"),
    fullPage: true,
  });

  await page.click(".po-cert-detail__actions .po-btn-primary");
  await page.waitForSelector(".po-cert-delete.modal", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-submit-confirmation.png"),
    fullPage: false,
  });

  await page.click(".po-cert-delete.modal .po-btn-primary");
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-submitted-readonly.png"),
    fullPage: true,
  });

  await page.click(".po-cert-detail__actions .po-btn-primary");
  await page.waitForSelector(".po-cert-delete.modal", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-approve-lock-confirmation.png"),
    fullPage: false,
  });

  await page.click(".po-cert-delete.modal .po-btn-primary");
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-approved-locked.png"),
    fullPage: true,
  });

  await page.click(".po-cert-detail__back");
  await page.waitForSelector(".po-cert-workspace__table", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-certificate-list-approved.png"),
    fullPage: true,
  });

  await page.click(".po-cert-workspace__list-header .po-btn-primary");
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(OUT_DIR, "BL-011D-03-certificate-no-2-draft.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("BL-011D.03 screenshots saved to docs/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
