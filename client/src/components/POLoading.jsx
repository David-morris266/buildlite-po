/**
 * Calm loading indicator aligned with Setup Assistant motion (BL-010B.02).
 */
export default function POLoading({ message = 'Loading…' }) {
  return (
    <div className="po-loading" role="status" aria-live="polite">
      <div className="po-loading__pulse" aria-hidden="true" />
      <p className="po-loading__message">{message}</p>
    </div>
  );
}
