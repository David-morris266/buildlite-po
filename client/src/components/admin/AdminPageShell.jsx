import ApplicationPageHeader from '../layout/ApplicationPageHeader';
import { buildAdminPageNavigation } from '../../navigation/navigationBuilders';

export default function AdminPageShell({
  breadcrumb = 'Administration',
  title,
  lead,
  onBack,
  breadcrumbs = null,
  children,
  actions = null,
}) {
  const navigation = breadcrumbs
    ? { breadcrumbs, title, onBack }
    : buildAdminPageNavigation({
        pageTitle: title || breadcrumb,
        onDashboard: onBack,
      });

  return (
    <div className="admin-page admin-page--polished">
      <ApplicationPageHeader
        breadcrumbs={navigation.breadcrumbs}
        title={title}
        lead={lead}
        onBack={navigation.onBack}
        actions={actions}
        showBack={Boolean(navigation.onBack)}
      />

      <div className="admin-page__body admin-fade-in">{children}</div>
    </div>
  );
}
