import { createOrGetJob, createOrGetSupplier } from "../api";

function paymentTermsToDays(paymentTerms) {
  if (paymentTerms === "on_receipt") return 0;
  const n = Number.parseInt(String(paymentTerms || "30"), 10);
  return Number.isFinite(n) ? n : 30;
}

/**
 * Create (or reuse) supplier and optional job when Step 5 completes.
 * Stores returned IDs on firstOrder for PO launch continuity.
 */
export async function provisionFirstOrderRecords(firstOrder, defaults) {
  const supplierName = String(firstOrder?.supplierName || "").trim();
  let next = { ...firstOrder };

  if (supplierName) {
    const unchanged =
      next.supplierId &&
      String(next.supplierName || "").trim() === supplierName;

    if (!unchanged) {
      const supplier = await createOrGetSupplier({
        name: supplierName,
        contactEmail: String(firstOrder?.supplierEmail || "").trim(),
        contactPhone: String(firstOrder?.supplierPhone || "").trim(),
        termsDays: paymentTermsToDays(defaults?.paymentTerms),
      });
      next = {
        ...next,
        supplierId: supplier.id,
        supplierName: supplier.name || supplierName,
      };
    }
  } else {
    next = { ...next, supplierId: "" };
  }

  const jobName = String(next?.jobName || "").trim();
  if (jobName) {
    const jobCode = String(next?.jobCode || "").trim();
    const unchanged =
      next.jobId &&
      String(next.jobName || "").trim() === jobName &&
      String(next.jobCode || "").trim() === jobCode;

    if (!unchanged) {
      const job = await createOrGetJob({
        name: jobName,
        jobCode,
        jobNumber: jobCode,
        siteAddress: String(next?.jobAddress || "").trim(),
      });
      next = {
        ...next,
        jobId: job.id,
        jobName: job.name || jobName,
        jobCode: job.jobCode || job.jobNumber || jobCode,
      };
    }
  } else {
    next = { ...next, jobId: "" };
  }

  return next;
}
