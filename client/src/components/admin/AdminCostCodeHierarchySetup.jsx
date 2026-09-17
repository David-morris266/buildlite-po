import { useEffect, useMemo, useRef, useState } from 'react';
import { bulkUpdateCostCodeHierarchyOnServer } from '../../admin/costCodeServerMutations';
import { hierarchyLabels, hierarchyOf, hierarchyProposal } from '../../admin/costCodeCommercialHierarchy';
import { activeHeads, familiesFor, groupsFor, loadCommercialStructure, pathLabels } from '../../admin/commercialStructureService';
import { getCostCodeOnboardingSummary } from '../../api/costCodes';
import { applyCostCodeHierarchyWorksheet, getCostCodeHierarchyWorksheet, previewCostCodeHierarchyWorksheet } from '../../api/costCodes';
import { downloadHierarchyWorksheet, parseHierarchyWorksheet } from '../../admin/costCodeHierarchyWorksheet';
import { invalidateCostCodes, refreshCostCodes } from '../../admin/costCodeServerCache';
import AdminPageShell from './AdminPageShell';
import { AdminButton } from './adminUi';

const PAGE_SIZE = 25;
const KEYS = ['commercialHeadId', 'commercialFamilyId', 'reportingGroupId', 'reviewDisposition'];
const equal = (a, b) => KEYS.every((key) => (a?.[key] || null) === (b?.[key] || null));
const stateOf = (record) => record.hierarchyReviewState || 'needs_attention';

export default function AdminCostCodeHierarchySetup({ records = [], onCancel, onApplied }) {
  const worksheetInput = useRef(null);
  const [worksheetRecords, setWorksheetRecords] = useState(null);
  const activeRecords = useMemo(() => (worksheetRecords || records).filter((record) => record.active !== false), [records, worksheetRecords]);
  const [catalogue, setCatalogue] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState(() => Object.fromEntries(activeRecords.map((record) => [record.id, { ...hierarchyOf(record), reviewDisposition: record.hierarchyReviewDisposition || null }])));
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('not_reviewed');
  const [page, setPage] = useState(1);
  const [bulkHead, setBulkHead] = useState('');
  const [bulkFamily, setBulkFamily] = useState('');
  const [bulkGroup, setBulkGroup] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [worksheetBusy, setWorksheetBusy] = useState(false);
  const [worksheetRows, setWorksheetRows] = useState(null);
  const [worksheetFilename, setWorksheetFilename] = useState('');
  const [worksheetPreview, setWorksheetPreview] = useState(null);
  const [worksheetResult, setWorksheetResult] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadCommercialStructure(), getCostCodeOnboardingSummary()])
      .then(([structure, authoritativeSummary]) => {
        if (!live) return;
        setCatalogue(structure);
        setSummary(authoritativeSummary);
      })
      .catch((cause) => { if (live) setError(cause.message || 'Could not load Cost Code onboarding authority.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const visible = useMemo(() => activeRecords.filter((record) => {
    const evidence = (record.importEvidence || []).flatMap((item) => Object.entries(item.hierarchyEvidence || {}).flatMap(([key, value]) => [key, value?.value]));
    const needle = query.trim().toLowerCase();
    const matches = !needle || [record.code, record.description, record.legacy?.subHeading, record.legacy?.trade, record.legacy?.element, ...evidence]
      .some((value) => String(value || '').toLowerCase().includes(needle));
    return matches && (filter === 'all' || stateOf(record) === filter);
  }), [activeRecords, query, filter]);

  const changes = activeRecords.filter((record) => !equal({ ...hierarchyOf(record), reviewDisposition: record.hierarchyReviewDisposition || null }, drafts[record.id]));
  const update = (id, patch) => setDrafts((current) => {
    const next = { ...current[id], ...patch };
    if (next.commercialHeadId) next.reviewDisposition = null;
    if (Object.prototype.hasOwnProperty.call(patch, 'commercialHeadId') && !patch.commercialHeadId && !Object.prototype.hasOwnProperty.call(patch, 'reviewDisposition')) next.reviewDisposition = null;
    if (!next.commercialHeadId) { next.commercialFamilyId = null; next.reportingGroupId = null; }
    return { ...current, [id]: next };
  });
  const toggle = (id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const applyBulk = () => { if (bulkHead && bulkGroup) for (const id of selected) update(id, { commercialHeadId: bulkHead, commercialFamilyId: bulkFamily || null, reportingGroupId: bulkGroup, reviewDisposition: null }); };
  const markNotApplicable = () => { for (const id of selected) update(id, { commercialHeadId: null, commercialFamilyId: null, reportingGroupId: null, reviewDisposition: 'not_applicable' }); };

  async function save() {
    const invalid = changes.find((record) => drafts[record.id].commercialHeadId && !drafts[record.id].reportingGroupId);
    if (invalid) { setError(`${invalid.code} requires a Reporting Group.`); return; }
    setSaving(true); setError('');
    const result = await bulkUpdateCostCodeHierarchyOnServer(changes.map((record) => ({ id: record.id, version: record.version, ...drafts[record.id] })));
    setSaving(false);
    if (!result.ok) { setError(result.errors?.[0] || 'Could not apply hierarchy changes.'); return; }
    onApplied?.(result.costCodes);
  }

  async function exportWorksheet() {
    setWorksheetBusy(true); setError('');
    try { const response = await getCostCodeHierarchyWorksheet(); await downloadHierarchyWorksheet(response.worksheet); }
    catch (cause) { setError(cause.message || 'Could not export the mapping worksheet.'); }
    finally { setWorksheetBusy(false); }
  }

  async function importWorksheet(file) {
    if (!file) return;
    setWorksheetBusy(true); setError(''); setWorksheetPreview(null); setWorksheetResult(null);
    try {
      const rows = await parseHierarchyWorksheet(file);
      const response = await previewCostCodeHierarchyWorksheet(rows, file.name);
      setWorksheetRows(rows); setWorksheetFilename(file.name); setWorksheetPreview(response.preview);
    } catch (cause) { setError(cause.message || 'Could not preview the mapping worksheet.'); }
    finally { setWorksheetBusy(false); if (worksheetInput.current) worksheetInput.current.value = ''; }
  }

  async function applyWorksheet() {
    setWorksheetBusy(true); setError('');
    try {
      const response = await applyCostCodeHierarchyWorksheet({ rows: worksheetRows, sourceFilename: worksheetFilename, catalogueRevision: worksheetPreview.catalogueRevision, reviewToken: worksheetPreview.reviewToken });
      invalidateCostCodes();
      const [freshRecords, freshStructure, freshSummary] = await Promise.all([refreshCostCodes(), loadCommercialStructure(), getCostCodeOnboardingSummary()]);
      setWorksheetRecords(freshRecords); setDrafts(Object.fromEntries(freshRecords.filter((record) => record.active !== false).map((record) => [record.id, { ...hierarchyOf(record), reviewDisposition: record.hierarchyReviewDisposition || null }]))); setSelected(new Set()); setCatalogue(freshStructure); setSummary(freshSummary);
      setWorksheetResult(response.summary); setWorksheetPreview(null); setWorksheetRows(null);
    } catch (cause) { setError(cause.message || 'Could not apply the reviewed mapping.'); }
    finally { setWorksheetBusy(false); }
  }

  if (loading) return <AdminPageShell title="Cost Code Commercial Hierarchy" onBack={onCancel}><p>Loading company Commercial Structure…</p></AdminPageShell>;
  if (!catalogue || !summary) return <AdminPageShell title="Cost Code Commercial Hierarchy" onBack={onCancel}><p role="alert">{error || 'Cost Code onboarding authority is unavailable.'}</p><AdminButton onClick={onCancel}>Back</AdminButton></AdminPageShell>;

  const separator = <span aria-hidden="true"> {'\u00B7'} </span>;
  return <AdminPageShell title="Cost Code Commercial Hierarchy" lead="Review and apply the company reporting hierarchy. Source evidence is never applied automatically." onBack={onCancel} actions={<><AdminButton variant="secondary" onClick={onCancel}>Cancel</AdminButton><AdminButton onClick={() => setReviewing(true)} disabled={!changes.length}>Review {changes.length} changes</AdminButton></>}>
    {error ? <p className="admin-inline-warning" role="alert">{error}</p> : null}
    {!reviewing ? <>
      <section className="po-module-card"><h2>Onboarding review</h2><p>{summary.total} active{separator}{summary.allocated} Allocated{separator}{summary.notReviewed} Not reviewed{separator}{summary.notApplicable} Not applicable{separator}{summary.needsAttention} Needs attention</p></section>
      <section className="po-module-card">
        <h2>Mapping worksheet</h2><p>Use Excel to review a large Cost Code population, then preview every hierarchy change before applying it.</p>
        <div className="setup-import-actions"><AdminButton variant="secondary" loading={worksheetBusy} onClick={exportWorksheet}>Export mapping worksheet</AdminButton><AdminButton variant="secondary" disabled={worksheetBusy} onClick={() => worksheetInput.current?.click()}>Import completed mapping</AdminButton><input ref={worksheetInput} hidden type="file" accept=".xlsx" aria-label="Completed hierarchy mapping worksheet" onChange={(event) => importWorksheet(event.target.files?.[0])} /></div>
        {worksheetPreview ? <div className="cost-code-hierarchy__worksheet-preview"><h3>Review mapping worksheet</h3><p>{worksheetPreview.summary.rowsReviewed} rows reviewed{separator}{worksheetPreview.summary.allocations} allocations{separator}{worksheetPreview.summary.notApplicable} Not Applicable{separator}{worksheetPreview.summary.unchanged} unchanged{separator}{worksheetPreview.summary.blockers} blockers</p><p>{worksheetPreview.summary.existingPathsMatched} existing paths{separator}{worksheetPreview.summary.newHeads} new Heads{separator}{worksheetPreview.summary.newFamilies} new Families{separator}{worksheetPreview.summary.newReportingGroups} new Reporting Groups</p>{worksheetPreview.proposals?.length ? <details><summary>Proposed new Commercial Structure</summary>{worksheetPreview.proposals.map((proposal) => <p key={proposal.key}>{proposal.commercialHead}{proposal.commercialFamily ? ` → ${proposal.commercialFamily}` : ''} → {proposal.reportingGroup} ({proposal.costCodes.length} Cost Codes)</p>)}</details> : null}<details><summary>Before → after detail</summary>{worksheetPreview.rows.map((row) => <p key={`${row.rowNumber}-${row.id}`} className={row.blocker ? 'setup-step__error' : ''}><strong>{row.code}</strong>: {row.before?.labels?.commercialHead || row.before?.state || 'Unreviewed'} → {row.action === 'not_applicable' ? 'Not Applicable' : row.after?.labels?.commercialHead ? `${row.after.labels.commercialHead}${row.after.labels.commercialFamily ? ` → ${row.after.labels.commercialFamily}` : ''} → ${row.after.labels.reportingGroup}` : row.action}{row.blocker ? ` — ${row.blocker}` : ''}</p>)}</details><AdminButton variant="secondary" onClick={() => { setWorksheetPreview(null); setWorksheetRows(null); }}>Cancel preview</AdminButton><AdminButton loading={worksheetBusy} disabled={worksheetPreview.summary.blockers > 0} onClick={applyWorksheet}>Apply reviewed mapping</AdminButton></div> : null}
        {worksheetResult ? <div role="status"><strong>Mapping applied.</strong> {worksheetResult.updated} Cost Codes updated. <AdminButton onClick={() => onApplied?.()}>Done</AdminButton></div> : null}
      </section>
      <section className="po-module-card cost-code-hierarchy__tools">
        <label><span>Search codes or import evidence</span><input className="input" aria-label="Search cost codes" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
        <label><span>Show</span><select className="input" aria-label="Show cost codes" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="not_reviewed">Not reviewed</option><option value="needs_attention">Needs attention</option><option value="not_applicable">Not applicable</option><option value="allocated">Allocated</option><option value="all">All</option></select></label>
        <AdminButton variant="secondary" disabled={!visible.length} onClick={() => setSelected(new Set(visible.map((record) => record.id)))}>Select all filtered ({visible.length})</AdminButton>
        <label><span>Bulk Commercial Head</span><select className="input" aria-label="Bulk Commercial Head" value={bulkHead} onChange={(event) => { setBulkHead(event.target.value); setBulkFamily(''); setBulkGroup(''); }}><option value="">Choose Head</option>{activeHeads(catalogue).map((head) => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
        <label><span>Optional Family</span><select className="input" aria-label="Bulk Commercial Family" value={bulkFamily} disabled={!bulkHead} onChange={(event) => { setBulkFamily(event.target.value); setBulkGroup(''); }}><option value="">No family</option>{familiesFor(catalogue, bulkHead).map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
        <label><span>Reporting Group</span><select className="input" aria-label="Bulk Reporting Group" value={bulkGroup} disabled={!bulkHead} onChange={(event) => setBulkGroup(event.target.value)}><option value="">Choose Reporting Group</option>{groupsFor(catalogue, bulkHead, bulkFamily || null).filter((group) => group.active).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <AdminButton variant="secondary" disabled={!selected.size || !bulkHead || !bulkGroup} onClick={applyBulk}>Assign complete path to {selected.size}</AdminButton>
        <AdminButton variant="secondary" disabled={!selected.size} onClick={markNotApplicable}>Mark {selected.size} Not applicable</AdminButton>
      </section>
      <div className="cost-code-hierarchy__rows" role="list">{visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((record) => {
        const draft = drafts[record.id]; const head = catalogue.heads.find((item) => item.id === draft.commercialHeadId);
        const families = familiesFor(catalogue, draft.commercialHeadId, { includeId: draft.commercialFamilyId });
        const groups = groupsFor(catalogue, draft.commercialHeadId, draft.commercialFamilyId, { includeId: draft.reportingGroupId });
        const proposal = hierarchyProposal(record, catalogue); const pending = proposal && equal(draft, proposal) && !equal(hierarchyOf(record), proposal); const currentLabels = hierarchyLabels(record, catalogue);
        return <article className="cost-code-hierarchy__row" role="listitem" key={record.id}>
          <section className="cost-code-hierarchy__identity"><label><input type="checkbox" aria-label={`Select ${record.code}`} checked={selected.has(record.id)} onChange={() => toggle(record.id)} /> Select</label><strong>{record.code}</strong><span>{record.description}</span></section>
          <section className="cost-code-hierarchy__legacy"><h3>Source evidence</h3><span>{[record.legacy?.subHeading, record.legacy?.trade, record.legacy?.element].filter(Boolean).join(' · ') || '—'}</span>{proposal && !equal(hierarchyOf(record), proposal) ? <div><strong>Suggested Commercial Head: Land</strong>{pending ? <span>Added to review</span> : <button type="button" className="admin-link-button" onClick={() => update(record.id, proposal)}>Use suggestion</button>}</div> : null}</section>
          <section className="cost-code-hierarchy__fields">
            <label><span>Commercial Head</span><select className="input" aria-label={`${record.code} Commercial Head`} value={draft.commercialHeadId || ''} onChange={(event) => update(record.id, { commercialHeadId: event.target.value || null, commercialFamilyId: null, reportingGroupId: null })}><option value="">Unallocated</option>{activeHeads(catalogue).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{head && !head.active ? <option value={head.id}>{head.name} (Archived)</option> : null}</select></label>
            <label><span>Commercial Family</span><select className="input" aria-label={`${record.code} Family`} value={draft.commercialFamilyId || ''} disabled={!draft.commercialHeadId} onChange={(event) => update(record.id, { commercialFamilyId: event.target.value || null, reportingGroupId: null })}><option value="">No family</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (Archived)' : ''}</option>)}</select></label>
            <label><span>Reporting Group</span><select className="input" aria-label={`${record.code} Reporting Group`} value={draft.reportingGroupId || ''} disabled={!draft.commercialHeadId} onChange={(event) => update(record.id, { reportingGroupId: event.target.value || null })}><option value="">Not set</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (Archived)' : ''}</option>)}</select></label>
            {!record.commercialHeadId && record.commercialHead ? <small>Unresolved legacy hierarchy: {currentLabels.commercialHead} · {currentLabels.reportingGroup || 'No reporting group'}</small> : null}
          </section>
        </article>;
      })}</div>
      <div className="cost-code-hierarchy__pager"><span>{visible.length} cost codes</span><AdminButton disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</AdminButton><span>Page {page}</span><AdminButton disabled={page * PAGE_SIZE >= visible.length} onClick={() => setPage((value) => value + 1)}>Next</AdminButton></div>
    </> : <section className="po-module-card"><h2>Review hierarchy changes</h2><div className="cost-code-hierarchy__review">{changes.map((record) => { const before = hierarchyLabels(record, catalogue); const after = pathLabels(catalogue, drafts[record.id]); return <article key={record.id}><strong>{record.code} — {record.description}</strong><span>{before.commercialHead || 'Unallocated'} → {after.commercialHead || (drafts[record.id].reviewDisposition === 'not_applicable' ? 'Not applicable' : 'Unallocated')}</span><span>{after.commercialFamily || 'No family'} · {after.reportingGroup || 'No reporting group'}</span></article>; })}</div><AdminButton onClick={() => setReviewing(false)}>Back</AdminButton><AdminButton loading={saving} onClick={save}>Apply hierarchy changes</AdminButton></section>}
  </AdminPageShell>;
}
