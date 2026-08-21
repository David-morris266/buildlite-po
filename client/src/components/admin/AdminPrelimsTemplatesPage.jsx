import { useEffect, useState } from 'react';
import {
  PrelimsTemplateApiError,
  createPrelimsTemplate,
  getPrelimsTemplate,
  listPrelimsTemplates,
  updatePrelimsTemplate,
} from '../../api/prelimsTemplates';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminDataTable } from './adminUi';

function originLabel(origin) {
  if (origin === 'buildlite_standard') return 'BuildLite Standard';
  if (origin === 'blank') return 'Blank';
  return origin || '—';
}

export default function AdminPrelimsTemplatesPage({ onBack }) {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('BuildLite Standard Prelims');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(selectId = selected?.id) {
    const listed = await listPrelimsTemplates();
    const rows = listed.templates || [];
    setTemplates(rows);
    if (!selectId) {
      setSelected(null);
      return;
    }
    const detail = await getPrelimsTemplate(selectId);
    setSelected(detail);
  }

  useEffect(() => {
    refresh(null).catch((err) => {
      setError(err.message || 'Could not load Prelims templates.');
    });
    // Load list only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(origin) {
    setBusy(true);
    setError('');
    try {
      const created = await createPrelimsTemplate({
        origin,
        name: name.trim() || (origin === 'blank' ? 'Company Prelims' : 'BuildLite Standard Prelims'),
      });
      setName(created.name);
      await refresh(created.id);
    } catch (err) {
      const message =
        err instanceof PrelimsTemplateApiError && err.status === 409
          ? err.message
          : err.message || 'Could not create Prelims template.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await updatePrelimsTemplate(selected.id, { version: selected.version, isDefault: true });
      await refresh(selected.id);
    } catch (err) {
      setError(err.message || 'Could not set default template.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPageShell
      title="Prelims Templates"
      lead="Company-owned Prelims structures. BuildLite Standard is guidance you can copy and tailor. These templates do not write the CVR."
      onBack={onBack}
    >
      {error ? (
        <p className="dev-workspace__section-lead" role="alert">
          {error}
        </p>
      ) : null}

      <section className="po-module-card admin-panel">
        <h2 className="admin-panel__title">Create a company template</h2>
        <p className="admin-panel__lead">
          Start with BuildLite&apos;s recommended UK housebuilding Prelims structure. You can
          tailor it to your business and cost codes. Cost-code mapping and development setup come
          later.
        </p>
        <div className="admin-form__grid">
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Template name</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Prelims template name"
            />
          </label>
        </div>
        <div className="dev-prelims__actions">
          <AdminButton
            variant="primary"
            disabled={busy}
            onClick={() => handleCreate('buildlite_standard')}
          >
            Use BuildLite Standard
          </AdminButton>
          <AdminButton disabled={busy} variant="secondary" onClick={() => handleCreate('blank')}>
            Start Blank
          </AdminButton>
        </div>
      </section>

      <section className="po-module-card admin-panel">
        <h2 className="admin-panel__title">Company templates</h2>
        {!templates.length ? (
          <p>No company Prelims templates yet.</p>
        ) : (
        <AdminDataTable>
          <thead>
            <tr>
              <th>Name</th>
              <th>Default</th>
              <th>Origin</th>
              <th>Standard version</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setError('');
                      refresh(row.id).catch((err) => setError(err.message));
                    }}
                  >
                    {row.name}
                  </button>
                </td>
                <td>{row.isDefault ? 'Default' : '—'}</td>
                <td>{originLabel(row.origin)}</td>
                <td>{row.sourceStandardVersion ?? '—'}</td>
                <td>{row.lineCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
        )}
      </section>

      {selected ? (
        <section className="po-module-card admin-panel" aria-label="Selected Prelims template">
          <h2 className="admin-panel__title">
            {selected.name}
            {selected.isDefault ? ' (default)' : ''}
          </h2>
          <p>
            Origin {originLabel(selected.origin)}
            {selected.sourceStandardVersion
              ? ` · copied from BuildLite Standard v${selected.sourceStandardVersion}`
              : ''}
            . {selected.lines?.length || 0} lines. Company-owned copy — editing it does not change
            BuildLite Standard.
          </p>
          {!selected.isDefault ? (
            <AdminButton disabled={busy} onClick={handleSetDefault}>
              Set as default
            </AdminButton>
          ) : null}
          {!selected.lines?.length ? (
            <p>This blank template has no lines yet.</p>
          ) : (
            <AdminDataTable>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Driver</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Cost code</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.name}</td>
                    <td>{line.forecastDriver}</td>
                    <td>{line.startBasis || '—'}</td>
                    <td>{line.endBasis || '—'}</td>
                    <td>{line.costCodeKey || 'Unmapped'}</td>
                    <td>{line.enabled ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </AdminDataTable>
          )}
        </section>
      ) : null}
    </AdminPageShell>
  );
}
