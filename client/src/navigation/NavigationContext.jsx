import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  buildBreadcrumbsFromStack,
  getCurrentNavigationFrame,
  getParentNavigationFrame,
  goBackOnStack,
  pushNavigationFrame,
  replaceNavigationStack,
} from './navigationService';

const NavigationContext = createContext(null);

export function NavigationProvider({ children }) {
  const [stack, setStack] = useState([]);
  const [origin, setOriginState] = useState(null);

  const registerFrame = useCallback((frame) => {
    if (!frame?.id) return () => {};

    setStack((prev) => pushNavigationFrame(prev, frame));

    return () => {
      setStack((prev) => prev.filter((item) => item.id !== frame.id));
    };
  }, []);

  const replaceStack = useCallback((nextStack) => {
    setStack(replaceNavigationStack(nextStack));
  }, []);

  const setOrigin = useCallback((nextOrigin) => {
    setOriginState(nextOrigin || null);
  }, []);

  const clearOrigin = useCallback(() => {
    setOriginState(null);
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => {
      const result = goBackOnStack(prev);
      return result.handled ? result.stack : prev;
    });
  }, []);

  const value = useMemo(
    () => ({
      stack,
      origin,
      breadcrumbs: buildBreadcrumbsFromStack(stack),
      currentFrame: getCurrentNavigationFrame(stack),
      parentFrame: getParentNavigationFrame(stack),
      registerFrame,
      replaceStack,
      setOrigin,
      clearOrigin,
      goBack,
      canGoBack: stack.length > 1,
    }),
    [stack, origin, registerFrame, replaceStack, setOrigin, clearOrigin, goBack]
  );

  return (
    <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

export function useOptionalNavigation() {
  return useContext(NavigationContext);
}
