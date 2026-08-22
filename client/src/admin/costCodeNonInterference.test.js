import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('BL-033D.x.2A.2 non-interference', () => {
  it('does not add template mapping, Prelims instantiation, or classification schema changes', () => {
    const page = read('client/src/components/admin/AdminCostCodesPage.jsx');
    const service = read('client/src/admin/costCodeAdminService.js');
    expect(page).not.toMatch(/prelims-templates|development_prelims_items|client_prelims_template/);
    expect(page).not.toMatch(/ensureCostCodeMasterSeeded|\/api\/po\/cost-codes/);
    expect(service).not.toMatch(/\/api\/po\/cost-codes/);
    expect(page).not.toMatch(/listCostCodes as fetchServerCostCodes/);
    expect(read('server/migrations/013_cost_code_classifications.sql')).not.toMatch(/commercial_head/);
    expect(read('server/migrations/015_development_prelims_items.sql')).toMatch(/development_prelims_items/);
    expect(read('server/migrations/016_client_prelims_templates.sql')).toMatch(/client_prelims_template_lines/);
  });
});
