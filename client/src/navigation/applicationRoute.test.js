import { describe, expect, it } from 'vitest';
import {
  homeApplicationRoute,
  parseApplicationRoute,
  serializeApplicationRoute,
} from './applicationRoute';

describe('canonical application routes', () => {
  it('keeps an unscoped root on Home', () => {
    expect(parseApplicationRoute({ search: '' })).toEqual(homeApplicationRoute());
    expect(serializeApplicationRoute(homeApplicationRoute(), { pathname: '/', hash: '' })).toBe('/');
  });

  it('round-trips a Development Selling Costs workspace using stable identity only', () => {
    const url = serializeApplicationRoute({
      view: 'developments', developmentId: 'dev-123', workspaceTab: 'selling-costs',
    }, { pathname: '/', hash: '' });
    expect(url).toBe('/?view=developments&development=dev-123&workspace=selling-costs');
    expect(parseApplicationRoute({ search: url.slice(1) })).toMatchObject({
      view: 'developments', developmentId: 'dev-123', workspaceTab: 'selling-costs',
    });
  });

  it('round-trips stable Administration subsections while keeping landing valid', () => {
    const sellingCosts = serializeApplicationRoute({
      view: 'administration', administrationSection: 'selling-costs-templates',
    }, { pathname: '/', hash: '' });
    expect(sellingCosts).toBe('/?view=administration&section=selling-costs-templates');
    expect(parseApplicationRoute({ search: sellingCosts.slice(1) })).toMatchObject({
      view: 'administration', administrationSection: 'selling-costs-templates',
    });
    expect(parseApplicationRoute({ search: '?view=administration' })).toMatchObject({
      view: 'administration', administrationSection: null,
    });
  });

  it('round-trips CVR and package workspace identity', () => {
    expect(parseApplicationRoute({
      search: '?view=developments&development=dev-1&workspace=cvr&period=P04',
    })).toMatchObject({ developmentId: 'dev-1', workspaceTab: 'cvr', periodKey: 'P04' });
    expect(parseApplicationRoute({
      search: '?view=developments&development=dev-1&workspace=packages&package=dev-1%3Asupplier-1%3A3640&packageTab=variations',
    })).toMatchObject({
      developmentId: 'dev-1', workspaceTab: 'packages',
      packageKey: 'dev-1:supplier-1:3640', packageTab: 'variations',
    });
    expect(parseApplicationRoute({
      search: '?view=developments&development=dev-1&workspace=packages&package=dev-1%3A%3Asupplier-1%3A%3AX-10%2F1&packageTab=unknown',
    })).toMatchObject({ packageKey: 'dev-1::supplier-1::X-10/1', packageTab: 'overview' });
  });

  it('round-trips the stable Plot Master tenure-review workspace without pending decisions',()=>{
    const url=serializeApplicationRoute({view:'developments',developmentId:'dev-hawthorn',workspaceTab:'plot-master',plotMasterView:'tenure-review',decisions:[{plotId:'secret'}]},{pathname:'/',hash:''});
    expect(url).toBe('/?view=developments&development=dev-hawthorn&workspace=plot-master&plotView=tenure-review');
    expect(parseApplicationRoute({search:url.slice(1)})).toMatchObject({developmentId:'dev-hawthorn',workspaceTab:'plot-master',plotMasterView:'tenure-review'});
  });

  it('fails unsafe or stale route shapes to the nearest parent', () => {
    expect(parseApplicationRoute({ search: '?view=developments&development=%3Cscript%3E&workspace=cvr&period=P04' }))
      .toEqual({ ...homeApplicationRoute(), view: 'developments' });
    expect(parseApplicationRoute({ search: '?view=unknown&development=dev-1' }))
      .toEqual(homeApplicationRoute());
  });

  it('never serializes payload or token-like unknown properties', () => {
    const url = serializeApplicationRoute({
      view: 'developments', developmentId: 'dev-1', workspaceTab: 'cvr', periodKey: 'P04',
      adjustment: 9000, token: 'secret', draft: { reason: 'private' },
    }, { pathname: '/', hash: '' });
    expect(url).toBe('/?view=developments&development=dev-1&workspace=cvr&period=P04');
  });
});
