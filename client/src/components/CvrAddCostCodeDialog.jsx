import { useEffect, useMemo, useState } from 'react';
import { listActiveCostCodesForSelect } from '../admin/costCodeMasterStore';
import { normaliseCostCodeKey } from '../cvr/cvrCalculations';
import PrelimsCostCodePicker from './PrelimsCostCodePicker';

export default function CvrAddCostCodeDialog({
  open,
  periodKey,
  memberKeys = [],
  onCancel,
  onSave,
}) {
  const [options, setOptions] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const excluded = useMemo(
    () => new Set((memberKeys || []).map((key) => normaliseCostCodeKey(key)).filter(Boolean)),
    [memberKeys]
  );

  const available = useMemo(
    () =>
      (options || []).filter((row) => {
        const code = normaliseCostCodeKey(row.code || row.value);
        return code && !excluded.has(code);
      }),
    [options, excluded]
  );

  useEffect(() => {
    if (!open) return undefined;
    setSelectedCode('');
    setErrors([]);
    setLoadError('');
    let cancelled = false;
    listActiveCostCodesForSelect()
      .then((codes) => {
        if (!cancelled) setOptions(codes || []);
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
          setLoadError('Could not load Cost Code Master.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!selectedCode) {
      setErrors(['Select a cost code from Cost Code Master.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const result = await onSave?.({ costCodeKey: selectedCode });
      if (result?.ok === false) {
        setErrors(result.errors || ['Could not add cost code.']);
      }
    } catch (err) {
      setErrors([err.message || 'Could not add cost code.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true" aria-labelledby="cvr-add-cost-code-title">
        <h3 id="cvr-add-cost-code-title">Add Cost Code</h3>
        <p className="dev-cvr-add__lead">
          Choose an active company cost code to add to {periodKey || 'this Draft CVR'}. Budget,
          adjustment and accrual stay empty until you enter them.
        </p>
        {loadError ? (
          <p className="po-list-feedback po-list-feedback--error" role="alert">
            {loadError}
          </p>
        ) : null}
        {errors.length ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            <ul>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className="dev-cvr-budget-editor__field">
          <span>Cost Code Master</span>
          <PrelimsCostCodePicker
            options={available}
            value={selectedCode}
            onChange={(code) => {
              setSelectedCode(code);
              setErrors([]);
            }}
            name="CVR add"
          />
        </label>
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={handleSave}
            disabled={busy || !selectedCode}
          >
            {busy ? 'Adding…' : 'Add Cost Code'}
          </button>
        </div>
      </div>
    </div>
  );
}
