import { describe, expect, it } from 'vitest';
import { normalizeServerCostCode } from './costCodeServerMapper';

describe('Cost Code onboarding authority mapping', () => {
  it('preserves server-derived review state, disposition, provenance and import evidence', () => {
    const importEvidence = [{ batchId: 'batch-1', hierarchyEvidence: { Trade: { value: 'Brickwork' } } }];
    const mapped = normalizeServerCostCode({
      id: 'code-1', code: '4120', description: 'Brickwork',
      hierarchyReviewState: 'needs_attention',
      hierarchyReviewDisposition: 'not_applicable',
      hierarchyReviewedAt: '2026-09-16T10:00:00.000Z',
      hierarchyReviewedBy: { userId: 'user-1', displayName: 'QS User' },
      importEvidence,
    });

    expect(mapped).toMatchObject({
      hierarchyReviewState: 'needs_attention',
      hierarchyReviewDisposition: 'not_applicable',
      hierarchyReviewedAt: '2026-09-16T10:00:00.000Z',
      hierarchyReviewedBy: { userId: 'user-1', displayName: 'QS User' },
      importEvidence,
    });
  });
});
