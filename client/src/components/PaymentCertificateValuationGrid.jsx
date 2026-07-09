import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCellKey,
  buildCertificateValuationGrid,
  formatMoneyLabel,
  formatPctLabel,
  getPreviousCertificationDetails,
  PROGRESS_PRESETS,
  validateThisCertificatePct,
  getCellVisualState,
} from '../payments/paymentCertificateProgress';

function formatCompactCumulative(cumulativePct) {
  if (cumulativePct >= 100) return '100% ✓';
  if (cumulativePct <= 0) return '—';
  return formatPctLabel(cumulativePct);
}

function buildSelectionSummary(selectedKeys, cellMap) {
  if (!selectedKeys.size) return null;

  let contractValue = 0;
  let thisCertificate = 0;
  let cumulativeTotal = 0;

  selectedKeys.forEach((cellKey) => {
    const cell = cellMap.get(cellKey);
    if (!cell) return;
    contractValue += cell.contractValue;
    thisCertificate += cell.thisCertificateValue;
    cumulativeTotal += cell.cumulativePct;
  });

  return {
    count: selectedKeys.size,
    contractValue,
    thisCertificate,
    averageProgress: cumulativeTotal / selectedKeys.size,
  };
}

function FloatingToolbar({
  visible,
  style,
  onMarkComplete,
  onSetPercentage,
  onClearSelection,
  customPct,
  onCustomPctChange,
  onApplyCustomPct,
  showCustomPct,
  onToggleCustomPct,
}) {
  if (!visible) return null;

  return (
    <div
      className="po-cert-grid__toolbar po-cert-grid__toolbar--floating"
      style={style}
      role="toolbar"
      aria-label="Bulk progress actions"
    >
      <button type="button" className="po-cert-grid__toolbar-btn" onClick={onMarkComplete}>
        ✓ Complete
      </button>
      <button type="button" className="po-cert-grid__toolbar-btn" onClick={onToggleCustomPct}>
        Set %
      </button>
      <button type="button" className="po-cert-grid__toolbar-btn" onClick={onClearSelection}>
        Clear
      </button>

      {showCustomPct ? (
        <div className="po-cert-grid__toolbar-custom">
          <div className="po-cert-grid__chips" role="group" aria-label="Progress presets">
            {PROGRESS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="po-cert-grid__chip"
                onClick={() => onSetPercentage(preset)}
              >
                {preset}%
              </button>
            ))}
          </div>
          <div className="po-cert-grid__custom-row">
            <input
              className="input po-cert-grid__custom-input"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={customPct}
              onChange={(event) => onCustomPctChange(event.target.value)}
              aria-label="Custom percentage"
            />
            <button type="button" className="po-list-btn-secondary" onClick={onApplyCustomPct}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectionStatusBar({ summary }) {
  if (!summary) {
    return (
      <footer className="po-cert-grid__status-bar" aria-live="polite">
        <span className="po-cert-grid__status-item po-cert-grid__status-item--muted">
          No cells selected
        </span>
      </footer>
    );
  }

  return (
    <footer className="po-cert-grid__status-bar" aria-live="polite">
      <div className="po-cert-grid__status-item">
        <span className="po-cert-grid__status-label">Selected Cells</span>
        <strong>{summary.count}</strong>
      </div>
      <div className="po-cert-grid__status-item">
        <span className="po-cert-grid__status-label">Contract Value</span>
        <strong>{formatMoneyLabel(summary.contractValue)}</strong>
      </div>
      <div className="po-cert-grid__status-item">
        <span className="po-cert-grid__status-label">This Certificate</span>
        <strong>{formatMoneyLabel(summary.thisCertificate)}</strong>
      </div>
      <div className="po-cert-grid__status-item">
        <span className="po-cert-grid__status-label">Average Progress</span>
        <strong>{formatPctLabel(summary.averageProgress)}</strong>
      </div>
    </footer>
  );
}

function ValuationCell({
  cell,
  errors,
  visualState,
  cellRef,
  onSelect,
  onShiftSelect,
  onOpenPanel,
  onDragEnter,
  onMouseDown,
}) {
  return (
    <td
      ref={cellRef}
      className={`po-cert-grid__cell po-cert-grid__cell--${visualState}${
        cell.selected ? ' po-cert-grid__cell--selected' : ''
      }`}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        onMouseDown?.(cell.cellKey, event);
      }}
      onMouseEnter={() => onDragEnter?.(cell.cellKey)}
      onClick={(event) => {
        if (event.shiftKey) onShiftSelect?.(cell.cellKey);
        else onSelect?.(cell.cellKey);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onOpenPanel?.(cell.cellKey);
      }}
      aria-selected={cell.selected || undefined}
      title={`${cell.plotLabel} · ${cell.stageLabel} · ${formatCompactCumulative(cell.cumulativePct)}`}
    >
      <div className="po-cert-grid__cell-compact">
        <span className="po-cert-grid__cell-pct">
          {formatCompactCumulative(cell.cumulativePct)}
        </span>
        <span className="po-cert-grid__cell-contract">
          {formatMoneyLabel(cell.contractValue)}
        </span>
        <span className="po-cert-grid__cell-indicators" aria-hidden="true">
          {errors.length ? (
            <span className="po-cert-grid__cell-indicator po-cert-grid__cell-indicator--warning">
              !
            </span>
          ) : null}
        </span>
      </div>
    </td>
  );
}

function ValuationDetailPanel({
  cell,
  editable,
  selectionCount,
  displayPct,
  errors,
  historyDetails,
  auditItems = [],
  onClose,
  onComplete,
  onPctChange,
  panelInputRef,
}) {
  if (!cell) return null;

  const previousLabel = cell.previousCertificateNumber
    ? `Cert ${cell.previousCertificateNumber}`
    : '—';

  return (
    <aside
      className="po-cert-grid__detail-panel"
      role="complementary"
      aria-label="Stage details"
    >
      <header className="po-cert-grid__detail-header">
        <div>
          <p className="po-cert-grid__detail-eyebrow">Stage Details</p>
          <h4 className="po-cert-grid__detail-title">
            {cell.plotLabel} · {cell.stageLabel}
          </h4>
        </div>
        <button
          type="button"
          className="po-cert-grid__detail-close"
          onClick={onClose}
          aria-label="Close stage details panel"
        >
          ×
        </button>
      </header>

      {selectionCount > 1 ? (
        <p className="po-cert-grid__detail-selection-note">
          {selectionCount} cells selected — bulk actions apply to all selected cells.
        </p>
      ) : null}

      <div className="po-cert-grid__detail-compact">
        <div className="po-cert-grid__detail-row">
          <span>Contract Value</span>
          <strong>{formatMoneyLabel(cell.contractValue)}</strong>
        </div>
        <div className="po-cert-grid__detail-row">
          <span>
            Previous
            <em className="po-cert-grid__detail-muted"> · {previousLabel}</em>
          </span>
          <strong>{formatPctLabel(cell.previousCumulativePct)}</strong>
        </div>
        <div className="po-cert-grid__detail-row po-cert-grid__detail-row--entry">
          <span>This Certificate</span>
          {editable ? (
            <div className="po-cert-grid__detail-controls">
              <input
                id="po-cert-detail-pct"
                ref={panelInputRef}
                className="input po-cert-grid__detail-input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={displayPct === 0 ? '' : displayPct}
                onChange={(event) => onPctChange(cell.cellKey, event.target.value)}
                aria-label={`This certificate percentage for ${cell.plotLabel} ${cell.stageLabel}`}
              />
              <span className="po-cert-grid__detail-input-suffix">%</span>
              <button
                type="button"
                className="po-cert-grid__detail-complete"
                onClick={() => onComplete(cell.cellKey)}
              >
                ✓ Complete
              </button>
            </div>
          ) : (
            <strong>{formatPctLabel(cell.thisCertificatePct)}</strong>
          )}
        </div>
        {errors.length ? (
          <ul className="po-cert-grid__detail-errors">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        <div className="po-cert-grid__detail-row">
          <span>Cumulative</span>
          <strong>{formatPctLabel(cell.cumulativePct)}</strong>
        </div>

        <hr className="po-cert-grid__detail-divider" />

        <div className="po-cert-grid__detail-row">
          <span>Previous Value</span>
          <strong>{formatMoneyLabel(cell.previousValue)}</strong>
        </div>
        <div className="po-cert-grid__detail-row">
          <span>This Certificate</span>
          <strong>{formatMoneyLabel(cell.thisCertificateValue)}</strong>
        </div>
        <div className="po-cert-grid__detail-row">
          <span>Certified To Date</span>
          <strong>{formatMoneyLabel(cell.certifiedToDateValue)}</strong>
        </div>
        <div className="po-cert-grid__detail-row">
          <span>Remaining</span>
          <strong>{formatMoneyLabel(cell.remainingValue)}</strong>
        </div>
      </div>

      <details className="po-cert-grid__history-disclosure">
        <summary>History</summary>
        {auditItems.length ? (
          <ul className="po-cert-grid__history-list po-cert-grid__history-list--audit">
            {auditItems.map((entry) => (
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
        ) : null}
        {historyDetails?.length ? (
          <ul className="po-cert-grid__history-list">
            {historyDetails.map((item) => (
              <li key={item.cellKey}>
                <strong>
                  {item.cellKey === cell.cellKey
                    ? `Certificate ${item.previousCertificateNumber || '—'}`
                    : item.cellKey.replace('::', ' · stage ')}
                </strong>
                <span>
                  Previous {formatPctLabel(item.previousCumulativePct)}
                  {item.previousCertificateNumber
                    ? ` · Cert ${item.previousCertificateNumber}`
                    : ''}
                </span>
                {item.entries.length ? (
                  <ul>
                    {item.entries.map((entry) => (
                      <li key={`${item.cellKey}-${entry.certificateNumber}`}>
                        Certificate {entry.certificateNumber}:{' '}
                        {formatPctLabel(entry.thisCertificatePct)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="po-cert-grid__detail-muted">No previous progress recorded.</p>
                )}
              </li>
            ))}
          </ul>
        ) : !auditItems.length ? (
          <p className="po-cert-grid__detail-muted">No certificate history available.</p>
        ) : null}
      </details>

      <section className="po-cert-grid__detail-notes" aria-label="Commercial notes">
        <h5>Commercial Notes</h5>
        <p className="po-cert-grid__notes-placeholder">
          Notes will be available in a future sprint.
        </p>
      </section>
    </aside>
  );
}

export default function PaymentCertificateValuationGrid({
  orderKey,
  certificate,
  matrix,
  developmentId,
  editable = true,
  auditItems = [],
  onProgressChange,
}) {
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [anchorKey, setAnchorKey] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showCustomPct, setShowCustomPct] = useState(false);
  const [customPct, setCustomPct] = useState('25');
  const [inputDrafts, setInputDrafts] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const [toolbarStyle, setToolbarStyle] = useState(null);
  const panelInputRef = useRef(null);
  const tableWrapRef = useRef(null);
  const cellRefs = useRef(new Map());

  const grid = useMemo(
    () =>
      buildCertificateValuationGrid(orderKey, certificate, matrix, selectedKeys, {
        developmentId,
      }),
    [orderKey, certificate, matrix, selectedKeys, developmentId]
  );

  const panelCell =
    isPanelOpen && anchorKey
      ? grid?.cells.find((item) => item.cellKey === anchorKey) || null
      : null;

  const updateToolbarPosition = useCallback(() => {
    if (!selectedKeys.size || !anchorKey) {
      setToolbarStyle(null);
      return;
    }

    const wrap = tableWrapRef.current;
    const cellEl = cellRefs.current.get(anchorKey);
    if (!wrap || !cellEl) {
      setToolbarStyle(null);
      return;
    }

    const cellRect = cellEl.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const toolbarWidth = 320;
    const left = Math.min(
      Math.max(cellRect.left - wrapRect.left + wrap.scrollLeft, 8),
      wrap.clientWidth - toolbarWidth - 8
    );
    const top = cellRect.top - wrapRect.top + wrap.scrollTop - 44;

    setToolbarStyle({
      top: `${Math.max(top, 8)}px`,
      left: `${left}px`,
    });
  }, [selectedKeys, anchorKey]);

  useEffect(() => {
    updateToolbarPosition();
  }, [updateToolbarPosition, grid, showCustomPct]);

  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return undefined;

    wrap.addEventListener('scroll', updateToolbarPosition);
    window.addEventListener('resize', updateToolbarPosition);
    return () => {
      wrap.removeEventListener('scroll', updateToolbarPosition);
      window.removeEventListener('resize', updateToolbarPosition);
    };
  }, [updateToolbarPosition]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsPanelOpen(false);
        setShowCustomPct(false);
      }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    function handleMouseUp() {
      setIsDragging(false);
    }
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (!selectedKeys.size || !grid) return;
      const currentKey = anchorKey || [...selectedKeys][0];
      const cell = grid.cells.find((item) => item.cellKey === currentKey);
      if (!cell) return;

      let nextPlot = cell.plotIndex;
      let nextStage = cell.stageIndex;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextStage = Math.min((grid.stages.length || 1) - 1, nextStage + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        nextStage = Math.max(0, nextStage - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        nextPlot = Math.min((grid.rows.length || 1) - 1, nextPlot + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        nextPlot = Math.max(0, nextPlot - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        setIsPanelOpen(true);
        window.requestAnimationFrame(() => {
          panelInputRef.current?.focus();
          panelInputRef.current?.select();
        });
        return;
      } else {
        return;
      }

      const nextKey = buildCellKey(nextPlot, nextStage);
      setSelectedKeys(new Set([nextKey]));
      setAnchorKey(nextKey);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [grid, selectedKeys, anchorKey, isPanelOpen]);

  if (!grid) {
    return (
      <p className="po-cert-detail__matrix-lead">
        Import a plot × stage valuation matrix before recording certificate progress.
      </p>
    );
  }

  function cellMap() {
    const map = new Map();
    grid.cells.forEach((cell) => map.set(cell.cellKey, cell));
    return map;
  }

  function selectSingle(cellKey) {
    setSelectedKeys(new Set([cellKey]));
    setAnchorKey(cellKey);
  }

  function openPanel(cellKey) {
    setSelectedKeys(new Set([cellKey]));
    setAnchorKey(cellKey);
    setIsPanelOpen(true);
  }

  function selectRange(endKey) {
    if (!anchorKey) {
      selectSingle(endKey);
      return;
    }

    const map = cellMap();
    const start = map.get(anchorKey);
    const end = map.get(endKey);
    if (!start || !end) return;

    const plotMin = Math.min(start.plotIndex, end.plotIndex);
    const plotMax = Math.max(start.plotIndex, end.plotIndex);
    const stageMin = Math.min(start.stageIndex, end.stageIndex);
    const stageMax = Math.max(start.stageIndex, end.stageIndex);
    const next = new Set();

    grid.cells.forEach((cell) => {
      if (
        cell.plotIndex >= plotMin &&
        cell.plotIndex <= plotMax &&
        cell.stageIndex >= stageMin &&
        cell.stageIndex <= stageMax
      ) {
        next.add(cell.cellKey);
      }
    });

    setSelectedKeys(next);
  }

  function selectRow(plotIndex) {
    const next = new Set(
      grid.cells.filter((cell) => cell.plotIndex === plotIndex).map((cell) => cell.cellKey)
    );
    setSelectedKeys(next);
    setAnchorKey([...next][0] || null);
  }

  function selectColumn(stageIndex) {
    const next = new Set(
      grid.cells.filter((cell) => cell.stageIndex === stageIndex).map((cell) => cell.cellKey)
    );
    setSelectedKeys(next);
    setAnchorKey([...next][0] || null);
  }

  function applyToSelection(updater, options = {}) {
    if (!editable || !selectedKeys.size) return;
    const patch = {};
    const map = cellMap();

    selectedKeys.forEach((cellKey) => {
      const cell = map.get(cellKey);
      if (!cell) return;
      const rawEntry = updater(cell);
      const validation = validateThisCertificatePct(
        cell.previousCumulativePct,
        rawEntry,
        options
      );
      if (validation.valid) {
        patch[cellKey] = { thisCertificatePct: validation.pct };
      }
    });

    if (Object.keys(patch).length) {
      onProgressChange?.(patch);
    }
  }

  function handlePctChange(cellKey, rawValue) {
    const cell = cellMap().get(cellKey);
    if (!cell) return;
    const validation = validateThisCertificatePct(
      cell.previousCumulativePct,
      rawValue
    );

    if (rawValue === '' || validation.valid) {
      onProgressChange?.({
        [cellKey]: { thisCertificatePct: validation.pct },
      });
      setInputDrafts((current) => {
        if (!current[cellKey]) return current;
        const next = { ...current };
        delete next[cellKey];
        return next;
      });
      return;
    }

    setInputDrafts((current) => ({ ...current, [cellKey]: rawValue }));
  }

  function getCellPresentation(cell) {
    const draft = inputDrafts[cell.cellKey];
    const validation = validateThisCertificatePct(
      cell.previousCumulativePct,
      draft ?? cell.thisCertificatePct
    );
    const displayPct = draft ?? cell.thisCertificatePct;
    const visualState = getCellVisualState({
      cumulativePct: cell.cumulativePct,
      thisCertificatePct: validation.valid ? validation.pct : displayPct,
      hasError: !validation.valid,
      selected: false,
    });

    return {
      displayPct,
      errors: validation.errors,
      visualState,
    };
  }

  function handleDragStart(cellKey, event) {
    if (event.target.closest('input, button')) return;
    setIsDragging(true);
    selectSingle(cellKey);
  }

  function handleDragEnter(cellKey) {
    if (!isDragging) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      next.add(cellKey);
      return next;
    });
  }

  function closeDetailPanel() {
    setIsPanelOpen(false);
  }

  const map = cellMap();
  const selectionSummary = buildSelectionSummary(selectedKeys, map);
  const panelPresentation = panelCell ? getCellPresentation(panelCell) : null;
  const historyDetails =
    isPanelOpen && anchorKey
      ? getPreviousCertificationDetails(orderKey, certificate, [anchorKey])
      : [];

  return (
    <div className="po-cert-grid">
      <div
        className={`po-cert-grid__layout${
          isPanelOpen ? ' po-cert-grid__layout--panel-open' : ''
        }`}
      >
        <div className="po-cert-grid__matrix-pane">
          <div className="po-cert-grid__table-wrap" ref={tableWrapRef}>
            <FloatingToolbar
              visible={editable && selectedKeys.size > 0}
              style={toolbarStyle}
              onMarkComplete={() =>
                applyToSelection(() => 100, { complete: true })
              }
              onSetPercentage={(pct) => applyToSelection(() => pct)}
              onClearSelection={() => applyToSelection(() => 0)}
              customPct={customPct}
              onCustomPctChange={setCustomPct}
              onApplyCustomPct={() =>
                applyToSelection(() => Number.parseFloat(customPct) || 0)
              }
              showCustomPct={showCustomPct}
              onToggleCustomPct={() => setShowCustomPct((value) => !value)}
            />

            <table className="po-data-table po-cert-grid__table">
              <thead>
                <tr>
                  <th className="po-cert-grid__plot-header po-cert-grid__corner">
                    Plot / House Type
                  </th>
                  {grid.stages.map((stage, stageIndex) => (
                    <th key={stage} className="po-cert-grid__stage-header">
                      <button
                        type="button"
                        className="po-cert-grid__header-btn"
                        onClick={() => selectColumn(stageIndex)}
                      >
                        {stage}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.plotLabel}>
                    <th scope="row" className="po-cert-grid__plot-header">
                      <button
                        type="button"
                        className="po-cert-grid__header-btn"
                        onClick={() => selectRow(row.plotIndex)}
                      >
                        {row.plotLabel}
                      </button>
                    </th>
                    {row.cells.map((cell) => {
                      const presentation = getCellPresentation(cell);
                      return (
                        <ValuationCell
                          key={cell.cellKey}
                          cell={cell}
                          errors={presentation.errors}
                          visualState={presentation.visualState}
                          cellRef={(node) => {
                            if (node) cellRefs.current.set(cell.cellKey, node);
                            else cellRefs.current.delete(cell.cellKey);
                          }}
                          onSelect={(cellKey) => selectSingle(cellKey)}
                          onShiftSelect={(cellKey) => selectRange(cellKey)}
                          onOpenPanel={(cellKey) => openPanel(cellKey)}
                          onMouseDown={handleDragStart}
                          onDragEnter={handleDragEnter}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SelectionStatusBar summary={selectionSummary} />
        </div>

        {panelCell && panelPresentation ? (
          <ValuationDetailPanel
            cell={panelCell}
            editable={editable && panelCell.editable}
            selectionCount={selectedKeys.size}
            displayPct={panelPresentation.displayPct}
            errors={panelPresentation.errors}
            historyDetails={historyDetails}
            auditItems={auditItems}
            onClose={closeDetailPanel}
            onComplete={(cellKey) => {
              const cell = cellMap().get(cellKey);
              if (!cell) return;
              const validation = validateThisCertificatePct(
                cell.previousCumulativePct,
                100,
                { complete: true }
              );
              if (!validation.valid) return;
              onProgressChange?.({
                [cellKey]: { thisCertificatePct: validation.pct },
              });
            }}
            onPctChange={handlePctChange}
            panelInputRef={panelInputRef}
          />
        ) : null}
      </div>
    </div>
  );
}
