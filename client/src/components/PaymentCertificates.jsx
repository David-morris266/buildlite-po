import { useEffect, useMemo, useState } from 'react';
import { listPOs } from '../api';
import SubcontractOrdersList from './SubcontractOrdersList';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';
import POLoading from './POLoading';
import { buildSubcontractOrdersFromPos } from '../payments/subcontractOrders';

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

  function openPackage(orderKey, tab = 'overview') {
    setActiveOrderKey(orderKey);
    setActiveTab(tab);
    setView('package');
    setListFeedback(null);
  }

  function returnToList(message) {
    setView('list');
    setActiveOrderKey(null);
    setActiveTab('overview');
    setRefreshToken((value) => value + 1);
    if (message) {
      setListFeedback({ type: 'success', message });
    }
  }

  if (view === 'package') {
    if (loadingOrder || !activeOrder) {
      return <POLoading message="Loading Subcontract Package…" />;
    }

    return (
      <SubcontractPackageWorkspace
        order={activeOrder}
        initialTab={activeTab}
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
