// @vitest-environment jsdom
import { describe,it,expect,vi,beforeEach } from 'vitest';
vi.mock('./costCentreStore',()=>({listCostCentres:()=>[
 {id:'brick',costCodeKey:'4120',costCodeLabel:'4120 — Brickwork',originalBudget:245000,currentBudget:245000,commercialAdjustment:15000,manualAccrual:0},
 {id:'land',costCodeKey:'1100',costCodeLabel:'1100 — Land Cost',originalBudget:1650000,currentBudget:1650000,commercialAdjustment:2500,manualAccrual:7000},
],getDevelopmentNotes:()=>'',getPeriodData:()=>null,upsertAutoCostCentre:()=>null}));
vi.mock('../api',()=>({listPOs:()=>[]})); vi.mock('../certificates/certificateStore',()=>({listCertificatesForDevelopment:()=>[]})); vi.mock('../commercial/commercialEvents',()=>({listCommercialEvents:()=>[]})); vi.mock('../commercial/variationOrders',()=>({listVariationOrders:()=>[]})); vi.mock('../ledger/ledgerStore',()=>({listLedgerTransactions:()=>[]}));
import {buildCvrRows} from './cvrEngine';
describe('Development Budget CVR consumption',()=>{beforeEach(()=>vi.clearAllMocks()); it('uses authoritative exact per-code budgets instead of legacy CVR budget fields',()=>{
 const period={budgetSource:{adopted:true,document:{positions:[{costCode:'4120',description:'Brickwork',originalPence:10000000,currentPence:11000000}]}}};
 const rows=buildCvrRows('dev',{periodKey:'P01',period}); const row=rows.find(r=>r.costCodeKey==='4120'); const land=rows.find(r=>r.costCodeKey==='1100');
 expect(row.originalBudget).toBe(100000); expect(row.currentBudget).toBe(110000); expect(row.commercialAdjustment).toBe(15000); expect(row.variance).toBe(110000-row.finalForecast);
 expect(land.originalBudget).toBe(0); expect(land.currentBudget).toBe(0); expect(land.commercialAdjustment).toBe(2500); expect(land.manualAccrual).toBe(7000);
 expect(rows.reduce((sum,item)=>sum+(item.originalBudget||0),0)).toBe(100000); expect(rows.reduce((sum,item)=>sum+(item.currentBudget||0),0)).toBe(110000);
 });});
