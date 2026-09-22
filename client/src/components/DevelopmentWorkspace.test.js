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
const workspaceStyles = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../styles/po-module.css'),
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

  it('routes workspace tab clicks through handleSelectWorkspaceTab', () => {
    expect(workspaceSource).toContain('function handleSelectWorkspaceTab(tabId)');
    expect(workspaceSource).toContain('onClick={() => handleSelectWorkspaceTab(tab.id)}');
    expect(workspaceSource).toContain('onSelectTab: handleSelectWorkspaceTab');
  });

  it('releases the Development workspace transform after the shared entrance animation', () => {
    expect(workspaceSource).toContain('<WorkspaceShell className="dev-workspace-shell">');
    expect(workspaceStyles).toMatch(
      /\.bl-workspace\s*\{[^}]*animation:\s*po-fade-up 0\.55s cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/s
    );
    expect(workspaceStyles).toMatch(
      /\.dev-workspace-shell\s*\{\s*animation-fill-mode:\s*backwards;\s*\}/s
    );
    const scopedRule = workspaceStyles.match(/\.dev-workspace-shell\s*\{([^}]*)\}/s)?.[1] || '';
    expect(scopedRule).not.toMatch(/overflow|(?:min-|max-)?height|z-index|contain|background|transform/);
  });
});
