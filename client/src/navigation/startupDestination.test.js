import { describe, expect, it } from 'vitest';
import { shouldEnterSetup } from './startupDestination';

describe('GP-1 startup destination', () => {
  it('sends a configured tenant to Home regardless of browser setup storage', () => {
    expect(shouldEnterSetup({ routeView: 'home', tenantReadiness: { configured: true } })).toBe(false);
  });
  it('sends a genuinely unconfigured tenant to Setup', () => {
    expect(shouldEnterSetup({ routeView: 'home', tenantReadiness: { configured: false } })).toBe(true);
  });
  it('preserves explicit setup access and deliberate session exit', () => {
    expect(shouldEnterSetup({ routeView: 'setup', tenantReadiness: { configured: true } })).toBe(true);
    expect(shouldEnterSetup({ routeView: 'setup', tenantReadiness: { configured: true }, setupDismissed: true })).toBe(false);
  });
});
