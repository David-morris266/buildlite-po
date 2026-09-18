import { listVariationAccount } from '../api/variationAccounts';

const searchable = value => String(value ?? '').toLocaleLowerCase('en-GB');

export async function loadDevelopmentVariationAccount(packages = []) {
  const unique = [...new Map(packages.filter(pkg => pkg?.packageUuid || pkg?.id).map(pkg => [pkg.packageUuid || pkg.id, pkg])).values()];
  const results = await Promise.all(unique.map(async pkg => ({ pkg, items: await listVariationAccount(pkg.packageUuid || pkg.id) })));
  return results.flatMap(({ pkg, items }) => items.map(item => ({
    ...item,
    package: pkg,
    supplier: pkg.supplierLabel || pkg.supplierName || pkg.supplier || '—',
    packageLabel: pkg.packageName || pkg.packageReference || pkg.trade || pkg.description || pkg.poNumber || pkg.purchaseOrderNumber || null,
    costCode: item.costCode || pkg.costCode || '—',
  })));
}

export function filterDevelopmentVariationAccount(items, query) {
  const needle = searchable(query).trim();
  if (!needle) return items;
  return items.filter(item => [item.reference, item.description, item.supplier, item.packageLabel, item.costCode].some(value => searchable(value).includes(needle)));
}
