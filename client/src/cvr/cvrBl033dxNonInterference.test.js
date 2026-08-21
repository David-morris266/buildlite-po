import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateFinalForecast, calculateSystemForecast } from './cvrForecastEngine';
import { calculateCostToComplete } from './cvrCalculations';

describe('BL-033D.x.1 CVR / development non-interference', () => {
  it('keeps P04 5231 Standard CVR money unchanged', () => {
    const systemForecast = calculateSystemForecast({
      committed: 50280,
      actualCost: 0,
      currentBudget: 0,
    });
    expect(systemForecast).toBe(50280);
    expect(calculateFinalForecast(systemForecast, 520)).toBe(50800);
    expect(calculateCostToComplete(50800, 0, 120)).toBe(50680);
  });

  it('does not add Review & Adopt or template instantiation into CVR or D.1 engines', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      'cvrEngine.js',
      'cvrForecastEngine.js',
      'cvrSummaryHelpers.js',
      'cvrSnapshotMapper.js',
      'cvrReportingMonth.js',
      join(dir, '..', 'prelims', 'prelimsForecastEngine.js'),
    ];
    const interference =
      /client_prelims_templates|BUILDLITE_STANDARD_PRELIMS|Review & Adopt|Setup from Template/;
    for (const file of files) {
      const path = file.includes('\\') || file.startsWith('/') || file.includes('prelims')
        ? file
        : join(dir, file);
      expect(readFileSync(path, 'utf8')).not.toMatch(interference);
    }
  });
});
