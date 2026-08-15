/**
 * BL-029B — Shared server-authority Order Matrix hydration for package routes.
 */
import { useEffect, useState } from 'react';
import { isOrderMatrixServerAuthorityEnabled } from './orderMatrixAuthority';
import {
  ensureMatricesReadyForDevelopment,
  getOrderMatricesLoadError,
  getOrderMatricesLoadState,
} from './orderMatrixServerCache';

export function deriveOrderMatrixUiState(loadState, errorMessage = '') {
  const authorityEnabled = isOrderMatrixServerAuthorityEnabled();
  if (!authorityEnabled) {
    return {
      matricesLoading: false,
      matricesReady: true,
      matricesError: '',
      loadState: 'loaded',
    };
  }

  return {
    matricesLoading: loadState === 'loading' || loadState === 'idle',
    matricesReady: loadState === 'loaded',
    matricesError: loadState === 'error' ? errorMessage : '',
    loadState,
  };
}

/**
 * Hydrate server matrix cache for a development when authority is ON.
 * Payment Certificates and Development workspace both use this owner.
 */
export function useOrderMatrixServerHydration(developmentId) {
  const authorityEnabled = isOrderMatrixServerAuthorityEnabled();
  const [loadState, setLoadState] = useState(() => {
    if (!authorityEnabled || !developmentId) return 'loaded';
    return getOrderMatricesLoadState(developmentId) || 'idle';
  });
  const [loadError, setLoadError] = useState(() => {
    if (!authorityEnabled || !developmentId) return '';
    const error = getOrderMatricesLoadError(developmentId);
    return error?.message || '';
  });

  useEffect(() => {
    if (!authorityEnabled || !developmentId) {
      setLoadState('loaded');
      setLoadError('');
      return undefined;
    }

    let cancelled = false;
    const initialState = getOrderMatricesLoadState(developmentId);
    setLoadState(initialState === 'loaded' ? 'loaded' : 'loading');
    setLoadError('');

    ensureMatricesReadyForDevelopment(developmentId)
      .then(() => {
        if (cancelled) return;
        setLoadState(getOrderMatricesLoadState(developmentId));
        setLoadError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState(getOrderMatricesLoadState(developmentId));
        setLoadError(
          error?.message ||
            getOrderMatricesLoadError(developmentId)?.message ||
            'Unable to load order matrix data. Please try again.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [authorityEnabled, developmentId]);

  return deriveOrderMatrixUiState(loadState, loadError);
}
