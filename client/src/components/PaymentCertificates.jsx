import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPOs } from '../api';
import SubcontractOrdersList from './SubcontractOrdersList';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';
import PackageWorkspaceNotFound from './PackageWorkspaceNotFound';
import POLoading from './POLoading';
import { buildAssistantPackagesForDevelopment } from '../commercialAssistant/commercialAssistantPackageScope';
import { buildSubcontractOrdersFromPos } from '../payments/subcontractOrders';
import {
  buildPackageWorkspaceLaunchContext,
  getPackageLaunchErrorMessage,
  PACKAGE_OPENED_FROM,
} from '../payments/packageWorkspaceLaunch';

export default function PaymentCertificates({
  initialOrderKey = null,
  initialTab = 'overview',
  onInitialOrderHandled = null,
}) {
  const [view, setView] = useState('list');
  const [activeOrderKey, setActiveOrderKey] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [orders, setOrders] = useState([]);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [listFeedback, setListFeedback] = useState(null);
  const [commercialEventTarget, setCommercialEventTarget] = useState(null);
  const [certificateTarget, setCertificateTarget] = useState(null);

  useEffect(() => {
    if (!initialOrderKey) return;
    setActiveOrderKey(initialOrderKey);
    setActiveTab(initialTab || 'overview');
    setView('package');
    onInitialOrderHandled?.();
  }, [initialOrderKey, initialTab, onInitialOrderHandled]);

  useEffect(() => {
    if (view !== 'package' || !activeOrderKey) return;

    let cancelled = false;
    (async () => {
      try {
        setLoadingOrder(true);
        const data = await listPOs({ pageSize: 500, archived: 'false' });
        const items = Array.isArray(data) ? data : data.items || [];
        if (cancelled) return;
        setOrders(buildSubcontractOrdersFromPos(items));
      } finally {
        if (!cancelled) setLoadingOrder(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, activeOrderKey, refreshToken]);

  const activeOrder = useMemo(
    () => orders.find((order) => order.orderKey === activeOrderKey) || null,
    [orders, activeOrderKey]
  );

  const assistantDevelopmentPackages = useMemo(() => {
    if (!activeOrder?.developmentId) return [];
    return buildAssistantPackagesForDevelopment(activeOrder.developmentId, orders);
  }, [activeOrder?.developmentId, orders]);

  const navigationContext = useMemo(() => {
    if (!activeOrderKey) return null;
    return buildPackageWorkspaceLaunchContext({
      orderKey: activeOrderKey,
      packageRow: activeOrder,
      openedFrom: PACKAGE_OPENED_FROM.PaymentCertificates,
      initialTab: activeTab,
      developmentId: activeOrder?.developmentId || null,
      commercialEventTarget,
      certificateTarget,
    });
  }, [activeOrderKey, activeOrder, activeTab, commercialEventTarget, certificateTarget]);

  const handleAssistantNavigation = useCallback(
    (resolution) => {
      if (!resolution?.launch) return;

      const launch = resolution.launch;
      setCommercialEventTarget(launch.commercialEventTarget || null);
      setCertificateTarget(launch.certificateTarget || null);

      if (launch.orderKey && launch.orderKey !== activeOrderKey) {
        setActiveOrderKey(launch.orderKey);
      }

      setActiveTab(launch.initialTab || 'overview');
      setView('package');
    },
    [activeOrderKey]
  );

  function openPackage(orderKey, tab = 'overview') {
    setActiveOrderKey(orderKey);
    setActiveTab(tab);
    setCommercialEventTarget(null);
    setCertificateTarget(null);
    setView('package');
    setListFeedback(null);
  }

  function returnToList(message) {
    setView('list');
    setActiveOrderKey(null);
    setActiveTab('overview');
    setCommercialEventTarget(null);
    setCertificateTarget(null);
    setRefreshToken((value) => value + 1);
    if (message) {
      setListFeedback({ type: 'success', message });
    }
  }

  if (view === 'package') {
    if (loadingOrder) {
      return <POLoading message="Loading Subcontract Package…" />;
    }

    const launchError = getPackageLaunchErrorMessage(navigationContext, activeOrder);
    if (launchError) {
      return (
        <PackageWorkspaceNotFound
          message={launchError}
          onBack={() => returnToList()}
          breadcrumbs={[{ label: 'Certificates' }]}
          title="Package unavailable"
        />
      );
    }

    return (
      <SubcontractPackageWorkspace
        order={activeOrder}
        initialTab={activeTab}
        navigationContext={navigationContext}
        commercialEventTarget={commercialEventTarget}
        certificateTarget={certificateTarget}
        assistantDevelopmentPackages={assistantDevelopmentPackages}
        onAssistantNavigate={handleAssistantNavigation}
        onBackToList={() => returnToList()}
      />
    );
  }

  return (
    <SubcontractOrdersList
      refreshToken={refreshToken}
      listFeedback={listFeedback}
      onDismissFeedback={() => setListFeedback(null)}
      onOpenPackage={openPackage}
    />
  );
}
