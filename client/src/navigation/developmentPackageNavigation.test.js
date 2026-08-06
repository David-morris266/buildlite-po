import { describe, expect, it, vi } from 'vitest';
import { buildPackageWorkspaceNavigation } from './navigationBuilders';
import { PACKAGE_OPENED_FROM } from '../payments/packageWorkspaceLaunch';
import { PackageTable } from '../components/DevelopmentOverview';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';

describe('buildPackageWorkspaceNavigation', () => {
  it('builds development package breadcrumbs when opened from Developments', () => {
    const onBack = vi.fn();
    const onBackToDevelopmentList = vi.fn();
    const navigation = buildPackageWorkspaceNavigation({
      packageTitle: 'PlumbCo – Oakwood Meadows',
      onBack,
      navigationContext: { openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages },
      developmentName: 'Oakwood Meadows',
      onBackToDevelopmentList,
      onBackToDevelopmentPackages: onBack,
    });

    expect(navigation.breadcrumbs.map((item) => item.label)).toEqual([
      'Developments',
      'Oakwood Meadows',
      'Packages',
      'PlumbCo – Oakwood Meadows',
    ]);
    expect(navigation.onBack).toBe(onBack);
  });

  it('keeps certificate breadcrumbs when opened from Payment Certificates', () => {
    const onBack = vi.fn();
    const navigation = buildPackageWorkspaceNavigation({
      packageTitle: 'PlumbCo – Oakwood Meadows',
      onBack,
      navigationContext: { openedFrom: PACKAGE_OPENED_FROM.PaymentCertificates },
    });

    expect(navigation.breadcrumbs.map((item) => item.label)).toEqual([
      'Certificates',
      'PlumbCo – Oakwood Meadows',
    ]);
  });
});

describe('Development package table navigation', () => {
  const packageRow = {
    orderKey: 'dev-1::sup-1::0120',
    developmentId: 'dev-1',
    supplierId: 'sup-1',
    costCode: '0120',
    supplierLabel: 'PlumbCo',
    committedValue: 1000,
    certificateCount: 1,
    poNumbers: ['S0001'],
  };

  it('opens package workspace launch context from an Open Package action', () => {
    const onOpenPackage = vi.fn();
    const element = PackageTable({
      packages: [packageRow],
      onOpenPackage,
    });

    const button = findButton(element);
    button.props.onClick();

    expect(onOpenPackage).toHaveBeenCalledWith(
      'dev-1::sup-1::0120',
      expect.objectContaining({
        orderKey: 'dev-1::sup-1::0120',
        openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
        initialTab: 'overview',
        identityError: null,
      })
    );
  });

  it('exposes keyboard-focusable Open Package control with accessible label', () => {
    const element = PackageTable({
      packages: [packageRow],
      onOpenPackage: vi.fn(),
    });

    const button = findButton(element);
    expect(button.props.type).toBe('button');
    expect(button.props['aria-label']).toMatch(/Open package for PlumbCo/i);
  });

  it('shows PO commitment, approved events and current package columns', () => {
    const display = buildPackageCommercialDisplayFields(packageRow);
    const element = PackageTable({
      packages: [packageRow],
      onOpenPackage: vi.fn(),
    });
    const text = findTextContent(element).join(' ');

    expect(text).toContain('PO Commitment');
    expect(text).toContain('Approved Events');
    expect(text).toContain('Current Package');
    expect(display.originalPoCommitment).toBe(1000);
    expect(display.currentPackageValue).toBe(1000);
  });
});

function findButton(element) {
  if (!element) return null;
  if (element.props?.type === 'button') return element;
  const children = Array.isArray(element.props?.children)
    ? element.props.children
    : [element.props?.children];
  for (const child of children) {
    if (!child) continue;
    if (typeof child === 'object') {
      const found = findButton(child);
      if (found) return found;
    }
  }
  return null;
}

function findTextContent(element) {
  if (!element) return [];
  const parts = [];
  if (typeof element === 'string' || typeof element === 'number') {
    parts.push(String(element));
  }
  const children = Array.isArray(element?.props?.children)
    ? element.props.children
    : element?.props?.children != null
      ? [element.props.children]
      : [];
  for (const child of children) {
    parts.push(...findTextContent(child));
  }
  return parts;
}
