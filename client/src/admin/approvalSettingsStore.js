import { readAdminStore, writeAdminStore } from './adminStorage';

export const APPROVAL_SETTINGS_KEY = 'buildlite_approval_settings_v1';

function defaultSettings() {
  return {
    purchaseOrders: {
      status: 'future',
      label: 'Future Module',
      description: 'Approval routing and limits for purchase orders will be configured here.',
    },
    paymentCertificates: {
      status: 'future',
      label: 'Future Module',
      description: 'Certificate approval thresholds and delegated authority will be configured here.',
    },
    cvrs: {
      status: 'future',
      label: 'Future Module',
      description: 'CVR submission and sign-off rules will be configured here.',
    },
    updatedAt: null,
  };
}

export function getApprovalSettings() {
  return {
    ...defaultSettings(),
    ...readAdminStore(APPROVAL_SETTINGS_KEY, {}),
  };
}

export function saveApprovalSettings(patch = {}) {
  const next = {
    ...getApprovalSettings(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAdminStore(APPROVAL_SETTINGS_KEY, next);
  return next;
}
