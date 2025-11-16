// client/src/components/JobSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { listJobs, createJob } from '../api';

/**
 * JobSelect
 * Props:
 *  - value: job id (string)
 *  - onChange: (id) => void
 *  - showLabel: boolean (default true)
 */
export default function JobSelect({
  value,
  onChange,
  showLabel = true,
}) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    name: '',
    jobNumber: '',
    jobCode: '',
    siteAddress: '',
    siteManager: '',
    sitePhone: '',
    client: '',
    notes: '',
  });

  // Load jobs on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await listJobs('');
        setJobs(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('jobs GET failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentId = useMemo(
    () => (value ? String(value) : ''),
    [value]
  );

  const handleSelect = (e) => {
    const id = e.target.value;
    if (id === '__new__') {
      setShowModal(true);
      return;
    }
    onChange?.(id || '');
  };

  const saveJob = async (e) => {
    e.preventDefault();
    try {
      const body = {
        ...form,
        name: form.name.trim(),
      };
      if (!body.name) {
        alert('Job name is required');
        return;
      }

      const saved = await createJob(body);

      setJobs(prev => [saved, ...prev]);
      onChange?.(saved.id);

      setForm({
        name: '',
        jobNumber: '',
        jobCode: '',
        siteAddress: '',
        siteManager: '',
        sitePhone: '',
        client: '',
        notes: '',
      });
      setShowModal(false);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save job');
    }
  };

  if (loading) {
    return (
      <div className="field">
        {showLabel && <label>Job</label>}
        <select disabled>
          <option>Loading jobs…</option>
        </select>
      </div>
    );
  }

  return (
    <div className="field">
      {showLabel && <label>Job</label>}
      <select value={currentId} onChange={handleSelect}>
        <option value="">— Select job —</option>
        {jobs.map(j => {
          const tag = j.jobNumber || j.jobCode || '';
          const label = [j.name, tag].filter(Boolean).join(' — ');
          return (
            <option key={j.id} value={j.id}>
              {label}
            </option>
          );
        })}
        <option value="__new__">➕ Add new job…</option>
      </select>

      {showModal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowModal(false)}
        >
          <div
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3>New Job</h3>
            <form className="grid2" onSubmit={saveJob}>
              <label>
                Name *
                <input
                  required
                  value={form.name}
                  onChange={e =>
                    setForm({ ...form, name: e.target.value })
                  }
                />
              </label>

              <label>
                Job Number
                <input
                  value={form.jobNumber}
                  onChange={e =>
                    setForm({ ...form, jobNumber: e.target.value })
                  }
                />
              </label>

              <label>
                Job Code
                <input
                  value={form.jobCode}
                  onChange={e =>
                    setForm({ ...form, jobCode: e.target.value })
                  }
                />
              </label>

              <label>
                Client
                <input
                  value={form.client}
                  onChange={e =>
                    setForm({ ...form, client: e.target.value })
                  }
                />
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Site Address
                <input
                  value={form.siteAddress}
                  onChange={e =>
                    setForm({ ...form, siteAddress: e.target.value })
                  }
                />
              </label>

              <label>
                Site Manager
                <input
                  value={form.siteManager}
                  onChange={e =>
                    setForm({ ...form, siteManager: e.target.value })
                  }
                />
              </label>

              <label>
                Site Phone
                <input
                  value={form.sitePhone}
                  onChange={e =>
                    setForm({ ...form, sitePhone: e.target.value })
                  }
                />
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Notes
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={e =>
                    setForm({ ...form, notes: e.target.value })
                  }
                />
              </label>

              <div
                className="modal-actions"
                style={{ gridColumn: '1 / -1' }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit">Save Job</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
