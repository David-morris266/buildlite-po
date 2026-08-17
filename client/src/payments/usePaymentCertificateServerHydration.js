/**
 * BL-030B — Shared server-authority Payment Certificate hydration.
 */
import { useEffect, useState } from 'react';
import { fetchPackageByOrderKey } from './packageStore';
import { resolvePackageUuidFromOrder } from './orderMatrixServerMutations';
import { isPaymentCertificateServerAuthorityEnabled } from './paymentCertificateAuthority';
import {
  ensureCertificatesReadyForPackage,
  getCertificateLoadError,
  getCertificateLoadState,
  rememberPackageUuidForOrderKey,
} from './paymentCertificateServerCache';

export function derivePaymentCertificateUiState(loadState, errorMessage = '') {
  const authorityEnabled = isPaymentCertificateServerAuthorityEnabled();
  if (!authorityEnabled) {
    return {
      certificatesLoading: false,
      certificatesReady: true,
      certificatesError: '',
      loadState: 'loaded',
    };
  }

  return {
    certificatesLoading: loadState === 'loading' || loadState === 'idle',
    certificatesReady: loadState === 'loaded',
    certificatesError: loadState === 'error' ? errorMessage : '',
    loadState,
  };
}

async function resolveHydrationPackageUuid(order) {
  const fromContext = resolvePackageUuidFromOrder(order);
  if (fromContext) return fromContext;
  if (!order?.orderKey) return null;
  try {
    const pkg = await fetchPackageByOrderKey(order.orderKey);
    return pkg?.id || null;
  } catch {
    return null;
  }
}

/**
 * Hydrate server certificates for one package when authority is ON.
 */
export function usePaymentCertificateServerHydration(order) {
  const authorityEnabled = isPaymentCertificateServerAuthorityEnabled();
  const orderKey = order?.orderKey || null;
  const [loadState, setLoadState] = useState(() => {
    if (!authorityEnabled || !orderKey) return 'loaded';
    const packageUuid = resolvePackageUuidFromOrder(order);
    return packageUuid ? getCertificateLoadState(packageUuid) || 'idle' : 'idle';
  });
  const [loadError, setLoadError] = useState('');
  const packageUuidHint =
    order?.packageUuid || order?.packageId || order?.id || null;

  useEffect(() => {
    if (!authorityEnabled || !orderKey) {
      setLoadState('loaded');
      setLoadError('');
      return undefined;
    }

    let cancelled = false;
    setLoadState('loading');
    setLoadError('');

    (async () => {
      const packageUuid = await resolveHydrationPackageUuid(order);
      if (cancelled) return;
      if (!packageUuid) {
        setLoadState('error');
        setLoadError(
          'Unable to load payment certificates because this package has no server identity.'
        );
        return;
      }

      rememberPackageUuidForOrderKey(orderKey, packageUuid);
      try {
        await ensureCertificatesReadyForPackage(packageUuid);
        if (cancelled) return;
        setLoadState(getCertificateLoadState(packageUuid));
        setLoadError('');
      } catch (error) {
        if (cancelled) return;
        setLoadState(getCertificateLoadState(packageUuid));
        setLoadError(
          error?.message ||
            getCertificateLoadError(packageUuid)?.message ||
            'Unable to load certificate data. Please try again.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authorityEnabled, orderKey, packageUuidHint]);

  return derivePaymentCertificateUiState(loadState, loadError);
}
