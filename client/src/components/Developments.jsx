import { useEffect, useMemo, useState } from 'react';
import DevelopmentList from './DevelopmentList';
import DevelopmentForm from './DevelopmentForm';
import DevelopmentWorkspace from './DevelopmentWorkspace';
import { StandardWorkspace } from './layout/WorkspaceShell';
import {
  ensureDevelopmentsReady,
  getDevelopment,
  refreshDevelopment,
} from '../developments/developmentStore';

export default function Developments({
  initialDevelopmentId = null,
  initialWorkspaceTab = null,
  initialCvrPeriodKey = null,
  navigationOrigin = null,
  onInitialDevelopmentHandled = null,
  onOpenPackage = null,
}) {
  const [view, setView] = useState('list');
  const [activeDevelopmentId, setActiveDevelopmentId] = useState(null);
  const [workspaceTab, setWorkspaceTab] = useState(null);
  const [cvrPeriodKey, setCvrPeriodKey] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [workspaceResolveError, setWorkspaceResolveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) {
          setReady(true);
          setLoadError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReady(false);
          setLoadError(error.message || 'Could not load developments from the server.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!initialDevelopmentId) return;
    setActiveDevelopmentId(initialDevelopmentId);
    setWorkspaceTab(initialWorkspaceTab);
    setCvrPeriodKey(initialCvrPeriodKey);
    setView('workspace');
    onInitialDevelopmentHandled?.();
  }, [initialDevelopmentId, initialWorkspaceTab, initialCvrPeriodKey, onInitialDevelopmentHandled]);

  const activeDevelopment = useMemo(() => {
    void refreshToken;
    if (!activeDevelopmentId) return null;
    return getDevelopment(activeDevelopmentId);
  }, [activeDevelopmentId, refreshToken]);

  useEffect(() => {
    if (view !== 'workspace' || !activeDevelopmentId || activeDevelopment) {
      setWorkspaceResolveError('');
      return undefined;
    }

    let cancelled = false;
    setWorkspaceResolveError('');

    refreshDevelopment(activeDevelopmentId)
      .then(() => {
        if (!cancelled) {
          setRefreshToken((value) => value + 1);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceResolveError(
            error?.message || 'This development could not be loaded from the server.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [view, activeDevelopmentId, activeDevelopment]);

  function openWorkspace(developmentId) {
    setWorkspaceResolveError('');
    setActiveDevelopmentId(developmentId);
    setView('workspace');
  }

  function returnToList() {
    setView('list');
    setActiveDevelopmentId(null);
    setWorkspaceResolveError('');
    setRefreshToken((value) => value + 1);
  }

  async function handleDevelopmentChanged() {
    if (activeDevelopmentId) {
      try {
        await refreshDevelopment(activeDevelopmentId);
      } catch {
        // Workspace refresh token still updates cached view when available.
      }
    }
    setRefreshToken((value) => value + 1);
  }

  if (!ready && !loadError) {
    return (
      <StandardWorkspace>
        <div className="po-module-card">
          <p>Loading developments…</p>
        </div>
      </StandardWorkspace>
    );
  }

  if (loadError) {
    return (
      <StandardWorkspace>
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {loadError}
        </div>
      </StandardWorkspace>
    );
  }

  if (view === 'new') {
    return (
      <StandardWorkspace>
        <DevelopmentForm
          onCancel={returnToList}
          onCreated={(developmentId) => {
            setRefreshToken((value) => value + 1);
            openWorkspace(developmentId);
          }}
        />
      </StandardWorkspace>
    );
  }

  if (view === 'workspace') {
    if (!activeDevelopment) {
      if (workspaceResolveError) {
        return (
          <StandardWorkspace>
            <div className="po-module-card">
              <div
                className="po-list-feedback po-list-feedback--error"
                role="alert"
              >
                {workspaceResolveError}
              </div>
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={returnToList}
              >
                Back to Developments
              </button>
            </div>
          </StandardWorkspace>
        );
      }

      return (
        <StandardWorkspace>
          <div className="po-module-card">
            <p>Resolving development…</p>
          </div>
        </StandardWorkspace>
      );
    }

    return (
      <DevelopmentWorkspace
        development={activeDevelopment}
        navigationOrigin={navigationOrigin}
        initialActiveTab={workspaceTab}
        initialCvrPeriodKey={cvrPeriodKey}
        onBackToList={returnToList}
        onPlotsChanged={() => setRefreshToken((value) => value + 1)}
        onLedgerChanged={() => setRefreshToken((value) => value + 1)}
        onCvrChanged={() => setRefreshToken((value) => value + 1)}
        onDevelopmentChanged={handleDevelopmentChanged}
        onOpenPackage={onOpenPackage}
      />
    );
  }

  return (
    <StandardWorkspace>
      <DevelopmentList
        refreshToken={refreshToken}
        onNewDevelopment={() => setView('new')}
        onOpenDevelopment={openWorkspace}
      />
    </StandardWorkspace>
  );
}
