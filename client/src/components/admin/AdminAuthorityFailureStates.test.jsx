/** @vitest-environment jsdom */
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({structure:vi.fn(),codes:vi.fn(),suppliers:vi.fn(),pos:vi.fn()}));
vi.mock('../../admin/commercialStructureService',()=>({loadCommercialStructure:mocks.structure}));
vi.mock('../../admin/costCodeAdminService',()=>({ensureAdminCostCodesReady:mocks.codes,listAdminCostCodeRecords:()=>null}));
vi.mock('../../api',()=>({listPOs:mocks.pos,listSuppliers:mocks.suppliers,createSupplier:vi.fn(),updateSupplier:vi.fn(),approveSupplier:vi.fn()}));
import AdminReportingPreviewPage from './AdminReportingPreviewPage';
import AdminValidationDashboardPage from './AdminValidationDashboardPage';
import AdminSuppliersPage from './AdminSuppliersPage';

let container,root;const settle=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
describe('authoritative Commercial Structure failure states',()=>{
 beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);mocks.structure.mockReset().mockRejectedValue(new Error('Commercial Structure unavailable.'));mocks.codes.mockReset().mockRejectedValue(new Error('Cost Code Master unavailable.'));mocks.suppliers.mockReset().mockResolvedValue([]);mocks.pos.mockReset().mockResolvedValue({items:[]});});
 afterEach(()=>{act(()=>root.unmount());container.remove();});
 it('Reporting Preview does not present failed authority as an empty successful report',async()=>{await act(async()=>root.render(<AdminReportingPreviewPage/>));await settle();expect(container.querySelector('[role=alert]').textContent).toContain('Commercial Structure unavailable');expect(container.textContent).not.toContain('Executive Heads');});
 it('Validation Dashboard does not claim all checks passed after authority failure',async()=>{await act(async()=>root.render(<AdminValidationDashboardPage/>));await settle();expect(container.querySelector('[role=alert]')).not.toBeNull();expect(container.textContent).not.toContain('All checks passed');});
 it('Suppliers preserves its list but disables hierarchy choices when catalogue authority fails',async()=>{await act(async()=>root.render(<AdminSuppliersPage/>));await settle();expect(container.querySelector('[role=alert]').textContent).toContain('Commercial Structure unavailable');act(()=>[...container.querySelectorAll('button')].find(x=>x.textContent.includes('Add Supplier')).click());const labels=[...container.querySelectorAll('label')];for(const name of ['Preferred Trade','Preferred Commercial Head'])expect(labels.find(x=>x.textContent.includes(name)).querySelector('select').disabled).toBe(true);});
});
