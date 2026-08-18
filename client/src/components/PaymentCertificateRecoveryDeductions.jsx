import { useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import {
  addRecoveryLineToCertificate,
  removeRecoveryLineFromCertificate,
  updateRecoveryLineAmount,
} from '../payments/paymentCertificateStore';
import {
  buildCertificateRecoveryLineRows,
  buildSelectedRecoveryPreview,
  formatEligibleRecoveryOptionLabel,
  listEligibleRecoveryEvents,
} from '../payments/certificateRecoveryLines';

function formatMagnitude(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount === 0) return '£0.00';
  return `£${formatMoney(amount)}`;
}

export default function PaymentCertificateRecoveryDeductions({
  orderKey,
  order,
  certificate,
  editable,
  onLinesChanged,
}) {
  const [selectedEventId, setSelectedEventId] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pendingAmounts, setPendingAmounts] = useState({});

  const developmentId = order?.developmentId || null;

  const rows = useMemo(
    () => buildCertificateRecoveryLineRows(orderKey, certificate, developmentId),
    [orderKey, certificate, developmentId]
  );

  const staleRows = useMemo(() => rows.filter((row) => row.stale), [rows]);

  const eligibleEvents = useMemo(
    () => listEligibleRecoveryEvents(developmentId, orderKey, certificate),
    [developmentId, orderKey, certificate]
  );

  function refresh() {
    onLinesChanged?.();
  }

  function showError(message) {
    setFeedback({ type: 'error', message });
  }

  async function handleAddLine() {
    if (!selectedEventId) {
      showError('Select a recovery event to deduct.');
      return;
    }

    const event = eligibleEvents.find((item) => item.id === selectedEventId);
    if (!event) {
      showError('Selected recovery event is no longer eligible.');
      return;
    }

    const defaultAmount = pendingAmounts[selectedEventId] ?? '';
    const parsed = Number.parseFloat(String(defaultAmount));
    if (!Number.isFinite(parsed) || parsed === 0) {
      showError('Enter a non-zero recovery amount for this certificate.');
      return;
    }

    const result = await Promise.resolve(
      addRecoveryLineToCertificate(
        orderKey,
        certificate.id,
        selectedEventId,
        parsed,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not add recovery deduction.');
      return;
    }

    setSelectedEventId('');
    setFeedback(null);
    setPendingAmounts((current) => {
      const next = { ...current };
      delete next[selectedEventId];
      return next;
    });
    refresh();
  }

  async function handleAmountCommit(line) {
    const rawValue = pendingAmounts[line.id] ?? Math.abs(line.amountThisCertificate);
    const parsed = Number.parseFloat(String(rawValue));
    if (!Number.isFinite(parsed)) {
      showError('Enter a valid recovery amount.');
      return;
    }

    const result = await Promise.resolve(
      updateRecoveryLineAmount(
        orderKey,
        certificate.id,
        line.id,
        parsed,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not update recovery amount.');
      return;
    }

    setPendingAmounts((current) => {
      const next = { ...current };
      delete next[line.id];
      return next;
    });
    setFeedback(null);
    refresh();
  }

  async function handleRemoveLine(lineId) {
    const result = await Promise.resolve(
      removeRecoveryLineFromCertificate(
        orderKey,
        certificate.id,
        lineId,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not remove recovery line.');
      return;
    }

    setFeedback(null);
    refresh();
  }

  const selectedEvent = eligibleEvents.find((item) => item.id === selectedEventId) || null;

  const selectedEventPreview = useMemo(() => {
    if (!selectedEvent || !orderKey || !certificate?.id) return null;
    return buildSelectedRecoveryPreview(selectedEvent, orderKey, certificate.id);
  }, [selectedEvent, orderKey, certificate?.id]);

  return (
    <section className="po-module-card po-cert-detail__commercial-events">
      <div className="po-cert-detail__commercial-events-header">
        <div>
          <h3 className="po-matrix-section__title">Recovery / Contra Deductions</h3>
          <p className="po-cert-detail__matrix-lead">
            {editable
              ? 'Select approved linked recovery events to deduct from net payment. Amounts are stored as negative deductions; enter positive magnitudes below.'
              : 'Recovery deductions recorded on this certificate. These reduce net payment only — not gross works or retention.'}
          </p>
        </div>
      </div>

      {feedback ? (
        <div
          className={`po-list-feedback po-list-feedback--${feedback.type}`}
          role="alert"
        >
          {feedback.message}
        </div>
      ) : null}

      {editable && staleRows.length ? (
        <div className="po-list-feedback po-list-feedback--warning" role="status">
          {staleRows.map((row) => (
            <p key={row.id} className="po-cert-ce-stale-warning">
              {row.staleReason}
            </p>
          ))}
        </div>
      ) : null}

      {editable && eligibleEvents.length ? (
        <div className="po-cert-ce-add">
          <label className="po-cert-ce-add__label" htmlFor="po-cert-recovery-select">
            Add eligible recovery
          </label>
          <div className="po-cert-ce-add__controls">
            <select
              id="po-cert-recovery-select"
              className="input"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setFeedback(null);
              }}
            >
              <option value="">Select recovery event…</option>
              {eligibleEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {formatEligibleRecoveryOptionLabel(event, orderKey, certificate.id)}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input po-cert-ce-add__amount"
              placeholder="This certificate £"
              value={selectedEventId ? pendingAmounts[selectedEventId] ?? '' : ''}
              onChange={(event) =>
                setPendingAmounts((current) => ({
                  ...current,
                  [selectedEventId]: event.target.value,
                }))
              }
              disabled={!selectedEventId}
            />
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={handleAddLine}
              disabled={!selectedEventId}
            >
              Add deduction
            </button>
          </div>
          {selectedEventPreview ? (
            <dl className="po-cert-ce-add__preview">
              <div className="po-cert-ce-add__preview-row">
                <dt>Recovery value:</dt>
                <dd>{selectedEventPreview.recoveryValueFormatted}</dd>
              </div>
              <div className="po-cert-ce-add__preview-row">
                <dt>Previously recovered:</dt>
                <dd>{selectedEventPreview.previouslyRecoveredFormatted}</dd>
              </div>
              <div className="po-cert-ce-add__preview-row">
                <dt>Available this certificate:</dt>
                <dd>{selectedEventPreview.availableThisCertificateFormatted}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : null}

      {editable && !eligibleEvents.length && !rows.length ? (
        <p className="po-cert-detail__readonly-note">
          No eligible approved recovery events are available for this package.
        </p>
      ) : null}

      <div className="po-cert-ce-table-wrap">
        <table className="po-data-table po-cert-ce-table">
          <thead>
            <tr>
              <th>Event No.</th>
              <th>Description</th>
              <th className="po-cert-ce-table__money">Recovery Value</th>
              <th className="po-cert-ce-table__money">Previously Recovered</th>
              <th className="po-cert-ce-table__money">This Certificate</th>
              <th className="po-cert-ce-table__money">Remaining Recovery</th>
              {editable ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className={row.stale ? 'po-cert-ce-table__row--stale' : ''}>
                  <td>
                    {row.eventNumber || '—'}
                    {row.stale ? (
                      <div className="po-cert-ce-table__stale-note">Stale — remove before approval</div>
                    ) : null}
                  </td>
                  <td>{row.description || '—'}</td>
                  <td className="po-cert-ce-table__money">{formatMagnitude(row.recoveryValue)}</td>
                  <td className="po-cert-ce-table__money">
                    {formatMagnitude(row.previouslyRecovered)}
                  </td>
                  <td className="po-cert-ce-table__money">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input po-cert-ce-table__amount-input"
                        value={
                          pendingAmounts[row.id] ??
                          (row.amountThisCertificateMagnitude || '')
                        }
                        onChange={(event) =>
                          setPendingAmounts((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        onBlur={() => handleAmountCommit(row)}
                      />
                    ) : (
                      formatMagnitude(row.amountThisCertificateMagnitude)
                    )}
                  </td>
                  <td className="po-cert-ce-table__money">
                    {formatMagnitude(row.remainingRecovery)}
                  </td>
                  {editable ? (
                    <td>
                      <button
                        type="button"
                        className="po-cert-workspace__link po-cert-workspace__link--danger"
                        onClick={() => handleRemoveLine(row.id)}
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={editable ? 7 : 6} className="po-cert-ce-table__empty">
                  No recovery deductions on this certificate yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
