import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';
import { notifyMasterDataChanged } from './masterDataEvents';

export const CLIENT_MASTER_KEY = 'buildlite_clients_master_v1';

function defaultStore() {
  return { clients: [], updatedAt: null };
}

export function listClients() {
  const store = readAdminStore(CLIENT_MASTER_KEY, defaultStore());
  return store.clients || [];
}

function saveClients(clients) {
  const next = { clients, updatedAt: new Date().toISOString() };
  writeAdminStore(CLIENT_MASTER_KEY, next);
  notifyMasterDataChanged('clients');
  return next;
}

export function addClient(payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, errors: ['Client name is required.'] };

  const clients = listClients();
  const record = {
    id: newAdminId('client'),
    name,
    address: String(payload.address || '').trim(),
    contact: String(payload.contact || '').trim(),
    active: payload.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveClients([...clients, record]);
  return { ok: true, client: record };
}

export function updateClient(id, patch = {}) {
  const clients = listClients();
  const index = clients.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, errors: ['Client not found.'] };

  const next = {
    ...clients[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const updated = [...clients];
  updated[index] = next;
  saveClients(updated);
  return { ok: true, client: next };
}
