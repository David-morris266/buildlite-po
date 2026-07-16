import { describe, expect, it } from 'vitest';
import {
  AdministrationWorkspace,
  CommercialWorkspace,
  StandardWorkspace,
  WORKSPACE_TYPES,
} from './WorkspaceShell';

describe('WorkspaceShell layout components', () => {
  it('exports the three workspace layout types', () => {
    expect(WORKSPACE_TYPES.STANDARD).toBe('standard');
    expect(WORKSPACE_TYPES.COMMERCIAL).toBe('commercial');
    expect(WORKSPACE_TYPES.ADMINISTRATION).toBe('administration');
  });

  it('applies standard workspace classes', () => {
    expect(StandardWorkspace({ children: null }).props.className).toContain(
      'bl-workspace--standard'
    );
  });

  it('applies commercial workspace classes', () => {
    expect(CommercialWorkspace({ children: null }).props.className).toContain(
      'bl-workspace--commercial'
    );
  });

  it('applies administration dashboard variant classes', () => {
    expect(
      AdministrationWorkspace({ children: null, variant: 'dashboard' }).props.className
    ).toContain('bl-workspace--admin-dashboard');
  });
});
