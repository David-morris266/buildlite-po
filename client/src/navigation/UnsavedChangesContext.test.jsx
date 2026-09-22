/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from './UnsavedChangesProvider.jsx';
import { useUnsavedChanges } from './UnsavedChangesContext.js';

function Harness({ dirty, navigate }) {
  const { registerUnsavedChanges, requestNavigation } = useUnsavedChanges();
  React.useEffect(() => {
    if (!dirty) return undefined;
    return registerUnsavedChanges({
      title: 'Unsaved Prelims setup',
      message: "You have setup changes that haven't been added to Site Prelims. Leaving now will discard them.",
    });
  }, [dirty, registerUnsavedChanges]);
  return <button onClick={() => requestNavigation(navigate)}>Navigate</button>;
}

describe('UnsavedChangesProvider', () => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelector('.unsaved-changes')?.remove();
  });

  it('runs clean navigation immediately', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(<UnsavedChangesProvider><Harness dirty={false} navigate={navigate} /></UnsavedChangesProvider>));
    await act(async () => container.querySelector('button').click());
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers Stay and Leave without saving for dirty navigation', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(<UnsavedChangesProvider><Harness dirty navigate={navigate} /></UnsavedChangesProvider>));
    await act(async () => container.querySelector('button').click());
    expect(navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    await act(async () => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Stay').click());
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button').click());
    await act(async () => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave without saving').click());
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
