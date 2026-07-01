import { useCallback, useMemo, useRef, useState } from 'react';
import POPageHeader from './POPageHeader';
import { formatMoney } from './poDrawerHelpers';
import {
  IMPORT_FIELDS,
  autoDetectColumnMapping,
  buildImportPreview,
  buildPlotStageImport,
  buildPlotStagePreview,
  detectHeaderRowIndex,
  detectPlotStageLayout,
  extractHeaders,
  getDetectedColumnsSummary,
  getWorksheetSummaries,
  isAcceptedExcelFile,
  mappingToFieldByColumn,
  parseExcelFile,
  sheetToRows,
  validateAndBuildImportRows,
} from '../payments/excelImport';

const WIZARD_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'worksheet', label: 'Worksheet' },
  { id: 'preview', label: 'Preview' },
  { id: 'mapping', label: 'Map columns' },
  { id: 'review', label: 'Review' },
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
        aria-label={`Step ${currentIndex + 1} of ${steps.length}: ${step?.label}`}
      >
        <div className="po-import-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function OrderMatrixImportWizard({
  order,
  onCancel,
  onImport,
  requirePlotStageLayout = false,
}) {
  const fileInputRef = useRef(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [sheetRows, setSheetRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [headers, setHeaders] = useState([]);
  const [fieldByColumn, setFieldByColumn] = useState([]);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importLayout, setImportLayout] = useState('flat');

  const visibleSteps = useMemo(() => {
    let steps = WIZARD_STEPS;
    if (worksheets.length <= 1) {
      steps = steps.filter((step) => step.id !== 'worksheet');
    }
    if (importLayout === 'plot-stage') {
      steps = steps.filter((step) => step.id !== 'mapping');
    }
    return steps;
  }, [worksheets.length, importLayout]);

  const currentStep = visibleSteps[stepIndex] || visibleSteps[0];

  const loadSheet = useCallback((wb, sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetToRows(sheet);
    const headerIndex = detectHeaderRowIndex(rows);
    const headerCells = extractHeaders(rows[headerIndex] || []);
    const autoMapping = autoDetectColumnMapping(headerCells);
    const fields = mappingToFieldByColumn(headerCells, autoMapping);

    setSelectedSheet(sheetName);
    setSheetRows(rows);
    setHeaderRowIndex(headerIndex);
    setHeaders(headerCells);
    setFieldByColumn(fields);
    setImportLayout(
      detectPlotStageLayout(rows, headerIndex) ? 'plot-stage' : 'flat'
    );
  }, []);

  const processFile = useCallback(
    async (file) => {
      setError('');
      if (!isAcceptedExcelFile(file)) {
        setError('Please choose an Excel file (.xlsx or .xls).');
        return;
      }

      setProcessing(true);
      try {
        const wb = await parseExcelFile(file);
        const summaries = getWorksheetSummaries(wb);
        setFileName(file.name);
        setWorkbook(wb);
        setWorksheets(summaries);

        if (summaries.length === 1) {
          loadSheet(wb, summaries[0].name);
          setStepIndex(1);
        } else {
          setSelectedSheet(summaries[0]?.name || '');
          setStepIndex(1);
        }
      } catch {
        setError('We could not read that file. Try a different spreadsheet.');
      } finally {
        setProcessing(false);
      }
    },
    [loadSheet]
  );

  const handleFiles = useCallback(
    (fileList) => {
      const file = fileList?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const previewRows = useMemo(
    () => buildImportPreview(sheetRows, headerRowIndex, fieldByColumn, 5),
    [sheetRows, headerRowIndex, fieldByColumn]
  );

  const plotStagePreview = useMemo(
    () => buildPlotStagePreview(sheetRows, headerRowIndex, 5),
    [sheetRows, headerRowIndex]
  );

  const detectedColumns = useMemo(
    () => getDetectedColumnsSummary(fieldByColumn, headers),
    [fieldByColumn, headers]
  );

  const importResult = useMemo(() => {
    if (currentStep?.id !== 'review') return null;
    if (importLayout === 'plot-stage') {
      return buildPlotStageImport(
        sheetRows,
        headerRowIndex,
        order?.committedValue
      );
    }
    return validateAndBuildImportRows(
      sheetRows,
      headerRowIndex,
      fieldByColumn,
      order?.committedValue
    );
  }, [
    currentStep?.id,
    importLayout,
    sheetRows,
    headerRowIndex,
    fieldByColumn,
    order?.committedValue,
  ]);

  function goBack() {
    setError('');
    if (stepIndex > 0) setStepIndex((value) => value - 1);
  }

  function goNext() {
    setError('');
    if (stepIndex < visibleSteps.length - 1) {
      setStepIndex((value) => value + 1);
    }
  }

  function handleWorksheetContinue() {
    if (!workbook || !selectedSheet) {
      setError('Choose a worksheet to continue.');
      return;
    }
    loadSheet(workbook, selectedSheet);
    goNext();
  }

  function handleMappingContinue() {
    const descriptionMapped = fieldByColumn.includes('description');
    const valueMapped = fieldByColumn.includes('orderValue');
    if (!descriptionMapped || !valueMapped) {
      setError('Description and Order Value are required.');
      return;
    }
    goNext();
  }

  function handleImport() {
    if (requirePlotStageLayout && importLayout !== 'plot-stage') {
      setError(
        'This package requires a plot × stage valuation matrix. Use a spreadsheet with plots in the first column and payment stages across the top.'
      );
      return;
    }

    if (importLayout === 'plot-stage') {
      const result = buildPlotStageImport(
        sheetRows,
        headerRowIndex,
        order?.committedValue
      );
      if (result.errors.length) {
        setError(result.errors[0]);
        return;
      }
      onImport?.(result);
      return;
    }

    const result = validateAndBuildImportRows(
      sheetRows,
      headerRowIndex,
      fieldByColumn,
      order?.committedValue
    );
    if (result.errors.length) {
      setError(result.errors[0]);
      return;
    }
    onImport?.({ layout: 'flat', rows: result.rows, ...result });
  }

  function updateColumnField(columnIndex, field) {
    setFieldByColumn((prev) => {
      const next = [...prev];
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

  return (
    <div className="po-import-wizard">
      <POPageHeader
        eyebrow="Import"
        title="Import from Excel"
        lead="Import your existing valuation spreadsheet to create your Order Matrix."
      />

      <WizardProgress steps={visibleSteps} currentIndex={stepIndex} />

      {error ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {error}
        </div>
      ) : null}

      {currentStep?.id === 'upload' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Choose your spreadsheet</h2>
          <p className="po-import-step__lead">
            We support Excel files (.xlsx and .xls). Your data stays in your
            browser until you confirm the import.
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
            <p className="po-import-dropzone__title">Drag and drop your file here</p>
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
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
        </section>
      ) : null}

      {currentStep?.id === 'worksheet' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Choose a worksheet</h2>
          <p className="po-import-step__lead">
            This workbook has more than one worksheet. Choose the one that
            contains your valuation.
          </p>
          <div className="po-import-worksheets">
            {worksheets.map((sheet) => (
              <label
                key={sheet.name}
                className={`po-import-worksheet${
                  selectedSheet === sheet.name ? ' po-import-worksheet--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="worksheet"
                  value={sheet.name}
                  checked={selectedSheet === sheet.name}
                  onChange={() => setSelectedSheet(sheet.name)}
                />
                <span className="po-import-worksheet__name">{sheet.name}</span>
                <span className="po-import-worksheet__meta">
                  {sheet.rowCount} row{sheet.rowCount === 1 ? '' : 's'}
                </span>
              </label>
            ))}
          </div>
          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              onClick={handleWorksheetContinue}
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'preview' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Preview your spreadsheet</h2>
          <p className="po-import-step__lead">
            {importLayout === 'plot-stage'
              ? 'Check that your plots, payment stages and values look right before you import.'
              : 'Here is a sample of what we found. Check that the descriptions and values look right before mapping columns.'}
          </p>

          {importLayout === 'plot-stage' ? (
            <div className="po-table-wrap">
              <table className="po-data-table po-matrix-imported__table">
                <thead>
                  <tr>
                    <th className="po-matrix-imported__plot">Plot</th>
                    {plotStagePreview.stages.map((stage) => (
                      <th key={stage} className="po-matrix-imported__stage">
                        {stage}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plotStagePreview.preview.length ? (
                    plotStagePreview.preview.map((row) => (
                      <tr key={row.plot}>
                        <th scope="row" className="po-matrix-imported__plot">
                          {row.plot}
                        </th>
                        {row.values.map((value, index) => (
                          <td
                            key={`${row.plot}-${index}`}
                            className="po-matrix-imported__value"
                          >
                            {value == null ? '—' : `£${formatMoney(value)}`}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={Math.max(plotStagePreview.stages.length + 1, 2)}
                        className="po-data-table__empty"
                      >
                        No preview rows available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <>
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
                <table className="po-data-table po-import-preview-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Value</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length ? (
                      previewRows.map((row, index) => (
                        <tr key={index}>
                          <td>{row.description || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {row.orderValue == null
                              ? '—'
                              : `£${formatMoney(row.orderValue)}`}
                          </td>
                          <td>{row.notes || '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="po-data-table__empty">
                          No preview rows available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

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
            Tell us which spreadsheet columns match your Order Matrix. Description
            and Order Value are required.
          </p>

          <div className="po-import-mapping">
            {headers.map((header, index) => (
              <div key={`${header}-${index}`} className="po-import-mapping__row">
                <span className="po-import-mapping__header">{header}</span>
                <select
                  className="select po-import-mapping__select"
                  value={fieldByColumn[index] || 'ignore'}
                  onChange={(event) => updateColumnField(index, event.target.value)}
                  aria-label={`Map column ${header}`}
                >
                  {Object.entries(IMPORT_FIELDS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                      {meta.required ? ' (required)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              onClick={handleMappingContinue}
            >
              Continue
            </button>
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'review' && importResult ? (
        <>
          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Check the totals</h2>
            <p className="po-import-step__lead">
              Compare your committed value with the imported total before you
              bring this matrix into the package.
            </p>

            <dl className="po-import-review-grid">
              <div>
                <dt>Committed value</dt>
                <dd>£{formatMoney(importResult.committedValue)}</dd>
              </div>
              <div>
                <dt>Imported total</dt>
                <dd>£{formatMoney(importResult.importedTotal)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd
                  className={
                    Math.abs(importResult.difference) < 0.005
                      ? 'po-import-review__balanced'
                      : importResult.difference > 0
                        ? 'po-import-review__under'
                        : 'po-import-review__over'
                  }
                >
                  {Math.abs(importResult.difference) < 0.005
                    ? '£0.00'
                    : `${importResult.difference > 0 ? '+' : '−'}£${formatMoney(Math.abs(importResult.difference))}`}
                </dd>
              </div>
            </dl>

            {importResult.warnings.length ? (
              <ul className="po-import-warnings">
                {importResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="po-import-step__ok">Everything looks ready to import.</p>
            )}
          </section>

          <section className="po-module-card po-import-step">
            <h2 className="po-matrix-section__title">Import summary</h2>
            <dl className="po-import-review-grid">
              <div>
                <dt>{importLayout === 'plot-stage' ? 'Plots to import' : 'Rows to import'}</dt>
                <dd>
                  {importLayout === 'plot-stage'
                    ? importResult.plots?.length ?? 0
                    : importResult.rows?.length ?? 0}
                </dd>
              </div>
              <div>
                <dt>Committed value</dt>
                <dd>£{formatMoney(importResult.committedValue)}</dd>
              </div>
              <div>
                <dt>Imported value</dt>
                <dd>£{formatMoney(importResult.importedTotal)}</dd>
              </div>
            </dl>

            {importResult.warnings.length ? (
              <div className="po-import-summary-warnings">
                <p className="po-import-summary-warnings__title">Warnings</p>
                <ul className="po-import-warnings">
                  {importResult.warnings.map((warning) => (
                    <li key={`summary-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="po-import-step__actions">
              <button type="button" className="po-btn-primary" onClick={handleImport}>
                Import Matrix
              </button>
              <button type="button" className="po-list-btn-secondary" onClick={goBack}>
                Back
              </button>
              <button type="button" className="po-import-step__cancel" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </section>
        </>
      ) : null}

      {currentStep?.id === 'upload' ? (
        <div className="po-import-step__actions po-import-step__actions--solo">
          <button type="button" className="po-import-step__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
