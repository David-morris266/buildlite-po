const listeners = new Set();

export function subscribeMasterDataChanged(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function notifyMasterDataChanged(scope = 'all') {
  for (const handler of listeners) {
    handler(scope);
  }
}
