/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../setup/components/SetupCostCodeImportWizard',()=>({default:()=> <div>Cost Code wizard</div>}));
import AdminSetupDataImportPage from './AdminSetupDataImportPage';
let container,root;
beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();});
it('advertises only supported pilot imports',()=>{act(()=>root.render(<AdminSetupDataImportPage/>));expect(container.textContent).toContain('Import Cost Codes');expect(container.textContent).not.toContain('Import Suppliers');expect(container.textContent).not.toContain('Import Customers');expect(container.textContent).not.toContain('Coming soon');});
