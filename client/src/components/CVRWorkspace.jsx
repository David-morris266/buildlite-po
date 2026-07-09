import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import CVRTable from './CVRTable';
import CostCentreDrawer from './CostCentreDrawer';
import BudgetEditor from './BudgetEditor';
import CVRBudgetImportWizard from './CVRBudgetImportWizard';
import { listPOs } from '../api';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildCvrWorkspaceModel } from '../cvr/cvrHelpers';
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
    <section className="dev-cvr__cards" aria-label="CVR commercial summary">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`dev-cvr__card dev-cvr__card--${card.modifier}`}
        >
          <span className="dev-cvr__card-label">{card.label}</span>
          <strong
            className={`dev-cvr__card-value${
              card.modifier === 'saving' || card.modifier === 'overspend'
                ? ` dev-cvr__variance dev-cvr__variance--${card.modifier}`
                : ''
            }`}
          >
            {card.value}
          </strong>
        </div>
      ))}
    </section>
  );
}

function CvrAuditHistory({ items }) {
  if (!items.length) return null;

  return (
    <details className="po-cert-detail__audit dev-cvr-period__audit" open>
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
  onCvrChanged,
  onBackToRegister,
  onPeriodChanged,
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
  const headerMeta = buildCvrPeriodHeaderMeta(period);

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
    if (!readOnly) {
      ensureDiscoveredCostCentres(development.id, pos, periodKey);
    }
    return buildCvrWorkspaceModel(development, {
      pos,
      periodKey,
      period,
      readOnly,
    });
  }, [development, pos, periodKey, period, readOnly, refreshToken, localRefresh]);

  useEffect(() => {
    setNotes(workspace?.developmentNotes || '');
  }, [workspace?.developmentNotes]);

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
    onBackToRegister?.();
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
    <div className="dev-cvr">
      <button type="button" className="dev-cvr-period__back" onClick={onBackToRegister}>
        Back to CVR Register
      </button>

      <POPageHeader
        eyebrow="Cost Value Reconciliation"
        title={`${workspace.developmentName} · ${periodKey}`}
        lead={`Development ${workspace.developmentNumber || '—'} · ${readOnly ? 'Read-only period' : 'Editable draft period'}`}
      />

      <header className="po-module-card dev-cvr-period__meta">
        <div className="dev-cvr-period__meta-row">
          <div>
            <p className="dev-cvr-period__eyebrow">Period Status</p>
            <StatusBadge status={status} />
          </div>
          <dl className="dev-cvr-period__meta-grid">
            {headerMeta.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="dev-cvr-period__actions">
          {!readOnly ? (
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => setDialog('submit')}
            >
              Submit for Approval
            </button>
          ) : null}
          {submitted ? (
            <>
              <button
                type="button"
                className="po-btn-primary"
                onClick={() => setDialog('approve')}
              >
                Approve &amp; Lock
              </button>
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={() => setDialog('reject')}
              >
                Reject
              </button>
            </>
          ) : null}
          {locked ? (
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={handleCreateNextPeriod}
            >
              Create Next Period
            </button>
          ) : null}
        </div>
      </header>

      <CvrAuditHistory items={auditItems} />

      <CvrSummaryDashboard cards={workspace.summaryCards} />

      <header className="dev-cvr__header">
        <div>
          <h2 className="po-matrix-section__title">CVR by Cost Code</h2>
          <p className="dev-cvr__lead">
            {readOnly
              ? 'Historical commercial position for this locked period. Live PO, certificate and ledger values are shown as at today.'
              : 'Headline commercial position by cost code. Open a cost code to enter Commercial Adjustments and review system forecast detail.'}
          </p>
        </div>
        {!readOnly ? (
          <div className="dev-cvr__header-actions">
            <button
              type="button"
              className="po-list-btn-secondary dev-cvr__import-btn"
              onClick={() => setBudgetImportOpen(true)}
            >
              Import Budget
            </button>
            <button type="button" className="po-btn-primary" onClick={() => setAddOpen(true)}>
              Add Cost Code
            </button>
          </div>
        ) : null}
      </header>

      <CVRTable
        rows={workspace.rows}
        totals={workspace.totals}
        onRowSelect={setSelectedRow}
        onBudgetChange={readOnly ? undefined : handleBudgetChange}
        readOnly={readOnly}
      />

      <section className="po-module-card dev-cvr__notes">
        <h2 className="po-matrix-section__title">Notes</h2>
        <p className="dev-cvr__notes-lead">
          Development-level commentary for month-end commercial review.
        </p>
        <textarea
          className="input dev-cvr__notes-input"
          rows={4}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={handleNotesBlur}
          readOnly={readOnly}
          placeholder="Summarise commercial position, risks and actions for this development."
        />
      </section>

      <CostCentreDrawer
        open={Boolean(selectedRow)}
        row={selectedRow}
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
