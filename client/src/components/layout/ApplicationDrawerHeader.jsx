import ApplicationPageHeader from './ApplicationPageHeader';

/**
 * Drawer variant of the application page header.
 * Uses "Back" instead of "Close" for consistent navigation language.
 */
export default function ApplicationDrawerHeader({
  breadcrumbs = [],
  title,
  lead = '',
  eyebrow = '',
  onBack,
  actions = null,
  className = '',
}) {
  return (
    <ApplicationPageHeader
      breadcrumbs={breadcrumbs}
      title={title}
      lead={lead}
      eyebrow={eyebrow}
      onBack={onBack}
      actions={actions}
      className={className}
      variant="drawer"
    />
  );
}
