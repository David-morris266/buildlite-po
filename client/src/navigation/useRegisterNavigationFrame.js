import { useEffect } from 'react';
import { useOptionalNavigation } from './NavigationContext';
import { createNavigationFrame } from './navigationTypes';

/**
 * Registers the current page with the application navigation stack.
 * Unregisters automatically on unmount.
 */
export default function useRegisterNavigationFrame(frame, { enabled = true } = {}) {
  const navigation = useOptionalNavigation();

  useEffect(() => {
    if (!navigation || !enabled || !frame?.id) return undefined;

    const payload = createNavigationFrame(frame);
    return navigation.registerFrame(payload);
  }, [
    navigation,
    enabled,
    frame?.id,
    frame?.label,
    frame?.title,
    frame?.lead,
    frame?.onNavigate,
  ]);
}
