import { useMemo } from 'react';
import PODrawerShell from './PODrawerShell';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { formatPoDate } from './poDrawerHelpers';

function DrawerSection({ title, children }) {
  return (
    <section className="po-drawer-section dev-cvr-drawer__section">
      <h3 className="po-drawer-section__title">{title}</h3>
      {children}
    </section>
  );
}

export default function CostCentreDrawer({
  open,
  row,
  packages = [],
  ledgerRows = [],
  onClose,
  onSaveNotes,
}) {
  const title = row?.costCodeLabel || 'Cost Centre';

  const packageTotal = useMemo(
    () =>
      packages.reduce((sum, item) => sum + (Number(item.committedValue) || 0), 0),
    [packages]
  );

  const actualTotal = useMemo(
    () =>
      ledgerRows.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0),
    [ledgerRows]
  );

  if (!row) return null;

  return (
    <PODrawerShell
      open={open}
      onClose={onClose}
      wide
      ariaLabel={`Cost centre details for ${title}`}
    >
      <header className="po-drawer-header">
        <div className="po-drawer-header__bar">
          <p className="po-drawer-header__eyebrow">Cost Centre</p>
          <button type="button" className="po-drawer-header__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="po-drawer-header__hero">
          <h2 className="po-drawer-header__number">{title}</h2>
        </div>
      </header>

      <div className="po-drawer-body dev-cvr-drawer">
        <dl className="dev-cvr-drawer__summary">
          <div>
            <dt>Committed</dt>
            <dd>{formatCvrMoney(row.committed)}</dd>
          </div>
          <div>
            <dt>Actual Cost</dt>
            <dd>{formatCvrMoney(row.actualCost)}</dd>
          </div>
          <div>
            <dt>Forecast Final Cost</dt>
            <dd>{formatCvrMoney(row.forecastFinalCost)}</dd>
          </div>
          <div>
            <dt>Variance</dt>
            <dd className={`dev-cvr__variance dev-cvr__variance--${row.varianceState}`}>
              {formatCvrMoney(row.variance)}
            </dd>
          </div>
        </dl>

        <DrawerSection title="Packages">
          {packages.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table dev-cvr-drawer__table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>POs</th>
                    <th style={{ textAlign: 'right' }}>Committed</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pkg) => (
                    <tr key={pkg.id}>
                      <td>{pkg.label}</td>
                      <td>{pkg.poNumbers?.join(', ') || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCvrMoney(pkg.committedValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      <strong>Package total</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{formatCvrMoney(packageTotal)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="dev-cvr-drawer__empty">No subcontract packages for this cost centre.</p>
          )}
        </DrawerSection>

        <DrawerSection title="Ledger Transactions">
          {ledgerRows.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table dev-cvr-drawer__table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Invoice</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((txn) => (
                    <tr key={txn.id}>
                      <td>{formatPoDate(txn.date)}</td>
                      <td>{txn.supplier || '—'}</td>
                      <td>{txn.invoiceNumber || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCvrMoney(txn.netAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      <strong>Ledger total</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{formatCvrMoney(actualTotal)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="dev-cvr-drawer__empty">No ledger transactions for this cost centre.</p>
          )}
        </DrawerSection>

        <DrawerSection title="Certificates">
          <p className="dev-cvr-drawer__placeholder">
            Certificate drill-down will connect here in a later sprint.
          </p>
        </DrawerSection>

        <DrawerSection title="Forecast Notes">
          <textarea
            className="input dev-cvr-drawer__notes"
            rows={3}
            value={row.forecastNotes || ''}
            onChange={(event) =>
              onSaveNotes?.({ forecastNotes: event.target.value })
            }
            placeholder="Explain forecast assumptions for this cost centre."
          />
        </DrawerSection>

        <DrawerSection title="Commercial Notes">
          <textarea
            className="input dev-cvr-drawer__notes"
            rows={4}
            value={row.commercialNotes || ''}
            onChange={(event) =>
              onSaveNotes?.({ commercialNotes: event.target.value })
            }
            placeholder="Record commercial commentary for month-end review."
          />
        </DrawerSection>
      </div>
    </PODrawerShell>
  );
}
