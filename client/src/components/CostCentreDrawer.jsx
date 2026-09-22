import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { formatPoDate, formatPoDateTime } from './poDrawerHelpers';
import { getAdjustmentState, enrichCvrForecastRow } from '../cvr/cvrForecastEngine';
import { CVR_HISTORIC_DRAWER_NOTE } from '../cvr/cvrHistoricConstants';
import { resolveCommercialAdjustmentOwnership } from '../cvr/cvrCommercialAdjustmentOwnership';

function parseMoney(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function moneyChanged(left, right) {
  const a = parseMoney(left);
  const b = parseMoney(right);
  return a == null || b == null ? a !== b : Math.abs(a - b) > 0.005;
}

function formatSignedMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) <= 0.005) return formatCvrMoney(0);
  return amount > 0 ? `+${formatCvrMoney(amount)}` : `-${formatCvrMoney(Math.abs(amount))}`;
}

function displayAdjustmentHistoryReason(value) {
  return String(value || '').replace(/â€“|â€”/g, '—');
}

function StoryboardShell({ open, sideBySide, title, onClose, children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    if (!sideBySide) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeRef.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!sideBySide) {
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [open, sideBySide]);

  if (!open) return null;
  const panel = (
    <aside
      ref={panelRef}
      className={`dev-cvr-storyboard${sideBySide ? ' dev-cvr-storyboard--side' : ' dev-cvr-storyboard--sheet'}`}
      role={sideBySide ? 'region' : 'dialog'}
      aria-modal={sideBySide ? undefined : 'true'}
      aria-label={`Cost Code Storyboard for ${title}`}
      tabIndex={-1}
    >
      {children}
    </aside>
  );
  if (sideBySide) return panel;
  return createPortal(<><div className="po-drawer-backdrop dev-cvr-storyboard__backdrop" aria-hidden="true" onClick={onClose} />{panel}</>, document.body);
}

function Section({ title, children, emphasis = false }) {
  return <section className={`dev-cvr-storyboard__section${emphasis ? ' dev-cvr-storyboard__section--emphasis' : ''}`}><h3>{title}</h3>{children}</section>;
}

function reportingPeriodLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '\u2014';
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

function detailedLineBasis(line, forecastRevenue) {
  if (line.driver === 'PERCENT_REVENUE') return `${Number(line.percent || 0).toFixed(2)}% of ${formatCvrMoney(forecastRevenue || 0)}`;
  if (line.driver === 'LUMP_SUM') return 'Lump sum';
  if (line.driver === 'QUANTITY_RATE') {
    const quantity = line.resolvedQuantity ?? line.quantity;
    const source = line.quantitySource === 'PRIVATE_SALE_PLOTS' ? 'private-sale plots' : line.quantitySource === 'TOTAL_PLOTS' ? 'total plots' : String(line.customUnitLabel || line.unitCode || 'units').toLowerCase();
    const unit = String(line.customUnitLabel || line.unitCode || 'unit').toLowerCase().replace(/s$/, '');
    return `${quantity ?? '\u2014'} ${source} \u00d7 ${formatCvrMoney(line.rate || 0)} / ${unit}`;
  }
  return line.driver || 'Basis not captured';
}

function SellingCostsEvidence({ metadata }) {
  const adoption = metadata?.sellingCostsAdoption;
  const detailed = adoption?.detailedEvidence;
  if (!detailed || !Array.isArray(detailed.lines)) return null;
  const forecastRevenue = detailed.forecastRevenue ?? adoption.forecastRevenueAtAdoption;
  return <section className="dev-cvr-storyboard__workflow-evidence" aria-label="Selling Costs Detailed adoption evidence">
    <h4>Selling Costs &mdash; Detailed</h4>
    <dl><div><dt>Adopted forecast</dt><dd>{formatCvrMoney(detailed.aggregate ?? adoption.adoptedTargetFinal ?? adoption.adoptedAdjustment)}</dd></div></dl>
    <ul>{detailed.lines.map((line) => <li key={line.id || line.name}>
      <div><strong>{line.name}</strong><strong>{formatCvrMoney(line.forecast)}</strong></div>
      <span>{detailedLineBasis(line, forecastRevenue)}</span>
      <span>{line.assumptionOverridden ? 'Development calculation override' : 'Company assumption'}</span>
      {line.destinationOverridden ? <span>Development Cost Code override</span> : null}
      {line.quantityEvidence?.message ? <span>{line.quantityEvidence.message}</span> : null}
    </li>)}</ul>
    <dl>
      {forecastRevenue != null ? <div><dt>Forecast Revenue used</dt><dd>{formatCvrMoney(forecastRevenue)}</dd></div> : null}
      {(detailed.reportingMonth || adoption.reportingMonth) ? <div><dt>CVR reporting period</dt><dd>{reportingPeriodLabel(detailed.reportingMonth || adoption.reportingMonth)}</dd></div> : null}
    </dl>
  </section>;
}

function EvidenceTables({ packages, ledgerRows, certificates, ledgerReady, ledgerError, movement, displayMetadata }) {
  const packageTotal = packages.reduce((sum, item) => sum + (Number(item.committedValue) || 0), 0);
  const ledgerTotal = ledgerRows.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0);
  return <details className="dev-cvr-storyboard__disclosure"><summary>Supporting evidence</summary><div className="dev-cvr-storyboard__disclosure-body">
    <SellingCostsEvidence metadata={displayMetadata} />
    {movement?.hierarchyChanged ? <p><strong>Hierarchy changed:</strong> {movement.previousHierarchy?.label || '—'} → {movement.currentHierarchy?.label || '—'}</p> : null}
    <h4>Packages / commitments</h4>
    {packages.length ? <div className="po-table-wrap"><table className="po-data-table dev-cvr-drawer__table"><thead><tr><th>Supplier</th><th>POs</th><th className="dev-cvr__money-col">Committed</th><th className="dev-cvr__money-col">Certified</th></tr></thead><tbody>{packages.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.poNumbers?.join(', ') || '—'}</td><td className="dev-cvr__money-col">{formatCvrMoney(item.committedValue)}</td><td className="dev-cvr__money-col">{formatCvrMoney(item.certifiedValue)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}><strong>Total</strong></td><td className="dev-cvr__money-col"><strong>{formatCvrMoney(packageTotal)}</strong></td><td /></tr></tfoot></table></div> : <p>No packages for this Cost Code.</p>}
    <h4>Approved Certificates</h4>
    {certificates.length ? <div className="po-table-wrap"><table className="po-data-table dev-cvr-drawer__table"><thead><tr><th>Package</th><th>Certificate</th><th>Date</th><th className="dev-cvr__money-col">Value</th></tr></thead><tbody>{certificates.map((item) => <tr key={item.id}><td>{item.packageLabel}</td><td>{item.certificateNumber}</td><td>{formatPoDate(item.certificateDate)}</td><td className="dev-cvr__money-col">{formatCvrMoney(item.certifiedValue)}</td></tr>)}</tbody></table></div> : <p>No approved certificates for this Cost Code.</p>}
    <h4>Ledger Transactions</h4>
    {!ledgerReady ? <p role="status">{ledgerError ? 'Unable to load ledger data' : 'Loading ledger data…'}</p> : ledgerRows.length ? <div className="po-table-wrap"><table className="po-data-table dev-cvr-drawer__table"><thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th className="dev-cvr__money-col">Amount</th></tr></thead><tbody>{ledgerRows.map((item) => <tr key={item.id}><td>{formatPoDate(item.date)}</td><td>{item.supplier || '—'}</td><td>{item.invoiceNumber || '—'}</td><td className="dev-cvr__money-col">{formatCvrMoney(item.netAmount)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}><strong>Total</strong></td><td className="dev-cvr__money-col"><strong>{formatCvrMoney(ledgerTotal)}</strong></td></tr></tfoot></table></div> : <p>No ledger transactions for this Cost Code.</p>}
  </div></details>;
}

export default function CostCentreDrawer({
  open, row, movement, packages = [], ledgerRows = [], certificates = [], ledgerReady = true,
  ledgerError = false, readOnly = false, historic = false, onClose, onSaveNotes,
  onSaveCommercialAdjustment, onOpenVariationAccount, onOpenAdjustmentWorkflow,
  storyboard = false, sideBySide = false,
}) {
  const title = row?.costCodeLabel || 'Cost Code';
  const [adjustment, setAdjustment] = useState('');
  const [reason, setReason] = useState('');
  const [accrual, setAccrual] = useState('');
  const [notes, setNotes] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveErrorScope, setSaveErrorScope] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [manualReplacement, setManualReplacement] = useState(false);
  const isHistoric = Boolean(historic || row?.historic);
  const displayRow = useMemo(() => row ? (isHistoric ? row : enrichCvrForecastRow(row)) : null, [row, isHistoric]);
  const rowId = row?.id;
  const rowAdjustment = row?.commercialAdjustment;
  const rowReason = row?.commercialReason;
  const rowAccrual = row?.manualAccrual;
  const rowNotes = row?.commercialNotes;

  useEffect(() => {
    if (!rowId) return;
    setAdjustment(rowAdjustment == null ? '' : String(rowAdjustment));
    setReason(rowReason || '');
    setAccrual(rowAccrual == null ? '' : String(rowAccrual));
    setNotes(rowNotes || '');
    setManualReplacement(false);
    setSaveError(''); setSaveErrorScope('');
  }, [rowId, rowAdjustment, rowReason, rowAccrual, rowNotes]);

  useEffect(() => {
    setSaveSuccess('');
  }, [rowId]);

  if (!row || !displayRow) return null;
  const adjustmentValue = parseMoney(adjustment);
  const reasonRequired = adjustmentValue != null && Math.abs(adjustmentValue) > 0.005;
  const reasonMissing = (reasonRequired || manualReplacement) && !reason.trim();
  const adjustmentDirty = moneyChanged(adjustment, displayRow.commercialAdjustment) || reason.trim() !== String(displayRow.commercialReason || '').trim();
  const accrualDirty = moneyChanged(accrual, displayRow.manualAccrual);
  const adjustmentOwnership = resolveCommercialAdjustmentOwnership(row);
  const workflowOwned = adjustmentOwnership.kind === 'workflow' && !manualReplacement;

  async function saveAdjustment() {
    if (readOnly || !adjustmentDirty || reasonMissing || adjustmentValue == null) return;
    const result = await Promise.resolve(onSaveCommercialAdjustment?.({ commercialAdjustment: adjustment, commercialReason: reason }));
    if (result?.ok === false) { setSaveError(result.errors?.[0] || 'Could not save commercial adjustment.'); setSaveErrorScope('adjustment'); setSaveSuccess(''); return; }
    setSaveError(''); setSaveErrorScope(''); setSaveSuccess('Commercial adjustment saved.');
  }
  async function saveAccrual() {
    const value = parseMoney(accrual);
    if (readOnly || !accrualDirty) return;
    if (value == null) { setSaveError('Manual accrual must be a number.'); setSaveErrorScope('accrual'); return; }
    const result = await Promise.resolve(onSaveNotes?.({ manualAccrual: value }));
    if (result?.ok === false) { setSaveError(result.errors?.[0] || 'Could not save manual accrual.'); setSaveErrorScope('accrual'); return; }
    setSaveError(''); setSaveErrorScope(''); setSaveSuccess('Manual accrual saved.');
  }
  async function saveNotes() {
    if (readOnly) return;
    const result = await Promise.resolve(onSaveNotes?.({ commercialNotes: notes }));
    if (result?.ok === false) { setSaveError(result.errors?.[0] || 'Could not save notes.'); setSaveErrorScope('notes'); setNotes(row.commercialNotes || ''); }
  }

  const Shell = StoryboardShell;
  return <Shell open={open} sideBySide={storyboard ? sideBySide : true} title={title} onClose={onClose}>
    <header className="dev-cvr-storyboard__header"><div><span>Cost Code Storyboard</span><h2>{title}</h2></div><button type="button" className="po-list-btn-secondary" onClick={onClose}>{sideBySide ? 'Close' : 'Back to Worksheet'}</button></header>
    <div className="dev-cvr-storyboard__body">
      <dl className="dev-cvr-storyboard__movement" aria-label="Cost Code period movement">
        <div><dt>Previous CVR</dt><dd>{movement?.previousForecastLabel || 'Unavailable'}</dd></div>
        <div><dt>Current CVR</dt><dd>{movement?.currentForecastLabel || formatCvrMoney(displayRow.finalForecast)}</dd></div>
        <div className="dev-cvr-storyboard__movement-primary"><dt>Movement</dt><dd className={Number(movement?.movement) > 0 ? 'cvr-movement--adverse' : Number(movement?.movement) < 0 ? 'cvr-movement--favourable' : ''}>{movement?.movementLabel || 'Unavailable'}</dd></div>
        <div><dt>Current Budget</dt><dd>{formatCvrMoney(displayRow.currentBudget)}</dd></div>
        <div><dt>Variance to Budget</dt><dd className={`dev-cvr__variance dev-cvr__variance--${displayRow.varianceState || 'neutral'}`}>{formatCvrMoney(displayRow.variance)}</dd></div>
      </dl>

      <Section title="Forecast position" emphasis>
        {isHistoric ? <p role="status">{CVR_HISTORIC_DRAWER_NOTE}</p> : null}
        <dl className="dev-cvr-storyboard__forecast">
          <div><dt>Committed</dt><dd>{formatCvrMoney(displayRow.committed)}</dd></div><div><dt>Certified</dt><dd>{formatCvrMoney(displayRow.certified)}</dd></div><div><dt>Actual</dt><dd>{formatCvrMoney(displayRow.actualCost)}</dd></div><div><dt>Manual Accrual</dt><dd>{formatCvrMoney(displayRow.manualAccrual)}</dd></div><div><dt>Current Cost</dt><dd>{formatCvrMoney(displayRow.currentCost)}</dd></div><div><dt>System Forecast</dt><dd>{formatCvrMoney(displayRow.systemForecast)}</dd></div><div><dt>Expected Liability</dt><dd>{formatCvrMoney(displayRow.expectedLiability)}</dd></div><div><dt>Variation Account exposure</dt><dd>{formatCvrMoney(displayRow.vaExposureUplift)}</dd></div><div><dt>Commercial Adjustment</dt><dd>{formatCvrMoney(displayRow.commercialAdjustment)}</dd></div><div className="dev-cvr-storyboard__forecast-primary"><dt>Final Forecast</dt><dd>{formatCvrMoney(displayRow.finalForecast)}</dd></div><div><dt>Cost to Complete</dt><dd>{formatCvrMoney(displayRow.costToComplete)}</dd></div>
        </dl>
      </Section>

      <Section title="Commercial Adjustment">
        {readOnly || isHistoric ? <p>This period is read-only. Commercial Adjustment cannot be changed.{displayRow.commercialReason ? ` Reason: ${displayRow.commercialReason}` : ''}</p> : workflowOwned ? <div className="dev-cvr-storyboard__workflow-adjustment"><strong className={`dev-cvr__adjustment--${getAdjustmentState(displayRow.commercialAdjustment)}`}>{formatSignedMoney(displayRow.commercialAdjustment)}</strong><dl className="dev-cvr-storyboard__forecast"><div><dt>Source</dt><dd>{adjustmentOwnership.sourceLabel}</dd></div><div><dt>Reason</dt><dd>{adjustmentOwnership.reasonLabel}</dd></div>{adjustmentOwnership.changedAt ? <div><dt>Changed</dt><dd>{formatPoDateTime(adjustmentOwnership.changedAt)}</dd></div> : null}{adjustmentOwnership.changedBy ? <div><dt>By</dt><dd>{adjustmentOwnership.changedBy}</dd></div> : null}{adjustmentOwnership.reportingMonth ? <div><dt>CVR Reporting Period</dt><dd>{adjustmentOwnership.reportingPeriodLabel}</dd></div> : null}</dl><p>Managed through {adjustmentOwnership.sourceLabel}.</p><div className="dev-cvr-storyboard__actions"><button type="button" className="po-list-btn-secondary" onClick={() => onOpenAdjustmentWorkflow?.(adjustmentOwnership)}>{adjustmentOwnership.actionLabel}</button><button type="button" className="po-list-btn-secondary" onClick={() => { setManualReplacement(true); setReason(''); setSaveError(''); setSaveSuccess(''); }}>Replace with manual adjustment</button></div></div> : <>{manualReplacement ? <p className="po-list-feedback po-list-feedback--warning">This manual adjustment will supersede the currently adopted {adjustmentOwnership.sourceLabel} position for this Cost Code. The original adoption evidence will remain in History &amp; notes.</p> : null}<div className="dev-cvr-drawer__adjustment-fields"><label className="dev-form__field"><span className="dev-form__label">Adjustment</span><input className={`input dev-cvr-drawer__adjustment-input dev-cvr__adjustment--${getAdjustmentState(adjustmentValue || 0)}`} value={adjustment} inputMode="decimal" aria-describedby="commercial-adjustment-help" onChange={(event) => { setAdjustment(event.target.value); setSaveError(''); setSaveSuccess(''); }} /><small id="commercial-adjustment-help">Positive or negative. Zero for no adjustment.</small></label><label className="dev-form__field dev-cvr-drawer__reason-field"><span className="dev-form__label">Reason {(reasonRequired || manualReplacement) ? <small>Required</small> : null}</span><input className="input dev-cvr-drawer__reason-input" value={reason} aria-required={reasonRequired || manualReplacement} aria-invalid={reasonMissing} onChange={(event) => { setReason(event.target.value); setSaveError(''); setSaveSuccess(''); }} /></label></div>{reasonMissing ? <p className="po-list-feedback po-list-feedback--warning">Commercial Reason is required for this adjustment.</p> : null}{saveErrorScope === 'adjustment' ? <p className="po-list-feedback po-list-feedback--error" role="alert">{saveError}</p> : null}{saveSuccess === 'Commercial adjustment saved.' ? <p className="po-list-feedback po-list-feedback--success" role="status">{saveSuccess}</p> : null}<div className="dev-cvr-storyboard__actions"><button type="button" className="po-btn-primary dev-cvr-drawer__save-adjustment" disabled={!adjustmentDirty || reasonMissing || adjustmentValue == null} title={adjustmentDirty ? 'Save commercial adjustment' : 'No unsaved commercial adjustment changes'} onClick={saveAdjustment}>Save commercial adjustment</button></div></>}
      </Section>

      <Section title="Manual Accrual">
        {readOnly || isHistoric ? <p>This period is read-only. Manual Accrual cannot be changed.</p> : <><label className="dev-form__field"><span className="dev-form__label">Cost incurred not yet in the ledger</span><input className="input" value={accrual} inputMode="decimal" aria-describedby="manual-accrual-help" onChange={(event) => { setAccrual(event.target.value); setSaveError(''); setSaveSuccess(''); }} /><small id="manual-accrual-help">Does not change commitment, certified or ledger actual.</small></label>{saveErrorScope === 'accrual' ? <p className="po-list-feedback po-list-feedback--error" role="alert">{saveError}</p> : null}{saveSuccess === 'Manual accrual saved.' ? <p className="po-list-feedback po-list-feedback--success" role="status">{saveSuccess}</p> : null}<div className="dev-cvr-storyboard__actions"><button type="button" className="po-btn-primary dev-cvr-drawer__save-accrual" disabled={!accrualDirty} title={accrualDirty ? 'Save manual accrual' : 'No unsaved accrual changes'} onClick={saveAccrual}>Save accrual</button></div></>}
      </Section>

      {displayRow.variationExposureItems?.length ? <Section title="Variation Account">{displayRow.variationExposureItems.map((item) => <article key={item.variationAccountItemId} className="dev-cvr-storyboard__va"><div><strong>{item.reference || 'Unreferenced item'}</strong><span>{formatCvrMoney(item.vaExposureUplift)} CVR uplift</span></div>{item.exceptions?.length ? <p className="po-list-feedback po-list-feedback--warning">{item.exceptions.join(', ')}</p> : null}{item.variationAccountItemId && item.packageId ? <button type="button" className="cvr-summary__link-btn" onClick={() => onOpenVariationAccount?.({ id: item.variationAccountItemId, packageId: item.packageId, reference: item.reference })}>Open Variation Account item</button> : null}<details><summary>Authority detail</summary><dl className="dev-cvr-storyboard__forecast"><div><dt>QS Forecast</dt><dd>{formatCvrMoney(item.qsForecast)}</dd></div><div><dt>Recognised Authority</dt><dd>{formatCvrMoney(item.effectiveRecognisedAuthority)}</dd></div><div><dt>Commercial Event authority</dt><dd>{formatCvrMoney(item.authorityComposition?.effectiveCommercialEvent)}</dd></div><div><dt>Issued Variation Order authority</dt><dd>{formatCvrMoney(item.authorityComposition?.effectiveVariationOrder)}</dd></div><div><dt>Payment Authority</dt><dd>{formatCvrMoney(item.authorityComposition?.effectivePaymentAuthority)}</dd></div><div><dt>Remaining Exposure</dt><dd>{formatCvrMoney(item.remainingForecastExposure)}</dd></div></dl></details></article>)}</Section> : null}

      {!isHistoric ? <EvidenceTables packages={packages} ledgerRows={ledgerRows} certificates={certificates} ledgerReady={ledgerReady} ledgerError={ledgerError} movement={movement} displayMetadata={displayRow.displayMetadata} /> : null}
      <details className="dev-cvr-storyboard__disclosure"><summary>History &amp; notes</summary><div className="dev-cvr-storyboard__disclosure-body">{row.adjustmentHistory?.length ? <ul className="dev-cvr-drawer__history">{row.adjustmentHistory.map((entry) => <li key={entry.id}><strong>{formatCvrMoney(entry.previousAdjustment)} → {formatCvrMoney(entry.newAdjustment)}</strong><span>{displayAdjustmentHistoryReason(entry.reason || entry.newReason) || '—'}</span><span>{entry.user || '—'} · {formatPoDate(entry.date)}</span></li>)}</ul> : <p>No Commercial Adjustments recorded yet.</p>}<label className="dev-form__field"><span className="dev-form__label">Notes</span><textarea className="input dev-cvr-drawer__notes" rows={3} value={notes} readOnly={readOnly || isHistoric} onChange={(event) => setNotes(event.target.value)} onBlur={() => void saveNotes()} /></label>{saveErrorScope === 'notes' ? <p className="po-list-feedback po-list-feedback--error" role="alert">{saveError}</p> : null}</div></details>
    </div>
  </Shell>;
}
