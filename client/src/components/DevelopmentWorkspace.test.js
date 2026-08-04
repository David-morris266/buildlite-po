import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CommercialWorkspace,
  StandardWorkspace,
} from './layout/WorkspaceShell';

const workspaceSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'DevelopmentWorkspace.jsx'),
  'utf8'
);

function resolveWorkspaceShell(activeTab) {
  return activeTab === 'cvr' || activeTab === 'ledger' || activeTab === 'revenue'
    ? CommercialWorkspace
    : StandardWorkspace;
}

describe('DevelopmentWorkspace package-open render path', () => {
  it('declares WorkspaceShell before the packageLaunch early return', () => {
    const shellIndex = workspaceSource.indexOf('const WorkspaceShell');
    const packageLaunchIndex = workspaceSource.indexOf('if (packageLaunch)');

    expect(shellIndex).toBeGreaterThan(-1);
    expect(packageLaunchIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeLessThan(packageLaunchIndex);
  });

  it('resolves StandardWorkspace for the Packages tab package-open path', () => {
    const WorkspaceShell = resolveWorkspaceShell('packages');
    expect(WorkspaceShell).toBe(StandardWorkspace);
    expect(() =>
      WorkspaceShell({
        children: 'Package workspace',
      })
    ).not.toThrow();
  });

  it('keeps commercial workspace routing for ledger/revenue/cvr tabs', () => {
    expect(resolveWorkspaceShell('ledger')).toBe(CommercialWorkspace);
    expect(resolveWorkspaceShell('revenue')).toBe(CommercialWorkspace);
    expect(resolveWorkspaceShell('cvr')).toBe(CommercialWorkspace);
  });
});
