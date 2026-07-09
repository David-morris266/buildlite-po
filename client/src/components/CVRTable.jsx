function EditableMoneyCell({ rawValue, label, onChange }) {
  return (
    <input
      className="dev-cvr__cell-input"
      type="text"
      inputMode="decimal"
      defaultValue={rawValue == null ? '' : String(rawValue)}
      placeholder={label === '—' ? '—' : label}
      onBlur={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      aria-label="Edit amount"
    />
  );
}

function VarianceCell({ label, state }) {
  return (
    <span className={`dev-cvr__variance dev-cvr__variance--${state || 'neutral'}`}>
      {label}
    </span>
  );
}

function formatCostCodeCell(row) {
  const key = String(row.costCodeKey || '').trim();
  if (key) return key.toUpperCase();
  return row.costCodeLabel || '—';
}

function formatDescriptionCell(row) {
  const description = String(row.description || '').trim();
  if (description) return description;

  const label = String(row.costCodeLabel || '').trim();
  const separator = label.indexOf(' — ');
  if (separator >= 0) {
    return label.slice(separator + 3).trim() || '—';
  }

  return '—';
}

function hasCommercialAdjustment(row) {
  const value = Number(row.commercialAdjustment);
  return Number.isFinite(value) && Math.abs(value) > 0.005;
}

export default function CVRTable({ rows, totals, onRowSelect, onBudgetChange, readOnly = false }) {
  return (
    <div className="dev-cvr__table-wrap">
      <div className="po-table-wrap dev-cvr__table-scroll">
        <table className="po-data-table dev-cvr__table">
          <thead>
            <tr>
              <th>Cost Code</th>
              <th>Description</th>
              <th className="dev-cvr__money-col">Current Budget</th>
              <th className="dev-cvr__money-col">Committed</th>
              <th className="dev-cvr__money-col">Certified</th>
              <th className="dev-cvr__money-col">Actual</th>
              <th className="dev-cvr__money-col">System Forecast</th>
              <th className="dev-cvr__money-col">Final Forecast</th>
              <th className="dev-cvr__money-col">CTC</th>
              <th className="dev-cvr__money-col">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="dev-cvr__row-link-wrap">
                      <button
                        type="button"
                        className="dev-cvr__row-link"
                        onClick={() => onRowSelect?.(row)}
                        title="Open cost code details and commercial adjustment"
                      >
                        {formatCostCodeCell(row)}
                      </button>
                      {hasCommercialAdjustment(row) ? (
                        <span
                          className={`dev-cvr__adjustment-badge dev-cvr__adjustment-badge--${row.adjustmentState || 'zero'}`}
                          title={`Commercial adjustment: ${row.commercialAdjustmentLabel}`}
                        >
                          Adj
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="dev-cvr__description" title={formatDescriptionCell(row)}>
                    {formatDescriptionCell(row)}
                  </td>
                  <td className="dev-cvr__money-col">
                    {readOnly || !onBudgetChange ? (
                      row.currentBudgetLabel
                    ) : (
                      <EditableMoneyCell
                        key={`${row.id}-current-${row.currentBudget}`}
                        rawValue={row.currentBudget}
                        label={row.currentBudgetLabel}
                        onChange={(value) => onBudgetChange?.(row, 'currentBudget', value)}
                      />
                    )}
                  </td>
                  <td className="dev-cvr__money-col">{row.committedLabel}</td>
                  <td className="dev-cvr__money-col">{row.certifiedLabel}</td>
                  <td className="dev-cvr__money-col">{row.actualCostLabel}</td>
                  <td className="dev-cvr__money-col">{row.systemForecastLabel}</td>
                  <td className="dev-cvr__money-col">{row.finalForecastLabel}</td>
                  <td className="dev-cvr__money-col">{row.costToCompleteLabel}</td>
                  <td className="dev-cvr__money-col">
                    <VarianceCell label={row.varianceLabel} state={row.varianceState} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="po-data-table__empty">
                  No cost codes yet. Add a cost code or import ledger / approve
                  purchase orders to populate the CVR.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="dev-cvr__totals-row">
                <td colSpan={2}>
                  <strong>Totals</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.currentBudgetLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.committedLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.certifiedLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.actualCostLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.systemForecastLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.finalForecastLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <strong>{totals.costToCompleteLabel}</strong>
                </td>
                <td className="dev-cvr__money-col">
                  <VarianceCell
                    label={totals.varianceLabel}
                    state={totals.varianceState}
                  />
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="dev-cvr__table-hint">
        Click a cost code to view system forecast, enter a commercial adjustment, or
        review adjustment history.
      </p>
    </div>
  );
}
