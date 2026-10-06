/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminCostCodeHierarchySetup from "./AdminCostCodeHierarchySetup";
import AdminCompanyReadinessPage from "./AdminCompanyReadinessPage";
import { bulkUpdateCostCodeHierarchyOnServer } from "../../admin/costCodeServerMutations";
import { getCostCodeOnboardingSummary } from "../../api/costCodes";
import {
  invalidateCostCodes,
  refreshCostCodes,
} from "../../admin/costCodeServerCache";
const auth = vi.hoisted(() => ({ principal: null, markStale: vi.fn(), refreshReadiness: vi.fn() }));
const H = "11111111-1111-4111-8111-111111111110",
  G = "11111111-1111-4111-8111-111111111120",
  C = "11111111-1111-4111-8111-111111111111";
const catalogue = {
  heads: [
    { id: H, name: "Land", active: true, version: 1, displayOrder: 0 },
    {
      id: "custom",
      name: "Tenant Custom",
      active: true,
      version: 1,
      displayOrder: 1,
    },
  ],
  families: [],
  reportingGroups: [
    {
      id: G,
      headId: H,
      familyId: null,
      name: "Land Cost",
      active: true,
      version: 1,
      displayOrder: 0,
    },
  ],
  adoptionIssues: [],
};
vi.mock("../../admin/costCodeServerMutations", () => ({
  bulkUpdateCostCodeHierarchyOnServer: vi.fn(),
}));
vi.mock("../../api/costCodes", () => ({
  getCostCodeOnboardingSummary: vi.fn(),
  getCostCodeHierarchyWorksheet: vi.fn(),
  previewCostCodeHierarchyWorksheet: vi.fn(),
  applyCostCodeHierarchyWorksheet: vi.fn(),
}));
vi.mock("../../admin/costCodeServerCache", () => ({
  invalidateCostCodes: vi.fn(),
  refreshCostCodes: vi.fn(),
}));
vi.mock("../../auth/BuildLiteAuthProvider", () => ({
  useBuildLitePrincipal: () => auth.principal,
}));
vi.mock("../../admin/commercialStructureService", async () => {
  const actual = await vi.importActual(
    "../../admin/commercialStructureService",
  );
  return { ...actual, loadCommercialStructure: vi.fn(async () => catalogue) };
});
const records = [
  {
    id: C,
    version: 2,
    code: "1100",
    description: "Land Cost",
    commercialHeadId: null,
    commercialFamilyId: null,
    reportingGroupId: null,
    hierarchyReviewState: "not_reviewed",
    legacy: { subHeading: "Land", trade: "Land", element: "Land purchase" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    version: 4,
    code: "4120",
    description: "Brickwork",
    hierarchyReviewState: "not_reviewed",
    legacy: {
      subHeading: "Super-Structure",
      trade: "Sub-Con",
      element: "Brickwork",
    },
  },
];
let container, root;
const click = (n) => act(() => n.click());
const button = (t) =>
  [...container.querySelectorAll("button")].find((n) =>
    n.textContent.includes(t),
  );
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
describe("server-authoritative Cost Code hierarchy setup", () => {
  beforeEach(() => {
    auth.principal = {
      activeTenant: { clientId: "pilot", name: "BuildLite Pilot Company" },
      tenantReadiness: { tenant: { name: "BuildLite Pilot Company" }, counts: { activeCostCodes: 2, allocatedCostCodes: 0, notReviewedCostCodes: 2, activeHeads: 2 } },
      readinessFreshness: { state: "fresh", clientId: "pilot", hasAuthoritativeData: true },
      markTenantReadinessStale: auth.markStale,
      refreshTenantReadiness: auth.refreshReadiness,
    };
    auth.markStale.mockImplementation(() => { auth.principal.readinessFreshness = { state: "stale", clientId: "pilot", hasAuthoritativeData: false }; });
    auth.refreshReadiness.mockResolvedValue({});
    getCostCodeOnboardingSummary.mockResolvedValue({
      total: 2,
      allocated: 0,
      notReviewed: 2,
      notApplicable: 0,
      needsAttention: 0,
    });
    refreshCostCodes.mockResolvedValue(records);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });
  it("resolves tenant Land IDs and applies only after review", async () => {
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({
      ok: true,
      costCodes: [],
    });
    await act(async () =>
      root.render(<AdminCostCodeHierarchySetup records={records} />),
    );
    await settle();
    expect(container.textContent).toContain("Suggested Commercial Head: Land");
    click(button("Use suggestion"));
    expect(container.textContent).toContain("Added to review");
    click(button("Review 1"));
    click(button("Apply hierarchy"));
    await settle();
    expect(bulkUpdateCostCodeHierarchyOnServer).toHaveBeenCalledWith([
      {
        id: C,
        version: 2,
        commercialHeadId: H,
        commercialFamilyId: null,
        reportingGroupId: G,
        reviewDisposition: null,
      },
    ]);
  });
  it("offers custom tenant heads and clearing sends null IDs", async () => {
    await act(async () =>
      root.render(<AdminCostCodeHierarchySetup records={records} />),
    );
    await settle();
    expect(
      container.querySelector('[aria-label="Bulk Commercial Head"]')
        .textContent,
    ).toContain("Tenant Custom");
    expect(
      container.querySelector('[aria-label="1100 Commercial Head"]')
        .textContent,
    ).toContain("Land");
  });
  it("allows an individual Head-only allocation when no Reporting Groups exist", async () => {
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({
      ok: true,
      costCodes: [],
    });
    await act(async () =>
      root.render(<AdminCostCodeHierarchySetup records={records} />),
    );
    await settle();
    const head = container.querySelector('[aria-label="4120 Commercial Head"]');
    await act(async () => {
      head.value = "custom";
      head.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector('[aria-label="4120 Reporting Group"]')
        .textContent,
    ).toContain("No reporting group");
    click(button("Review 1"));
    click(button("Apply hierarchy"));
    await settle();
    expect(bulkUpdateCostCodeHierarchyOnServer).toHaveBeenCalledWith([
      {
        id: records[1].id,
        version: 4,
        commercialHeadId: "custom",
        commercialFamilyId: null,
        reportingGroupId: null,
        reviewDisposition: null,
      },
    ]);
  });
  it("stays in the hierarchy workflow and reloads authoritative records and readiness after apply", async () => {
    const refreshed = [
      {
        ...records[1],
        version: 5,
        commercialHeadId: "custom",
        commercialHead: "Tenant Custom",
        hierarchyReviewState: "allocated",
      },
    ];
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({
      ok: true,
      costCodes: refreshed,
    });
    refreshCostCodes.mockResolvedValue(refreshed);
    getCostCodeOnboardingSummary
      .mockResolvedValueOnce({
        total: 2,
        allocated: 0,
        notReviewed: 2,
        notApplicable: 0,
        needsAttention: 0,
      })
      .mockResolvedValueOnce({
        total: 2,
        allocated: 1,
        notReviewed: 1,
        notApplicable: 0,
        needsAttention: 0,
      });
    const onApplied = vi.fn();
    await act(async () =>
      root.render(
        <AdminCostCodeHierarchySetup records={records} onApplied={onApplied} />,
      ),
    );
    await settle();
    const head = container.querySelector('[aria-label="4120 Commercial Head"]');
    await act(async () => {
      head.value = "custom";
      head.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button("Review 1"));
    click(button("Apply hierarchy"));
    await settle();
    expect(invalidateCostCodes).toHaveBeenCalledOnce();
    expect(refreshCostCodes).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith(refreshed);
    expect(auth.markStale).toHaveBeenCalledOnce();
    expect(auth.refreshReadiness).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Hierarchy applied. 1 Cost Codes updated.",
    );
    expect(container.textContent).toContain(
      "2 active · 1 Allocated · 1 Not reviewed",
    );
    expect(container.textContent).toContain("Cost Code Commercial Hierarchy");
  });
  it("does not invalidate readiness when hierarchy application is rejected", async () => {
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({ ok: false, errors: ["Rejected"] });
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} />));
    await settle();
    const head = container.querySelector('[aria-label="4120 Commercial Head"]');
    await act(async () => { head.value = "custom"; head.dispatchEvent(new Event("change", { bubbles: true })); });
    click(button("Review 1")); click(button("Apply hierarchy")); await settle();
    expect(container.textContent).toContain("Rejected");
    expect(auth.markStale).not.toHaveBeenCalled();
    expect(auth.refreshReadiness).not.toHaveBeenCalled();
  });
  it("keeps a committed hierarchy successful and readiness stale when convergence fails", async () => {
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({ ok: true, costCodes: [records[1]] });
    auth.refreshReadiness.mockRejectedValue(new Error("Unavailable"));
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} />));
    await settle();
    const head = container.querySelector('[aria-label="4120 Commercial Head"]');
    await act(async () => { head.value = "custom"; head.dispatchEvent(new Event("change", { bubbles: true })); });
    click(button("Review 1")); click(button("Apply hierarchy")); await settle();
    expect(container.textContent).toContain("Hierarchy applied. 1 Cost Codes updated.");
    expect(container.textContent).toContain("Company Readiness could not be refreshed");
    expect(auth.markStale).toHaveBeenCalledTimes(2);
  });
  it("converges the production-shaped 5/54 principal before Company Readiness is opened", async () => {
    const unreviewed = Array.from({ length: 54 }, (_, index) => ({ id: `review-${index}`, version: 1, code: `2${String(index).padStart(3, "0")}`, description: `Review ${index}`, hierarchyReviewState: "not_reviewed" }));
    const allocated = Array.from({ length: 5 }, (_, index) => ({ id: `allocated-${index}`, version: 1, code: `1${String(index).padStart(3, "0")}`, description: `Land ${index}`, commercialHeadId: H, hierarchyReviewState: "allocated" }));
    const population = [...allocated, ...unreviewed];
    const refreshed = population.map((record) => ({ ...record, commercialHeadId: H, hierarchyReviewState: "allocated" }));
    auth.principal.tenantReadiness = { tenant: { name: "BuildLite Pilot Company" }, companySettingsReady: true, headCategoriesReviewed: true, commerciallyReady: false, hierarchyReviewComplete: false, developmentExists: false, counts: { activeCostCodes: 59, allocatedCostCodes: 5, notReviewedCostCodes: 54, needsAttentionCostCodes: 0, activeHeads: 9, categorizedHeads: 9, developments: 0 } };
    auth.refreshReadiness.mockImplementation(async () => {
      auth.principal.tenantReadiness = { ...auth.principal.tenantReadiness, commerciallyReady: true, hierarchyReviewComplete: true, counts: { ...auth.principal.tenantReadiness.counts, allocatedCostCodes: 59, notReviewedCostCodes: 0 } };
      auth.principal.readinessFreshness = { state: "fresh", clientId: "pilot", hasAuthoritativeData: true };
      return auth.principal.tenantReadiness;
    });
    bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({ ok: true, costCodes: unreviewed });
    refreshCostCodes.mockResolvedValue(refreshed);
    getCostCodeOnboardingSummary.mockReset().mockResolvedValueOnce({ total: 59, allocated: 5, notReviewed: 54, notApplicable: 0, needsAttention: 0 }).mockResolvedValueOnce({ total: 59, allocated: 59, notReviewed: 0, notApplicable: 0, needsAttention: 0 });
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={population} />)); await settle();
    click(button("Select all filtered (54)"));
    const head = container.querySelector('[aria-label="Bulk Commercial Head"]');
    await act(async () => { head.value = H; head.dispatchEvent(new Event("change", { bubbles: true })); });
    click(button("Assign hierarchy")); click(button("Review 54")); click(button("Apply hierarchy")); await settle();
    expect(auth.refreshReadiness).toHaveBeenCalledOnce();
    await act(async () => root.render(<AdminCompanyReadinessPage onOpen={() => {}} />));
    expect(container.textContent).toContain("59 Allocated");
    expect(container.textContent).toContain("0 Not Reviewed");
    expect(container.textContent).not.toContain("5 Allocated");
  });
  it("does not read localStorage authority", async () => {
    localStorage.setItem(
      "buildlite_commercial_structure_v1",
      JSON.stringify({ heads: [{ name: "Local Override" }] }),
    );
    await act(async () =>
      root.render(<AdminCostCodeHierarchySetup records={records} />),
    );
    await settle();
    expect(container.textContent).not.toContain("Local Override");
    expect(container.textContent).toContain("Tenant Custom");
  });
  it("suppresses proposal once stable persisted IDs already satisfy it", async () => {
    await act(async () =>
      root.render(
        <AdminCostCodeHierarchySetup
          records={[
            {
              ...records[0],
              commercialHeadId: H,
              reportingGroupId: G,
              commercialHead: "Land",
              canonicalReportingGroup: "Land Cost",
              hierarchyReviewState: "allocated",
            },
          ]}
        />,
      ),
    );
    await settle();
    const filter = container.querySelector('[aria-label="Show cost codes"]');
    await act(async () => {
      filter.value = "allocated";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Use suggestion");
    expect(button("Review 0").disabled).toBe(true);
  });
  it("selects all 300 filtered rows across pages and prepares one Head-only hierarchy", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      version: 1,
      code: `N${String(i + 1).padStart(3, "0")}`,
      description: "Imported row",
      hierarchyReviewState: "not_reviewed",
      legacy: { trade: i % 2 ? "Trade A" : "Trade B" },
    }));
    await act(async () =>
      root.render(<AdminCostCodeHierarchySetup records={many} />),
    );
    await settle();
    click(button("Select all filtered"));
    const head = container.querySelector('[aria-label="Bulk Commercial Head"]');
    await act(async () => {
      head.value = H;
      head.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button("Assign hierarchy"));
    expect(button("Review 300 changes")).toBeTruthy();
  });
  it("uses string-prefix filtering for selection while preserving staged changes outside the filter", async () => {
    const codes = ["1120", "1200", "2000", "2010", "2020", "20A", "20-01", "3020", "4020", "0010"].map((code, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      version: 1, code, description: `Code ${code}`, hierarchyReviewState: "not_reviewed", legacy: {},
    }));
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={codes} />));
    await settle();
    const prefix = container.querySelector('[aria-label="Cost Code starts with"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(prefix, "20"); prefix.dispatchEvent(new Event("input", { bubbles: true })); });
    await settle();
    expect(container.textContent).toContain("5 cost codes");
    click(button("Select all filtered (5)"));
    const head = container.querySelector('[aria-label="Bulk Commercial Head"]');
    await act(async () => { head.value = "custom"; head.dispatchEvent(new Event("change", { bubbles: true })); });
    click(button("Assign hierarchy"));
    expect(container.textContent).toContain("5 hierarchy changes staged for review");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(prefix, "00"); prefix.dispatchEvent(new Event("input", { bubbles: true })); });
    await settle();
    expect(container.textContent).toContain("1 cost codes");
    expect(container.textContent).toContain("5 hierarchy changes staged for review");
    expect(button("Review changes")).toBeTruthy();
    expect(bulkUpdateCostCodeHierarchyOnServer).not.toHaveBeenCalled();
  });
});
