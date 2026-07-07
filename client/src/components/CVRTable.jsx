function EditableMoneyCell({ rawValue, label, onChange }) {
  return (
    <input
      className="dev-cvr__cell-input"
      type="text"
      inputMode="decimal"
      defaultValue={
        rawValue == null ? '' : String(rawValue)
      }
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

export default function CVRTable({
  rows,
  totals,
  onRowSelect,
  onBudgetChange,
}) {
  return (
    <div className="dev-cvr__table-wrap">
      <div className="po-table-wrap">
        <table className="po-data-table dev-cvr__table">
          <thead>
            <tr>
              <th>Cost Code</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Original Budget</th>
              <th style={{ textAlign: 'right' }}>Current Budget</th>
              <th style={{ textAlign: 'right' }}>Committed</th>
              <th style={{ textAlign: 'right' }}>Actual</th>
              <th style={{ textAlign: 'right' }}>Forecast</th>
              <th style={{ textAlign: 'right' }}>Cost To Complete</th>
              <th style={{ textAlign: 'right' }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="dev-cvr__row-link"
                      onClick={() => onRowSelect?.(row)}
                    >
                      {formatCostCodeCell(row)}
                    </button>
                  </td>
                  <td>{formatDescriptionCell(row)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableMoneyCell
                      key={`${row.id}-original-${row.originalBudget}`}
                      rawValue={row.originalBudget}
                      label={row.originalBudgetLabel}
                      onChange={(value) =>
                        onBudgetChange?.(row, 'originalBudget', value)
                      }
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableMoneyCell
                      key={`${row.id}-current-${row.currentBudget}`}
                      rawValue={row.currentBudget}
                      label={row.currentBudgetLabel}
                      onChange={(value) =>
                        onBudgetChange?.(row, 'currentBudget', value)
                      }
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.committedLabel}</td>
                  <td style={{ textAlign: 'right' }}>{row.actualCostLabel}</td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableMoneyCell
                      key={`${row.id}-forecast-${row.forecastFinalCost}`}
                      rawValue={row.forecastFinalCost}
                      label={row.forecastFinalCostLabel}
                      onChange={(value) =>
                        onBudgetChange?.(row, 'forecastFinalCost', value)
                      }
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.costToCompleteLabel}</td>
                  <td style={{ textAlign: 'right' }}>
                    <VarianceCell
                      label={row.varianceLabel}
                      state={row.varianceState}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="po-data-table__empty">
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
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.originalBudgetLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.currentBudgetLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.committedLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.actualCostLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.forecastFinalCostLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{totals.costToCompleteLabel}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
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
    </div>
  );
}
