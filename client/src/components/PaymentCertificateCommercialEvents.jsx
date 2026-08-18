import { useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import {
  addCommercialLineToCertificate,
  removeCommercialLineFromCertificate,
  updateCommercialLineAmount,
} from '../payments/paymentCertificateStore';
import {
  buildCertificateCommercialLineRows,
  buildSelectedCommercialEventPreview,
  formatEligibleCommercialEventOptionLabel,
  listEligibleCommercialEvents,
} from '../payments/certificateCommercialLines';

function formatSignedValue(value) {
  const amount = Number(value) || 0;
  if (amount === 0) return '£0.00';
  const prefix = amount > 0 ? '' : '-';
  return `${prefix}£${formatMoney(Math.abs(amount))}`;
}

export default function PaymentCertificateCommercialEvents({
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
    () => buildCertificateCommercialLineRows(orderKey, certificate, developmentId),
    [orderKey, certificate, developmentId]
  );

  const eligibleEvents = useMemo(
    () => listEligibleCommercialEvents(developmentId, orderKey, certificate),
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
      showError('Select a commercial event to add.');
      return;
    }

    const event = eligibleEvents.find((item) => item.id === selectedEventId);
    if (!event) {
      showError('Selected commercial event is no longer eligible.');
      return;
    }

    const defaultAmount = pendingAmounts[selectedEventId] ?? '';
    const parsed = Number.parseFloat(String(defaultAmount));
    if (!Number.isFinite(parsed) || parsed === 0) {
      showError('Enter a non-zero amount for this certificate.');
      return;
    }

    const result = await Promise.resolve(
      addCommercialLineToCertificate(
        orderKey,
        certificate.id,
        selectedEventId,
        parsed,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not add commercial event.');
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

  function handleAmountChange(lineId, rawValue) {
    setPendingAmounts((current) => ({ ...current, [lineId]: rawValue }));
  }

  async function handleAmountCommit(line) {
    const rawValue = pendingAmounts[line.id] ?? line.amountThisCertificate;
    const parsed = Number.parseFloat(String(rawValue));
    if (!Number.isFinite(parsed)) {
      showError('Enter a valid amount.');
      return;
    }

    const result = await Promise.resolve(
      updateCommercialLineAmount(
        orderKey,
        certificate.id,
        line.id,
        parsed,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not update amount.');
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
      removeCommercialLineFromCertificate(
        orderKey,
        certificate.id,
        lineId,
        order
      )
    );

    if (!result.ok) {
      showError(result.errors?.join(' ') || 'Could not remove commercial line.');
      return;
    }

    setFeedback(null);
    refresh();
  }

  const selectedEvent = eligibleEvents.find((item) => item.id === selectedEventId) || null;

  const selectedEventPreview = useMemo(() => {
    if (!selectedEvent || !orderKey || !certificate?.id) return null;
    return buildSelectedCommercialEventPreview(
      selectedEvent,
      orderKey,
      certificate.id
    );
  }, [selectedEvent, orderKey, certificate?.id]);

  return (
    <section className="po-module-card po-cert-detail__commercial-events">
      <div className="po-cert-detail__commercial-events-header">
        <div>
          <h3 className="po-matrix-section__title">Commercial Events</h3>
          <p className="po-cert-detail__matrix-lead">
            {editable
              ? 'Select approved commercial events to propose for valuation on this certificate. Lines are draft-only until certificate approval in a later sprint.'
              : 'Frozen commercial event inclusions recorded on this certificate.'}
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

      {editable && eligibleEvents.length ? (
        <div className="po-cert-ce-add">
          <label className="po-cert-ce-add__label" htmlFor="po-cert-ce-select">
            Add eligible event
          </label>
          <div className="po-cert-ce-add__controls">
            <select
              id="po-cert-ce-select"
              className="input"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setFeedback(null);
              }}
            >
              <option value="">Select commercial event…</option>
              {eligibleEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {formatEligibleCommercialEventOptionLabel(
                    event,
                    orderKey,
                    certificate.id
                  )}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              className="input po-cert-ce-add__amount"
              placeholder="This certificate £"
              value={
                selectedEventId
                  ? pendingAmounts[selectedEventId] ?? ''
                  : ''
              }
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
              Add to certificate
            </button>
          </div>
          {selectedEventPreview ? (
            <dl className="po-cert-ce-add__preview">
              <div className="po-cert-ce-add__preview-row">
                <dt>{selectedEventPreview.approvedValueLabel}:</dt>
                <dd>{selectedEventPreview.approvedValueFormatted}</dd>
              </div>
              <div className="po-cert-ce-add__preview-row">
                <dt>Previously certified:</dt>
                <dd>{selectedEventPreview.previouslyCertifiedFormatted}</dd>
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
          No eligible approved commercial events are available for this package.
        </p>
      ) : null}

      <div className="po-cert-ce-table-wrap">
        <table className="po-data-table po-cert-ce-table">
          <thead>
            <tr>
              <th>Event No.</th>
              <th>Type</th>
              <th>Description</th>
              <th className="po-cert-ce-table__money">Approved Value</th>
              <th className="po-cert-ce-table__money">Previously Certified</th>
              <th className="po-cert-ce-table__money">This Certificate</th>
              <th className="po-cert-ce-table__money">Remaining</th>
              {editable ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className={row.stale ? 'po-cert-ce-table__row--stale' : ''}>
                  <td>{row.eventNumber || '—'}</td>
                  <td>{row.typeLabel}</td>
                  <td>{row.description || '—'}</td>
                  <td className="po-cert-ce-table__money">{formatSignedValue(row.approvedValue)}</td>
                  <td className="po-cert-ce-table__money">
                    {formatSignedValue(row.previouslyCertified)}
                  </td>
                  <td className="po-cert-ce-table__money">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        className="input po-cert-ce-table__amount-input"
                        value={
                          pendingAmounts[row.id] ?? row.amountThisCertificate
                        }
                        onChange={(event) =>
                          handleAmountChange(row.id, event.target.value)
                        }
                        onBlur={() => handleAmountCommit(row)}
                      />
                    ) : (
                      formatSignedValue(row.amountThisCertificate)
                    )}
                  </td>
                  <td className="po-cert-ce-table__money">
                    {formatSignedValue(row.remaining)}
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
                <td colSpan={editable ? 8 : 7} className="po-cert-ce-table__empty">
                  No commercial events included on this certificate yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
