import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDevelopmentBudget, postDevelopmentBudgetEvent } from '../api/developmentBudget';
import { listServerCostCodes } from '../api/costCodes';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { IMPORT_FIELDS, parseDevelopmentBudgetFile, parseMoneyToPence, validateDevelopmentBudgetImport } from '../developmentBudget/developmentBudgetImport';
import { buildBudgetMovementLines } from '../developmentBudget/developmentBudgetMovement';
import { budgetHistoryRow, signedMoney } from '../developmentBudget/developmentBudgetPresentation';

const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);
const key = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const freshMovement = () => ({ type: 'addition', effectiveDate: today(), reference: '', reason: '', costCodeId: '', toCostCodeId: '', amount: '' });

function EventFields({ form, setForm }) {
  const change = (field, value) => setForm(current => ({ ...current, [field]: value }));
  return <div className="development-budget-form__grid">
    <label><span>Effective date</span><input className="input" type="date" value={form.effectiveDate} onChange={event => change('effectiveDate', event.target.value)} /></label>
    <label><span>Reference</span><input className="input" value={form.reference} onChange={event => change('reference', event.target.value)} /></label>
    <label className="development-budget-form__wide"><span>Reason / basis</span><input className="input" value={form.reason} onChange={event => change('reason', event.target.value)} /></label>
  </div>;
}

export default function DevelopmentBudgetWorkspace({ developmentId }) {
  const canPost = useBuildLitePermission('development_budget.post');
  const fileRef = useRef(null);
  const openingKeyRef = useRef(key('opening-budget'));
  const movementKeyRef = useRef(key('budget-movement'));
  const [authority, setAuthority] = useState(null), [costCodes, setCostCodes] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [setup, setSetup] = useState(false), [parsed, setParsed] = useState(null), [opening, setOpening] = useState({ effectiveDate: today(), reference: '', reason: '' }), [saving, setSaving] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false), [movement, setMovement] = useState(freshMovement);
  const validation = useMemo(() => parsed ? validateDevelopmentBudgetImport(parsed, costCodes) : null, [parsed, costCodes]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const [budget, response] = await Promise.all([getDevelopmentBudget(developmentId), listServerCostCodes()]); setAuthority(budget); setCostCodes(Array.isArray(response) ? response : response?.costCodes || []); }
    catch (caught) { setError(caught.message || 'Development Budget could not be loaded.'); }
    finally { setLoading(false); }
  }, [developmentId]);
  useEffect(() => { load(); }, [load]);
  function openMovement() { setMovement(freshMovement()); movementKeyRef.current = key('budget-movement'); setError(''); setMovementOpen(true); }
  function closeMovement() { setMovementOpen(false); setMovement(freshMovement()); movementKeyRef.current = key('budget-movement'); setError(''); }

  async function chooseFile(file) {
    setError('');
    try { setParsed(await parseDevelopmentBudgetFile(file)); } catch (caught) { setError(caught.message); }
  }
  async function commitOpening() {
    if (!validation?.canCommit || !opening.effectiveDate || !opening.reference.trim() || !opening.reason.trim()) { setError('Resolve the import errors and enter the effective date, reference and reason.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      await postDevelopmentBudgetEvent(developmentId, { eventType: 'opening_budget', ...opening, idempotencyKey: openingKeyRef.current, lines: validation.rows.map(row => ({ costCodeId: row.costCodeId, amount: (row.amountPence / 100).toFixed(2), explanation: row.description })) });
      openingKeyRef.current = key('opening-budget'); setSuccess('Development Budget established.'); setSetup(false); setParsed(null); await load();
    } catch (caught) { setError(caught.message); } finally { setSaving(false); }
  }
  async function commitMovement() {
    const pence = parseMoneyToPence(movement.amount);
    if (!movement.effectiveDate || !movement.reference.trim() || !movement.reason.trim() || !movement.costCodeId || !pence || (movement.type !== 'correction' && movement.type !== 'opening_adjustment' && pence < 0) || (movement.type === 'transfer' && !movement.toCostCodeId)) { setError('Complete the movement details with a valid non-zero amount.'); return; }
    const lines = buildBudgetMovementLines(movement);
    if (!lines) { setError('Select different From and To Cost Codes for a valid movement.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try { await postDevelopmentBudgetEvent(developmentId, { eventType: movement.type, effectiveDate: movement.effectiveDate, reference: movement.reference, reason: movement.reason, idempotencyKey: movementKeyRef.current, lines }); setSuccess('Budget movement posted.'); closeMovement(); await load(); }
    catch (caught) { setError(caught.message); } finally { setSaving(false); }
  }

  if (loading) return <section className="po-module-card"><p>Loading Development Budget…</p></section>;
  if (error && !authority) return <section className="po-module-card"><h2>Development Budget unavailable</h2><p role="alert">{error}</p><button className="po-list-btn-secondary" onClick={load}>Try again</button></section>;
  const positions = authority?.perCostCode || [];
  return <div className="development-budget">
    {error ? <p className="po-validation-banner" role="alert">{error}</p> : null}{success ? <p className="po-success-banner" role="status">{success}</p> : null}
    {!authority?.exists ? <section className="po-module-card"><h2>No Development Budget established</h2><p>Set the approved commercial baseline once, then record later changes as controlled Budget Movements.</p>{canPost ? <button className="po-btn-primary" onClick={() => setSetup(true)}>Set up Development Budget</button> : <p>You have read-only access. Ask an authorised commercial user to establish the budget.</p>}</section> : <>
      <section className="po-module-card"><h2>Development Budget</h2><dl className="po-import-review-grid"><div><dt>Original Budget</dt><dd>{money(authority.totalOriginalBudget)}</dd></div><div><dt>Movement</dt><dd>{signedMoney(authority.totalCurrentBudget - authority.totalOriginalBudget)}</dd></div><div><dt>Current Budget</dt><dd>{money(authority.totalCurrentBudget)}</dd></div></dl>{canPost ? <button className="po-btn-primary" onClick={openMovement}>Add Budget Movement</button> : <p>Read only</p>}<p className="po-import-step__lead">CVR continues to use its existing budget workflow until Development Budget integration is introduced.</p></section>
      <section className="po-module-card"><h2>Budget position</h2><div className="po-table-wrap"><table className="po-table"><thead><tr><th>Cost Code</th><th>Description</th><th>Original Budget</th><th>Movements</th><th>Current Budget</th></tr></thead><tbody>{positions.map(row => <tr key={row.costCodeId}><td>{row.costCode}</td><td>{row.description}</td><td>{money(row.originalBudget)}</td><td>{signedMoney(row.currentBudget - row.originalBudget)}</td><td>{money(row.currentBudget)}</td></tr>)}</tbody></table></div></section>
      <section className="po-module-card"><h2>Movement history</h2><div className="po-table-wrap"><table className="po-table development-budget-history"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Details</th><th>Movement / effect</th></tr></thead><tbody>{authority.events.slice().reverse().map(event => { const row = budgetHistoryRow(event); return <tr key={event.id}><td>{row.date}</td><td>{row.type}</td><td><strong>{row.reference}</strong></td><td>{row.details}</td><td>{row.effect}</td></tr>; })}</tbody></table></div></section>
    </>}
    {setup ? <section className="po-module-card"><h2>Set up Development Budget</h2><p>Upload one CSV or Excel file containing Cost Code and Budget amount. Nothing is committed until the final review.</p><input ref={fileRef} hidden type="file" accept=".csv,.xlsx,.xls" onChange={event => event.target.files?.[0] && chooseFile(event.target.files[0])} /><button className="po-list-btn-secondary" onClick={() => fileRef.current?.click()}>Choose budget file</button>{parsed ? <><h3>Column mapping</h3>{parsed.headers.map((header, index) => <label key={`${header}-${index}`} className="po-import-mapping__row"><span>{header}</span><select value={parsed.fieldByColumn[index]} onChange={event => setParsed(current => ({ ...current, fieldByColumn: current.fieldByColumn.map((field, i) => i === index ? event.target.value : field) }))}>{Object.entries(IMPORT_FIELDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}<h3>Final preview</h3>{validation?.missing.length ? <p role="alert">Map Cost Code and Budget amount.</p> : null}<div className="po-table-wrap"><table className="po-table"><thead><tr><th>Row</th><th>Cost Code</th><th>Description</th><th>Budget</th><th>Validation</th></tr></thead><tbody>{validation?.rows.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.code}</td><td>{row.description}</td><td>{row.amountPence == null ? '—' : money(row.amountPence / 100)}</td><td>{row.issues.join('; ') || 'Ready'}</td></tr>)}</tbody><tfoot><tr><th colSpan="3">Total</th><th>{money((validation?.totalPence || 0) / 100)}</th><th>{validation?.canCommit ? `${validation.rows.length} codes` : 'Resolve errors'}</th></tr></tfoot></table></div><EventFields form={opening} setForm={setOpening} /><div className="po-import-step__actions"><button className="po-btn-primary" disabled={saving || !validation?.canCommit} onClick={commitOpening}>{saving ? 'Establishing…' : 'Establish Opening Budget'}</button><button className="po-list-btn-secondary" disabled={saving} onClick={() => { setSetup(false); setParsed(null); }}>Cancel</button></div></> : null}</section> : null}
    {movementOpen ? <section className="po-module-card development-budget-form"><h2>Add Budget Movement</h2><div className="development-budget-form__grid"><label><span>Movement type</span><select value={movement.type} onChange={event => setMovement(current => ({ ...current, type: event.target.value, toCostCodeId: '' }))}><option value="addition">Addition</option><option value="omission">Omission</option><option value="transfer">Transfer</option><option value="correction">Correction</option><option value="opening_adjustment">Opening Adjustment</option></select></label><label><span>{movement.type === 'transfer' ? 'From Cost Code' : 'Cost Code'}</span><select value={movement.costCodeId} onChange={event => setMovement(current => ({ ...current, costCodeId: event.target.value }))}><option value="">Select…</option>{costCodes.filter(code => code.active !== false).map(code => <option key={code.id} value={code.id}>{code.code} — {code.description}</option>)}</select></label>{movement.type === 'transfer' ? <label><span>To Cost Code</span><select value={movement.toCostCodeId} onChange={event => setMovement(current => ({ ...current, toCostCodeId: event.target.value }))}><option value="">Select…</option>{costCodes.filter(code => code.active !== false).map(code => <option key={code.id} value={code.id}>{code.code} — {code.description}</option>)}</select></label> : null}<label><span>{['correction','opening_adjustment'].includes(movement.type) ? 'Signed budget effect' : 'Amount'}</span><input className="input" value={movement.amount} onChange={event => setMovement(current => ({ ...current, amount: event.target.value }))} /></label></div><EventFields form={movement} setForm={setMovement} /><div className="po-import-step__actions"><button className="po-btn-primary" disabled={saving} onClick={commitMovement}>{saving ? 'Posting…' : 'Post Budget Movement'}</button><button className="po-list-btn-secondary" disabled={saving} onClick={closeMovement}>Cancel</button></div></section> : null}
  </div>;
}
