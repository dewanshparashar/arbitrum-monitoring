/* Console per-chain inspector — opens on row click.
   Right-side terminal drawer: `arb-monitor inspect <chain>`.
   Ported from the design bundle; every panel is now bound to the live API
   (fetchChainDetail). Fields the indexer/worker doesn't provide yet render as
   a muted "not indexed yet" line and are tracked in
   docs/monitor-web-data-gaps.md. */

import React from 'react'
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
  if (b.tvlUsd == null) {
    return <span>No native-balance snapshot or price available for this chain yet.</span>
  }
  const mono = { fontFamily: 'var(--mono)', color: 'var(--text)' }
  return (
    <span>
      <b style={{ color: '#fff' }}>Bridged TVL = bridge balance × price</b>
      <br />
      <br />
      balance: <span style={mono}>{F.eth(b.balanceEth, b.balanceAsset || 'ETH')}</span>
      {b.balanceBlockNumber ? ` @ block ${b.balanceBlockNumber}` : ''}
      {b.balanceCheckedAt ? <><br /><span style={{ color: 'var(--text-3)' }}>snapshot {full(b.balanceCheckedAt)}</span></> : null}
      <br />
      price: <span style={mono}>{F.price(b.priceUsd)} / {b.balanceAsset || 'ETH'}</span>
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
  const [detail, setDetail] = React.useState(null)
  const [error, setError] = React.useState(null)

  React.useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  React.useEffect(() => {
    let live = true
    setDetail(null)
    setError(null)
    fetchChainDetail(chain.chainId)
      .then(d => {
        if (!live) return
        registerExplorersFromDetail(d)
        setDetail(d)
      })
      .catch(e => live && setError(e instanceof Error ? e.message : 'Failed to load detail.'))
    return () => {
      live = false
    }
  }, [chain.chainId])

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
                <Tip underline w={260} label="The asset whose bridge balance is priced for TVL (ETH). The chain's own gas token may differ — gas-token symbol isn't indexed.">
                  bridge <span style={{ color: C.flag }}>{c.bridge.balanceAsset || c.native}</span>
                </Tip>
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
                  value={c.bridge.tvlUsd != null ? F.money(c.bridge.tvlUsd) : <Gap what="no native balance snapshot / price for this chain" />}
                  color={C.num}
                />
                <Metric
                  label={
                    <Tip underline w={290} label={`ETH locked in this chain's canonical bridge contract on ${c.parent}. NOTE: this is bridge ETH, not the chain's gas-token TVL — per-token balances aren't indexed.`}>
                      Bridge balance
                    </Tip>
                  }
                  value={c.bridge.balanceEth != null ? F.eth(c.bridge.balanceEth, c.bridge.balanceAsset || 'ETH') : <Gap what="no balance snapshot" />}
                  color={C.txt}
                  sub={c.bridge.balanceBlockNumber ? '@ block ' + c.bridge.balanceBlockNumber : null}
                />
                <Metric
                  label={<Tip underline w={250} label="Value in outbound messages that have left the chain but not yet been claimed on the parent chain.">Pending withdrawals</Tip>}
                  value={c.bridge.pendingUsd != null ? F.money(c.bridge.pendingUsd) : <Gap what="exit_messages not populated by the worker" />}
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
                TVL ={' '}
                <span style={{ color: C.txt }}>{c.bridge.balanceEth != null ? F.eth(c.bridge.balanceEth, c.bridge.balanceAsset || 'ETH') : '—'}</span>
                {' × '}
                <span style={{ color: C.txt }}>{c.bridge.priceUsd != null ? F.price(c.bridge.priceUsd) : '—'}</span>
                {' · '}
                <Tip w={280} label="Only the canonical ETH bridge balance is priced. Per-token (ERC-20) bridged value and custom gas-token TVL are not indexed yet.">
                  <span style={{ borderBottom: '1px dotted rgba(255,255,255,0.18)' }}>ERC-20 / gas-token TVL not indexed</span>
                </Tip>
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
                  <Tip block w={260} label="Each bar is one indexed RPC probe — hover for its timestamp. Green = healthy, amber = slow (>350ms), red = failed. Range spans the probes currently in the database.">
                    <UptimeBars history={detail?.rpcHistory || []} checks={detail?.rpcChecks || []} h={34} />
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
                <KV k={<Tip underline label="On-chain balance of the batch-poster account on the parent chain.">poster balance</Tip>} v={<Gap what="batch-poster balance not indexed by the worker" />} />
                <KV k={<Tip underline label="Days the batch poster can keep posting before running dry, from balance and gas-burn rate.">runway</Tip>} v={<Gap what="poster balance / gas-burn not indexed" />} />
                <KV k={<Tip underline label="Calldata compression ratio (brotli).">compression</Tip>} v={<Gap what="compression ratio not indexed" />} />
                <KV k={<Tip underline label="Child-chain blocks produced but not yet posted in a batch.">block backlog</Tip>} v={<Gap what="backlog not indexed" />} />
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
                <KV k={<Tip underline label="Active validator count and stakes.">validators</Tip>} v={<Gap what="validator set / stakes not indexed" />} />
                <KV k={<Tip underline label="Minimum stake a validator must bond.">base stake</Tip>} v={<Gap what="base stake not indexed" />} />
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
                        <Ext chainId={c.chainId} hash={t.hash} tip="View the creating transaction on the explorer">
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
                    retryable: { cid: c.chainId, h: detail?.tickets?.[0]?.hash, label: 'ticket' },
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
                <KV k={<Tip underline label="inbox / outbox / batchPoster addresses aren't in the indexed portal snapshot yet.">inbox · outbox · poster</Tip>} v={<Gap what="not in portal snapshot" />} />
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
