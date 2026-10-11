import { useEffect, useMemo, useState } from 'react';
import { listActiveCostCodesForSelect } from '../admin/costCodeMasterStore';
import { COST_CODE_MASTER_UNAVAILABLE_MESSAGE } from '../admin/costCodeMessages';
import {
  buildCostCodeCompleteness,
  completenessCommercialHeads,
  filterUnrepresentedCostCodes,
} from '../cvr/cvrCostCodeCompleteness';

export default function CvrAddCostCodeDialog({
  open,
  periodKey,
  memberKeys = [],
  masterCodes = null,
  masterLoadError = '',
  masterLoading = false,
  canAdd = true,
  onCancel,
  onSave,
}) {
  const [loadedOptions, setLoadedOptions] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [commercialHead, setCommercialHead] = useState('');
  const [errors, setErrors] = useState([]);
  const [busyCode, setBusyCode] = useState('');

  const options = masterCodes == null ? loadedOptions : masterCodes;
  const completeness = useMemo(
    () => buildCostCodeCompleteness(options, memberKeys),
    [options, memberKeys]
  );
  const heads = useMemo(
    () => completenessCommercialHeads(completeness.unrepresented),
    [completeness.unrepresented]
  );
  const available = useMemo(
    () => filterUnrepresentedCostCodes(completeness.unrepresented, { query, commercialHead }),
    [completeness.unrepresented, query, commercialHead]
  );

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setCommercialHead('');
    setErrors([]);
    setLoadError('');
    if (masterCodes != null) return undefined;
    let cancelled = false;
    listActiveCostCodesForSelect({ fresh: true })
      .then((codes) => {
        if (!cancelled) setLoadedOptions(codes || []);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedOptions([]);
          setLoadError(COST_CODE_MASTER_UNAVAILABLE_MESSAGE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [masterCodes, open]);

  if (!open) return null;

  async function handleSave(costCodeKey) {
    setBusyCode(costCodeKey);
    setErrors([]);
    try {
      const result = await onSave?.({ costCodeKey });
      if (result?.ok === false) setErrors(result.errors || ['Could not add cost code.']);
    } catch (err) {
      setErrors([err.message || 'Could not add cost code.']);
    } finally {
      setBusyCode('');
    }
  }

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add dev-cvr-completeness modal" role="dialog" aria-modal="true" aria-labelledby="cvr-cost-code-completeness-title">
        <h3 id="cvr-cost-code-completeness-title">Cost Code Completeness</h3>
        <p className="dev-cvr-add__lead">
          {completeness.unrepresentedCount} active Company Cost Code{completeness.unrepresentedCount === 1 ? ' is' : 's are'} not represented in {periodKey || 'this Draft CVR'}. This does not necessarily mean they were omitted.
        </p>
        <p className="dev-cvr-completeness__authority">Adding a code creates a review row with a zero authoritative baseline. It does not change the Land Appraisal or Approved Site Start Budget.</p>
        {masterLoading ? <p role="status">Loading Company Cost Code Master…</p> : null}
        {loadError || masterLoadError ? <p className="po-list-feedback po-list-feedback--error" role="alert">{loadError || masterLoadError}</p> : null}
        {errors.length ? <div className="po-list-feedback po-list-feedback--error" role="alert"><ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul></div> : null}
        <div className="dev-cvr-completeness__filters">
          <label><span>Search</span><input className="input" type="search" aria-label="Search unrepresented Cost Codes" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>Commercial Head</span><select className="input" aria-label="Filter by Commercial Head" value={commercialHead} onChange={(event) => setCommercialHead(event.target.value)}><option value="">All Heads</option>{heads.map((head) => <option key={head} value={head}>{head}</option>)}</select></label>
        </div>
        <div className="dev-cvr-completeness__list" role="list" aria-label="Unrepresented Cost Codes">
          {!masterLoading && !loadError && !masterLoadError && !available.length ? <p className="po-list-feedback po-list-feedback--info">{completeness.unrepresentedCount ? 'No Cost Codes match these filters.' : 'All active Company Cost Codes are represented.'}</p> : null}
          {available.map((item) => (
            <article className="dev-cvr-completeness__row" role="listitem" key={item.code} data-cost-code={item.code}>
              <div><strong>{item.code} — {item.description || 'No description'}</strong><span>{[item.commercialHead || 'Unclassified', item.commercialFamily].filter(Boolean).join(' · ')}</span></div>
              {canAdd ? <button type="button" className="po-list-btn-secondary" disabled={Boolean(busyCode)} onClick={() => handleSave(item.code)}>{busyCode === item.code ? 'Adding…' : 'Add Cost Code'}</button> : null}
            </article>
          ))}
        </div>
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel} disabled={Boolean(busyCode)}>Close</button>
        </div>
      </div>
    </div>
  );
}
