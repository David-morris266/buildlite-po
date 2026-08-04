import POPageHeader from './POPageHeader';

export default function PackageWorkspaceNotFound({
  message,
  onBack,
  breadcrumbs = [{ label: 'Back' }],
  title = 'Package unavailable',
}) {
  return (
    <div className="po-package-workspace">
      <POPageHeader
        breadcrumbs={breadcrumbs}
        title={title}
        lead="The requested subcontract package could not be opened."
        onBack={onBack}
      />
      <div className="po-module-card po-empty-state" role="alert">
        <p className="po-empty-state__message">{message}</p>
        <button type="button" className="po-list-btn-secondary" onClick={onBack}>
          Go back
        </button>
      </div>
    </div>
  );
}
