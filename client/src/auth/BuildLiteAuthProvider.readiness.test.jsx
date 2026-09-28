/** @vitest-environment jsdom */
import React, { useEffect, useRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getToken = vi.hoisted(() => vi.fn(async () => 'test-token'));
vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }) => children,
  Show: ({ when, children }) => when === 'signed-in' ? children : null,
  SignIn: () => null,
  useAuth: () => ({ getToken }),
}));

import BuildLiteAuthProvider, { useBuildLitePrincipal } from './BuildLiteAuthProvider';

function Probe({ onPrincipal, runConcurrentRefresh = false }) {
  const principal = useBuildLitePrincipal();
  const refreshed = useRef(false);
  useEffect(() => {
    if (!principal) return;
    onPrincipal(principal);
    if (runConcurrentRefresh && !refreshed.current) {
      refreshed.current = true;
      Promise.all([principal.refreshTenantReadiness(), principal.refreshTenantReadiness()]).catch(() => {});
    }
  }, [onPrincipal, principal, runConcurrentRefresh]);
  return <span>{principal?.tenantReadiness?.counts?.allocatedCostCodes ?? 'loading'}</span>;
}

describe('BuildLite tenant readiness refresh', () => {
  let container;
  let root;
  let nativeFetch;
  let calls;

  beforeEach(() => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test');
    localStorage.clear();
    calls = [];
    nativeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify({ user: { id: 'david', displayName: 'David' }, activeTenant: { clientId: 'willow', roleName: 'Commercial Director' }, memberships: [], permissions: [], tenantReadiness: { tenant: { name: 'Willow' }, counts: { allocatedCostCodes: 4 } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/api/auth/readiness')) return new Response(JSON.stringify({ clientId: 'willow', tenantReadiness: { tenant: { name: 'Willow' }, counts: { allocatedCostCodes: 5, notReviewedCostCodes: 24 } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error(`Unexpected request: ${url}`);
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount()); container.remove(); globalThis.fetch = nativeFetch; vi.unstubAllEnvs();
  });

  it('establishes the principal once and coalesces concurrent tenant-correct readiness refreshes', async () => {
    const observed = [];
    await act(async () => {
      root.render(<BuildLiteAuthProvider><Probe onPrincipal={value => observed.push(value)} runConcurrentRefresh /></BuildLiteAuthProvider>);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(calls.filter(url => url.endsWith('/api/auth/me'))).toHaveLength(1);
    expect(calls.filter(url => url.endsWith('/api/auth/readiness'))).toHaveLength(1);
    expect(container.textContent).toContain('5');
    expect(observed.at(-1).activeTenant.clientId).toBe('willow');
  });
});
