/**
 * BL-033D.x.2 — Template mapping reads the server Cost Code Master only.
 * Uses the banked /api/cost-codes cache path. No localStorage fallback.
 * Option identity is the canonical customer code.
 */

import { toCostCodeSelectShape } from './costCodeMasterStore';
import { ensureCostCodesReady } from './costCodeServerCache';

export async function listCostCodesForTemplateMapping() {
  const rows = await ensureCostCodesReady();
  return (rows || [])
    .filter((row) => row.active !== false)
    .map(toCostCodeSelectShape);
}
