import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';
import { notifyMasterDataChanged } from './masterDataEvents';

export const USER_MASTER_KEY = 'buildlite_users_master_v1';

const DEFAULT_USERS = [
  {
    id: 'user-commercial-manager',
    name: 'Commercial Manager',
    role: 'Commercial Manager',
    approvalRights: 'Purchase Orders, Payment Certificates, CVRs',
    active: true,
  },
];

function defaultStore() {
  return { users: DEFAULT_USERS, updatedAt: null };
}

export function listUsers() {
  const store = readAdminStore(USER_MASTER_KEY, defaultStore());
  return store.users?.length ? store.users : DEFAULT_USERS;
}

function saveUsers(users) {
  const next = { users, updatedAt: new Date().toISOString() };
  writeAdminStore(USER_MASTER_KEY, next);
  notifyMasterDataChanged('users');
  return next;
}

export function addUser(payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, errors: ['Name is required.'] };

  const users = listUsers();
  const record = {
    id: newAdminId('user'),
    name,
    role: String(payload.role || 'Viewer').trim(),
    approvalRights: String(payload.approvalRights || 'None').trim(),
    active: payload.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveUsers([...users, record]);
  return { ok: true, user: record };
}

export function updateUser(id, patch = {}) {
  const users = listUsers();
  const index = users.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, errors: ['User not found.'] };

  const next = {
    ...users[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const updated = [...users];
  updated[index] = next;
  saveUsers(updated);
  return { ok: true, user: next };
}
