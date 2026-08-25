import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSellingCostsProposal,
  putSellingCostsAssumption,
  SellingCostsApiError,
} from '../api/sellingCosts';
import { formatCvrMoney } from '../cvr/cvrHelpers';

function formatPercentDisplay(value) {
  if (value == null || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);
}

function destinationStatusLabel(destination) {
  if (!destination) return 'Not configured';
  switch (destination.status) {
    case 'ready':
      return destination.label || destination.costCodeKey || 'Ready';
    case 'missing':
      return 'Recommended destination not on Cost Code Master';
    case 'not_selling':
      return 'Destination needs SELLING classification';
    case 'forbidden':
      return 'Invalid destination';
    case 'inactive':
      return 'Destination inactive';
    default:
      return 'Not configured';
  }
}

export default function DevelopmentSellingCostsWorkspace({ developmentId }) {
  const [proposal, setProposal] = useState(null);
  const [percentInput, setPercentInput] = useState('2.00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    if (!developmentId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getSellingCostsProposal(developmentId);
      setProposal(next);
      setPercentInput(formatPercentDisplay(next.assumptionPercent));
    } catch (err) {
      setProposal(null);
      setError(err?.message || 'Failed to load Selling Costs proposal.');
    } finally {
      setLoading(false);
    }
  }, [developmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const isDefault = proposal?.assumptionSource === 'default';
  const isSaved = proposal?.assumptionSource === 'user';
  const revenueReady = Boolean(proposal?.revenue?.ready);
  const version = Number(proposal?.settings?.version) || 0;

  const supportingCopy = useMemo(() => {
    const pct = formatPercentDisplay(proposal?.assumptionPercent) || '2.00';
    if (isDefault) {
      return `Selling costs forecast using the default assumption of ${pct}% of total forecast development revenue. This is an assumption, not an itemised build-up.`;
    }
    return `Selling costs forecast using ${pct}% of total forecast development revenue. This is an assumption, not an itemised build-up.`;
  }, [isDefault, proposal?.assumptionPercent]);

  async function handleSave(event) {
    event.preventDefault();
    if (!developmentId || saving) return;
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const next = await putSellingCostsAssumption(developmentId, {
        version,
        mode: 'simple',
        assumptionPercent: percentInput,
      });
      setProposal(next);
      setPercentInput(formatPercentDisplay(next.assumptionPercent));
      setInfo('Saved assumption.');
    } catch (err) {
      if (err instanceof SellingCostsApiError && err.status === 409 && err.body?.proposal) {
        setProposal(err.body.proposal);
        setPercentInput(formatPercentDisplay(err.body.proposal.assumptionPercent));
        setError('Settings were updated elsewhere. Reloaded the latest assumption — review and save again.');
      } else {
        setError(err?.message || 'Failed to save Selling Costs assumption.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (!developmentId) {
    return (
      <section className="dev-selling-costs" aria-label="Selling Costs">
        <p role="alert">Development is required.</p>
      </section>
    );
  }

  return (
    <section className="dev-selling-costs" aria-label="Selling Costs">
      <div className="dev-selling-costs__banner" role="note">
        <strong>Selling Costs forecast</strong>
        <p>
          Selling Costs are a forecast proposal based on a percentage of total forecast
          development revenue. They do not change the CVR until a later deliberate review
          and adoption step.
        </p>
      </div>

      {loading ? <p className="dev-selling-costs__muted">Loading Selling Costs…</p> : null}
      {error ? (
        <p className="dev-selling-costs__error" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="dev-selling-costs__info" role="status">
          {info}
        </p>
      ) : null}

      {proposal ? (
        <>
          <div
            className={`dev-selling-costs__status${
              isDefault ? ' dev-selling-costs__status--default' : ' dev-selling-costs__status--saved'
            }`}
            data-testid="selling-costs-assumption-source"
          >
            {isDefault ? 'DEFAULT ASSUMPTION' : null}
            {isSaved ? 'SAVED ASSUMPTION' : null}
          </div>

          <dl className="dev-selling-costs__summary">
            <div>
              <dt>Forecast Revenue</dt>
              <dd data-testid="selling-costs-forecast-revenue">
                {revenueReady ? formatCvrMoney(proposal.forecastRevenue) : '—'}
              </dd>
            </div>
            <div>
              <dt>Forecast Selling Costs</dt>
              <dd data-testid="selling-costs-forecast-amount">
                {revenueReady && proposal.forecastSellingCosts != null
                  ? formatCvrMoney(proposal.forecastSellingCosts)
                  : '—'}
              </dd>
            </div>
          </dl>

          {!revenueReady ? (
            <p className="dev-selling-costs__warning" role="status" data-testid="selling-costs-revenue-warning">
              {proposal.revenue?.hint ||
                'Selling Costs forecast cannot be finalised because Forecast Revenue is unavailable.'}
            </p>
          ) : null}
          {revenueReady && proposal.revenue?.state === 'zero' ? (
            <p className="dev-selling-costs__warning" role="status">
              {proposal.revenue.hint}
            </p>
          ) : null}

          <p className="dev-selling-costs__copy" data-testid="selling-costs-supporting-copy">
            {supportingCopy}
          </p>

          <form className="dev-selling-costs__form" onSubmit={handleSave}>
            <label className="dev-selling-costs__field">
              <span>Selling Costs assumption</span>
              <span className="dev-selling-costs__percent-input">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={percentInput}
                  onChange={(event) => setPercentInput(event.target.value)}
                  aria-label="Selling Costs assumption percent"
                  data-testid="selling-costs-percent-input"
                />
                <span aria-hidden="true">%</span>
              </span>
            </label>
            <div className="dev-selling-costs__actions">
              <button type="submit" disabled={saving} data-testid="selling-costs-save">
                {saving ? 'Saving…' : 'Save assumption'}
              </button>
            </div>
          </form>

          <dl className="dev-selling-costs__destination">
            <div>
              <dt>CVR destination (for later review)</dt>
              <dd data-testid="selling-costs-destination">
                {destinationStatusLabel(proposal.destination)}
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
