import { describe, expect, it } from 'vitest';
import {
  buildPackageTableCostCodeDisplay,
  buildPackageTableSecondaryTooltip,
  buildPackageTableSupplierDisplay,
  parseCostCodeParts,
} from './developmentPackageTableDisplay';

describe('developmentPackageTableDisplay', () => {
  it('truncates long supplier names for compact display', () => {
    const result = buildPackageTableSupplierDisplay(
      'Very Long Subcontractor Name Limited Partnership',
      { maxLength: 20 }
    );

    expect(result.compact).toMatch(/Very Long Subcontra…$/);
    expect(result.full).toMatch(/Partnership$/);
    expect(result.truncated).toBe(true);
  });

  it('parses cost code and description when separated', () => {
    expect(parseCostCodeParts('0120 — Glazing packages')).toEqual({
      code: '0120',
      description: 'Glazing packages',
    });
  });

  it('builds compact cost code as code first with concise description', () => {
    const display = buildPackageTableCostCodeDisplay({
      costCode: '0120',
      pos: [{ items: [{ description: 'Curtain walling installation' }] }],
    });

    expect(display.compact).toMatch(/^0120 · Curtain walling inst/);
    expect(display.compact).toMatch(/…$/);
    expect(display.full).toBe('0120 — Curtain walling installation');
  });

  it('includes secondary commercial information in tooltip text', () => {
    const tooltip = buildPackageTableSecondaryTooltip(
      {
        supplierId: 'sup-1',
        supplierLabel: 'Alpha',
        poNumbers: ['S0001', 'S0002'],
        certificateCount: 3,
      },
      { originalPoCommitment: 50000 }
    );

    expect(tooltip).toContain('PO commitment: £50,000.00');
    expect(tooltip).toContain('POs: S0001, S0002');
    expect(tooltip).toContain('Certificates: 3');
    expect(tooltip).toContain('Supplier ID: sup-1');
  });
});
