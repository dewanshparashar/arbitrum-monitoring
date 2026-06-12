/* Explainers — single source of truth for how every insight is derived.

   This is a technical-help tool: every threshold below mirrors the EXACT logic
   the API runs in packages/monitor-api/fleetDb.ts (getBatchStatus /
   getAssertionStatus / getRetryableStatus), which in turn encodes the alert
   decision tree documented in the reference monitors' READMEs
   (packages/{batch-poster,assertion,retryable}-monitor). If you change a
   threshold in fleetDb.ts, change it here too.

   `why*()` helpers render the live derivation for a specific chain (actual
   numbers + which branch fired). `<Legend/>` is the full reference overlay. */

import React from 'react'
import * as F from './fmt.js'
import { full } from './time.js'

const COL = { ok: '#3DD68C', warn: '#F5B544', crit: '#FF5C6C', idle: '#5A6478', txt: '#C8D2E0', com: '#5A6478', fn: '#82AAFF', num: '#12AAFF', kw: '#C792EA' }

// ---- thresholds (mirror fleetDb.ts) ----
export const THRESHOLDS = {
  // batch: target = clamp(assertionIntervalSeconds ?? 3600, 15m, 4h)
  batchTargetMin: 15 * 60,
  batchTargetMax: 4 * 60 * 60,
  batchDefaultInterval: 3600,
  batchWarnMult: 2, // age > 2× target
  batchCritMult: 4, // age > 4× target
  // assertion: target = max(assertionIntervalSeconds ?? 3600, 30m)
  assertionFloor: 30 * 60,
  assertionDefaultInterval: 3600,
  assertionWarnMult: 2,
  assertionCritMult: 4,
  // retryable
  retryableLifetimeDays: 7,
  retryableExpiringWindowHours: 72,
  // rpc (UI-side heuristic, see api.js rpcStatus)
  rpcCritUptimePct: 95,
  rpcWarnUptimePct: 99.5,
  rpcWarnLatencyMs: 350,
  // overview status bucketing (fleetDb readFleetOverview)
  overviewWarnAlerts: '1–2',
  overviewCritAlerts: '≥3',
  // data windows
  indexWindowDays: 8,
}

const batchTargetMins = intervalSec => {
  const t = Math.max(THRESHOLDS.batchTargetMin, Math.min(intervalSec ?? THRESHOLDS.batchDefaultInterval, THRESHOLDS.batchTargetMax))
  return Math.round(t / 60)
}
const assertionTargetMins = intervalSec =>
  Math.round(Math.max(intervalSec ?? THRESHOLDS.assertionDefaultInterval, THRESHOLDS.assertionFloor) / 60)

const Verdict = ({ st, children }) => (
  <span style={{ color: COL[st] || COL.txt, fontWeight: 600 }}>{children}</span>
)
const Rule = ({ children }) => (
  <div style={{ color: COL.com, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{children}</div>
)
const Head = ({ children }) => (
  <div style={{ color: '#fff', fontWeight: 600, marginBottom: 2 }}>{children}</div>
)

// ---- per-chain "why this status" ----
export const whyBatch = c => {
  const target = batchTargetMins(c.assertion?.intervalSeconds)
  const age = c.batch.lastMins
  const st = c.mon.B
  return (
    <span>
      <Head>Batch poster · <Verdict st={st}>{st}</Verdict></Head>
      {age == null ? (
        <div>No <span style={{ color: COL.fn }}>SequencerBatchDelivered</span> events indexed in the {THRESHOLDS.indexWindowDays}-day window → <Verdict st="crit">critical</Verdict>.</div>
      ) : (
        <div>
          Last batch <span style={{ color: COL.txt }}>{F.dur(age)}</span> ago vs a{' '}
          <span style={{ color: COL.txt }}>{target}m</span> target.
        </div>
      )}
      <Rule>
        target = clamp(assertion interval {c.assertion?.intervalSeconds ?? '—'}s, 15m, 4h) = {target}m.
        <br />age &gt; {target * THRESHOLDS.batchCritMult}m (4×) → <span style={{ color: COL.crit }}>critical</span>;
        {' '}&gt; {target * THRESHOLDS.batchWarnMult}m (2×) → <span style={{ color: COL.warn }}>warning</span>; else healthy.
      </Rule>
    </span>
  )
}

export const whyAssertion = c => {
  const target = assertionTargetMins(c.assertion?.intervalSeconds)
  const age = c.assertion.lastMins
  const st = c.mon.A
  return (
    <span>
      <Head>Assertion · <Verdict st={st}>{st}</Verdict></Head>
      {age == null ? (
        <div>No assertion creation events indexed → <Verdict st="crit">critical</Verdict>.</div>
      ) : (
        <div>
          Last assertion created <span style={{ color: COL.txt }}>{F.dur(age)}</span> ago;
          {c.assertion.latestConfirmedAt ? ' confirmations seen.' : ' no confirmations in window.'}
        </div>
      )}
      <Rule>
        target = max(assertion interval {c.assertion?.intervalSeconds ?? '—'}s, 30m) = {target}m.
        <br />no creations or age &gt; {target * THRESHOLDS.assertionCritMult}m (4×) → <span style={{ color: COL.crit }}>critical</span>;
        {' '}age &gt; {target * THRESHOLDS.assertionWarnMult}m (2×) or no confirmations → <span style={{ color: COL.warn }}>warning</span>.
      </Rule>
    </span>
  )
}

export const whyRetryable = c => {
  const st = c.mon.R
  return (
    <span>
      <Head>Retryable · <Verdict st={st}>{st}</Verdict></Head>
      <div>
        <span style={{ color: COL.txt }}>{c.retry.open}</span> open ·{' '}
        <span style={{ color: c.retry.expiringSoon ? COL.warn : COL.txt }}>{c.retry.expiringSoon}</span> expiring &lt;2d ·{' '}
        <span style={{ color: c.retry.expired ? COL.crit : COL.txt }}>{c.retry.expired}</span> expired.
      </div>
      <Rule>
        Tickets live {THRESHOLDS.retryableLifetimeDays} days. any expired (timeout passed) → <span style={{ color: COL.crit }}>critical</span>;
        {' '}any expiring within {THRESHOLDS.retryableExpiringWindowHours}h, or any open ticket → <span style={{ color: COL.warn }}>warning</span>; else healthy.
        <br />Each ticket's token + amount is decoded from its L1 creating tx (gateway <code>DepositInitiated</code> for ERC-20s, the inbox payload's l2CallValue for ETH) and priced live; generic value-less messages show <code>message</code>.
        <br />Triage state (Untriaged/Investigating) lives in Notion, not indexed.
      </Rule>
    </span>
  )
}

export const whyRpc = c => {
  const st = c.rpc.status
  return (
    <span>
      <Head>RPC reachability · <Verdict st={st}>{st === 'idle' ? 'unknown' : st}</Verdict></Head>
      <div>
        Uptime <span style={{ color: COL.txt }}>{c.rpc.uptimePct != null ? c.rpc.uptimePct.toFixed(2) + '%' : 'n/a'}</span>
        {c.rpc.latency != null ? <>, latency <span style={{ color: COL.txt }}>{c.rpc.latency}ms</span></> : null}
        {' '}over {c.rpc.checks} probes ({c.rpc.windowDays}d window).
      </div>
      <Rule>
        probe = <span style={{ color: COL.fn }}>eth_blockNumber</span> every ~5 min (10s timeout).
        <br />uptime &lt; {THRESHOLDS.rpcCritUptimePct}% → <span style={{ color: COL.crit }}>unreachable</span>;
        {' '}&lt; {THRESHOLDS.rpcWarnUptimePct}% or latency &gt; {THRESHOLDS.rpcWarnLatencyMs}ms → <span style={{ color: COL.warn }}>degraded</span>; else reachable.
        <br /><span style={{ color: COL.com }}>UI-side heuristic — RPC isn't part of the R/B/A alert count.</span>
      </Rule>
    </span>
  )
}

export const whyOverall = c => (
  <span>
    <Head>Overall: <Verdict st={c.health}>{c.health === 'crit' ? 'outage' : c.health === 'warn' ? 'degraded' : c.health === 'idle' ? 'unknown' : 'operational'}</Verdict></Head>
    <div>Worst of the R/B/A monitors. {c.alerts} of 3 monitors firing.</div>
    <Rule>
      glyph: <span style={{ color: COL.crit }}>✖</span> any monitor critical · <span style={{ color: COL.warn }}>◆</span> any warning · <span style={{ color: COL.ok }}>●</span> all healthy · <span style={{ color: COL.idle }}>○</span> unknown.
    </Rule>
  </span>
)

// ---- indexing pipeline status ----
export const whyIndexing = status => {
  if (!status) {
    return <span>Pipeline status endpoint not available (older API deploy). The fleet data above is still live.</span>
  }
  const w = status.worker
  return (
    <span>
      <Head>indexing pipeline</Head>
      <div style={{ marginTop: 4 }}>
        <b style={{ color: COL.fn }}>Indexer</b> (Ponder, on the VPS) ingests parent-chain events into Postgres. Freshness below = age of the newest indexed event per parent chain (a tight proxy on active chains; batches post every few minutes).
      </div>
      {status.indexer?.parents?.length ? (
        <div style={{ marginTop: 4 }}>
          {status.indexer.parents.map(p => (
            <div key={p.parentChainId} style={{ color: COL.com }}>
              {p.parentChainName}: latest event{' '}
              <span style={{ color: p.lagSeconds != null && p.lagSeconds < 600 ? COL.ok : COL.warn }}>
                {p.lagSeconds != null ? F.dur(p.lagSeconds / 60) + ' ago' : '—'}
              </span>
              {p.behindBlocks != null ? (
                <span style={{ color: p.behindBlocks > 2000 ? COL.warn : COL.ok }}>
                  {' '}· {p.behindBlocks === 0 ? 'at head' : `~${F.compact(p.behindBlocks)} blk behind`}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 4, color: COL.com }}>
        The <b>blk behind</b> figure compares the newest indexed event block to the chain head (recorded each worker cycle) — it shows whether the indexer is keeping up or catching up a backlog.
      </div>
      <div style={{ marginTop: 6 }}>
        <b style={{ color: COL.fn }}>Worker</b> (monitor-metrics) probes RPCs, snapshots balances/prices, and indexes exit messages each cycle.
        {w ? (
          <div style={{ color: COL.com }}>
            last cycle <span style={{ color: w.status === 'ok' ? COL.ok : COL.crit }}>{w.status}</span>
            {w.durationMs != null ? ` in ${(w.durationMs / 1000).toFixed(1)}s` : ''}
            {w.stateUpdatedAt ? <>, <span style={{ color: COL.com }}>{full(w.stateUpdatedAt)}</span></> : ''}
          </div>
        ) : (
          <div style={{ color: COL.com }}>no worker heartbeat yet (worker pending redeploy).</div>
        )}
      </div>
      {status.exitBacklog?.length ? (
        <div style={{ marginTop: 6 }}>
          <b style={{ color: COL.fn }}>Exit backlog</b> (child blocks pending exit-log scan):
          {status.exitBacklog.slice(0, 6).map(b => (
            <div key={b.chainId} style={{ color: COL.com }}>
              {b.chainSlug}: <span style={{ color: b.lagBlocks > 0 ? COL.warn : COL.ok }}>{F.num(b.lagBlocks)} blocks</span>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  )
}

// ---- static reference content for column headers ----
export const HEADERS = {
  chain: 'The Arbitrum dedicated chain being monitored. Click any row to inspect it.',
  id: 'The chain\'s EIP-155 chain ID.',
  native: 'The chain\'s native gas token. ETH for standard chains; a custom ERC-20 symbol (e.g. XAI, APE) for custom-gas-token chains — that token is what\'s locked in the bridge and measured for TVL.',
  arbos: 'ArbOS version running on the chain, read on-chain via ArbSys.arbOSVersion() (with the documented −55 offset) and mapped to its release name (Atlas/Bianca/Callisto/Dia/Elara). — = the chain\'s RPC didn\'t answer the call.',
  raas: 'The Rollup-as-a-Service / infra provider (Alchemy, Caldera, Conduit, Gelato, AltLayer…), inferred from the chain\'s public RPC host. Best-effort — chains on vanity domains show — and can\'t be attributed.',
  parent: 'The settlement (parent) chain this chain posts its batches and assertions to.',
  type: 'Data availability + dispute protocol. rollup = tx data posted on-chain as calldata; anytrust = a Data Availability Committee (DAC) holds the data. +bold = BoLD permissionless dispute protocol (vs whitelisted "classic").',
  tvl: 'Value of the native asset (ETH, or the chain\'s custom gas token) locked in the canonical bridge × its USD price. USD shows only where a price feed exists; custom gas tokens without a feed show n/a here and the native amount in the inspector.',
  pending: 'Native-asset value in L2→L1 withdrawals that left the chain but aren\'t yet claimed on the parent. Derived (not indexed): ArbSys L2ToL1Tx events minus the parent Outbox\'s OutBoxTransactionExecuted, summed by callvalue. Native-value only (ERC-20 withdrawals excluded); USD where a price feed exists, else the gas token. Full algorithm in ? explain.',
  batch: 'Time since the sequencer last posted a batch to the parent chain. Turns red past 4× the target interval.',
  retry: 'pending / seen retryable (parent→child) tickets in the window. "seen" is everything created; "pending" excludes tickets confirmed redeemed on the child chain (the worker reconciles real redemption status via the Arbitrum SDK). Pending turns amber/red when tickets are expiring within 2 days or already expired.',
  alert: 'Count of R/B/A monitors currently firing (not healthy) for this chain, 0–3.',
  lat: 'Latency of the latest successful RPC probe (eth_blockNumber).',
  tps: 'Estimated transactions per second on the chain itself — total txns across its last ~20 blocks divided by the window\'s time span, sampled from the chain\'s own RPC each worker cycle (the ~ prefix denotes an estimate). Not indexed (zero indexer overhead); most dedicated chains idle near 0.',
  rpc: 'RPC reachability over the indexer window. Each bar = one probe; per-probe timestamps on hover in the inspector.',
}

// ---- full decision-tree legend overlay ----
const Section = ({ title, accent = COL.fn, children }) => (
  <div style={{ border: '1px solid var(--hairline)', borderRadius: 8, background: 'rgba(255,255,255,0.015)', marginBottom: 12 }}>
    <div style={{ padding: '8px 13px', borderBottom: '1px solid var(--hairline)', color: accent, fontSize: 11.5 }}>
      <span style={{ color: COL.com }}># </span>{title}
    </div>
    <div style={{ padding: '12px 14px', fontSize: 12, lineHeight: 1.6, color: COL.txt }}>{children}</div>
  </div>
)
const Th = ({ st, children }) => <span style={{ color: COL[st], fontWeight: 600 }}>{children}</span>

export const Legend = React.memo(function Legend({ onClose }) {
  React.useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mono = { fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: '21px' }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 60, display: 'flex', justifyContent: 'center', alignItems: 'center', animation: 'fadeIn .18s ease', padding: '4vh 12px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 94vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#080A0F', border: '1px solid var(--hairline-2)', borderRadius: 10, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8)', ...mono, color: COL.txt }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: '#0E121B', borderBottom: '1px solid var(--hairline)', borderRadius: '10px 10px 0 0', flex: 'none' }}>
          <span style={{ color: COL.com }}>arb-monitor — </span>
          <span style={{ color: '#fff' }}>explain</span>
          <span style={{ color: COL.com, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}> — how insights are derived</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--hairline-2)', color: 'var(--text-3)', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', flex: 'none' }}>esc ✕</button>
        </div>
        <div style={{ padding: '16px 18px 24px', overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1 }}>
          <div style={{ color: COL.com, fontSize: 11.5, marginBottom: 14, lineHeight: 1.6 }}>
            Every chain is scored by three monitors — <Th st="ok">R</Th>etryable, <Th st="ok">B</Th>atch poster,{' '}
            <Th st="ok">A</Th>ssertion — using the same decision tree as the reference{' '}
            <span style={{ color: COL.fn }}>arbitrum-monitoring</span> scripts. The overall glyph is the worst of the three.
            All data is indexed over a rolling <span style={{ color: COL.num }}>{THRESHOLDS.indexWindowDays}-day</span> window.
          </div>

          <Section title="B · batch poster" accent={COL.warn}>
            <div>Is the sequencer still posting batches to the parent chain?</div>
            <div style={{ marginTop: 6 }}>
              target = clamp(assertion interval, <span style={{ color: COL.num }}>15m</span>, <span style={{ color: COL.num }}>4h</span>) — default 1h.
            </div>
            <div>• <Th st="crit">critical</Th>: no batch indexed, or last batch &gt; <b>4×</b> target ago</div>
            <div>• <Th st="warn">warning</Th>: last batch &gt; <b>2×</b> target ago</div>
            <div>• <Th st="ok">healthy</Th>: within 2× target</div>
            <div style={{ color: COL.com, marginTop: 6 }}>AnyTrust chains: a batch with <span style={{ color: COL.fn }}>dataLocation = 0</span> (on-chain calldata) signals a DAC committee fallback.</div>
          </Section>

          <Section title="A · assertion health" accent={COL.warn}>
            <div>Are validators creating &amp; confirming assertions (state roots) on the parent rollup?</div>
            <div style={{ marginTop: 6 }}>target = max(assertion interval, <span style={{ color: COL.num }}>30m</span>) — default 1h.</div>
            <div>• <Th st="crit">critical</Th>: no creations, or latest creation &gt; <b>4×</b> target ago</div>
            <div>• <Th st="warn">warning</Th>: creation &gt; <b>2×</b> target ago, or creations seen but no confirmations</div>
            <div>• <Th st="ok">healthy</Th>: creating and confirming on schedule</div>
            <div style={{ color: COL.com, marginTop: 6 }}>BoLD = permissionless all-vs-all disputes; classic = whitelisted challenge protocol.</div>
          </Section>

          <Section title="R · retryable tickets" accent={COL.warn}>
            <div>Are parent→child messages (retryable tickets) being redeemed before they expire?</div>
            <div style={{ marginTop: 6 }}>Tickets must be redeemed within <span style={{ color: COL.num }}>{THRESHOLDS.retryableLifetimeDays} days</span> of creation.</div>
            <div>• <Th st="crit">critical</Th>: any ticket expired (timeout passed) unredeemed</div>
            <div>• <Th st="warn">warning</Th>: any ticket expiring within {THRESHOLDS.retryableExpiringWindowHours}h, or any open ticket</div>
            <div>• <Th st="ok">healthy</Th>: no open tickets</div>
          </Section>

          <Section title="rpc.uptime" accent={COL.fn}>
            <div>An external reachability probe (<span style={{ color: COL.fn }}>eth_blockNumber</span>, 10s timeout) run every ~5 min by the worker.</div>
            <div style={{ marginTop: 6 }}>uptime % = ok probes / total probes in the {THRESHOLDS.indexWindowDays}-day window.</div>
            <div>• <Th st="crit">unreachable</Th>: uptime &lt; {THRESHOLDS.rpcCritUptimePct}%</div>
            <div>• <Th st="warn">degraded</Th>: uptime &lt; {THRESHOLDS.rpcWarnUptimePct}%, or latency &gt; {THRESHOLDS.rpcWarnLatencyMs}ms</div>
            <div>• <Th st="ok">reachable</Th>: otherwise</div>
            <div style={{ color: COL.com, marginTop: 6 }}>Reachability is a signature add-on; it does not count toward the R/B/A alert total.</div>
          </Section>

          <Section title="bridged TVL ($)" accent={COL.num}>
            <div>The native asset locked in the canonical bridge × its USD price. ETH chains read the bridge's ETH balance; custom-gas chains read <span style={{ color: COL.fn }}>nativeToken.balanceOf(bridge)</span> + <span style={{ color: COL.fn }}>decimals()</span> at the snapshot block.</div>
            <div style={{ color: COL.com, marginTop: 6 }}>USD shown only where a price feed exists for that asset; otherwise the native amount (e.g. 1.2M XAI). Open a chain → bridge.flow for the exact balance, block, price and timestamps.</div>
          </Section>

          <Section title="pending out (L2→L1 exits)" accent={COL.warn}>
            <div>Native-asset value in withdrawals that have left the chain but aren't yet claimed on the parent. Worker-derived (not indexed), each cycle:</div>
            <div style={{ marginTop: 6 }}>1. read <span style={{ color: COL.fn }}>L2ToL1Tx</span> events from the <span style={{ color: COL.fn }}>ArbSys</span> precompile (<span style={{ color: COL.fn }}>0x…0064</span>) on the chain's own RPC → one row per outbound message, keyed by position, storing its <span style={{ color: COL.fn }}>callvalue</span>.</div>
            <div>2. read <span style={{ color: COL.fn }}>OutBoxTransactionExecuted</span> from the parent <span style={{ color: COL.fn }}>Outbox</span> → mark matching positions as claimed.</div>
            <div>3. <b>pending = created − claimed</b> (still unexecuted). Value = Σ callvalue (18-dec native); count = number of messages.</div>
            <div style={{ color: COL.com, marginTop: 6 }}>Only native-value messages (callvalue &gt; 0) are counted — pure ERC-20 withdrawals are excluded. USD where a price feed exists, else the gas token. Best-effort: chains whose RPC rejects eth_getLogs show no data.</div>
          </Section>

          <Section title="alert count + freshness" accent={COL.com}>
            <div>Per chain: number of R/B/A monitors firing (0–3).</div>
            <div>Fleet bucketing: <Th st="ok">healthy</Th> = 0 alerts · <Th st="warn">warning</Th> = {THRESHOLDS.overviewWarnAlerts} · <Th st="crit">critical</Th> = {THRESHOLDS.overviewCritAlerts}.</div>
            <div style={{ color: COL.com, marginTop: 6 }}>"last probe" = newest RPC check across the fleet. "fetched" = when your browser last pulled the API. All timestamps render in your local timezone.</div>
          </Section>
        </div>
      </div>
    </div>
  )
})
