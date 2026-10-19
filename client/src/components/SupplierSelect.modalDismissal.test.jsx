// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierSelect from './SupplierSelect';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api', () => ({
  listSuppliers: vi.fn(async () => []),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

describe('SupplierSelect new-supplier dialog', () => {
  it('keeps entered supplier details when the backdrop outside the dialog is pressed', async () => {
    await act(async () => root.render(<SupplierSelect value="" onChange={() => {}} />));

    await act(async () => setNativeValue(host.querySelector('select'), '__new__'));
    const dialog = host.querySelector('.modal-backdrop > .modal');
    expect(dialog).toBeTruthy();

    const nameInput = dialog.querySelector('input');
    await act(async () => setNativeValue(nameInput, 'Unsaved Supplier Ltd'));

    await act(async () => host.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

    expect(host.querySelector('.modal-backdrop > .modal')).toBeTruthy();
    expect(host.querySelector('.modal input').value).toBe('Unsaved Supplier Ltd');
  });

  it('still closes through the explicit Cancel action', async () => {
    await act(async () => root.render(<SupplierSelect value="" onChange={() => {}} />));
    await act(async () => setNativeValue(host.querySelector('select'), '__new__'));

    const cancel = [...host.querySelectorAll('.modal-actions button')].find((button) => button.textContent === 'Cancel');
    await act(async () => cancel.click());

    expect(host.querySelector('.modal-backdrop')).toBeNull();
  });
});
