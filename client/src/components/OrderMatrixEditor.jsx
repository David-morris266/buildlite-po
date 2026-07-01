import { useCallback, useMemo, useRef, useState } from 'react';
import POPageHeader from './POPageHeader';
import { formatMoney } from './poDrawerHelpers';
import {
  getMatrixAllocationSummary,
  sumMatrixAllocated,
} from '../payments/subcontractOrders';
import { saveOrderMatrix, hasOrderMatrix } from '../payments/orderMatrixStore';
import { recordMatrixSaved } from '../payments/subcontractPackageStore';
import {
  cloneMatrixRows,
  createEmptyMatrixRow,
  getAllocationStatus,
  getMatrixValidation,
  normalizeMatrixRows,
  rowsAreEqual,
} from '../payments/orderMatrixHelpers';
import OrderMatrixImportWizard from './OrderMatrixImportWizard';

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function MatrixRow({
  row,
  rowIndex,
  onUpdate,
  onDelete,
  onEditFocus,
  onAddRowAfter,
}) {
  const descRef = useRef(null);

  function handleEdit() {
    onEditFocus?.(row.id);
    descRef.current?.focus();
    descRef.current?.select();
  }

  function handleDescriptionKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onAddRowAfter?.(row.id);
    }
  }

  return (
    <tr className="po-matrix-table__row">
      <td className="po-matrix-table__drag">
        <span
          className="po-matrix-table__drag-handle"
          aria-hidden="true"
          title="Drag to reorder — coming soon"
        >
          ⠿
        </span>
        <span className="po-matrix-table__sr-only">
          Drag to reorder — coming soon
        </span>
      </td>
      <td>
        <input
          ref={descRef}
          id={`matrix-row-${row.id}-description`}
          className="input po-matrix-table__input"
          type="text"
          value={row.description}
          onChange={(e) => onUpdate(row.id, 'description', e.target.value)}
          onKeyDown={handleDescriptionKeyDown}
          placeholder="e.g. Earthworks"
          aria-label={`Row ${rowIndex + 1} description`}
        />
      </td>
      <td>
        <div className="po-matrix-table__money">
          <span aria-hidden="true">£</span>
          <input
            id={`matrix-row-${row.id}-value`}
            className="input po-matrix-table__input po-matrix-table__input--money"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={row.orderValue}
            onChange={(e) => onUpdate(row.id, 'orderValue', e.target.value)}
            aria-label={`Row ${rowIndex + 1} order value`}
          />
        </div>
      </td>
      <td>
        <input
          className="input po-matrix-table__input"
          type="text"
          value={row.notes}
          onChange={(e) => onUpdate(row.id, 'notes', e.target.value)}
          placeholder="Optional"
          aria-label={`Row ${rowIndex + 1} notes`}
        />
      </td>
      <td className="po-matrix-table__future" aria-hidden="true">
        <span className="po-matrix-table__future-cell">—</span>
      </td>
      <td className="po-matrix-table__future" aria-hidden="true">
        <span className="po-matrix-table__future-cell">—</span>
      </td>
      <td className="po-matrix-table__future" aria-hidden="true">
        <span className="po-matrix-table__future-cell">—</span>
      </td>
      <td>
        <div className="po-matrix-table__actions">
          <button
            type="button"
            className="po-matrix-table__action"
            onClick={handleEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className="po-matrix-table__action po-matrix-table__action--danger"
            onClick={() => onDelete(row.id)}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function OrderMatrixEditor({
  order,
  initialMatrix,
  onCancel,
  onSaved,
  embedded = false,
}) {
  const initialRows = useMemo(
    () => cloneMatrixRows(initialMatrix?.rows || []),
    [initialMatrix]
  );

  const [rows, setRows] = useState(initialRows);
  const [savedRows, setSavedRows] = useState(initialRows);
  const [feedback, setFeedback] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const allocation = useMemo(
    () => getMatrixAllocationSummary(rows, order?.committedValue),
    [rows, order?.committedValue]
  );

  const validation = useMemo(() => getMatrixValidation(allocation), [allocation]);
  const allocationStatus = useMemo(
    () => getAllocationStatus(allocation),
    [allocation]
  );

  const isDirty = useMemo(
    () => !rowsAreEqual(rows, savedRows),
    [rows, savedRows]
  );

  const difference = allocation.remaining;

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]:
                field === 'orderValue'
                  ? value === ''
                    ? ''
                    : Number(value)
                  : value,
            }
          : row
      )
    );
    setFeedback(null);
  }, []);

  const addRow = useCallback((afterId = null) => {
    const newRow = createEmptyMatrixRow(newRowId());
    setRows((prev) => {
      if (!afterId) return [...prev, newRow];
      const index = prev.findIndex((row) => row.id === afterId);
      if (index < 0) return [...prev, newRow];
      const next = [...prev];
      next.splice(index + 1, 0, newRow);
      return next;
    });
    setFeedback(null);
    requestAnimationFrame(() => {
      document.getElementById(`matrix-row-${newRow.id}-description`)?.focus();
    });
  }, []);

  const removeRow = useCallback((id) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
    setFeedback(null);
  }, []);

  const handleSave = useCallback(() => {
    const normalizedRows = normalizeMatrixRows(rows);
    const isFirstSave = !hasOrderMatrix(order.orderKey);

    saveOrderMatrix(order.orderKey, {
      orderKey: order.orderKey,
      jobId: order.jobId,
      supplierId: order.supplierId,
      projectLabel: order.projectLabel,
      supplierLabel: order.supplierLabel,
      committedValue: order.committedValue,
      rows: normalizedRows,
    });

    recordMatrixSaved(order.orderKey, { isFirstSave });

    const savedClone = cloneMatrixRows(normalizedRows);
    setSavedRows(savedClone);
    setRows(savedClone);
    setFeedback({
      type: 'success',
      message: 'Order Matrix saved.',
    });
    onSaved?.({
      orderKey: order.orderKey,
      rowCount: normalizedRows.length,
      allocated: sumMatrixAllocated(normalizedRows),
    });
  }, [rows, order, onSaved]);

  const handleDiscard = useCallback(() => {
    setRows(cloneMatrixRows(savedRows));
    setFeedback({
      type: 'info',
      message: 'Changes discarded.',
    });
  }, [savedRows]);

  const handleImportComplete = useCallback((payload) => {
    const importedRows = Array.isArray(payload) ? payload : payload?.rows || [];
    setRows(cloneMatrixRows(importedRows));
    setImportOpen(false);
    setFeedback({
      type: 'success',
      message: `${importedRows.length} row${importedRows.length === 1 ? '' : 's'} imported. Review your matrix and save when ready.`,
    });
  }, []);

  const focusRow = useCallback((id) => {
    document.getElementById(`matrix-row-${id}-description`)?.focus();
  }, []);

  if (importOpen) {
    return (
      <div className="po-matrix-page">
        <OrderMatrixImportWizard
          order={order}
          onCancel={() => setImportOpen(false)}
          onImport={handleImportComplete}
        />
      </div>
    );
  }

  return (
    <div className={`po-matrix-page${embedded ? ' po-matrix-page--embedded' : ''}`}>
      {!embedded ? (
        <POPageHeader
          eyebrow="Order matrix"
          title="Order Matrix"
          lead="Break the subcontract package into certifiable rows. Allocate the full committed value before raising certificates."
        />
      ) : null}

      {feedback ? (
        <div
          className={`po-list-feedback po-list-feedback--${feedback.type}`}
          role="status"
        >
          {feedback.message}
        </div>
      ) : null}

      {isDirty ? (
        <div className="po-matrix-unsaved" role="status">
          <span className="po-matrix-unsaved__label">Unsaved changes</span>
          <span className="po-matrix-unsaved__hint">
            Save or discard your edits before leaving this screen.
          </span>
        </div>
      ) : null}

      <section
        className="po-module-card po-matrix-commercial"
        aria-labelledby="po-matrix-commercial-title"
      >
        <h2 id="po-matrix-commercial-title" className="po-matrix-section__title">
          Commercial summary
        </h2>
        <dl className="po-matrix-commercial__grid">
          <div>
            <dt>Project</dt>
            <dd>{order.projectLabel}</dd>
          </div>
          <div>
            <dt>Supplier</dt>
            <dd>{order.supplierLabel}</dd>
          </div>
          <div>
            <dt>Committed value</dt>
            <dd>£{formatMoney(allocation.committed)}</dd>
          </div>
          <div>
            <dt>Allocated value</dt>
            <dd className="po-matrix-commercial__live">£{formatMoney(allocation.allocated)}</dd>
          </div>
          <div>
            <dt>Remaining value</dt>
            <dd
              className={
                allocation.isBalanced
                  ? 'po-matrix-commercial__balanced'
                  : difference < 0
                    ? 'po-matrix-commercial__over'
                    : 'po-matrix-commercial__remaining'
              }
            >
              £{formatMoney(Math.abs(difference))}
              {!allocation.isBalanced && difference > 0 ? ' to allocate' : null}
              {!allocation.isBalanced && difference < 0 ? ' over' : null}
            </dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>{rows.length}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span
                className={`po-matrix-status po-matrix-status--${allocationStatus.modifier}`}
              >
                {allocationStatus.label}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section
        className={`po-module-card po-matrix-validation po-matrix-validation--${validation.modifier}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <h2 className="po-matrix-section__title">Validation</h2>
        <p className="po-matrix-validation__message">
          {validation.modifier === 'balanced' ? (
            <>
              <span className="po-matrix-validation__prefix">✓</span>
              <strong>Fully allocated</strong>
              <span className="po-matrix-validation__detail">
                · £{formatMoney(allocation.allocated)} allocated
              </span>
            </>
          ) : (
            <>
              <strong>£{formatMoney(Number(validation.headline) || 0)}</strong>
              <span className="po-matrix-validation__detail">
                {' '}
                {validation.detail}
              </span>
            </>
          )}
        </p>
      </section>

      <section className="po-module-card po-matrix-workspace">
        <div className="po-matrix-toolbar">
          <div>
            <h2 className="po-matrix-toolbar__title">Matrix rows</h2>
            <p className="po-matrix-toolbar__hint">
              Tab between fields. Press Enter in Description to add the next row.
            </p>
          </div>
          <div className="po-matrix-toolbar__actions">
            <button type="button" className="po-btn-primary" onClick={() => addRow()}>
              Add Row
            </button>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={() => setImportOpen(true)}
            >
              Import from Excel
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="po-matrix-empty">
            <p className="po-matrix-empty__lead">
              Build your valuation schedule row by row, or import an existing
              spreadsheet to get started quickly.
            </p>
            <p className="po-matrix-empty__support">
              Import your existing valuation spreadsheet to create your Order Matrix.
            </p>
            <div className="po-matrix-empty__actions">
              <button type="button" className="po-btn-primary" onClick={() => addRow()}>
                Add first row
              </button>
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={() => setImportOpen(true)}
              >
                Import from Excel
              </button>
            </div>
          </div>
        ) : (
          <div className="po-table-wrap po-matrix-table-wrap">
            <table className="po-data-table po-matrix-table">
              <thead>
                <tr>
                  <th className="po-matrix-table__drag" aria-label="Reorder" />
                  <th>Description</th>
                  <th style={{ width: 148 }}>Order Value</th>
                  <th>Notes</th>
                  <th
                    className="po-matrix-table__future po-matrix-table__future--label"
                    title="Coming in Payment Certificates"
                  >
                    Cert %
                  </th>
                  <th
                    className="po-matrix-table__future po-matrix-table__future--label"
                    title="Coming in Payment Certificates"
                  >
                    Certified
                  </th>
                  <th
                    className="po-matrix-table__future po-matrix-table__future--label"
                    title="Coming in Payment Certificates"
                  >
                    Remaining
                  </th>
                  <th style={{ width: 132 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <MatrixRow
                    key={row.id}
                    row={row}
                    rowIndex={index}
                    onUpdate={updateRow}
                    onDelete={removeRow}
                    onEditFocus={focusRow}
                    onAddRowAfter={addRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer
          className={`po-matrix-totals po-matrix-totals--${validation.modifier}`}
          aria-label="Running totals"
        >
          <div className="po-matrix-totals__grid">
            <div>
              <span className="po-matrix-totals__label">Committed value</span>
              <strong>£{formatMoney(allocation.committed)}</strong>
            </div>
            <div>
              <span className="po-matrix-totals__label">Allocated value</span>
              <strong>£{formatMoney(allocation.allocated)}</strong>
            </div>
            <div>
              <span className="po-matrix-totals__label">Remaining value</span>
              <strong>
                £{formatMoney(Math.abs(difference))}
                {!allocation.isBalanced && difference > 0 ? ' to allocate' : ''}
                {!allocation.isBalanced && difference < 0 ? ' over' : ''}
              </strong>
            </div>
            <div>
              <span className="po-matrix-totals__label">Difference</span>
              <strong>
                {allocation.isBalanced
                  ? '£0.00'
                  : `${difference > 0 ? '+' : '−'}£${formatMoney(Math.abs(difference))}`}
              </strong>
            </div>
          </div>
        </footer>
      </section>

      <footer className="po-matrix-footer">
        <div className="po-matrix-footer__actions">
          <button type="button" className="po-btn-primary" onClick={handleSave}>
            Save Matrix
          </button>
          {isDirty ? (
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={handleDiscard}
            >
              Discard Changes
            </button>
          ) : null}
        </div>
        {!isDirty ? (
          <button
            type="button"
            className="po-matrix-footer__back"
            onClick={onCancel}
          >
            {embedded ? 'Back to Overview' : 'Back to Subcontract Orders'}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
