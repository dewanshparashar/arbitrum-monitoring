/* Data layer: fetch the live monitor-api and adapt its FleetChain shape into
   the view-model the console components render.

   IMPORTANT: the API already computes the *decision-tree* health for each
   monitor (health.retryable / health.batch / health.assertion) using the
   exact thresholds documented in the reference monitors' READMEs
   (see packages/{retryable,batch-poster,assertion}-monitor and
   packages/monitor-api/fleetDb.ts). We drive the R/B/A triad, the overall
   status glyph and the synthesized alert feed *directly* from those
   statuses rather than re-deriving heuristics here.

   Fields the design shows but the indexer/worker does not provide yet are
   intentionally left null and tracked in docs/monitor-web-data-gaps.md. */

import { registerExplorer, minsSince, assetLabel } from './fmt.js'

// ---- API base resolution (no visible form; same-origin on Vercel) ----
const loadConfigApiBase = () => window.MONITOR_WEB_CONFIG?.apiBase || ''

const getDefaultApiBase = () => {
  const params = new URLSearchParams(location.search)
  const override = params.get('apiBase')
  if (override) return override

  const stored = localStorage.getItem('monitor-api-base')
  if (stored) return stored

  const configured = loadConfigApiBase()
  if (configured) return configured

  // Local dev: web on :4020, api on :4010.
  if (
    location.protocol === 'http:' &&
    location.port === '4020' &&
    ['localhost', '127.0.0.1'].includes(location.hostname)
  ) {
    return `http://${location.hostname}:4010`
  }

  return ''
}

const apiBase = () => getDefaultApiBase().replace(/\/$/, '')

const apiFetch = async pathname => {
  const res = await fetch(`${apiBase()}${pathname}`)
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`)
  return body
}

// ---- helpers ----
const HEALTH = { healthy: 'ok', warning: 'warn', critical: 'crit', unknown: 'idle' }

const overallHealth = h => {
  const s = [h.retryable, h.batch, h.assertion].map(v => HEALTH[v] || 'idle')
  if (s.includes('crit')) return 'crit'
  if (s.includes('warn')) return 'warn'
  if (s.every(v => v === 'ok')) return 'ok'
  return 'idle'
}

const hslToHex = (h, s, l) => {
  s /= 100
  l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  const hex = x => x.toString(16).padStart(2, '0')
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4))
}

// deterministic brand-ish color per chain id
const colorFor = chainId => {
  const x = (Number(chainId) * 2654435761) >>> 0
  return hslToHex(x % 360, 68, 58)
}

// batch target window, mirrors fleetDb.getBatchStatus()
const batchTargetMins = assertionIntervalSeconds => {
  const target = Math.max(
    15 * 60,
    Math.min(assertionIntervalSeconds ?? 3600, 4 * 60 * 60)
  )
  return Math.round(target / 60)
}

const rpcStatus = (score, latency) => {
  if (score == null) return 'idle'
  if (score < 95) return 'crit'
  if (score < 99.5 || (latency != null && latency > 350)) return 'warn'
  return 'ok'
}

// ---- API FleetChain -> view-model ----
export const toViewChain = c => {
  const [transport = 'Unknown', protocol = 'Unknown'] = String(c.type || '').split(' · ')
  const bold = protocol === 'BoLD'
  const mon = {
    R: HEALTH[c.health.retryable] || 'idle',
    B: HEALTH[c.health.batch] || 'idle',
    A: HEALTH[c.health.assertion] || 'idle',
  }
  const expired = c.expiredRetryableCount || 0
  const urgent = c.openRetryUrgentCount || 0

  return {
    id: c.chainSlug || String(c.chainId),
    name: c.chainName,
    chainId: c.chainId,
    color: colorFor(c.chainId),
    parent: c.parentChainName,
    parentChainId: c.parentChainId,
    transport, // 'Rollup' | 'AnyTrust' | 'Unknown'
    protocol, // 'BoLD' | 'Classic' | 'Unknown'
    bold,
    // gas token: prefer the config symbol (always known), else the priced
    // asset key, else ETH for native-ETH chains
    native: c.gasTokenSymbol || (c.nativeAssetKey ? assetLabel(c.nativeAssetKey) : 'ETH'),
    nativeAssetKey: c.nativeAssetKey,
    isCustomGasToken: !!c.gasTokenAddress,
    arbos: {
      version: c.arbosVersion ?? null,
      name: c.arbosName ?? null,
      raw: c.arbosRaw ?? null,
      checkedAt: c.runtimeCheckedAt ?? null,
    },
    raas: c.raasProvider ?? null,
    rpcHost: c.rpcHost ?? null,
    batchPoster: c.batchPoster ?? null,
    health: overallHealth(c.health),
    monRaw: c.health, // { retryable, batch, assertion } raw API statuses
    mon, // mapped ok/warn/crit/idle
    alerts: c.alerts || 0,
    rpc: {
      status: rpcStatus(c.rpcScore, c.latencyMs),
      uptimePct: c.rpcScore, // % over the indexer window (8d)
      windowDays: 8,
      latency: c.latencyMs, // ms, or null if no successful probe
      checks: c.rpcChecks8d || 0,
      lastCheckedAt: c.lastRpcCheckedAt,
    },
    bridge: {
      tvlUsd: c.bridgedTvlUsd,
      net24h: c.bridgedAmount24hUsd,
      pendingUsd: c.pendingOutUsd,
      pendingNative: c.pendingOutNative ?? null,
      pendingCount: c.pendingOutCount || 0,
      // provenance — how the $ value is derived
      balanceWei: c.nativeBalanceWei || null,
      // decimals-correct native amount of the asset locked in the bridge
      // (ETH, or the chain's custom gas token) — computed server-side
      balanceNative: c.nativeAmount ?? null,
      balanceDecimals: c.nativeAssetDecimals ?? 18,
      balanceAsset: c.priceAsset ? assetLabel(c.priceAsset) : assetLabel(c.nativeAssetKey),
      isCustomGasToken: !!c.nativeAssetKey && c.nativeAssetKey !== 'ethereum',
      balanceBlockNumber: c.balanceBlockNumber || null,
      balanceCheckedAt: c.balanceCheckedAt || null,
      priceUsd: c.priceUsd ?? null,
      priceSource: c.priceSource || null,
      priceCheckedAt: c.priceCheckedAt || null,
    },
    batch: {
      lastMins: minsSince(c.lastBatchAt),
      targetMins: batchTargetMins(c.assertionIntervalSeconds),
      lastBatchAt: c.lastBatchAt,
      seqNum: c.lastBatchSequenceNumber,
    },
    assertion: {
      lastMins: minsSince(c.latestAssertionCreatedAt),
      latestCreatedAt: c.latestAssertionCreatedAt,
      latestConfirmedAt: c.latestAssertionConfirmedAt,
      intervalSeconds: c.assertionIntervalSeconds,
      created8d: c.createdAssertions8d || 0,
      confirmed8d: c.confirmedAssertions8d || 0,
      stuck: c.health.assertion === 'critical',
    },
    retry: {
      open: c.openRetryCount || 0,
      urgent,
      expired,
      expiringSoon: Math.max(urgent - expired, 0),
    },
    _api: c,
  }
}

// ---- alert synthesis from decision-tree statuses ----
// Mirrors the alert scenarios in the reference monitor READMEs, using only
// indexed data. Each item: { id, sev, monitor, title, detail, ts }.
export const synthesizeAlerts = c => {
  const out = []
  const dur = m => {
    if (m == null) return '—'
    if (m < 60) return Math.round(m) + 'm'
    const h = Math.floor(m / 60)
    return h < 24 ? `${h}h ${Math.round(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`
  }

  // batch poster
  if (c.monRaw.batch !== 'healthy') {
    const t = c.batch.targetMins
    if (c.batch.lastMins == null) {
      out.push({
        id: c.id + '-batch',
        sev: 'crit',
        monitor: 'batch',
        title: 'No batches in window',
        detail:
          'No SequencerBatchDelivered events indexed for this chain in the current window.',
        ts: null,
      })
    } else {
      const sev = c.monRaw.batch === 'critical' ? 'crit' : 'warn'
      out.push({
        id: c.id + '-batch',
        sev,
        monitor: 'batch',
        title: `Batch posting ${sev === 'crit' ? 'stalled' : 'delayed'} · ${dur(c.batch.lastMins)}`,
        detail: `Last batch ${dur(c.batch.lastMins)} ago — past the ${sev === 'crit' ? `${t * 4}m critical` : `${t * 2}m warning`} threshold (target ${t}m).`,
        ts: c.batch.lastBatchAt,
      })
    }
  }

  // assertion
  if (c.monRaw.assertion !== 'healthy') {
    if (c.assertion.latestCreatedAt == null) {
      out.push({
        id: c.id + '-assertion',
        sev: 'crit',
        monitor: 'assertion',
        title: 'No assertions in window',
        detail: 'No assertion creation events indexed for this chain in the current window.',
        ts: null,
      })
    } else if (c.monRaw.assertion === 'critical') {
      out.push({
        id: c.id + '-assertion',
        sev: 'crit',
        monitor: 'assertion',
        title: `Assertion creation stalled · ${dur(c.assertion.lastMins)}`,
        detail: `Latest assertion created ${dur(c.assertion.lastMins)} ago — well past the expected cadence.`,
        ts: c.assertion.latestCreatedAt,
      })
    } else {
      out.push({
        id: c.id + '-assertion',
        sev: 'warn',
        monitor: 'assertion',
        title: c.assertion.latestConfirmedAt
          ? `Assertion creation delayed · ${dur(c.assertion.lastMins)}`
          : 'No assertion confirmations',
        detail: c.assertion.latestConfirmedAt
          ? `Latest assertion created ${dur(c.assertion.lastMins)} ago, beyond the warning threshold.`
          : 'Creation events seen but no confirmation events in the indexed window.',
        ts: c.assertion.latestCreatedAt,
      })
    }
  }

  // retryable
  if (c.monRaw.retryable !== 'healthy') {
    if (c.retry.expired > 0) {
      out.push({
        id: c.id + '-retry',
        sev: 'crit',
        monitor: 'retryable',
        title: `Retryables expired · ${c.retry.expired}`,
        detail: `${c.retry.expired} ticket(s) passed their 7-day timeout unredeemed — funds must be recovered manually.`,
        ts: null,
      })
    } else if (c.retry.expiringSoon > 0) {
      out.push({
        id: c.id + '-retry',
        sev: 'warn',
        monitor: 'retryable',
        title: `${c.retry.expiringSoon} retryable(s) expiring <2d`,
        detail: 'Open tickets within 2 days of timeout. After timeout they expire and funds need manual recovery.',
        ts: null,
      })
    } else if (c.retry.open > 0) {
      out.push({
        id: c.id + '-retry',
        sev: 'warn',
        monitor: 'retryable',
        title: `${c.retry.open} open retryable(s)`,
        detail: 'Tickets created but not yet confirmed redeemed in the indexed window.',
        ts: null,
      })
    }
  }

  // rpc (signature feature; additive to the R/B/A decision tree)
  if (c.rpc.status === 'crit') {
    out.push({
      id: c.id + '-rpc',
      sev: 'crit',
      monitor: 'rpc',
      title: 'RPC unreachable',
      detail: `Uptime ${c.rpc.uptimePct?.toFixed(2)}% over ${c.rpc.checks} probes; recent probes failing.`,
      ts: c.rpc.lastCheckedAt,
    })
  } else if (c.rpc.status === 'warn') {
    out.push({
      id: c.id + '-rpc',
      sev: 'warn',
      monitor: 'rpc',
      title: 'RPC degraded',
      detail: `Uptime ${c.rpc.uptimePct?.toFixed(2)}%${c.rpc.latency != null ? `, latency ${c.rpc.latency}ms p50` : ''} over the indexer window.`,
      ts: c.rpc.lastCheckedAt,
    })
  }

  return out
}

// ---- public fetchers ----
export const fetchFleet = async () => {
  const [overview, chains, status] = await Promise.all([
    apiFetch('/api/fleet/overview'),
    apiFetch('/api/fleet/chains'),
    // resilient: fleet still loads if the status route isn't deployed yet
    apiFetch('/api/fleet/status').catch(() => null),
  ])
  return {
    overview,
    chains: chains.map(toViewChain),
    status,
    fetchedAt: Math.floor(Date.now() / 1000), // client clock, browser TZ
  }
}

export const fetchChainDetail = async chainId => {
  const detail = await apiFetch(`/api/fleet/chains/${chainId}`)
  if (!detail || !detail.chain) return null

  const view = toViewChain(detail.chain)
  const snapshot = detail.snapshot || {}
  const bridge = snapshot.ethBridge || {}

  // RPC probe history, bucketed server-side across the full available window
  // (up to 8 days) into fixed bars — spans all probes in the DB, not the last N.
  const rpcBars = (detail.rpcBuckets || []).map(b => {
    const total = Number(b.total) || 0
    const ok = Number(b.ok_count) || 0
    return {
      pct: total ? (ok / total) * 100 : 0,
      startAt: b.start_at != null ? Number(b.start_at) : null,
      endAt: b.end_at != null ? Number(b.end_at) : null,
      total,
      ok,
      anyFailed: !!b.any_failed,
      p50: b.p50_latency != null ? Number(b.p50_latency) : null,
    }
  })
  const spanStart = rpcBars.length ? rpcBars[0].startAt : null

  // retryable tickets from indexed rows
  const nowSec = Math.floor(Date.now() / 1000)
  const tickets = (detail.recentRetryables || []).map(r => {
    const exp = Number(r.expires_at)
    const remaining = exp - nowSec
    const state =
      remaining <= 0 ? 'Expired' : remaining <= 2 * 86400 ? 'Expiring' : 'Pending'
    const stKind =
      state === 'Expired' ? 'crit' : state === 'Expiring' ? 'warn' : 'open'
    return {
      hash: r.transaction_hash,
      messageIndex: r.message_index,
      createdAt: r.parent_block_timestamp,
      expiresAt: exp,
      state,
      stKind,
    }
  })

  return {
    ...view,
    explorerUrl: snapshot.explorerUrl || null,
    contracts: {
      rollup: bridge.rollup || null,
      sequencerInbox: bridge.sequencerInbox || null,
      bridge: bridge.bridge || null,
      inbox: bridge.inbox || null,
      outbox: bridge.outbox || null,
    },
    gasToken: snapshot.nativeToken
      ? {
          address: snapshot.nativeToken,
          symbol: snapshot.nativeTokenSymbol || null,
          name: snapshot.nativeTokenName || null,
        }
      : null,
    confirmPeriodBlocks: snapshot.confirmPeriodBlocks ?? null,
    rpcBars,
    rpcSpanStart: spanStart,
    batches: detail.recentBatches || [],
    assertions: detail.recentAssertions || [],
    tickets,
    pendingExits: detail.pendingExits || [],
  }
}

// register child-chain explorers from a portal-derived chain list so the
// inspector can deep-link retryables on the right explorer.
export const registerExplorersFromDetail = detail => {
  if (detail?.explorerUrl) registerExplorer(detail.chainId, detail.explorerUrl)
}
