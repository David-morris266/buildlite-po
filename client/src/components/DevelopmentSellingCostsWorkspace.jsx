import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSellingCostsProposal,
  putSellingCostsAssumption,
  SellingCostsApiError,
} from '../api/sellingCosts';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import DevelopmentSellingCostsCvrReview from './DevelopmentSellingCostsCvrReview';
import { listServerCostCodes } from '../api/costCodes';
import DevelopmentDetailedSellingCosts from './DevelopmentDetailedSellingCosts';
import SellingCostsCostCodePicker from './SellingCostsCostCodePicker';
import { loadCommercialStructure } from '../admin/commercialStructureService';
import { buildDetailedSellingCostsSaveLines } from '../sellingCosts/detailedSellingCostsAuthority';

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
      return 'Mapped destination is not available';
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

export default function DevelopmentSellingCostsWorkspace({ developmentId, onReviewPlotTenures }) {
  const [proposal, setProposal] = useState(null);
  const [percentInput, setPercentInput] = useState('2.00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [workspaceView, setWorkspaceView] = useState('proposal');
  const [costCodes, setCostCodes] = useState([]);
  const [commercialStructure, setCommercialStructure] = useState(null);
  const [changingDestination, setChangingDestination] = useState(false);
  const [destinationId, setDestinationId] = useState('');

  const load = useCallback(async () => {
    if (!developmentId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getSellingCostsProposal(developmentId);
      setProposal(next);
      setPercentInput(formatPercentDisplay(next.assumptionPercent));
      setDestinationId(next.settings?.destinationCostCodeId || next.destination?.id || '');
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

  useEffect(()=>{listServerCostCodes({activeOnly:true}).then(body=>setCostCodes(body.costCodes||[])).catch(()=>setCostCodes([]));},[]);
  useEffect(()=>{loadCommercialStructure().then(setCommercialStructure).catch(()=>setCommercialStructure(null));},[]);

  const isDefault = !['development','user'].includes(proposal?.assumptionSource);
  const isSaved = ['development','user'].includes(proposal?.assumptionSource);
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
        ...(changingDestination?{destinationCostCodeId:destinationId||null}:{}),
      });
      setProposal(next);
      setPercentInput(formatPercentDisplay(next.assumptionPercent));
      setDestinationId(next.settings?.destinationCostCodeId||next.destination?.id||'');
      setChangingDestination(false);
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

  async function revert(field){if(!developmentId||saving)return;setSaving(true);setError('');try{const payload={version,mode:'simple'};if(field==='assumption')payload.useCompanyAssumption=true;if(field==='destination')payload.useCompanyDestination=true;const next=await putSellingCostsAssumption(developmentId,payload);setProposal(next);setPercentInput(formatPercentDisplay(next.assumptionPercent));setDestinationId(next.settings?.destinationCostCodeId||next.destination?.id||'');setChangingDestination(false);setInfo(field==='assumption'?'Using company/default assumption.':'Using company destination mapping.');}catch(err){setError(err?.message||'Failed to revert Selling Costs override.');}finally{setSaving(false);}}

  async function saveDetailed(lines){setSaving(true);setError('');try{const next=await putSellingCostsAssumption(developmentId,{version,mode:'detailed',lines:buildDetailedSellingCostsSaveLines(lines)});setProposal(next);setInfo('Detailed Selling Costs setup saved.');}catch(err){setError(err?.message||'Failed to save Detailed Selling Costs setup.');throw err;}finally{setSaving(false);}}
  async function enableDetailed(){const lines=(proposal?.companyTemplate?.lines||[]).filter(line=>line.enabled).map(line=>({templateLineId:line.id,driver:line.forecastDriver,percent:line.defaultPercent,lumpSum:line.defaultLumpSum,quantity:line.defaultQuantity,rate:line.defaultRate,quantitySource:line.quantitySource||'MANUAL',unitCode:line.unitCode||'EACH',customUnitLabel:line.customUnitLabel||null,assumptionOverridden:false,destinationOverridden:false,destinationCostCodeId:null}));await saveDetailed(lines);}
  async function enableSimple(){setSaving(true);setError('');try{const next=await putSellingCostsAssumption(developmentId,{version,mode:'simple',useCompanyAssumption:true,useCompanyDestination:true});setProposal(next);setPercentInput(formatPercentDisplay(next.assumptionPercent));}catch(err){setError(err?.message||'Failed to switch Selling Costs mode.');}finally{setSaving(false);}}

  if (!developmentId) {
    return (
      <section className="dev-selling-costs" aria-label="Selling Costs">
        <p role="alert">Development is required.</p>
      </section>
    );
  }

  return (
    <section className={`dev-selling-costs${proposal?.mode === 'detailed' ? ' dev-selling-costs--detailed' : ''}`} aria-label="Selling Costs">
      <div className="dev-selling-costs__banner" role="note">
        <strong>Selling Costs forecast</strong>
        <p>{proposal?.mode === 'detailed'
          ? 'Itemised forecast using the company Selling Costs template, with Development overrides where required.'
          : 'Simple forecast based on one percentage of total Forecast Revenue and one CVR destination.'}</p>
      </div>

      {workspaceView === 'review' ? (
        <DevelopmentSellingCostsCvrReview
          developmentId={developmentId}
          onBack={() => setWorkspaceView('proposal')}
        />
      ) : (
        <>
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
          <div className="dev-selling-costs__method" aria-label="Selling Costs method">
            <span>Method</span>
            <div className="dev-selling-costs__actions">
              <button type="button" aria-pressed={proposal.mode !== 'detailed'} className={proposal.mode === 'detailed' ? 'btn btn--secondary' : ''} disabled={saving || proposal.mode !== 'detailed'} onClick={enableSimple}>Simple</button>
              <button type="button" aria-pressed={proposal.mode === 'detailed'} className={proposal.mode === 'detailed' ? '' : 'btn btn--secondary'} disabled={saving || proposal.mode === 'detailed'} onClick={enableDetailed}>Detailed</button>
            </div>
          </div>
          {proposal.mode === 'detailed' ? (
          <DevelopmentDetailedSellingCosts proposal={proposal} costCodes={costCodes} commercialStructure={commercialStructure} saving={saving} onSave={saveDetailed} onReviewPlotTenures={onReviewPlotTenures} onReviewCvr={() => setWorkspaceView('review')} />
          ) : <>
          <div
            className={`dev-selling-costs__status${
              isDefault ? ' dev-selling-costs__status--default' : ' dev-selling-costs__status--saved'
            }`}
            data-testid="selling-costs-assumption-source"
          >
            {proposal.assumptionSource === 'company' ? 'COMPANY DEFAULT' : null}
            {proposal.assumptionSource === 'buildlite' ? 'BUILDLITE DEFAULT' : null}
            {proposal.assumptionSource === 'default' ? 'DEFAULT ASSUMPTION' : null}
            {proposal.assumptionSource === 'development' ? 'DEVELOPMENT OVERRIDE' : null}
            {proposal.assumptionSource === 'user' ? 'SAVED ASSUMPTION' : null}
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
              {isSaved?<button type="button" className="btn btn--secondary" disabled={saving} onClick={()=>revert('assumption')}>Revert percentage</button>:null}
              <button
                type="button"
                className="btn btn--primary"
                data-testid="selling-costs-review-against-cvr"
                onClick={() => {
                  setError('');
                  setInfo('');
                  setWorkspaceView('review');
                }}
              >
                Review against CVR
              </button>
            </div>
          </form>

          <dl className="dev-selling-costs__destination">
            <div>
              <dt>CVR destination</dt>
              <dd data-testid="selling-costs-destination">
                <span className="dev-selling-costs__destination-identity">{destinationStatusLabel(proposal.destination)}</span>
                <small className="dev-selling-costs__destination-provenance">{proposal.destination?.source==='development'?'Development override':proposal.destination?.status==='ready'?'Company mapping':'Company template unmapped'}</small>
              </dd>
            </div>
          </dl>
          {!changingDestination?<div className="dev-selling-costs__actions"><button type="button" className="btn btn--secondary" onClick={()=>setChangingDestination(true)}>{proposal.destination?.source==='development'?'Change Development override':'Change for this development'}</button>{proposal.destination?.source==='development'?<button type="button" className="btn btn--secondary" disabled={saving} onClick={()=>revert('destination')}>Revert to company mapping</button>:null}</div>:<div className="dev-selling-costs__form"><div className="dev-selling-costs__field"><span>Development CVR destination</span><SellingCostsCostCodePicker codes={costCodes} structure={commercialStructure} valueId={destinationId} onChange={id=>setDestinationId(id||'')} name="Development CVR destination" contextKey={developmentId}/></div><div className="dev-selling-costs__actions"><button type="button" onClick={handleSave} disabled={saving}>Save Development override</button><button type="button" className="btn btn--secondary" onClick={()=>setChangingDestination(false)}>Cancel</button></div></div>}
          </>}
        </>
      ) : null}
        </>
      )}
    </section>
  );
}
