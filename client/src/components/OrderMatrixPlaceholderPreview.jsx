import { useState } from 'react';
import OrderMatrixImportWizard from './OrderMatrixImportWizard';
import { formatMoney, formatPoDate } from './poDrawerHelpers';
import { hasOrderMatrix, loadOrderMatrix, saveOrderMatrix } from '../payments/orderMatrixStore';
import { recordMatrixSaved } from '../payments/subcontractPackageStore';

function ImportedMatrixTable({ matrix }) {
  if (
    matrix?.layout === 'plot-stage' &&
    Array.isArray(matrix.stages) &&
    matrix.stages.length &&
    Array.isArray(matrix.plots) &&
    matrix.plots.length
  ) {
    return (
      <div className="po-table-wrap po-matrix-imported__table-wrap">
        <table className="po-data-table po-matrix-imported__table">
          <thead>
            <tr>
              <th className="po-matrix-imported__plot">Plot</th>
              {matrix.stages.map((stage) => (
                <th key={stage} className="po-matrix-imported__stage">
                  {stage}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.plots.map((plot) => (
              <tr key={plot.label || plot.id}>
                <th scope="row" className="po-matrix-imported__plot">
                  {plot.label}
                </th>
                {(plot.values || []).map((value, index) => (
                  <td
                    key={`${plot.label || plot.id}-${index}`}
                    className="po-matrix-imported__value"
                  >
                    £{formatMoney(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <p className="po-matrix-empty__support">
      No matrix content is recorded for this package yet.
    </p>
  );
}

export default function OrderMatrixPlaceholderPreview({
  order,
  hasMatrix = false,
  onCancel,
  onMatrixImported,
  embedded = false,
}) {
  const [importOpen, setImportOpen] = useState(false);
  const matrix = hasMatrix ? loadOrderMatrix(order.orderKey) : null;

  function handleImportComplete(payload) {
    if (payload?.layout !== 'plot-stage') return;

    const isFirstSave = !hasOrderMatrix(order.orderKey);

    saveOrderMatrix(order.orderKey, {
      orderKey: order.orderKey,
      jobId: order.jobId,
      supplierId: order.supplierId,
      projectLabel: order.projectLabel,
      supplierLabel: order.supplierLabel,
      committedValue: order.committedValue,
      layout: 'plot-stage',
      stages: payload.stages,
      plots: payload.plots,
    });

    recordMatrixSaved(order.orderKey, { isFirstSave });
    setImportOpen(false);
    onMatrixImported?.();
  }

  if (importOpen) {
    return (
      <OrderMatrixImportWizard
        order={order}
        requirePlotStageLayout
        onCancel={() => setImportOpen(false)}
        onImport={handleImportComplete}
      />
    );
  }

  return (
    <div className={`po-matrix-page${embedded ? ' po-matrix-page--embedded' : ''}`}>
      {!hasMatrix ? (
        <section className="po-module-card po-matrix-empty po-matrix-empty--housebuilder">
          <h2 className="po-matrix-section__title">Import your valuation matrix</h2>
          <p className="po-matrix-empty__lead">
            Bring in the spreadsheet you already use on site — plots down the
            left, payment stages across the top, values in each cell.
          </p>
          <p className="po-matrix-empty__support">
            BuildLite preserves your existing commercial valuation layout.
          </p>
          <div className="po-matrix-empty__actions">
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => setImportOpen(true)}
            >
              Import your valuation matrix
            </button>
          </div>
          <p className="po-matrix-empty__future">
            When Payment Certificates are available, certified values will update
            inside your imported matrix — your plot and stage layout stays intact.
          </p>
        </section>
      ) : (
        <section className="po-module-card po-matrix-imported">
          <div className="po-matrix-imported__header">
            <div>
              <h2 className="po-matrix-section__title">Order Matrix</h2>
              <p className="po-matrix-imported__meta">
                {order.projectLabel} · {order.supplierLabel}
                {matrix?.updatedAt
                  ? ` · Updated ${formatPoDate(matrix.updatedAt)}`
                  : null}
              </p>
            </div>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={() => setImportOpen(true)}
            >
              Import again
            </button>
          </div>

          <dl className="po-matrix-commercial__grid po-matrix-imported__summary">
            <div>
              <dt>Committed value</dt>
              <dd>£{formatMoney(order.committedValue)}</dd>
            </div>
            <div>
              <dt>Layout</dt>
              <dd>Plot × payment stage</dd>
            </div>
            <div>
              <dt>Plots</dt>
              <dd>{matrix?.plots?.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Stages</dt>
              <dd>{matrix?.stages?.length ?? '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Imported</dd>
            </div>
          </dl>

          <ImportedMatrixTable matrix={matrix} />
        </section>
      )}

      {embedded ? (
        <footer className="po-matrix-footer">
          <button
            type="button"
            className="po-matrix-footer__back"
            onClick={onCancel}
          >
            Back to Overview
          </button>
        </footer>
      ) : null}
    </div>
  );
}
