import { memo } from 'react';

function EditableMoneyCell({ rawValue, label, onChange }) {
  return <input className="dev-cvr__cell-input" type="text" inputMode="decimal" defaultValue={rawValue == null ? '' : String(rawValue)} placeholder={label === '—' ? '—' : label} onBlur={(event) => onChange?.(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Edit amount" />;
}

function VarianceCell({ label, state }) {
  return <span className={`dev-cvr__variance dev-cvr__variance--${state || 'neutral'}`}>{label}</span>;
}

const keyOf = (value) => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
const codeOf = (row) => String(row.costCodeKey || '').trim().toUpperCase() || row.costCodeLabel || '—';
function descriptionOf(row) {
  if (String(row.description || '').trim()) return row.description.trim();
  const label = String(row.costCodeLabel || '');
  const split = label.indexOf(' — ');
  return split >= 0 ? label.slice(split + 3).trim() || '—' : '—';
}

function CVRTable({ rows, totals, comparison, onRowSelect, selectedRow = null, onBudgetChange, readOnly = false }) {
  const movementByKey = new Map((comparison?.rows || []).map((row) => [keyOf(row.costCodeKey), row]));
  const selectedKey = keyOf(selectedRow?.costCodeKey);
  return <div className="dev-cvr__table-wrap">
    <div className="dev-cvr__grid-viewport" role="region" aria-label="CVR cost code grid">
      <table className="po-data-table dev-cvr__table dev-cvr__table--balanced dev-cvr__table--commercial-review">
        <colgroup><col className="dev-cvr__column-code" /><col className="dev-cvr__column-description" />{Array.from({ length: 8 }, (_, index) => <col key={index} className="dev-cvr__column-money" />)}</colgroup>
        <thead><tr><th className="dev-cvr__col-code">Cost Code</th><th className="dev-cvr__col-desc">Description</th><th className="dev-cvr__money-col">Budget</th><th className="dev-cvr__money-col" title="Actual ledger cost plus Manual Accrual">Current Cost</th><th className="dev-cvr__money-col" title="Cost to Complete">CTC</th><th className="dev-cvr__money-col" title="Gross residual baseline allowance">Uncommitted</th><th className="dev-cvr__money-col">Change Exposure</th><th className="dev-cvr__money-col">Current CVR</th><th className="dev-cvr__money-col" title="Movement from the immediately preceding Locked CVR">Movement</th><th className="dev-cvr__money-col" title="Variance to Budget">Variance</th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => {
          const movement = movementByKey.get(keyOf(row.costCodeKey));
          const hasAdjustment = Math.abs(Number(row.commercialAdjustment) || 0) > 0.005;
          const selected = Boolean(selectedKey && selectedKey === keyOf(row.costCodeKey));
          return <tr key={row.id} data-cost-code-key={row.costCodeKey} className={selected ? 'dev-cvr__row--selected' : undefined}><td className="dev-cvr__col-code"><div className="dev-cvr__row-link-wrap"><button type="button" className="dev-cvr__row-link" aria-current={selected ? 'true' : undefined} aria-label={`Open Cost Code ${codeOf(row)} — ${descriptionOf(row)}`} onClick={(event) => onRowSelect?.(row, event.currentTarget)} title="Open Cost Code Storyboard">{codeOf(row)}</button>{hasAdjustment ? <span className={`dev-cvr__adjustment-badge dev-cvr__adjustment-badge--${row.adjustmentState || 'zero'}`} title={`Commercial adjustment: ${row.commercialAdjustmentLabel}`}>Adj</span> : null}</div></td><td className="dev-cvr__col-desc">{descriptionOf(row)}</td><td className="dev-cvr__money-col">{readOnly || !onBudgetChange ? row.currentBudgetLabel : <EditableMoneyCell key={`${row.id}-current-${row.currentBudget}`} rawValue={row.currentBudget} label={row.currentBudgetLabel} onChange={(value) => onBudgetChange?.(row, 'currentBudget', value)} />}</td><td className="dev-cvr__money-col">{row.currentCostLabel}</td><td className="dev-cvr__money-col">{row.costToCompleteLabel}</td><td className="dev-cvr__money-col">{row.uncommittedForecastLabel}</td><td className="dev-cvr__money-col">{row.changeExposureLabel}</td><td className="dev-cvr__money-col">{movement?.currentForecastLabel || row.finalForecastLabel}</td><td className="dev-cvr__money-col"><span className={movement?.movement > 0 ? 'cvr-movement--adverse' : movement?.movement < 0 ? 'cvr-movement--favourable' : ''}>{movement?.movementLabel || '—'}</span></td><td className="dev-cvr__money-col"><VarianceCell label={row.varianceLabel} state={row.varianceState} /></td></tr>;
        }) : <tr><td colSpan={10} className="po-data-table__empty">No cost codes yet. Add a cost code or import ledger / approve purchase orders to populate the CVR.</td></tr>}</tbody>
        {rows.length ? <tfoot><tr className="dev-cvr__totals-row"><td className="dev-cvr__col-code" colSpan={2}><strong>Totals</strong></td><td className="dev-cvr__money-col"><strong>{totals.currentBudgetLabel}</strong></td><td className="dev-cvr__money-col"><strong>{totals.currentCostLabel}</strong></td><td className="dev-cvr__money-col"><strong>{totals.costToCompleteLabel}</strong></td><td className="dev-cvr__money-col"><strong>{totals.uncommittedForecastLabel}</strong></td><td className="dev-cvr__money-col"><strong>{totals.changeExposureLabel}</strong></td><td className="dev-cvr__money-col"><strong>{totals.finalForecastLabel}</strong></td><td className="dev-cvr__money-col"><strong>{comparison?.totalMovementLabel || '—'}</strong></td><td className="dev-cvr__money-col"><VarianceCell label={totals.varianceLabel} state={totals.varianceState} /></td></tr></tfoot> : null}
      </table>
    </div>
    <p className="dev-cvr__table-hint">Current Cost is Actual ledger cost plus Manual Accrual. CTC is Cost to Complete. Uncommitted is the gross residual baseline allowance. Movement compares with the immediately preceding Locked CVR. Select a Cost Code to open its Storyboard.</p>
  </div>;
}

export default memo(CVRTable);
