import { useMemo, useState } from 'react';
import PlotDrawer from './PlotDrawer';
import PlotScheduleImportWizard from './PlotScheduleImportWizard';
import {
  addPlot,
  deletePlot,
  formatPlotBedrooms,
  formatPlotGia,
  getPlots,
  replacePlotMaster,
  updatePlot,
} from '../developments/plotMaster';

function PlotDeleteDialog({ plot, onCancel, onConfirm }) {
  if (!plot) return null;

  return (
    <div className="dev-plot-delete-backdrop" role="presentation">
      <div
        className="dev-plot-delete modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-plot-delete-title"
      >
        <h3 id="dev-plot-delete-title">Delete plot {plot.plotNumber}?</h3>
        <p>
          This will remove the plot from the Plot Master. This action cannot be
          undone.
        </p>
        <div className="dev-plot-delete__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dev-plot-delete__confirm" onClick={onConfirm}>
            Delete Plot
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlotMaster({
  developmentId,
  developmentName,
  refreshToken = 0,
  onPlotsChanged,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPlot, setEditingPlot] = useState(null);
  const [saveErrors, setSaveErrors] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const plots = useMemo(() => {
    void refreshToken;
    return getPlots(developmentId);
  }, [developmentId, refreshToken]);

  function openAddDrawer() {
    setEditingPlot(null);
    setSaveErrors([]);
    setDrawerOpen(true);
  }

  function openEditDrawer(plot) {
    setEditingPlot(plot);
    setSaveErrors([]);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingPlot(null);
    setSaveErrors([]);
  }

  function handleSave(formData) {
    const result = editingPlot
      ? updatePlot(developmentId, editingPlot.id, formData)
      : addPlot(developmentId, formData);

    if (!result.ok) {
      setSaveErrors(result.errors || ['Could not save plot.']);
      return;
    }

    closeDrawer();
    onPlotsChanged?.();
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deletePlot(developmentId, deleteTarget.id);
    setDeleteTarget(null);
    onPlotsChanged?.();
  }

  function handleImport(result) {
    replacePlotMaster(developmentId, result.plots);
    setImportOpen(false);
    onPlotsChanged?.();
  }

  if (importOpen) {
    return (
      <PlotScheduleImportWizard
        developmentName={developmentName}
        onCancel={() => setImportOpen(false)}
        onImport={handleImport}
      />
    );
  }

  return (
    <div className="dev-plot-master">
      <header className="dev-plot-master__header">
        <div>
          <h2 className="po-matrix-section__title">Plot Master</h2>
          <p className="dev-plot-master__lead">
            The single source of truth for every plot in this development.
          </p>
        </div>
        {plots.length ? (
          <div className="dev-plot-master__actions">
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={() => setImportOpen(true)}
            >
              Import Plot Schedule
            </button>
            <button type="button" className="po-btn-primary" onClick={openAddDrawer}>
              Add Plot
            </button>
          </div>
        ) : null}
      </header>

      {!plots.length ? (
        <div className="po-module-card po-empty-state dev-plot-master__empty">
          <p className="po-empty-state__message">
            No Plot Master has been created for this development.
          </p>
          <p className="po-empty-state__hint">
            Import your plot schedule or add plots manually. Every commercial
            module will use this as the master development structure.
          </p>
          <div className="dev-plot-master__empty-actions">
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => setImportOpen(true)}
            >
              Import Plot Schedule
            </button>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={openAddDrawer}
            >
              Add Plot
            </button>
          </div>
        </div>
      ) : (
        <div className="po-table-wrap">
          <table className="po-data-table dev-plot-master__table">
            <thead>
              <tr>
                <th>Plot</th>
                <th>House Type</th>
                <th>Configuration</th>
                <th>Bedrooms</th>
                <th>GIA</th>
                <th>Phase</th>
                <th>Tenure</th>
                <th>Status</th>
                <th className="dev-plot-master__actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plots.map((plot) => (
                <tr key={plot.id}>
                  <td>{plot.plotNumber}</td>
                  <td>{plot.houseType}</td>
                  <td>{plot.configuration || '—'}</td>
                  <td>{formatPlotBedrooms(plot.bedrooms)}</td>
                  <td>{formatPlotGia(plot.gia)}</td>
                  <td>{plot.phase || '—'}</td>
                  <td>{plot.tenure || '—'}</td>
                  <td>{plot.status || '—'}</td>
                  <td className="dev-plot-master__row-actions">
                    <button
                      type="button"
                      className="dev-plot-master__link"
                      onClick={() => openEditDrawer(plot)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="dev-plot-master__link dev-plot-master__link--danger"
                      onClick={() => setDeleteTarget(plot)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PlotDrawer
        open={drawerOpen}
        plot={editingPlot}
        saveErrors={saveErrors}
        onClose={closeDrawer}
        onSave={handleSave}
      />

      <PlotDeleteDialog
        plot={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
