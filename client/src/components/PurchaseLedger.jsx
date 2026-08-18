import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import PurchaseLedgerImportWizard from './PurchaseLedgerImportWizard';
import {
  buildLedgerWorkspaceModel,
  filterAndSortTransactions,
  formatImportHistoryRow,
  formatLedgerTransactionRow,
  getUniqueTransactionSources,
} from '../ledger/ledgerHelpers';
import { listTransactions } from '../ledger/ledgerTransactionStore';
import { isLedgerServerAuthorityEnabled } from '../ledger/ledgerAuthority';
import {
  ensureLedgerReadyForDevelopment,
  getLedgerReadiness,
} from '../ledger/ledgerServerCache';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function LedgerSummaryDashboard({ cards }) {
  return (
    <section className="dev-ledger__cards" aria-label="Ledger summary">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`dev-ledger__card dev-ledger__card--${card.modifier}`}
        >
          <span className="dev-ledger__card-label">{card.label}</span>
          {card.isBadge ? (
            <StatusBadge status={card.status} />
          ) : (
            <strong className="dev-ledger__card-value">{card.value}</strong>
          )}
        </div>
      ))}
    </section>
  );
}

function SortableHeader({ label, sortKey, activeSortKey, sortDir, onSort }) {
  const active = activeSortKey === sortKey;
  const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <button
      type="button"
      className={`dev-ledger__sort-btn${active ? ' dev-ledger__sort-btn--active' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {indicator}
    </button>
  );
}

export default function PurchaseLedger({
  development,
  refreshToken = 0,
  onLedgerChanged,
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortKey, setSortKey] = useState('transactionDate');
  const [sortDir, setSortDir] = useState('desc');
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    if (!isLedgerServerAuthorityEnabled()) return undefined;
    let cancelled = false;

    (async () => {
      try {
        await ensureLedgerReadyForDevelopment(development.id);
      } catch {
        // Cache error state is authoritative; no localStorage fallback.
      }
      if (!cancelled) setLocalRefresh((value) => value + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [development.id, refreshToken]);

  const workspace = useMemo(() => {
    void refreshToken;
    void localRefresh;
    return buildLedgerWorkspaceModel(development);
  }, [development, refreshToken, localRefresh]);

  const ledgerReadiness = isLedgerServerAuthorityEnabled()
    ? getLedgerReadiness(development.id)
    : { ready: true, loadState: 'local', error: null };
  const ledgerUnresolved = Boolean(workspace?.unavailable);
  const ledgerError = ledgerReadiness.loadState === 'error';

  const transactions = useMemo(() => {
    void refreshToken;
    void localRefresh;
    if (ledgerUnresolved) return [];
    const rows = listTransactions(development.id).map(formatLedgerTransactionRow);
    return filterAndSortTransactions(rows, {
      search,
      source: sourceFilter,
      sortKey,
      sortDir,
    });
  }, [development.id, refreshToken, localRefresh, search, sourceFilter, sortKey, sortDir, ledgerUnresolved]);

  const sources = useMemo(() => {
    void refreshToken;
    void localRefresh;
    if (ledgerUnresolved) return [];
    return getUniqueTransactionSources(listTransactions(development.id));
  }, [development.id, refreshToken, localRefresh, ledgerUnresolved]);

  const importHistory = useMemo(
    () => workspace?.importHistory.map(formatImportHistoryRow) || [],
    [workspace]
  );

  function handleSort(nextKey) {
    if (sortKey === nextKey) {
      setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === 'transactionDate' ? 'desc' : 'asc');
  }

  function handleImportComplete() {
    setImportOpen(false);
    onLedgerChanged?.();
  }

  if (importOpen) {
    return (
      <PurchaseLedgerImportWizard
        development={development}
        onCancel={() => setImportOpen(false)}
        onImportComplete={handleImportComplete}
      />
    );
  }

  if (!workspace) return null;

  if (ledgerUnresolved) {
    return (
      <div className="dev-ledger">
        <POPageHeader
          eyebrow="Purchase Ledger"
          title={workspace.developmentName}
          lead={`Development ${workspace.developmentNumber || '—'}`}
        />
        {ledgerError ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            Unable to load ledger data
          </div>
        ) : (
          <p role="status">Loading ledger data…</p>
        )}
      </div>
    );
  }

  return (
    <div className="dev-ledger">
      <POPageHeader
        eyebrow="Purchase Ledger"
        title={workspace.developmentName}
        lead={`Development ${workspace.developmentNumber || '—'} · Last import: ${workspace.lastImportLabel}`}
      />

      <LedgerSummaryDashboard cards={workspace.summaryCards} />

      <header className="dev-ledger__list-header">
        <div>
          <h2 className="po-matrix-section__title">Imported Transactions</h2>
          <p className="dev-ledger__list-lead">
            Actual costs allocated to company cost codes for this development.
          </p>
        </div>
        {transactions.length ? (
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => setImportOpen(true)}
          >
            Import Purchase Ledger
          </button>
        ) : null}
      </header>

      {!transactions.length ? (
        <div className="po-module-card po-empty-state dev-ledger__empty">
          <p className="po-empty-state__message">
            No ledger transactions have been imported.
          </p>
          <p className="po-empty-state__hint">
            Import a CSV exported from your accounting system.
          </p>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => setImportOpen(true)}
          >
            Import Purchase Ledger
          </button>
        </div>
      ) : (
        <>
          <div className="dev-ledger__toolbar">
            <input
              className="input dev-ledger__search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search supplier, cost code, invoice, description…"
              aria-label="Search ledger transactions"
            />
            <select
              className="select dev-ledger__filter"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              aria-label="Filter by source"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>

          <div className="po-table-wrap">
            <table className="po-data-table dev-ledger__table">
              <thead>
                <tr>
                  <th>
                    <SortableHeader
                      label="Date"
                      sortKey="transactionDate"
                      activeSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableHeader
                      label="Supplier"
                      sortKey="supplier"
                      activeSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableHeader
                      label="Cost Code"
                      sortKey="costCode"
                      activeSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th>Description</th>
                  <th>Invoice</th>
                  <th style={{ textAlign: 'right' }}>
                    <SortableHeader
                      label="Amount"
                      sortKey="netAmount"
                      activeSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableHeader
                      label="Source"
                      sortKey="source"
                      activeSortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td>{txn.dateLabel}</td>
                    <td>{txn.supplierLabel}</td>
                    <td>{txn.costCentreLabel}</td>
                    <td>{txn.descriptionLabel}</td>
                    <td>{txn.invoiceLabel}</td>
                    <td style={{ textAlign: 'right' }}>{txn.amountLabel}</td>
                    <td>{txn.sourceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importHistory.length ? (
        <section className="po-module-card dev-ledger__history">
          <h2 className="po-matrix-section__title">Import History</h2>
          <div className="po-table-wrap">
            <table className="po-data-table dev-ledger__history-table">
              <thead>
                <tr>
                  <th>Import Date</th>
                  <th>Imported By</th>
                  <th>Rows Imported</th>
                  <th>Rows Rejected</th>
                  <th>Total Value</th>
                  <th>File Name</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map((record) => (
                  <tr key={record.id}>
                    <td>{record.dateLabel}</td>
                    <td>{record.importedBy}</td>
                    <td>{record.rowsImported}</td>
                    <td>{record.rowsRejected}</td>
                    <td>{record.totalValueLabel}</td>
                    <td>{record.fileName || '—'}</td>
                    <td>{record.profileLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
