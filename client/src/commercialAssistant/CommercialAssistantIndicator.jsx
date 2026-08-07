import { useCommercialAssistant } from './CommercialAssistantContext';

export default function CommercialAssistantIndicator() {
  const assistant = useCommercialAssistant();
  if (!assistant) return null;

  const { badgeCounts, openDrawer, scope } = assistant;
  const total = badgeCounts.actionRequired + badgeCounts.warnings;
  const labelParts = [];

  if (badgeCounts.actionRequired > 0) {
    labelParts.push(`${badgeCounts.actionRequired} action required`);
  }
  if (badgeCounts.warnings > 0) {
    labelParts.push(`${badgeCounts.warnings} warnings`);
  }

  const ariaLabel =
    total > 0
      ? `Commercial Assistant, ${labelParts.join(', ')}`
      : scope.developmentId
        ? 'Commercial Assistant, no open action required or warnings'
        : 'Commercial Assistant, open a development to view recommendations';

  return (
    <button
      type="button"
      className="po-assistant-indicator"
      onClick={openDrawer}
      aria-label={ariaLabel}
      title="Commercial Assistant"
    >
      <span className="po-assistant-indicator__icon" aria-hidden="true">
        ◔
      </span>
      <span className="po-assistant-indicator__label">Assistant</span>
      {total > 0 ? (
        <span className="po-assistant-indicator__badge">{total}</span>
      ) : null}
    </button>
  );
}
