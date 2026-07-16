/**
 * Shared page header for Purchase Order module screens.
 * Delegates to ApplicationPageHeader for consistent navigation.
 */
import ApplicationPageHeader from './layout/ApplicationPageHeader';

export default function POPageHeader({
  eyebrow,
  title,
  lead,
  breadcrumbs = [],
  onBack = null,
  actions = null,
  showBack = true,
}) {
  return (
    <ApplicationPageHeader
      eyebrow={eyebrow}
      title={title}
      lead={lead}
      breadcrumbs={breadcrumbs}
      onBack={onBack}
      actions={actions}
      showBack={showBack}
    />
  );
}
