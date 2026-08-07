import { useEffect, useRef } from 'react';
import POLoading from './POLoading';

/**
 * Accessible drawer shell — backdrop, focus trap, Escape to close (BL-010B.03).
 * BL-024A.1.1 — Autofocus only on closed → open transition.
 */
export default function PODrawerShell({
  open,
  onClose,
  wide = false,
  ariaLabel = 'Purchase Order details',
  children,
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return undefined;
    }

    const panel = panelRef.current;
    if (!panel) return undefined;

    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;

    const focusables = panel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (justOpened) {
      first?.focus();
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || focusables.length === 0) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="po-drawer-backdrop"
        onClick={() => onCloseRef.current?.()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`po-drawer${wide ? ' po-drawer--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </>
  );
}

export function PODrawerLoading() {
  return <POLoading message="Loading Purchase Order…" />;
}
