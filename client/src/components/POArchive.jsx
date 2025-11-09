import React, { useEffect, useMemo, useState } from 'react'
import { listPOs, getPO, approvePO } from '../api'

// ------- helpers -------
const toNumber = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const fmt = (n) => toNumber(n).toLocaleString()

const parseDate = (v) => (v ? new Date(v) : null)
const inRange = (d, from, to) => {
  if (!d) return true
  const t = d.getTime()
  if (from && t < from.getTime()) return false
  if (to && t > to.getTime()) return false
  return true
}

// Consistent UK date/time for UI
const fmtUKDateTime = (v) => {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function POArchive() {
  const [type, setType] = useState('')         // '', 'M', 'S', 'P'
  const [supplier, setSupplier] = useState('') // quick supplier filter (name or id)
  const [job, setJob] = useState('')
  const [q, setQ] = useState('')
  const [fromStr, setFromStr] = useState('') // yyyy-mm-dd
  const [toStr, setToStr] = useState('')
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // table UX
  const [sortKey, setSortKey] = useState('updated') // 'updated' | 'number'
  const [sortDir, setSortDir] = useState('desc')    // 'asc' | 'desc'
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const fromDate = useMemo(() => fromStr ? new Date(fromStr + 'T00:00:00') : null, [fromStr])
  const toDate   = useMemo(() => toStr ? new Date(toStr + 'T23:59:59') : null, [toStr])

  async function refresh() {
    setLoading(true)
    try {
      // server-side narrowing for big wins; we still do date + sort + paginate client-side
      const res = await listPOs({ job, q, type, supplier, sort: 'createdAt', order: 'desc', pageSize: 500 })
      setData(res)
      setPage(1) // reset to first page when filters change
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, [job, q, type, supplier])

  // Apply client-side date filter first
  const dateFiltered = useMemo(() => {
    return (data.items || []).filter(p =>
      inRange(parseDate(p.updatedAt || p.createdAt), fromDate, toDate)
    )
  }, [data.items, fromDate, toDate])

  // Sort client-side for selected column
  const sortedItems = useMemo(() => {
    const arr = [...dateFiltered]
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'number') {
      arr.sort((a, b) => String(a.poNumber || a.number || '').localeCompare(String(b.poNumber || b.number || '')) * dir)
    } else {
      // 'updated' → prefer updatedAt fall back to createdAt
      arr.sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0
        const db = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0
        return (da - db) * dir
      })
    }
    return arr
  }, [dateFiltered, sortKey, sortDir])

  // Paginate client-side
  const total = sortedItems.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(page, 1), pages)
  const start = (currentPage - 1) * pageSize
  const pageRows = sortedItems.slice(start, start + pageSize)

  function toggleSort(nextKey) {
    if (sortKey === nextKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(nextKey)
      setSortDir('asc')
    }
  }

  async function openPO(row) {
    const po = await getPO(row.poNumber || row.number)
    setSelected(po)
    setDrawerOpen(true)
  }

  async function updateApproval(newStatus) {
    if (!selected) return
    const po = await approvePO(selected.poNumber || selected.number, {
      status: newStatus, approver: 'david@dmcc', note: ''
    })
    setSelected(po)
    refresh()
  }

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>PO Archive / Search</h1>

      {/* Filters row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
        {/* Type pills */}
        <div style={{ gridColumn: 'span 3 / span 3', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Type:</span>
          {['', 'M', 'S', 'P'].map(t => (
            <button
              key={t || 'ALL'}
              onClick={() => setType(t)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: type === t ? '#111827' : '#fff',
                color: type === t ? '#fff' : '#111827',
                cursor: 'pointer'
              }}
              title={t ? ({M:'Materials',S:'Subcontract',P:'Plant'}[t]) : 'All'}
            >
              {t || 'All'}
            </button>
          ))}
        </div>

        {/* Job & q */}
        <input
          placeholder="Job code (e.g. CO-CP-001)"
          value={job}
          onChange={e=>setJob(e.target.value)}
          style={{ gridColumn: 'span 3 / span 3' }}
        />
        <input
          placeholder="Search term (number, title, item…)"
          value={q}
          onChange={e=>setQ(e.target.value)}
          style={{ gridColumn: 'span 3 / span 3' }}
        />

        {/* Supplier */}
        <input
          placeholder="Supplier (name or id)"
          value={supplier}
          onChange={e=>setSupplier(e.target.value)}
          style={{ gridColumn: 'span 3 / span 3' }}
        />

        {/* Dates */}
        <div style={{ gridColumn: 'span 3 / span 3', display:'flex', alignItems:'center', gap:6 }}>
          <label style={{ fontSize:12, color:'#555' }}>From</label>
          <input type="date" value={fromStr} onChange={e=>setFromStr(e.target.value)} />
        </div>
        <div style={{ gridColumn: 'span 3 / span 3', display:'flex', alignItems:'center', gap:6 }}>
          <label style={{ fontSize:12, color:'#555' }}>To</label>
          <input type="date" value={toStr} onChange={e=>setToStr(e.target.value)} />
        </div>

        {/* Actions */}
        <div style={{ gridColumn: 'span 3 / span 3', display:'flex', gap:8 }}>
          <button type="button" onClick={refresh}>Search</button>
          <button type="button" onClick={() => window.alert('Use Export in previous version (kept in your code) or add it back here if needed.')}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ width: '100%', fontSize: 14 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={{ textAlign:'left', padding:8, cursor:'pointer' }} onClick={() => toggleSort('number')}>
                Number {sortKey==='number' ? (sortDir==='asc' ? '▲' : '▼') : ''}
              </th>
              <th style={{ textAlign:'left', padding:8 }}>Title</th>
              <th style={{ textAlign:'left', padding:8 }}>Job</th>
              <th style={{ textAlign:'left', padding:8 }}>Cost Code</th>
              <th style={{ textAlign:'left', padding:8 }}>Supplier</th>
              <th style={{ textAlign:'right', padding:8 }}>Net</th>
              <th style={{ textAlign:'right', padding:8 }}>VAT</th>
              <th style={{ textAlign:'right', padding:8 }}>Gross</th>
              <th style={{ textAlign:'left', padding:8 }}>Status</th>
              <th style={{ textAlign:'left', padding:8 }}>Approval</th>
              <th style={{ textAlign:'left', padding:8, cursor:'pointer' }} onClick={() => toggleSort('updated')}>
                Updated {sortKey==='updated' ? (sortDir==='asc' ? '▲' : '▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ padding: 12 }}>Loading…</td></tr>}
            {!loading && pageRows.length === 0 && <tr><td colSpan={11} style={{ padding: 12 }}>No results</td></tr>}
            {pageRows.map((p, i) => {
              const net   = toNumber(p.subtotal ?? p.totals?.net ?? p.amount ?? 0)
              const vatRt = toNumber(p.totals?.vatRate ?? p.vatRateDefault ?? 0.2)
              const vat   = net * vatRt
              const gross = net + vat
              return (
                <tr
                  key={p.poNumber || p.number || i}
                  style={{ borderTop: '1px solid #e5e7eb', cursor:'pointer' }}
                  onClick={()=>openPO(p)}
                >
                  <td style={{ padding:8 }}>{p.poNumber || p.number}</td>
                  <td style={{ padding:8 }}>{p.title || p.description || '-'}</td>
                  <td style={{ padding:8 }}>{p.costRef?.jobCode || '-'}</td>
                  <td style={{ padding:8 }}>{p.costRef?.costCode || '-'}</td>
                  <td style={{ padding:8 }}>
                    {p.supplierSnapshot?.name || p.supplier || p.supplierId || '-'}
                  </td>
                  <td style={{ padding:8, textAlign:'right' }}>£{fmt(net)}</td>
                  <td style={{ padding:8, textAlign:'right' }}>£{fmt(vat)}</td>
                  <td style={{ padding:8, textAlign:'right' }}>£{fmt(gross)}</td>
                  <td style={{ padding:8 }}>{p.status || '-'}</td>
                  <td style={{ padding:8 }}>{p.approval?.status || '-'}</td>
                  <td style={{ padding:8 }}>{fmtUKDateTime(p.updatedAt || p.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 10 }}>
        <div style={{ fontSize: 13, color:'#555' }}>
          Showing {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize: 13, color:'#555' }}>Rows per page</label>
          <select value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1) }}>
            {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button disabled={currentPage<=1} onClick={()=>setPage(p => Math.max(1, p-1))}>Prev</button>
          <div style={{ minWidth: 60, textAlign:'center' }}>{currentPage}/{pages}</div>
          <button disabled={currentPage>=pages} onClick={()=>setPage(p => Math.min(pages, p+1))}>Next</button>
        </div>
      </div>

      {/* Drawer */}
      {drawerOpen && selected && (() => {
        const net   = toNumber(selected.subtotal ?? selected.totals?.net ?? selected.amount ?? 0)
        const vatRt = toNumber(selected.totals?.vatRate ?? selected.vatRateDefault ?? 0.2)
        const vat   = net * vatRt
        const gross = net + vat
        return (
          <div onClick={()=>setDrawerOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', justifyContent:'flex-end' }}>
            <div
  onClick={e=>e.stopPropagation()}
  style={{
    width: 560,
    height: '100%',
    background: 'var(--panel)',
    color: 'var(--text)',
    padding: 16,
    overflowY: 'auto',
    borderLeft: '1px solid var(--border)'
  }}
>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>
                  {(selected.poNumber || selected.number)} – {selected.title || selected.description}
                </h2>
                <button onClick={()=>setDrawerOpen(false)}>Close</button>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, fontSize: 14, marginBottom: 12 }}>
                <div><b>Job:</b> {selected.costRef?.jobCode || '-'}</div>
                <div><b>Cost code:</b> {selected.costRef?.costCode || '-'}</div>
                <div><b>Supplier:</b> {selected.supplierSnapshot?.name || selected.supplier || selected.supplierId || '-'}</div>
                <div><b>Status:</b> {selected.status || '-'}</div>
                <div><b>Approval:</b> {selected.approval?.status || '-'}</div>
                <div><b>Net:</b> £{fmt(net)}</div>
                <div><b>VAT ({(vatRt*100).toFixed(0)}%):</b> £{fmt(vat)}</div>
                <div><b>Gross:</b> £{fmt(gross)}</div>
              </div>

              <h3 style={{ fontWeight: 600, marginBottom: 6 }}>Items</h3>
              <div style={{ border:'1px solid #e5e7eb', borderRadius: 6, overflow:'hidden', marginBottom: 12 }}>
                <table style={{ width:'100%', fontSize: 14 }}>
                  <thead style={{ background:'#f9fafb' }}>
                    <tr>
                      <th style={{ textAlign:'left', padding:8 }}>Description</th>
                      <th style={{ textAlign:'left', padding:8 }}>UoM</th>
                      <th style={{ textAlign:'right', padding:8 }}>Qty</th>
                      <th style={{ textAlign:'right', padding:8 }}>Rate</th>
                      <th style={{ textAlign:'right', padding:8 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.items ?? []).map((i, idx) => (
                      <tr key={idx} style={{ borderTop:'1px solid #e5e7eb' }}>
                        <td style={{ padding:8 }}>{i.description}</td>
                        <td style={{ padding:8 }}>{i.uom}</td>
                        <td style={{ padding:8, textAlign:'right' }}>{toNumber(i.qty)}</td>
                        <td style={{ padding:8, textAlign:'right' }}>£{fmt(i.rate)}</td>
                        <td style={{ padding:8, textAlign:'right' }}>£{fmt(i.amount ?? (toNumber(i.qty) * toNumber(i.rate)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display:'flex', gap: 8 }}>
                <button onClick={()=>updateApproval('Approved')}>Approve</button>
                <button onClick={()=>updateApproval('Rejected')}>Reject</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}





