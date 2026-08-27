'use client'

/**
 * The review queue UI.
 *
 * Client-rendered and unauthenticated by itself: the page is just a shell, and every call
 * it makes carries the admin secret the reviewer pastes in. The secret is held in React
 * state and in sessionStorage, never in the URL - a query string would end up in browser
 * history, server logs and any Referer header the page emits.
 *
 * The security boundary is the API, not this page. Loading it without a secret shows
 * nothing, because every request behind it 401s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Nearby {
  observationDate: string
  priceKhr: number
}

interface Observation {
  id: string
  observationDate: string
  commodityOriginal: string
  commodityNormalized: string
  unitOriginal: string
  unitNormalized: string
  priceKhr: number
  geographicScope: string
  priceType: string
  sourceType: string
  extractionConfidence: number
  validationStatus: string
  validationNotes: string | null
  report: {
    id: string
    title: string
    sourceUrl: string
    publicationDate: string | null
    processingStatus: string
  } | null
  nearby: Nearby[]
}

const SECRET_KEY = 'wfp-admin-secret'
const STATUSES = ['pending', 'rejected', 'approved'] as const

export default function ObservationsPage() {
  const [secret, setSecret] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending')
  const [commodity, setCommodity] = useState('')
  const [month, setMonth] = useState('')
  const [rows, setRows] = useState<Observation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // sessionStorage, not localStorage: the secret dies with the tab.
  useEffect(() => {
    setSecret(sessionStorage.getItem(SECRET_KEY) ?? '')
  }, [])

  const headers = useMemo(() => ({ 'x-admin-secret': secret }), [secret])

  const load = useCallback(async () => {
    if (!secret) {
      setRows([])
      setError('Enter the admin secret to load the queue.')
      return
    }

    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ status, limit: '100' })
    if (commodity) params.set('commodity', commodity)
    if (month) params.set('month', month)

    try {
      const response = await fetch(`/api/admin/observations?${params}`, { headers })
      if (response.status === 401) {
        setRows([])
        setError('That secret was not accepted.')
        return
      }
      if (!response.ok) throw new Error(`request failed with ${response.status}`)

      const body = await response.json()
      setRows(body.data)
      setTotal(body.pagination.total)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not load the queue')
    } finally {
      setLoading(false)
    }
  }, [secret, status, commodity, month, headers])

  useEffect(() => {
    if (secret) void load()
  }, [secret, status, load])

  async function decide(id: string, action: 'approve' | 'reject') {
    let notes = ''

    if (action === 'reject') {
      // The API requires a reason, so ask for one before spending a request.
      const answer = window.prompt('Why is this observation being rejected?')
      if (answer === null) return
      if (!answer.trim()) {
        setError('A rejection needs a reason.')
        return
      }
      notes = answer.trim()
    }

    setBusyId(id)
    setError(null)

    try {
      const response = await fetch(`/api/admin/observations/${id}/${action}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { notes } : {}),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? `request failed with ${response.status}`)
      }

      // Drop the row locally rather than refetching: the reviewer's place in a long queue
      // survives, which matters when working through a hundred of them.
      setRows((current) => current.filter((row) => row.id !== id))
      setTotal((current) => Math.max(0, current - 1))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'the action failed')
    } finally {
      setBusyId(null)
    }
  }

  function saveSecret(value: string) {
    setSecret(value)
    sessionStorage.setItem(SECRET_KEY, value)
  }

  return (
    <main className="wrap">
      <header>
        <h1>Observation review</h1>
        <p className="muted">
          Records here are <strong>not</strong> visible to the public API and are
          <strong> not</strong> used by the prediction model. Approving one publishes it.
        </p>
      </header>

      <section className="controls">
        <label>
          Admin secret
          <input
            type="password"
            value={secret}
            placeholder="ADMIN_SECRET"
            onChange={(event) => saveSecret(event.target.value)}
          />
        </label>

        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label>
          Commodity
          <input
            value={commodity}
            placeholder="mixed_rice"
            onChange={(event) => setCommodity(event.target.value)}
          />
        </label>

        <label>
          Month
          <input value={month} placeholder="2026-06" onChange={(event) => setMonth(event.target.value)} />
        </label>

        <button onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Apply filters'}
        </button>
      </section>

      {error && <p className="error">{error}</p>}

      <p className="muted">
        {total} record{total === 1 ? '' : 's'} with status <code>{status}</code>
      </p>

      <div className="rows">
        {rows.map((row) => {
          const previous = row.nearby.find((n) => n.observationDate < row.observationDate)
          const change = previous ? (row.priceKhr - previous.priceKhr) / previous.priceKhr : null

          return (
            <article key={row.id} className="card">
              <div className="card-head">
                <div>
                  <h2>{row.commodityNormalized}</h2>
                  <p className="muted small">
                    extracted as “{row.commodityOriginal}” · {row.unitOriginal || '(no unit)'} →{' '}
                    {row.unitNormalized}
                  </p>
                </div>
                <div className="price">
                  {row.priceKhr.toLocaleString()} <span className="muted small">KHR</span>
                </div>
              </div>

              <dl className="facts">
                <div>
                  <dt>Observation month</dt>
                  <dd>{row.observationDate.slice(0, 7)}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{row.report?.publicationDate?.slice(0, 7) ?? 'unknown'}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{row.geographicScope}</dd>
                </div>
                <div>
                  <dt>Price type</dt>
                  <dd>{row.priceType}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd className={row.extractionConfidence < 0.6 ? 'warn' : undefined}>
                    {row.extractionConfidence.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>Change vs previous approved</dt>
                  <dd className={change !== null && Math.abs(change) > 0.6 ? 'warn' : undefined}>
                    {change === null ? 'no prior approved value' : `${(change * 100).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>

              {row.nearby.length > 0 && (
                <p className="small">
                  Approved nearby:{' '}
                  {row.nearby
                    .map((n) => `${n.observationDate.slice(0, 7)} ${n.priceKhr.toLocaleString()}`)
                    .join(' · ')}
                </p>
              )}

              {row.validationNotes && <p className="notes">{row.validationNotes}</p>}

              <footer>
                {row.report && (
                  <a href={row.report.sourceUrl} target="_blank" rel="noreferrer">
                    Open source PDF ↗
                  </a>
                )}
                <span className="spacer" />
                <button
                  className="reject"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, 'reject')}
                >
                  Reject
                </button>
                <button
                  className="approve"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, 'approve')}
                >
                  Approve
                </button>
              </footer>
            </article>
          )
        })}
      </div>

      {!loading && rows.length === 0 && secret && !error && (
        <p className="muted">Nothing in this queue.</p>
      )}
    </main>
  )
}
