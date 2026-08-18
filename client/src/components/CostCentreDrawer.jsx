import { useEffect, useMemo, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import ApplicationDrawerHeader from './layout/ApplicationDrawerHeader';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { formatPoDate } from './poDrawerHelpers';
import { getAdjustmentState } from '../cvr/cvrForecastEngine';

function DrawerSection({ title, children, className = '' }) {
  return (
    <section className={`po-drawer-section dev-cvr-drawer__section${className ? ` ${className}` : ''}`}>
      <h3 className="po-drawer-section__title">{title}</h3>
      {children}
    </section>
  );
}

function parseAdjustmentInput(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export default function CostCentreDrawer({
  open,
  row,
  drawerBreadcrumbs = [],
  packages = [],
  ledgerRows = [],
  certificates = [],
  ledgerReady = true,
  ledgerError = false,
  readOnly = false,
  onClose,
  onSaveNotes,
  onSaveCommercialAdjustment,
}) {
  const title = row?.costCodeLabel || 'Cost Code';
  const [adjustment, setAdjustment] = useState('');
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState('');

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

  useEffect(() => {
    if (!row) return;
    setAdjustment(
      row.commercialAdjustment == null ? '' : String(row.commercialAdjustment)
    );
    setReason(row.commercialReason || '');
    setSaveError('');
  }, [row?.id, row?.commercialAdjustment, row?.commercialReason]);

  const adjustmentValue = useMemo(() => parseAdjustmentInput(adjustment), [adjustment]);
  const reasonRequired = useMemo(() => {
    if (adjustmentValue == null) return false;
    return Math.abs(adjustmentValue) > 0.005;
  }, [adjustmentValue]);
  const adjustmentState = useMemo(
    () => getAdjustmentState(adjustmentValue ?? 0),
    [adjustmentValue]
  );
  const reasonMissing = reasonRequired && !String(reason || '').trim();

  if (!row) return null;

  function handleSaveCommercial() {
    const result = onSaveCommercialAdjustment?.({
      commercialAdjustment: adjustment,
      commercialReason: reason,
    });
    if (result?.ok === false) {
      setSaveError(result.errors?.[0] || 'Could not save commercial adjustment.');
      return;
    }
    setSaveError('');
  }

  return (
    <PODrawerShell
      open={open}
      onClose={onClose}
      wide
      ariaLabel={`Cost code details for ${title}`}
    >
      <ApplicationDrawerHeader
        eyebrow="Cost Code"
        breadcrumbs={drawerBreadcrumbs}
        title={title}
        onBack={onClose}
      />

      <div className="po-drawer-body dev-cvr-drawer dev-cvr-drawer--stacked dev-cvr-drawer--dense">
        <DrawerSection title="Commercial Facts">
          <dl className="dev-cvr-drawer__group-grid dev-cvr-drawer__facts-compact">
            <div>
              <dt>Original Budget</dt>
              <dd>{formatCvrMoney(row.originalBudget)}</dd>
            </div>
            <div>
              <dt>Current Budget</dt>
              <dd>{formatCvrMoney(row.currentBudget)}</dd>
            </div>
            <div>
              <dt>Committed</dt>
              <dd>{formatCvrMoney(row.committed)}</dd>
            </div>
            <div>
              <dt>Certified</dt>
              <dd>{formatCvrMoney(row.certified)}</dd>
            </div>
            <div>
              <dt>Actual</dt>
              <dd>{formatCvrMoney(row.actualCost)}</dd>
            </div>
            <div>
              <dt>Outstanding Certified</dt>
              <dd
                className={`dev-cvr__outstanding dev-cvr__outstanding--${row.outstandingCertifiedState || 'neutral'}`}
              >
                {formatCvrMoney(row.outstandingCertified)}
              </dd>
            </div>
          </dl>
        </DrawerSection>

        <DrawerSection title="Forecast">
          <dl className="dev-cvr-drawer__group-grid dev-cvr-drawer__forecast-grid">
            <div>
              <dt>System Forecast</dt>
              <dd>{formatCvrMoney(row.systemForecast)}</dd>
            </div>
            <div>
              <dt>Commercial Adjustment</dt>
              <dd
                className={`dev-cvr__adjustment dev-cvr__adjustment--${row.adjustmentState || 'zero'}`}
              >
                {row.commercialAdjustmentLabel || formatCvrMoney(row.commercialAdjustment)}
              </dd>
            </div>
            <div>
              <dt>Final Forecast</dt>
              <dd>{formatCvrMoney(row.finalForecast)}</dd>
            </div>
            <div>
              <dt>Cost To Complete</dt>
              <dd
                className={`dev-cvr__ctc${
                  Number(row.costToComplete) < -0.005 ? ' dev-cvr__ctc--negative' : ''
                }`}
              >
                {formatCvrMoney(row.costToComplete)}
              </dd>
            </div>
            <div>
              <dt>Variance</dt>
              <dd className={`dev-cvr__variance dev-cvr__variance--${row.varianceState}`}>
                {formatCvrMoney(row.variance)}
              </dd>
            </div>
          </dl>

          {readOnly ? (
            <p className="dev-cvr-drawer__empty">
              This period is read-only. Commercial adjustments cannot be changed.
            </p>
          ) : (
            <div className="dev-cvr-drawer__adjustment-panel">
              {saveError ? (
                <div className="po-list-feedback po-list-feedback--error" role="alert">
                  {saveError}
                </div>
              ) : null}
              {reasonMissing ? (
                <div className="po-list-feedback po-list-feedback--warning" role="status">
                  Commercial Reason is required when the adjustment is not zero.
                </div>
              ) : null}
              <div className="dev-cvr-drawer__adjustment-fields">
                <label className="dev-form__field dev-cvr-drawer__adjustment-field">
                  <span className="dev-form__label">Adjustment</span>
                  <input
                    className={`input dev-cvr-drawer__adjustment-input dev-cvr__adjustment--${adjustmentState}`}
                    type="text"
                    inputMode="decimal"
                    value={adjustment}
                    onChange={(event) => {
                      setAdjustment(event.target.value);
                      setSaveError('');
                    }}
                    placeholder="e.g. +18000 or -5000"
                    aria-describedby="commercial-adjustment-help"
                  />
                  <span id="commercial-adjustment-help" className="dev-cvr-drawer__field-hint">
                    Positive or negative. Zero for no adjustment.
                  </span>
                </label>
                <label
                  className={`dev-form__field dev-cvr-drawer__reason-field${
                    reasonRequired ? ' dev-cvr-drawer__field--required' : ''
                  }`}
                >
                  <span className="dev-form__label">
                    Reason
                    {reasonRequired ? (
                      <span className="dev-cvr-drawer__required-mark">Required</span>
                    ) : null}
                  </span>
                  <input
                    className="input"
                    type="text"
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setSaveError('');
                    }}
                    placeholder={
                      reasonRequired
                        ? 'e.g. Expected Brickwork Variation'
                        : 'Optional when adjustment is zero'
                    }
                    aria-required={reasonRequired}
                    aria-invalid={reasonMissing}
                  />
                </label>
              </div>
              <div className="dev-cvr-drawer__adjustment-actions">
                <button
                  type="button"
                  className="po-btn-primary dev-cvr-drawer__save-adjustment"
                  onClick={handleSaveCommercial}
                  disabled={reasonMissing || adjustmentValue == null}
                >
                  Save Adjustment
                </button>
              </div>
            </div>
          )}
        </DrawerSection>

        <DrawerSection
          title="Commercial Journal (Future)"
          className="dev-cvr-drawer__section--placeholder"
        >
          <p className="dev-cvr-drawer__journal-placeholder">
            Commercial journal entries will appear here for timing adjustments, supplier
            credits, ledger corrections, and other temporary commercial movements.
          </p>
        </DrawerSection>

        <DrawerSection title="Audit">
          {row.adjustmentHistory?.length ? (
            <ul className="dev-cvr-drawer__history">
              {row.adjustmentHistory.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {formatCvrMoney(entry.previousAdjustment)} →{' '}
                    {formatCvrMoney(entry.newAdjustment)}
                  </strong>
                  <span>{entry.reason || '—'}</span>
                  <span>
                    {entry.user || '—'} · {formatPoDate(entry.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dev-cvr-drawer__empty">No commercial adjustments recorded yet.</p>
          )}
          <label className="dev-form__field dev-cvr-drawer__notes-field">
            <span className="dev-form__label">Notes</span>
            <textarea
              className="input dev-cvr-drawer__notes"
              rows={3}
              value={row.commercialNotes || ''}
              onChange={(event) =>
                onSaveNotes?.({ commercialNotes: event.target.value })
              }
              readOnly={readOnly}
              placeholder="Record commercial commentary for month-end review."
            />
          </label>
        </DrawerSection>

        <DrawerSection title="Packages">
          {packages.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table dev-cvr-drawer__table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>POs</th>
                    <th style={{ textAlign: 'right' }}>Committed</th>
                    <th style={{ textAlign: 'right' }}>Certified</th>
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
                      <td style={{ textAlign: 'right' }}>
                        {formatCvrMoney(pkg.certifiedValue)}
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
                    <td style={{ textAlign: 'right' }}>
                      <strong>
                        {formatCvrMoney(
                          packages.reduce(
                            (sum, item) => sum + (Number(item.certifiedValue) || 0),
                            0
                          )
                        )}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="dev-cvr-drawer__empty">No subcontract packages for this cost code.</p>
          )}
        </DrawerSection>

        <DrawerSection title="Ledger Transactions">
          {!ledgerReady ? (
            <p className="dev-cvr-drawer__empty" role="status">
              {ledgerError ? 'Unable to load ledger data' : 'Loading ledger data…'}
            </p>
          ) : ledgerRows.length ? (
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
            <p className="dev-cvr-drawer__empty">No ledger transactions for this cost code.</p>
          )}
        </DrawerSection>

        <DrawerSection title="Approved Certificates">
          {certificates.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table dev-cvr-drawer__table">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Cert No.</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Certified Value</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((certificate) => (
                    <tr key={certificate.id}>
                      <td>{certificate.packageLabel}</td>
                      <td>{certificate.certificateNumber}</td>
                      <td>{formatPoDate(certificate.certificateDate)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCvrMoney(certificate.certifiedValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="dev-cvr-drawer__empty">
              No approved certificates for this cost code.
            </p>
          )}
        </DrawerSection>
      </div>
    </PODrawerShell>
  );
}
