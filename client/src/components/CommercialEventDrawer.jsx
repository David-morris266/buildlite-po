import { useEffect, useMemo, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import { listPOs } from '../api';
import { formatPoDate, formatPoDateTime, formatMoney } from './poDrawerHelpers';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
  getCommercialEventCategoryMeta,
  getCommercialEventRecoveryStatusMeta,
  getCommercialEventResponsibilityMeta,
  getCommercialEventStatusMeta,
  getCommercialEventSubcategoryMeta,
  getCommercialEventTypeMeta,
  isCommercialEventEditable,
  listCommercialEventCategoryOptions,
  listCommercialEventResponsibilityOptions,
  listCommercialEventTypeOptions,
  listCommercialEventVatTreatmentOptions,
  canApproveCommercialEvent,
  canCloseCommercialEvent,
  canRejectCommercialEvent,
  canSubmitCommercialEvent,
} from '../commercialEvents/commercialEventTypes';
import {
  createCommercialEvent,
  updateCommercialEventDraft,
  submitCommercialEvent,
  approveCommercialEvent,
  rejectCommercialEvent,
  closeCommercialEvent,
  createLinkedRecoveryFromOrigin,
  markPotentialContraChargeNotRequired,
  getCommercialEventById,
} from '../commercialEvents/commercialEventStore';
import { getCommercialEventAuditActionLabel } from '../commercialEvents/commercialEventPackageValue';
import {
  getLinkedCommercialEvent,
  hasLinkedRecovery,
} from '../commercialEvents/commercialEventRecovery';
import { getLinkedEventNavigationLabel } from '../commercialEvents/commercialEventNavigation';
import {
  buildRecoveryPackageOptions,
  formatRecoveryPackageOptionLabel,
} from '../commercialEvents/commercialEventRecoveryPackages';
import {
  canEditPotentialContraFields,
  canShowPotentialContraBanner,
  isRecoveryCommercialEvent,
} from '../commercialEvents/commercialEventRegisterBadges';

const EMPTY_FORM = {
  eventType: COMMERCIAL_EVENT_TYPES.variation.key,
  category: 'commercial',
  subcategory: 'scopeChange',
  responsibility: 'commercial',
  description: '',
  value: '',
  vatTreatment: 'standard',
  dateRaised: new Date().toISOString().slice(0, 10),
  potentialContraCharge: false,
  potentialContraChargeNotes: '',
};

function StatusBadge({ statusKey }) {
  const status = getCommercialEventStatusMeta(statusKey);
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function RecoveryStatusBadge({ recoveryStatusKey }) {
  const status = getCommercialEventRecoveryStatusMeta(recoveryStatusKey);
  return (
    <span className="po-status-badge po-status-badge--muted">{status.label}</span>
  );
}

function DrawerSection({ title, children, defaultOpen = true, tone = 'default' }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`po-ce-drawer__section po-ce-drawer__section--${tone}`}>
      <button
        type="button"
        className="po-ce-drawer__section-heading"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <span className="po-ce-drawer__section-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? <div className="po-ce-drawer__section-body">{children}</div> : null}
    </section>
  );
}

function RelatedEventPanel({
  developmentId,
  event,
  actionLabel,
  onOpenLinked,
}) {
  const linked = getLinkedCommercialEvent(developmentId, event);
  if (!linked) {
    return (
      <div className="po-ce-drawer__linked-unavailable">
        <p className="po-ce-drawer__helper">
          Related commercial event is no longer available.
        </p>
      </div>
    );
  }

  const packageLabel = linked.supplierId
    ? `${linked.supplierId}${linked.costCode ? ` · ${linked.costCode}` : ''}`
    : linked.packageId || '—';

  return (
    <div className="po-ce-drawer__linked-summary">
      <dl className="po-ce-drawer__linked-facts">
        <div>
          <dt>Event</dt>
          <dd>{linked.eventNumber}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{getCommercialEventTypeMeta(linked.eventType).label}</dd>
        </div>
        <div>
          <dt>Package</dt>
          <dd>{packageLabel}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd className={Number(linked.value) < 0 ? 'po-ce-value--negative' : ''}>
            £{formatMoney(linked.value)}
          </dd>
        </div>
        <div>
          <dt>Commercial status</dt>
          <dd>
            <StatusBadge statusKey={linked.status} />
          </dd>
        </div>
        {isRecoveryCommercialEvent(linked) ? (
          <div>
            <dt>Recovery status</dt>
            <dd>
              <RecoveryStatusBadge recoveryStatusKey={linked.recoveryStatus} />
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="po-ce-drawer__linked-description">{linked.description}</p>
      {onOpenLinked ? (
        <button
          type="button"
          className="po-ce-drawer__nav-action po-ce-drawer__nav-action--primary"
          onClick={() => onOpenLinked(linked)}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default function CommercialEventDrawer({
  open,
  mode = 'create',
  event,
  order,
  onClose,
  onSaved,
  onLinkedRecoveryCreated = null,
  onNavigateToLinkedEvent = null,
  onOpenPackage = null,
  openPackageLabel = 'Open Package',
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [workflowComment, setWorkflowComment] = useState('');
  const [errors, setErrors] = useState([]);
  const [createContraStep, setCreateContraStep] = useState(null);
  const [dismissStep, setDismissStep] = useState(false);
  const [dismissComment, setDismissComment] = useState('');
  const [recoveryPackageOptions, setRecoveryPackageOptions] = useState([]);
  const [selectedRecoveryPackageId, setSelectedRecoveryPackageId] = useState('');
  const [createContraComment, setCreateContraComment] = useState('');
  const [loadingPackages, setLoadingPackages] = useState(false);

  const isCreate = mode === 'create';

  const liveEvent = useMemo(() => {
    if (!event || !order?.developmentId) return event;
    return getCommercialEventById(order.developmentId, event.id) || event;
  }, [event, order?.developmentId, open, createContraStep, dismissStep]);

  const drawerEvent = liveEvent || event;
  const isRecoveryEvent = isRecoveryCommercialEvent(drawerEvent);
  const editable =
    (isCreate || mode === 'edit') &&
    (!drawerEvent || isCommercialEventEditable(drawerEvent.status));
  const canEditPotentialContra = canEditPotentialContraFields(drawerEvent, editable);
  const showPotentialContraBanner = canShowPotentialContraBanner(drawerEvent);

  const subcategoryOptions = useMemo(() => {
    const category = getCommercialEventCategoryMeta(form.category);
    return category.subcategories || [];
  }, [form.category]);

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setWorkflowComment('');
    setCreateContraStep(null);
    setDismissStep(false);
    setDismissComment('');
    setCreateContraComment('');
    setSelectedRecoveryPackageId('');

    if (event && !isCreate) {
      setForm({
        eventType: event.eventType,
        category: event.category,
        subcategory: event.subcategory || '',
        responsibility: event.responsibility,
        description: event.description || '',
        value: String(event.value ?? ''),
        vatTreatment: event.vatTreatment || 'standard',
        dateRaised: event.dateRaised || new Date().toISOString().slice(0, 10),
        potentialContraCharge: Boolean(event.potentialContraCharge),
        potentialContraChargeNotes: event.potentialContraChargeNotes || '',
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        dateRaised: new Date().toISOString().slice(0, 10),
      });
    }
  }, [open, event, isCreate]);

  useEffect(() => {
    if (!open || createContraStep !== 'picker' || !order?.developmentId) return;

    let cancelled = false;
    setLoadingPackages(true);

    listPOs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        const options = buildRecoveryPackageOptions(
          order.developmentId,
          order.orderKey,
          items
        );
        setRecoveryPackageOptions(options);
        setSelectedRecoveryPackageId(options[0]?.orderKey || '');
      })
      .catch(() => {
        if (!cancelled) {
          setErrors(['Unable to load development packages for contra charge creation']);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPackages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, createContraStep, order?.developmentId, order?.orderKey]);

  function updateField(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'category') {
        const category = getCommercialEventCategoryMeta(value);
        next.subcategory = category.subcategories?.[0]?.key || '';
      }
      if (field === 'value' && isRecoveryEvent) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
          next.value = String(-Math.abs(numeric));
        }
      }
      return next;
    });
  }

  function buildPayload() {
    return {
      packageId: order.orderKey,
      poNumber: order.poNumbers?.[0] || '',
      supplierId: order.supplierId || '',
      costCode: order.costCode || '',
      eventType: form.eventType,
      category: form.category,
      subcategory: form.subcategory,
      responsibility: form.responsibility,
      description: form.description,
      value: Number(form.value),
      vatTreatment: form.vatTreatment,
      dateRaised: form.dateRaised,
      potentialContraCharge: canEditPotentialContra
        ? Boolean(form.potentialContraCharge)
        : undefined,
      potentialContraChargeNotes: canEditPotentialContra
        ? form.potentialContraChargeNotes
        : undefined,
    };
  }

  function handleSaveDraft(submitEvent) {
    submitEvent.preventDefault();
    if (!order?.developmentId || !order?.orderKey) return;

    if (isRecoveryEvent && Number(form.value) >= 0) {
      setErrors(['Recovery contra charge value must remain negative']);
      return;
    }

    const payload = buildPayload();
    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );

    const result = isCreate
      ? createCommercialEvent(order.developmentId, cleanedPayload)
      : updateCommercialEventDraft(order.developmentId, event.id, cleanedPayload);

    if (!result.ok) {
      setErrors(result.errors || ['Unable to save event']);
      return;
    }

    onSaved?.(result.event);
    onClose?.();
  }

  function runWorkflow(action) {
    if (!event || !order?.developmentId) return;
    const options = { comment: workflowComment };

    const handlers = {
      submit: () => submitCommercialEvent(order.developmentId, event.id, options),
      approve: () => approveCommercialEvent(order.developmentId, event.id, options),
      reject: () => rejectCommercialEvent(order.developmentId, event.id, options),
      close: () => closeCommercialEvent(order.developmentId, event.id, options),
    };

    const result = handlers[action]?.();
    if (!result?.ok) {
      setErrors(result?.errors || ['Workflow action failed']);
      return;
    }

    onSaved?.(result.event);
    onClose?.();
  }

  function handleCreateContraCharge() {
    setErrors([]);
    setCreateContraStep('picker');
  }

  function handleConfirmCreateContraCharge() {
    if (!liveEvent || !order?.developmentId) return;

    if (!selectedRecoveryPackageId) {
      setErrors(['Select a responsible subcontract package']);
      return;
    }

    const result = createLinkedRecoveryFromOrigin(
      order.developmentId,
      liveEvent.id,
      {
        recoveryPackageId: selectedRecoveryPackageId,
        comment: createContraComment,
      }
    );

    if (!result.ok) {
      setErrors(result.errors || ['Unable to create linked contra charge']);
      return;
    }

    onSaved?.(result.origin);
    onLinkedRecoveryCreated?.(result.recovery, result.origin);
    setCreateContraStep(null);
    onClose?.();
  }

  function handleDismissPotentialContra() {
    if (!liveEvent || !order?.developmentId) return;

    const result = markPotentialContraChargeNotRequired(
      order.developmentId,
      liveEvent.id,
      { comment: dismissComment }
    );

    if (!result.ok) {
      setErrors(result.errors || ['Unable to dismiss potential contra charge']);
      return;
    }

    onSaved?.(result.event);
    setDismissStep(false);
    onClose?.();
  }

  const drawerTitle = isCreate
    ? 'New Commercial Event'
    : `${liveEvent?.eventNumber || event?.eventNumber || 'Commercial Event'}`;

  const selectedPackage = recoveryPackageOptions.find(
    (option) => option.orderKey === selectedRecoveryPackageId
  );

  return (
    <PODrawerShell
      open={open}
      onClose={onClose}
      wide
      ariaLabel={drawerTitle}
    >
      <div className="po-ce-drawer">
        <header className="po-ce-drawer__header">
          <div>
            <p className="po-ce-drawer__eyebrow">Commercial Events</p>
            <h2 className="po-ce-drawer__title">{drawerTitle}</h2>
            {liveEvent ? (
              <div className="po-ce-drawer__status">
                <StatusBadge statusKey={liveEvent.status} />
                {isRecoveryEvent ? (
                  <RecoveryStatusBadge recoveryStatusKey={liveEvent.recoveryStatus} />
                ) : null}
              </div>
            ) : null}
          </div>
          <button type="button" className="po-drawer-close" onClick={onClose}>
            Close
          </button>
        </header>

        {liveEvent &&
        !createContraStep &&
        !dismissStep &&
        (onOpenPackage || (hasLinkedRecovery(liveEvent) && onNavigateToLinkedEvent)) ? (
          <nav className="po-ce-drawer__nav" aria-label="Commercial event navigation">
            {onOpenPackage ? (
              <button
                type="button"
                className="po-ce-drawer__nav-action"
                onClick={onOpenPackage}
              >
                {openPackageLabel}
              </button>
            ) : null}
            {hasLinkedRecovery(liveEvent) && onNavigateToLinkedEvent ? (
              <button
                type="button"
                className="po-ce-drawer__nav-action po-ce-drawer__nav-action--primary"
                onClick={() => onNavigateToLinkedEvent(liveEvent)}
              >
                {getLinkedEventNavigationLabel(liveEvent)}
              </button>
            ) : null}
          </nav>
        ) : null}

        {errors.length ? (
          <ul className="po-ce-drawer__errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        {showPotentialContraBanner && !createContraStep && !dismissStep ? (
          <section className="po-ce-drawer__potential-banner" role="status">
            <div>
              <strong>Potential Contra Charge — not yet raised</strong>
              {liveEvent?.potentialContraChargeNotes ? (
                <p>{liveEvent.potentialContraChargeNotes}</p>
              ) : null}
            </div>
            <div className="po-ce-drawer__actions">
              <button
                type="button"
                className="po-btn-primary"
                onClick={handleCreateContraCharge}
              >
                Create Contra Charge
              </button>
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={() => setDismissStep(true)}
              >
                Mark Not Required
              </button>
            </div>
          </section>
        ) : null}

        {dismissStep ? (
          <section className="po-ce-drawer__workflow">
            <h3>Mark potential contra charge not required</h3>
            <p className="po-ce-drawer__helper">
              Confirm that no contra charge will be raised against another contractor
              for this event.
            </p>
            <label className="po-ce-drawer__field po-ce-drawer__field--wide">
              <span>Comment (optional)</span>
              <textarea
                rows={2}
                value={dismissComment}
                onChange={(e) => setDismissComment(e.target.value)}
              />
            </label>
            <div className="po-ce-drawer__actions">
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={() => setDismissStep(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="po-btn-primary"
                onClick={handleDismissPotentialContra}
              >
                Confirm not required
              </button>
            </div>
          </section>
        ) : null}

        {createContraStep === 'picker' ? (
          <section className="po-ce-drawer__workflow">
            <h3>Create Contra Charge</h3>
            <p className="po-ce-drawer__helper">
              Select the responsible subcontract package. A draft contra charge will
              be created on that package and can be edited before submission.
            </p>

            {loadingPackages ? (
              <p className="po-ce-drawer__helper">Loading development packages…</p>
            ) : recoveryPackageOptions.length === 0 ? (
              <p className="po-ce-drawer__helper">
                No other subcontract packages are available in this development.
              </p>
            ) : (
              <div className="po-ce-drawer__package-picker">
                {recoveryPackageOptions.map((option) => (
                  <label
                    key={option.orderKey}
                    className={`po-ce-drawer__package-option${
                      selectedRecoveryPackageId === option.orderKey
                        ? ' po-ce-drawer__package-option--selected'
                        : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="recoveryPackage"
                      value={option.orderKey}
                      checked={selectedRecoveryPackageId === option.orderKey}
                      onChange={() => setSelectedRecoveryPackageId(option.orderKey)}
                    />
                    <span className="po-ce-drawer__package-option-body">
                      <strong>{formatRecoveryPackageOptionLabel(option)}</strong>
                      <span>
                        Current package value £{formatMoney(option.currentPackageValue)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {selectedPackage ? (
              <p className="po-ce-drawer__helper">
                Draft contra charge value will start at −£
                {formatMoney(Math.abs(Number(liveEvent?.value) || 0))} based on the
                approved origin event.
              </p>
            ) : null}

            <label className="po-ce-drawer__field po-ce-drawer__field--wide">
              <span>Comment (optional)</span>
              <textarea
                rows={2}
                value={createContraComment}
                onChange={(e) => setCreateContraComment(e.target.value)}
              />
            </label>

            <div className="po-ce-drawer__actions">
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={() => setCreateContraStep(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="po-btn-primary"
                disabled={!selectedRecoveryPackageId || loadingPackages}
                onClick={handleConfirmCreateContraCharge}
              >
                Create draft contra charge
              </button>
            </div>
          </section>
        ) : null}

        {liveEvent && hasLinkedRecovery(liveEvent) && !createContraStep && !dismissStep ? (
          <DrawerSection
            title={
              isRecoveryEvent ? 'Related Origin Event' : 'Related Recovery Event'
            }
            tone="relationship"
          >
            <RelatedEventPanel
              developmentId={order?.developmentId}
              event={liveEvent}
              actionLabel={getLinkedEventNavigationLabel(liveEvent)}
              onOpenLinked={null}
            />
          </DrawerSection>
        ) : null}

        {liveEvent && !editable && !isRecoveryEvent ? (
          <section className="po-ce-drawer__readonly-banner">
            Approved events are immutable. Create a reversing or correcting event
            to adjust committed value.
          </section>
        ) : null}

        {!createContraStep && !dismissStep && (editable || isCreate) ? (
          <form className="po-ce-drawer__form" onSubmit={handleSaveDraft}>
            <DrawerSection title="Commercial details">
              <div className="po-ce-drawer__grid">
                <label className="po-ce-drawer__field">
                  <span>Event type</span>
                  <select
                    value={form.eventType}
                    disabled={!editable || isRecoveryEvent}
                    onChange={(e) => updateField('eventType', e.target.value)}
                  >
                    {listCommercialEventTypeOptions().map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="po-ce-drawer__field">
                  <span>Category</span>
                  <select
                    value={form.category}
                    disabled={!editable}
                    onChange={(e) => updateField('category', e.target.value)}
                    required
                  >
                    {listCommercialEventCategoryOptions().map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="po-ce-drawer__field">
                  <span>Subcategory</span>
                  <select
                    value={form.subcategory}
                    disabled={!editable}
                    onChange={(e) => updateField('subcategory', e.target.value)}
                  >
                    {subcategoryOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="po-ce-drawer__field">
                  <span>Responsibility</span>
                  <select
                    value={form.responsibility}
                    disabled={!editable}
                    onChange={(e) => updateField('responsibility', e.target.value)}
                    required
                  >
                    {listCommercialEventResponsibilityOptions().map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="po-ce-drawer__field po-ce-drawer__field--wide">
                  <span>Description</span>
                  <textarea
                    rows={3}
                    value={form.description}
                    disabled={!editable}
                    onChange={(e) => updateField('description', e.target.value)}
                    required
                  />
                </label>
              </div>
            </DrawerSection>

            <DrawerSection title="Financial details">
              <div className="po-ce-drawer__grid">
                <label className="po-ce-drawer__field">
                  <span>Value (£)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.value}
                    disabled={!editable}
                    onChange={(e) => updateField('value', e.target.value)}
                    placeholder={
                      isRecoveryEvent
                        ? 'Must remain negative'
                        : 'Positive = increase, negative = reduction'
                    }
                    required
                  />
                </label>

                <label className="po-ce-drawer__field">
                  <span>VAT treatment</span>
                  <select
                    value={form.vatTreatment}
                    disabled={!editable}
                    onChange={(e) => updateField('vatTreatment', e.target.value)}
                  >
                    {listCommercialEventVatTreatmentOptions().map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="po-ce-drawer__field">
                  <span>Date raised</span>
                  <input
                    type="date"
                    value={form.dateRaised}
                    disabled={!editable}
                    onChange={(e) => updateField('dateRaised', e.target.value)}
                  />
                </label>

                {canEditPotentialContra ? (
                  <>
                    <div className="po-ce-drawer__field po-ce-drawer__field--wide">
                      <span>Potential Contra Charge</span>
                      <label className="po-ce-drawer__checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(form.potentialContraCharge)}
                          onChange={(e) =>
                            updateField('potentialContraCharge', e.target.checked)
                          }
                        />
                        <span>
                          Mark this where some or all of the cost may be recovered from
                          another contractor after the event is approved.
                        </span>
                      </label>
                    </div>

                    {form.potentialContraCharge ? (
                      <label className="po-ce-drawer__field po-ce-drawer__field--wide">
                        <span>Potential Contra Charge Notes</span>
                        <textarea
                          rows={2}
                          value={form.potentialContraChargeNotes}
                          onChange={(e) =>
                            updateField('potentialContraChargeNotes', e.target.value)
                          }
                          placeholder="Optional notes for the commercial team"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                {!canEditPotentialContra && liveEvent?.potentialContraCharge ? (
                  <div className="po-ce-drawer__field po-ce-drawer__field--wide">
                    <span>Potential Contra Charge Notes</span>
                    <p className="po-ce-drawer__helper">
                      {liveEvent.potentialContraChargeNotes || '—'}
                    </p>
                  </div>
                ) : null}
              </div>
            </DrawerSection>

            {editable ? (
              <div className="po-ce-drawer__actions">
                <button type="button" className="po-list-btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="po-btn-primary">
                  {isCreate ? 'Save draft' : 'Update draft'}
                </button>
              </div>
            ) : null}
          </form>
        ) : null}

        {liveEvent && !isCreate && !editable && !createContraStep && !dismissStep ? (
          <>
            <DrawerSection title="Commercial details">
              <dl className="po-ce-drawer__facts-grid">
                <div>
                  <dt>Event type</dt>
                  <dd>{getCommercialEventTypeMeta(liveEvent.eventType).label}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>
                    {getCommercialEventCategoryMeta(liveEvent.category).label}
                    {liveEvent.subcategory
                      ? ` — ${getCommercialEventSubcategoryMeta(liveEvent.category, liveEvent.subcategory).label}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>Responsibility</dt>
                  <dd>
                    {getCommercialEventResponsibilityMeta(liveEvent.responsibility).label}
                  </dd>
                </div>
                <div className="po-ce-drawer__facts-grid--wide">
                  <dt>Description</dt>
                  <dd>{liveEvent.description}</dd>
                </div>
              </dl>
            </DrawerSection>

            <DrawerSection title="Financial details">
              <dl className="po-ce-drawer__facts-grid">
                <div>
                  <dt>Value</dt>
                  <dd className={Number(liveEvent.value) < 0 ? 'po-ce-value--negative' : ''}>
                    £{formatMoney(liveEvent.value)}
                  </dd>
                </div>
                <div>
                  <dt>Date raised</dt>
                  <dd>{formatPoDate(liveEvent.dateRaised)}</dd>
                </div>
                <div>
                  <dt>Raised by</dt>
                  <dd>{liveEvent.raisedBy || '—'}</dd>
                </div>
              </dl>
            </DrawerSection>
          </>
        ) : null}

        {liveEvent && !isCreate && !createContraStep && !dismissStep ? (
          <>
            {!isCreate &&
            (canSubmitCommercialEvent(liveEvent.status) ||
              canApproveCommercialEvent(liveEvent.status) ||
              canRejectCommercialEvent(liveEvent.status) ||
              canCloseCommercialEvent(liveEvent.status)) ? (
              <DrawerSection title="Workflow" tone="workflow">
                <label className="po-ce-drawer__field po-ce-drawer__field--wide">
                  <span>Comment (optional)</span>
                  <textarea
                    rows={2}
                    value={workflowComment}
                    onChange={(e) => setWorkflowComment(e.target.value)}
                  />
                </label>
                <div className="po-ce-drawer__actions">
                  {canSubmitCommercialEvent(liveEvent.status) ? (
                    <button
                      type="button"
                      className="po-btn-primary"
                      onClick={() => runWorkflow('submit')}
                    >
                      Submit
                    </button>
                  ) : null}
                  {canApproveCommercialEvent(liveEvent.status) ? (
                    <button
                      type="button"
                      className="po-btn-primary"
                      onClick={() => runWorkflow('approve')}
                    >
                      Approve
                    </button>
                  ) : null}
                  {canRejectCommercialEvent(liveEvent.status) ? (
                    <button
                      type="button"
                      className="po-list-btn-secondary"
                      onClick={() => runWorkflow('reject')}
                    >
                      Reject
                    </button>
                  ) : null}
                  {canCloseCommercialEvent(liveEvent.status) ? (
                    <button
                      type="button"
                      className="po-list-btn-secondary"
                      onClick={() => runWorkflow('close')}
                    >
                      Close
                    </button>
                  ) : null}
                </div>
              </DrawerSection>
            ) : null}

            {liveEvent.auditHistory?.length ? (
              <DrawerSection title="Audit trail" defaultOpen={false} tone="audit">
                <ol className="po-ce-drawer__audit-list">
                  {liveEvent.auditHistory.map((entry) => (
                    <li key={entry.id}>
                      <strong>{getCommercialEventAuditActionLabel(entry.action)}</strong>
                      <span>{formatPoDateTime(entry.timestamp)}</span>
                      <span>{entry.actor}</span>
                      {entry.priorStatus || entry.newStatus ? (
                        <span>
                          {entry.priorStatus || '—'} → {entry.newStatus}
                        </span>
                      ) : null}
                      {entry.priorRecoveryStatus || entry.newRecoveryStatus ? (
                        <span>
                          {entry.priorRecoveryStatus || '—'} → {entry.newRecoveryStatus}
                        </span>
                      ) : null}
                      {entry.comment ? <p>{entry.comment}</p> : null}
                    </li>
                  ))}
                </ol>
              </DrawerSection>
            ) : null}
          </>
        ) : null}
      </div>
    </PODrawerShell>
  );
}
