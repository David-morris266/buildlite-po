import { useCallback, useMemo, useRef, useState } from 'react';
import POPageHeader from './POPageHeader';
import {
  PLOT_IMPORT_FIELDS,
  autoDetectPlotColumnMapping,
  buildPlotImportPreview,
  detectHeaderRowIndex,
  extractHeaders,
  getPlotDetectedColumnsSummary,
  getWorksheetSummaries,
  isAcceptedExcelFile,
  parseExcelFile,
  plotMappingToFieldByColumn,
  sheetToRows,
  validateAndBuildPlotImport,
} from '../developments/plotScheduleImport';
import {
  formatPlotBedrooms,
  formatPlotGia,
} from '../developments/plotMaster';

const WIZARD_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'worksheet', label: 'Worksheet' },
  { id: 'preview', label: 'Preview' },
  { id: 'mapping', label: 'Map columns' },
  { id: 'review', label: 'Import' },
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

export default function PlotScheduleImportWizard({
  developmentName,
  onCancel,
  onImport,
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

  const visibleSteps = useMemo(() => {
    if (worksheets.length <= 1) {
      return WIZARD_STEPS.filter((step) => step.id !== 'worksheet');
    }
    return WIZARD_STEPS;
  }, [worksheets.length]);

  const currentStep = visibleSteps[stepIndex] || visibleSteps[0];

  const loadSheet = useCallback((wb, sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetToRows(sheet);
    const headerIndex = detectHeaderRowIndex(rows);
    const headerCells = extractHeaders(rows[headerIndex] || []);
    const autoMapping = autoDetectPlotColumnMapping(headerCells);
    const fields = plotMappingToFieldByColumn(headerCells, autoMapping);

    setSelectedSheet(sheetName);
    setSheetRows(rows);
    setHeaderRowIndex(headerIndex);
    setHeaders(headerCells);
    setFieldByColumn(fields);
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
    () => buildPlotImportPreview(sheetRows, headerRowIndex, fieldByColumn, 5),
    [sheetRows, headerRowIndex, fieldByColumn]
  );

  const detectedColumns = useMemo(
    () => getPlotDetectedColumnsSummary(fieldByColumn, headers),
    [fieldByColumn, headers]
  );

  const importResult = useMemo(() => {
    if (currentStep?.id !== 'review') return null;
    return validateAndBuildPlotImport(sheetRows, headerRowIndex, fieldByColumn);
  }, [currentStep?.id, sheetRows, headerRowIndex, fieldByColumn]);

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
    if (!fieldByColumn.includes('plotNumber') || !fieldByColumn.includes('houseType')) {
      setError('Plot Number and House Type are required.');
      return;
    }
    goNext();
  }

  function handleImport() {
    const result = validateAndBuildPlotImport(
      sheetRows,
      headerRowIndex,
      fieldByColumn
    );
    if (!result.ready) {
      setError('Fix the validation errors before importing.');
      return;
    }
    onImport?.(result);
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

  const lead = developmentName
    ? `Import the plot schedule for ${developmentName}.`
    : 'Import your plot schedule spreadsheet.';

  return (
    <div className="po-import-wizard dev-plot-import">
      <POPageHeader
        eyebrow="Plot Master"
        title="Import Plot Schedule"
        lead={lead}
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

          <div className="po-import-step__actions">
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'worksheet' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Choose a worksheet</h2>
          <p className="po-import-step__lead">
            This workbook has more than one worksheet. Choose the one that
            contains your plot schedule.
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
            <button type="button" className="po-import-step__cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {currentStep?.id === 'preview' ? (
        <section className="po-module-card po-import-step">
          <h2 className="po-matrix-section__title">Preview your spreadsheet</h2>
          <p className="po-import-step__lead">
            Here is a sample of what we found. Check that the plot numbers and
            house types look right before mapping columns.
          </p>

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
            <table className="po-data-table dev-plot-import__preview">
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>House Type</th>
                  <th>Bedrooms</th>
                  <th>GIA</th>
                  <th>Phase</th>
                  <th>Tenure</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.length ? (
                  previewRows.map((row, index) => (
                    <tr key={index}>
                      <td>{row.plotNumber || '—'}</td>
                      <td>{row.houseType || '—'}</td>
                      <td>{formatPlotBedrooms(row.bedrooms)}</td>
                      <td>{formatPlotGia(row.gia)}</td>
                      <td>{row.phase || '—'}</td>
                      <td>{row.tenure || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="po-data-table__empty">
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
            Tell us which spreadsheet columns match your Plot Master. Plot Number
            and House Type are required.
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
                  {Object.entries(PLOT_IMPORT_FIELDS).map(([key, meta]) => (
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
            <h2 className="po-matrix-section__title">Import summary</h2>
            <p className="po-import-step__lead">
              Review validation results before bringing this plot schedule into
              the development.
            </p>

            <dl className="po-import-review-grid dev-plot-import__summary">
              <div>
                <dt>Plots detected</dt>
                <dd>{importResult.detectedCount}</dd>
              </div>
              <div>
                <dt>Valid</dt>
                <dd>{importResult.validCount}</dd>
              </div>
              <div>
                <dt>Errors</dt>
                <dd
                  className={
                    importResult.errorCount > 0
                      ? 'dev-plot-import__errors-count'
                      : 'po-import-review__balanced'
                  }
                >
                  {importResult.errorCount}
                </dd>
              </div>
            </dl>

            {importResult.ready ? (
              <p className="po-import-step__ok">Ready to import</p>
            ) : (
              <p className="dev-plot-import__blocked" role="status">
                Import blocked — fix the errors below before continuing.
              </p>
            )}

            {importResult.errors.length ? (
              <ul className="po-import-warnings">
                {importResult.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}

            {importResult.rowErrors.length ? (
              <div className="dev-plot-import__row-errors">
                <p className="dev-plot-import__row-errors-title">Validation</p>
                <ul className="dev-plot-import__row-errors-list">
                  {importResult.rowErrors.map((entry) => (
                    <li key={`${entry.rowLabel}-${entry.issues.join('-')}`}>
                      <strong>{entry.rowLabel}</strong>
                      <span>{entry.issues.join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {importResult.infoMessages?.length ? (
              <div className="dev-plot-import__row-errors dev-plot-import__info">
                <ul className="dev-plot-import__row-errors-list">
                  {importResult.infoMessages.map((entry) => (
                    <li key={`${entry.rowLabel}-${entry.issues.join('-')}`}>
                      <strong>{entry.rowLabel}</strong>
                      <span>{entry.issues.join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <div className="po-import-step__actions">
            <button type="button" className="po-list-btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="po-btn-primary"
              disabled={!importResult.ready}
              onClick={handleImport}
            >
              Import Plot Schedule
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
