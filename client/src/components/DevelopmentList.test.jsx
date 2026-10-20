// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDevelopments = vi.hoisted(() => vi.fn());
vi.mock('../developments/developmentStore', () => ({ listDevelopments }));
vi.mock('../developments/developmentHelpers', () => ({
  formatDevelopmentListRow: (item) => item,
}));

import DevelopmentList from './DevelopmentList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DevelopmentList authority presentation', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(props = {}) {
    act(() => root.render(<DevelopmentList {...props} />));
  }

  it('does not expose creation actions when no authorised handler is supplied', () => {
    listDevelopments.mockReturnValue([]);
    render();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'New Development')).toBe(false);
    expect(container.textContent).toContain('No developments are available for your account.');
  });

  it('retains the established list columns, status and canonical open action', () => {
    const onOpenDevelopment = vi.fn();
    listDevelopments.mockReturnValue([{
      id: 'dev-1', jobNumber: 'OM-001', developmentName: 'Oak Meadow',
      statusMeta: { label: 'Live', modifier: 'live' }, plotsLabel: '0',
      packagesLabel: 'Unavailable', lastUpdatedLabel: '20/10/2026',
    }]);
    render({ onOpenDevelopment });
    expect(container.textContent).toContain('Development Number');
    expect(container.textContent).toContain('0');
    expect(container.textContent).toContain('Unavailable');
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Workspace').click());
    expect(onOpenDevelopment).toHaveBeenCalledWith('dev-1');
  });
});
