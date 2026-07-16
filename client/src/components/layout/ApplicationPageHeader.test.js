import { describe, expect, it } from 'vitest';
import ApplicationPageHeader from './ApplicationPageHeader';

describe('ApplicationPageHeader', () => {
  it('renders standardized header structure', () => {
    const element = ApplicationPageHeader({
      breadcrumbs: [
        { label: 'Developments', onClick: () => {} },
        { label: 'CVRs' },
      ],
      title: 'CVR Register',
      lead: 'Monthly register',
      onBack: () => {},
    });

    expect(element.props.className).toContain('application-page-header');
    expect(element.props.children).toBeTruthy();
  });
});
