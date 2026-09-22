import { createContext, useContext } from 'react';

export const UnsavedChangesContext = createContext(null);

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider');
  }
  return context;
}

export function useOptionalUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
