/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPrelimsTemplates = vi.hoisted(() => vi.fn());
const getPrelimsTemplate = vi.hoisted(() => vi.fn());
const createPrelimsTemplate = vi.hoisted(() => vi.fn());
const updatePrelimsTemplate = vi.hoisted(() => vi.fn());

vi.mock('../../api/prelimsTemplates', () => ({
  listPrelimsTemplates,
  getPrelimsTemplate,
  createPrelimsTemplate,
  updatePrelimsTemplate,
  PrelimsTemplateApiError: class PrelimsTemplateApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.status = status;
    }
  },
}));

import AdminPrelimsTemplatesPage from './AdminPrelimsTemplatesPage';

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

describe('Admin Prelims Templates', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPrelimsTemplates.mockResolvedValue({ templates: [] });
    getPrelimsTemplate.mockResolvedValue(null);
    createPrelimsTemplate.mockReset();
    updatePrelimsTemplate.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('explains BuildLite Standard and lists company templates', async () => {
    listPrelimsTemplates.mockResolvedValue({
      templates: [
        {
          id: 'tpl-1',
          name: 'Housebuilding Prelims',
          origin: 'buildlite_standard',
          sourceStandardVersion: 1,
          isDefault: true,
          lineCount: 25,
        },
      ],
    });
    getPrelimsTemplate.mockResolvedValue({
      id: 'tpl-1',
      name: 'Housebuilding Prelims',
      origin: 'buildlite_standard',
      sourceStandardVersion: 1,
      isDefault: true,
      version: 1,
      lines: [
        {
          id: 'line-1',
          name: 'Site Manager',
          forecastDriver: 'TIME',
          startBasis: 'SITE_START',
          endBasis: 'FINAL_COMPLETION',
          costCodeKey: null,
          enabled: true,
        },
      ],
    });

    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();

    expect(container.textContent).toContain('Start with BuildLite');
    expect(container.textContent).toContain('recommended UK housebuilding Prelims structure');
    expect(container.textContent).toContain('Use BuildLite Standard');
    expect(container.textContent).toContain('Start Blank');
    expect(container.textContent).toContain('Housebuilding Prelims');
    expect(container.textContent).not.toContain('Review & Adopt');
    expect(container.textContent).not.toContain('Setup from Template');

    await act(async () => {
      container.querySelector('td button').click();
    });
    await flush();
    expect(container.textContent).toContain('Site Manager');
    expect(container.textContent).toContain('Unmapped');
  });

  it('creates from BuildLite Standard using the typed name', async () => {
    createPrelimsTemplate.mockResolvedValue({
      id: 'tpl-new',
      name: 'BuildLite Standard Prelims',
      origin: 'buildlite_standard',
      sourceStandardVersion: 1,
      isDefault: true,
      lines: [],
    });
    getPrelimsTemplate.mockResolvedValue({
      id: 'tpl-new',
      name: 'BuildLite Standard Prelims',
      origin: 'buildlite_standard',
      sourceStandardVersion: 1,
      isDefault: true,
      version: 1,
      lines: [],
    });

    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();

    const buttons = Array.from(container.querySelectorAll('button'));
    const standard = buttons.find((button) => button.textContent.includes('Use BuildLite Standard'));
    await act(async () => {
      standard.click();
    });
    await flush();

    expect(createPrelimsTemplate).toHaveBeenCalledWith({
      origin: 'buildlite_standard',
      name: 'BuildLite Standard Prelims',
    });
  });
});
