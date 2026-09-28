const { findDevelopmentById, updateDevelopment } = require('./developmentRepository');

const SALES_STATUSES = new Set([
  'Available',
  'Reserved',
  'Exchanged',
  'Completed',
  'Cancelled',
]);

function fail(status, message, extra = {}) {
  return { ok: false, status, message, ...extra };
}

function normalizeMoney(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) !== amount * 100) {
    return null;
  }
  return amount;
}

async function applySalesRegisterImport(clientId, developmentId, body = {}, auth = {}) {
  const expectedVersion = Number(body.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return fail(400, 'A valid Development version is required.');
  }
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return fail(400, 'At least one reviewed Sales Register row is required.');
  }

  const development = await findDevelopmentById(clientId, developmentId);
  if (!development) return fail(404, 'Development not found.');
  if (development.version !== expectedVersion) {
    return fail(409, 'The Development changed after this import was reviewed. Refresh and review the Sales Register again.', {
      code: 'VERSION_CONFLICT',
      development,
    });
  }

  const plots = development.plotMaster?.plots;
  if (!Array.isArray(plots)) return fail(409, 'Plot Master is not available for this Development.');
  const byId = new Map(plots.map((plot) => [String(plot.id), plot]));
  const seenIds = new Set();
  const seenNumbers = new Set();
  const normalized = [];

  for (const [index, update] of body.updates.entries()) {
    const plotId = String(update?.plotId || '').trim();
    const plotNumber = String(update?.plotNumber || '').trim();
    const target = byId.get(plotId);
    if (!plotId || !target) return fail(400, `Row ${index + 1} does not match an existing Plot Master identity.`);
    if (String(target.plotNumber || '').trim() !== plotNumber) {
      return fail(409, `Plot identity changed for ${plotNumber || plotId}. Refresh and review the import again.`);
    }
    const numberKey = plotNumber.toLocaleLowerCase('en-GB');
    if (seenIds.has(plotId) || seenNumbers.has(numberKey)) {
      return fail(400, `Plot ${plotNumber} appears more than once in the reviewed import.`);
    }
    seenIds.add(plotId);
    seenNumbers.add(numberKey);

    const next = { ...target };
    if (Object.prototype.hasOwnProperty.call(update, 'revenueStatus')) {
      if (!SALES_STATUSES.has(update.revenueStatus)) {
        return fail(400, `Plot ${plotNumber} has an unsupported Sales Status.`);
      }
      next.revenueStatus = update.revenueStatus;
    }
    if (Object.prototype.hasOwnProperty.call(update, 'sellingPrice')) {
      const sellingPrice = normalizeMoney(update.sellingPrice);
      if (sellingPrice == null) return fail(400, `Plot ${plotNumber} has an invalid Selling Price.`);
      next.sellingPrice = sellingPrice;
    }
    if ((next.revenueStatus === 'Exchanged' || next.revenueStatus === 'Completed') && !(Number(next.sellingPrice) > 0)) {
      return fail(400, `Plot ${plotNumber} requires a positive Selling Price for ${next.revenueStatus} status.`);
    }
    normalized.push(next);
  }

  const updatesById = new Map(normalized.map((plot) => [String(plot.id), plot]));
  const now = new Date().toISOString();
  const plotMaster = {
    ...development.plotMaster,
    plots: plots.map((plot) => updatesById.get(String(plot.id)) || plot),
    updatedAt: now,
    lastSalesRegisterImport: {
      appliedAt: now,
      appliedBy: auth.displayName || null,
      appliedByUserId: auth.userId || null,
      appliedByMembershipId: auth.membershipId || null,
      fileName: String(body.fileName || '').trim() || null,
      worksheet: String(body.worksheet || '').trim() || null,
      updatedPlots: normalized.length,
    },
  };
  const result = await updateDevelopment(clientId, developmentId, { plotMaster }, expectedVersion, {
    actor: auth.displayName || null,
  });
  if (!result.ok) return result;
  return { ok: true, status: 200, development: result.development, updatedPlots: normalized.length };
}

module.exports = { SALES_STATUSES, applySalesRegisterImport };
