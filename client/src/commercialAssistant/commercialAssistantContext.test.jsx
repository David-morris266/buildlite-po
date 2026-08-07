/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommercialAssistantProvider,
  useCommercialAssistant,
  useCommercialAssistantScope,
} from './CommercialAssistantContext';
import { saveCompanySettings } from '../admin/companyStore';
import { COMMERCIAL_CHANGED } from '../commercial/commercialEvents';
import { clearCommercialEventsStore } from '../commercialEvents/commercialEventStore';
import { ensureCommercialAssistantProvidersRegistered, resetCommercialAssistantProvidersForTests } from './registerCommercialAssistantProviders';
import { clearRecommendationDispositionsForTests } from './recommendationDispositionStore';
import { usePackageWorkspaceAssistantScope } from './usePackageWorkspaceAssistantScope';

const DEV_ID = 'dev-assistant-context';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const packageRowA = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
};

function ScopeConsumer({ developmentId, packages, onNavigate, onScopeChange }) {
  useCommercialAssistantScope({ developmentId, packages, onNavigate });
  const { scope, badgeCounts } = useCommercialAssistant();

  const previousScopeRef = useRef(scope);
  if (previousScopeRef.current !== scope) {
    onScopeChange?.(scope);
    previousScopeRef.current = scope;
  }

  return (
    <div
      data-testid="scope-consumer"
      data-development-id={scope.developmentId || ''}
      data-badge-total={badgeCounts.actionRequired + badgeCounts.warnings}
    />
  );
}

describe('CommercialAssistantContext scope stabilisation', () => {
  let container;
  let root;
  let scopeChangeCount;

  beforeEach(() => {
    storageSetup();
    scopeChangeCount = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  function renderTree(ui) {
    act(() => {
      root.render(<CommercialAssistantProvider>{ui}</CommercialAssistantProvider>);
    });
  }

  it('does not repeatedly clear and set scope from equivalent updates', () => {
    const packages = [{ orderKey: 'dev-1::sup-1::0100' }];
    const onNavigate = vi.fn();

    function Harness({ tick }) {
      return (
        <ScopeConsumer
          developmentId="dev-1"
          packages={packages}
          onNavigate={onNavigate}
          onScopeChange={() => {
            scopeChangeCount += 1;
          }}
        />
      );
    }

    renderTree(<Harness tick={0} />);

    act(() => {
      root.render(
        <CommercialAssistantProvider>
          <Harness tick={1} />
        </CommercialAssistantProvider>
      );
    });

    act(() => {
      root.render(
        <CommercialAssistantProvider>
          <Harness tick={2} />
        </CommercialAssistantProvider>
      );
    });

    expect(scopeChangeCount).toBeLessThanOrEqual(1);
  });

  it('propagates genuine development scope changes', () => {
    const packagesA = [{ orderKey: 'pkg-a' }];
    const packagesB = [{ orderKey: 'pkg-b' }];

    function Harness({ developmentId, packages }) {
      return (
        <ScopeConsumer
          developmentId={developmentId}
          packages={packages}
          onNavigate={null}
          onScopeChange={() => {
            scopeChangeCount += 1;
          }}
        />
      );
    }

    renderTree(<Harness developmentId="dev-a" packages={packagesA} />);
    expect(document.querySelector('[data-development-id="dev-a"]')).toBeTruthy();

    act(() => {
      root.render(
        <CommercialAssistantProvider>
          <Harness developmentId="dev-b" packages={packagesB} />
        </CommercialAssistantProvider>
      );
    });

    expect(document.querySelector('[data-development-id="dev-b"]')).toBeTruthy();
    expect(scopeChangeCount).toBeGreaterThan(0);
  });

  it('does not create a new scope object for equivalent setAssistantScope calls', () => {
    const packages = [{ orderKey: 'pkg-stable' }];
    let observedScopes = [];

    function Harness() {
      const { scope, setAssistantScope } = useCommercialAssistant();

      useEffect(() => {
        setAssistantScope({ developmentId: 'dev-stable', packages, onNavigate: null });
      }, [setAssistantScope]);

      useEffect(() => {
        observedScopes.push(scope);
      }, [scope]);

      return <div data-development-id={scope.developmentId || ''} />;
    }

    renderTree(<Harness />);

    act(() => {
      root.render(
        <CommercialAssistantProvider>
          <Harness />
        </CommercialAssistantProvider>
      );
    });

    const uniqueReferences = new Set(observedScopes);
    expect(uniqueReferences.size).toBeLessThanOrEqual(2);
  });

  it('clears scope when the development consumer unmounts', () => {
    function Toggle({ showScope }) {
      return showScope ? (
        <ScopeConsumer
          developmentId="dev-clear"
          packages={[]}
          onNavigate={null}
          onScopeChange={() => {}}
        />
      ) : (
        <div data-testid="empty" />
      );
    }

    renderTree(<Toggle showScope />);
    expect(document.querySelector('[data-development-id="dev-clear"]')).toBeTruthy();

    act(() => {
      root.render(
        <CommercialAssistantProvider>
          <Toggle showScope={false} />
        </CommercialAssistantProvider>
      );
    });

    expect(document.querySelector('[data-development-id="dev-clear"]')).toBeFalsy();
  });

  describe('BL-024A.2.1 package workspace assistant scope', () => {
  const ROUTE_DEV_ID = 'dev-route-scope';
  const ROUTE_PACKAGE_A = `${ROUTE_DEV_ID}::sup-1::0100`;
  const routePackageRowA = {
    orderKey: ROUTE_PACKAGE_A,
    developmentId: ROUTE_DEV_ID,
    supplierId: 'sup-1',
    costCode: '0100',
    supplierLabel: 'Alpha Plumbing',
    committedValue: 50000,
  };
  const routePackageRowB = {
    orderKey: `${ROUTE_DEV_ID}::sup-2::0200`,
    developmentId: ROUTE_DEV_ID,
    supplierId: 'sup-2',
    costCode: '0200',
    supplierLabel: 'Beta Brickwork',
    committedValue: 30000,
  };
  const routeOrderA = {
    ...routePackageRowA,
    projectLabel: 'Oakwood',
    poNumbers: ['S0001'],
  };
  const routeDevelopmentPackages = [routePackageRowA, routePackageRowB];

  function PackageScopeProbe({ order, developmentPackages, enabled = true }) {
    usePackageWorkspaceAssistantScope(order, { developmentPackages, enabled });
    const { scope } = useCommercialAssistant();
    return (
      <div
        data-testid="package-scope-probe"
        data-development-id={scope.developmentId || ''}
        data-package-count={scope.packages.length}
      />
    );
  }

  function DevelopmentScopeOwner({ enabled = true }) {
    useCommercialAssistantScope(
      {
        developmentId: ROUTE_DEV_ID,
        packages: routeDevelopmentPackages,
        onNavigate: null,
      },
      [ROUTE_DEV_ID],
      { enabled }
    );
    const { scope } = useCommercialAssistant();
    return (
      <div
        data-testid="development-scope-probe"
        data-development-id={scope.developmentId || ''}
        data-package-count={scope.packages.length}
      />
    );
  }

  it('activates assistant scope from standalone package workspace context', () => {
    renderTree(
      <PackageScopeProbe order={routeOrderA} developmentPackages={routeDevelopmentPackages} />
    );

    const probe = document.querySelector('[data-testid="package-scope-probe"]');
    expect(probe?.dataset.developmentId).toBe(ROUTE_DEV_ID);
    expect(probe?.dataset.packageCount).toBe('2');
  });

  it('yields development scope to an open package without clearing active scope', () => {
    function ScopeReader() {
      const { scope } = useCommercialAssistant();
      return (
        <div
          data-testid="scope-reader"
          data-development-id={scope.developmentId || ''}
          data-package-count={scope.packages.length}
        />
      );
    }

    renderTree(
      <>
        <ScopeReader />
        <DevelopmentScopeOwner enabled />
      </>
    );
    expect(document.querySelector('[data-testid="scope-reader"]')?.dataset.developmentId).toBe(
      ROUTE_DEV_ID
    );

    renderTree(
      <>
        <ScopeReader />
        <DevelopmentScopeOwner enabled={false} />
        <PackageScopeProbe order={routeOrderA} developmentPackages={routeDevelopmentPackages} />
      </>
    );

    expect(document.querySelector('[data-testid="scope-reader"]')?.dataset.developmentId).toBe(
      ROUTE_DEV_ID
    );
    expect(document.querySelector('[data-testid="scope-reader"]')?.dataset.packageCount).toBe('2');
  });

  it('clears assistant scope when the package workspace unmounts', () => {
    function ScopeReader() {
      const { scope } = useCommercialAssistant();
      return (
        <div
          data-testid="scope-reader"
          data-development-id={scope.developmentId || ''}
        />
      );
    }

    renderTree(
      <>
        <ScopeReader />
        <PackageScopeProbe order={routeOrderA} developmentPackages={routeDevelopmentPackages} />
      </>
    );

    expect(document.querySelector('[data-testid="scope-reader"]')?.dataset.developmentId).toBe(
      ROUTE_DEV_ID
    );

    renderTree(<ScopeReader />);

    expect(document.querySelector('[data-testid="package-scope-probe"]')).toBeNull();
    expect(document.querySelector('[data-testid="scope-reader"]')?.dataset.developmentId).toBe('');
  });
  });
});

const storage = new Map();

function storageSetup() {
  storage.clear();
  clearCommercialEventsStore();
  clearRecommendationDispositionsForTests();
  resetCommercialAssistantProvidersForTests();
  ensureCommercialAssistantProvidersRegistered();
  saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
  localStorage.setItem('userName', 'Test Manager');
  vi.stubGlobal('localStorage', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  });

  const handlers = new Map();
  vi.stubGlobal('window', {
    dispatchEvent: (event) => {
      handlers.get(event.type)?.forEach((handler) => handler(event));
      return true;
    },
    addEventListener: (type, handler) => {
      const list = handlers.get(type) || [];
      list.push(handler);
      handlers.set(type, list);
    },
    removeEventListener: (type, handler) => {
      const list = handlers.get(type) || [];
      handlers.set(
        type,
        list.filter((item) => item !== handler)
      );
    },
  });
  void COMMERCIAL_CHANGED;
}
