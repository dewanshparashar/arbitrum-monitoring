/* Fleet console — the coding-console fleet table (design Direction B).
   Ported from the design bundle's dir-console.jsx. Data is live: it polls the
   monitor-api every 30s. The R/B/A triad and the status glyph come straight
   from the API's decision-tree health statuses. */

import React from 'react'
import * as F from '../fmt.js'
import { full, relative, absolute } from '../time.js'
import { fetchFleet } from '../api.js'
import { Tip } from './tooltip.jsx'
import { ConsoleInspect } from './ConsoleInspect.jsx'

const C = {
  kw: '#C792EA',
  str: '#3DD68C',
  num: '#12AAFF',
  fn: '#82AAFF',
  com: '#5A6478',
  warn: '#F5B544',
  crit: '#FF5C6C',
  txt: '#C8D2E0',
  flag: '#F0A35E',
}
const stColor = { ok: C.str, warn: C.warn, crit: C.crit, idle: C.com }
const glyph = { ok: '●', warn: '◆', crit: '✖', idle: '○' }
const order = { crit: 0, warn: 1, idle: 2, ok: 3 }

const POLL_MS = 30_000

const heartbeatChar = v =>
  v == null ? '·' : v >= 99.5 ? '▁' : v >= 99 ? '▃' : v >= 97 ? '▅' : v >= 90 ? '▆' : '█'

export function Console() {
  const [chains, setChains] = React.useState([])
  const [overview, setOverview] = React.useState(null)
  const [fetchedAt, setFetchedAt] = React.useState(null)
  const [status, setStatus] = React.useState('loading')
  const [error, setError] = React.useState(null)
  const [cursor, setCursor] = React.useState(true)
  const [selected, setSelected] = React.useState(null)

  React.useEffect(() => {
    const t = setInterval(() => setCursor(c => !c), 530)
    return () => clearInterval(t)
  }, [])

  React.useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const { overview, chains, fetchedAt } = await fetchFleet()
        if (!live) return
        setOverview(overview)
        setChains(chains)
        setFetchedAt(fetchedAt)
        setStatus('ok')
        setError(null)
      } catch (e) {
        if (!live) return
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Failed to load fleet.')
      }
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(iv)
    }
  }, [])

  const sorted = [...chains].sort(
    (a, b) => order[a.health] - order[b.health] || (b.bridge.tvlUsd || 0) - (a.bridge.tvlUsd || 0)
  )

  // fleet rollups derived from the per-chain overall health (matches glyphs)
  const fleet = {
    total: chains.length,
    ok: chains.filter(c => c.health === 'ok').length,
    warn: chains.filter(c => c.health === 'warn').length,
    crit: chains.filter(c => c.health === 'crit').length,
    parents: new Set(chains.map(c => c.parentChainId)).size,
    tvlUsd: overview?.totalTvlUsd ?? 0,
    pendingUsd: overview?.totalPendingOutUsd ?? 0,
    openRetryables: overview?.retryablesOpen ?? 0,
    activeAlerts: overview?.alerts ?? 0,
  }

  const mono = { fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: '24px', fontVariantNumeric: 'tabular-nums' }
  const col = (w, align = 'left') => ({
    display: 'inline-block',
    width: w,
    textAlign: align,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'bottom',
  })
  const rowNoWrap = { whiteSpace: 'nowrap' }

  const Gutter = ({ n }) => (
    <span style={{ display: 'inline-block', width: 30, textAlign: 'right', color: C.com, userSelect: 'none', paddingRight: 14, opacity: 0.7 }}>{n}</span>
  )

  let line = 0
  const next = () => ++line

  return (
    <div style={{ background: '#080A0F', minHeight: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--mono)' }}>
      {/* window chrome */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', background: '#0E121B', borderBottom: '1px solid var(--hairline)' }}>
        <span style={{ display: 'flex', gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840' }} />
        </span>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.02em' }}>
          arb-monitor — fleet watch — zsh — 142×48
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>fsn1 ● live</span>
      </div>

      {/* terminal body */}
      <div style={{ padding: '16px 18px 6px', flex: 1, ...mono, color: C.txt, overflowX: 'auto' }}>
        <div style={{ minWidth: 1020 }}>
          {/* command + boot log */}
          <div style={{ marginBottom: 14 }}>
            <div>
              <span style={{ color: C.str }}>arb@fsn1</span>
              <span style={{ color: C.com }}>:</span>
              <span style={{ color: C.fn }}>~/fleet</span>
              <span style={{ color: C.com }}>$ </span>
              <span style={{ color: C.txt }}>arb-monitor watch </span>
              <span style={{ color: C.flag }}>--fleet</span>
              <span style={{ color: C.txt }}> </span>
              <span style={{ color: C.flag }}>--interval</span>
              <span style={{ color: C.num }}> 30s</span>
            </div>
            <div style={{ color: C.com }}>
              → connecting to indexer @ <span style={{ color: C.fn }}>hetzner-fsn1</span> ............{' '}
              {status === 'ok' ? <span style={{ color: C.str }}>ok</span> : status === 'error' ? <span style={{ color: C.crit }}>failed</span> : <span style={{ color: C.warn }}>…</span>}
            </div>
            {status === 'error' ? (
              <div style={{ color: C.crit }}>→ {error}</div>
            ) : (
              <>
                <div style={{ color: C.com }}>
                  → syncing <span style={{ color: C.num }}>{fleet.total}</span> chains across <span style={{ color: C.num }}>{fleet.parents}</span> parent networks ...{' '}
                  {status === 'ok' ? <span style={{ color: C.str }}>ok</span> : <span style={{ color: C.warn }}>…</span>}
                </div>
                <div style={{ color: C.com }}>
                  → last probe{' '}
                  <Tip label={full(overview?.lastRpcCheckAt)}><span style={{ color: C.num }}>{overview?.lastRpcCheckAt ? relative(overview.lastRpcCheckAt) : '—'}</span></Tip> ·{' '}
                  fetched <Tip label={full(fetchedAt)}><span style={{ color: C.num }}>{fetchedAt ? relative(fetchedAt) : '—'}</span></Tip> ·{' '}
                  <span style={{ color: C.str }}>{fleet.ok} ok</span> <span style={{ color: C.warn }}>{fleet.warn} warn</span>{' '}
                  <span style={{ color: C.crit }}>{fleet.crit} crit</span> · alerts <span style={{ color: C.warn }}>{fleet.activeAlerts}</span>
                </div>
              </>
            )}
          </div>

          {/* table header */}
          <div style={{ color: C.com, borderBottom: '1px solid var(--hairline)', paddingBottom: 4, ...rowNoWrap }}>
            <Gutter n="#" />
            <span style={col(150)}><Tip underline label="The Orbit / Arbitrum chain being monitored. Click any row to inspect it.">chain</Tip></span>
            <span style={col(118)}><Tip underline label="The settlement (parent) chain this chain posts its batches and assertions to.">parent</Tip></span>
            <span style={col(96)}><Tip underline label="Rollup posts tx data on-chain; AnyTrust uses a Data Availability Committee. +bold = BoLD permissionless dispute protocol.">type</Tip></span>
            <span style={col(56, 'center')}>
              <Tip underline w={260} label={<span><b>Monitor triad</b> — from the alert decision tree.<br /><b style={{ color: '#82AAFF' }}>R</b> Retryable · cross-chain message health<br /><b style={{ color: '#82AAFF' }}>B</b> Batch poster · sequencer posting<br /><b style={{ color: '#82AAFF' }}>A</b> Assertion · validator / confirmation health</span>}>r b a</Tip>
            </span>
            <span style={col(146)}><Tip underline w={250} label="RPC reachability over the indexer window. Bars reflect current uptime; per-probe history is in the inspector.">rpc.uptime</Tip></span>
            <span style={col(78, 'right')}><Tip underline label="Latest successful RPC probe latency from the worker.">lat</Tip></span>
            <span style={col(78, 'right')}><Tip underline label="Value bridged into the chain (native-token balance × price), in USD.">tvl</Tip></span>
            <span style={col(82, 'right')}><Tip underline label="Funds in outbound withdrawals not yet claimed on the parent chain.">pending</Tip></span>
            <span style={col(74, 'right')}><Tip underline label="Time since the sequencer last posted a batch to the parent chain.">batch</Tip></span>
            <span style={col(66, 'right')}><Tip underline label="Open retryable tickets · the trailing number flags urgent (expiring/expired) ones.">retry</Tip></span>
            <span style={col(46, 'right')}><Tip underline label="Active firing monitors for this chain (R/B/A).">alert</Tip></span>
          </div>

          {/* rows */}
          {sorted.map(c => {
            const m = c.mon
            const upColor = stColor[c.rpc.status]
            const ln = next()
            return (
              <div
                key={c.id}
                style={{ cursor: 'pointer', ...rowNoWrap }}
                onClick={() => setSelected(c)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.035)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Gutter n={ln} />
                <span style={col(150)}>
                  <Tip label={c.health === 'crit' ? 'Outage — one or more monitors critical' : c.health === 'warn' ? 'Degraded — a monitor needs attention' : c.health === 'idle' ? 'Unknown — insufficient indexed data' : 'Operational — all monitors healthy'}>
                    <span style={{ color: stColor[c.health], marginRight: 7 }}>{glyph[c.health]}</span>
                  </Tip>
                  <span style={{ color: c.color }}>{c.id.length > 16 ? c.id.slice(0, 15) + '…' : c.id}</span>
                </span>
                <span style={{ ...col(118), color: C.com }}>{c.parent}</span>
                <span style={{ ...col(96), color: C.kw }}>{c.transport === 'AnyTrust' ? 'anytrust' : c.transport === 'Rollup' ? 'rollup' : '—'}{c.bold ? '+bold' : ''}</span>
                <span style={col(56, 'center')}>
                  <Tip w={230} label={<span><b style={{ color: stColor[m.R] }}>R</b>etryable: {m.R}<br /><b style={{ color: stColor[m.B] }}>B</b>atch poster: {m.B}<br /><b style={{ color: stColor[m.A] }}>A</b>ssertion: {m.A}</span>}>
                    <span style={{ color: stColor[m.R] }}>●</span>{' '}
                    <span style={{ color: stColor[m.B] }}>●</span>{' '}
                    <span style={{ color: stColor[m.A] }}>●</span>
                  </Tip>
                </span>
                <span style={col(146)}>
                  <span style={{ color: upColor, letterSpacing: '0px', marginRight: 8 }}>
                    {c.rpc.uptimePct == null ? '·········' : heartbeatChar(c.rpc.uptimePct).repeat(11)}
                  </span>
                  <span style={{ color: upColor }}>{c.rpc.uptimePct == null ? 'no data' : c.rpc.uptimePct.toFixed(2) + '%'}</span>
                </span>
                <span style={{ ...col(78, 'right'), color: c.rpc.latency == null ? C.com : c.rpc.latency > 350 ? C.warn : C.com }}>
                  {c.rpc.latency == null ? 'n/a' : c.rpc.latency + 'ms'}
                </span>
                <span style={{ ...col(78, 'right'), color: C.num }}>{c.bridge.tvlUsd == null ? '—' : F.money(c.bridge.tvlUsd)}</span>
                <span style={{ ...col(82, 'right'), color: C.txt }}>{c.bridge.pendingUsd == null ? '—' : F.money(c.bridge.pendingUsd)}</span>
                <span style={{ ...col(74, 'right'), color: c.batch.lastMins != null && c.batch.lastMins > c.batch.targetMins * 2 ? C.crit : C.com }}>
                  {F.dur(c.batch.lastMins)}
                </span>
                <span style={{ ...col(66, 'right'), color: c.retry.urgent > 0 ? C.warn : C.com }}>
                  {c.retry.open}
                  {c.retry.urgent > 0 ? <span style={{ color: C.warn }}>·{c.retry.urgent}!</span> : ''}
                </span>
                <span style={{ ...col(46, 'right'), color: c.alerts > 0 ? (c.health === 'crit' ? C.crit : C.warn) : C.com }}>
                  {c.alerts > 0 ? c.alerts : '·'}
                </span>
              </div>
            )
          })}

          {/* hint + prompt cursor */}
          <div style={{ marginTop: 10, color: C.com, fontSize: 11.5, ...rowNoWrap }}>
            <Gutter n="" />
            <span style={{ opacity: 0.75 }}>↳ click any row to <span style={{ color: C.flag }}>inspect</span> a chain</span>
          </div>
          <div style={{ marginTop: 6, color: C.com, ...rowNoWrap }}>
            <Gutter n={next()} />
            <span style={{ color: C.str }}>arb@fsn1</span>
            <span style={{ color: C.com }}>:</span>
            <span style={{ color: C.fn }}>~/fleet</span>
            <span style={{ color: C.com }}>$ </span>
            <span style={{ display: 'inline-block', width: 8, height: 15, background: cursor ? C.str : 'transparent', verticalAlign: 'text-bottom', transform: 'translateY(2px)' }} />
          </div>
        </div>
      </div>

      {/* status bar (VS Code style) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--arb-blue)', color: '#fff', fontSize: 11.5, height: 26 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 11px', background: 'rgba(0,0,0,0.18)', height: '100%' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: fleet.crit ? '#FFB4BC' : '#B8F5D6' }} />
          {status === 'error' ? 'disconnected' : fleet.crit ? 'partial outage' : fleet.warn ? 'degraded' : 'operational'}
        </span>
        <span style={{ padding: '0 11px', display: 'flex', gap: 13 }}>
          <span>✖ {fleet.crit}</span>
          <span>⚠ {fleet.warn}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ padding: '0 11px', opacity: 0.92 }}>TVL {F.money(fleet.tvlUsd)}</span>
        <span style={{ padding: '0 11px', opacity: 0.92 }}>pending {F.money(fleet.pendingUsd)}</span>
        <span style={{ padding: '0 11px', opacity: 0.92 }}>retryables {fleet.openRetryables}</span>
        <span style={{ padding: '0 13px', background: 'rgba(0,0,0,0.18)', height: '100%', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.8 }}>indexer</span> fsn1 ● live
        </span>
      </div>

      {selected && <ConsoleInspect chain={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
