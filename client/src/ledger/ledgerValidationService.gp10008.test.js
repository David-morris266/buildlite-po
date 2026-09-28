import {describe,it,expect,vi} from 'vitest';
vi.mock('./ledgerTransactionStore',()=>({getExistingInvoiceKeys:()=>new Set()}));
vi.mock('./ledgerCostCentreImport',()=>({
  collectKnownCostCentreKeys:(_id,codes)=>new Set(codes),
  buildImportCostCentreDescription:(row)=>row.description || row.costCode || '',
}));
import {validateLedgerImport} from './ledgerValidationService';

describe('GP10-008 ledger authority preview',()=>{
  it('reconciles Willow-shaped resolved, unresolved and signed credit evidence',()=>{
    const rows=[['Supplier','Cost Code','Date','Invoice','Net'],['Roofing Ltd','4020','2026-09-01','PL-0100','-750'],['Odd Jobs Ltd','9998','2026-09-02','PL-0099','1250']];
    const result=validateLedgerImport(rows,0,['supplier','costCode','transactionDate','invoiceNumber','transactionAmount'],{developmentId:'willow',knownCostCodes:['4020']});
    expect(result).toMatchObject({rowCount:2,importedCount:2,resolvedCount:1,unresolvedCount:1,totalValue:500,allocatedValue:-750,unresolvedValue:1250,errorCount:0});
    expect(result.rowWarnings[0].warnings).toContain('Not matched to Company Cost Code');
  });
});
