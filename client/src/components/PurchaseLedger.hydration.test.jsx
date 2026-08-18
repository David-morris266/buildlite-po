/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const ledgerAuthorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../ledger/ledgerAuthority', () => ({
  isLedgerServerAuthorityEnabled: () => ledgerAuthorityEnabled.value,
}));

vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  buildServerLedgerTransactionFixture,
  resetLedgerApiStore,
  seedMockLedgerTransactions,
  setLedgerListDelay,
} from '../test/mockPurchaseLedgerApi';
import { __resetLedgerServerCacheForTests } from '../ledger/ledgerServerCache';
import PurchaseLedger from './PurchaseLedger';

const DEV = {
  id: 'dev-ledger-ui',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
};

describe('PurchaseLedger hydration (BL-031B)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    ledgerAuthorityEnabled.value = true;
    __resetLedgerServerCacheForTests();
    resetLedgerApiStore();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('shows loading then loaded transactions', async () => {
    setLedgerListDelay(40);
    seedMockLedgerTransactions(DEV.id, [
      buildServerLedgerTransactionFixture({
        developmentId: DEV.id,
        supplier: 'Wipe It Cleaners',
        invoiceNumber: 'INV-88',
        netAmount: 1000,
      }),
    ]);

    await act(async () => {
      root.render(<PurchaseLedger development={DEV} />);
    });

    expect(container.textContent).toContain('Loading ledger data…');
    expect(container.textContent).not.toContain('No ledger transactions have been imported');
    expect(container.textContent).not.toContain('£0.00');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    await flush();

    expect(container.textContent).toContain('Wipe It Cleaners');
    expect(container.textContent).toContain('INV-88');
    expect(container.textContent).not.toContain('Loading ledger data…');
  });

  it('shows genuine empty ledger only after load', async () => {
    setLedgerListDelay(20);

    await act(async () => {
      root.render(<PurchaseLedger development={DEV} />);
    });
    expect(container.textContent).toContain('Loading ledger data…');
    expect(container.textContent).not.toContain('No ledger transactions have been imported');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await flush();

    expect(container.textContent).toContain('No ledger transactions have been imported');
    expect(container.textContent).not.toContain('Loading ledger data…');
  });
});
