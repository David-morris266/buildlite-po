import { useEffect, useRef, useState } from 'react';
import { subscribeMasterDataChanged } from '../admin/masterDataEvents';
import {
  createAsyncSequenceGuard,
  resolveLiveSupplier,
  shouldResolveLiveSupplierForPoApproval,
} from './supplierMasterSync';

export function usePoReviewLiveSupplier(po) {
  const needsLive = shouldResolveLiveSupplierForPoApproval(po);
  const supplierId = po?.supplierId || null;
  const [state, setState] = useState(() => ({
    supplier: null,
    loading: needsLive && Boolean(supplierId),
    error: false,
  }));
  const sequenceRef = useRef(createAsyncSequenceGuard());

  useEffect(() => {
    const sequence = createAsyncSequenceGuard();
    sequenceRef.current = sequence;

    if (!needsLive || !supplierId) {
      setState({ supplier: null, loading: false, error: false });
      return undefined;
    }

    let cancelled = false;

    async function fetchLive() {
      const token = sequence.next();
      setState((prev) => ({ ...prev, loading: true, error: false }));

      try {
        const supplier = await resolveLiveSupplier(supplierId);
        if (cancelled || !sequence.isCurrent(token)) return;
        setState({
          supplier,
          loading: false,
          error: !supplier,
        });
      } catch {
        if (cancelled || !sequence.isCurrent(token)) return;
        setState({ supplier: null, loading: false, error: true });
      }
    }

    fetchLive();

    const unsubscribe = subscribeMasterDataChanged((scope) => {
      if (scope === 'suppliers' || scope === 'all') {
        fetchLive();
      }
    });

    return () => {
      cancelled = true;
      sequence.invalidate();
      unsubscribe();
    };
  }, [needsLive, supplierId, po?.poNumber]);

  return state;
}
