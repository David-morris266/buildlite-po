function isApprovedPo(po) {
  if (!po || po.archived === true) return false;
  const approval = String(po.approval?.status || "").toLowerCase();
  const status = String(po.status || "").toLowerCase();
  return approval === "approved" || status === "approved";
}

function getPoCommittedNet(po) {
  const value = Number(po?.subtotal ?? po?.totals?.net ?? po?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getPoNumber(po) {
  return po?.poNumber || po?.po_number || null;
}

module.exports = { isApprovedPo, getPoCommittedNet, getPoNumber };
