import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { normaliseDetailedSellingCostsLines } from '../sellingCosts/detailedSellingCostsAuthority';
import CommercialHeadCostCodePicker from './CommercialHeadCostCodePicker';

const SOURCES = [['MANUAL', 'Manual quantity'], ['TOTAL_PLOTS', 'Total Plot Master plots'], ['PRIVATE_SALE_PLOTS', 'Private-sale plots']];
const UNITS = ['PLOTS', 'MONTHS', 'WEEKS', 'VISITS', 'ITEMS', 'EACH', 'FT2', 'M2', 'CUSTOM'];
const DRIVERS = [['PERCENT_REVENUE', '% Forecast Revenue'], ['LUMP_SUM', 'Lump Sum'], ['QUANTITY_RATE', 'Quantity × Rate']];

const cloneLines = normaliseDetailedSellingCostsLines;
const lineKey = line => line.id || line.templateLineId;
const isOverridden = line => Boolean(line.assumptionOverridden || line.destinationOverridden);

function unitLabel(line) {
  if (line.customUnitLabel && line.unitCode === 'CUSTOM') return line.customUnitLabel;
  return String(line.unitCode || 'each').toLowerCase().replaceAll('_', ' ');
}

function calculationLabel(line) {
  if (line.forecastDriver === 'PERCENT_REVENUE') return `${Number(line.percent || 0).toFixed(2)}% of Forecast Revenue`;
  if (line.forecastDriver === 'LUMP_SUM') return 'Lump sum';
  if (line.forecastDriver === 'QUANTITY_RATE') {
    const quantity = line.resolvedQuantity ?? line.quantity;
    const source = line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'Private-sale plots' : line.quantitySource === 'TOTAL_PLOTS' ? 'Total plots' : unitLabel(line);
    return `${quantity ?? '—'} ${source} × ${formatCvrMoney(line.rate || 0)} / ${unitLabel(line)}`;
  }
  return line.forecastDriver || 'Assumption not set';
}

function driverLabel(driver) {
  return DRIVERS.find(([value]) => value === driver)?.[1] || driver || 'Not set';
}

function companyDestinationLabel(line) {
  const destination = line.companyDestination;
  if (!destination) return 'Unmapped';
  return destination.label || [destination.code, destination.description].filter(Boolean).join(' \u2014 ') || 'Unmapped';
}

function pendingCalculationLabel(line) {
  if (line.forecastDriver === 'PERCENT_REVENUE') return `${Number(line.percent || 0).toFixed(2)}% of Forecast Revenue`;
  if (line.forecastDriver === 'LUMP_SUM') return 'Lump sum';
  if (line.forecastDriver === 'QUANTITY_RATE') {
    const source = line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'Private-sale plots' : line.quantitySource === 'TOTAL_PLOTS' ? 'Total plots' : `${line.quantity ?? '—'} ${unitLabel(line)}`;
    return `${source} × ${formatCvrMoney(line.rate || 0)} / ${unitLabel(line)}`;
  }
  return line.forecastDriver || 'Assumption not set';
}

function missingLabels(line) {
  const issues = new Set((line.issues || []).map(issue => typeof issue === 'string' ? issue : issue?.reason || issue?.code));
  if (issues.has('quantity_source')) return ['Plot Master tenure review required'];
  const missing = [];
  if (issues.has('assumption')) {
    if (line.forecastDriver === 'PERCENT_REVENUE') missing.push('Percentage');
    else if (line.forecastDriver === 'LUMP_SUM') missing.push('Lump sum');
    else {
      if ((line.quantitySource || 'MANUAL') === 'MANUAL' && (line.quantity == null || line.quantity === '')) missing.push('Quantity');
      if (line.rate == null || line.rate === '') missing.push('Rate');
      if (!missing.length) missing.push('Quantity × Rate assumption');
    }
  }
  if (issues.has('mapping')) missing.push('Cost Code');
  return missing.length ? [`Missing: ${missing.join(' · ')}`] : ['Setup requires review'];
}

export default function DevelopmentDetailedSellingCosts({ proposal, costCodes, commercialStructure, saving, onSave, onReviewPlotTenures, onReviewCvr }) {
  const [lines, setLines] = useState(() => cloneLines(proposal.lines));
  const [baseline, setBaseline] = useState(() => cloneLines(proposal.lines));
  const [expandedKey, setExpandedKey] = useState(null);
  const [editStart, setEditStart] = useState(null);
  const [saved, setSaved] = useState(false);
  const saveRequestedRef = useRef(false);
  const dirty = useMemo(() => JSON.stringify(lines) !== JSON.stringify(baseline), [baseline, lines]);

  useEffect(() => {
    const next = cloneLines(proposal.lines);
    setLines(next);
    setBaseline(cloneLines(next));
    setExpandedKey(null);
    setEditStart(null);
    if (saveRequestedRef.current) {
      setSaved(true);
      saveRequestedRef.current = false;
    }
  }, [proposal]);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (index, patch) => {
    setSaved(false);
    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  };
  const selectCode = (index, code) => {
    const matches = costCodes.filter(item => item.code === code);
    const selected = matches.length === 1 ? matches[0] : null;
    update(index, {
      destinationCostCodeId: selected?.id || null,
      destination: selected ? { ...selected, label: `${selected.code} — ${selected.description}`, active: selected.isActive !== false } : null,
      destinationOverridden: true,
    });
  };
  const cancelLine = index => {
    const key = lineKey(lines[index]);
    const original = editStart?.key === key ? editStart.line : baseline.find(line => lineKey(line) === key);
    if (original) setLines(current => current.map((line, i) => i === index ? { ...original } : line));
    setExpandedKey(null);
    setEditStart(null);
  };
  const toggleEditor = (line, expanded) => {
    if (expanded) {
      setExpandedKey(null);
      setEditStart(null);
    } else {
      setExpandedKey(lineKey(line));
      setEditStart({ key: lineKey(line), line: { ...line } });
    }
  };
  const revertAssumption = (index, line) => {
    const inherited = line.companyAssumption || {};
    update(index, {
      forecastDriver: inherited.driver || line.forecastDriver,
      driver: inherited.driver || line.forecastDriver,
      percent: inherited.percent ?? null,
      lumpSum: inherited.lumpSum ?? null,
      quantity: inherited.quantity ?? null,
      rate: inherited.rate ?? null,
      quantitySource: inherited.quantitySource || 'MANUAL',
      unitCode: inherited.unitCode || 'EACH',
      customUnitLabel: inherited.customUnitLabel || null,
      assumptionOverridden: false,
    });
  };

  return <section className="dev-selling-costs__detailed" aria-label="Detailed Selling Costs proposal">
    <dl className="dev-selling-costs__summary dev-selling-costs__summary--detailed">
      <div><dt>Forecast Revenue</dt><dd>{proposal.forecastRevenue == null ? '—' : formatCvrMoney(proposal.forecastRevenue)}</dd></div>
      <div><dt>Detailed Selling Costs</dt><dd>{formatCvrMoney(proposal.forecastSellingCosts || 0)}</dd></div>
      <div><dt>Readiness</dt><dd>{proposal.readyLineCount || 0} ready · {proposal.unreadyLineCount || 0} need attention</dd></div>
    </dl>
    <div className="dev-selling-costs__review-list">
      {lines.map((line, index) => {
        const key = lineKey(line);
        const authoritative = baseline.find(item => lineKey(item) === key) || line;
        const pending = JSON.stringify(line) !== JSON.stringify(authoritative);
        const expanded = expandedKey === key;
        const selectedId = line.destinationCostCodeId || line.destination?.id || '';
        const selected = costCodes.find(code => code.id === selectedId);
        const selectedCode = selected?.code || line.destination?.code || '';
        const destination = pending && selected ? `${selected.code} — ${selected.description}` : line.destination?.label || (selected ? `${selected.code} — ${selected.description}` : 'Unmapped');
        const issues = missingLabels(line);
        const tenureBlocked = !line.quantityEvidence?.ready && line.quantityEvidence?.reason === 'plot-tenure-unreviewed';
        return <article className={`dev-selling-costs__review-line${line.ready ? '' : ' dev-selling-costs__review-line--attention'}`} key={key}>
          <div className="dev-selling-costs__review-main">
            <div><h3>{line.name}</h3><p>{pending ? pendingCalculationLabel(line) : calculationLabel(line)}</p><p className="dev-selling-costs__destination-copy">→ {destination}</p></div>
            <div className="dev-selling-costs__review-result">{pending ? <><strong>Forecast: Recalculates on Save</strong><span>Last saved: {formatCvrMoney(authoritative.forecast || 0)}</span></> : <strong>{formatCvrMoney(line.forecast || 0)}</strong>}<span>{isOverridden(line) ? 'Development override' : 'Company assumption'}</span><span className={pending ? 'dev-selling-costs__pending' : line.ready ? 'dev-selling-costs__ready' : 'dev-selling-costs__needs-attention'}>{pending ? 'UNSAVED — SAVE TO RECALCULATE' : line.ready ? 'READY' : 'NEEDS ATTENTION'}</span></div>
            <div className="dev-selling-costs__review-actions">
              <button type="button" className="btn btn--secondary" aria-expanded={expanded} onClick={() => toggleEditor(line, expanded)}>{expanded ? 'Close' : line.ready ? 'Change' : 'Set up line'}</button>
              {tenureBlocked && onReviewPlotTenures ? <button type="button" className="btn btn--secondary" onClick={onReviewPlotTenures}>Review Plot Master tenures</button> : null}
            </div>
          </div>
          {!pending && !line.ready ? <div className="dev-selling-costs__line-issues" role="alert">{issues.length ? issues.map(issue => <span key={issue}>{issue}</span>) : <span>{line.quantityEvidence?.message || 'Setup requires review'}</span>}</div> : null}
          {pending && line.forecastDriver === 'QUANTITY_RATE' && line.quantitySource !== 'MANUAL' ? <p className="dev-selling-costs__source-note">{line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'Private-sale quantity' : 'Total plot quantity'} will resolve from Plot Master on Save</p> : !pending && line.forecastDriver === 'QUANTITY_RATE' && line.quantitySource !== 'MANUAL' && line.quantityEvidence?.ready ? <p className="dev-selling-costs__source-note">{line.resolvedQuantity} {line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'Private-sale plots' : 'Total plots'} · From Plot Master</p> : null}
          {expanded ? <div className="dev-selling-costs__line-editor" aria-label={`${line.name} override`}>
            <label>Driver<select className="input" value={line.forecastDriver} onChange={event => update(index, { forecastDriver: event.target.value, driver: event.target.value, assumptionOverridden: true })}>{DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {line.forecastDriver === 'PERCENT_REVENUE' ? <label>Percentage<input className="input" type="number" min="0" step="0.01" value={line.percent ?? ''} onChange={event => update(index, { percent: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })} /></label> : null}
            {line.forecastDriver === 'LUMP_SUM' ? <label>Amount<input className="input" type="number" min="0" step="0.01" value={line.lumpSum ?? ''} onChange={event => update(index, { lumpSum: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })} /></label> : null}
            {line.forecastDriver === 'QUANTITY_RATE' ? <>
              <label>Quantity source<select className="input" value={line.quantitySource || 'MANUAL'} onChange={event => update(index, { quantitySource: event.target.value, unitCode: event.target.value === 'MANUAL' ? (line.unitCode || 'EACH') : 'PLOTS', driver: line.forecastDriver, assumptionOverridden: true })}>{SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {(line.quantitySource || 'MANUAL') === 'MANUAL' ? <label>Quantity<input className="input" type="number" min="0" step="0.0001" value={line.quantity ?? ''} onChange={event => update(index, { quantity: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })} /></label> : <p className="dev-selling-costs__source-note">{pending ? `${line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'Private-sale quantity' : 'Total plot quantity'} will resolve from Plot Master on Save` : line.quantityEvidence?.ready ? `${line.resolvedQuantity} plots · From Plot Master` : line.quantityEvidence?.message || 'Plot quantity is not ready.'}</p>}
              <label>Rate<input className="input" type="number" min="0" step="0.01" value={line.rate ?? ''} onChange={event => update(index, { rate: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })} /></label>
              <label>Unit<select className="input" disabled={(line.quantitySource || 'MANUAL') !== 'MANUAL'} value={(line.quantitySource || 'MANUAL') === 'MANUAL' ? (line.unitCode || 'EACH') : 'PLOTS'} onChange={event => update(index, { unitCode: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })}>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></label>
              {line.unitCode === 'CUSTOM' && (line.quantitySource || 'MANUAL') === 'MANUAL' ? <label>Custom unit<input className="input" maxLength="40" value={line.customUnitLabel || ''} onChange={event => update(index, { customUnitLabel: event.target.value, driver: line.forecastDriver, assumptionOverridden: true })} /></label> : null}
            </> : null}
            <div><span>Development mapping</span><CommercialHeadCostCodePicker category="SELLING_COSTS" structure={commercialStructure} codes={costCodes} identity="code" name={`${line.name} Development Cost Code`} valueCode={selectedCode} onChange={code => selectCode(index, code)} allowClear /></div>
            <div className="dev-selling-costs__actions">
              {line.assumptionOverridden ? <div className="dev-selling-costs__maintenance-action"><button type="button" className="po-list-btn-secondary" onClick={() => revertAssumption(index, line)}>Use company calculation</button><small>Company: {driverLabel(line.companyAssumption?.driver)}</small></div> : null}
              {line.destinationOverridden ? <div className="dev-selling-costs__maintenance-action"><button type="button" className="po-list-btn-secondary" onClick={() => update(index, { destinationOverridden: false, destinationCostCodeId: null, destination: line.companyDestination || null })}>Use company Cost Code</button><small>Company: {companyDestinationLabel(line)}</small></div> : null}
              <button type="button" className="btn btn--secondary" onClick={() => cancelLine(index)}>Cancel</button>
            </div>
          </div> : null}
        </article>;
      })}
    </div>
    <details><summary>Cost Code aggregation</summary>{proposal.costCodeAggregation?.length ? <ul>{proposal.costCodeAggregation.map(item => <li key={item.costCode.id}>{item.costCode.label}: {formatCvrMoney(item.forecast)}</li>)}</ul> : <p>No ready mapped lines.</p>}</details>
    <div className="dev-selling-costs__save-bar">
      <div>{dirty ? <strong>Unsaved changes</strong> : saved ? <strong role="status">✓ Detailed Selling Costs saved</strong> : <span>Detailed Selling Costs saved</span>}</div>
      <div className="dev-selling-costs__actions"><button type="button" disabled={saving || !dirty} onClick={async () => { saveRequestedRef.current = true; try { await onSave(lines); } catch { saveRequestedRef.current = false; } }}>{saving ? 'Saving…' : 'Save Detailed Selling Costs'}</button><button type="button" disabled={saving || dirty || !onReviewCvr} onClick={onReviewCvr}>Review against CVR</button></div>
      <small>{dirty ? 'Save Detailed Selling Costs before reviewing against CVR.' : 'Review the authoritative Detailed proposal before deliberate CVR adoption.'}</small>
    </div>
  </section>;
}
