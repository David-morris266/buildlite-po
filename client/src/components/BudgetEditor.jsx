export default function BudgetEditor({
  values,
  errors = [],
  onChange,
  showName = false,
  nameLabel = 'Cost Centre',
}) {
  return (
    <div className="dev-cvr-budget-editor">
      {errors.length ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showName ? (
        <label className="dev-cvr-budget-editor__field">
          <span>{nameLabel}</span>
          <input
            className="input"
            type="text"
            value={values.costCodeLabel || ''}
            onChange={(event) => onChange?.('costCodeLabel', event.target.value)}
            placeholder="e.g. BRK01 — Brickwork"
          />
        </label>
      ) : null}

      <label className="dev-cvr-budget-editor__field">
        <span>Original Budget</span>
        <input
          className="input"
          type="text"
          inputMode="decimal"
          value={values.originalBudget ?? ''}
          onChange={(event) => onChange?.('originalBudget', event.target.value)}
          placeholder="Enter amount"
        />
      </label>

      <label className="dev-cvr-budget-editor__field">
        <span>Current Budget</span>
        <input
          className="input"
          type="text"
          inputMode="decimal"
          value={values.currentBudget ?? ''}
          onChange={(event) => onChange?.('currentBudget', event.target.value)}
          placeholder="Enter amount"
        />
      </label>

      <label className="dev-cvr-budget-editor__field">
        <span>Forecast Final Cost</span>
        <input
          className="input"
          type="text"
          inputMode="decimal"
          value={values.forecastFinalCost ?? ''}
          onChange={(event) => onChange?.('forecastFinalCost', event.target.value)}
          placeholder="Expected final cost"
        />
      </label>
    </div>
  );
}
