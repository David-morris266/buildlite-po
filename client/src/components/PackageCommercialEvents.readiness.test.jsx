/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PackageCommercialEvents from './PackageCommercialEvents';

const order = {
  orderKey: 'dev-1::sup-1::0100',
  developmentId: 'dev-1',
  committedValue: 100000,
};

describe('PackageCommercialEvents readiness (BL-028B.1)', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows loading KPI placeholders instead of false zero values', () => {
    act(() => {
      root.render(
        <PackageCommercialEvents
          order={order}
          commercialEventsLoading
          commercialEventsReady={false}
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Loading commercial data…');
    expect(text).not.toMatch(/£0\.00/);
    expect(text).toContain('Commercial Events register');
  });

  it('shows empty register state when ready and no events exist', () => {
    act(() => {
      root.render(
        <PackageCommercialEvents order={order} commercialEventsReady />
      );
    });

    expect(container.textContent).toContain('No commercial events recorded yet.');
  });
});
