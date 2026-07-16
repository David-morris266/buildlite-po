/**
 * BL-016F.4 — Setup wizard client defaults for First Development.
 */

import { getCompanySettings } from '../admin/companyStore';
import { listClients } from '../admin/clientStore';

export function getDefaultCompanyClientName(companyDraft = {}) {
  const settings = getCompanySettings();
  return String(
    settings.companyName
    || settings.tradingName
    || companyDraft.companyName
    || companyDraft.tradingName
    || ''
  ).trim();
}

export function resolveSetupClientDefault(companyDraft = {}) {
  const clients = listClients();
  if (clients.length > 1) return '';
  if (clients.length === 1) return clients[0].name;
  return getDefaultCompanyClientName(companyDraft);
}

export function listSetupClientOptions(companyDraft = {}) {
  const clients = listClients();
  if (clients.length > 1) {
    return clients.map((client) => ({
      value: client.name,
      label: client.name,
    }));
  }

  const defaultName = clients[0]?.name || getDefaultCompanyClientName(companyDraft);
  if (!defaultName) return [];

  return [{ value: defaultName, label: defaultName }];
}

export function shouldUseSetupClientDropdown() {
  return listClients().length > 1;
}
