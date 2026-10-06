/** @vitest-environment jsdom */
import React, { useEffect, useRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getToken = vi.hoisted(() => vi.fn(async () => 'test-token'));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }) => children,
  Show: ({ when, children }) => when === 'signed-in' ? children : null,
  SignIn: () => null,
  SignUp: () => null,
  useAuth: () => ({ getToken }),
  useClerk: () => ({ signOut }),
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
  let principalResponse;

  beforeEach(() => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test');
    localStorage.clear();
    signOut.mockReset();
    calls = [];
    principalResponse = { user: { id: 'david', displayName: 'David' }, activeTenant: { clientId: 'willow', roleName: 'Commercial Director' }, memberships: [], permissions: [], tenantReadiness: { tenant: { name: 'Willow' }, counts: { allocatedCostCodes: 4 } } };
    nativeFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify(principalResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

  it('exposes Clerk-supported sign out in the normal authenticated shell', async () => {
    await act(async () => {
      root.render(<BuildLiteAuthProvider><span>Protected BuildLite</span></BuildLiteAuthProvider>);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Sign out');
    expect(calls.filter(url => url.endsWith('/api/auth/me'))).toHaveLength(1);
    expect(calls.filter(url => url.endsWith('/api/auth/readiness'))).toHaveLength(0);
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' });
  });

  it('establishes a platform-only principal without dereferencing a missing active company', async () => {
    principalResponse = {
      user: { id: 'david', displayName: 'David' }, activeTenant: null, memberships: [], permissions: [],
      platformPermissions: ['platform.tenant_provision'], tenantReadiness: null, platformOnly: true,
    };
    await act(async () => {
      root.render(<BuildLiteAuthProvider><span>Provisioning route</span></BuildLiteAuthProvider>);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain('Signed in as David');
    expect(container.textContent).not.toContain('Company unavailable');
    expect(container.textContent).toContain('Provisioning route');
  });

  it('retains the access-unavailable boundary for a non-platform user with no membership', async () => {
    globalThis.fetch = vi.fn(async input => {
      if (String(input).endsWith('/api/auth/me')) return new Response(JSON.stringify({ message: 'No active membership' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      throw new Error(`Unexpected request: ${input}`);
    });
    await act(async () => {
      root.render(<BuildLiteAuthProvider><span>Must not render</span></BuildLiteAuthProvider>);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain('BuildLite access unavailable');
    expect(container.textContent).toContain('Your BuildLite account has no active company membership.');
    expect(container.textContent).not.toContain('Must not render');
  });
});
