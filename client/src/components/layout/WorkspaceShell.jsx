/**
 * BL-016C — Application layout shells.
 * Every screen declares one of: Standard, Commercial, or Administration workspace.
 */

export function StandardWorkspace({ children, className = '' }) {
  return (
    <div
      className={['bl-workspace', 'bl-workspace--standard', 'po-page', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CommercialWorkspace({ children, className = '' }) {
  return (
    <div
      className={['bl-workspace', 'bl-workspace--commercial', 'po-page', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function AdministrationWorkspace({
  children,
  className = '',
  variant = 'page',
}) {
  return (
    <div
      className={[
        'bl-workspace',
        'bl-workspace--admin',
        `bl-workspace--admin-${variant}`,
        'po-page',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export const WORKSPACE_TYPES = {
  STANDARD: 'standard',
  COMMERCIAL: 'commercial',
  ADMINISTRATION: 'administration',
};
