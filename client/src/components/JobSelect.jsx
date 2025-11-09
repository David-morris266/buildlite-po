import { useEffect, useState } from 'react';
import { listJobs } from '../api';

export default function JobSelect({ value, onChange }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    let alive = true;
    listJobs()
      .then(d => { if (alive) setJobs(d || []); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const refreshJobs = async () => {
    setLoading(true);
    const d = await listJobs();
    setJobs(d || []);
    setLoading(false);
  };

  if (loading) return <select disabled><option>Loading jobs…</option></select>;

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select
        style={{ flex: 1 }}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">— Select job —</option>
        {jobs.map(j => (
          <option key={j.id} value={j.id}>
            {[j.jobNumber || j.jobCode, j.name].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setShowAdd(true)}>+ Add</button>

      {showAdd && (
        <AddJobDialog
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            await refreshJobs();
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddJobDialog({ onClose, onAdded }) {
  const [jobCode, setJobCode] = useState('');
  const [name, setName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');

  const canSave = jobCode.trim() && name.trim() && siteAddress.trim();

  const onSave = async () => {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobCode, name, siteAddress })
    });
    if (res.ok) {
      await onAdded();
    } else {
      const t = await res.text();
      alert('Failed to save: ' + t);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Add Job</h3>
        <label>
          Job Code
          <input value={jobCode} onChange={e => setJobCode(e.target.value)} />
        </label>
        <label>
          Name
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          Site Address
          <textarea rows={2} value={siteAddress} onChange={e => setSiteAddress(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave} disabled={!canSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
