import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('PlotDrawer selling price input', () => {
  it('does not constrain contractual sellingPrice to £1,000 steps', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PlotDrawer.jsx'), 'utf8');
    const match = source.match(
      /<span className="dev-form__label">Selling Price<\/span>\s*<input[\s\S]*?\/>/
    );
    expect(match).toBeTruthy();
    expect(match[0]).toContain('type="number"');
    expect(match[0]).toContain('step="0.01"');
    expect(match[0]).not.toContain('step="1000"');
  });

  it('explains Reserved Selling Price authority without replacing the fallback source', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PlotDrawer.jsx'), 'utf8');
    expect(source).toContain('Reserved Selling Price currently drives Forecast Revenue.');
    expect(source).toContain('remains stored and resumes if the plot returns to Available');
  });
});
