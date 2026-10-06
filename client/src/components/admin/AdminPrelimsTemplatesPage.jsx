import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { listCostCodeClassifications } from '../../api/costCodeClassifications';
import { loadCommercialStructure } from '../../admin/commercialStructureService';
import {
  PrelimsTemplateApiError,
  createPrelimsTemplate,
  createPrelimsTemplateLine,
  applyReviewedPrelimsMappings,
  getPrelimsTemplate,
  listPrelimsTemplates,
  updatePrelimsTemplate,
  updatePrelimsTemplateLine,
} from '../../api/prelimsTemplates';
import { commercialHeadCostCodeDiscovery } from '../../admin/commercialHeadCostCodeDiscovery';
import { proposePrelimsMappings } from '../../prelims/prelimsMappingProposals';
import { listCostCodesForTemplateMapping } from '../../admin/prelimsTemplateCostCodes';
import { TIME_BASIS_LABELS } from '../../prelims/prelimsConstants';
import {
  classifyTemplateMapping,
  filterTemplateLinesByMapping,
  mappingOptionLabel,
  sharedCostCodeCounts,
  templateMappingSummary,
} from '../../admin/prelimsTemplateMapping';
import AdminPageShell from './AdminPageShell';
import CommercialHeadCostCodePicker from '../CommercialHeadCostCodePicker';
import { AdminButton, AdminDataTable, AdminStatusBadge } from './adminUi';

const TIME_BASES = ['SITE_START', 'FIRST_COMPLETION', 'FINAL_COMPLETION'];

function driverLabel(driver) {
  if (driver === 'TIME') return 'Time based';
  if (driver === 'LUMP_SUM') return 'Lump sum';
  return driver || '—';
}

function timeBasisLabel(basis) {
  return TIME_BASIS_LABELS[basis] || basis || '—';
}

function originLabel(origin) {
  if (origin === 'buildlite_standard') return 'BuildLite Standard';
  if (origin === 'blank') return 'Blank';
  return origin || '—';
}

function emptyLineForm(displayOrder = 0) {
  return {
    id: null,
    version: 0,
    templateKey: '',
    name: '',
    description: '',
    forecastDriver: 'TIME',
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    costCodeKey: '',
    enabled: true,
    displayOrder,
  };
}

function lineToForm(line) {
  return {
    id: line.id,
    version: line.version,
    templateKey: line.templateKey,
    name: line.name || '',
    description: line.description || '',
    forecastDriver: line.forecastDriver || 'TIME',
    startBasis: line.startBasis || 'SITE_START',
    endBasis: line.endBasis || 'FINAL_COMPLETION',
    costCodeKey: line.costCodeKey || '',
    enabled: line.enabled !== false,
    displayOrder: line.displayOrder || 0,
  };
}

function linePayload(form) {
  const driver = form.forecastDriver;
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    forecastDriver: driver,
    costCodeKey: form.costCodeKey.trim() || null,
    enabled: form.enabled !== false,
    displayOrder: form.displayOrder || 0,
    startBasis: driver === 'TIME' ? form.startBasis : null,
    endBasis: driver === 'TIME' ? form.endBasis : null,
  };
  if (form.id) {
    payload.version = form.version;
    payload.templateKey = form.templateKey;
  }
  return payload;
}

function TemplateLineForm({
  form,
  busy,
  classificationFor,
  costCodes,
  commercialStructure,
  onSetUpCommercialStructure,
  onSubmit,
  onCancel,
  onUpdateForm,
}) {
  return (
    <form
      className="dev-prelims__form admin-prelims-line-form"
      aria-label={form.id ? 'Edit template line' : 'Add template line'}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>
        {form.id ? `Editing: ${form.name || 'Template line'}` : 'Add template line'}
      </h3>
      <p className="admin-panel__lead">
        {form.id
          ? 'Company copy only. This does not change BuildLite Standard or the Cost Code Master hierarchy.'
          : 'The server assigns a company-owned key. Custom lines cannot use bl.prelims. keys.'}
      </p>
      <label>
        Name
        <input
          className="input"
          value={form.name}
          onChange={(event) => onUpdateForm('name', event.target.value)}
          aria-label="Template line name"
          required
        />
      </label>
      <label>
        Guidance
        <textarea
          className="input"
          rows={3}
          value={form.description}
          onChange={(event) => onUpdateForm('description', event.target.value)}
          aria-label="Template line guidance"
        />
      </label>
      <label>
        Forecast driver
        <select
          className="input"
          value={form.forecastDriver}
          onChange={(event) => onUpdateForm('forecastDriver', event.target.value)}
          aria-label="Template line driver"
        >
          <option value="TIME">TIME</option>
          <option value="LUMP_SUM">LUMP_SUM</option>
        </select>
      </label>
      {form.forecastDriver === 'TIME' ? (
        <>
          <label>
            TIME start
            <select
              className="input"
              value={form.startBasis}
              onChange={(event) => onUpdateForm('startBasis', event.target.value)}
              aria-label="TIME start basis"
            >
              {TIME_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {basis}
                </option>
              ))}
            </select>
          </label>
          <label>
            TIME end
            <select
              className="input"
              value={form.endBasis}
              onChange={(event) => onUpdateForm('endBasis', event.target.value)}
              aria-label="TIME end basis"
            >
              {TIME_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {basis}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <div><span>Mapped cost code</span><CommercialHeadCostCodePicker category="PRELIMINARIES" structure={commercialStructure} codes={costCodes} identity="code" valueCode={form.costCodeKey} name="Mapped cost code" contextKey={form.id || 'new-line'} onChange={(code) => onUpdateForm('costCodeKey', code || '')} onSetUpCommercialStructure={onSetUpCommercialStructure} /></div>
      {form.costCodeKey ? (
        <p className="admin-form__hint" role="status">
          {classificationFor(form.costCodeKey).message ||
            `Mapped code ${form.costCodeKey} is classified PRELIMS.`}
        </p>
      ) : (
        <p className="admin-form__hint">Leave unmapped until the customer cost code is known.</p>
      )}
      {!costCodes.length ? (
        <p className="admin-form__hint">
          Mapping uses the server Cost Code Master. Enable server authority and reload if the list
          is empty.
        </p>
      ) : null}
      <div className="dev-prelims__actions">
        <AdminButton type="submit" disabled={busy || !form.name.trim()}>
          {form.id ? 'Save line' : 'Add line'}
        </AdminButton>
        <AdminButton variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </AdminButton>
      </div>
    </form>
  );
}

export default function AdminPrelimsTemplatesPage({ onBack, onSetUpCommercialStructure = null }) {
  const [templates, setTemplates] = useState([]);
  const [templatesResolved, setTemplatesResolved] = useState(false);
  const [templatesLoadFailed, setTemplatesLoadFailed] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [createName, setCreateName] = useState('BuildLite Standard Prelims');
  const [headerName, setHeaderName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [costCodes, setCostCodes] = useState([]);
  const [commercialStructure, setCommercialStructure] = useState(null);
  const [classifications, setClassifications] = useState([]);
  const [mappingFilter, setMappingFilter] = useState('all');
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingSavingId, setMappingSavingId] = useState(null);
  const [mappingNotice, setMappingNotice] = useState('');
  const [mappingError, setMappingError] = useState('');
  const [proposalRows, setProposalRows] = useState(null);
  const [showProposedMappings, setShowProposedMappings] = useState(false);
  const [proposalsViewed, setProposalsViewed] = useState(false);
  const [showFullProposalReview, setShowFullProposalReview] = useState(false);
  const lineFormRef = useRef(null);
  const isAddForm = Boolean(form && !form.id);
  const editingLineId = form?.id || null;

  const classificationByKey = useMemo(() => {
    const map = {};
    for (const row of classifications) {
      if (row?.costCodeKey) map[String(row.costCodeKey).toLowerCase()] = row;
    }
    return map;
  }, [classifications]);

  const sharedCounts = useMemo(
    () => sharedCostCodeCounts(selected?.lines || []),
    [selected]
  );

  const mappingSummary = useMemo(
    () => templateMappingSummary(selected?.lines || []),
    [selected]
  );

  const mappingLines = useMemo(
    () =>
      filterTemplateLinesByMapping(
        (selected?.lines || []).filter((line) => line.enabled !== false),
        mappingFilter
      ),
    [selected, mappingFilter]
  );

  const proposalReview = useMemo(() => {
    const rows = proposalRows || [];
    const proposed = rows.filter((row) => row.proposalStatus.startsWith('proposed'));
    const exceptions = rows.filter((row) => row.proposalStatus === 'needs-review');
    const existing = rows.filter((row) => row.proposalStatus === 'existing');
    const applyBlockers = rows.filter((row) => row.proposedEnabled !== false && (
      !String(row.proposedCostCodeKey || '').trim()
      || (row.proposalStatus.startsWith('proposed') && !row.proposalAccepted)
    ));
    const suggested = proposed.filter((row) => row.proposedEnabled !== false && !row.proposalAccepted);
    const accepted = proposed.filter((row) => row.proposedEnabled !== false && row.proposalAccepted);
    const disabled = rows.filter((row) => row.proposedEnabled === false);
    const saved = rows.filter((row) => row.enabled !== false && String(row.costCodeKey || '').trim());
    const resolved = rows.filter((row) => row.proposedEnabled === false || (
      String(row.proposedCostCodeKey || '').trim()
      && (!row.proposalStatus.startsWith('proposed') || row.proposalAccepted)
    ));
    return { proposed, exceptions, existing, applyBlockers, suggested, accepted, disabled, saved, resolved };
  }, [proposalRows]);

  const proposalGroups = useMemo(() => {
    const groups = new Map();
    for (const row of proposalReview.proposed) {
      const key = String(row.proposedCostCodeKey || 'unmapped');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()]
      .map(([costCodeKey, rows]) => ({ costCodeKey, rows }))
      .sort((left, right) => left.costCodeKey.localeCompare(right.costCodeKey, undefined, { numeric: true }));
  }, [proposalReview.proposed]);

  async function refresh(preferredId = null) {
    const listed = await listPrelimsTemplates();
    const rows = listed.templates || [];
    setTemplates(rows);
    setTemplatesResolved(true);
    setTemplatesLoadFailed(false);
    const selectedStillExists = selected?.id && rows.some((row) => row.id === selected.id);
    const targetId = preferredId
      || (selectedStillExists ? selected.id : null)
      || rows.find((row) => row.isDefault)?.id
      || rows[0]?.id
      || null;
    if (!targetId) {
      setSelected(null);
      setHeaderName('');
      setForm(null);
      return;
    }
    const detail = await getPrelimsTemplate(targetId);
    setSelected(detail);
    setHeaderName(detail.name || '');
  }

  useEffect(() => {
    refresh(null).catch((err) => {
      setTemplatesResolved(true);
      setTemplatesLoadFailed(true);
      setError(err.message || 'Could not load Prelims templates.');
    });
    listCostCodesForTemplateMapping()
      .then(setCostCodes)
      .catch(() => setCostCodes([]));
    listCostCodeClassifications()
      .then((listed) => setClassifications(listed.classifications || []))
      .catch(() => setClassifications([]));
    loadCommercialStructure().then(setCommercialStructure).catch(() => setCommercialStructure(null));
    // Load list only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateForm(field, value) {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === 'forecastDriver' && value === 'LUMP_SUM') {
        next.startBasis = '';
        next.endBasis = '';
      }
      if (field === 'forecastDriver' && value === 'TIME') {
        next.startBasis = current.startBasis || 'SITE_START';
        next.endBasis = current.endBasis || 'FINAL_COMPLETION';
      }
      return next;
    });
  }

  async function handleCreate(origin) {
    setBusy(true);
    setError('');
    try {
      const created = await createPrelimsTemplate({
        origin,
        name:
          createName.trim() ||
          (origin === 'blank' ? 'Company Prelims' : 'BuildLite Standard Prelims'),
      });
      setCreateName(created.name);
      setForm(null);
      await refresh(created.id);
      setShowCreateTemplate(false);
      setShowTemplateEditor(true);
    } catch (err) {
      if (err instanceof PrelimsTemplateApiError && err.status === 409) {
        const existing = templates.find((row) => row.name.trim().toLowerCase() === createName.trim().toLowerCase());
        setError('No template was created. A company Prelims template with this name already exists. Manage the existing template instead.');
        if (existing) {
          await refresh(existing.id);
          setShowCreateTemplate(false);
          setShowTemplateEditor(true);
        }
      } else {
        setError(err.message || 'Could not create Prelims template.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveHeader({ isDefault } = {}) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const payload = { version: selected.version, name: headerName.trim() };
      if (isDefault !== undefined) payload.isDefault = isDefault;
      await updatePrelimsTemplate(selected.id, payload);
      await refresh(selected.id);
    } catch (err) {
      setError(err.message || 'Could not save template.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveLine() {
    if (!selected || !form) return;
    setBusy(true);
    setError('');
    try {
      if (form.id) {
        await updatePrelimsTemplateLine(selected.id, form.id, linePayload(form));
      } else {
        const nextOrder =
          Math.max(0, ...(selected.lines || []).map((line) => line.displayOrder || 0)) + 1;
        await createPrelimsTemplateLine(selected.id, {
          ...linePayload({ ...form, displayOrder: nextOrder }),
        });
      }
      setForm(null);
      await refresh(selected.id);
    } catch (err) {
      setError(err.message || 'Could not save template line.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(line) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await updatePrelimsTemplateLine(selected.id, line.id, {
        ...linePayload(lineToForm(line)),
        enabled: !line.enabled,
      });
      await refresh(selected.id);
    } catch (err) {
      setError(err.message || 'Could not update line status.');
    } finally {
      setBusy(false);
    }
  }

  function mappingContext(code) {
    const option = costCodes.find((row) => row.code === code);
    if (!option) return code;
    return mappingOptionLabel(option);
  }

  function classificationFor(code) {
    if (!code) return classifyTemplateMapping('', null);
    const row = classificationByKey[String(code).toLowerCase()];
    return classifyTemplateMapping(code, row?.semanticGroup || 'UNCLASSIFIED', { costCodes, structure: commercialStructure });
  }

  function scrollLineFormIntoView() {
    requestAnimationFrame(() => {
      lineFormRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function openEditForm(line) {
    setForm(lineToForm(line));
    scrollLineFormIntoView();
  }

  function startMapping() {
    setMappingFilter('unmapped');
    setForm(null);
    setMappingNotice('');
    setMappingError('');
    setMappingMode(true);
  }

  function startProposals() {
    const discovery = commercialHeadCostCodeDiscovery({
      structure: commercialStructure,
      costCodes,
      category: 'PRELIMINARIES',
    });
    setForm(null);
    setMappingMode(false);
    setMappingNotice('');
    setMappingError('');
    setShowProposedMappings(false);
    setProposalsViewed(false);
    setShowFullProposalReview(false);
    setProposalRows(proposePrelimsMappings(selected?.lines || [], discovery.suggested || []));
  }

  function continueTemplateSetup() {
    setShowTemplateEditor(true);
    if (selected?.origin === 'buildlite_standard') startProposals();
    else startMapping();
  }

  function updateProposal(lineId, patch) {
    setProposalRows((rows) => rows?.map((row) => row.id === lineId ? {
      ...row,
      ...patch,
      proposalStatus: 'owner-reviewed',
      proposalConfidence: 'owner-reviewed',
      proposalAccepted: true,
    } : row));
  }

  function acceptProposedMappings() {
    if (!proposalsViewed) return;
    setProposalRows((rows) => rows?.map((row) => row.proposalStatus.startsWith('proposed')
      ? { ...row, proposalAccepted: true }
      : row));
  }

  function reviewProposedMappings() {
    setProposalsViewed(true);
    setShowProposedMappings(true);
  }

  function openFullReviewFor(lineId) {
    setShowFullProposalReview(true);
    requestAnimationFrame(() => {
      document.getElementById(`prelims-full-review-${lineId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
  }

  function cancelProposalReview() {
    setProposalRows(null);
    setShowProposedMappings(false);
    setProposalsViewed(false);
    setShowFullProposalReview(false);
    setMappingError('');
  }

  async function applyProposals() {
    if (!selected || !proposalRows) return;
    const changes = proposalRows
      .filter((row) => String(row.proposedCostCodeKey || '') !== String(row.costCodeKey || '') || row.proposedEnabled !== (row.enabled !== false))
      .map((row) => ({
        lineId: row.id,
        version: row.version,
        costCodeKey: row.proposedCostCodeKey || null,
        enabled: row.proposedEnabled,
      }));
    setBusy(true);
    setMappingError('');
    try {
      await applyReviewedPrelimsMappings(selected.id, { version: selected.version, changes });
      setProposalRows(null);
      await refresh(selected.id);
      setMappingNotice(`${changes.length} reviewed mapping change${changes.length === 1 ? '' : 's'} applied.`);
    } catch (err) {
      setMappingError(err.message || 'Could not apply reviewed mappings.');
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping(line, costCodeKey) {
    const nextCode = String(costCodeKey || '').trim();
    if (nextCode === String(line.costCodeKey || '').trim()) return;
    setMappingSavingId(line.id);
    setMappingNotice('');
    setMappingError('');
    try {
      await updatePrelimsTemplateLine(selected.id, line.id, {
        ...linePayload(lineToForm(line)),
        costCodeKey: nextCode || null,
      });
      await refresh(selected.id);
      setMappingNotice(`${line.name} mapping saved.`);
    } catch (err) {
      setMappingError(err.message || `Could not save the mapping for ${line.name}.`);
    } finally {
      setMappingSavingId(null);
    }
  }

  function openAddForm() {
    const nextOrder =
      Math.max(0, ...(selected?.lines || []).map((line) => line.displayOrder || 0)) + 1;
    setForm(emptyLineForm(nextOrder));
    scrollLineFormIntoView();
  }

  function cancelLineForm() {
    setForm(null);
  }

  const lineFormProps = {
    form,
    busy,
    classificationFor,
    costCodes,
    commercialStructure,
    onSetUpCommercialStructure,
    onSubmit: handleSaveLine,
    onCancel: cancelLineForm,
    onUpdateForm: updateForm,
  };

  return (
    <AdminPageShell
      title="Prelims Templates"
      lead="Tailor company-owned Prelims structures and map lines to the Cost Code Master. Mapping does not write the CVR or change classifications."
      onBack={onBack}
    >
      {error ? (
        <p className="dev-workspace__section-lead" role="alert">
          {error}
        </p>
      ) : null}

      {!templatesResolved ? <section className="po-module-card admin-panel" aria-label="Loading company Prelims templates">
        <h2 className="admin-panel__title">Company Prelims Templates</h2>
        <p>Loading company template setup…</p>
      </section> : templatesLoadFailed ? <section className="po-module-card admin-panel" aria-label="Company Prelims templates unavailable">
        <h2 className="admin-panel__title">Company Prelims Templates</h2>
        <p>Company template setup could not be loaded. Refresh the page to try again.</p>
      </section> : !templates.length ? <section className="po-module-card admin-panel" aria-label="Set up company Prelims template">
        <h2 className="admin-panel__title">Set up your company Prelims template</h2>
        <p className="admin-panel__lead">Create the reusable company template that new developments will inherit. You can tailor mappings and assumptions later.</p>
        <div className="admin-form__grid">
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Template name</span>
            <input className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} aria-label="Prelims template name" />
          </label>
        </div>
        <div className="dev-prelims__actions">
          <AdminButton variant="primary" disabled={busy} onClick={() => handleCreate('buildlite_standard')}>Use BuildLite Standard</AdminButton>
          <AdminButton disabled={busy} variant="secondary" onClick={() => handleCreate('blank')}>Start Blank</AdminButton>
        </div>
      </section> : <>
        <section className="po-module-card admin-panel" aria-label="Company Prelims templates overview">
          <div className="admin-prelims-mapping-workspace__header">
            <div>
              <h2 className="admin-panel__title">Company Prelims Templates</h2>
              <p className="admin-panel__lead">Continue the default company setup or manage another existing template.</p>
            </div>
            <AdminButton variant="secondary" onClick={() => setShowCreateTemplate((value) => !value)}>{showCreateTemplate ? 'Cancel new template' : 'Create another template'}</AdminButton>
          </div>

          {selected ? <article className="admin-prelims-template-overview" aria-label="Current company Prelims template">
            <div>
              <h3>{selected.name}</h3>
              <p>{selected.isDefault ? 'Default' : 'Selected'} &middot; {originLabel(selected.origin)}{selected.sourceStandardVersion ? ` · Standard v${selected.sourceStandardVersion}` : ''}</p>
              <p className="admin-prelims-mapping-summary">
                {mappingSummary.total} lines &middot; {mappingSummary.enabled} enabled &middot; {mappingSummary.mapped} mapped &middot; {mappingSummary.unmapped} unmapped &middot; {mappingSummary.disabled} disabled
              </p>
            </div>
            <div className="dev-prelims__actions">
              <AdminStatusBadge tone={mappingSummary.unmapped === 0 ? 'success' : 'neutral'}>{mappingSummary.unmapped === 0 ? 'Ready' : 'Needs setup'}</AdminStatusBadge>
              <AdminStatusBadge tone="accent">Saved</AdminStatusBadge>
              {mappingSummary.unmapped > 0
                ? <AdminButton variant="primary" disabled={busy} onClick={continueTemplateSetup}>Continue setup</AdminButton>
                : <AdminButton variant="primary" disabled={busy} onClick={() => setShowTemplateEditor(true)}>Manage template</AdminButton>}
            </div>
          </article> : <p>Loading the default company template…</p>}

          <AdminDataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Default</th>
                <th>Origin</th>
                <th>Standard version</th>
                <th>Lines</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setError('');
                        setForm(null);
                        setMappingMode(false);
                        setMappingFilter('all');
                        setShowTemplateEditor(true);
                        refresh(row.id).catch((err) => setError(err.message));
                      }}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td>{row.isDefault ? 'Default' : '—'}</td>
                  <td>{originLabel(row.origin)}</td>
                  <td>{row.sourceStandardVersion ?? '—'}</td>
                  <td>{row.lineCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </AdminDataTable>
        </section>

        {showCreateTemplate ? <section className="po-module-card admin-panel" aria-label="Create another company Prelims template">
          <h2 className="admin-panel__title">Create another template</h2>
          <p className="admin-panel__lead">This creates a new company-owned template. It does not open or replace an existing template.</p>
          <div className="admin-form__grid">
            <label className="dev-form__field admin-form__field--wide">
              <span className="dev-form__label">New template name</span>
              <input className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} aria-label="Prelims template name" />
            </label>
          </div>
          <div className="dev-prelims__actions">
            <AdminButton variant="primary" disabled={busy} onClick={() => handleCreate('buildlite_standard')}>Create new template from BuildLite Standard</AdminButton>
            <AdminButton disabled={busy} variant="secondary" onClick={() => handleCreate('blank')}>Start new blank template</AdminButton>
          </div>
        </section> : null}
      </>}

      {selected && showTemplateEditor ? (
        <section className="po-module-card admin-panel" aria-label="Selected Prelims template">
          <h2 className="admin-panel__title">
            {selected.name}
            {selected.isDefault ? ' (default)' : ''}
          </h2>
          <p>
            Origin {originLabel(selected.origin)}
            {selected.sourceStandardVersion
              ? ` · copied from BuildLite Standard v${selected.sourceStandardVersion}`
              : ''}
            . {selected.lines?.length || 0} lines.
          </p>
          <p className="admin-panel__lead">
            Map each standard Prelim once to your company Cost Codes. New developments will use
            these mappings automatically. A development can override a mapping where a site
            genuinely needs a different Cost Code.
          </p>
          <p className="admin-prelims-mapping-summary" aria-label="Prelims mapping summary">
            {mappingSummary.total} lines &middot; {mappingSummary.enabled} enabled &middot;{' '}
            {mappingSummary.mapped} mapped &middot; {mappingSummary.unmapped} unmapped &middot;{' '}
            {mappingSummary.disabled} disabled
          </p>
          {!mappingMode && !proposalRows ? <div className="admin-form__grid">
            <label className="dev-form__field admin-form__field--wide">
              <span className="dev-form__label">Template name</span>
              <input
                className="input"
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
                aria-label="Rename Prelims template"
              />
            </label>
          </div> : null}
          {!mappingMode && !proposalRows ? <div className="dev-prelims__actions">
            <AdminButton disabled={busy} onClick={() => handleSaveHeader()}>
              Save name
            </AdminButton>
            {!selected.isDefault ? (
              <AdminButton disabled={busy} onClick={() => handleSaveHeader({ isDefault: true })}>
                Set as default
              </AdminButton>
            ) : (
              <AdminButton
                disabled={busy}
                variant="secondary"
                onClick={() => handleSaveHeader({ isDefault: false })}
              >
                Clear default
              </AdminButton>
            )}
            <AdminButton disabled={busy} variant="secondary" onClick={openAddForm}>
              Add template line
            </AdminButton>
            <AdminButton disabled={busy} variant="primary" onClick={startMapping}>
              Map Cost Codes
            </AdminButton>
            {selected.origin === 'buildlite_standard' ? (
              <AdminButton disabled={busy} variant="primary" onClick={startProposals}>
                Propose mappings
              </AdminButton>
            ) : null}
          </div> : null}

          {proposalRows ? (
            <section className="admin-prelims-mapping-workspace" aria-label="Review proposed Prelims mappings">
              <div className="admin-prelims-mapping-workspace__header">
                <div>
                  <h3>Review proposed mappings</h3>
                  <p>Nothing is saved until you apply the reviewed set. Existing mappings are retained unless you explicitly change them.</p>
                </div>
                <AdminButton variant="secondary" onClick={cancelProposalReview}>Cancel review</AdminButton>
              </div>
              {mappingError ? <p role="alert" className="admin-prelims-mapping-error">{mappingError}</p> : null}
              <p className="admin-prelims-mapping-summary" aria-label="Proposal review summary">
                {proposalReview.suggested.length} suggested &middot;{' '}
                {proposalReview.accepted.length} accepted &middot;{' '}
                {proposalReview.exceptions.length} need your review &middot;{' '}
                {proposalReview.saved.length} saved mapping{proposalReview.saved.length === 1 ? '' : 's'} &middot;{' '}
                {proposalReview.disabled.length} disabled
              </p>

              {proposalReview.proposed.length ? <section aria-label="Proposed Prelims mappings">
                <div className="admin-prelims-mapping-workspace__header">
                  <div><h4>Proposed mappings</h4><p>Review where BuildLite proposes sending these costs before accepting them into the pending reviewed set. Nothing is saved yet.</p></div>
                  <div className="dev-prelims__actions">
                    {!proposalsViewed ? <AdminButton variant="primary" disabled={busy} onClick={reviewProposedMappings}>Review {proposalReview.suggested.length} proposed mapping{proposalReview.suggested.length === 1 ? '' : 's'}</AdminButton> : null}
                    {proposalsViewed && proposalReview.suggested.length ? <AdminButton variant="primary" disabled={busy} onClick={acceptProposedMappings}>Accept {proposalReview.suggested.length} proposed mapping{proposalReview.suggested.length === 1 ? '' : 's'}</AdminButton> : null}
                    {proposalsViewed ? <AdminButton variant="secondary" onClick={() => setShowProposedMappings((value) => !value)}>{showProposedMappings ? 'Hide reviewed proposals' : 'Show reviewed proposals'}</AdminButton> : null}
                  </div>
                </div>
                {showProposedMappings ? <div className="admin-prelims-proposal-groups">
                  {proposalGroups.map((group) => <section className="admin-prelims-proposal-group" key={group.costCodeKey} aria-label={`${mappingContext(group.costCodeKey)} proposed mappings`}>
                    <header><strong>{mappingContext(group.costCodeKey)}</strong><AdminStatusBadge tone="neutral">{group.rows.length} line{group.rows.length === 1 ? '' : 's'}</AdminStatusBadge></header>
                    <ul>{group.rows.map((line) => <li key={line.id} data-proposal-line={line.id}>
                      <div><strong>{line.name}</strong><small>{line.proposalBasis}</small></div>
                      <AdminStatusBadge tone={line.proposalAccepted ? 'success' : 'accent'}>{line.proposalAccepted ? 'Accepted' : `${line.proposalConfidence === 'high' ? 'High' : 'Medium'} confidence`}</AdminStatusBadge>
                      <AdminButton variant="secondary" onClick={() => openFullReviewFor(line.id)}>Change</AdminButton>
                    </li>)}</ul>
                  </section>)}
                </div> : null}
              </section> : null}

              {proposalReview.exceptions.length ? <section aria-label="Prelims mappings needing owner review">
                <h4>Needs owner review</h4>
                <p>Resolve or deliberately disable these exceptions before applying the reviewed set.</p>
                <AdminDataTable className="admin-prelims-mapping-table">
                  <thead><tr><th>Prelim</th><th>Reviewed treatment</th><th>Basis / guidance</th><th>Status</th></tr></thead>
                  <tbody>{proposalReview.exceptions.map((line) => <tr key={line.id}>
                    <td><strong>{line.name}</strong><span className="admin-prelims-mapping-guidance">{driverLabel(line.forecastDriver)}</span></td>
                    <td>
                      {line.suggestedCostCodeKey && !line.proposedCostCodeKey ? <p className="admin-form__hint">Possible match: {mappingContext(line.suggestedCostCodeKey)}</p> : null}
                      <CommercialHeadCostCodePicker category="PRELIMINARIES" structure={commercialStructure} codes={costCodes} identity="code" name={`${line.name} reviewed mapping`} contextKey={`exception-${line.id}`} valueCode={line.proposedCostCodeKey || ''} disabled={busy || line.proposedEnabled === false} onSetUpCommercialStructure={onSetUpCommercialStructure} onChange={(code) => updateProposal(line.id, { proposedCostCodeKey: code || '' })} />
                      <label className="admin-form__hint"><input type="checkbox" checked={line.proposedEnabled === false} onChange={(event) => updateProposal(line.id, { proposedEnabled: !event.target.checked })} /> Disable line</label>
                    </td>
                    <td className="admin-table__guidance">{line.proposalBasis}</td>
                    <td><AdminStatusBadge tone="neutral">Needs owner review</AdminStatusBadge></td>
                  </tr>)}</tbody>
                </AdminDataTable>
              </section> : null}

              <div className="dev-prelims__actions">
                <AdminButton variant="secondary" onClick={() => setShowFullProposalReview((value) => !value)}>{showFullProposalReview ? 'Hide full review' : 'Full review'}</AdminButton>
              </div>
              {showFullProposalReview ? <AdminDataTable className="admin-prelims-mapping-table">
                <thead><tr><th>Prelim</th><th>Driver</th><th>Pending destination</th><th>Basis</th><th>Status</th></tr></thead>
                <tbody>{proposalRows.map((line) => <tr key={line.id} id={`prelims-full-review-${line.id}`}>
                  <td><strong>{line.name}</strong></td><td>{driverLabel(line.forecastDriver)}</td>
                  <td>
                    <CommercialHeadCostCodePicker category="PRELIMINARIES" structure={commercialStructure} codes={costCodes} identity="code" name={`${line.name} full-review mapping`} contextKey={`full-review-${line.id}`} valueCode={line.proposedCostCodeKey || ''} disabled={busy || line.proposedEnabled === false} onSetUpCommercialStructure={onSetUpCommercialStructure} onChange={(code) => updateProposal(line.id, { proposedCostCodeKey: code || '' })} />
                    <label className="admin-form__hint"><input type="checkbox" checked={line.proposedEnabled === false} onChange={(event) => updateProposal(line.id, { proposedEnabled: !event.target.checked })} /> Disable line</label>
                  </td>
                  <td className="admin-table__guidance">{line.proposalBasis}</td>
                  <td><AdminStatusBadge tone={line.proposalStatus === 'needs-review' ? 'neutral' : line.proposalAccepted ? 'success' : 'accent'}>{line.proposalStatus === 'existing' ? 'Existing mapping' : line.proposalStatus === 'needs-review' ? 'Needs owner review' : line.proposalAccepted ? 'Reviewed' : 'Pending acceptance'}</AdminStatusBadge></td>
                </tr>)}</tbody>
              </AdminDataTable> : null}

              <p className="admin-prelims-mapping-summary" role="status">
                {proposalReview.resolved.length} resolved &middot;{' '}
                {proposalReview.exceptions.length} need your review &middot;{' '}
                {proposalReview.disabled.length} disabled
                {proposalReview.suggested.length ? <> &middot; {proposalReview.suggested.length} suggestion{proposalReview.suggested.length === 1 ? '' : 's'} awaiting acceptance</> : null}
                {!proposalReview.applyBlockers.length ? ' · Ready to apply' : null}
              </p>
              <div className="dev-prelims__actions">
                <AdminButton variant="primary" disabled={busy || proposalReview.applyBlockers.length > 0} onClick={applyProposals}>Apply reviewed mappings</AdminButton>
                <AdminButton variant="secondary" disabled={busy} onClick={cancelProposalReview}>Cancel</AdminButton>
              </div>
            </section>
          ) : null}

          {mappingMode && !proposalRows ? (
            <section className="admin-prelims-mapping-workspace" aria-label="Map Prelims Cost Codes">
              <div className="admin-prelims-mapping-workspace__header">
                <div>
                  <h3>Map Cost Codes</h3>
                  <p>
                    Choose the company Cost Code for each active Prelim. Each selection saves
                    immediately.
                  </p>
                </div>
                <AdminButton
                  variant="secondary"
                  onClick={() => {
                    setMappingMode(false);
                    setMappingFilter('all');
                  }}
                >
                  Back to template
                </AdminButton>
              </div>
              {mappingNotice ? (
                <p role="status" className="admin-prelims-mapping-notice">
                  {mappingNotice}
                </p>
              ) : null}
              {mappingError ? (
                <p role="alert" className="admin-prelims-mapping-error">
                  {mappingError}
                </p>
              ) : null}
              <div className="admin-prelims-mapping-filter" aria-label="Cost Code mapping filter">
            <span>Show</span>
            {[
              ['all', 'All lines'],
              ['unmapped', `Unmapped (${mappingSummary.unmapped})`],
              ['mapped', `Mapped (${mappingSummary.mapped})`],
            ].map(([value, label]) => (
              <AdminButton
                key={value}
                variant={mappingFilter === value ? 'primary' : 'secondary'}
                onClick={() => setMappingFilter(value)}
              >
                {label}
              </AdminButton>
            ))}
              </div>
              <AdminDataTable className="admin-prelims-mapping-table">
                <thead>
                  <tr>
                    <th>Prelim</th>
                    <th>Company Cost Code</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.name}</strong>
                        {line.description ? (
                          <span className="admin-prelims-mapping-guidance">{line.description}</span>
                        ) : null}
                      </td>
                      <td>
                        <CommercialHeadCostCodePicker
                          category="PRELIMINARIES"
                          structure={commercialStructure}
                          codes={costCodes}
                          identity="code"
                          onSetUpCommercialStructure={onSetUpCommercialStructure}
                          name={line.name}
                          valueCode={line.costCodeKey || ''}
                          disabled={Boolean(mappingSavingId)}
                          onChange={(code) => saveMapping(line, code)}
                        />
                      </td>
                      <td>
                        {mappingSavingId === line.id ? (
                          <AdminStatusBadge tone="accent">Saving…</AdminStatusBadge>
                        ) : line.costCodeKey ? (
                          <AdminStatusBadge tone="success">Mapped</AdminStatusBadge>
                        ) : (
                          <AdminStatusBadge tone="neutral">Unmapped</AdminStatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminDataTable>
            </section>
          ) : null}

          {!mappingMode && !proposalRows && isAddForm ? (
            <div ref={lineFormRef} className="admin-prelims-line-form--add">
              <TemplateLineForm {...lineFormProps} />
            </div>
          ) : null}

          {!mappingMode && !proposalRows && !selected.lines?.length && !form ? (
            <p>This blank template has no lines yet.</p>
          ) : !mappingMode && !proposalRows && selected.lines?.length ? (
            <AdminDataTable>
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Line</th>
                  <th>Guidance</th>
                  <th>Driver</th>
                  <th>TIME bases</th>
                  <th>Mapped cost code</th>
                  <th>Classification</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(selected.lines || []).map((line) => {
                  const mapping = classificationFor(line.costCodeKey);
                  const shared = line.costCodeKey ? sharedCounts[line.costCodeKey] || 0 : 0;
                  const isEditing = editingLineId === line.id;
                  const rowClass = [
                    line.enabled ? '' : 'admin-table__row--muted',
                    isEditing ? 'admin-table__row--editing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <Fragment key={line.id}>
                      <tr className={rowClass || undefined}>
                        <td>{line.enabled ? 'Yes' : 'Disabled'}</td>
                        <td>{line.name}</td>
                        <td className="admin-table__guidance">{line.description || '—'}</td>
                        <td>{driverLabel(line.forecastDriver)}</td>
                        <td>
                          {line.forecastDriver === 'TIME'
                            ? `${timeBasisLabel(line.startBasis)} → ${timeBasisLabel(line.endBasis)}`
                            : '—'}
                        </td>
                        <td>
                          {line.costCodeKey ? mappingContext(line.costCodeKey) : 'Unmapped'}
                          {shared > 1 ? (
                            <div>
                              <AdminStatusBadge tone="accent">
                                Also used on {shared - 1} other line{shared - 1 === 1 ? '' : 's'}
                              </AdminStatusBadge>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {!line.costCodeKey ? (
                            '—'
                          ) : mapping.tone === 'normal' ? (
                            <AdminStatusBadge tone="success">PRELIMS</AdminStatusBadge>
                          ) : (
                            <span className="admin-form__hint" role="status">
                              {mapping.message}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="dev-prelims__actions">
                            <AdminButton
                              variant="secondary"
                              disabled={busy}
                              onClick={() => openEditForm(line)}
                            >
                              Edit line
                            </AdminButton>
                            <AdminButton
                              variant="secondary"
                              disabled={busy}
                              onClick={() => handleToggleEnabled(line)}
                            >
                              {line.enabled ? 'Disable' : 'Enable'}
                            </AdminButton>
                          </div>
                        </td>
                      </tr>
                      {isEditing ? (
                        <tr className="admin-prelims-line-form-row">
                          <td colSpan={8} ref={lineFormRef}>
                            <TemplateLineForm {...lineFormProps} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </AdminDataTable>
          ) : null}
        </section>
      ) : null}
    </AdminPageShell>
  );
}
