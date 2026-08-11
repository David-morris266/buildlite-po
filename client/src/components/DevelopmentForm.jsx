import { useEffect, useState } from 'react';
import POPageHeader from './POPageHeader';
import { buildDevelopmentFormNavigation } from '../navigation/navigationBuilders';
import {
  DEVELOPMENT_STATUSES,
  createDevelopment,
  ensureDevelopmentsReady,
} from '../developments/developmentStore';
import { generateNextDevelopmentNumber } from '../admin/numberingService';

const EMPTY_FORM = {
  jobNumber: '',
  developmentName: '',
  client: '',
  location: '',
  address: '',
  postcode: '',
  startDate: '',
  targetCompletion: '',
  status: 'planning',
};

export default function DevelopmentForm({ onCancel, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) {
          setForm((prev) => ({
            ...prev,
            jobNumber: prev.jobNumber || generateNextDevelopmentNumber(),
          }));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message || 'Could not load developments from the server.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.jobNumber.trim()) {
      setError('Development Number is required.');
      return;
    }
    if (!form.developmentName.trim()) {
      setError('Development Name is required.');
      return;
    }
    if (
      form.startDate &&
      form.targetCompletion &&
      form.targetCompletion < form.startDate
    ) {
      setError('Target completion must be on or after the start date.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const development = await createDevelopment(form);
      onCreated?.(development.id);
    } catch (submitError) {
      setError(submitError.message || 'Could not create development.');
    } finally {
      setSubmitting(false);
    }
  }

  const navigation = buildDevelopmentFormNavigation({ onCancel });

  return (
    <div className="dev-form-page">
      <POPageHeader
        breadcrumbs={navigation.breadcrumbs}
        title={navigation.title}
        lead="Set up the commercial home for this development — plot schedule, purchase orders and packages will connect here."
        onBack={navigation.onBack}
      />

      {error ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {error}
        </div>
      ) : null}

      <form className="dev-form" onSubmit={handleSubmit} noValidate>
        <section className="po-module-card dev-form__section">
          <h2 className="dev-form__section-title">Development</h2>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Development Number</span>
              <input
                className="input"
                type="text"
                value={form.jobNumber}
                onChange={(event) => updateField('jobNumber', event.target.value)}
                required
              />
              <span className="setup-step__hint">Generated automatically using Company Settings.</span>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Development Name</span>
              <input
                className="input"
                type="text"
                value={form.developmentName}
                onChange={(event) =>
                  updateField('developmentName', event.target.value)
                }
                required
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Client</span>
              <input
                className="input"
                type="text"
                value={form.client}
                onChange={(event) => updateField('client', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="po-module-card dev-form__section">
          <h2 className="dev-form__section-title">Site</h2>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Location</span>
              <input
                className="input"
                type="text"
                value={form.location}
                onChange={(event) => updateField('location', event.target.value)}
              />
            </label>
            <label className="dev-form__field dev-form__field--wide">
              <span className="dev-form__label">Address</span>
              <input
                className="input"
                type="text"
                value={form.address}
                onChange={(event) => updateField('address', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Postcode</span>
              <input
                className="input"
                type="text"
                value={form.postcode}
                onChange={(event) => updateField('postcode', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="po-module-card dev-form__section">
          <h2 className="dev-form__section-title">Programme</h2>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Start Date</span>
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(event) => updateField('startDate', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Target Completion</span>
              <input
                className="input"
                type="date"
                value={form.targetCompletion}
                onChange={(event) =>
                  updateField('targetCompletion', event.target.value)
                }
              />
            </label>
          </div>
        </section>

        <section className="po-module-card dev-form__section">
          <h2 className="dev-form__section-title">Status</h2>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Status</span>
              <select
                className="select"
                value={form.status}
                onChange={(event) => updateField('status', event.target.value)}
              >
                {DEVELOPMENT_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <footer className="dev-form__footer">
          <button type="submit" className="po-btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Development'}
          </button>
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        </footer>
      </form>
    </div>
  );
}
