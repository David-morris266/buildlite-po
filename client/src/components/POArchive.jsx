import React, { useEffect, useMemo, useState } from 'react'
import { listPOs, getPO, approvePO, poPdfUrl } from '../api'
import {
  buildApproveBody,
} from '../setup/setupDraft'
import POPageHeader from './POPageHeader'
import POLoading from './POLoading'
import PODrawerShell from './PODrawerShell'
import POReviewDrawerContent from './POReviewDrawerContent'
import './POList.css'

const openPdf = (poNumber) => {
  if (!poNumber) return
  window.open(poPdfUrl(poNumber), '_blank', 'noopener')
}

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

export default function POArchive({ onOpenPackage = null }) {
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

  const hasActiveFilters = Boolean(job || q || type || supplier || fromStr || toStr)

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
    const po = await approvePO(selected.poNumber || selected.number, buildApproveBody(newStatus))
    setSelected(po)
    refresh()
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setSelected(null)
  }

  return (
    <div className="po-archive-page">
      <POPageHeader
        eyebrow="Archive"
        title="Archive"
        lead="View completed and archived Purchase Orders."
      />

      <div className="po-module-card">
        <p className="po-filters__hint">
          Search Purchase Orders by supplier, project or PO number.
        </p>

        <div className="po-archive-filters">
        {/* Type pills */}
        <div style={{ gridColumn: 'span 12 / span 12' }} className="po-type-pills">
          <span className="po-type-pills__label">Type:</span>
          {['', 'M', 'S', 'P'].map(t => (
            <button
              key={t || 'ALL'}
              type="button"
              className={`po-type-pill${type === t ? ' po-type-pill--active' : ''}`}
              onClick={() => setType(t)}
              title={t ? ({M:'Materials',S:'Subcontract',P:'Plant'}[t]) : 'All'}
            >
              {t || 'All'}
            </button>
          ))}
        </div>

        <input
          className="input"
          placeholder="Job code (e.g. EX-01)"
          value={job}
          onChange={e=>setJob(e.target.value)}
          style={{ gridColumn: 'span 4 / span 4' }}
          aria-label="Filter by job code"
        />
        <input
          className="input"
          placeholder="Search term (number, title, item…)"
          value={q}
          onChange={e=>setQ(e.target.value)}
          style={{ gridColumn: 'span 4 / span 4' }}
          aria-label="Search archive"
        />

        <input
          className="input"
          placeholder="Supplier (name or id)"
          value={supplier}
          onChange={e=>setSupplier(e.target.value)}
          style={{ gridColumn: 'span 4 / span 4' }}
          aria-label="Filter by supplier"
        />

        <div style={{ gridColumn: 'span 3 / span 3', display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize:12, color:'var(--muted)' }}>From</label>
          <input type="date" className="input" value={fromStr} onChange={e=>setFromStr(e.target.value)} aria-label="From date" />
        </div>
        <div style={{ gridColumn: 'span 3 / span 3', display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize:12, color:'var(--muted)' }}>To</label>
          <input type="date" className="input" value={toStr} onChange={e=>setToStr(e.target.value)} aria-label="To date" />
        </div>

        <div style={{ gridColumn: 'span 6 / span 6', display:'flex', gap:8 }}>
          <button type="button" onClick={refresh}>Search</button>
        </div>
        </div>
      </div>

      {loading ? (
        <POLoading message="Searching archive…" />
      ) : null}

      {!loading && pageRows.length === 0 && !hasActiveFilters ? (
        <div className="po-empty-state">
          <p className="po-empty-state__message">
            No archived Purchase Orders yet.
          </p>
        </div>
      ) : null}

      {!loading && (pageRows.length > 0 || hasActiveFilters) ? (
      <div className="po-table-wrap">
        <table className="po-data-table">
          <thead>
            <tr>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('number')}>
                Number {sortKey==='number' ? (sortDir==='asc' ? '▲' : '▼') : ''}
              </th>
              <th>Title</th>
              <th>Job</th>
              <th>Cost Code</th>
              <th>Supplier</th>
              <th style={{ textAlign:'right' }}>Net</th>
              <th style={{ textAlign:'right' }}>VAT</th>
              <th style={{ textAlign:'right' }}>Gross</th>
              <th>Status</th>
              <th>Approval</th>
              <th style={{ cursor:'pointer' }} onClick={() => toggleSort('updated')}>
                Updated {sortKey==='updated' ? (sortDir==='asc' ? '▲' : '▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && hasActiveFilters && (
              <tr>
                <td colSpan={11} className="po-data-table__empty">
                  No Purchase Orders match your search.
                </td>
              </tr>
            )}
            {pageRows.map((p, i) => {
              const net   = toNumber(p.subtotal ?? p.totals?.net ?? p.amount ?? 0)
              const vatRt = toNumber(p.totals?.vatRate ?? p.vatRateDefault ?? 0.2)
              const vat   = net * vatRt
              const gross = net + vat
              return (
                <tr
                  key={p.poNumber || p.number || i}
                  style={{ cursor:'pointer' }}
                  onClick={()=>openPO(p)}
                >
                  <td>{p.poNumber || p.number}</td>
                  <td>{p.title || p.description || '-'}</td>
                  <td>{p.costRef?.jobCode || '-'}</td>
                  <td>{p.costRef?.costCode || '-'}</td>
                  <td>
                    {p.supplierSnapshot?.name || p.supplier || p.supplierId || '-'}
                  </td>
                  <td style={{ textAlign:'right' }}>£{fmt(net)}</td>
                  <td style={{ textAlign:'right' }}>£{fmt(vat)}</td>
                  <td style={{ textAlign:'right' }}>£{fmt(gross)}</td>
                  <td>{p.status || '-'}</td>
                  <td>{p.approval?.status || '-'}</td>
                  <td>{fmtUKDateTime(p.updatedAt || p.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      ) : null}

      {/* Pagination */}
      {!loading && total > 0 ? (
      <div className="po-pagination">
        <div>
          Showing {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}
        </div>
        <div className="po-pagination__controls">
          <label>Rows per page</label>
          <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(1) }}>
            {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" disabled={currentPage<=1} onClick={()=>setPage(p => Math.max(1, p-1))}>Prev</button>
          <div style={{ minWidth: 60, textAlign:'center' }}>{currentPage}/{pages}</div>
          <button type="button" disabled={currentPage>=pages} onClick={()=>setPage(p => Math.min(pages, p+1))}>Next</button>
        </div>
      </div>
      ) : null}

      {/* Drawer */}
      <PODrawerShell
        open={drawerOpen && !!selected}
        onClose={closeDrawer}
        ariaLabel="Purchase Order details"
      >
        {selected ? (
          <POReviewDrawerContent
            po={selected}
            onClose={closeDrawer}
            onDownloadPdf={() =>
              openPdf(selected.poNumber || selected.number)
            }
            onApprove={() => updateApproval('Approved')}
            onReject={() => updateApproval('Rejected')}
            onOpenPackage={onOpenPackage}
          />
        ) : null}
      </PODrawerShell>
    </div>
  )
}





