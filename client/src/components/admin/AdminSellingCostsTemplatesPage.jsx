import { useEffect, useRef, useState } from 'react';
import { listServerCostCodes } from '../../api/costCodes';
import { loadCommercialStructure } from '../../admin/commercialStructureService';
import {
  createSellingCostsTemplate,
  getSellingCostsTemplate,
  listSellingCostsTemplates,
  updateSellingCostsTemplate,
} from '../../api/sellingCostsTemplates';
import SellingCostsCostCodePicker from '../SellingCostsCostCodePicker';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminDataTable, AdminStatusBadge } from './adminUi';

export default function AdminSellingCostsTemplatesPage({ onBack, onSetUpCommercialStructure = null }) {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [codes, setCodes] = useState([]);
  const [codesState, setCodesState] = useState({ loading: true, error: '' });
  const [structure, setStructure] = useState(null);
  const [methodView, setMethodView] = useState('simple');
  const [percent, setPercent] = useState('2.00');
  const [destinationId, setDestinationId] = useState('');
  const [lines, setLines] = useState([]);
  const [lineFilter, setLineFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const editorRef = useRef(null);
  const methodRef = useRef(null);

  async function refresh(id = selected?.id) {
    const listed = await listSellingCostsTemplates();
    setTemplates(listed.templates || []);
    if (!id) {
      setSelected(null);
      return;
    }
    const detail = await getSellingCostsTemplate(id);
    setSelected(detail);
    setPercent(Number(detail.simpleAssumptionPercent ?? 2).toFixed(2));
    setDestinationId(detail.simpleDestination?.id || '');
    setLines((detail.lines || []).map((line) => ({
      ...line,
      costCodeId: line.costCode?.id || '',
      defaultPercent: line.defaultPercent == null ? null : Number(line.defaultPercent).toFixed(2),
      defaultLumpSum: line.defaultLumpSum == null ? null : Number(line.defaultLumpSum).toFixed(2),
      defaultRate: line.defaultRate == null ? null : Number(line.defaultRate).toFixed(2),
    })));
  }

  useEffect(() => {
    refresh().catch((loadError) => setError(loadError.message));
    listServerCostCodes({ activeOnly: true })
      .then((body) => {
        setCodes(body.costCodes || []);
        setCodesState({ loading: false, error: '' });
      })
      .catch((loadError) => {
        setCodes([]);
        setCodesState({ loading: false, error: loadError.message || 'Could not load the Cost Code Master.' });
      });
    loadCommercialStructure().then(setStructure).catch(() => setStructure(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setBusy(true);
    setError('');
    try {
      const made = await createSellingCostsTemplate({
        origin: 'buildlite_standard',
        name: 'BuildLite Standard Selling Costs',
      });
      await refresh(made.id);
      setInfo('Company Selling Costs template created.');
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function openTemplate(id) {
    setError('');
    try {
      await refresh(id);
      requestAnimationFrame(() => {
        editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        methodRef.current?.focus();
      });
    } catch (openError) {
      setError(openError.message);
    }
  }

  function selectDestination(id) {
    if (!id) {
      setDestinationId('');
      setError('');
      return;
    }
    const matches = codes.filter((candidate) => candidate.id === id);
    if (matches.length !== 1) {
      setError('BuildLite could not resolve that Cost Code to one stable company identity. Reload and try again.');
      return;
    }
    setDestinationId(id);
    setError('');
  }

  async function save(includeLines = false) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const next = await updateSellingCostsTemplate(selected.id, {
        version: selected.version,
        simpleAssumptionPercent: Number(percent),
        simpleDestinationCostCodeId: destinationId || null,
        isDefault: true,
        ...(includeLines ? { lines: lines.map((line) => ({
          ...line,
          defaultPercent: line.defaultPercent === '' || line.defaultPercent == null ? null : Number(line.defaultPercent),
          defaultLumpSum: line.defaultLumpSum === '' || line.defaultLumpSum == null ? null : Number(line.defaultLumpSum),
          defaultQuantity: line.defaultQuantity === '' || line.defaultQuantity == null ? null : Number(line.defaultQuantity),
          defaultRate: line.defaultRate === '' || line.defaultRate == null ? null : Number(line.defaultRate),
        })) } : {}),
      });
      await refresh(next.id);
      setInfo(includeLines ? 'Detailed Selling Costs template saved.' : 'Simple Selling Costs setup saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line));
  }

  function addLine() {
    setLines((current) => [...current, { name: 'New Selling Cost', forecastDriver: 'LUMP_SUM', enabled: true, costCodeId: '', defaultPercent: null, defaultLumpSum: null, defaultQuantity: null, defaultRate: null, quantitySource: 'MANUAL', unitCode: 'EACH', customUnitLabel: '' }]);
  }

  function fixedMoney(value) {
    if (value === '' || value == null || !Number.isFinite(Number(value))) return value;
    return Number(value).toFixed(2);
  }

  return (
    <AdminPageShell
      title="Selling Costs Templates"
      lead="Company-owned Selling Costs defaults and Cost Code mappings. BuildLite Standard defines concepts, never customer Cost Codes."
      onBack={onBack}
    >
      {error ? <p role="alert" className="po-list-feedback po-list-feedback--error">{error}</p> : null}
      {info ? <p role="status" className="po-list-feedback po-list-feedback--success">{info}</p> : null}
      {!templates.length ? (
        <section className="po-module-card admin-panel">
          <h2>BuildLite Standard Selling Costs</h2>
          <p>Create a company-owned copy. No monetary assumptions or Cost Code mapping will be invented.</p>
          <AdminButton loading={busy} onClick={create}>Create company template</AdminButton>
        </section>
      ) : (
        <section className="po-module-card admin-panel">
          <h2>Company templates</h2>
          <AdminDataTable>
            <thead><tr><th>Template</th><th>Default</th><th>Simple destination</th><th></th></tr></thead>
            <tbody>
              {templates.map((template) => {
                const active = selected?.id === template.id;
                return (
                  <tr key={template.id} className={active ? 'admin-table__row--selected' : ''} aria-current={active ? 'true' : undefined}>
                    <td>{template.name}</td>
                    <td>{template.isDefault ? 'Default' : '\u2014'}</td>
                    <td>{template.simpleDestination?.label || 'Unmapped'}</td>
                    <td>
                      <AdminButton variant="secondary" disabled={active} onClick={() => openTemplate(template.id)}>
                        {active ? 'Selected' : 'Open'}
                      </AdminButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminDataTable>
        </section>
      )}
      {selected ? (
        <section ref={editorRef} className="po-module-card admin-panel" aria-label="Selling Costs template setup">
          <div className="admin-panel__heading">
            <div><h2>Selling Costs method</h2><p>{selected.name}</p></div>
            <AdminStatusBadge tone={selected.isDefault ? 'success' : 'neutral'}>
              {selected.isDefault ? 'Company default' : 'Company template'}
            </AdminStatusBadge>
          </div>
          <div className="selling-costs-method-selector" role="tablist" aria-label="Selling Costs method">
            <button ref={methodView === 'simple' ? methodRef : null} type="button" role="tab" aria-selected={methodView === 'simple'} aria-controls="selling-costs-simple-editor" onClick={() => setMethodView('simple')}>Simple</button>
            <button ref={methodView === 'detailed' ? methodRef : null} type="button" role="tab" aria-selected={methodView === 'detailed'} aria-controls="selling-costs-detailed-editor" onClick={() => setMethodView('detailed')}>Detailed</button>
          </div>
          <p className="admin-form__hint">{methodView === 'simple' ? 'One percentage of Forecast Revenue → one Cost Code.' : 'Itemised forecast using individual Selling Cost lines and drivers.'}</p>
          {methodView === 'simple' ? <div id="selling-costs-simple-editor" role="tabpanel" aria-label="Simple Selling Costs setup">
          <label>
            Default percentage
            <span className="commercial-number-input"><input className="input" type="number" min="0" step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)} onBlur={() => setPercent(fixedMoney(percent))} /><span>%</span></span>
          </label>
          <div>
            <span>CVR destination</span>
            {codesState.loading ? <p className="admin-form__hint" role="status">Loading active Cost Codes&hellip;</p> : null}
            {codesState.error ? <p className="po-list-feedback po-list-feedback--error" role="alert">Cost Code Master could not be loaded: {codesState.error}</p> : null}
            {!codesState.loading && !codesState.error && !codes.length ? (
              <p className="admin-form__hint" role="status">No active Cost Codes are available to map.</p>
            ) : null}
            {!codesState.loading && !codesState.error && codes.length ? (
              <SellingCostsCostCodePicker
                name="Simple CVR destination"
                codes={codes}
                structure={structure}
                valueId={destinationId}
                onChange={selectDestination}
                contextKey={`${selected.id}:simple`}
                onSetUpCommercialStructure={onSetUpCommercialStructure}
              />
            ) : null}
          </div>
          <p className="admin-form__hint">This mapping does not change the Cost Code Master, classification or Commercial Structure.</p>
          <AdminButton loading={busy} onClick={() => save(false)}>Save Simple setup</AdminButton>
          </div> : null}
          {methodView === 'detailed' ? <div id="selling-costs-detailed-editor" role="tabpanel" aria-label="Detailed Selling Costs setup">
          <div className="admin-panel__heading"><strong>Detailed lines</strong><AdminButton variant="secondary" onClick={addLine}>Add line</AdminButton></div>
          <div className="dev-selling-costs__actions" role="group" aria-label="Detailed line filter">{['all','unmapped','mapped'].map(filter => <button type="button" className="btn btn--secondary" aria-pressed={lineFilter===filter} key={filter} onClick={() => setLineFilter(filter)}>{filter[0].toUpperCase()+filter.slice(1)}</button>)}</div>
          <div className="selling-costs-lines">
            {lines.map((line,index)=>({line,index})).filter(({line})=>lineFilter==='all'||(lineFilter==='mapped'?Boolean(line.costCodeId):!line.costCodeId)).map(({line,index}) => (
              <fieldset key={line.id || `new-${index}`} className="po-module-card" aria-label={`${line.name} assumptions`}>
                <label>Selling Cost<input className="input" value={line.name} onChange={(event) => updateLine(index, { name: event.target.value })} /></label>
                <label>Driver<select className="input" value={line.forecastDriver} onChange={(event) => updateLine(index, { forecastDriver: event.target.value })}><option value="PERCENT_REVENUE">% Forecast Revenue</option><option value="LUMP_SUM">Lump Sum</option><option value="QUANTITY_RATE">Quantity × Rate</option></select></label>
                {line.forecastDriver === 'PERCENT_REVENUE' ? <label>Default percentage<span className="commercial-number-input"><input className="input" type="number" min="0" step="0.01" value={line.defaultPercent ?? ''} onChange={(event) => updateLine(index, { defaultPercent: event.target.value })} onBlur={()=>updateLine(index,{defaultPercent:fixedMoney(line.defaultPercent)})}/><span>%</span></span></label> : null}
                {line.forecastDriver === 'LUMP_SUM' ? <label>Default amount<span className="commercial-number-input"><span>£</span><input className="input" type="number" min="0" step="0.01" value={line.defaultLumpSum ?? ''} onChange={(event) => updateLine(index, { defaultLumpSum: event.target.value })} onBlur={()=>updateLine(index,{defaultLumpSum:fixedMoney(line.defaultLumpSum)})}/></span></label> : null}
                {line.forecastDriver === 'QUANTITY_RATE' ? <><label>Quantity source<select className="input" value={line.quantitySource||'MANUAL'} onChange={(event)=>updateLine(index,{quantitySource:event.target.value,unitCode:event.target.value==='MANUAL'?(line.unitCode||'EACH'):'PLOTS'})}><option value="MANUAL">Manual quantity</option><option value="TOTAL_PLOTS">Total Plot Master plots</option><option value="PRIVATE_SALE_PLOTS">Private-sale plots</option></select></label>{(line.quantitySource||'MANUAL')==='MANUAL'?<label>Default quantity<input className="input" type="number" min="0" step="0.0001" value={line.defaultQuantity ?? ''} onChange={(event) => updateLine(index, { defaultQuantity: event.target.value })} /></label>:<p>Quantity resolves from each Development Plot Master.</p>}<label>Default rate<span className="commercial-number-input"><span>£</span><input className="input" type="number" min="0" step="0.01" value={line.defaultRate ?? ''} onChange={(event) => updateLine(index, { defaultRate: event.target.value })} onBlur={()=>updateLine(index,{defaultRate:fixedMoney(line.defaultRate)})}/><span>/ {String(line.unitCode||'each').toLowerCase()}</span></span></label><label>Unit<select className="input" disabled={(line.quantitySource||'MANUAL')!=='MANUAL'} value={(line.quantitySource||'MANUAL')==='MANUAL'?(line.unitCode||'EACH'):'PLOTS'} onChange={event=>updateLine(index,{unitCode:event.target.value})}>{['PLOTS','MONTHS','WEEKS','VISITS','ITEMS','EACH','FT2','M2','CUSTOM'].map(unit=><option key={unit}>{unit}</option>)}</select></label>{line.unitCode==='CUSTOM'&&(line.quantitySource||'MANUAL')==='MANUAL'?<label>Custom unit<input className="input" maxLength="40" value={line.customUnitLabel||''} onChange={event=>updateLine(index,{customUnitLabel:event.target.value})}/></label>:null}</> : null}
                <div><span>Company CVR destination</span><SellingCostsCostCodePicker name={`${line.name} company Cost Code`} codes={codes} structure={structure} valueId={line.costCodeId||''} contextKey={`${selected.id}:${line.id||index}`} onChange={(id)=>updateLine(index,{costCodeId:id||''})} onSetUpCommercialStructure={onSetUpCommercialStructure} /></div>
                <p>{line.costCodeId?'Mapped':'Unmapped'}</p>
                <label><input type="checkbox" checked={line.enabled !== false} onChange={(event) => updateLine(index, { enabled: event.target.checked })} /> Enabled</label>
              </fieldset>
            ))}
          </div>
          <AdminButton loading={busy} onClick={() => save(true)}>Save company template</AdminButton>
          </div> : null}
        </section>
      ) : null}
    </AdminPageShell>
  );
}
