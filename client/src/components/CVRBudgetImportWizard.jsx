import { useEffect, useMemo, useRef, useState } from 'react';
import POPageHeader from './POPageHeader';
import { listCostCodes } from '../api';
import { normaliseCostCodeKey } from '../cvr/cvrCalculations';
import {
  BUDGET_IMPORT_FIELDS,
  buildBudgetImportPreview,
  getMissingBudgetFields,
} from '../cvr/budgetImportFields';
import {
  executeBudgetImport,
  parseBudgetImportFile,
  validateBudgetImport,
} from '../cvr/budgetImportService';
import { isAcceptedCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile } from '../payments/excelImport';
import { formatCvrMoney } from '../cvr/cvrHelpers';

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'mapping', label: 'Column Mapping' },
  { id: 'validation', label: 'Validation' },
  { id: 'import', label: 'Import' },
];

function isAcceptedBudgetFile(file) {
  return isAcceptedCsvFile(file) || isAcceptedExcelFile(file);
}

export default function CVRBudgetImportWizard({
  development,
  periodKey,
  onCancel,
  onImportComplete,
}) {
  const fileInputRef = useRef(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [parsed, setParsed] = useState(null);
  const [fieldByColumn, setFieldByColumn] = useState([]);
  const [knownCostCodes, setKnownCostCodes] = useState([]);
  const [createUnknownCostCodes, setCreateUnknownCostCodes] = useState(true);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(null);

  useEffect(() => {
    listCostCodes()
      .then((codes) => {
        setKnownCostCodes(
          (codes || []).map((item) => normaliseCostCodeKey(item.code || item.label)).filter(Boolean)
        );
      })
      .catch(() => setKnownCostCodes([]));
  }, []);

  const validationContext = useMemo(
    () => ({
      developmentId: development.id,
      knownCostCodes,
      createUnknownCostCodes,
    }),
    [development.id, knownCostCodes, createUnknownCostCodes]
  );

  const validationResult = useMemo(() => {
    if (!parsed) return null;
    return validateBudgetImport(
      { ...parsed, fieldByColumn },
      validationContext
    );
  }, [parsed, fieldByColumn, validationContext]);

  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return buildBudgetImportPreview(
      parsed.rows,
      parsed.headerRowIndex,
      fieldByColumn,
      5
    );
  }, [parsed, fieldByColumn]);

  async function handleFile(file) {
    setError('');
    if (!isAcceptedBudgetFile(file)) {
      setError('Please upload a CSV or Excel (.xlsx) budget file.');
      return;
    }

    setProcessing(true);
    try {
      const next = await parseBudgetImportFile(file);
      setParsed(next);
      setFieldByColumn(next.fieldByColumn);
      setStepIndex(1);
    } catch (err) {
      setError(err.message || 'Could not read the budget file.');
    } finally {
      setProcessing(false);
    }
  }

  function handleImport() {
    if (!validationResult?.canImport) {
      setError('No valid budget rows to import.');
      return;
    }

    const result = executeBudgetImport(development.id, validationResult, {
      createUnknownCostCodes,
      periodKey,
    });

    if (!result.ok) {
      setError(result.errors?.[0] || 'Import failed.');
      return;
    }

    setComplete(result);
    onImportComplete?.(result);
  }

  if (complete) {
    return (
      <div className="po-import-wizard dev-cvr-budget-import">
        <POPageHeader
          eyebrow="CVR"
          title="Budget Import Complete"
          lead={`Budget values imported for ${development.developmentName}.`}
        />
        <section className="po-module-card po-import-step">
          <dl className="po-import-review-grid dev-ledger-import__summary">
            <div>
              <dt>Rows imported</dt>
              <dd>{complete.importedCount}</dd>
            </div>
            <div>
              <dt>New Cost Codes</dt>
              <dd>{complete.created}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{complete.updated}</dd>
            </div>
            <div>
              <dt>Original Budget</dt>
              <dd>{formatCvrMoney(complete.totalOriginalBudget)}</dd>
            </div>
            <div>
              <dt>Current Budget</dt>
              <dd>{formatCvrMoney(complete.totalCurrentBudget)}</dd>
            </div>
          </dl>
          <div className="po-import-step__actions">
            <button type="button" className="po-btn-primary" onClick={onCancel}>
              View CVR
            </button>
          </div>
        </section>
      </div>
    );
  }

  const step = STEPS[stepIndex];

  return (
    <div className="po-import-wizard dev-cvr-budget-import">
      <POPageHeader
        eyebrow="CVR"
        title="Import Budget"
        lead={`Import company cost code budgets for ${development.developmentName}.`}
      />

      {step.id === 'upload' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Upload budget file</h2>
          <p className="po-import-step__lead">
            Import Original Budget and Current Budget by Company Cost Code from CSV or Excel.
          </p>
          <div className="po-import-dropzone">
            <input
              ref={fileInputRef}
              className="po-import-dropzone__input"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <button
              type="button"
              className="po-btn-primary"
              disabled={processing}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose budget file
            </button>
          </div>
          {error ? <p className="dev-ledger-import__blocked">{error}</p> : null}
          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {step.id === 'mapping' && parsed ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Map your columns</h2>
          <p className="po-import-step__lead">
            Match Company Cost Code, Description, Original Budget and Current Budget.
          </p>
          <div className="po-import-mapping">
            {parsed.headers.map((header, index) => (
              <div key={`${header}-${index}`} className="po-import-mapping__row">
                <span className="po-import-mapping__header">{header}</span>
                <select
                  className="select po-import-mapping__select"
                  value={fieldByColumn[index] || 'ignore'}
                  onChange={(event) => {
                    const next = [...fieldByColumn];
                    next[index] = event.target.value;
                    setFieldByColumn(next);
                    setError('');
                  }}
                >
                  {Object.entries(BUDGET_IMPORT_FIELDS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                      {meta.required ? ' (required)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {previewRows.length ? (
            <div className="po-table-wrap dev-cvr-budget-import__preview">
              <table className="po-data-table">
                <thead>
                  <tr>
                    <th>Cost Code</th>
                    <th>Description</th>
                    <th>Original Budget</th>
                    <th>Current Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.costCodeKey}>
                      <td>{row.costCode}</td>
                      <td>{row.description || '—'}</td>
                      <td>{formatCvrMoney(row.originalBudget)}</td>
                      <td>{formatCvrMoney(row.currentBudget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => {
                const missing = getMissingBudgetFields(fieldByColumn);
                if (missing.length) {
                  setError(`Map required columns: ${missing.join(', ')}.`);
                  return;
                }
                setError('');
                setStepIndex(2);
              }}
            >
              Continue
            </button>
          </div>
          {error ? <p className="dev-ledger-import__blocked">{error}</p> : null}
        </section>
      ) : null}

      {step.id === 'validation' && validationResult ? (
        <>
          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Validation summary</h2>
            <dl className="po-import-review-grid dev-ledger-import__summary">
              <div>
                <dt>Rows imported</dt>
                <dd>{validationResult.importedCount}</dd>
              </div>
              <div>
                <dt>Warnings</dt>
                <dd>{validationResult.warningCount}</dd>
              </div>
              <div>
                <dt>Errors</dt>
                <dd>{validationResult.errorCount}</dd>
              </div>
              <div>
                <dt>New Cost Codes</dt>
                <dd>{validationResult.newCostCodesPending}</dd>
              </div>
              <div>
                <dt>Original Budget</dt>
                <dd>{formatCvrMoney(validationResult.totalOriginalBudget)}</dd>
              </div>
              <div>
                <dt>Current Budget</dt>
                <dd>{formatCvrMoney(validationResult.totalCurrentBudget)}</dd>
              </div>
            </dl>

            {validationResult.newCostCodesPending > 0 ? (
              <label className="dev-ledger-import__create-cost-centres">
                <input
                  type="checkbox"
                  checked={createUnknownCostCodes}
                  onChange={(event) => setCreateUnknownCostCodes(event.target.checked)}
                />
                <span>Create new Cost Codes from unknown Cost Codes</span>
              </label>
            ) : null}

            {validationResult.canImport ? (
              <p className="po-import-step__ok">
                {validationResult.importedCount} budget row
                {validationResult.importedCount === 1 ? '' : 's'} ready to import
              </p>
            ) : (
              <p className="dev-ledger-import__blocked">No valid rows to import.</p>
            )}
          </section>

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(1)}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              disabled={!validationResult.canImport}
              onClick={() => setStepIndex(3)}
            >
              Continue to Import
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {step.id === 'import' && validationResult ? (
        <>
          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Complete import</h2>
            <p className="po-import-step__lead">
              Import {validationResult.importedCount} budget row
              {validationResult.importedCount === 1 ? '' : 's'} into the CVR for this development.
            </p>
          </section>
          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(2)}>
              Back
            </button>
            <button type="button" className="po-btn-primary" onClick={handleImport}>
              Import Budget
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
          {error ? <p className="dev-ledger-import__blocked">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
