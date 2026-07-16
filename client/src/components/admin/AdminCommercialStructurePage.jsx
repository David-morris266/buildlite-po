import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { listPOs } from '../../api';
import {
  buildCommercialStructureKpis,
  buildCommercialStructureTreeModel,
} from '../../admin/costCodeHierarchy';
import {
  addCommercialFamily,
  addCommercialHead,
  addCommercialTrade,
  addHeadLevelReportingGroup,
  archiveCommercialFamily,
  archiveCommercialHead,
  archiveCommercialTrade,
  getCommercialStructure,
  reorderCommercialFamily,
  reorderCommercialHead,
  reorderCommercialTrade,
  updateCommercialFamily,
  updateCommercialHead,
  updateCommercialTrade,
} from '../../admin/commercialStructureStore';
import { listCostCodeMasterRecords } from '../../admin/costCodeMasterStore';
import { getCombinedHierarchyUsage, getHierarchyUsageSummary } from '../../admin/masterDataUsage';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminKpiGrid, AdminStatusBadge } from './adminUi';

const NODE_TYPE_TITLES = {
  head: 'Commercial Head',
  family: 'Commercial Family',
  reportingGroup: 'Reporting Group',
  costCode: 'Cost Code',
};

function TreeNodeIcon({ kind }) {
  if (kind === 'head') {
    return (
      <svg className="admin-tree-node__icon-svg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 3.5h12v2H2zm0 4h8v2H2zm0 4h5v2H2z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'family') {
    return (
      <svg className="admin-tree-node__icon-svg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 3h5.5L9 5.5H14v8.5H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    );
  }
  if (kind === 'reportingGroup') {
    return (
      <svg className="admin-tree-node__icon-svg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 4h5.5L9 6h5v7H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg className="admin-tree-node__icon-svg" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h8v11H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

const UsageBadges = memo(function UsageBadges({ summary }) {
  if (!summary) return null;
  return (
    <div className="admin-usage-badges">
      <span className="admin-usage-chip" title="Cost codes assigned to this node">
        {summary.costCodes} Cost {summary.costCodes === 1 ? 'Code' : 'Codes'}
      </span>
      <span className="admin-usage-chip" title="Live purchase orders referencing this node">
        {summary.purchaseOrders} Purchase {summary.purchaseOrders === 1 ? 'Order' : 'Orders'}
      </span>
      <span className="admin-usage-chip" title="Live CVR cost centres referencing this node">
        {summary.cvrCostCentres} CVR{summary.cvrCostCentres === 1 ? '' : 's'}
      </span>
    </div>
  );
});

function TreeActionGroup({ onUp, onDown, onArchive }) {
  const showReorder = Boolean(onUp && onDown);
  return (
    <div className="admin-tree-actions">
      {showReorder ? (
        <>
          <div className="admin-tree-actions__group">
            <AdminButton variant="ghost" onClick={onUp} aria-label="Move up">↑</AdminButton>
            <AdminButton variant="ghost" onClick={onDown} aria-label="Move down">↓</AdminButton>
          </div>
          <span className="admin-tree-actions__sep" aria-hidden="true">|</span>
        </>
      ) : null}
      <AdminButton variant="danger" onClick={onArchive}>Archive</AdminButton>
    </div>
  );
}

function TreeEmptyState({ message, hint }) {
  return (
    <div className="admin-tree-empty">
      <p className="admin-tree-empty__message">{message}</p>
      {hint ? <p className="admin-tree-empty__hint">{hint}</p> : null}
    </div>
  );
}

const TreeNode = memo(function TreeNode({
  level,
  nodeKind,
  label,
  subtitle,
  summary,
  expanded,
  onToggle,
  children,
  actions,
  editable,
  onLabelChange,
  onBlur,
}) {
  const typeTitle = NODE_TYPE_TITLES[nodeKind];

  return (
    <div className={`admin-tree-node admin-tree-node--level-${level} admin-tree-node--${nodeKind}`}>
      <div className="admin-tree-node__row">
        <button
          type="button"
          className={`admin-tree-node__toggle${expanded ? ' admin-tree-node__toggle--open' : ''}${children ? '' : ' admin-tree-node__toggle--leaf'}`}
          onClick={children ? onToggle : undefined}
          disabled={!children}
          aria-label={children ? (expanded ? 'Collapse' : 'Expand') : undefined}
        >
          {children ? '▸' : ''}
        </button>

        <TreeNodeIcon kind={nodeKind} />

        <div className="admin-tree-node__main">
          {editable ? (
            <input
              className="admin-tree-node__name-input"
              value={label}
              aria-label={typeTitle}
              title={typeTitle}
              onChange={(e) => onLabelChange(e.target.value)}
              onBlur={onBlur}
            />
          ) : (
            <div className="admin-tree-node__name-block">
              <span className="admin-tree-node__name" title={typeTitle}>
                {label}
              </span>
              {subtitle ? <span className="admin-tree-node__subtitle">{subtitle}</span> : null}
            </div>
          )}
        </div>

        <div className="admin-tree-node__meta">
          {summary ? <UsageBadges summary={summary} /> : null}
          {actions ? <div className="admin-tree-node__actions">{actions}</div> : null}
        </div>
      </div>
      {expanded && children ? (
        <div className="admin-tree-node__children admin-tree-expand">{children}</div>
      ) : null}
    </div>
  );
});

const CostCodeLeaves = memo(function CostCodeLeaves({ codes = [] }) {
  if (!codes.length) return null;
  return (
    <div className="admin-tree-leaves">
      {codes.map((code) => (
        <div key={code.id} className="admin-tree-leaf">
          <span className="admin-tree-leaf__spacer" aria-hidden="true" />
          <TreeNodeIcon kind="costCode" />
          <span className="admin-tree-leaf__code">{code.code}</span>
          <span className="admin-tree-leaf__description">{code.description || '—'}</span>
          {!code.active ? (
            <AdminStatusBadge tone="muted">Inactive</AdminStatusBadge>
          ) : null}
        </div>
      ))}
    </div>
  );
});

export default function AdminCommercialStructurePage({ onBack }) {
  const [refresh, setRefresh] = useState(0);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [newHead, setNewHead] = useState('');
  const [newFamilyByHead, setNewFamilyByHead] = useState({});
  const [newGroupByHead, setNewGroupByHead] = useState({});
  const [newTradeByFamily, setNewTradeByFamily] = useState({});

  useEffect(() => {
    listPOs({ pageSize: 500, archived: 'false' })
      .then((data) => setPurchaseOrders(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []))
      .catch(() => setPurchaseOrders([]));
  }, [refresh]);

  const structure = useMemo(() => {
    void refresh;
    return getCommercialStructure();
  }, [refresh]);

  const costCodes = useMemo(() => {
    void refresh;
    return listCostCodeMasterRecords();
  }, [refresh]);

  const treeModel = useMemo(
    () => buildCommercialStructureTreeModel(costCodes, structure),
    [costCodes, structure]
  );

  const kpis = useMemo(
    () => buildCommercialStructureKpis(costCodes, structure),
    [costCodes, structure]
  );

  const usage = useMemo(
    () => getCombinedHierarchyUsage({ purchaseOrders }),
    [purchaseOrders, refresh]
  );

  const showCatalogueNote =
    kpis.catalogueFamilies > kpis.familiesInUse ||
    kpis.catalogueHeads > kpis.headsInUse ||
    kpis.catalogueReportingGroups > kpis.reportingGroupsInUse;

  const reload = useCallback(() => {
    setRefresh((value) => value + 1);
  }, []);

  const toggleExpanded = useCallback((key) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderReportingGroup = useCallback((headName, familyName, group, level) => {
    const groupKey = `group:${headName}:${familyName || ''}:${group.name}`;
    const groupSummary = getHierarchyUsageSummary({
      headName,
      familyName: familyName || '',
      tradeName: group.name,
      usage,
    });
    const codeCount = group.costCodes?.length ?? groupSummary.costCodes ?? 0;
    const tradeId = String(group.id || '').startsWith('derived:') || String(group.id || '').startsWith('head-group:')
      ? null
      : group.id;

    return (
      <TreeNode
        key={groupKey}
        level={level}
        nodeKind="reportingGroup"
        label={group.name}
        subtitle={codeCount > 0 ? `${codeCount} Cost ${codeCount === 1 ? 'Code' : 'Codes'}` : null}
        summary={null}
        expanded={expanded.has(groupKey)}
        onToggle={() => toggleExpanded(groupKey)}
        editable={Boolean(tradeId)}
        onLabelChange={tradeId ? (value) => updateCommercialTrade(tradeId, { name: value }) : undefined}
        onBlur={reload}
        actions={
          tradeId ? (
            <TreeActionGroup
              onArchive={() => {
                const result = archiveCommercialTrade(tradeId, groupSummary.total);
                if (!result.ok) window.alert(result.errors?.[0]);
                reload();
              }}
            />
          ) : null
        }
      >
        {codeCount > 0 ? (
          <CostCodeLeaves codes={group.costCodes} />
        ) : (
          <TreeEmptyState message="No Cost Codes assigned" />
        )}
      </TreeNode>
    );
  }, [expanded, reload, toggleExpanded, usage]);

  return (
    <AdminPageShell
      title="Commercial Cost Structure"
      lead="Manage the commercial cost hierarchy — Heads, Reporting Groups and Cost Codes in use across BuildLite."
      onBack={onBack}
      actions={
        <AdminButton variant="primary" onClick={() => {
          const result = addCommercialHead(newHead);
          if (!result.ok) window.alert(result.errors?.[0]);
          else { setNewHead(''); reload(); }
        }} disabled={!newHead.trim()}>
          Add Head
        </AdminButton>
      }
    >
      <AdminKpiGrid
        items={[
          {
            label: 'Commercial Heads',
            value: kpis.heads.activeLabel,
            valueSuffix: kpis.heads.suffix,
            secondaryHint: kpis.heads.availableLabel,
          },
          {
            label: 'Commercial Families',
            value: kpis.families.activeLabel,
            valueSuffix: kpis.families.suffix,
            secondaryHint: kpis.families.availableLabel,
          },
          {
            label: 'Reporting Groups',
            value: kpis.reportingGroups.activeLabel,
            valueSuffix: kpis.reportingGroups.suffix,
            secondaryHint: kpis.reportingGroups.availableLabel,
          },
          {
            label: 'Cost Codes',
            value: kpis.costCodesKpi.activeLabel,
            valueSuffix: kpis.costCodesKpi.suffix,
          },
        ]}
      />

      {showCatalogueNote ? (
        <p className="admin-structure-catalogue-note">
          Additional BuildLite catalogue items remain available for legacy and three-level structures.
          Only your active cost hierarchy is shown below.
        </p>
      ) : null}

      <section className="po-module-card admin-structure-panel">
        <div className="admin-structure-toolbar">
          <input
            className="input"
            placeholder="New Commercial Head"
            value={newHead}
            onChange={(e) => setNewHead(e.target.value)}
          />
        </div>

        <div className="admin-hierarchy-tree">
          {treeModel.length === 0 ? (
            <TreeEmptyState
              message="No commercial cost structure in use yet."
              hint="Import cost codes or add a Commercial Head to begin."
            />
          ) : null}

          {treeModel.map((head) => {
            const headKey = `head:${head.id}`;
            const headSummary = getHierarchyUsageSummary({ headName: head.name, usage });
            const headEntity = structure.heads.find((item) => item.id === head.id || item.name === head.name);
            const headId = headEntity?.id;
            const headHasContent = head.reportingGroups.length > 0 || head.families.length > 0;

            return (
              <TreeNode
                key={head.id}
                level={0}
                nodeKind="head"
                label={head.name}
                summary={headSummary}
                expanded={expanded.has(headKey)}
                onToggle={() => toggleExpanded(headKey)}
                editable={Boolean(headId)}
                onLabelChange={headId ? (value) => updateCommercialHead(headId, { name: value }) : undefined}
                onBlur={reload}
                actions={
                  headId ? (
                    <TreeActionGroup
                      onUp={() => { reorderCommercialHead(headId, 'up'); reload(); }}
                      onDown={() => { reorderCommercialHead(headId, 'down'); reload(); }}
                      onArchive={() => {
                        const result = archiveCommercialHead(headId, headSummary.total);
                        if (!result.ok) window.alert(result.errors?.[0]);
                        reload();
                      }}
                    />
                  ) : null
                }
              >
                {headHasContent ? (
                  <>
                    {head.reportingGroups.map((group) => renderReportingGroup(head.name, '', group, 1))}

                    {head.families.map((family) => {
                      const familyKey = `family:${family.id}`;
                      const familySummary = getHierarchyUsageSummary({
                        headName: head.name,
                        familyName: family.name,
                        usage,
                      });
                      const familyEntity = structure.families.find((item) => item.id === family.id);
                      const familyId = familyEntity?.id;

                      return (
                        <TreeNode
                          key={family.id}
                          level={1}
                          nodeKind="family"
                          label={family.name}
                          summary={familySummary}
                          expanded={expanded.has(familyKey)}
                          onToggle={() => toggleExpanded(familyKey)}
                          editable={Boolean(familyId)}
                          onLabelChange={familyId ? (value) => updateCommercialFamily(familyId, { name: value }) : undefined}
                          onBlur={reload}
                          actions={
                            familyId ? (
                              <TreeActionGroup
                                onUp={() => { reorderCommercialFamily(headId, familyId, 'up'); reload(); }}
                                onDown={() => { reorderCommercialFamily(headId, familyId, 'down'); reload(); }}
                                onArchive={() => {
                                  const result = archiveCommercialFamily(familyId, familySummary.total);
                                  if (!result.ok) window.alert(result.errors?.[0]);
                                  reload();
                                }}
                              />
                            ) : null
                          }
                        >
                          {family.reportingGroups.length > 0 ? (
                            family.reportingGroups.map((group) =>
                              renderReportingGroup(head.name, family.name, group, 2)
                            )
                          ) : (
                            <TreeEmptyState message="No Reporting Groups yet" hint="Import cost codes or create one manually." />
                          )}

                          {familyId ? (
                            <div className="admin-tree-add">
                              <input
                                className="input"
                                placeholder="New Reporting Group"
                                value={newTradeByFamily[familyId] || ''}
                                onChange={(e) => setNewTradeByFamily((prev) => ({ ...prev, [familyId]: e.target.value }))}
                              />
                              <AdminButton variant="secondary" onClick={() => {
                                const result = addCommercialTrade(familyId, newTradeByFamily[familyId]);
                                if (!result.ok) window.alert(result.errors?.[0]);
                                setNewTradeByFamily((prev) => ({ ...prev, [familyId]: '' }));
                                reload();
                              }}>Add Reporting Group</AdminButton>
                            </div>
                          ) : null}
                        </TreeNode>
                      );
                    })}
                  </>
                ) : (
                  <TreeEmptyState
                    message="No Reporting Groups yet"
                    hint="Import cost codes or create one manually."
                  />
                )}

                {headId ? (
                  <>
                    <div className="admin-tree-add">
                      <input
                        className="input"
                        placeholder="New Reporting Group"
                        value={newGroupByHead[headId] || ''}
                        onChange={(e) => setNewGroupByHead((prev) => ({ ...prev, [headId]: e.target.value }))}
                      />
                      <AdminButton variant="secondary" onClick={() => {
                        const result = addHeadLevelReportingGroup(headId, newGroupByHead[headId]);
                        if (!result.ok) window.alert(result.errors?.[0]);
                        setNewGroupByHead((prev) => ({ ...prev, [headId]: '' }));
                        reload();
                      }}>Add Reporting Group</AdminButton>
                    </div>
                    <div className="admin-tree-add">
                      <input
                        className="input"
                        placeholder="New Commercial Family"
                        value={newFamilyByHead[headId] || ''}
                        onChange={(e) => setNewFamilyByHead((prev) => ({ ...prev, [headId]: e.target.value }))}
                      />
                      <AdminButton variant="secondary" onClick={() => {
                        const result = addCommercialFamily(headId, newFamilyByHead[headId]);
                        if (!result.ok) window.alert(result.errors?.[0]);
                        setNewFamilyByHead((prev) => ({ ...prev, [headId]: '' }));
                        reload();
                      }}>Add Family</AdminButton>
                    </div>
                  </>
                ) : null}
              </TreeNode>
            );
          })}
        </div>
      </section>
    </AdminPageShell>
  );
}
