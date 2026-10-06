import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addStructureNode,
  adoptRecommendedStructure,
  loadCommercialHeadCategories,
  loadCommercialStructure,
  loadRecommendedCommercialStructureTemplate,
  reorderStructureNodes,
  saveCommercialHeadCategory,
  saveStructureNode,
} from "../../admin/commercialStructureService";
import {
  ensureAdminCostCodesReady,
  listAdminCostCodeRecords,
} from "../../admin/costCodeAdminService";
import { useBuildLitePermission } from "../../auth/BuildLiteAuthProvider";
import AdminPageShell from "./AdminPageShell";
import { AdminButton, AdminKpiGrid, AdminStatusBadge } from "./adminUi";
const types = {
  head: "Commercial Head",
  family: "Commercial Family",
  reporting_group: "Reporting Group",
};
function siblings(catalogue, type, node) {
  const rows =
    type === "head"
      ? catalogue.heads
      : type === "family"
        ? catalogue.families
        : catalogue.reportingGroups;
  return rows
    .filter(
      (x) =>
        type === "head" ||
        (x.headId === node.headId &&
          (type === "family" ||
            (x.familyId || null) === (node.familyId || null))),
    )
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
}
function Node({ type, node, children, onRename, onToggle, onMove }) {
  const [name, setName] = useState(node.name);
  useEffect(() => setName(node.name), [node.name]);
  return (
    <div className={`admin-tree-node admin-tree-node--${type}`}>
      <div className="admin-tree-node__row">
        <input
          className="admin-tree-node__name-input"
          aria-label={types[type]}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== node.name && onRename(name.trim())}
        />
        {!node.active ? (
          <AdminStatusBadge tone="muted">Archived</AdminStatusBadge>
        ) : null}
        <div className="admin-tree-actions">
          <AdminButton
            variant="ghost"
            aria-label="Move up"
            onClick={() => onMove(-1)}
          >
            ↑
          </AdminButton>
          <AdminButton
            variant="ghost"
            aria-label="Move down"
            onClick={() => onMove(1)}
          >
            ↓
          </AdminButton>
          <AdminButton
            variant={node.active ? "danger" : "secondary"}
            onClick={onToggle}
          >
            {node.active ? "Archive" : "Restore"}
          </AdminButton>
        </div>
      </div>
      {children ? (
        <div className="admin-tree-node__children">{children}</div>
      ) : null}
    </div>
  );
}
export default function AdminCommercialStructurePage({
  onBack,
  onReviewCostCodeHierarchy,
}) {
  const canManageCategories = useBuildLitePermission(
    "commercial_head_categories.manage",
  );
  const canManageStructure = useBuildLitePermission(
    "commercial_structure.manage",
  );
  const [catalogue, setCatalogue] = useState(null),
    [categories, setCategories] = useState([]),
    [recommendedTemplate, setRecommendedTemplate] = useState(null),
    [categoryDrafts, setCategoryDrafts] = useState({}),
    [codes, setCodes] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [newHead, setNewHead] = useState(""),
    [newFamily, setNewFamily] = useState({}),
    [newGroup, setNewGroup] = useState({}),
    [confirmAdoption, setConfirmAdoption] = useState(false),
    [adoptionResult, setAdoptionResult] = useState(null);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [structure, availableCategories, recommended] = await Promise.all([
        loadCommercialStructure(),
        loadCommercialHeadCategories(),
        loadRecommendedCommercialStructureTemplate(),
        ensureAdminCostCodesReady(),
      ]);
      setCatalogue(structure);
      setCategories(availableCategories);
      setRecommendedTemplate(recommended);
      setCategoryDrafts(
        Object.fromEntries(
          structure.heads.map((head) => [
            head.id,
            head.buildliteCategory || "",
          ]),
        ),
      );
      setCodes(listAdminCostCodeRecords() || []);
    } catch (e) {
      setError(e.message || "Could not load Commercial Structure.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  const counts = useMemo(
    () => ({
      heads: catalogue?.heads.filter((x) => x.active).length || 0,
      families: catalogue?.families.filter((x) => x.active).length || 0,
      groups: catalogue?.reportingGroups.filter((x) => x.active).length || 0,
      codes: codes.length,
    }),
    [catalogue, codes],
  );
  async function mutate(work) {
    setBusy(true);
    setError("");
    try {
      await work();
      await reload();
    } catch (e) {
      setError(
        e.status === 409
          ? "Commercial Structure changed. It has been reloaded; review and try again."
          : e.message || "Could not save Commercial Structure.",
      );
      setBusy(false);
    }
  }
  const add = (type, payload, clear) =>
    mutate(async () => {
      await addStructureNode(type, payload);
      clear();
    });
  const update = (type, node, patch) =>
    mutate(() => saveStructureNode(type, node, patch));
  const move = (type, node, direction) => {
    const rows = siblings(catalogue, type, node),
      i = rows.findIndex((x) => x.id === node.id),
      j = i + direction;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    mutate(() => reorderStructureNodes(type, rows));
  };
  async function adoptRecommended() {
    setBusy(true);
    setError("");
    try {
      const result = await adoptRecommendedStructure();
      setAdoptionResult(result);
      setConfirmAdoption(false);
      await reload();
    } catch (e) {
      setError(
        e.message || "Could not adopt the recommended Commercial Structure.",
      );
      setBusy(false);
    }
  }
  const categoryEditor = (head) => {
    const draft = categoryDrafts[head.id] ?? head.buildliteCategory ?? "",
      dirty = draft !== (head.buildliteCategory || "");
    return (
      <div className="admin-tree-category">
        <label>
          <span>BuildLite category</span>
          <select
            aria-label={`${head.name} BuildLite category`}
            value={draft}
            disabled={!canManageCategories || !head.active || busy}
            onChange={(event) =>
              setCategoryDrafts((value) => ({
                ...value,
                [head.id]: event.target.value,
              }))
            }
          >
            <option value="">Not set</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        {head.buildliteCategory ? (
          <AdminStatusBadge tone="success">Categorised</AdminStatusBadge>
        ) : (
          <AdminStatusBadge tone="muted">Needs review</AdminStatusBadge>
        )}
        {canManageCategories ? (
          <AdminButton
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() =>
              mutate(() => saveCommercialHeadCategory(head, draft))
            }
          >
            Save category
          </AdminButton>
        ) : null}
      </div>
    );
  };
  if (!catalogue)
    return (
      <AdminPageShell title="Commercial Cost Structure" onBack={onBack}>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p>Loading company Commercial Structure…</p>
        )}
      </AdminPageShell>
    );
  const groups = (headId, familyId = null) =>
    catalogue.reportingGroups
      .filter(
        (x) =>
          x.headId === headId && (x.familyId || null) === (familyId || null),
      )
      .sort((a, b) => a.displayOrder - b.displayOrder);
  const renderGroup = (g) => (
    <Node
      key={g.id}
      type="reporting_group"
      node={g}
      onRename={(name) => update("reporting_group", g, { name })}
      onToggle={() => update("reporting_group", g, { active: !g.active })}
      onMove={(d) => move("reporting_group", g, d)}
    />
  );
  return (
    <AdminPageShell
      title="Commercial Cost Structure"
      lead="Manage the tenant-owned hierarchy used by Cost Codes."
      onBack={onBack}
      actions={
        <AdminButton
          loading={busy}
          disabled={!newHead.trim()}
          onClick={() => add("head", { name: newHead }, () => setNewHead(""))}
        >
          Add Head
        </AdminButton>
      }
    >
      {adoptionResult ? (
        <section className="po-module-card" role="status">
          <h2>Recommended structure created</h2>
          <p>
            {adoptionResult.created.heads} Commercial Heads created. Customer
            Cost Codes were not replaced, renumbered or mapped.
          </p>
          <p>Next, review each customer Cost Code against this structure.</p>
          {onReviewCostCodeHierarchy ? (
            <AdminButton onClick={onReviewCostCodeHierarchy}>
              Review Cost Code hierarchy
            </AdminButton>
          ) : null}
        </section>
      ) : null}
      {counts.heads === 0 && recommendedTemplate ? (
        <section
          className="po-module-card"
          aria-label="Recommended Commercial Structure adoption"
        >
          <h2>Use BuildLite recommended structure</h2>
          <p>
            Create the recommended commercial reporting Heads and controlled
            categories. This does not replace or renumber customer Cost Codes,
            and every Cost Code will still need to be reviewed and mapped.
          </p>
          {!confirmAdoption ? (
            <AdminButton
              disabled={!canManageStructure || busy}
              onClick={() => setConfirmAdoption(true)}
            >
              Use BuildLite recommended structure
            </AdminButton>
          ) : (
            <div className="admin-inline-warning">
              <p>
                <strong>Confirm recommended structure</strong>
              </p>
              <p>
                Create these reporting Heads now? Customer Cost Codes will
                remain unchanged and unallocated until reviewed.
              </p>
              <AdminButton
                variant="secondary"
                onClick={() => setConfirmAdoption(false)}
              >
                Cancel
              </AdminButton>
              <AdminButton loading={busy} onClick={adoptRecommended}>
                Create recommended structure
              </AdminButton>
            </div>
          )}
        </section>
      ) : null}
      <AdminKpiGrid
        items={[
          { label: "Commercial Heads", value: String(counts.heads) },
          { label: "Commercial Families", value: String(counts.families) },
          { label: "Reporting Groups", value: String(counts.groups) },
          { label: "Cost Codes", value: String(counts.codes) },
        ]}
      />
      <p className="admin-inline-warning">
        BuildLite categories support future workflow discovery. Changing a
        category does not move Cost Codes or rewrite CVRs, templates, forecasts
        or historic evidence.
      </p>
      {error ? (
        <p className="admin-inline-warning" role="alert">
          {error}
        </p>
      ) : null}
      <details className="po-module-card">
        <summary>BuildLite recommended structure preview</summary>
        <p>{recommendedTemplate?.name}</p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Commercial Head</th><th>BuildLite category</th></tr></thead>
            <tbody>{recommendedTemplate?.heads?.map((head) => (
              <tr key={head.buildliteCategory}><td><strong>{head.name}</strong></td><td>{categories.find((category) => category.key === head.buildliteCategory)?.label || head.buildliteCategory}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
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
          {catalogue.heads
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((h) => (
              <Node
                key={h.id}
                type="head"
                node={h}
                onRename={(name) => update("head", h, { name })}
                onToggle={() => update("head", h, { active: !h.active })}
                onMove={(d) => move("head", h, d)}
              >
                {categoryEditor(h)}
                {groups(h.id).map(renderGroup)}
                {catalogue.families
                  .filter((f) => f.headId === h.id)
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((f) => (
                    <Node
                      key={f.id}
                      type="family"
                      node={f}
                      onRename={(name) => update("family", f, { name })}
                      onToggle={() =>
                        update("family", f, { active: !f.active })
                      }
                      onMove={(d) => move("family", f, d)}
                    >
                      {groups(h.id, f.id).map(renderGroup)}
                      <div className="admin-tree-add">
                        <input
                          className="input"
                          placeholder="New Reporting Group"
                          value={newGroup[f.id] || ""}
                          onChange={(e) =>
                            setNewGroup((x) => ({
                              ...x,
                              [f.id]: e.target.value,
                            }))
                          }
                        />
                        <AdminButton
                          onClick={() =>
                            add(
                              "reporting_group",
                              {
                                name: newGroup[f.id],
                                headId: h.id,
                                familyId: f.id,
                              },
                              () => setNewGroup((x) => ({ ...x, [f.id]: "" })),
                            )
                          }
                        >
                          Add Reporting Group
                        </AdminButton>
                      </div>
                    </Node>
                  ))}
                <div className="admin-tree-add">
                  <input
                    className="input"
                    placeholder="New Reporting Group"
                    value={newGroup[h.id] || ""}
                    onChange={(e) =>
                      setNewGroup((x) => ({ ...x, [h.id]: e.target.value }))
                    }
                  />
                  <AdminButton
                    onClick={() =>
                      add(
                        "reporting_group",
                        { name: newGroup[h.id], headId: h.id },
                        () => setNewGroup((x) => ({ ...x, [h.id]: "" })),
                      )
                    }
                  >
                    Add Reporting Group
                  </AdminButton>
                </div>
                <div className="admin-tree-add">
                  <input
                    className="input"
                    placeholder="New Commercial Family"
                    value={newFamily[h.id] || ""}
                    onChange={(e) =>
                      setNewFamily((x) => ({ ...x, [h.id]: e.target.value }))
                    }
                  />
                  <AdminButton
                    onClick={() =>
                      add(
                        "family",
                        { name: newFamily[h.id], headId: h.id },
                        () => setNewFamily((x) => ({ ...x, [h.id]: "" })),
                      )
                    }
                  >
                    Add Family
                  </AdminButton>
                </div>
              </Node>
            ))}
        </div>
      </section>
    </AdminPageShell>
  );
}
