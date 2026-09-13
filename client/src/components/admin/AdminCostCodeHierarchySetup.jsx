import { useMemo, useState } from 'react';
import { bulkUpdateCostCodeHierarchyOnServer } from '../../admin/costCodeServerMutations';
import { COMMERCIAL_HEADS, hierarchyOf, hierarchyProposal } from '../../admin/costCodeCommercialHierarchy';
import AdminPageShell from './AdminPageShell';
import { AdminButton } from './adminUi';

const PAGE_SIZE = 25;
const equal = (a, b) => ['commercialHead', 'commercialFamily', 'reportingGroup'].every((key) => (a[key] || '') === (b[key] || ''));

export default function AdminCostCodeHierarchySetup({ records = [], onCancel, onApplied }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(records.map((r) => [r.id, hierarchyOf(r)])));
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('unallocated');
  const [page, setPage] = useState(1);
  const [bulkAction, setBulkAction] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const visible = useMemo(() => records.filter((record) => {
    const persisted = hierarchyOf(record);
    const needle = query.trim().toLowerCase();
    const matches = !needle || [record.code, record.description, record.legacy?.subHeading, record.legacy?.trade, record.legacy?.element]
      .some((value) => String(value || '').toLowerCase().includes(needle));
    if (!matches) return false;
    if (filter === 'unallocated') return !persisted.commercialHead;
    if (filter === 'allocated') return Boolean(persisted.commercialHead);
    return true;
  }), [records, query, filter]);
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const changes = records.filter((record) => !equal(hierarchyOf(record), drafts[record.id] || hierarchyOf(record)));

  function update(id, patch) {
    setDrafts((current) => {
      const next = { ...(current[id] || {}), ...patch };
      if (!next.commercialHead) Object.assign(next, { commercialFamily: '', reportingGroup: '' });
      return { ...current, [id]: next };
    });
  }
  function toggle(id) {
    setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function applyBulk() {
    if (!bulkAction) return;
    const commercialHead = bulkAction === 'clear' ? '' : bulkAction;
    selected.forEach((id) => update(id, { commercialHead, ...(commercialHead ? {} : { commercialFamily: '', reportingGroup: '' }) }));
  }
  async function save() {
    const invalid = changes.find((record) => drafts[record.id].commercialHead && !drafts[record.id].reportingGroup.trim());
    if (invalid) { setError(`${invalid.code} requires a Reporting Group.`); return; }
    setSaving(true); setError('');
    const result = await bulkUpdateCostCodeHierarchyOnServer(changes.map((record) => ({ id: record.id, version: record.version, ...drafts[record.id] })));
    setSaving(false);
    if (!result.ok) { setError(result.errors?.[0] || 'Could not apply hierarchy changes.'); return; }
    onApplied?.(result.costCodes);
  }

  return (
    <AdminPageShell title="Cost Code Commercial Hierarchy" lead="Review and apply the company reporting hierarchy. Legacy fields are evidence only and are never applied automatically." onBack={onCancel}
      actions={<><AdminButton variant="secondary" onClick={onCancel}>Cancel</AdminButton><AdminButton onClick={() => setReviewing(true)} disabled={!changes.length}>Review {changes.length} changes</AdminButton></>}>
      {error ? <p className="admin-inline-warning" role="alert">{error}</p> : null}
      {!reviewing ? <>
        <section className="po-module-card cost-code-hierarchy__tools">
          <label><span>Search cost codes</span><input className="input" aria-label="Search cost codes" placeholder="Code, description or legacy evidence" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
          <label><span>Show</span><select className="input" aria-label="Show cost codes" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="unallocated">Unallocated</option><option value="allocated">Allocated</option><option value="all">All</option></select></label>
          <label><span>Bulk Commercial Head</span><select className="input" aria-label="Bulk Commercial Head" value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}><option value="">Choose bulk action</option>{COMMERCIAL_HEADS.map((h) => <option key={h} value={h}>Assign {h}</option>)}<option value="clear">Clear hierarchy to Unallocated</option></select></label>
          <div className="cost-code-hierarchy__bulk-action"><span>{selected.size ? `${selected.size} selected` : 'Select cost codes first'}</span><AdminButton variant="secondary" disabled={!selected.size || !bulkAction} onClick={applyBulk}>Apply bulk action</AdminButton></div>
        </section>
        <div className="cost-code-hierarchy__rows" role="list" aria-label="Cost Code Commercial Hierarchy">
          {pageRows.map((record) => { const draft = drafts[record.id]; const proposal = hierarchyProposal(record); const proposalPersisted = proposal && equal(hierarchyOf(record), proposal); const proposalPending = proposal && !proposalPersisted && equal(draft, proposal); return <article className="cost-code-hierarchy__row" role="listitem" key={record.id}>
            <section className="cost-code-hierarchy__identity"><label className="cost-code-hierarchy__select"><input type="checkbox" aria-label={`Select ${record.code}`} checked={selected.has(record.id)} onChange={() => toggle(record.id)} /><span>Select</span></label><strong>{record.code}</strong><span>{record.description}</span></section>
            <section className="cost-code-hierarchy__legacy"><h3>Legacy evidence</h3><span>{[record.legacy?.subHeading, record.legacy?.trade, record.legacy?.element].filter(Boolean).join(' · ') || '—'}</span>{proposal && !proposalPersisted ? <div className="cost-code-hierarchy__proposal"><strong>Suggested Commercial Head: Land</strong>{proposalPending ? <span>Added to review</span> : <button type="button" className="admin-link-button" onClick={() => update(record.id, proposal)}>Use suggestion</button>}</div> : null}</section>
            <section className="cost-code-hierarchy__fields"><label><span>Commercial Head</span><select className="input" aria-label={`${record.code} Commercial Head`} value={draft.commercialHead} onChange={(e) => update(record.id, { commercialHead: e.target.value })}><option value="">Unallocated</option>{COMMERCIAL_HEADS.map((h) => <option key={h}>{h}</option>)}</select></label><label><span>Commercial Family</span><input className="input" aria-label={`${record.code} Family`} value={draft.commercialFamily} disabled={!draft.commercialHead} onChange={(e) => update(record.id, { commercialFamily: e.target.value })} /></label><label><span>Reporting Group</span><input className="input" aria-label={`${record.code} Reporting Group`} value={draft.reportingGroup} disabled={!draft.commercialHead} onChange={(e) => update(record.id, { reportingGroup: e.target.value })} /></label></section>
          </article>; })}
        </div>
        <div className="cost-code-hierarchy__pager"><span>{visible.length} cost codes</span><AdminButton variant="secondary" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>Previous</AdminButton><span>Page {page}</span><AdminButton variant="secondary" disabled={page * PAGE_SIZE >= visible.length} onClick={() => setPage((n) => n + 1)}>Next</AdminButton></div>
      </> : <section className="po-module-card"><h2>Review hierarchy changes</h2><p>No Cost Code identity, legacy evidence, budget or CVR facts will be changed.</p><div className="cost-code-hierarchy__review">{changes.map((record) => <article key={record.id}><strong>{record.code} — {record.description}</strong><span>{hierarchyOf(record).commercialHead || 'Unallocated'} → {drafts[record.id].commercialHead || 'Unallocated'}</span><span>{drafts[record.id].commercialFamily || 'No family'} · {drafts[record.id].reportingGroup || 'No reporting group'}</span></article>)}</div><div className="admin-form__actions"><AdminButton variant="secondary" onClick={() => setReviewing(false)}>Back</AdminButton><AdminButton loading={saving} onClick={save}>Apply hierarchy changes</AdminButton></div></section>}
    </AdminPageShell>
  );
}
