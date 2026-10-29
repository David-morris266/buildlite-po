import { useCallback, useMemo, useRef, useState } from 'react';
import { detectHeaderRowIndex, extractHeaders, getWorksheetSummaries, parseExcelFile, sheetToRawRows } from '../payments/excelImport';
import { CONTROLLED_SALES_STATUSES, SALES_REGISTER_FIELDS, autoDetectSalesRegisterColumns, buildSalesRegisterReview, isAcceptedSalesRegisterFile, sourceSalesStatuses } from '../revenue/salesRegisterImport';

const gbp = (value) => value == null ? 'Unavailable' : `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SalesRegisterImportWizard({ plots, developmentVersion, onCancel, onPreview, onApply }) {
  const inputRef = useRef(null);
  const selectedWorksheetRef = useRef('');
  const [fileName, setFileName] = useState('');
  const [sha256, setSha256] = useState('');
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
  const [busy, setBusy] = useState(false);
  const [treatment, setTreatment] = useState('contractual_selling_price');
  const [reason, setReason] = useState('');
  const [replaceSupersededImport, setReplaceSupersededImport] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  const resetServerReview = useCallback(() => {
    setPreview(null);
    setConfirmed(false);
  }, []);

  const loadSheet = useCallback((source, name) => {
    const nextRows = sheetToRawRows(source.Sheets[name]);
    const header = detectHeaderRowIndex(nextRows);
    const nextHeaders = extractHeaders(nextRows[header] || []);
    const mapping = autoDetectSalesRegisterColumns(nextHeaders);
    const statuses = sourceSalesStatuses(nextRows, header, mapping);
    selectedWorksheetRef.current = name;
    setWorksheet(name);
    setRows(nextRows);
    setHeaderRowIndex(header);
    setHeaders(nextHeaders);
    setFieldByColumn(mapping);
    setStatusMapping(Object.fromEntries(statuses.map((value) => [value, CONTROLLED_SALES_STATUSES.includes(value) ? value : ''])));
    setPreview(null);
    setConfirmed(false);
  }, []);

  async function chooseFile(file) {
    setError('');
    resetServerReview();
    if (!isAcceptedSalesRegisterFile(file)) {
      setError('Choose an Excel or CSV file.');
      return;
    }
    try {
      const next = await parseExcelFile(file);
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const sheets = getWorksheetSummaries(next);
      setSha256([...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join(''));
      setFileName(file.name);
      setWorkbook(next);
      setWorksheets(sheets);
      if (sheets.length === 1) {
        loadSheet(next, sheets[0].name);
        setStep('mapping');
      } else {
        const initial = sheets[0]?.name || '';
        selectedWorksheetRef.current = initial;
        setWorksheet(initial);
        setStep('worksheet');
      }
    } catch {
      setError('BuildLite could not read that Sales Register file.');
    }
  }

  const statuses = useMemo(() => sourceSalesStatuses(rows, headerRowIndex, fieldByColumn), [rows, headerRowIndex, fieldByColumn]);
  const review = useMemo(() => buildSalesRegisterReview({ rows, headerRowIndex, fieldByColumn, plots, statusMapping, treatment }), [rows, headerRowIndex, fieldByColumn, plots, statusMapping, treatment]);
  const houseTypeMismatchCount = useMemo(
    () => review.changes.filter((change) => change.houseTypeMismatch).length,
    [review.changes]
  );

  function setField(index, value) {
    setFieldByColumn((current) => current.map((field, column) => column === index ? value : (field === value && value !== 'ignore' ? 'ignore' : field)));
    resetServerReview();
  }

  const payload = useMemo(() => ({
    version: developmentVersion,
    treatment,
    reason,
    replaceSupersededImport,
    sourceEvidence: {
      fileName,
      worksheet,
      sha256,
      sourceRowCount: rows.slice(headerRowIndex + 1).filter((row) => (row || []).some((cell) => String(cell || '').trim())).length,
      mapping: headers.map((header, index) => ({ header, destination: fieldByColumn[index] || 'ignore' })),
    },
    excludedRows: [],
    updates: review.changes.map(({ plotId, plotNumber, revenueStatus, importedPrice, sourceRowNumber }) => ({
      plotId, plotNumber, sourceRowNumber, importedPrice, ...(revenueStatus ? { revenueStatus } : {}),
    })),
  }), [developmentVersion, treatment, reason, replaceSupersededImport, fileName, worksheet, sha256, rows, headerRowIndex, headers, fieldByColumn, review.changes]);

  async function previewDifferences() {
    setBusy(true);
    setError('');
    resetServerReview();
    try {
      const result = await onPreview(payload);
      setPreview(result.preview);
    } catch (next) {
      setError(next.message || 'Could not preview the Sales Register import.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      await onApply({ ...payload, previewFingerprint: preview.fingerprint });
    } catch (next) {
      setError(next.message || 'Could not apply the Sales Register import.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="po-module-card po-import-wizard revenue-sales-import" aria-labelledby="sales-register-import-title">
    <header><h2 id="sales-register-import-title">Import Sales Register</h2><p>Review existing customer sales facts, plot identity, lifecycle evidence and price authority before anything is applied.</p></header>
    {error ? <p className="po-list-feedback po-list-feedback--error" role="alert">{error}</p> : null}
    {step === 'upload' ? <><p>Excel (.xlsx/.xls) and CSV are supported. Multi-sheet workbooks can be reviewed worksheet by worksheet.</p><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" aria-label="Sales Register file" onChange={(event) => chooseFile(event.target.files?.[0])} /></> : null}
    {step === 'worksheet' ? <><h3>Choose worksheet</h3>{worksheets.map((sheet) => <label key={sheet.name} className="po-import-worksheet"><input type="radio" name="sales-sheet" checked={worksheet === sheet.name} onChange={() => loadSheet(workbook, sheet.name)} /> <strong>{sheet.name}</strong> · {sheet.rowCount} rows</label>)}<button type="button" className="po-btn-primary" onClick={() => { const selected = selectedWorksheetRef.current; if (selected && selected !== worksheet) loadSheet(workbook, selected); setStep('mapping'); }}>Continue</button></> : null}
    {step === 'mapping' ? <>
      <h3>Choose price authority and map columns</h3><p>Worksheet: <strong>{worksheet}</strong></p>
      <label className="po-import-mapping__row"><span>Imported price treatment</span><select aria-label="Imported price treatment" value={treatment} onChange={(event) => { setTreatment(event.target.value); setReplaceSupersededImport(false); resetServerReview(); }}><option value="contractual_selling_price">Contractual selling-price evidence</option><option value="forecast_manual_value">Adopt as plot forecast — Manual Value</option></select></label>
      <p>{treatment === 'forecast_manual_value' ? 'Available plot forecasts will be adopted without changing sales status or applying affordable discounts again.' : 'Use this only for genuine reservation, exchange or completion price evidence.'}</p>
      <div className="po-import-mapping">{headers.map((header, index) => <label key={`${header}-${index}`} className="po-import-mapping__row"><span className="po-import-mapping__header">{header}</span><select aria-label={`Map column ${header}`} value={fieldByColumn[index] || 'ignore'} onChange={(event) => setField(index, event.target.value)}>{Object.entries(SALES_REGISTER_FIELDS).map(([key, meta]) => <option key={key} value={key}>{meta.label}{meta.required ? ' (required)' : ''}</option>)}</select></label>)}</div>
      {statuses.length ? <div><h3>Review Sales Status mapping</h3>{statuses.map((source) => <label key={source} className="po-import-mapping__row"><span>{source}</span><select aria-label={`Map source status ${source}`} value={statusMapping[source] || ''} onChange={(event) => { setStatusMapping((current) => ({ ...current, [source]: event.target.value })); resetServerReview(); }}><option value="">Choose controlled status</option>{CONTROLLED_SALES_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>)}</div> : null}
      <button type="button" className="po-list-btn-secondary" onClick={() => setStep(worksheets.length > 1 ? 'worksheet' : 'upload')}>Back</button><button type="button" className="po-btn-primary" onClick={() => setStep('review')}>Review proposed changes</button>
    </> : null}
    {step === 'review' ? <>
      <h3>Review before Apply</h3><p><strong>No Plot Master data has changed yet.</strong></p>
      <label><span>Commercial reason</span><textarea value={reason} onChange={(event) => { setReason(event.target.value); resetServerReview(); }} /></label>
      {treatment === 'forecast_manual_value' ? <label><input type="checkbox" checked={replaceSupersededImport} onChange={(event) => { setReplaceSupersededImport(event.target.checked); resetServerReview(); }} /> Replace previously imported forecasts that a QS subsequently edited. Superseded provenance remains recorded.</label> : null}
      {review.unsupportedColumns.length ? <div className="po-list-feedback"><strong>Recognised but not imported</strong><ul>{review.unsupportedColumns.map((column) => <li key={column.field}>{column.label}</li>)}</ul></div> : null}
      {review.errors.length ? <ul className="po-import-warnings">{review.errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
      <div className="revenue-sales-import__preview-action"><button type="button" className="po-btn-primary" disabled={!review.ready || busy || !reason.trim() || !sha256} onClick={previewDifferences}>{busy ? 'Building preview…' : 'Preview authoritative GDV'}</button></div>
      {preview ? <section className="revenue-sales-import__reconciliation" aria-labelledby="sales-import-reconciliation-title"><h3 id="sales-import-reconciliation-title">Server reconciliation</h3><div className="revenue-sales-import__reconciliation-grid"><span>Source rows<strong>{preview.sourceRowCount}</strong></span><span>Accepted<strong>{preview.acceptedRowCount}</strong></span><span>Rejected<strong>{preview.rejectedRowCount}</strong></span><span>Excluded<strong>{preview.excludedRowCount}</strong></span><span>Source price total<strong>{gbp(preview.sourceTotal)}</strong></span><span>Projected authoritative GDV<strong>{gbp(preview.projectedAuthoritativeGdv)}</strong></span><span>Difference<strong>{gbp(preview.difference)}</strong></span></div>{preview.errors?.length ? <ul className="revenue-sales-import__exceptions">{preview.errors.map((item) => <li key={`${item.sourceRowNumber}-${item.plotNumber}`}>Row {item.sourceRowNumber} · Plot {item.plotNumber || '—'}: {item.reason}</li>)}</ul> : null}{preview.authorityBlockers?.length ? <ul className="revenue-sales-import__exceptions">{preview.authorityBlockers.map((item, index) => <li key={index}>{item.message || item.reason}</li>)}</ul> : null}<div className="revenue-sales-import__confirmation"><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> <span>{treatment === 'forecast_manual_value' ? 'I confirm the source rows, forecast treatment and exact authoritative GDV reconcile.' : 'I confirm the source rows and contractual lifecycle evidence are correct; the displayed GDV difference is informational.'}</span></label><button type="button" className="po-btn-primary" disabled={!preview.canApply || !confirmed || busy} onClick={apply}>{busy ? 'Applying…' : `Apply ${preview.acceptedRowCount} reviewed rows`}</button></div></section> : null}
      <details className="revenue-sales-import__rows"><summary>Review {review.changes.length} plot row{review.changes.length === 1 ? '' : 's'}{houseTypeMismatchCount ? ` · ${houseTypeMismatchCount} House Type mismatch${houseTypeMismatchCount === 1 ? '' : 'es'}` : ''}</summary><div className="po-table-wrap"><table className="po-data-table"><thead><tr><th>Excel row</th><th>Plot</th><th>House Type evidence</th><th>Reviewed changes</th></tr></thead><tbody>{review.changes.map((change) => <tr key={change.plotId}><td>{change.sourceRowNumber}</td><td>{change.plotNumber}</td><td>{change.houseTypeEvidence || '—'}{change.houseTypeMismatch ? <strong className="po-import-warning"> — differs from Plot Master {change.currentHouseType || 'Unavailable'}</strong> : null}</td><td>{change.proposed.join(' · ') || 'No supported change'}</td></tr>)}</tbody></table></div></details>
    </> : null}
    <button type="button" className="po-list-btn-secondary" onClick={onCancel}>Cancel</button>
  </section>;
}
