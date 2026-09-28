import { useCallback, useMemo, useRef, useState } from 'react';
import {
  detectHeaderRowIndex,
  extractHeaders,
  getWorksheetSummaries,
  parseExcelFile,
  sheetToRows,
} from '../payments/excelImport';
import {
  CONTROLLED_SALES_STATUSES,
  SALES_REGISTER_FIELDS,
  autoDetectSalesRegisterColumns,
  buildSalesRegisterReview,
  isAcceptedSalesRegisterFile,
  sourceSalesStatuses,
} from '../revenue/salesRegisterImport';

export default function SalesRegisterImportWizard({ plots, developmentVersion, onCancel, onApply }) {
  const inputRef = useRef(null);
  const selectedWorksheetRef = useRef('');
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [worksheet, setWorksheet] = useState('');
  const [rows, setRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [headers, setHeaders] = useState([]);
  const [fieldByColumn, setFieldByColumn] = useState([]);
  const [statusMapping, setStatusMapping] = useState({});
  const [step, setStep] = useState('upload');
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  const loadSheet = useCallback((source, name) => {
    const nextRows = sheetToRows(source.Sheets[name]);
    const header = detectHeaderRowIndex(nextRows);
    const nextHeaders = extractHeaders(nextRows[header] || []);
    const mapping = autoDetectSalesRegisterColumns(nextHeaders);
    const statuses = sourceSalesStatuses(nextRows, header, mapping);
    selectedWorksheetRef.current = name;
    setWorksheet(name); setRows(nextRows); setHeaderRowIndex(header); setHeaders(nextHeaders); setFieldByColumn(mapping);
    setStatusMapping(Object.fromEntries(statuses.map((value) => [value, CONTROLLED_SALES_STATUSES.includes(value) ? value : ''])));
  }, []);

  async function chooseFile(file) {
    setError('');
    if (!isAcceptedSalesRegisterFile(file)) { setError('Choose an Excel or CSV file.'); return; }
    try {
      const next = await parseExcelFile(file);
      const sheets = getWorksheetSummaries(next);
      setFileName(file.name); setWorkbook(next); setWorksheets(sheets);
      if (sheets.length === 1) { loadSheet(next, sheets[0].name); setStep('mapping'); }
      else {
        const initialWorksheet = sheets[0]?.name || '';
        selectedWorksheetRef.current = initialWorksheet;
        setWorksheet(initialWorksheet);
        setStep('worksheet');
      }
    } catch { setError('BuildLite could not read that Sales Register file.'); }
  }

  const statuses = useMemo(() => sourceSalesStatuses(rows, headerRowIndex, fieldByColumn), [rows, headerRowIndex, fieldByColumn]);
  const review = useMemo(() => buildSalesRegisterReview({ rows, headerRowIndex, fieldByColumn, plots, statusMapping }), [rows, headerRowIndex, fieldByColumn, plots, statusMapping]);

  function setField(index, value) {
    setFieldByColumn((current) => current.map((field, column) => column === index ? value : (field === value && value !== 'ignore' ? 'ignore' : field)));
  }

  async function apply() {
    setApplying(true); setError('');
    try {
      await onApply({
        version: developmentVersion,
        fileName,
        worksheet,
        updates: review.changes.map(({ plotId, plotNumber, revenueStatus, sellingPrice }) => ({
          plotId, plotNumber,
          ...(revenueStatus ? { revenueStatus } : {}),
          ...(sellingPrice != null ? { sellingPrice } : {}),
        })),
      });
    } catch (nextError) { setError(nextError.message || 'Could not apply the Sales Register import.'); }
    finally { setApplying(false); }
  }

  return <section className="po-module-card po-import-wizard revenue-sales-import" aria-labelledby="sales-register-import-title">
    <header><h2 id="sales-register-import-title">Import Sales Register</h2><p>Review existing customer sales facts against Plot Master before anything is applied.</p></header>
    {error ? <p className="po-list-feedback po-list-feedback--error" role="alert">{error}</p> : null}
    {step === 'upload' ? <>
      <p>Excel (.xlsx/.xls) and CSV are supported. Multi-sheet workbooks can be reviewed worksheet by worksheet.</p>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" aria-label="Sales Register file" onChange={(event) => chooseFile(event.target.files?.[0])} />
    </> : null}
    {step === 'worksheet' ? <><h3>Choose worksheet</h3>{worksheets.map((sheet) => <label key={sheet.name} className="po-import-worksheet"><input type="radio" name="sales-sheet" checked={worksheet === sheet.name} onChange={() => loadSheet(workbook, sheet.name)} /> <strong>{sheet.name}</strong> · {sheet.rowCount} rows</label>)}<button type="button" className="po-btn-primary" onClick={() => { const selected = selectedWorksheetRef.current; if (selected && selected !== worksheet) loadSheet(workbook, selected); setStep('mapping'); }}>Continue</button></> : null}
    {step === 'mapping' ? <><h3>Map columns</h3><p>Worksheet: <strong>{worksheet}</strong></p><div className="po-import-mapping">{headers.map((header, index) => <label key={`${header}-${index}`} className="po-import-mapping__row"><span className="po-import-mapping__header">{header}</span><select aria-label={`Map column ${header}`} value={fieldByColumn[index] || 'ignore'} onChange={(event) => setField(index, event.target.value)}>{Object.entries(SALES_REGISTER_FIELDS).map(([key, meta]) => <option key={key} value={key}>{meta.label}{meta.required ? ' (required)' : ''}</option>)}</select></label>)}</div>
      {statuses.length ? <div><h3>Review Sales Status mapping</h3>{statuses.map((source) => <label key={source} className="po-import-mapping__row"><span>{source}</span><select aria-label={`Map source status ${source}`} value={statusMapping[source] || ''} onChange={(event) => setStatusMapping((current) => ({ ...current, [source]: event.target.value }))}><option value="">Choose controlled status</option>{CONTROLLED_SALES_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>)}</div> : null}
      <button type="button" className="po-list-btn-secondary" onClick={() => setStep(worksheets.length > 1 ? 'worksheet' : 'upload')}>Back</button>
      <button type="button" className="po-btn-primary" onClick={() => setStep('review')}>Review proposed changes</button></> : null}
    {step === 'review' ? <><h3>Review before Apply</h3><p><strong>No Plot Master data has changed yet.</strong></p>
      {review.unsupportedColumns.length ? <div className="po-list-feedback"><strong>Recognised but not imported</strong><ul>{review.unsupportedColumns.map((column) => <li key={column.field}>{column.label}</li>)}</ul></div> : null}
      {review.errors.length ? <ul className="po-import-warnings">{review.errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
      <div className="po-table-wrap"><table className="po-data-table"><thead><tr><th>Plot</th><th>House Type evidence</th><th>Reviewed changes</th></tr></thead><tbody>{review.changes.map((change) => <tr key={change.plotId}><td>{change.plotNumber}</td><td>{change.houseTypeEvidence || '—'}{change.houseTypeEvidence && change.houseTypeEvidence !== change.currentHouseType ? <small>Plot Master remains {change.currentHouseType}</small> : null}</td><td>{change.proposed.join(' · ') || 'No supported change'}</td></tr>)}</tbody></table></div>
      <button type="button" className="po-btn-primary" disabled={!review.ready || applying} onClick={apply}>{applying ? 'Applying…' : `Apply ${review.changes.length} reviewed rows`}</button></> : null}
    <button type="button" className="po-list-btn-secondary" onClick={onCancel}>Cancel</button>
  </section>;
}
