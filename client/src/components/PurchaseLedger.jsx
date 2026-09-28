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
import { listActiveCostCodesForSelect } from '../admin/costCodeMasterStore';
import { resolveServerLedgerTransaction } from '../ledger/ledgerServerMutations';

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
  const [eligibleCostCodes, setEligibleCostCodes] = useState([]);
  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const [resolutionError, setResolutionError] = useState('');

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

  useEffect(() => {
    if (!listTransactions(development.id).some((row) => row.resolutionStatus === 'unresolved')) {
      setEligibleCostCodes([]);
      return;
    }
    listActiveCostCodesForSelect()
      .then((rows) => setEligibleCostCodes((rows || []).filter((row) => row.allowLedgerImport !== false)))
      .catch(() => setEligibleCostCodes([]));
  }, [development.id, localRefresh]);

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

  async function handleResolve(transaction) {
    const draft = resolutionDrafts[transaction.id] || {};
    setResolutionError('');
    const result = await resolveServerLedgerTransaction(development.id, transaction.id, {
      resolvedCostCodeId: draft.costCodeId,
      reason: draft.reason,
      version: transaction.resolutionVersion,
    });
    if (!result.ok) {
      setResolutionError(result.errors?.[0] || 'Unable to resolve transaction.');
      return;
    }
    setResolutionDrafts((current) => {
      const next = { ...current };
      delete next[transaction.id];
      return next;
    });
    setLocalRefresh((value) => value + 1);
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

      {listTransactions(development.id).some((txn) => txn.resolutionStatus === 'unresolved') ? (
        <section className="po-module-card dev-ledger__unmatched" aria-labelledby="ledger-unmatched-title">
          <h2 id="ledger-unmatched-title" className="po-matrix-section__title">Unmatched transactions</h2>
          <p>These source transactions remain financial evidence but are excluded from allocated Actual Cost and CVR until resolved.</p>
          {resolutionError ? <p role="alert" className="po-list-feedback po-list-feedback--error">{resolutionError}</p> : null}
          <div className="po-table-wrap"><table className="po-data-table"><thead><tr><th>Date</th><th>Supplier / reference</th><th>Source Cost Code</th><th>Description</th><th>Net</th><th>Resolution</th></tr></thead><tbody>
            {listTransactions(development.id).filter((txn) => txn.resolutionStatus === 'unresolved').map((txn) => {
              const draft = resolutionDrafts[txn.id] || {};
              return <tr key={txn.id}><td>{txn.transactionDate}</td><td>{txn.supplier}<br />{txn.invoiceNumber || txn.reference || '—'}</td><td>{txn.sourceCostCodeKey}</td><td>{txn.description || '—'}</td><td>{formatLedgerTransactionRow(txn).amountLabel}</td><td>
                <select className="select" aria-label={`Resolve ${txn.sourceCostCodeKey}`} value={draft.costCodeId || ''} onChange={(event) => setResolutionDrafts((current) => ({ ...current, [txn.id]: { ...draft, costCodeId: event.target.value } }))}><option value="">Select Company Cost Code</option>{eligibleCostCodes.map((code) => <option key={code.id} value={code.id}>{code.code} — {code.element}</option>)}</select>
                <input className="input" aria-label={`Resolution reason for ${txn.sourceCostCodeKey}`} placeholder="Resolution reason" value={draft.reason || ''} onChange={(event) => setResolutionDrafts((current) => ({ ...current, [txn.id]: { ...draft, reason: event.target.value } }))} />
                <button type="button" className="po-list-btn-secondary" disabled={!draft.costCodeId || !String(draft.reason || '').trim()} onClick={() => handleResolve(txn)}>Resolve to Cost Code</button>
              </td></tr>;
            })}
          </tbody></table></div>
          <p>Genuinely new Cost Code? Create and review it in Administration → Cost Codes, then return here to resolve it.</p>
        </section>
      ) : null}

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
