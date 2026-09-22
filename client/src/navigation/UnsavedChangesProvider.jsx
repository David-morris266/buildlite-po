import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UnsavedChangesContext } from './UnsavedChangesContext.js';

export function UnsavedChangesProvider({ children }) {
  const blockerRef = useRef(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const registerUnsavedChanges = useCallback((blocker) => {
    const registration = { ...blocker, id: Symbol('unsaved-changes') };
    blockerRef.current = registration;
    return () => {
      if (blockerRef.current?.id === registration.id) blockerRef.current = null;
    };
  }, []);

  const requestNavigation = useCallback((navigate) => {
    if (typeof navigate !== 'function') return;
    if (!blockerRef.current) {
      navigate();
      return;
    }
    setPendingNavigation(() => navigate);
  }, []);
  const isNavigationBlocked = useCallback(() => Boolean(blockerRef.current), []);

  const stay = useCallback(() => setPendingNavigation(null), []);
  const leave = useCallback(() => {
    const navigate = pendingNavigation;
    setPendingNavigation(null);
    if (navigate) navigate();
  }, [pendingNavigation]);

  const value = useMemo(
    () => ({ registerUnsavedChanges, requestNavigation, isNavigationBlocked }),
    [registerUnsavedChanges, requestNavigation, isNavigationBlocked]
  );
  const blocker = blockerRef.current;

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {pendingNavigation && blocker
        ? createPortal(
            <div className="po-cert-delete-backdrop unsaved-changes" role="presentation">
              <section
                className="po-cert-delete modal unsaved-changes__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="unsaved-changes-title"
                aria-describedby="unsaved-changes-message"
              >
                <h2 id="unsaved-changes-title">{blocker.title}</h2>
                <p id="unsaved-changes-message">{blocker.message}</p>
                <div className="modal-actions unsaved-changes__actions">
                  <button className="btn" type="button" onClick={stay} autoFocus>
                    Stay
                  </button>
                  <button className="btn btn--primary" type="button" onClick={leave}>
                    Leave without saving
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </UnsavedChangesContext.Provider>
  );
}
