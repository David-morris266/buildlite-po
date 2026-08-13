/**
 * BL-028B.3c — Shared server-authority Commercial Event hydration for package routes.
 */
import { useEffect, useState } from 'react';
import { isCommercialEventServerAuthorityEnabled } from './commercialEventAuthority';
import {
  ensureCommercialEventsReadyForDevelopment,
  getCommercialEventsLoadError,
  getCommercialEventsLoadState,
} from './commercialEventServerCache';

export function deriveCommercialEventsUiState(loadState, errorMessage = '') {
  const authorityEnabled = isCommercialEventServerAuthorityEnabled();
  if (!authorityEnabled) {
    return {
      commercialEventsLoading: false,
      commercialEventsReady: true,
      commercialEventsError: '',
      loadState: 'loaded',
    };
  }

  return {
    commercialEventsLoading: loadState === 'loading' || loadState === 'idle',
    commercialEventsReady: loadState === 'loaded',
    commercialEventsError: loadState === 'error' ? errorMessage : '',
    loadState,
  };
}

/**
 * Hydrate server CE cache for a development when authority is ON.
 * Payment Certificates and Development workspace both use this owner.
 */
export function useCommercialEventServerHydration(developmentId) {
  const authorityEnabled = isCommercialEventServerAuthorityEnabled();
  const [loadState, setLoadState] = useState(() => {
    if (!authorityEnabled || !developmentId) return 'loaded';
    return getCommercialEventsLoadState(developmentId) || 'idle';
  });
  const [loadError, setLoadError] = useState(() => {
    if (!authorityEnabled || !developmentId) return '';
    const error = getCommercialEventsLoadError(developmentId);
    return error?.message || '';
  });

  useEffect(() => {
    if (!authorityEnabled || !developmentId) {
      setLoadState('loaded');
      setLoadError('');
      return undefined;
    }

    let cancelled = false;
    const initialState = getCommercialEventsLoadState(developmentId);
    setLoadState(initialState === 'loaded' ? 'loaded' : 'loading');
    setLoadError('');

    ensureCommercialEventsReadyForDevelopment(developmentId)
      .then(() => {
        if (cancelled) return;
        setLoadState(getCommercialEventsLoadState(developmentId));
        setLoadError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState(getCommercialEventsLoadState(developmentId));
        setLoadError(
          error?.message ||
            getCommercialEventsLoadError(developmentId)?.message ||
            'Unable to load Commercial Events. Please try again.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [authorityEnabled, developmentId]);

  return deriveCommercialEventsUiState(loadState, loadError);
}
