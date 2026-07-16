import { useCallback, useEffect, useRef, useState } from 'react';
import { yieldToUi } from '../../revenue/revenueBulkWorkflow';

export function useRevenueWorkflowState() {
  const [toast, setToast] = useState('');
  const [progress, setProgress] = useState(null);
  const [busyActionKey, setBusyActionKey] = useState(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearToast = useCallback(() => {
    if (mountedRef.current) setToast('');
  }, []);

  const runAction = useCallback(async (actionKey, { progressLabel, execute, buildToast, onPersisted }) => {
    if (busyRef.current) return null;

    busyRef.current = true;
    setBusyActionKey(actionKey);
    setProgress({ label: progressLabel, complete: false });

    try {
      await yieldToUi();
      const result = await Promise.resolve().then(() => execute());

      if (mountedRef.current) {
        onPersisted?.(result);
        setProgress(null);
        busyRef.current = false;
        setBusyActionKey(null);
        if (buildToast) {
          setToast(buildToast(result));
        }
      }

      return result;
    } catch (error) {
      if (mountedRef.current) {
        setProgress(null);
        busyRef.current = false;
        setBusyActionKey(null);
        setToast(error?.message || 'Something went wrong. Please try again.');
      }
      return null;
    }
  }, []);

  return {
    toast,
    progress,
    busyActionKey,
    clearToast,
    setToast,
    runAction,
  };
}
