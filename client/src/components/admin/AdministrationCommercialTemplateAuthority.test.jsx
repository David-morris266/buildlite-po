/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdministrationLanding from './AdministrationLanding';

const auth = vi.hoisted(() => ({ principal: { permissions: [] } }));
vi.mock('../../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => auth.principal,
}));
vi.mock('./AdminPrelimsTemplatesPage', () => ({
  default: ({ onBack }) => <div>Prelims template editor<button onClick={onBack}>Back</button></div>,
}));
vi.mock('./AdminSellingCostsTemplatesPage', () => ({
  default: ({ onBack }) => <div>Selling Costs template editor<button onClick={onBack}>Back</button></div>,
}));

import AdministrationModule from './AdministrationModule';

describe('company commercial-template Administration authority', () => {
  let container;
  let root;

  beforeEach(() => {
    auth.principal = { permissions: [] };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows both company-template destinations only with management authority', () => {
    act(() => root.render(
      <AdministrationLanding
        onOpen={() => {}}
        showDeveloperTools={false}
        canManageCommercialTemplates
      />
    ));
    expect(container.textContent).toContain('Prelims Templates');
    expect(container.textContent).toContain('Selling Costs Templates');

    act(() => root.render(
      <AdministrationLanding
        onOpen={() => {}}
        showDeveloperTools={false}
        canManageCommercialTemplates={false}
      />
    ));
    expect(container.textContent).not.toContain('Prelims Templates');
    expect(container.textContent).not.toContain('Selling Costs Templates');
    expect(container.textContent).toContain('Commercial Cost Structure');
  });

  it('fails a direct company-template entry safely for an unauthorised role', async () => {
    const onViewReplace = vi.fn();
    await act(async () => {
      root.render(<AdministrationModule initialView="selling-costs-templates" onViewReplace={onViewReplace} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Administration');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'do not have permission to manage company commercial templates'
    );
    expect(container.textContent).not.toContain('Company-owned Selling Costs defaults');
    expect(onViewReplace).toHaveBeenCalledWith('landing');
  });

  it.each([
    ['selling-costs-templates', 'Selling Costs template editor'],
    ['prelims-templates', 'Prelims template editor'],
  ])('restores authorised %s deep links and reports return to landing', async (initialView, expectedText) => {
    auth.principal = { permissions: ['commercial_templates.manage'] };
    const onViewChange = vi.fn();
    await act(async () => {
      root.render(<AdministrationModule initialView={initialView} onViewChange={onViewChange} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(expectedText);
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Back').click());
    expect(container.textContent).toContain('Administration');
    expect(onViewChange).toHaveBeenCalledWith('landing');
  });

  it('replaces an unknown subsection with the Administration landing', async () => {
    auth.principal = { permissions: ['commercial_templates.manage'] };
    const onViewReplace = vi.fn();
    await act(async () => {
      root.render(<AdministrationModule initialView="removed-module" onViewReplace={onViewReplace} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Administration');
    expect(onViewReplace).toHaveBeenCalledWith('landing');
  });
});
