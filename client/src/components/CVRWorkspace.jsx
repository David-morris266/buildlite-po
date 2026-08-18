import { useEffect, useMemo, useState, memo } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import CVRTable from './CVRTable';
import CostCentreDrawer from './CostCentreDrawer';
import BudgetEditor from './BudgetEditor';
import CVRBudgetImportWizard from './CVRBudgetImportWizard';
import { listPOs } from '../api';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildCvrWorkspaceModel, formatCvrTotals } from '../cvr/cvrHelpers';
import { buildCvrTotals } from '../cvr/cvrCalculations';
import {
  buildHierarchyKeyMap,
  resolveRowCommercialHead,
} from '../cvr/commercialReportingHierarchy';
import {
  buildCvrPeriodAuditItems,
  buildCvrPeriodHeaderMeta,
  createNextCvrPeriod,
} from '../cvr/cvrPeriodHelpers';
import {
  approveCvrPeriod,
  getCvrPeriod,
  getCvrPeriodStatusMeta,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  isCvrPeriodSubmitted,
  rejectCvrPeriod,
  submitCvrPeriod,
} from '../cvr/cvrPeriodStore';
import {
  addCostCentre,
  buildCertificatesForCostCentre,
  buildLedgerRowsForCostCentre,
  buildPackagesForCostCentre,
  ensureDiscoveredCostCentres,
  updateCostCentre,
  updateDevelopmentNotes,
  upsertAutoCostCentre,
} from '../cvr/cvrStore';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function CvrSummaryDashboard({ cards }) {
  return (
    <section
      className="dev-cvr__cards dev-cvr__cards--summary dev-cvr__cards--ribbon"
      aria-label="CVR commercial summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className={`dev-cvr__card dev-cvr__card--ribbon dev-cvr__card--${card.modifier}`}
        >
          <span className="dev-cvr__card-label">{card.label}</span>
          <strong className={getSummaryCardValueClass(card)}>{card.value}</strong>
        </div>
      ))}
    </section>
  );
}

function getSummaryCardValueClass(card) {
  const classes = ['dev-cvr__card-value'];

  if (card.modifier === 'saving' || card.modifier === 'overspend') {
    classes.push('dev-cvr__variance', `dev-cvr__variance--${card.modifier}`);
  }
  if (card.modifier === 'outstanding') {
    classes.push('dev-cvr__card-value--outstanding');
  }
  if (card.modifier === 'ctc') {
    classes.push('dev-cvr__card-value--ctc');
  }
  if (card.modifier === 'accent') {
    classes.push('dev-cvr__card-value--accent');
  }

  return classes.join(' ');
}

const MemoCvrSummaryDashboard = memo(CvrSummaryDashboard);

function CvrAuditHistory({ items }) {
  if (!items.length) return null;

  return (
    <details className="po-cert-detail__audit dev-cvr-period__audit">
      <summary>CVR History</summary>
      <ul className="po-cert-detail__audit-list">
        {items.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.label}</strong>
            <span>{entry.actor}</span>
            <span>
              {entry.dateLabel}
              {entry.timeLabel ? ` · ${entry.timeLabel}` : ''}
            </span>
            {entry.comment ? <p>{entry.comment}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function WorkflowDialog({ title, children, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {children}
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="po-btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddCostCentreDialog({ open, onCancel, onSave }) {
  const [values, setValues] = useState({
    costCodeLabel: '',
    originalBudget: '',
    currentBudget: '',
  });
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (!open) return;
    setValues({
      costCodeLabel: '',
      originalBudget: '',
      currentBudget: '',
    });
    setErrors([]);
  }, [open]);

  if (!open) return null;

  function handleChange(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors([]);
  }

  function handleSave() {
    const result = onSave?.(values);
    if (result?.ok === false) {
      setErrors(result.errors || ['Could not add cost code.']);
    }
  }

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>Add Cost Code</h3>
        <p className="dev-cvr-add__lead">
          Enter manual budgets for a company cost code. System Forecast will calculate
          automatically once commercial data exists.
        </p>
        <BudgetEditor
          showName
          values={values}
          errors={errors}
          onChange={handleChange}
        />
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="po-btn-primary" onClick={handleSave}>
            Add Cost Code
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CVRWorkspace({
  development,
  periodKey,
  refreshToken = 0,
  pageNavigation = null,
  onCvrChanged,
  onBackToSummary,
  onPeriodChanged,
  initialCostCodeKey = null,
  familyFilter = null,
  headFilter = null,
  onClearFamilyFilter,
  onClearHeadFilter,
  certificatesLoading = false,
  certificatesReady = true,
  certificatesError = '',
}) {
  const [pos, setPos] = useState([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [budgetImportOpen, setBudgetImportOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [dialog, setDialog] = useState(null);
  const [rejectComment, setRejectComment] = useState('');

  const period = useMemo(() => {
    void refreshToken;
    void localRefresh;
    return getCvrPeriod(development.id, periodKey);
  }, [development.id, periodKey, refreshToken, localRefresh]);

  const readOnly = !isCvrPeriodEditable(period);
  const submitted = isCvrPeriodSubmitted(period);
  const locked = isCvrPeriodLocked(period);
  const status = getCvrPeriodStatusMeta(period?.status);
  const auditItems = buildCvrPeriodAuditItems(period);
  const headerMeta = buildCvrPeriodHeaderMeta(period).filter(
    (item) => item.label !== 'Period'
  );

  useEffect(() => {
    let cancelled = false;
    listPOs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setPos(items);
      })
      .catch(() => {
        if (!cancelled) setPos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, localRefresh]);

  useEffect(() => {
    const unsubscribe = subscribeCommercialChanged(() => {
      setLocalRefresh((value) => value + 1);
    });
    return unsubscribe;
  }, []);

  const workspace = useMemo(() => {
    void refreshToken;
    void localRefresh;
    void certificatesReady;
    if (!readOnly) {
      ensureDiscoveredCostCentres(development.id, pos, periodKey);
    }
    return buildCvrWorkspaceModel(development, {
      pos,
      periodKey,
      period,
      readOnly,
    });
  }, [development, pos, periodKey, period, readOnly, refreshToken, localRefresh, certificatesReady]);

  const activeHeadFilter = headFilter || familyFilter;

  const hierarchyMap = useMemo(
    () => buildHierarchyKeyMap(period?.costCentres || []),
    [period?.costCentres]
  );

  const displayedRows = useMemo(() => {
    if (!workspace?.rows) return [];
    if (!activeHeadFilter) return workspace.rows;
    return workspace.rows.filter(
      (row) => resolveRowCommercialHead(row.costCodeKey, hierarchyMap) === activeHeadFilter
    );
  }, [workspace?.rows, activeHeadFilter, hierarchyMap]);

  const displayedTotals = useMemo(() => {
    const rows = activeHeadFilter ? displayedRows : workspace?.rows || [];
    return formatCvrTotals(buildCvrTotals(rows));
  }, [workspace?.rows, displayedRows, activeHeadFilter]);

  useEffect(() => {
    setNotes(workspace?.developmentNotes || '');
  }, [workspace?.developmentNotes]);

  useEffect(() => {
    if (!initialCostCodeKey || !workspace?.rows?.length) return;
    const row = workspace.rows.find((item) => item.costCodeKey === initialCostCodeKey);
    if (row) setSelectedRow(row);
  }, [initialCostCodeKey, workspace?.rows]);

  useEffect(() => {
    if (!selectedRow || !workspace?.rows?.length) return;
    const latest = workspace.rows.find(
      (row) =>
        row.id === selectedRow.id ||
        (row.costCodeKey &&
          selectedRow.costCodeKey &&
          row.costCodeKey === selectedRow.costCodeKey)
    );
    if (latest) {
      setSelectedRow(latest);
    }
  }, [workspace?.rows]);

  const drawerPackages = useMemo(() => {
    if (!selectedRow) return [];
    return buildPackagesForCostCentre(development.id, selectedRow.costCodeKey, pos);
  }, [selectedRow, development.id, pos]);

  const drawerLedgerRows = useMemo(() => {
    if (!selectedRow) return [];
    return buildLedgerRowsForCostCentre(development.id, selectedRow.costCodeKey);
  }, [selectedRow, development.id]);

  const drawerCertificates = useMemo(() => {
    if (!selectedRow) return [];
    return buildCertificatesForCostCentre(development.id, selectedRow.costCodeKey, pos);
  }, [selectedRow, development.id, pos]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
    onCvrChanged?.();
    onPeriodChanged?.();
  }

  function handleSaveCommercialAdjustment(values) {
    if (readOnly) return { ok: false, errors: ['This CVR period is read-only.'] };
    if (!selectedRow) return { ok: false, errors: ['No cost code selected.'] };

    const centreId = resolveCentreId(selectedRow);
    if (!centreId) return { ok: false, errors: ['Could not resolve cost code.'] };

    const result = updateCostCentre(development.id, centreId, values, periodKey);
    if (!result.ok) return result;

    setSelectedRow((prev) =>
      prev
        ? {
            ...prev,
            commercialAdjustment: result.costCentre.commercialAdjustment,
            commercialReason: result.costCentre.commercialReason,
            adjustmentHistory: result.costCentre.adjustmentHistory,
          }
        : prev
    );
    refresh();
    return result;
  }

  function resolveCentreId(row) {
    let targetId = row.id.startsWith('auto-') ? null : row.id;
    if (!targetId) {
      const created = upsertAutoCostCentre(
        development.id,
        {
          costCodeKey: row.costCodeKey,
          costCodeLabel: row.costCodeLabel,
        },
        periodKey
      );
      targetId = created?.id;
    }
    return targetId;
  }

  function handleBudgetChange(row, field, rawValue) {
    if (readOnly) return;
    const targetId = resolveCentreId(row);
    if (!targetId) return;

    updateCostCentre(development.id, targetId, { [field]: rawValue }, periodKey);
    refresh();
  }

  function handleSaveNotes(patch) {
    if (readOnly) return;
    if (!selectedRow) return;

    let targetId = selectedRow.id.startsWith('auto-') ? null : selectedRow.id;
    if (!targetId) {
      const created = upsertAutoCostCentre(
        development.id,
        {
          costCodeKey: selectedRow.costCodeKey,
          costCodeLabel: selectedRow.costCodeLabel,
        },
        periodKey
      );
      targetId = created?.id;
    }
    if (!targetId) return;

    updateCostCentre(development.id, targetId, patch, periodKey);
    setSelectedRow((prev) => (prev ? { ...prev, ...patch } : prev));
    refresh();
  }

  function handleAddCostCentre(values) {
    const result = addCostCentre(development.id, values, periodKey);
    if (!result.ok) return result;
    setAddOpen(false);
    refresh();
    return result;
  }

  function handleNotesBlur() {
    if (readOnly) return;
    updateDevelopmentNotes(development.id, notes, periodKey);
    refresh();
  }

  function handleSubmit() {
    const result = submitCvrPeriod(development.id, periodKey);
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not submit CVR.');
      return;
    }
    setDialog(null);
    refresh();
  }

  function handleApprove() {
    const result = approveCvrPeriod(development.id, periodKey);
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not approve CVR.');
      return;
    }
    setDialog(null);
    refresh();
  }

  function handleReject() {
    const result = rejectCvrPeriod(development.id, periodKey, rejectComment);
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not reject CVR.');
      return;
    }
    setRejectComment('');
    setDialog(null);
    refresh();
  }

  function handleCreateNextPeriod() {
    const result = createNextCvrPeriod(development.id);
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not create next CVR period.');
      return;
    }
    onBackToSummary?.();
  }

  if (!workspace) return null;

  if (budgetImportOpen) {
    return (
      <CVRBudgetImportWizard
        development={development}
        periodKey={periodKey}
        onCancel={() => {
          setBudgetImportOpen(false);
          refresh();
        }}
        onImportComplete={() => {
          refresh();
        }}
      />
    );
  }

  return (
    <div className="dev-cvr dev-cvr-workspace dev-cvr-workspace--focused">
      <ApplicationPageHeader
        breadcrumbs={pageNavigation?.breadcrumbs || []}
        title={workspace.developmentName}
        lead={`Development ${workspace.developmentNumber || '—'}${readOnly ? ' · Read-only period' : ''}`}
        onBack={onBackToSummary}
        actions={(
          <div className="dev-cvr-period__actions dev-cvr-period__actions--inline">
            {!readOnly ? (
              <>
                <button
                  type="button"
                  className="po-list-btn-secondary dev-cvr__shell-btn"
                  onClick={() => setBudgetImportOpen(true)}
                >
                  Import Budget
                </button>
                <button
                  type="button"
                  className="po-list-btn-secondary dev-cvr__shell-btn"
                  onClick={() => setAddOpen(true)}
                >
                  Add Cost Code
                </button>
                <button
                  type="button"
                  className="po-btn-primary dev-cvr__shell-btn"
                  onClick={() => setDialog('submit')}
                >
                  Submit
                </button>
              </>
            ) : null}
            {submitted ? (
              <>
                <button
                  type="button"
                  className="po-btn-primary dev-cvr__shell-btn"
                  onClick={() => setDialog('approve')}
                >
                  Approve &amp; Lock
                </button>
                <button
                  type="button"
                  className="po-list-btn-secondary dev-cvr__shell-btn"
                  onClick={() => setDialog('reject')}
                >
                  Reject
                </button>
              </>
            ) : null}
            {locked ? (
              <button
                type="button"
                className="po-list-btn-secondary dev-cvr__shell-btn"
                onClick={handleCreateNextPeriod}
              >
                Next Period
              </button>
            ) : null}
          </div>
        )}
      >
        <div className="dev-cvr__shell-status">
          <StatusBadge status={status} />
        </div>
        <dl className="dev-cvr-period__meta-inline">
          {headerMeta.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </ApplicationPageHeader>

      {certificatesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load certificate data. {certificatesError}
        </div>
      ) : certificatesLoading ? (
        <p role="status">Loading certificate data…</p>
      ) : null}

      <CvrAuditHistory items={auditItems} />

      {activeHeadFilter ? (
        <div className="cvr-workspace__family-filter" role="status">
          <span>
            Showing commercial head: <strong>{activeHeadFilter}</strong>
          </span>
          <button
            type="button"
            className="cvr-summary__link-btn"
            onClick={() => {
              onClearHeadFilter?.();
              onClearFamilyFilter?.();
            }}
          >
            Clear filter
          </button>
        </div>
      ) : null}

      <MemoCvrSummaryDashboard cards={workspace.summaryCards} />

      <CVRTable
        rows={displayedRows}
        totals={activeHeadFilter ? displayedTotals : workspace.totals}
        onRowSelect={setSelectedRow}
        onBudgetChange={readOnly ? undefined : handleBudgetChange}
        readOnly={readOnly}
      />

      <details className="dev-cvr__notes-panel">
        <summary>Development Notes</summary>
        <textarea
          className="input dev-cvr__notes-input"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={handleNotesBlur}
          readOnly={readOnly}
          placeholder="Summarise commercial position, risks and actions for this development."
        />
      </details>

      <CostCentreDrawer
        open={Boolean(selectedRow)}
        row={selectedRow}
        drawerBreadcrumbs={[
          ...(pageNavigation?.breadcrumbs || []),
          ...(selectedRow?.costCodeLabel ? [{ label: selectedRow.costCodeLabel }] : []),
        ]}
        packages={drawerPackages}
        ledgerRows={drawerLedgerRows}
        certificates={drawerCertificates}
        readOnly={readOnly}
        onClose={() => setSelectedRow(null)}
        onSaveNotes={handleSaveNotes}
        onSaveCommercialAdjustment={handleSaveCommercialAdjustment}
      />

      <AddCostCentreDialog
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onSave={handleAddCostCentre}
      />

      {dialog === 'submit' ? (
        <WorkflowDialog
          title="Submit CVR for Approval"
          confirmLabel="Submit for Approval"
          onCancel={() => setDialog(null)}
          onConfirm={handleSubmit}
        >
          <p className="dev-cvr-add__lead">
            This period will become read-only while awaiting approval.
          </p>
        </WorkflowDialog>
      ) : null}

      {dialog === 'approve' ? (
        <WorkflowDialog
          title="Approve & Lock CVR"
          confirmLabel="Approve & Lock"
          onCancel={() => setDialog(null)}
          onConfirm={handleApprove}
        >
          <p className="dev-cvr-add__lead">
            Locked periods become permanent historical records.
          </p>
        </WorkflowDialog>
      ) : null}

      {dialog === 'reject' ? (
        <WorkflowDialog
          title="Reject CVR"
          confirmLabel="Reject to Draft"
          onCancel={() => {
            setRejectComment('');
            setDialog(null);
          }}
          onConfirm={handleReject}
        >
          <label className="dev-form__field">
            <span className="dev-form__label">Rejection Comment</span>
            <textarea
              className="input"
              rows={4}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Required — explain what must be revised."
            />
          </label>
        </WorkflowDialog>
      ) : null}
    </div>
  );
}
