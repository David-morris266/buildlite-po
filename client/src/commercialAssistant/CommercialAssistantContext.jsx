import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { COMMERCIAL_ASSISTANT_CONFIG } from './commercialAssistantConfig';
import { resolveCommercialAssistantNavigation } from './commercialAssistantNavigation';
import {
  deferRecommendation,
  dismissRecommendation,
} from './recommendationDispositionStore';
import { buildAssistantRecommendationSnapshot } from './recommendationEngine';
import { ensureCommercialAssistantProvidersRegistered } from './registerCommercialAssistantProviders';
import {
  isEmptyScope,
  normalizeScope,
  scopesEqual,
} from './commercialAssistantScope';

const CommercialAssistantContext = createContext(null);

export function CommercialAssistantProvider({ children }) {
  const [scope, setScope] = useState({
    developmentId: null,
    packages: [],
    onNavigate: null,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [navigationError, setNavigationError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    ensureCommercialAssistantProvidersRegistered();
  }, []);

  const requestRefresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setRefreshToken((value) => value + 1);
    }, COMMERCIAL_ASSISTANT_CONFIG.refreshDebounceMs);
  }, []);

  useEffect(() => {
    return subscribeCommercialChanged(() => {
      requestRefresh();
    });
  }, [requestRefresh]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const snapshot = useMemo(() => {
    void refreshToken;
    return buildAssistantRecommendationSnapshot({
      developmentId: scope.developmentId,
      packages: scope.packages,
    });
  }, [scope.developmentId, scope.packages, refreshToken]);

  const setAssistantScope = useCallback((nextScope) => {
    const normalized = normalizeScope(nextScope);
    setScope((current) => (scopesEqual(current, normalized) ? current : normalized));
  }, []);

  const clearAssistantScope = useCallback(() => {
    setScope((current) =>
      isEmptyScope(current)
        ? current
        : { developmentId: null, packages: [], onNavigate: null }
    );
  }, []);

  const openDrawer = useCallback(() => {
    setNavigationError('');
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setNavigationError('');
  }, []);

  const dismiss = useCallback(
    ({ fingerprint, reason = '' } = {}) => {
      const result = dismissRecommendation(fingerprint, { reason });
      if (result.ok) requestRefresh();
      return result;
    },
    [requestRefresh]
  );

  const defer = useCallback(
    ({ fingerprint, deferUntil = null, deferReason = '' } = {}) => {
      const result = deferRecommendation(fingerprint, { deferUntil, deferReason });
      if (result.ok) requestRefresh();
      return result;
    },
    [requestRefresh]
  );

  const navigateToRecommendation = useCallback(
    (recommendation) => {
      setNavigationError('');
      const resolution = resolveCommercialAssistantNavigation(
        recommendation?.navigationTarget,
        {
          developmentId: scope.developmentId,
          packages: scope.packages,
        }
      );

      if (!resolution.ok) {
        const message =
          resolution.errors?.[0] || 'Unable to open the related commercial record';
        setNavigationError(message);
        return { ok: false, errors: resolution.errors || [message] };
      }

      scope.onNavigate?.(resolution);
      setDrawerOpen(false);
      return { ok: true, resolution };
    },
    [scope.developmentId, scope.packages, scope.onNavigate]
  );

  const value = useMemo(
    () => ({
      scope,
      setAssistantScope,
      clearAssistantScope,
      recommendations: snapshot.visible,
      badgeCounts: snapshot.badgeCounts,
      drawerOpen,
      openDrawer,
      closeDrawer,
      dismiss,
      defer,
      navigateToRecommendation,
      navigationError,
      refreshAssistant: requestRefresh,
    }),
    [
      scope,
      setAssistantScope,
      clearAssistantScope,
      snapshot.visible,
      snapshot.badgeCounts,
      drawerOpen,
      openDrawer,
      closeDrawer,
      dismiss,
      defer,
      navigateToRecommendation,
      navigationError,
      requestRefresh,
    ]
  );

  return (
    <CommercialAssistantContext.Provider value={value}>
      {children}
    </CommercialAssistantContext.Provider>
  );
}

export function useCommercialAssistant() {
  return useContext(CommercialAssistantContext);
}

export function useCommercialAssistantScope(scope, deps = [], options = {}) {
  const { enabled = true } = options;
  const { setAssistantScope, clearAssistantScope } = useCommercialAssistant() ?? {};
  const developmentId = scope?.developmentId || null;
  const packages = scope?.packages || [];
  const onNavigate = scope?.onNavigate || null;

  useEffect(() => {
    if (!setAssistantScope || !clearAssistantScope) return undefined;
    if (!enabled) return undefined;

    if (!developmentId) {
      clearAssistantScope();
      return undefined;
    }

    setAssistantScope({ developmentId, packages, onNavigate });
    return () => clearAssistantScope();
  }, [
    enabled,
    setAssistantScope,
    clearAssistantScope,
    developmentId,
    packages,
    onNavigate,
    ...deps,
  ]);
}
