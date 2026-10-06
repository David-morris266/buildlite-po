/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  localCreate: vi.fn(),
  markStale: vi.fn(),
  refreshReadiness: vi.fn(),
}));
vi.mock("../../auth/BuildLiteAuthProvider", () => ({
  useBuildLitePrincipal: () => ({
    markTenantReadinessStale: mocks.markStale,
    refreshTenantReadiness: mocks.refreshReadiness,
  }),
}));
vi.mock("../../admin/costCodeAuthority", () => ({
  isCostCodeServerAuthorityEnabled: () => true,
}));
vi.mock("../../admin/costCodeAdminService", () => ({
  ensureAdminCostCodesReady: vi.fn(async () => {}),
  listAdminCostCodeRecords: () => [],
}));
vi.mock("../costCodeImportService", () => ({
  HIERARCHY_MODE_TWO_LEVEL: "two-level",
  HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY: "three-level-default-family",
  detectImportHierarchyMapping: () => ({
    hasCommercialHead: true,
    commercialFamilyAbsent: true,
  }),
  inferDefaultHierarchyMode: () => "two-level",
  parseCostCodeImportFile: vi.fn(async () => ({
    fileName: "codes.csv",
    headerRowIndex: 0,
    headers: ["Code", "Description", "Head", "Group"],
    rows: [
      ["Code", "Description", "Head", "Group"],
      ["A", "Alpha", "Existing", "Existing Group"],
      ["B", "Beta", "", ""],
      ["C", "Gamma", "New Head", "New Group"],
    ],
    fieldByColumn: [
      "costCode",
      "description",
      "commercialHead",
      "reportingGroup",
    ],
    defaultHierarchyMode: "two-level",
  })),
  buildAuthoritativeImportRows: () => [
    {
      rowNumber: 2,
      code: "A",
      description: "Alpha",
      commercialHead: "Existing",
      commercialFamily: "",
      reportingGroup: "Existing Group",
    },
    {
      rowNumber: 3,
      code: "B",
      description: "Beta",
      commercialHead: "",
      commercialFamily: "",
      reportingGroup: "",
    },
    {
      rowNumber: 4,
      code: "C",
      description: "Gamma",
      commercialHead: "New Head",
      commercialFamily: "",
      reportingGroup: "New Group",
    },
  ],
  previewAuthoritativeCostCodeImport: mocks.preview,
  applyAuthoritativeCostCodeImport: mocks.apply,
  executeCostCodeImport: mocks.localCreate,
  validateCostCodeImport: () => ({}),
}));
import SetupCostCodeImportWizard from "./SetupCostCodeImportWizard";

const matched = {
  state: "MATCHED",
  labels: {
    commercialHead: "Existing",
    commercialFamily: "",
    reportingGroup: "Existing Group",
  },
};
const unallocated = {
  state: "UNALLOCATED",
  labels: { commercialHead: "", commercialFamily: "", reportingGroup: "" },
};
const proposed = {
  state: "NEW_STRUCTURE_REQUIRED",
  proposal: {
    commercialHead: "New Head",
    commercialFamily: "",
    reportingGroup: "New Group",
  },
};
const previewDocument = {
  catalogueRevision: "rev",
  reviewToken: "signed-review",
  rows: [
    { rowNumber: 2, code: "A", description: "Alpha", resolution: matched },
    { rowNumber: 3, code: "B", description: "Beta", resolution: unallocated },
    { rowNumber: 4, code: "C", description: "Gamma", resolution: proposed },
  ],
  proposals: [
    {
      key: "new",
      commercialHead: "New Head",
      commercialFamily: "",
      reportingGroup: "New Group",
      costCodes: ["C"],
    },
  ],
  summary: { blocked: 0 },
};
let container, root;
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const button = (text) =>
  [...container.querySelectorAll("button")].find((node) =>
    node.textContent.includes(text),
  );
async function reachReview() {
  const input = container.querySelector("input[type=file]");
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "codes.csv", { type: "text/csv" })],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  act(() => button("Continue to mapping").click());
  await act(async () => button("Validate import").click());
  await settle();
}

describe("authoritative Cost Code import wizard", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.preview
      .mockReset()
      .mockResolvedValue({ ok: true, preview: previewDocument });
    mocks.apply
      .mockReset()
      .mockResolvedValue({
        ok: true,
        rowsRead: 3,
        imported: 2,
        updated: 1,
        rejected: 0,
        headsCreated: 1,
        headsMatched: 1,
        familiesCreated: 0,
        familiesMatched: 0,
        reportingGroupsCreated: 1,
        reportingGroupsMatched: 1,
        warnings: [],
        skipped: 0,
        hierarchyModeLabel: "Reviewed tenant structure",
      });
    mocks.localCreate.mockReset();
    mocks.markStale.mockReset();
    mocks.refreshReadiness
      .mockReset()
      .mockResolvedValue({ counts: { activeCostCodes: 59 } });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("reviews matched, unallocated and two-level proposed structure before atomic Apply", async () => {
    await act(async () => root.render(<SetupCostCodeImportWizard />));
    await reachReview();
    expect(container.textContent).toContain("MATCHED");
    expect(container.textContent).toContain("UNALLOCATED");
    expect(container.textContent).toContain("NEW STRUCTURE REQUIRED");
    expect(container.textContent).toContain(
      "Proposed new Commercial Structure",
    );
    expect(container.textContent).toContain("New Head → New Group");
    expect(mocks.apply).not.toHaveBeenCalled();
    act(() => button("Continue to import").click());
    expect(mocks.apply).not.toHaveBeenCalled();
    await act(async () => button("Import cost codes").click());
    await settle();
    expect(mocks.apply).toHaveBeenCalledWith(
      previewDocument,
      expect.any(Array),
    );
    expect(container.textContent).toContain("2 Cost Codes imported successfully");
    expect(container.textContent).toContain("Import details");
    expect(mocks.localCreate).not.toHaveBeenCalled();
  });
  it.each(["INVALID", "AMBIGUOUS", "ARCHIVED_MATCH"])(
    "%s blocks Apply and exposes the reason",
    async (state) => {
      mocks.preview.mockResolvedValue({
        ok: true,
        preview: {
          ...previewDocument,
          rows: [
            {
              rowNumber: 2,
              code: "A",
              description: "Alpha",
              resolution: { state, reason: `${state} reason` },
            },
          ],
          proposals: [],
          summary: { blocked: 1 },
        },
      });
      await act(async () => root.render(<SetupCostCodeImportWizard />));
      await reachReview();
      expect(container.textContent).toContain(`${state} reason`);
      expect(button("Continue to import").disabled).toBe(true);
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );
  it("converges readiness only after a successful authoritative import", async () => {
    await act(async () => root.render(<SetupCostCodeImportWizard />));
    await reachReview();
    act(() => button("Continue to import").click());
    await act(async () => button("Import cost codes").click());
    await settle();
    expect(mocks.markStale).toHaveBeenCalledOnce();
    expect(mocks.refreshReadiness).toHaveBeenCalledOnce();
    expect(mocks.markStale.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshReadiness.mock.invocationCallOrder[0],
    );
  });
  it("does not advance readiness when import fails", async () => {
    mocks.apply.mockRejectedValue(new Error("Import failed"));
    await act(async () => root.render(<SetupCostCodeImportWizard />));
    await reachReview();
    act(() => button("Continue to import").click());
    await act(async () => button("Import cost codes").click());
    await settle();
    expect(mocks.markStale).not.toHaveBeenCalled();
    expect(mocks.refreshReadiness).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Cost Codes imported successfully");
  });
  it("keeps committed import success explicit when readiness refresh fails", async () => {
    mocks.refreshReadiness.mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<SetupCostCodeImportWizard />));
    await reachReview();
    act(() => button("Continue to import").click());
    await act(async () => button("Import cost codes").click());
    await settle();
    expect(container.textContent).toContain("2 Cost Codes imported successfully");
    expect(container.textContent).toContain(
      "Cost Codes were imported, but company readiness could not be refreshed",
    );
  });
  it("offers hierarchy review as the primary successful continuation without another readiness request", async () => {
    const review = vi.fn(); const complete = vi.fn();
    await act(async () => root.render(<SetupCostCodeImportWizard onReviewCostCodeHierarchy={review} onComplete={complete} />));
    await reachReview(); act(() => button("Continue to import").click()); await act(async () => button("Import cost codes").click()); await settle();
    expect(button("Review Cost Code hierarchy")).toBeTruthy(); expect(button("Back to Setup & Data Import")).toBeTruthy();
    act(() => button("Review Cost Code hierarchy").click()); expect(review).toHaveBeenCalledOnce(); expect(complete).not.toHaveBeenCalled(); expect(mocks.refreshReadiness).toHaveBeenCalledOnce();
  });
  it("Cancel and Preview do not apply or create browser-local structure", async () => {
    await act(async () =>
      root.render(<SetupCostCodeImportWizard onCancel={vi.fn()} />),
    );
    await reachReview();
    expect(mocks.preview).toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.localCreate).not.toHaveBeenCalled();
  });
});
