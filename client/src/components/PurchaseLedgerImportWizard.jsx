import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import POPageHeader from './POPageHeader';
import { listActiveCostCodesForSelect } from '../admin/costCodeMasterStore';
import { normaliseCostCodeKey } from '../cvr/cvrCalculations';
import { isAcceptedCsvFile, extractHeaders } from '../ledger/csvImport';
import {
  LEDGER_IMPORT_FIELDS,
  alignFieldByColumnToHeaders,
  applyProfileMappingToHeaders,
  autoDetectLedgerColumnMapping,
  buildLedgerImportPreview,
  formatMissingRequiredFieldsMessage,
  getLedgerDetectedColumnsSummary,
  getMissingRequiredFields,
  ledgerMappingToFieldByColumn,
} from '../ledger/ledgerImportFields';
import {
  buildLedgerValidationResult,
  executeLedgerImport,
  parseLedgerCsvFile,
} from '../ledger/ledgerImportService';
import {
  listImportProfiles,
  saveImportProfile,
} from '../ledger/ledgerImportProfileStore';
import { formatLedgerMoney } from '../ledger/ledgerHelpers';
import { buildLedgerImportCrossCheck } from '../ledger/ledgerImportCrossCheck';

const WIZARD_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'preview', label: 'Preview' },
  { id: 'mapping', label: 'Column Mapping' },
  { id: 'validation', label: 'Validation' },
  { id: 'import', label: 'Import' },
];

function WizardProgress({ steps, currentIndex }) {
  const step = steps[currentIndex];
  const pct = Math.round(((currentIndex + 1) / steps.length) * 100);

  return (
    <div className="po-import-progress" role="status" aria-live="polite">
      <div className="po-import-progress__meta">
        <span className="po-import-progress__count">
          Step {currentIndex + 1} of {steps.length}
        </span>
        <span className="po-import-progress__label">{step?.label}</span>
      </div>
      <div
        className="po-import-progress__track"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={steps.length}
      >
        <div className="po-import-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PurchaseLedgerImportWizard({
  development,
  onCancel,
  onImportComplete,
}) {
  const fileInputRef = useRef(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [headerUncertain, setHeaderUncertain] = useState(false);
  const [headers, setHeaders] = useState([]);
  const [fieldByColumn, setFieldByColumn] = useState([]);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [knownCostCodes, setKnownCostCodes] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [importComplete, setImportComplete] = useState(null);
  const [createUnknownCostCentres, setCreateUnknownCostCentres] = useState(true);
  const [crossCheckConfirmed, setCrossCheckConfirmed] = useState(false);
  const [showCrossCheckDialog, setShowCrossCheckDialog] = useState(false);

  const profiles = useMemo(
    () => listImportProfiles(development.id),
    [development.id, stepIndex]
  );

  useEffect(() => {
    let cancelled = false;
    listActiveCostCodesForSelect()
      .then((codes) => {
        if (cancelled) return;
        const keys = (codes || []).map((item) =>
          normaliseCostCodeKey(item.code || item.label)
        );
        setKnownCostCodes(keys.filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setKnownCostCodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentStep = WIZARD_STEPS[stepIndex] || WIZARD_STEPS[0];

  const validationContext = useMemo(
    () => ({
      developmentId: development.id,
      developmentNumber: development.jobNumber,
      developmentName: development.developmentName,
      knownCostCodes,
      createUnknownCostCentres,
      developmentScoped: true,
    }),
    [development, knownCostCodes, createUnknownCostCentres]
  );

  const parsedState = useMemo(
    () => ({
      fileName,
      rows,
      headerRowIndex,
      headers,
      fieldByColumn,
    }),
    [fileName, rows, headerRowIndex, headers, fieldByColumn]
  );

  const previewRows = useMemo(
    () => buildLedgerImportPreview(rows, headerRowIndex, fieldByColumn, 5),
    [rows, headerRowIndex, fieldByColumn]
  );

  const detectedColumns = useMemo(
    () => getLedgerDetectedColumnsSummary(fieldByColumn, headers),
    [fieldByColumn, headers]
  );

  const validationResult = useMemo(() => {
    if (!['validation', 'import'].includes(currentStep?.id)) return null;
    return buildLedgerValidationResult(parsedState, validationContext);
  }, [currentStep?.id, parsedState, validationContext]);

  const refreshHeaders = useCallback(
    (nextHeaderIndex, sourceRows = rows) => {
      const headerCells = extractHeaders(sourceRows[nextHeaderIndex] || []);
      const autoMapping = autoDetectLedgerColumnMapping(headerCells);
      setHeaderRowIndex(nextHeaderIndex);
      setHeaders(headerCells);
      setFieldByColumn(ledgerMappingToFieldByColumn(headerCells, autoMapping));
    },
    [rows]
  );

  const processFile = useCallback(async (file) => {
    setError('');
    if (!isAcceptedCsvFile(file)) {
      setError('Please choose a CSV file.');
      return;
    }

    setProcessing(true);
    try {
      const parsed = await parseLedgerCsvFile(file);
      setFileName(parsed.fileName);
      setRows(parsed.rows);
      setHeaderRowIndex(parsed.headerRowIndex);
      setHeaderUncertain(parsed.headerUncertain);
      setHeaders(parsed.headers);
      setFieldByColumn(parsed.fieldByColumn);
      setStepIndex(1);
    } catch {
      setError('We could not read that file. Try a different CSV export.');
    } finally {
      setProcessing(false);
    }
  }, []);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file) processFile(file);
  }

  function goBack() {
    setError('');
    if (stepIndex > 0) setStepIndex((value) => value - 1);
  }

  function goNext() {
    setError('');
    if (stepIndex < WIZARD_STEPS.length - 1) {
      setStepIndex((value) => value + 1);
    }
  }

  function handleMappingContinue() {
    const alignedMapping = alignFieldByColumnToHeaders(headers, fieldByColumn);
    const missing = getMissingRequiredFields(alignedMapping, headers);

    if (missing.length) {
      setError(formatMissingRequiredFieldsMessage(missing));
      return;
    }

    setFieldByColumn(alignedMapping);
    goNext();
  }

  function handleApplyProfile(profileId) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;

    if (profile.fieldByColumn?.length) {
      setFieldByColumn(alignFieldByColumnToHeaders(headers, profile.fieldByColumn));
    } else if (profile.headerMapping) {
      setFieldByColumn(applyProfileMappingToHeaders(headers, profile.headerMapping));
    }
    setSelectedProfileId(profileId);
    setProfileName(profile.name === 'Custom' ? '' : profile.name);
    setError('');
  }

  function handleSaveProfile() {
    const name = String(profileName || '').trim();
    if (!name) {
      setError('Enter a profile name to save this mapping.');
      return;
    }

    const result = saveImportProfile(development.id, {
      name,
      headerRowIndex,
      fieldByColumn: alignFieldByColumnToHeaders(headers, fieldByColumn),
    });

    if (!result.ok) {
      setError(result.errors?.[0] || 'Could not save profile.');
      return;
    }

    setSelectedProfileId(result.profile.id);
    setError('');
  }

  const crossCheck = useMemo(() => {
    if (!validationResult || currentStep?.id !== 'import') return null;
    return buildLedgerImportCrossCheck(parsedState, validationResult);
  }, [validationResult, parsedState, currentStep?.id]);

  function runImport(forceConfirm = false) {
    const result = buildLedgerValidationResult(parsedState, validationContext);
    if (!result.canImport) {
      setError('No valid rows available to import.');
      return;
    }

    const totals = buildLedgerImportCrossCheck(parsedState, result);
    if (!totals.balanced && !forceConfirm && !crossCheckConfirmed) {
      setShowCrossCheckDialog(true);
      return;
    }

    const importResult = executeLedgerImport(development.id, result, {
      fileName,
      importProfile: profileName || profiles.find((p) => p.id === selectedProfileId)?.name || 'Custom',
      createUnknownCostCentres,
    });

    if (!importResult.ok) {
      setError(importResult.errors?.[0] || 'Import failed.');
      return;
    }

    setImportComplete(importResult);
  }

  function handleImport() {
    runImport(false);
  }

  function handleViewLedger() {
    onImportComplete?.(importComplete);
    onCancel();
  }

  function updateColumnField(columnIndex, field) {
    setFieldByColumn((prev) => {
      const next = alignFieldByColumnToHeaders(headers, prev);
      next[columnIndex] = field;
      for (let i = 0; i < next.length; i += 1) {
        if (i !== columnIndex && field !== 'ignore' && next[i] === field) {
          next[i] = 'ignore';
        }
      }
      return next;
    });
    setError('');
  }

  const lead = development.developmentName
    ? `Import purchase ledger transactions for ${development.developmentName}.`
    : 'Import purchase ledger transactions from your accounting system.';

  if (importComplete) {
    return (
      <div className="po-import-wizard dev-ledger-import">
        <POPageHeader
          eyebrow="Purchase Ledger"
          title="Import Complete"
          lead="Valid transactions have been added to this development."
        />
        <section className="po-module-card po-import-step">
          <dl className="po-import-review-grid dev-ledger-import__summary">
            <div>
              <dt>Rows imported</dt>
              <dd>{importComplete.importedCount}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{importComplete.warningCount ?? 0}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>{importComplete.rejectedCount}</dd>
            </div>
            <div>
              <dt>New Cost Codes</dt>
              <dd>{importComplete.newCostCentresCreated ?? 0}</dd>
            </div>
            <div>
              <dt>Total value</dt>
              <dd>{formatLedgerMoney(importComplete.totalValue)}</dd>
            </div>
          </dl>
          <div className="po-import-step__actions">
            <button type="button" className="po-btn-primary" onClick={handleViewLedger}>
              View Ledger
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="po-import-wizard dev-ledger-import">
      <POPageHeader
        eyebrow="Purchase Ledger"
        title="Import Purchase Ledger"
        lead={lead}
      />

      <WizardProgress steps={WIZARD_STEPS} currentIndex={stepIndex} />

      {error ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {error}
        </div>
      ) : null}

      {currentStep?.id === 'upload' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Choose your CSV export</h2>
          <p className="po-import-step__lead">
            Export a purchase ledger CSV from your accounting system and upload it
            here. Your data stays in your browser until you confirm the import.
          </p>

          <div
            className={`po-import-dropzone${dragOver ? ' po-import-dropzone--active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <p className="po-import-dropzone__title">Drag and drop your CSV here</p>
            <p className="po-import-dropzone__hint">or browse to choose a file</p>
            <button
              type="button"
              className="po-list-btn-secondary"
              disabled={processing}
              onClick={() => fileInputRef.current?.click()}
            >
              Browse
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="po-import-dropzone__input"
              onChange={(event) => {
                handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          {fileName ? (
            <p className="po-import-file">
              Selected file: <strong>{fileName}</strong>
            </p>
          ) : null}

          <div className="po-import-step__actions">
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'preview' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Preview your CSV</h2>
          <p className="po-import-step__lead">
            Check the sample rows look right. If the header row is wrong, select the
            correct row below.
          </p>

          {headerUncertain ? (
            <p className="dev-ledger-import__header-hint" role="status">
              We are not certain which row contains the column headings. Please confirm
              the header row.
            </p>
          ) : null}

          <label className="dev-ledger-import__header-label" htmlFor="ledger-header-row">
            Header row
          </label>
          <select
            id="ledger-header-row"
            className="select dev-ledger-import__header-select"
            value={headerRowIndex}
            onChange={(event) => refreshHeaders(Number.parseInt(event.target.value, 10))}
          >
            {rows.slice(0, 15).map((row, index) => (
              <option key={index} value={index}>
                Row {index + 1}: {(row || []).slice(0, 4).join(' · ') || '(blank)'}
              </option>
            ))}
          </select>

          {detectedColumns.length ? (
            <div className="po-import-detected">
              <p className="po-import-detected__title">Detected columns</p>
              <ul className="po-import-detected__list">
                {detectedColumns.map((item) => (
                  <li key={`${item.field}-${item.header}`}>
                    <strong>{item.label}</strong>
                    <span>{item.header}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="po-table-wrap">
            <table className="po-data-table dev-ledger-import__preview">
              <thead>
                <tr>
                  <th>Development</th>
                  <th>Cost Code</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.length ? (
                  previewRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.developmentIdentifier || '—'}</td>
                      <td>{row.costCode || '—'}</td>
                      <td>{row.supplier || '—'}</td>
                      <td>{row.transactionDate || '—'}</td>
                      <td>{row.transactionAmount || '—'}</td>
                      <td>{row.description || '—'}</td>
                      <td>{row.invoiceNumber || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="po-data-table__empty">
                      No preview rows available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button type="button" className="po-btn-primary" onClick={goNext}>
              Continue
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'mapping' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Map your columns</h2>
          <p className="po-import-step__lead">
            Tell us which CSV columns match each commercial field. Map by meaning,
            not by accounting system. Development Identifier is optional — transactions
            import into {development.developmentName}.
          </p>

          <div className="dev-ledger-import__profile-bar">
            <label className="dev-ledger-import__profile-label" htmlFor="ledger-profile">
              Saved profile
            </label>
            <select
              id="ledger-profile"
              className="select dev-ledger-import__profile-select"
              value={selectedProfileId}
              onChange={(event) => handleApplyProfile(event.target.value)}
            >
              <option value="">Choose a saved profile…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="po-import-mapping">
            {headers.map((header, index) => (
              <div key={`${header}-${index}`} className="po-import-mapping__row">
                <span className="po-import-mapping__header">{header}</span>
                <select
                  className="select po-import-mapping__select"
                  value={fieldByColumn[index] || 'ignore'}
                  onChange={(event) => updateColumnField(index, event.target.value)}
                >
                  {Object.entries(LEDGER_IMPORT_FIELDS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                      {meta.required ? ' (required)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="dev-ledger-import__save-profile">
            <label className="dev-ledger-import__profile-label" htmlFor="ledger-profile-name">
              Save as profile
            </label>
            <input
              id="ledger-profile-name"
              className="input dev-ledger-import__profile-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="e.g. Monthly Purchase Ledger"
            />
            <button type="button" className="po-list-btn-secondary" onClick={handleSaveProfile}>
              Save Profile
            </button>
          </div>

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button type="button" className="po-btn-primary" onClick={handleMappingContinue}>
              Continue
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'validation' && validationResult ? (
        <div className="po-import-step po-import-step--validation">
          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Validation summary</h2>
            <p className="po-import-step__lead">
              Review import results before bringing transactions into this development.
              Valid rows will be imported; exceptions remain unresolved.
            </p>

            <dl className="po-import-review-grid dev-ledger-import__summary">
              <div>
                <dt>Rows</dt>
                <dd>{validationResult.rowCount}</dd>
              </div>
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
                <dd
                  className={
                    validationResult.errorCount > 0
                      ? 'dev-ledger-import__errors-count'
                      : 'po-import-review__balanced'
                  }
                >
                  {validationResult.errorCount}
                </dd>
              </div>
              <div>
                <dt>New Cost Codes</dt>
                <dd>{validationResult.newCostCentresPending}</dd>
              </div>
              <div>
                <dt>Total value</dt>
                <dd>{formatLedgerMoney(validationResult.totalValue)}</dd>
              </div>
            </dl>

            {validationResult.newCostCentresPending > 0 ? (
              <label className="dev-ledger-import__create-cost-centres">
                <input
                  type="checkbox"
                  checked={createUnknownCostCentres}
                  onChange={(event) => setCreateUnknownCostCentres(event.target.checked)}
                />
                <span>Create new Cost Codes from unknown Cost Codes</span>
              </label>
            ) : null}

            {!validationResult.mappingComplete ? (
              <p className="dev-ledger-import__blocked" role="status">
                {formatMissingRequiredFieldsMessage(validationResult.missingMappings) ||
                  'Import blocked — required column mappings are missing.'}
              </p>
            ) : validationResult.canImport ? (
              <p className="po-import-step__ok">
                {validationResult.importedCount} transaction
                {validationResult.importedCount === 1 ? '' : 's'} ready to import
              </p>
            ) : (
              <p className="dev-ledger-import__blocked" role="status">
                No valid rows to import.
              </p>
            )}

            {validationResult.warnings?.length ? (
              <div className="dev-ledger-import__warnings">
                <p className="dev-ledger-import__warnings-title">Warnings</p>
                <ul className="po-import-warnings">
                  {validationResult.warnings.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {validationResult.rowWarnings?.length ? (
            <section className="po-module-card po-import-step dev-ledger-import__exceptions dev-ledger-import__exceptions--warnings">
              <h2 className="po-matrix-section__title">Row warnings</h2>
              <p className="po-import-step__lead">
                These rows will still be imported. Review warnings before continuing.
              </p>
              <div className="po-table-wrap">
                <table className="po-data-table dev-ledger-import__exceptions-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Supplier</th>
                      <th>Cost Code</th>
                      <th>Invoice</th>
                      <th>Amount</th>
                      <th>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.rowWarnings.map((entry) => (
                      <tr key={`warn-${entry.rowNumber}`}>
                        <td>{entry.rowNumber}</td>
                        <td>{entry.supplier || '—'}</td>
                        <td>{entry.costCode || '—'}</td>
                        <td>{entry.invoiceNumber || '—'}</td>
                        <td>{entry.transactionAmount || '—'}</td>
                        <td>{entry.warnings?.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {validationResult.errors?.length ? (
            <section className="po-module-card po-import-step dev-ledger-import__exceptions">
              <h2 className="po-matrix-section__title">Errors</h2>
              <p className="po-import-step__lead">
                These rows will not be imported. Fix them in your accounting export and
                re-import, or continue with the valid rows.
              </p>
              <div className="po-table-wrap">
                <table className="po-data-table dev-ledger-import__exceptions-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Supplier</th>
                      <th>Cost Code</th>
                      <th>Invoice</th>
                      <th>Amount</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.errors.map((entry) => (
                      <tr key={`err-${entry.rowNumber}`}>
                        <td>{entry.rowNumber}</td>
                        <td>{entry.supplier || '—'}</td>
                        <td>{entry.costCode || '—'}</td>
                        <td>{entry.invoiceNumber || '—'}</td>
                        <td>{entry.transactionAmount || '—'}</td>
                        <td>{entry.issues?.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="po-import-step__actions po-import-step__actions--sticky">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              disabled={!validationResult.canImport}
              onClick={goNext}
            >
              Continue to Import
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {currentStep?.id === 'import' && validationResult ? (
        <>
          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Complete import</h2>
            <p className="po-import-step__lead">
              Import {validationResult.importedCount} transaction
              {validationResult.importedCount === 1 ? '' : 's'} totalling{' '}
              {formatLedgerMoney(validationResult.totalValue)} into this development.
              {validationResult.errorCount
                ? ` ${validationResult.errorCount} row${validationResult.errorCount === 1 ? '' : 's'} will remain unresolved.`
                : ''}
            </p>

            <dl className="po-import-review-grid dev-ledger-import__summary">
              <div>
                <dt>Development</dt>
                <dd>{development.developmentName}</dd>
              </div>
              <div>
                <dt>Imported rows</dt>
                <dd>{validationResult.importedCount}</dd>
              </div>
              <div>
                <dt>Imported value</dt>
                <dd>{formatLedgerMoney(crossCheck?.importedValue ?? validationResult.totalValue)}</dd>
              </div>
              <div>
                <dt>CSV total</dt>
                <dd>{formatLedgerMoney(crossCheck?.csvTotal ?? 0)}</dd>
              </div>
              <div>
                <dt>BuildLite total</dt>
                <dd>{formatLedgerMoney(crossCheck?.buildliteTotal ?? validationResult.totalValue)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd className={crossCheck?.balanced ? 'po-import-review__balanced' : 'dev-ledger-import__errors-count'}>
                  {formatLedgerMoney(crossCheck?.difference ?? 0)}
                </dd>
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
                <dd>
                  {createUnknownCostCentres ? validationResult.newCostCentresPending : 0}
                </dd>
              </div>
            </dl>

            {crossCheck && !crossCheck.balanced ? (
              <p className="dev-ledger-import__warnings-title">
                CSV and BuildLite totals differ. You will be asked to confirm before import completes.
              </p>
            ) : null}
          </section>

          {showCrossCheckDialog && crossCheck ? (
            <div className="po-cert-delete-backdrop" role="presentation">
              <div className="po-cert-delete modal" role="dialog" aria-modal="true">
                <h3>Confirm import totals</h3>
                <p>
                  CSV total ({formatLedgerMoney(crossCheck.csvTotal)}) does not match the BuildLite import total ({formatLedgerMoney(crossCheck.buildliteTotal)}).
                  Difference: {formatLedgerMoney(crossCheck.difference)}.
                </p>
                <div className="po-cert-delete__actions modal-actions">
                  <button type="button" className="po-list-btn-secondary" onClick={() => setShowCrossCheckDialog(false)}>
                    Review mapping
                  </button>
                  <button
                    type="button"
                    className="po-btn-primary"
                    onClick={() => {
                      setCrossCheckConfirmed(true);
                      setShowCrossCheckDialog(false);
                      runImport(true);
                    }}
                  >
                    Import anyway
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              disabled={!validationResult.canImport}
              onClick={handleImport}
            >
              Import Purchase Ledger
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
