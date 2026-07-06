import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import CVRTable from './CVRTable';
import CostCentreDrawer from './CostCentreDrawer';
import BudgetEditor from './BudgetEditor';
import { listPOs } from '../api';
import { buildCvrWorkspaceModel } from '../cvr/cvrHelpers';
import {
  addCostCentre,
  buildLedgerRowsForCostCentre,
  buildPackagesForCostCentre,
  ensureDiscoveredCostCentres,
  updateCostCentre,
  updateDevelopmentNotes,
  upsertAutoCostCentre,
} from '../cvr/cvrStore';

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

function AddCostCentreDialog({ open, onCancel, onSave }) {
  const [values, setValues] = useState({
    costCodeLabel: '',
    originalBudget: '',
    currentBudget: '',
    forecastFinalCost: '',
  });
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (!open) return;
    setValues({
      costCodeLabel: '',
      originalBudget: '',
      currentBudget: '',
      forecastFinalCost: '',
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
      setErrors(result.errors || ['Could not add cost centre.']);
    }
  }

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>Add Cost Centre</h3>
        <p className="dev-cvr-add__lead">
          Enter manual budgets and forecast for a commercial cost centre.
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
            Add Cost Centre
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CVRWorkspace({
  development,
  refreshToken = 0,
  onCvrChanged,
}) {
  const [pos, setPos] = useState([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [notes, setNotes] = useState('');

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

  const workspace = useMemo(() => {
    void refreshToken;
    void localRefresh;
    ensureDiscoveredCostCentres(development.id, pos);
    return buildCvrWorkspaceModel(development, { pos });
  }, [development, pos, refreshToken, localRefresh]);

  useEffect(() => {
    setNotes(workspace?.developmentNotes || '');
  }, [workspace?.developmentNotes]);

  const drawerPackages = useMemo(() => {
    if (!selectedRow) return [];
    return buildPackagesForCostCentre(development.id, selectedRow.costCodeKey, pos);
  }, [selectedRow, development.id, pos]);

  const drawerLedgerRows = useMemo(() => {
    if (!selectedRow) return [];
    return buildLedgerRowsForCostCentre(development.id, selectedRow.costCodeKey);
  }, [selectedRow, development.id]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
    onCvrChanged?.();
  }

  function handleBudgetChange(row, field, rawValue) {
    const centreId = row.id.startsWith('auto-') ? null : row.id;

    let targetId = centreId;
    if (!targetId) {
      const created = upsertAutoCostCentre(development.id, {
        costCodeKey: row.costCodeKey,
        costCodeLabel: row.costCodeLabel,
      });
      targetId = created?.id;
    }

    if (!targetId) return;

    updateCostCentre(development.id, targetId, { [field]: rawValue });
    refresh();
  }

  function handleSaveNotes(patch) {
    if (!selectedRow) return;

    let targetId = selectedRow.id.startsWith('auto-') ? null : selectedRow.id;
    if (!targetId) {
      const created = upsertAutoCostCentre(development.id, {
        costCodeKey: selectedRow.costCodeKey,
        costCodeLabel: selectedRow.costCodeLabel,
      });
      targetId = created?.id;
    }
    if (!targetId) return;

    updateCostCentre(development.id, targetId, patch);
    setSelectedRow((prev) => (prev ? { ...prev, ...patch } : prev));
    refresh();
  }

  function handleAddCostCentre(values) {
    const result = addCostCentre(development.id, values);
    if (!result.ok) return result;
    setAddOpen(false);
    refresh();
    return result;
  }

  function handleNotesBlur() {
    updateDevelopmentNotes(development.id, notes);
    refresh();
  }

  if (!workspace) return null;

  return (
    <div className="dev-cvr">
      <POPageHeader
        eyebrow="Cost Value Reconciliation"
        title={workspace.developmentName}
        lead={`Development ${workspace.developmentNumber || '—'} · Live commercial position`}
      />

      <CvrSummaryDashboard cards={workspace.summaryCards} />

      <header className="dev-cvr__header">
        <div>
          <h2 className="po-matrix-section__title">CVR by Cost Centre</h2>
          <p className="dev-cvr__lead">
            Budgets and forecasts are manual. Commitments and actual costs are
            calculated automatically from BuildLite commercial data.
          </p>
        </div>
        <button type="button" className="po-btn-primary" onClick={() => setAddOpen(true)}>
          Add Cost Centre
        </button>
      </header>

      <CVRTable
        rows={workspace.rows}
        totals={workspace.totals}
        onRowSelect={setSelectedRow}
        onBudgetChange={handleBudgetChange}
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
          placeholder="Summarise commercial position, risks and actions for this development."
        />
      </section>

      <CostCentreDrawer
        open={Boolean(selectedRow)}
        row={selectedRow}
        packages={drawerPackages}
        ledgerRows={drawerLedgerRows}
        onClose={() => setSelectedRow(null)}
        onSaveNotes={handleSaveNotes}
      />

      <AddCostCentreDialog
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onSave={handleAddCostCentre}
      />
    </div>
  );
}
