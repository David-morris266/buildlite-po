import { memo } from 'react';
import { formatCvrMoney } from '../cvr/cvrHelpers';

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

function totalLabel(rows, key) {
  return formatCvrMoney(rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0));
}

function CVRTable({ rows, totals, comparison, onRowSelect, selectedRow = null, onBudgetChange, readOnly = false }) {
  const movementByKey = new Map((comparison?.rows || []).map((row) => [keyOf(row.costCodeKey), row]));
  const selectedKey = keyOf(selectedRow?.costCodeKey);
  return <div className="dev-cvr__table-wrap">
    <div className="dev-cvr__grid-viewport" role="region" aria-label="CVR cost code grid">
      <table className="po-data-table dev-cvr__table dev-cvr__table--balanced">
        <colgroup><col className="dev-cvr__column-code" /><col className="dev-cvr__column-description" /><col className="dev-cvr__column-money" /><col className="dev-cvr__column-money" /><col className="dev-cvr__column-money" /><col className="dev-cvr__column-money" /><col className="dev-cvr__column-variance" /></colgroup>
        <thead><tr><th className="dev-cvr__col-code">Cost Code</th><th className="dev-cvr__col-desc">Description</th><th className="dev-cvr__money-col">Current Budget</th><th className="dev-cvr__money-col">Previous CVR</th><th className="dev-cvr__money-col">Current CVR</th><th className="dev-cvr__money-col">Movement</th><th className="dev-cvr__money-col">Variance to Budget</th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => {
          const movement = movementByKey.get(keyOf(row.costCodeKey));
          const hasAdjustment = Math.abs(Number(row.commercialAdjustment) || 0) > 0.005;
          const selected = Boolean(selectedKey && selectedKey === keyOf(row.costCodeKey));
          return <tr key={row.id} data-cost-code-key={row.costCodeKey} className={selected ? 'dev-cvr__row--selected' : undefined}><td className="dev-cvr__col-code"><div className="dev-cvr__row-link-wrap"><button type="button" className="dev-cvr__row-link" aria-current={selected ? 'true' : undefined} aria-label={`Open Cost Code ${codeOf(row)} — ${descriptionOf(row)}`} onClick={(event) => onRowSelect?.(row, event.currentTarget)} title="Open Cost Code Storyboard">{codeOf(row)}</button>{hasAdjustment ? <span className={`dev-cvr__adjustment-badge dev-cvr__adjustment-badge--${row.adjustmentState || 'zero'}`} title={`Commercial adjustment: ${row.commercialAdjustmentLabel}`}>Adj</span> : null}</div></td>
            <td className="dev-cvr__col-desc">{descriptionOf(row)}</td>
            <td className="dev-cvr__money-col">{readOnly || !onBudgetChange ? row.currentBudgetLabel : <EditableMoneyCell key={`${row.id}-current-${row.currentBudget}`} rawValue={row.currentBudget} label={row.currentBudgetLabel} onChange={(value) => onBudgetChange?.(row, 'currentBudget', value)} />}</td>
            <td className="dev-cvr__money-col">{movement?.previousForecastLabel || '—'}</td><td className="dev-cvr__money-col">{movement?.currentForecastLabel || row.finalForecastLabel}</td>
            <td className="dev-cvr__money-col"><span className={movement?.movement > 0 ? 'cvr-movement--adverse' : movement?.movement < 0 ? 'cvr-movement--favourable' : ''}>{movement?.movementLabel || '—'}</span></td>
            <td className="dev-cvr__money-col"><VarianceCell label={row.varianceLabel} state={row.varianceState} /></td></tr>;
        }) : <tr><td colSpan={7} className="po-data-table__empty">No cost codes yet. Add a cost code or import ledger / approve purchase orders to populate the CVR.</td></tr>}</tbody>
        {rows.length ? <tfoot><tr className="dev-cvr__totals-row"><td className="dev-cvr__col-code" colSpan={2}><strong>Totals</strong></td><td className="dev-cvr__money-col"><strong>{totals.currentBudgetLabel}</strong></td><td className="dev-cvr__money-col"><strong>{comparison?.available ? totalLabel(comparison.rows, 'previousForecast') : '—'}</strong></td><td className="dev-cvr__money-col"><strong>{totals.finalForecastLabel}</strong></td><td className="dev-cvr__money-col"><strong>{comparison?.totalMovementLabel || '—'}</strong></td><td className="dev-cvr__money-col"><VarianceCell label={totals.varianceLabel} state={totals.varianceState} /></td></tr></tfoot> : null}
      </table>
    </div>
    <p className="dev-cvr__table-hint">Period movement compares this CVR with the immediately preceding Locked CVR. Select a Cost Code to open its Storyboard.</p>
  </div>;
}

export default memo(CVRTable);
