import { useMemo, useRef, useState } from 'react';
import {
  COST_CODE_IMPORT_FIELDS,
  COST_CODE_IMPORT_FIELD_ORDER,
  buildCostCodeSourceColumnPreview,
} from '../costCodeImportFields';
import {
  detectImportHierarchyMapping,
  executeCostCodeImport,
  HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY,
  HIERARCHY_MODE_TWO_LEVEL,
  inferDefaultHierarchyMode,
  parseCostCodeImportFile,
  validateCostCodeImport,
} from '../costCodeImportService';
import { formatFamilyDisplay } from '../../admin/costCodeHierarchy';
import { isAcceptedCsvFile } from '../../ledger/csvImport';
import { isAcceptedExcelFile } from '../../payments/excelImport';

const STEPS = ['Upload', 'Preview', 'Map Columns', 'Validate', 'Import', 'Summary'];

function isAcceptedFile(file) {
  return isAcceptedCsvFile(file) || isAcceptedExcelFile(file);
}

export default function SetupCostCodeImportWizard({ onComplete, onCancel }) {
  const fileInputRef = useRef(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [parsed, setParsed] = useState(null);
  const [fieldByColumn, setFieldByColumn] = useState([]);
  const [hierarchyMode, setHierarchyMode] = useState(HIERARCHY_MODE_TWO_LEVEL);
  const [defaultFamilyName, setDefaultFamilyName] = useState('General');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [summary, setSummary] = useState(null);

  const hierarchyDetection = useMemo(() => {
    if (!fieldByColumn.length) return parsed?.hierarchyDetection || null;
    return detectImportHierarchyMapping(fieldByColumn);
  }, [parsed, fieldByColumn]);

  const validation = useMemo(() => {
    if (!parsed) return null;
    return validateCostCodeImport(
      { ...parsed, fieldByColumn },
      { hierarchyMode, defaultFamilyName, hierarchyDetection }
    );
  }, [parsed, fieldByColumn, hierarchyMode, defaultFamilyName, hierarchyDetection]);

  const sourcePreview = useMemo(() => {
    if (!parsed) return { headers: [], rows: [] };
    return buildCostCodeSourceColumnPreview(parsed.rows, parsed.headerRowIndex, 8);
  }, [parsed]);

  async function handleFile(file) {
    setError('');
    if (!isAcceptedFile(file)) {
      setError('Please upload a CSV or Excel (.xlsx) file.');
      return;
    }
    setProcessing(true);
    try {
      const next = await parseCostCodeImportFile(file);
      setParsed(next);
      setFieldByColumn(next.fieldByColumn);
      setHierarchyMode(next.defaultHierarchyMode || HIERARCHY_MODE_TWO_LEVEL);
      setStepIndex(1);
    } catch (err) {
      setError(err.message || 'Could not read the file.');
    } finally {
      setProcessing(false);
    }
  }

  function handleImport() {
    if (!validation?.canImport) {
      setError('Resolve validation issues before importing.');
      return;
    }
    const result = executeCostCodeImport(validation, { hierarchyMode, defaultFamilyName });
    if (!result.ok) {
      setError(result.errors?.[0] || 'Import failed.');
      return;
    }
    setSummary(result);
    setStepIndex(5);
  }

  const showHierarchyChoice = Boolean(
    hierarchyDetection?.commercialFamilyAbsent && hierarchyDetection?.hasCommercialHead
  );

  return (
    <div className="setup-import-wizard po-module-card">
      <div className="setup-import-wizard__steps">
        {STEPS.map((label, index) => (
          <span
            key={label}
            className={`setup-import-wizard__step${index === stepIndex ? ' setup-import-wizard__step--active' : ''}${index < stepIndex ? ' setup-import-wizard__step--done' : ''}`}
          >
            {label}
          </span>
        ))}
      </div>

      {error ? <div className="setup-step__error" role="alert">{error}</div> : null}

      {stepIndex === 0 ? (
        <div className="setup-import-upload">
          <p>Upload your existing cost code list. We will map columns and validate before importing into Administration.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <button type="button" className="po-btn-primary" disabled={processing} onClick={() => fileInputRef.current?.click()}>
            {processing ? 'Reading file…' : 'Choose Excel or CSV file'}
          </button>
        </div>
      ) : null}

      {stepIndex === 1 && parsed ? (
        <div className="setup-import-panel">
          <p><strong>{parsed.fileName}</strong> — {sourcePreview.headers.length} columns detected.</p>
          <div className="po-table-wrap">
            <table className="po-data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {sourcePreview.headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sourcePreview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    {row.cells.map((cell, index) => (
                      <td key={`${row.rowNumber}-${index}`}>{cell || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="setup-step__hint">
            Auto-mapping:{' '}
            {COST_CODE_IMPORT_FIELD_ORDER.filter((field) => field !== 'ignore')
              .filter((field) => fieldByColumn.includes(field))
              .map((field) => COST_CODE_IMPORT_FIELDS[field].label)
              .join(', ') || 'None yet'}
          </p>
          <div className="setup-import-actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(0)}>Back</button>
            <button type="button" className="po-btn-primary" onClick={() => setStepIndex(2)}>Continue to mapping</button>
          </div>
        </div>
      ) : null}

      {stepIndex === 2 && parsed ? (
        <div className="setup-import-panel">
          <p>Map each column to a BuildLite field.</p>
          <div className="setup-import-mapping">
            {parsed.headers.map((header, columnIndex) => (
              <label key={`${header}-${columnIndex}`} className="dev-form__field">
                <span className="dev-form__label">{header || `Column ${columnIndex + 1}`}</span>
                <select
                  className="input"
                  value={fieldByColumn[columnIndex] || 'ignore'}
                  onChange={(e) => {
                    const next = [...fieldByColumn];
                    next[columnIndex] = e.target.value;
                    setFieldByColumn(next);
                    const detection = detectImportHierarchyMapping(next);
                    setHierarchyMode(inferDefaultHierarchyMode(detection));
                  }}
                >
                  {COST_CODE_IMPORT_FIELD_ORDER.map((value) => (
                    <option key={value} value={value}>{COST_CODE_IMPORT_FIELDS[value].label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {showHierarchyChoice ? (
            <section className="setup-hierarchy-mode">
              <h3>Detected hierarchy</h3>
              <p>Cost Group → Commercial Head</p>
              <p>Cost Type → Reporting Group</p>
              <p><strong>No Commercial Family column detected</strong></p>
              <p>How should BuildLite treat the missing Commercial Family?</p>
              <label className="setup-hierarchy-mode__option">
                <input
                  type="radio"
                  name="hierarchyMode"
                  checked={hierarchyMode === HIERARCHY_MODE_TWO_LEVEL}
                  onChange={() => setHierarchyMode(HIERARCHY_MODE_TWO_LEVEL)}
                />
                <span>
                  <strong>Option A — Use a two-level structure</strong>
                  <small>Commercial Head → Reporting Group → Cost Code (recommended)</small>
                </span>
              </label>
              <label className="setup-hierarchy-mode__option">
                <input
                  type="radio"
                  name="hierarchyMode"
                  checked={hierarchyMode === HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY}
                  onChange={() => setHierarchyMode(HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY)}
                />
                <span>
                  <strong>Option B — Insert a default Commercial Family</strong>
                  <small>Commercial Head → Default Family → Reporting Group → Cost Code</small>
                </span>
              </label>
              {hierarchyMode === HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY ? (
                <label className="dev-form__field">
                  <span className="dev-form__label">Default Commercial Family</span>
                  <input
                    className="input"
                    value={defaultFamilyName}
                    onChange={(e) => setDefaultFamilyName(e.target.value)}
                  />
                </label>
              ) : null}
            </section>
          ) : null}

          <div className="setup-import-actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(1)}>Back</button>
            <button type="button" className="po-btn-primary" onClick={() => setStepIndex(3)}>Validate import</button>
          </div>
        </div>
      ) : null}

      {stepIndex === 3 && validation ? (
        <div className="setup-import-panel">
          <div className="setup-import-summary-grid">
            <article><span>Valid rows</span><strong>{validation.summary.validCount}</strong></article>
            <article><span>Errors</span><strong>{validation.summary.errorCount}</strong></article>
            <article><span>Warnings</span><strong>{validation.summary.warningCount}</strong></article>
            <article><span>Hierarchy mode</span><strong>{validation.hierarchyModeLabel}</strong></article>
          </div>
          {validation.missingMappings.length ? (
            <p className="setup-step__error">Missing mappings: {validation.missingMappings.join(', ')}</p>
          ) : null}
          {validation.errors.slice(0, 5).map((item) => (
            <p key={`${item.rowNumber}-${item.code}`} className="setup-step__error">
              Row {item.rowNumber}: {item.issues.join(', ')}
            </p>
          ))}
          {validation.warnings.slice(0, 5).map((item, index) => (
            <p key={`${item.rowNumber}-${index}`} className="setup-step__hint">
              Row {item.rowNumber}: {item.message}
            </p>
          ))}
          {validation.validRows.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table">
                <thead>
                  <tr>
                    <th>Cost Code</th>
                    <th>Description</th>
                    <th>Commercial Head</th>
                    <th>Commercial Family</th>
                    <th>Reporting Group</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.validRows.slice(0, 8).map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.code}</td>
                      <td>{row.description}</td>
                      <td>{row.commercialHead || '—'}</td>
                      <td>{formatFamilyDisplay(row.commercialFamily)}</td>
                      <td>{row.reportingGroup || row.trade || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="setup-import-actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(2)}>Back</button>
            <button type="button" className="po-btn-primary" disabled={!validation.canImport} onClick={() => setStepIndex(4)}>
              Continue to import
            </button>
          </div>
        </div>
      ) : null}

      {stepIndex === 4 && validation ? (
        <div className="setup-import-panel">
          <p>Ready to import <strong>{validation.summary.validCount}</strong> cost codes using <strong>{validation.hierarchyModeLabel}</strong> hierarchy.</p>
          <div className="setup-import-actions">
            <button type="button" className="po-list-btn-secondary" onClick={() => setStepIndex(3)}>Back</button>
            <button type="button" className="po-btn-primary" onClick={handleImport}>Import cost codes</button>
          </div>
        </div>
      ) : null}

      {stepIndex === 5 && summary ? (
        <div className="setup-import-panel">
          <h3>Import Summary</h3>
          <div className="setup-import-summary-grid">
            <article><span>Rows read</span><strong>{summary.rowsRead}</strong></article>
            <article><span>Cost codes imported</span><strong>{summary.imported}</strong></article>
            <article><span>Cost codes updated</span><strong>{summary.updated}</strong></article>
            <article><span>Cost codes rejected</span><strong>{summary.rejected}</strong></article>
            <article><span>Commercial Heads created</span><strong>{summary.headsCreated}</strong></article>
            <article><span>Commercial Heads matched</span><strong>{summary.headsMatched}</strong></article>
            <article><span>Commercial Families created</span><strong>{summary.familiesCreated}</strong></article>
            <article><span>Commercial Families matched</span><strong>{summary.familiesMatched}</strong></article>
            <article><span>Reporting Groups created</span><strong>{summary.reportingGroupsCreated}</strong></article>
            <article><span>Reporting Groups matched</span><strong>{summary.reportingGroupsMatched}</strong></article>
            <article><span>Hierarchy mode</span><strong>{summary.hierarchyModeLabel}</strong></article>
            <article><span>Skipped duplicates</span><strong>{summary.skipped}</strong></article>
          </div>
          {summary.warnings?.length ? (
            <div className="setup-step__hint">
              <strong>Warnings</strong>
              <ul>
                {summary.warnings.slice(0, 5).map((item, index) => (
                  <li key={`${item.code}-${index}`}>{item.code}: {item.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.errors?.length ? (
            <div className="setup-step__error">
              <strong>Errors</strong>
              <ul>
                {summary.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="setup-import-actions">
            <button type="button" className="po-btn-primary" onClick={() => onComplete?.(summary)}>Continue</button>
          </div>
        </div>
      ) : null}

      {onCancel ? (
        <button type="button" className="setup-import-cancel cvr-summary__link-btn" onClick={onCancel}>
          Cancel import
        </button>
      ) : null}
    </div>
  );
}
