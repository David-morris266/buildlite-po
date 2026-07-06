import { useEffect, useMemo, useState } from 'react';
import DevelopmentList from './DevelopmentList';
import DevelopmentForm from './DevelopmentForm';
import DevelopmentWorkspace from './DevelopmentWorkspace';
import { getDevelopment } from '../developments/developmentStore';

export default function Developments({
  initialDevelopmentId = null,
  onInitialDevelopmentHandled = null,
}) {
  const [view, setView] = useState('list');
  const [activeDevelopmentId, setActiveDevelopmentId] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!initialDevelopmentId) return;
    setActiveDevelopmentId(initialDevelopmentId);
    setView('workspace');
    onInitialDevelopmentHandled?.();
  }, [initialDevelopmentId, onInitialDevelopmentHandled]);

  const activeDevelopment = useMemo(() => {
    void refreshToken;
    if (!activeDevelopmentId) return null;
    return getDevelopment(activeDevelopmentId);
  }, [activeDevelopmentId, refreshToken]);

  function openWorkspace(developmentId) {
    setActiveDevelopmentId(developmentId);
    setView('workspace');
  }

  function returnToList() {
    setView('list');
    setActiveDevelopmentId(null);
    setRefreshToken((value) => value + 1);
  }

  if (view === 'new') {
    return (
      <DevelopmentForm
        onCancel={returnToList}
        onCreated={(developmentId) => {
          setRefreshToken((value) => value + 1);
          openWorkspace(developmentId);
        }}
      />
    );
  }

  if (view === 'workspace') {
    if (!activeDevelopment) {
      return null;
    }

    return (
      <DevelopmentWorkspace
        development={activeDevelopment}
        onBackToList={returnToList}
        onPlotsChanged={() => setRefreshToken((value) => value + 1)}
        onLedgerChanged={() => setRefreshToken((value) => value + 1)}
        onCvrChanged={() => setRefreshToken((value) => value + 1)}
      />
    );
  }

  return (
    <DevelopmentList
      refreshToken={refreshToken}
      onNewDevelopment={() => setView('new')}
      onOpenDevelopment={openWorkspace}
    />
  );
}
