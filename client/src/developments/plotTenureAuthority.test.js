import {describe,expect,it} from 'vitest';
import {classifyImportedTenure,normalizePlotTenureCode} from './plotTenureAuthority';

describe('Plot tenure authority',()=>{
  it('recognises only deterministic controlled import aliases',()=>{
    expect(classifyImportedTenure('Private')).toBe('OPEN_MARKET');
    expect(classifyImportedTenure('Shared Ownership')).toBe('SHARED_OWNERSHIP');
    expect(classifyImportedTenure('Private phase 2')).toBe('UNREVIEWED');
    expect(classifyImportedTenure('')).toBe('UNREVIEWED');
  });
  it('does not turn legacy free text into controlled authority',()=>{
    expect(normalizePlotTenureCode('Open market')).toBe('UNREVIEWED');
    expect(normalizePlotTenureCode('OPEN_MARKET')).toBe('OPEN_MARKET');
  });
});
