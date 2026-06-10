/* Console per-chain inspector — opens on row click.
   Right-side terminal drawer: `arb-monitor inspect <chain>`.
   Ported from the design bundle; every panel is now bound to the live API
   (fetchChainDetail). Fields the indexer/worker doesn't provide yet render as
   a muted "not indexed yet" line and are tracked in
   docs/monitor-web-data-gaps.md. */

import React from 'react'
import useSWR from 'swr'
import * as F from '../fmt.js'
import { full, relative, absolute } from '../time.js'
import { fetchChainDetail, synthesizeAlerts, registerExplorersFromDetail } from '../api.js'
import { whyBatch, whyAssertion, whyRetryable, whyRpc } from '../explainers.jsx'
import { ChainLogo, UptimeBars, BlinkCursor } from './viz.jsx'
import { Tip, Ext } from './tooltip.jsx'

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
const slug = c => c.id

// full derivation of the bridged-TVL dollar figure, for a tooltip
const TvlDerivation = ({ b }) => {
  const mono = { fontFamily: 'var(--mono)', color: 'var(--text)' }
  const asset = b.balanceAsset || 'ETH'
  // We always know the bridged native amount; USD needs a price for that asset.
  if (b.tvlUsd == null) {
    return (
      <span>
        <b style={{ color: '#fff' }}>Bridged value (native units)</b>
        <br />
        <br />
        balance: <span style={mono}>{b.balanceNative != null ? F.eth(b.balanceNative, asset) : '—'}</span>
        {b.balanceBlockNumber ? ` @ block ${b.balanceBlockNumber}` : ''}
        {b.balanceCheckedAt ? <><br /><span style={{ color: 'var(--text-3)' }}>snapshot {full(b.balanceCheckedAt)}</span></> : null}
        <br />
        <br />
        {b.balanceNative == null
          ? 'No bridge-balance snapshot for this chain yet.'
          : <>No USD price feed for <b style={{ color: '#fff' }}>{asset}</b>, so USD TVL is n/a. The native amount above is the real bridged value (the gas token locked in the bridge).</>}
      </span>
    )
  }
  return (
    <span>
      <b style={{ color: '#fff' }}>Bridged TVL = bridge balance × price</b>
      <br />
      <br />
      balance: <span style={mono}>{F.eth(b.balanceNative, asset)}</span>
      {b.balanceBlockNumber ? ` @ block ${b.balanceBlockNumber}` : ''}
      {b.balanceCheckedAt ? <><br /><span style={{ color: 'var(--text-3)' }}>snapshot {full(b.balanceCheckedAt)}</span></> : null}
      <br />
      price: <span style={mono}>{F.price(b.priceUsd)} / {asset}</span>
      {b.priceSource ? ` (${b.priceSource})` : ''}
      {b.priceCheckedAt ? <><br /><span style={{ color: 'var(--text-3)' }}>priced {full(b.priceCheckedAt)}</span></> : null}
      <br />
      <br />= <b style={{ color: '#fff' }}>{F.money(b.tvlUsd)}</b>
    </span>
  )
}

// muted "not indexed" marker with an explanatory tooltip
const Gap = ({ what }) => (
  <Tip
    w={260}
    label={`Not indexed yet — ${what}. Tracked in docs/monitor-web-data-gaps.md.`}
  >
    <span style={{ color: C.com, borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>n/a</span>
  </Tip>
)

export const ConsoleInspect = React.memo(function ConsoleInspect({ chain, onClose }) {
  React.useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // SWR keyed by chainId: refetches when you switch chains and refreshes the
  // open drawer every 30s. No keepPreviousData, so switching chains falls back
  // to the list row (`chain`) until the new detail loads — never shows stale.
  const { data: detail, error: detailErr } = useSWR(
    ['chain-detail', chain.chainId],
    () => fetchChainDetail(chain.chainId),
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      onSuccess: d => {
        if (d) registerExplorersFromDetail(d)
      },
    }
  )
  const error = detailErr ? (detailErr instanceof Error ? detailErr.message : 'Failed to load detail.') : null

  const c = detail || chain
  const alerts = synthesizeAlerts(chain)
  const batchTx = detail?.batches?.[0]?.transaction_hash
  const assertionTx = detail?.assertions?.[0]?.transaction_hash
  const contracts = detail?.contracts || {}

  const mono = { fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: '21px', fontVariantNumeric: 'tabular-nums' }

  const Panel = ({ title, accent = C.com, right, children, span = 1 }) => (
    <div style={{ gridColumn: `span ${span}`, border: '1px solid var(--hairline)', borderRadius: 8, background: 'rgba(255,255,255,0.015)', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', borderBottom: '1px solid var(--hairline)' }}>
        <span style={{ color: accent, fontSize: 11.5, letterSpacing: '0.02em' }}>
          <span style={{ color: C.com }}># </span>
          {title}
        </span>
        {right}
      </div>
      <div style={{ padding: '12px 13px' }}>{children}</div>
    </div>
  )

  const KV = ({ k, v, vColor = C.txt, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ color: C.com }}>{k}</span>
      <span style={{ color: vColor, textAlign: 'right' }}>
        {v}
        {sub && <span style={{ color: C.com, marginLeft: 6 }}>{sub}</span>}
      </span>
    </div>
  )

  const Metric = ({ label, value, color = C.num, sub }) => (
    <div>
      <div style={{ color: C.com, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color, fontSize: 19, fontWeight: 600, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ color: C.com, fontSize: 10.5, marginTop: 1 }}>{sub}</div>}
    </div>
  )

  const batchSt = c.mon.B
  const assertSt = c.mon.A
  const net24h = c.bridge.net24h

  // dynamic RPC window label from the real probe span we have
  const rpcSpanLabel = detail?.rpcSpanStart ? F.ago(detail.rpcSpanStart) : `${c.rpc.windowDays}d window`

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', justifyContent: 'flex-end', animation: 'fadeIn .18s ease' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(760px, 94vw)',
          height: '100%',
          background: '#080A0F',
          borderLeft: '1px solid var(--hairline-2)',
          boxShadow: '-30px 0 80px -20px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          ...mono,
          color: C.txt,
          animation: 'slideIn .26s cubic-bezier(.22,.61,.36,1)',
          overflow: 'hidden',
        }}
      >
        {/* title bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: '#0E121B', borderBottom: '1px solid var(--hairline)', flex: 'none' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>arb-monitor — inspect {slug(c)} — zsh</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--hairline-2)', color: 'var(--text-3)', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}
          >
            esc ✕
          </button>
        </div>

        {/* scroll body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px' }}>
          {/* command echo */}
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: C.str }}>arb@fsn1</span>
            <span style={{ color: C.com }}>:</span>
            <span style={{ color: C.fn }}>~/fleet</span>
            <span style={{ color: C.com }}>$ </span>
            <span style={{ color: C.txt }}>arb-monitor inspect </span>
            <span style={{ color: c.color }}>{slug(c)}</span>
            <span style={{ color: C.flag }}> --watch</span>
          </div>

          {/* identity header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '10px 0 16px', borderBottom: '1px solid var(--hairline)', marginBottom: 16 }}>
            <ChainLogo chain={c} size={42} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#fff', fontFamily: 'var(--font)' }}>{c.name}</span>
                <span style={{ color: stColor[c.health] }}>
                  {c.health === 'crit' ? '✖ outage' : c.health === 'warn' ? '◆ degraded' : c.health === 'idle' ? '○ unknown' : '● operational'}
                </span>
              </div>
              <div style={{ color: C.com, fontSize: 12, marginTop: 3 }}>
                chainId <span style={{ color: C.num }}>{c.chainId}</span> · parent <span style={{ color: C.fn }}>{c.parent}</span> ·{' '}
                <span style={{ color: C.kw }}>{c.transport.toLowerCase()}{c.bold ? '+bold' : ''}</span> ·{' '}
                <Tip underline w={280} label={c.bridge.isCustomGasToken
                  ? `This chain's native gas token — the asset locked in the canonical bridge and measured for bridged value. USD priced only where a feed exists.`
                  : `This chain's native gas token (ETH), locked in the canonical bridge and priced for TVL.`}>
                  bridge <span style={{ color: C.flag }}>{c.bridge.balanceAsset || c.native}</span>
                </Tip>
                {c.arbos && c.arbos.version != null ? (
                  <>
                    {' · '}
                    <Tip underline w={300} label={<>ArbOS version read on-chain from this chain's own RPC via <span style={{ fontFamily: 'var(--mono)' }}>ArbSys.arbOSVersion()</span> (precompile 0x…64). Raw value <b style={{ color: '#fff' }}>{c.arbos.raw}</b> − 55 offset = ArbOS {c.arbos.version}.{c.arbos.checkedAt ? ' Read ' + relative(c.arbos.checkedAt) + '.' : ''}</>}>
                      <span style={{ color: C.kw }}>ArbOS {c.arbos.version}{c.arbos.name ? ' (' + c.arbos.name + ')' : ''}</span>
                    </Tip>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {error && (
            <div style={{ color: C.crit, marginBottom: 14 }}>! failed to load detail: {error}</div>
          )}
          {!detail && !error && (
            <div style={{ color: C.com, marginBottom: 14 }}>→ querying indexer …</div>
          )}

          {/* grid of panels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Bridge flow — signature */}
            <Panel
              title="bridge.flow"
              accent={C.num}
              span={2}
              right={
                net24h != null ? (
                  <span style={{ color: net24h >= 0 ? C.str : C.crit, fontSize: 11.5 }}>
                    {net24h >= 0 ? '▲' : '▼'} {F.money(Math.abs(net24h))} / 24h
                  </span>
                ) : null
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
                <Metric
                  label={
                    <Tip underline w={300} label={<TvlDerivation b={c.bridge} />}>
                      Bridged TVL
                    </Tip>
                  }
                  value={
                    c.bridge.tvlUsd != null
                      ? F.money(c.bridge.tvlUsd)
                      : c.bridge.balanceNative != null
                        ? F.eth(c.bridge.balanceNative, c.bridge.balanceAsset || 'ETH')
                        : <Gap what="no bridge-balance snapshot for this chain" />
                  }
                  color={C.num}
                  sub={c.bridge.tvlUsd == null && c.bridge.balanceNative != null ? 'native units · no USD price' : null}
                />
                <Metric
                  label={
                    <Tip underline w={300} label={c.bridge.isCustomGasToken
                      ? `${c.bridge.balanceAsset} (this chain's custom gas token, an ERC-20) locked in the canonical bridge on ${c.parent}. This IS the bridged value — read via balanceOf at the snapshot block.`
                      : `ETH locked in this chain's canonical bridge contract on ${c.parent}. ETH is this chain's native gas token, so this is the bridged value.`}>
                      Bridge balance
                    </Tip>
                  }
                  value={c.bridge.balanceNative != null ? F.eth(c.bridge.balanceNative, c.bridge.balanceAsset || 'ETH') : <Gap what="no balance snapshot" />}
                  color={C.txt}
                  sub={c.bridge.balanceBlockNumber ? '@ block ' + c.bridge.balanceBlockNumber : null}
                />
                <Metric
                  label={<Tip underline w={250} label="Value in outbound (L2→L1) messages that have left the chain but not yet been claimed on the parent chain. Denominated in the chain's native gas token; USD shown where a price feed exists.">Pending withdrawals</Tip>}
                  value={c.bridge.pendingUsd != null
                    ? F.money(c.bridge.pendingUsd)
                    : c.bridge.pendingNative
                      ? F.eth(c.bridge.pendingNative, c.bridge.balanceAsset || c.native)
                      : <Gap what="no pending exits indexed (exit_messages empty for this chain)" />}
                  color={c.bridge.pendingCount > 100 ? C.warn : C.txt}
                  sub={c.bridge.pendingCount + ' claims'}
                />
                <Metric
                  label={
                    <Tip underline w={260} label={c.bridge.priceCheckedAt ? `Fetched ${full(c.bridge.priceCheckedAt)}` : 'Latest indexed price'}>
                      {c.bridge.balanceAsset || 'ETH'} price
                    </Tip>
                  }
                  value={c.bridge.priceUsd != null ? F.price(c.bridge.priceUsd) : <Gap what="no price snapshot" />}
                  color={C.txt}
                  sub={c.bridge.priceSource ? c.bridge.priceSource + (c.bridge.priceCheckedAt ? ' · ' + relative(c.bridge.priceCheckedAt) : '') : null}
                />
              </div>
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--hairline)', color: C.com, fontSize: 11 }}>
                {c.bridge.tvlUsd != null ? 'TVL = ' : 'bridged = '}
                <span style={{ color: C.txt }}>{c.bridge.balanceNative != null ? F.eth(c.bridge.balanceNative, c.bridge.balanceAsset || 'ETH') : '—'}</span>
                {c.bridge.tvlUsd != null ? <>{' × '}<span style={{ color: C.txt }}>{F.price(c.bridge.priceUsd)}</span></> : null}
                {' · '}
                {c.gasToken ? (
                  <Tip w={320} label={<>This chain's native gas token is the ERC-20 <b style={{ color: '#fff' }}>{c.gasToken.symbol || c.gasToken.address}</b>{c.gasToken.name ? ' (' + c.gasToken.name + ')' : ''} locked in the bridge on {c.parent}. Bridged value is measured in this token (via balanceOf); USD shown only when a price feed exists for it.</>}>
                    <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)', color: C.flag }}>
                      gas token: {c.gasToken.symbol || (c.gasToken.address.slice(0, 8) + '…')}
                    </span>
                  </Tip>
                ) : (
                  <Tip w={280} label="This chain uses ETH as its native gas token, so the canonical bridge balance is ETH and the TVL above is correct.">
                    <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>gas token: ETH</span>
                  </Tip>
                )}
              </div>
            </Panel>

            {/* RPC uptime tracker — signature */}
            <Panel
              title="rpc.uptime"
              accent={stColor[c.rpc.status]}
              span={2}
              right={
                c.rpc.uptimePct != null ? (
                  <span style={{ color: stColor[c.rpc.status], fontSize: 11.5 }}>{c.rpc.uptimePct.toFixed(2)}% · {c.rpc.windowDays}d</span>
                ) : null
              }
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Tip block w={270} label="Each bar is a time bucket of RPC probes — hover for its span, uptime %, and p50 latency. Green = all healthy, amber = slow (p50 >350ms), red = a failure in that bucket. The strip spans the full probe history in the database (up to 8 days), bucketed to fit.">
                    <UptimeBars bars={detail?.rpcBars || []} h={34} />
                  </Tip>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: C.com, fontSize: 10.5, marginTop: 5 }}>
                    <span>{rpcSpanLabel}</span>
                    <span>now</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 18, paddingLeft: 4 }}>
                  <Metric
                    label="Latency p50"
                    value={c.rpc.latency == null ? 'n/a' : c.rpc.latency + 'ms'}
                    color={c.rpc.latency == null ? C.com : c.rpc.latency > 350 ? C.warn : C.str}
                  />
                  <Metric
                    label={<Tip underline w={300} label={whyRpc(c)}>Status</Tip>}
                    value={c.rpc.status === 'ok' ? 'reachable' : c.rpc.status === 'warn' ? 'degraded' : c.rpc.status === 'crit' ? 'unreachable' : 'unknown'}
                    color={stColor[c.rpc.status]}
                  />
                </div>
              </div>
              <div style={{ marginTop: 8, color: C.com, fontSize: 11 }}>
                last probe{' '}
                <Tip label={full(c.rpc.lastCheckedAt)}>
                  <span style={{ color: C.txt, borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>
                    {c.rpc.lastCheckedAt ? relative(c.rpc.lastCheckedAt) : '—'}
                  </span>
                </Tip>{' '}
                · {c.rpc.checks} probes in window
              </div>
            </Panel>

            {/* Batch poster */}
            <Panel
              title="batch.poster"
              accent={stColor[batchSt]}
              right={
                <Tip w={300} label={whyBatch(c)}>
                  <span style={{ color: stColor[batchSt], fontSize: 11.5, borderBottom: '1px dotted ' + stColor[batchSt] + '66' }}>
                    {batchSt === 'ok' ? 'healthy' : batchSt === 'warn' ? 'watch' : batchSt === 'crit' ? 'stalled' : 'unknown'}
                  </span>
                </Tip>
              }
            >
              <KV
                k="last batch"
                v={
                  <Ext chainId={c.parentChainId} hash={batchTx} tip="Last SequencerInbox batch-posting transaction" color={c.batch.lastMins != null && c.batch.lastMins > c.batch.targetMins * 2 ? C.crit : C.fn}>
                    {F.dur(c.batch.lastMins)}
                  </Ext>
                }
                sub={'/ ' + c.batch.targetMins + 'm target'}
              />
              <KV k="batch seq #" v={c.batch.seqNum ?? <Gap what="no batch indexed" />} vColor={C.txt} />
              <KV
                k={<Tip underline label="Where the batch data lives: on-chain calldata (Rollup) or via the AnyTrust DAC. For an AnyTrust chain, calldata means a committee fallback.">data location</Tip>}
                v={
                  detail?.batches?.[0]
                    ? detail.batches[0].data_location === 0
                      ? c.transport === 'AnyTrust'
                        ? <span style={{ color: C.warn }}>calldata (DAC fallback)</span>
                        : 'calldata'
                      : 'DAC (AnyTrust)'
                    : <Gap what="no batch indexed" />
                }
                vColor={C.txt}
              />
              <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 8, paddingTop: 8 }}>
                <KV k={<Tip underline label="On-chain balance of the batch-poster EOA on the parent chain (it pays posting gas from this), read by the worker each cycle.">poster balance</Tip>} v={c.batch.posterBalanceEth != null ? F.eth(c.batch.posterBalanceEth, 'ETH') : <Gap what="batch poster not resolved / worker not deployed yet" />} vColor={c.batch.posterBalanceEth != null && c.batch.posterBalanceEth < 0.05 ? C.warn : C.txt} />
                <KV k={<Tip underline label="Days the batch poster can keep posting before running dry — poster balance ÷ estimated daily gas burn (avg fee of recent batch txs × batches posted in 24h). Estimate.">runway</Tip>} v={c.batch.runwayDays != null ? '~' + (c.batch.runwayDays >= 1000 ? F.compact(c.batch.runwayDays) : c.batch.runwayDays.toFixed(c.batch.runwayDays < 10 ? 1 : 0)) + ' days' : <Gap what="no batch activity in 24h / worker not deployed yet" />} vColor={c.batch.runwayDays != null && c.batch.runwayDays < 7 ? C.crit : c.batch.runwayDays != null && c.batch.runwayDays < 30 ? C.warn : C.txt} />
                <KV k={<Tip underline label="Calldata compression ratio (brotli).">compression</Tip>} v={<Gap what="needs per-batch calldata analysis (follow-up)" />} />
                <KV k={<Tip underline label="Child-chain blocks produced but not yet reported in a batch = chain head − last batch's max block.">block backlog</Tip>} v={c.batch.blockBacklog != null ? F.num(c.batch.blockBacklog) + ' blocks' : <Gap what="needs child head + a batch (worker not deployed yet)" />} vColor={c.batch.blockBacklog != null && c.batch.blockBacklog > 50000 ? C.warn : C.txt} />
              </div>
            </Panel>

            {/* Assertion */}
            <Panel
              title="assertion.health"
              accent={stColor[assertSt]}
              right={
                <Tip w={300} label={whyAssertion(c)}>
                  <span style={{ color: stColor[assertSt], fontSize: 11.5, borderBottom: '1px dotted ' + stColor[assertSt] + '66' }}>
                    {c.assertion.stuck ? 'stuck' : assertSt === 'idle' ? 'unknown' : 'progressing'}
                  </span>
                </Tip>
              }
            >
              <KV
                k="last assertion"
                v={
                  <Ext chainId={c.parentChainId} hash={assertionTx} tip="Latest assertion event tx on the Rollup contract" color={c.assertion.stuck ? C.crit : C.fn}>
                    {F.dur(c.assertion.lastMins)}
                  </Ext>
                }
                sub="ago"
              />
              <KV
                k={<Tip underline label="Challenge window (in parent-chain blocks) that must elapse with no dispute before an assertion can be confirmed.">confirm period</Tip>}
                v={detail?.confirmPeriodBlocks != null ? `${F.num(detail.confirmPeriodBlocks)} blocks` : <Gap what="confirmPeriodBlocks comes from chain detail" />}
                vColor={C.txt}
              />
              <KV k="created (window)" v={F.num(c.assertion.created8d)} vColor={C.txt} />
              <KV k="confirmed (window)" v={F.num(c.assertion.confirmed8d)} vColor={c.assertion.confirmed8d ? C.str : C.warn} />
              <KV
                k={<Tip underline w={250} label="BoLD = permissionless, all-vs-all disputes. Classic = whitelisted challenge protocol.">dispute mode</Tip>}
                v={c.bold ? 'BoLD' : c.protocol === 'Classic' ? 'classic' : 'unknown'}
                vColor={c.bold ? C.str : C.com}
              />
              <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 8, paddingTop: 8 }}>
                <KV k={<Tip underline label="Validation access — whether anyone can validate (permissionless / BoLD) or only a whitelisted set. Read on-chain from Rollup.validatorWhitelistDisabled().">validators</Tip>} v={c.assertion.whitelistDisabled == null ? <Gap what="rollup read failed / worker not deployed yet" /> : (c.assertion.whitelistDisabled ? 'permissionless' : 'whitelisted')} vColor={c.assertion.whitelistDisabled === false ? C.warn : C.txt} />
                <KV k={<Tip underline label="Minimum stake a validator must bond, read on-chain from Rollup.baseStake(). BoLD chains alert below 1 ETH.">base stake</Tip>} v={c.assertion.baseStakeEth != null ? F.eth(c.assertion.baseStakeEth, 'ETH') : <Gap what="rollup read failed / worker not deployed yet" />} vColor={c.assertion.baseStakeEth != null && c.assertion.baseStakeEth < 1 ? C.warn : C.txt} />
              </div>
            </Panel>

            {/* Retryables */}
            <Panel
              title="retryable.tickets"
              accent={C.com}
              span={2}
              right={
                <Tip w={300} label={whyRetryable(c)}>
                  <span style={{ fontSize: 11.5, color: C.com, borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>
                    {c.retry.open} open · <span style={{ color: c.retry.expired ? C.crit : C.com }}>{c.retry.expired} expired</span>
                  </span>
                </Tip>
              }
            >
              <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
                <Metric label={<Tip underline label="Retryable tickets created but not confirmed redeemed in the window.">Open</Tip>} value={c.retry.open} color={C.txt} />
                <Metric label={<Tip underline w={240} label="Open tickets within 2 days of their 7-day timeout.">Expiring &lt;2d</Tip>} value={c.retry.expiringSoon} color={c.retry.expiringSoon ? C.warn : C.str} />
                <Metric label={<Tip underline label="Tickets that passed their timeout unredeemed.">Expired</Tip>} value={c.retry.expired} color={c.retry.expired ? C.crit : C.str} />
                <Metric
                  label={<Tip underline w={250} label="Triage states (Untriaged / Investigating / Resolved) live in the Notion board the reference monitor syncs to — not in the indexer.">Triage</Tip>}
                  value={<Gap what="Notion triage state not indexed" />}
                  color={C.txt}
                />
              </div>
              <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 8 }}>
                {detail?.tickets?.length ? (
                  detail.tickets.slice(0, 8).map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 11.5 }}>
                      <span style={{ color: stColor[t.stKind] || C.num }}>●</span>
                      <span style={{ width: 150 }}>
                        <Ext chainId={c.parentChainId} hash={t.hash} tip="View the retryable's creating transaction on the parent chain">
                          {t.hash ? t.hash.slice(0, 10) + '…' + t.hash.slice(-6) : `msg #${t.messageIndex}`}
                        </Ext>
                      </span>
                      <span style={{ color: stColor[t.stKind] || C.num, width: 90 }}>{t.state}</span>
                      <span style={{ color: C.com, flex: 1 }}>created {F.ago(t.createdAt)}</span>
                      <span style={{ color: t.stKind === 'crit' ? C.crit : C.com }}>
                        {t.expiresAt <= Math.floor(Date.now() / 1000) ? 'expired' : 'timeout ' + F.until(t.expiresAt)}
                      </span>
                    </div>
                  ))
                ) : detail ? (
                  <div style={{ color: C.com }}>— no retryable tickets indexed in the current window —</div>
                ) : null}
              </div>
            </Panel>

            {/* Active alerts */}
            {alerts.length > 0 && (
              <Panel title="alerts.firing" accent={C.crit} span={2}>
                {alerts.map(a => {
                  const txMap = {
                    batch: { cid: c.parentChainId, h: batchTx, label: 'batch tx' },
                    assertion: { cid: c.parentChainId, h: assertionTx, label: 'assertion tx' },
                    retryable: { cid: c.parentChainId, h: detail?.tickets?.[0]?.hash, label: 'ticket' },
                  }
                  const tx = txMap[a.monitor]
                  return (
                    <div key={a.id} style={{ display: 'flex', gap: 11, padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                      <span style={{ color: a.sev === 'crit' ? C.crit : C.warn, flex: 'none' }}>{a.sev === 'crit' ? '✖' : '⚠'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: a.sev === 'crit' ? C.crit : C.warn }}>
                          {a.title} <span style={{ color: C.com }}>· {a.monitor}</span>
                        </div>
                        <div style={{ color: C.com, fontSize: 11.5, marginTop: 2, fontFamily: 'var(--font)', lineHeight: 1.45 }}>{a.detail}</div>
                        {tx && tx.h && (
                          <div style={{ marginTop: 4, fontSize: 11 }}>
                            <Ext chainId={tx.cid} hash={tx.h} tip="View the related transaction">
                              view {tx.label}
                            </Ext>
                          </div>
                        )}
                      </div>
                      {a.ts && <span style={{ color: C.com, fontSize: 11, flex: 'none' }}>{F.ago(a.ts)}</span>}
                    </div>
                  )
                })}
              </Panel>
            )}

            {/* contracts */}
            <Panel title="contracts" accent={C.com} span={2} right={<span style={{ fontSize: 11, color: C.com }}>on {F.expl.name(c.parentChainId)} ↗</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
                <KV k="rollup" v={<Ext chainId={c.parentChainId} hash={contracts.rollup} kind="addr" tip="Rollup contract">{contracts.rollup ? contracts.rollup.slice(0, 8) + '…' + contracts.rollup.slice(-4) : null}</Ext>} />
                <KV k="sequencerInbox" v={<Ext chainId={c.parentChainId} hash={contracts.sequencerInbox} kind="addr" tip="SequencerInbox contract">{contracts.sequencerInbox ? contracts.sequencerInbox.slice(0, 8) + '…' + contracts.sequencerInbox.slice(-4) : null}</Ext>} />
                <KV k="bridge" v={<Ext chainId={c.parentChainId} hash={contracts.bridge} kind="addr" tip="Bridge contract">{contracts.bridge ? contracts.bridge.slice(0, 8) + '…' + contracts.bridge.slice(-4) : null}</Ext>} />
                <KV k="inbox" v={contracts.inbox ? <Ext chainId={c.parentChainId} hash={contracts.inbox} kind="addr" tip="Inbox contract">{contracts.inbox.slice(0, 8) + '…' + contracts.inbox.slice(-4)}</Ext> : <Gap what="not in portal snapshot" />} />
                <KV k="outbox" v={contracts.outbox ? <Ext chainId={c.parentChainId} hash={contracts.outbox} kind="addr" tip="Outbox contract">{contracts.outbox.slice(0, 8) + '…' + contracts.outbox.slice(-4)}</Ext> : <Gap what="not in portal snapshot" />} />
                <KV k={<Tip underline label="The batch-poster EOA — derived from the sender (from) of this chain's most recent indexed batch transaction on the parent chain. Not a portal config field.">batchPoster</Tip>} v={c.batchPoster ? <Ext chainId={c.parentChainId} hash={c.batchPoster} kind="addr" tip="Batch poster EOA (sender of recent batches)">{c.batchPoster.slice(0, 8) + '…' + c.batchPoster.slice(-4)}</Ext> : <Gap what="no batch tx indexed / worker not deployed yet" />} />
              </div>
            </Panel>
          </div>

          {/* trailing prompt */}
          <div style={{ marginTop: 16, color: C.com }}>
            <span style={{ color: C.str }}>arb@fsn1</span>
            <span style={{ color: C.com }}>:</span>
            <span style={{ color: C.fn }}>~/fleet</span>
            <span style={{ color: C.com }}>$ </span>
            <BlinkCursor color={C.str} h={14} />
          </div>
        </div>
      </div>
    </div>
  )
})
