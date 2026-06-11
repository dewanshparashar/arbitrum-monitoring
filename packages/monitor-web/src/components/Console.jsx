/* Fleet console — the coding-console fleet table (design Direction B).
   Ported from the design bundle's dir-console.jsx. Data is live: it polls the
   monitor-api every 30s. The R/B/A triad and the status glyph come straight
   from the API's decision-tree health statuses. */

import React from 'react'
import useSWR from 'swr'
import * as F from '../fmt.js'
import { full, relative, absolute } from '../time.js'
import { fetchFleet, HIGH_VALUE_USD } from '../api.js'
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

// Boot animation timeline (ms): type the command, then stream the log lines,
// then reveal the table — like watching the terminal boot up.
const BOOT_CMD = 'arb-monitor watch --fleet --interval 30s'
const BOOT_TYPE_START = 250
const BOOT_MS_PER_CHAR = 30
const BOOT_TYPE_END = BOOT_TYPE_START + BOOT_CMD.length * BOOT_MS_PER_CHAR
// output lines stream faster than the typed command (it's program output)
const BOOT_LINE_RATE = 11 // ms per char
const BOOT_T = {
  l1: BOOT_TYPE_END + 300, // connecting to indexer
  l2: BOOT_TYPE_END + 1250, // syncing chains
  l3: BOOT_TYPE_END + 2250, // last probe / counts
  done: BOOT_TYPE_END + 3350, // table drops in
}

const fmtTps = v => (v < 1 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString())

// TPS is a sampled estimate; for non-zero chains, gently jitter ±~3.5% each
// second to suggest live activity. Isolated so only this cell re-renders.
const LiveTps = React.memo(function LiveTps({ value }) {
  const [shown, setShown] = React.useState(value)
  React.useEffect(() => {
    setShown(value)
    if (!(value > 0)) return undefined
    const id = setInterval(() => {
      setShown(value * (1 + (Math.random() - 0.5) * 0.07))
    }, 1000)
    return () => clearInterval(id)
  }, [value])
  if (value == null) return '—'
  if (!(value > 0)) return fmtTps(0)
  return '~' + fmtTps(shown)
})

// Mini RPC sparkline for the table: bar height ∝ inverse latency (faster =
// taller), color ∝ uptime per bucket. A compact preview of the inspector chart.
const MiniUptime = React.memo(function MiniUptime({ history }) {
  if (!history || !history.length) {
    return <span style={{ display: 'inline-block', width: 80, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, verticalAlign: 'middle' }} />
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1.5, height: 14, width: 80, verticalAlign: 'middle' }}>
      {history.map((b, i) => {
        if (!b || b.pct == null) {
          return <span key={i} style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.09)', borderRadius: 1 }} />
        }
        const color = b.pct < 95 ? C.crit : b.pct < 99.5 || (b.p50 != null && b.p50 > 350) ? C.warn : C.str
        const lat = b.p50 == null ? 250 : b.p50
        const h = Math.max(0.2, Math.min(1, 1 - lat / 1200)) // faster → taller
        const title = `${b.pct.toFixed(1)}% up${b.p50 != null ? ` · p50 ${b.p50}ms` : ''}`
        return (
          <span
            key={i}
            title={title}
            style={{ flex: 1, height: Math.round(h * 100) + '%', minHeight: 2, background: color, borderRadius: 1, opacity: color === C.str ? 0.7 : 0.95 }}
          />
        )
      })}
    </span>
  )
})

// A boot-log line that types out `plain` char-by-char from `start` (ms), then
// swaps to the colored `children` (same visible text). Hidden until it starts.
function BootLine({ start, rate, elapsed, plain, cursorColor, children }) {
  const n = Math.floor((elapsed - start) / rate)
  if (n <= 0) return null
  if (n >= plain.length) {
    return <div style={{ color: '#5A6478' }}>{children}</div>
  }
  return (
    <div style={{ color: '#5A6478' }}>
      {plain.slice(0, n)}
      <BlinkCursor color={cursorColor} h={12} />
    </div>
  )
}

const PARENT_ABBR = { Ethereum: 'eth', Base: 'base', 'Arbitrum One': 'arb' }

// Compact indexer/worker freshness for the bottom status bar (white-on-blue).
const IndexStatus = React.memo(function IndexStatus({ statusInfo }) {
  const parents = statusInfo?.indexer?.parents
  const worker = statusInfo?.worker
  return (
    <span style={{ padding: '0 12px', background: 'rgba(0,0,0,0.18)', height: '100%', display: 'flex', alignItems: 'center', gap: 11 }}>
      <Tip w={320} label={whyIndexing(statusInfo)}>
        <span style={{ opacity: 0.85, borderBottom: '1px dotted rgba(255,255,255,0.4)' }}>index</span>
      </Tip>
      {parents?.length ? (
        parents.map(p => {
          const abbr = PARENT_ABBR[p.parentChainName] || p.parentChainName.toLowerCase().replace(/\s+/g, '-')
          const stale = !(p.lagSeconds != null && p.lagSeconds < 600)
          const behind =
            p.behindBlocks == null ? null : p.behindBlocks === 0 ? 'head' : F.compact(p.behindBlocks)
          return (
            <Tip
              key={p.parentChainId}
              w={300}
              label={
                <span>
                  <b style={{ color: '#fff' }}>{p.parentChainName}</b>
                  <br />
                  indexed block <b style={{ color: '#fff' }}>{F.num(p.indexedBlock)}</b>
                  <br />
                  chain head <b style={{ color: '#fff' }}>{F.num(p.headBlock)}</b>
                  {p.headCheckedAt ? <span style={{ color: 'var(--text-3)' }}> (read {relative(p.headCheckedAt)})</span> : null}
                  <br />
                  <span style={{ color: p.behindBlocks > 2000 ? '#F5B544' : '#3DD68C' }}>
                    {p.behindBlocks == null ? 'lag unavailable' : p.behindBlocks === 0 ? 'at head' : `~${F.compact(p.behindBlocks)} blocks behind`}
                  </span>
                  <br />
                  <span style={{ color: 'var(--text-3)' }}>latest event {p.latestEventAt ? relative(p.latestEventAt) : '—'}</span>
                </span>
              }
            >
              <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.3)', color: stale ? '#FFD27A' : '#fff' }}>
                {abbr} {p.latestEventAt ? relative(p.latestEventAt) : '—'}
                {behind ? <span style={{ opacity: 0.85 }}> ·{behind === 'head' ? ' head' : ' ' + behind}</span> : null}
              </span>
            </Tip>
          )
        })
      ) : (
        <span style={{ opacity: 0.7 }}>freshness unavailable</span>
      )}
      <span style={{ opacity: 0.45 }}>·</span>
      <span style={{ opacity: 0.85 }}>worker</span>
      {worker ? (
        <span style={{ color: worker.status === 'ok' ? '#B8F5D6' : '#FFB4BC' }}>
          {worker.status === 'ok' ? '✓' : '✖'} {worker.stateUpdatedAt ? relative(worker.stateUpdatedAt) : '—'}
        </span>
      ) : (
        <span style={{ opacity: 0.7 }}>pending</span>
      )}
    </span>
  )
})

export function Console() {
  // SWR: poll the fleet every POLL_MS, revalidate on window focus, and keep the
  // previous data visible while refetching (no flicker / no splash on refresh).
  const { data, error: swrError } = useSWR('fleet', fetchFleet, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
    dedupingInterval: 15_000,
  })
  const chains = data?.chains ?? []
  const overview = data?.overview ?? null
  const statusInfo = data?.status ?? null
  const fetchedAt = data?.fetchedAt ?? null
  // stale-while-revalidate: once we have data we stay 'ok' even if a background
  // refresh later errors; only show 'error'/'loading' before the first payload.
  const status = data ? 'ok' : swrError ? 'error' : 'loading'
  const error = !data && swrError ? (swrError instanceof Error ? swrError.message : 'Failed to load fleet.') : null

  const [selected, setSelected] = React.useState(null)
  const [showLegend, setShowLegend] = React.useState(false)

  const closeInspect = React.useCallback(() => setSelected(null), [])
  const closeLegend = React.useCallback(() => setShowLegend(false), [])

  // Boot animation: type the command, stream the log lines, then drop in the
  // table. `elapsed` (ms) drives the sequence; it stops once the boot finishes,
  // and the table additionally waits on the first data payload.
  const [elapsed, setElapsed] = React.useState(0)
  const bootDone = elapsed >= BOOT_T.done
  React.useEffect(() => {
    if (bootDone) return undefined
    const t = setInterval(() => setElapsed(e => Math.min(e + 50, BOOT_T.done)), 50)
    return () => clearInterval(t)
  }, [bootDone])

  const typedChars = Math.max(
    0,
    Math.min(BOOT_CMD.length, Math.floor((elapsed - BOOT_TYPE_START) / BOOT_MS_PER_CHAR))
  )
  const typingDone = typedChars >= BOOT_CMD.length
  const dataReady = !!data
  const showTable = bootDone && dataReady

  // Sort: economic weight first. Chains with a USD TVL rank at the top by $ desc;
  // chains with no price feed form a tail below them, ranked among themselves by
  // TPS desc (so an unpriced-but-busy chain can't leapfrog a genuinely larger
  // $-chain — different units, so we partition rather than coalesce). Health and
  // name are the final tie-breakers. Null TPS sinks below measured-zero.
  const tvlKey = c => (typeof c.bridge.tvlUsd === 'number' ? c.bridge.tvlUsd : null)
  const tpsKey = c => (typeof c.tps === 'number' ? c.tps : -1)
  const sorted = [...chains].sort((a, b) => {
    const av = tvlKey(a)
    const bv = tvlKey(b)
    if (av != null && bv != null && av !== bv) return bv - av
    if ((av != null) !== (bv != null)) return av != null ? -1 : 1
    return (
      tpsKey(b) - tpsKey(a) ||
      order[a.health] - order[b.health] ||
      a.name.localeCompare(b.name)
    )
  })

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
    <div style={{ background: '#080A0F', minHeight: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--mono)', overflowX: 'hidden' }}>
      {/* window chrome */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', background: '#0E121B', borderBottom: '1px solid var(--hairline)' }}>
        <span style={{ display: 'flex', gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          fleetwatch — arbitrum dedicated chains fleet monitor — zsh<span className="fw-chrome-dims"> — 142×48</span>
        </span>
        <button
          onClick={() => setShowLegend(true)}
          title="How are these insights derived?"
          style={{ background: 'none', border: '1px solid var(--hairline-2)', color: 'var(--text-3)', borderRadius: 6, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', marginRight: 10 }}
        >
          ? explain
        </button>
        <span className="fw-chrome-host" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>fsn1 ● live</span>
      </div>

      {/* touch cue — hidden on desktop, shown below the title bar on mobile,
          where the table scrolls horizontally rather than reflowing */}
      <div className="fw-swipe-hint" style={{ alignItems: 'center', gap: 7, padding: '7px 16px', background: '#0B0F18', borderBottom: '1px solid var(--hairline)', fontSize: 11, color: C.com }}>
        <span style={{ color: C.flag }}>↔</span> swipe to see all columns · tap a row to inspect
      </div>

      {/* terminal body */}
      <div style={{ padding: '16px 18px 38px', flex: 1, ...mono, color: C.txt, overflowX: 'auto' }}>
        <div style={{ minWidth: 1020 }}>
          {/* animated boot log: types the command, streams the log lines, then
              reveals the table below — one continuous "terminal booting" effect */}
          <div style={{ marginBottom: 14 }}>
            <div>
              <span style={{ color: C.str }}>arb@fsn1</span>
              <span style={{ color: C.com }}>:</span>
              <span style={{ color: C.fn }}>~/fleet</span>
              <span style={{ color: C.com }}>$ </span>
              {typingDone ? (
                <>
                  <span style={{ color: C.txt }}>arb-monitor watch </span>
                  <span style={{ color: C.flag }}>--fleet</span>
                  <span style={{ color: C.txt }}> </span>
                  <span style={{ color: C.flag }}>--interval</span>
                  <span style={{ color: C.num }}> 30s</span>
                </>
              ) : (
                <span style={{ color: C.txt }}>{BOOT_CMD.slice(0, typedChars)}</span>
              )}
              {!typingDone && <BlinkCursor color={C.str} />}
            </div>

            {typingDone && (status === 'error' ? (
              <>
                <BootLine
                  start={BOOT_T.l1}
                  rate={BOOT_LINE_RATE}
                  elapsed={elapsed}
                  cursorColor={C.crit}
                  plain="→ connecting to indexer @ hetzner-fsn1 ............ failed"
                >
                  → connecting to indexer @ <span style={{ color: C.fn }}>hetzner-fsn1</span> ............ <span style={{ color: C.crit }}>failed</span>
                </BootLine>
                <BootLine start={BOOT_T.l2} rate={BOOT_LINE_RATE} elapsed={elapsed} cursorColor={C.crit} plain={`→ ${error}`}>
                  <span style={{ color: C.crit }}>→ {error}</span>
                </BootLine>
              </>
            ) : (
              <>
                <BootLine
                  start={BOOT_T.l1}
                  rate={BOOT_LINE_RATE}
                  elapsed={elapsed}
                  cursorColor={C.str}
                  plain={`→ connecting to indexer @ hetzner-fsn1 ............ ${dataReady ? 'ok' : '…'}`}
                >
                  → connecting to indexer @ <span style={{ color: C.fn }}>hetzner-fsn1</span> ............ {dataReady ? <span style={{ color: C.str }}>ok</span> : <span style={{ color: C.warn }}>…</span>}
                </BootLine>
                <BootLine
                  start={BOOT_T.l2}
                  rate={BOOT_LINE_RATE}
                  elapsed={elapsed}
                  cursorColor={C.str}
                  plain={dataReady ? `→ syncing ${fleet.total} chains across ${fleet.parents} parent networks ... ok` : '→ syncing fleet ...'}
                >
                  {dataReady ? (
                    <>→ syncing <span style={{ color: C.num }}>{fleet.total}</span> chains across <span style={{ color: C.num }}>{fleet.parents}</span> parent networks ... <span style={{ color: C.str }}>ok</span></>
                  ) : (
                    <>→ syncing fleet ...</>
                  )}
                </BootLine>
                <BootLine
                  start={BOOT_T.l3}
                  rate={BOOT_LINE_RATE}
                  elapsed={elapsed}
                  cursorColor={C.str}
                  plain={
                    dataReady
                      ? `→ last probe ${overview?.lastRpcCheckAt ? relative(overview.lastRpcCheckAt) : '—'} · fetched ${fetchedAt ? relative(fetchedAt) : '—'} · ${fleet.ok} ok ${fleet.warn} warn ${fleet.crit} crit · alerts ${fleet.activeAlerts}`
                      : '→ loading fleet state ...'
                  }
                >
                  {dataReady ? (
                    <>
                      → last probe{' '}
                      <Tip label={full(overview?.lastRpcCheckAt)}><span style={{ color: C.num }}>{overview?.lastRpcCheckAt ? relative(overview.lastRpcCheckAt) : '—'}</span></Tip> ·{' '}
                      fetched <Tip label={full(fetchedAt)}><span style={{ color: C.num }}>{fetchedAt ? relative(fetchedAt) : '—'}</span></Tip> ·{' '}
                      <span style={{ color: C.str }}>{fleet.ok} ok</span> <span style={{ color: C.warn }}>{fleet.warn} warn</span>{' '}
                      <span style={{ color: C.crit }}>{fleet.crit} crit</span> · alerts <span style={{ color: C.warn }}>{fleet.activeAlerts}</span>
                    </>
                  ) : (
                    <>→ loading fleet state ...</>
                  )}
                </BootLine>
              </>
            ))}
          </div>

          {showTable && (
            <>
          {/* table header */}
          <div style={{ color: C.com, borderBottom: '1px solid var(--hairline)', paddingBottom: 4, ...rowNoWrap }}>
            <Gutter n="#" />
            <span style={col(150)}><Tip underline w={250} label={HEADERS.chain}>chain</Tip></span>
            <span style={col(96)}><Tip underline w={250} label={HEADERS.id}>chainId</Tip></span>
            <span style={col(118)}><Tip underline w={250} label={HEADERS.parent}>parent</Tip></span>
            <span style={col(96)}><Tip underline w={280} label={HEADERS.type}>type</Tip></span>
            <span style={col(58)}><Tip underline w={250} label={HEADERS.native}>gas</Tip></span>
            <span style={col(96)}><Tip underline w={300} label={HEADERS.arbos}>arbos</Tip></span>
            <span style={col(86)}><Tip underline w={290} label={HEADERS.raas}>raas</Tip></span>
            <span style={col(56, 'center')}>
              <Tip underline w={290} label={<span><b style={{ color: '#fff' }}>Monitor triad</b> — the alert decision tree.<br /><b style={{ color: '#82AAFF' }}>R</b> Retryable · cross-chain message health<br /><b style={{ color: '#82AAFF' }}>B</b> Batch poster · sequencer posting &amp; cadence<br /><b style={{ color: '#82AAFF' }}>A</b> Assertion · validator / confirmation health<br /><span style={{ color: 'var(--text-3)' }}>Hover a row's dots for that chain's verdict · click <b>? explain</b> for full rules.</span></span>}>r b a</Tip>
            </span>
            <span style={col(146)}><Tip underline w={250} label={HEADERS.rpc}>rpc.uptime</Tip></span>
            <span style={col(78, 'right')}><Tip underline w={250} label={HEADERS.lat}>lat</Tip></span>
            <span style={col(70, 'right')}><Tip underline w={290} label={HEADERS.tps}>tps</Tip></span>
            <span style={col(160, 'right')}><Tip underline w={280} label={HEADERS.tvl}>bridged tvl</Tip></span>
            <span style={col(140, 'right')}><Tip underline w={260} label={HEADERS.pending}>pending out</Tip></span>
            <span style={col(74, 'right')}><Tip underline w={250} label={HEADERS.batch}>batch</Tip></span>
            <span style={col(86, 'right')}><Tip underline w={260} label={HEADERS.retry}>retry</Tip></span>
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
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                  e.currentTarget.style.boxShadow = `inset 3px 0 0 ${c.color}`
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.boxShadow = 'none'
                }}
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
                <span style={{ ...col(86), color: c.raas ? C.kw : C.com }}>
                  {c.raas
                    ? <Tip w={300} label={<>Infra / RaaS provider <b style={{ color: '#fff' }}>{c.raas}</b>, inferred from the chain's public RPC host{c.rpcHost ? <> (<span style={{ fontFamily: 'var(--mono)' }}>{c.rpcHost}</span>)</> : ''}. Best-effort — chains on vanity domains can't be attributed.</>}>
                        <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>{c.raas}</span>
                      </Tip>
                    : c.rpcHost
                      ? <Tip w={280} label={<>No known RaaS provider for this chain's RPC host (<span style={{ fontFamily: 'var(--mono)' }}>{c.rpcHost}</span>) — likely self-hosted or a vanity domain.</>}><span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>—</span></Tip>
                      : '—'}
                </span>
                <span style={col(56, 'center')}>
                  <Tip w={230} label={<span><b style={{ color: stColor[m.R] }}>R</b>etryable: {m.R}<br /><b style={{ color: stColor[m.B] }}>B</b>atch poster: {m.B}<br /><b style={{ color: stColor[m.A] }}>A</b>ssertion: {m.A}</span>}>
                    <span style={{ color: stColor[m.R] }}>●</span>{' '}
                    <span style={{ color: stColor[m.B] }}>●</span>{' '}
                    <span style={{ color: stColor[m.A] }}>●</span>
                  </Tip>
                </span>
                <span style={{ ...col(146), display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <MiniUptime history={c.rpc.history} />
                  <span style={{ color: upColor }}>{c.rpc.uptimePct == null ? 'no data' : c.rpc.uptimePct.toFixed(2) + '%'}</span>
                </span>
                <span style={{ ...col(78, 'right'), color: c.rpc.latency == null ? C.com : c.rpc.latency > 350 ? C.warn : C.com }}>
                  {c.rpc.latency == null ? 'n/a' : c.rpc.latency + 'ms'}
                </span>
                <span style={{ ...col(70, 'right'), color: c.tps == null ? C.com : c.tps > 0 ? C.num : C.com }}>
                  {c.tps == null
                    ? '—'
                    : <Tip w={300} label={<><b style={{ color: '#fff' }}>Estimate.</b> Transactions/sec on the chain itself, sampled over the last ~20 of its own blocks each worker cycle (read live from the chain's RPC — not indexed, zero indexer overhead). The <code>~</code> denotes an estimate; the digits jitter slightly to reflect live activity.</>}>
                        <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}><LiveTps value={c.tps} /></span>
                      </Tip>}
                </span>
                <span style={{ ...col(160, 'right'), color: c.bridge.balanceNative != null ? (c.bridge.isCustomGasToken ? C.flag : C.num) : C.com }}>
                  {c.bridge.balanceNative != null
                    ? <>{F.compact(c.bridge.balanceNative, c.bridge.balanceAsset || c.native)}{c.bridge.tvlUsd != null ? <span style={{ color: C.com }}> ({F.money(c.bridge.tvlUsd)})</span> : null}</>
                    : '—'}
                </span>
                <span style={{ ...col(140, 'right'), color: c.bridge.pendingNative ? (c.bridge.isCustomGasToken ? C.flag : C.txt) : C.com }}>
                  {c.bridge.pendingNative
                    ? <>{F.compact(c.bridge.pendingNative, c.bridge.balanceAsset || c.native)}{c.bridge.pendingUsd != null ? <span style={{ color: C.com }}> ({F.money(c.bridge.pendingUsd)})</span> : null}</>
                    : '—'}
                </span>
                <span style={{ ...col(74, 'right'), color: c.batch.lastMins != null && c.batch.lastMins > c.batch.targetMins * 2 ? C.crit : C.com }}>
                  {F.dur(c.batch.lastMins)}
                </span>
                <span style={{ ...col(86, 'right'), color: c.retry.urgent > 0 ? C.warn : C.com }}>
                  {c.retry.atRiskUsd != null && c.retry.atRiskUsd >= HIGH_VALUE_USD ? (
                    <Tip
                      w={250}
                      label={`At least ${F.money(c.retry.atRiskUsd)} of expiring or expired retryable value at risk on this chain — unredeemed funds that need manual recovery before timeout. Click the row to see the tickets.`}
                    >
                      <span style={{ marginRight: 4 }}>💰</span>
                    </Tip>
                  ) : null}
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
            </>
          )}
        </div>
      </div>

      {/* status bar (VS Code style) — fixed to the bottom of the viewport */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', alignItems: 'center', gap: 0, background: 'var(--arb-blue)', color: '#fff', fontSize: 11.5, height: 26, overflowX: 'auto', whiteSpace: 'nowrap' }}>
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
        <IndexStatus statusInfo={statusInfo} />
      </div>

      {selected && <ConsoleInspect chain={selected} onClose={closeInspect} />}
      {showLegend && <Legend onClose={closeLegend} />}
    </div>
  )
}
