import { describe, expect, it } from 'vitest';
import { shouldEnterCompanyReadiness } from './startupDestination';

describe('GP-1 startup destination', () => {
  it('sends a configured tenant to Home regardless of browser setup storage', () => {
    expect(shouldEnterCompanyReadiness({ routeView: 'home', tenantReadiness: { configured: true } })).toBe(false);
  });
  it('sends a genuinely unconfigured tenant to Setup', () => {
    expect(shouldEnterCompanyReadiness({ routeView: 'home', tenantReadiness: { configured: false } })).toBe(true);
  });
  it('preserves explicit setup access and deliberate session exit', () => {
    expect(shouldEnterCompanyReadiness({ routeView: 'setup', tenantReadiness: { configured: false } })).toBe(true);
    expect(shouldEnterCompanyReadiness({ routeView: 'administration', tenantReadiness: { configured: false } })).toBe(false);
  });
});
