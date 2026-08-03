import { useEffect, useMemo, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import { formatPoDate, formatPoDateTime, formatMoney } from './poDrawerHelpers';
import {
  COMMERCIAL_EVENT_TYPES,
  getCommercialEventCategoryMeta,
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
} from '../commercialEvents/commercialEventStore';
import { getCommercialEventAuditActionLabel } from '../commercialEvents/commercialEventPackageValue';

const EMPTY_FORM = {
  eventType: COMMERCIAL_EVENT_TYPES.variation.key,
  category: 'commercial',
  subcategory: 'scopeChange',
  responsibility: 'commercial',
  description: '',
  value: '',
  vatTreatment: 'standard',
  dateRaised: new Date().toISOString().slice(0, 10),
};

function StatusBadge({ statusKey }) {
  const status = getCommercialEventStatusMeta(statusKey);
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function CommercialEventDrawer({
  open,
  mode = 'create',
  event,
  order,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [workflowComment, setWorkflowComment] = useState('');
  const [errors, setErrors] = useState([]);

  const isCreate = mode === 'create';
  const editable =
    (isCreate || mode === 'edit') &&
    (!event || isCommercialEventEditable(event.status));

  const subcategoryOptions = useMemo(() => {
    const category = getCommercialEventCategoryMeta(form.category);
    return category.subcategories || [];
  }, [form.category]);

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setWorkflowComment('');
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
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        dateRaised: new Date().toISOString().slice(0, 10),
      });
    }
  }, [open, event, isCreate]);

  function updateField(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'category') {
        const category = getCommercialEventCategoryMeta(value);
        next.subcategory = category.subcategories?.[0]?.key || '';
      }
      return next;
    });
  }

  function handleSaveDraft(submitEvent) {
    submitEvent.preventDefault();
    if (!order?.developmentId || !order?.orderKey) return;

    const payload = {
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
    };

    const result = isCreate
      ? createCommercialEvent(order.developmentId, payload)
      : updateCommercialEventDraft(order.developmentId, event.id, payload);

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

  const drawerTitle = isCreate
    ? 'New Commercial Event'
    : `${event?.eventNumber || 'Commercial Event'}`;

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
            {event ? (
              <div className="po-ce-drawer__status">
                <StatusBadge statusKey={event.status} />
              </div>
            ) : null}
          </div>
          <button type="button" className="po-drawer-close" onClick={onClose}>
            Close
          </button>
        </header>

        {errors.length ? (
          <ul className="po-ce-drawer__errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        {event && !editable ? (
          <section className="po-ce-drawer__readonly-banner">
            Approved events are immutable. Create a reversing or correcting event
            to adjust committed value.
          </section>
        ) : null}

        <form className="po-ce-drawer__form" onSubmit={handleSaveDraft}>
          <div className="po-ce-drawer__grid">
            <label className="po-ce-drawer__field">
              <span>Event type</span>
              <select
                value={form.eventType}
                disabled={!editable}
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

            <label className="po-ce-drawer__field">
              <span>Value (£)</span>
              <input
                type="number"
                step="0.01"
                value={form.value}
                disabled={!editable}
                onChange={(e) => updateField('value', e.target.value)}
                placeholder="Positive = increase, negative = reduction"
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

        {event && !isCreate ? (
          <>
            <section className="po-ce-drawer__facts">
              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{getCommercialEventTypeMeta(event.eventType).label}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>
                    {getCommercialEventCategoryMeta(event.category).label}
                    {event.subcategory
                      ? ` — ${getCommercialEventSubcategoryMeta(event.category, event.subcategory).label}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>Responsibility</dt>
                  <dd>
                    {getCommercialEventResponsibilityMeta(event.responsibility).label}
                  </dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd className={Number(event.value) < 0 ? 'po-ce-value--negative' : ''}>
                    £{formatMoney(event.value)}
                  </dd>
                </div>
                <div>
                  <dt>Date raised</dt>
                  <dd>{formatPoDate(event.dateRaised)}</dd>
                </div>
                <div>
                  <dt>Raised by</dt>
                  <dd>{event.raisedBy || '—'}</dd>
                </div>
                {event.linkedEventId ? (
                  <div>
                    <dt>Linked event</dt>
                    <dd>{event.linkedEventId}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {!isCreate && (canSubmitCommercialEvent(event.status) ||
              canApproveCommercialEvent(event.status) ||
              canRejectCommercialEvent(event.status) ||
              canCloseCommercialEvent(event.status)) ? (
              <section className="po-ce-drawer__workflow">
                <h3>Workflow</h3>
                <label className="po-ce-drawer__field po-ce-drawer__field--wide">
                  <span>Comment (optional)</span>
                  <textarea
                    rows={2}
                    value={workflowComment}
                    onChange={(e) => setWorkflowComment(e.target.value)}
                  />
                </label>
                <div className="po-ce-drawer__actions">
                  {canSubmitCommercialEvent(event.status) ? (
                    <button
                      type="button"
                      className="po-btn-primary"
                      onClick={() => runWorkflow('submit')}
                    >
                      Submit
                    </button>
                  ) : null}
                  {canApproveCommercialEvent(event.status) ? (
                    <button
                      type="button"
                      className="po-btn-primary"
                      onClick={() => runWorkflow('approve')}
                    >
                      Approve
                    </button>
                  ) : null}
                  {canRejectCommercialEvent(event.status) ? (
                    <button
                      type="button"
                      className="po-list-btn-secondary"
                      onClick={() => runWorkflow('reject')}
                    >
                      Reject
                    </button>
                  ) : null}
                  {canCloseCommercialEvent(event.status) ? (
                    <button
                      type="button"
                      className="po-list-btn-secondary"
                      onClick={() => runWorkflow('close')}
                    >
                      Close
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {event.auditHistory?.length ? (
              <section className="po-ce-drawer__audit">
                <h3>Audit trail</h3>
                <ol>
                  {event.auditHistory.map((entry) => (
                    <li key={entry.id}>
                      <strong>{getCommercialEventAuditActionLabel(entry.action)}</strong>
                      <span>{formatPoDateTime(entry.timestamp)}</span>
                      <span>{entry.actor}</span>
                      {entry.priorStatus || entry.newStatus ? (
                        <span>
                          {entry.priorStatus || '—'} → {entry.newStatus}
                        </span>
                      ) : null}
                      {entry.comment ? <p>{entry.comment}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </PODrawerShell>
  );
}
