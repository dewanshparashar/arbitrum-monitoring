/* Fleet console — the coding-console fleet table (design Direction B).
   Ported from the design bundle's dir-console.jsx. Data is live: it polls the
   monitor-api every 30s. The R/B/A triad and the status glyph come straight
   from the API's decision-tree health statuses. */

import React from 'react'
import * as F from '../fmt.js'
import { full, relative, absolute } from '../time.js'
import { fetchFleet } from '../api.js'
import { Tip } from './tooltip.jsx'
import { BlinkCursor } from './viz.jsx'
import { ConsoleInspect } from './ConsoleInspect.jsx'
import { Legend, HEADERS, whyOverall, whyIndexing } from '../explainers.jsx'

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

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const BANNER = [
  '╔═╗╦  ╔═╗╔═╗╔╦╗  ╦ ╦╔═╗╔╦╗╔═╗╦ ╦',
  '╠╣ ║  ║╣ ║╣  ║   ║║║╠═╣ ║ ║  ╠═╣',
  '╚  ╩═╝╚═╝╚═╝ ╩   ╚╩╝╩ ╩ ╩ ╚═╝╩ ╩',
]
// minimum time the boot splash is shown (ms) — even if data loads faster
const SPLASH_MS = 5000

// centered terminal boot splash — animates over SPLASH_MS with an ASCII
// progress bar and a sequential boot log. `progress` is 0..1.
function Splash({ frame, progress = 0, error }) {
  const C2 = { com: '#5A6478', str: '#3DD68C', warn: '#F5B544', crit: '#FF5C6C', num: '#12AAFF', fn: '#82AAFF' }
  const steps = [
    'initializing fleet register',
    'loading portal snapshot · arbitrum dedicated chains',
    'connecting to indexer @ hetzner-fsn1',
    'fetching fleet overview + chain health',
    'rendering console',
  ]
  // how many steps have completed, derived from elapsed progress
  const done = Math.min(steps.length, Math.floor(progress * steps.length))
  const stateFor = i => {
    if (error) {
      if (i < 2) return 'ok'
      if (i === 2) return 'fail'
      return 'skip'
    }
    if (i < done) return 'ok'
    if (i === done) return 'pend'
    return 'wait'
  }
  const BARW = 30
  const filled = Math.max(0, Math.min(BARW, Math.round(progress * BARW)))
  const pct = Math.round(progress * 100)
  const barColor = error ? C2.crit : C2.num

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'var(--mono)' }}>
      <pre style={{ margin: 0, lineHeight: 1.12, fontSize: 'clamp(11px, 2.1vw, 17px)', color: 'var(--arb-cyan)', textShadow: '0 0 22px rgba(18,170,255,0.45)' }}>
        {BANNER.join('\n')}
      </pre>
      <div style={{ color: 'var(--text-4)', fontSize: 11.5, margin: '12px 0 26px', letterSpacing: '0.22em' }}>
        FLEETWATCH.XYZ · ARBITRUM DEDICATED CHAINS · FLEET MONITOR
      </div>
      <div style={{ width: 'min(520px, 88vw)', fontSize: 12.5, lineHeight: '25px', textAlign: 'left' }}>
        {steps.map((label, i) => {
          const state = stateFor(i)
          const dots = '.'.repeat(Math.max(0, 46 - label.length))
          return (
            <div key={i} style={{ color: state === 'wait' ? 'rgba(90,100,120,0.45)' : C2.com }}>
              <span style={{ color: state === 'fail' ? C2.crit : state === 'wait' ? C2.com : C2.str, marginRight: 10 }}>
                {state === 'ok' ? '✓' : state === 'fail' ? '✖' : state === 'skip' ? '·' : state === 'pend' ? SPINNER[frame] : '○'}
              </span>
              {label} <span style={{ color: 'rgba(90,100,120,0.5)' }}>{dots}</span>{' '}
              {state === 'ok' && <span style={{ color: C2.str }}>ok</span>}
              {state === 'fail' && <span style={{ color: C2.crit }}>failed</span>}
              {state === 'pend' && <span style={{ color: C2.warn }}>…</span>}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 22, fontSize: 13, color: barColor, letterSpacing: '0.04em' }}>
        <span style={{ opacity: 0.85 }}>[</span>
        <span>{'█'.repeat(filled)}</span>
        <span style={{ color: 'rgba(90,100,120,0.5)' }}>{'░'.repeat(BARW - filled)}</span>
        <span style={{ opacity: 0.85 }}>]</span>
        <span style={{ marginLeft: 10, color: C2.com }}>{pct}%</span>
      </div>
      {error && <div style={{ color: C2.crit, marginTop: 16, fontSize: 12.5 }}>! {error}</div>}
    </div>
  )
}

const heartbeatChar = v =>
  v == null ? '·' : v >= 99.5 ? '▁' : v >= 99 ? '▃' : v >= 97 ? '▅' : v >= 90 ? '▆' : '█'

export function Console() {
  const [chains, setChains] = React.useState([])
  const [overview, setOverview] = React.useState(null)
  const [statusInfo, setStatusInfo] = React.useState(null)
  const [fetchedAt, setFetchedAt] = React.useState(null)
  const [status, setStatus] = React.useState('loading')
  const [error, setError] = React.useState(null)
  const [selected, setSelected] = React.useState(null)
  const [showLegend, setShowLegend] = React.useState(false)
  const [frame, setFrame] = React.useState(0)

  const closeInspect = React.useCallback(() => setSelected(null), [])
  const closeLegend = React.useCallback(() => setShowLegend(false), [])

  // The boot splash shows for at least SPLASH_MS, and longer if data is still
  // loading. `elapsed` drives the progress bar + sequential boot log.
  const [elapsed, setElapsed] = React.useState(0)
  const minElapsed = elapsed >= SPLASH_MS
  React.useEffect(() => {
    if (minElapsed) return undefined
    const t = setInterval(() => setElapsed(e => Math.min(e + 100, SPLASH_MS)), 100)
    return () => clearInterval(t)
  }, [minElapsed])

  const splashing = !minElapsed || (status === 'loading' && chains.length === 0)
  const splashProgress = Math.min(1, elapsed / SPLASH_MS)

  // Spinner only animates during the splash — never while the table
  // (and any open tooltip/inspector) is mounted.
  React.useEffect(() => {
    if (!splashing) return undefined
    const s = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 90)
    return () => clearInterval(s)
  }, [splashing])

  React.useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const { overview, chains, status, fetchedAt } = await fetchFleet()
        if (!live) return
        setOverview(overview)
        setChains(chains)
        setStatusInfo(status)
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
          fleetwatch — arbitrum dedicated chains fleet monitor — zsh — 142×48
        </span>
        <button
          onClick={() => setShowLegend(true)}
          title="How are these insights derived?"
          style={{ background: 'none', border: '1px solid var(--hairline-2)', color: 'var(--text-3)', borderRadius: 6, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', marginRight: 10 }}
        >
          ? explain
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>fsn1 ● live</span>
      </div>

      {/* terminal body */}
      <div style={{ padding: '16px 18px 38px', flex: 1, ...mono, color: C.txt, overflowX: 'auto' }}>
        {splashing ? (
          <div style={{ minHeight: 'calc(100vh - 150px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Splash frame={frame} progress={splashProgress} error={status === 'error' ? error : null} />
          </div>
        ) : (
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
                <div style={{ color: C.com }}>
                  → <Tip w={320} label={whyIndexing(statusInfo)}><span style={{ borderBottom: '1px dotted rgba(255,255,255,0.2)' }}>index.status</span></Tip>:{' '}
                  {statusInfo?.indexer?.parents?.length ? (
                    statusInfo.indexer.parents.map((p, i) => (
                      <span key={p.parentChainId}>
                        {i ? ' · ' : ''}
                        <span style={{ color: C.fn }}>{p.parentChainName.toLowerCase().replace(/\s+/g, '-')}</span>{' '}
                        <span style={{ color: p.lagSeconds != null && p.lagSeconds < 600 ? C.str : C.warn }}>{p.latestEventAt ? relative(p.latestEventAt) : '—'}</span>
                      </span>
                    ))
                  ) : (
                    <span style={{ color: C.com }}>indexer freshness unavailable</span>
                  )}
                  {' · worker '}
                  {statusInfo?.worker ? (
                    <span style={{ color: statusInfo.worker.status === 'ok' ? C.str : C.crit }}>
                      {statusInfo.worker.status === 'ok' ? '✓' : '✖'} {statusInfo.worker.stateUpdatedAt ? relative(statusInfo.worker.stateUpdatedAt) : '—'}
                    </span>
                  ) : (
                    <span style={{ color: C.com }}>pending</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* table header */}
          <div style={{ color: C.com, borderBottom: '1px solid var(--hairline)', paddingBottom: 4, ...rowNoWrap }}>
            <Gutter n="#" />
            <span style={col(150)}><Tip underline w={250} label={HEADERS.chain}>chain</Tip></span>
            <span style={col(96)}><Tip underline w={250} label={HEADERS.id}>chainId</Tip></span>
            <span style={col(118)}><Tip underline w={250} label={HEADERS.parent}>parent</Tip></span>
            <span style={col(96)}><Tip underline w={280} label={HEADERS.type}>type</Tip></span>
            <span style={col(58)}><Tip underline w={250} label={HEADERS.native}>gas</Tip></span>
            <span style={col(96)}><Tip underline w={300} label={HEADERS.arbos}>arbos</Tip></span>
            <span style={col(56, 'center')}>
              <Tip underline w={290} label={<span><b style={{ color: '#fff' }}>Monitor triad</b> — the alert decision tree.<br /><b style={{ color: '#82AAFF' }}>R</b> Retryable · cross-chain message health<br /><b style={{ color: '#82AAFF' }}>B</b> Batch poster · sequencer posting &amp; cadence<br /><b style={{ color: '#82AAFF' }}>A</b> Assertion · validator / confirmation health<br /><span style={{ color: 'var(--text-3)' }}>Hover a row's dots for that chain's verdict · click <b>? explain</b> for full rules.</span></span>}>r b a</Tip>
            </span>
            <span style={col(146)}><Tip underline w={250} label={HEADERS.rpc}>rpc.uptime</Tip></span>
            <span style={col(78, 'right')}><Tip underline w={250} label={HEADERS.lat}>lat</Tip></span>
            <span style={col(116, 'right')}><Tip underline w={280} label={HEADERS.tvl}>bridged tvl</Tip></span>
            <span style={col(104, 'right')}><Tip underline w={260} label={HEADERS.pending}>pending</Tip></span>
            <span style={col(74, 'right')}><Tip underline w={250} label={HEADERS.batch}>batch</Tip></span>
            <span style={col(66, 'right')}><Tip underline w={260} label={HEADERS.retry}>retry</Tip></span>
            <span style={col(46, 'right')}><Tip underline w={250} label={HEADERS.alert}>alert</Tip></span>
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
                  <Tip w={280} label={whyOverall(c)}>
                    <span style={{ color: stColor[c.health], marginRight: 7 }}>{glyph[c.health]}</span>
                  </Tip>
                  <span style={{ color: c.color }}>{c.id.length > 16 ? c.id.slice(0, 15) + '…' : c.id}</span>
                </span>
                <span style={{ ...col(96), color: C.num }}>{c.chainId}</span>
                <span style={{ ...col(118), color: C.com }}>{c.parent}</span>
                <span style={{ ...col(96), color: C.kw }}>{c.transport === 'AnyTrust' ? 'anytrust' : c.transport === 'Rollup' ? 'rollup' : '—'}{c.bold ? '+bold' : ''}</span>
                <span style={{ ...col(58), color: c.isCustomGasToken ? C.flag : C.com }}>{c.native}</span>
                <span style={{ ...col(96), color: c.arbos && c.arbos.version != null ? C.kw : C.com }}>
                  {c.arbos && c.arbos.version != null
                    ? <Tip w={280} label={<>ArbOS {c.arbos.version}{c.arbos.name ? ' (' + c.arbos.name + ')' : ''} · read on-chain via ArbSys.arbOSVersion() (raw {c.arbos.raw}, −55 offset).</>}>
                        <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>{c.arbos.version}{c.arbos.name ? ' ' + c.arbos.name : ''}</span>
                      </Tip>
                    : '—'}
                </span>
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
                <span style={{ ...col(116, 'right'), color: c.bridge.tvlUsd != null ? C.num : c.bridge.balanceNative != null ? C.flag : C.com }}>
                  {c.bridge.tvlUsd != null
                    ? F.money(c.bridge.tvlUsd)
                    : c.bridge.balanceNative != null
                      ? <Tip w={260} label={`Native bridged amount — no USD price feed for ${c.bridge.balanceAsset || c.native}, so the gas-token balance is shown instead of a dollar value.`}>
                          <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>{F.compact(c.bridge.balanceNative, c.bridge.balanceAsset || c.native)}</span>
                        </Tip>
                      : '—'}
                </span>
                <span style={{ ...col(104, 'right'), color: c.bridge.pendingUsd != null ? C.txt : c.bridge.pendingNative ? C.flag : C.com }}>
                  {c.bridge.pendingUsd != null
                    ? F.money(c.bridge.pendingUsd)
                    : c.bridge.pendingNative
                      ? <Tip w={260} label={`Native pending-withdrawal amount — no USD price feed for ${c.native}, so the gas-token value is shown instead of a dollar value.`}>
                          <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>{F.compact(c.bridge.pendingNative, c.native)}</span>
                        </Tip>
                      : '—'}
                </span>
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
            <BlinkCursor color={C.str} />
          </div>
        </div>
        )}
      </div>

      {/* status bar (VS Code style) — fixed to the bottom of the viewport */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 0, background: 'var(--arb-blue)', color: '#fff', fontSize: 11.5, height: 26 }}>
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

      {selected && <ConsoleInspect chain={selected} onClose={closeInspect} />}
      {showLegend && <Legend onClose={closeLegend} />}
    </div>
  )
}
