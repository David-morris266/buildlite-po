import { useEffect, useMemo, useState } from 'react';
import { buildPackageWorkspaceLaunchContext, PACKAGE_OPENED_FROM } from '../payments/packageWorkspaceLaunch';
import { filterDevelopmentVariationAccount, loadDevelopmentVariationAccount } from '../developments/developmentVariationAccountRegister';

const money = value => value == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value));
export default function DevelopmentVariationAccountRegister({ packages = [], onOpenPackage }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setState('loading'); setError('');
    loadDevelopmentVariationAccount(packages).then(next => { if (active) { setItems(next); setState('loaded'); } })
      .catch(err => { if (active) { setError(err.message || 'Could not load the Development Variation Account.'); setState('error'); } });
    return () => { active = false; };
  }, [packages]);
  const visible = useMemo(() => filterDevelopmentVariationAccount(items, query), [items, query]);
  const open = item => onOpenPackage?.(item.package?.orderKey, buildPackageWorkspaceLaunchContext({ packageRow: item.package, openedFrom: PACKAGE_OPENED_FROM.DevelopmentVariationAccount, initialTab: 'variation-account', variationAccountTarget: { itemId: item.id, reference: item.reference } }));
  return <section className="po-module-card development-va-register" aria-labelledby="development-va-title">
    <h2 id="development-va-title" className="po-matrix-section__title">Variation Account</h2>
    <p className="dev-workspace__section-lead">Variation Accounts track the forecast and recognised commercial position of package variations. Commercial Event (CE) and Issued Variation Order (VO) authority are reconciled within the account to prevent double counting.</p>
    <p className="dev-workspace__section-lead">Find Variation Account items across this development. Open an item to review or edit it in its owning package.</p>
    <label className="dev-form__field development-va-register__search"><span className="dev-form__label">Search Variation Account</span><input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="VA reference, description, supplier, package or Cost Code" /></label>
    {state === 'loading' ? <p role="status">Loading Variation Account…</p> : null}
    {error ? <div className="po-list-feedback po-list-feedback--error" role="alert">{error}</div> : null}
    {state === 'loaded' && !visible.length ? <p>{items.length ? 'No Variation Account items match this search.' : 'No Variation Account items exist for this Development.'}</p> : null}
    {visible.length ? <div className="po-table-wrap"><table className="po-data-table"><thead><tr><th>Variation Account item</th><th>Description</th><th>Supplier / package</th><th>Cost Code</th><th>QS Forecast</th><th>Status</th><th>Action</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.reference}</strong></td><td>{item.description}</td><td><strong>{item.supplier}</strong>{item.packageLabel ? <><br/><small>{item.packageLabel}</small></> : null}</td><td>{item.costCode}</td><td>{item.forecastStatus === 'pending' ? 'Pending assessment' : money(item.qsForecast)}</td><td>{item.status}</td><td><button type="button" className="po-list-btn-secondary pilot-lifecycle-action" onClick={() => open(item)}>Open item</button></td></tr>)}</tbody></table></div> : null}
  </section>;
}
