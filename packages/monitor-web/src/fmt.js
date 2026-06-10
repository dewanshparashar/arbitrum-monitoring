/* Formatting + block-explorer helpers.
   Ported from the design bundle's helpers.js, adapted to ES modules and the
   real API (explorer URLs come from the indexed portal snapshot, not a
   hardcoded table). */

export const money = n => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2) + 'B'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K'
  return '$' + Math.round(n)
}

export const num = n => (n == null ? '—' : n.toLocaleString('en-US'))

// precise USD for unit prices (not abbreviated like money())
export const price = n => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const maxFrac = abs >= 1 ? 2 : 6
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })
}

export const dur = mins => {
  if (mins == null) return '—'
  if (mins < 60) return Math.round(mins) + 'm'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h < 24) return m ? h + 'h ' + m + 'm' : h + 'h'
  const d = Math.floor(h / 24)
  return d + 'd ' + (h % 24) + 'h'
}

// seconds since a unix-seconds timestamp -> "12s ago" / "3h ago" / "2d ago"
export const ago = unixSeconds => {
  if (!unixSeconds) return '—'
  const s = Math.max(Math.floor(Date.now() / 1000) - Number(unixSeconds), 0)
  if (s < 60) return s + 's ago'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.floor(h / 24) + 'd ago'
}

// time until a future unix-seconds timestamp -> "1d 6h"
export const until = unixSeconds => {
  if (!unixSeconds) return '—'
  const s = Math.max(Number(unixSeconds) - Math.floor(Date.now() / 1000), 0)
  return dur(s / 60)
}

// minutes since a unix-seconds timestamp (or null)
export const minsSince = unixSeconds =>
  unixSeconds ? (Math.floor(Date.now() / 1000) - Number(unixSeconds)) / 60 : null

export const eth = (n, sym) =>
  (n == null
    ? '—'
    : (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0))) +
  ' ' +
  (sym || 'ETH')

// wei (string|number) -> decimal token amount
export const token = valueWei => {
  if (valueWei == null) return '—'
  const v = Number(valueWei) / 1e18
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: v >= 100 ? 2 : 4,
  }).format(v)
}

export const assetLabel = value => {
  if (!value) return '—'
  if (value === 'ethereum') return 'ETH'
  return String(value).toUpperCase()
}

// ---- Block explorer registry ----
// Seeded with the common parent chains; per-chain child explorers are
// registered at load time from the indexed portal snapshot (see api.js).
const explorers = {
  1: 'https://etherscan.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  42170: 'https://nova.arbiscan.io',
  11155111: 'https://sepolia.etherscan.io',
  421614: 'https://sepolia.arbiscan.io',
}

export const registerExplorer = (chainId, url) => {
  if (chainId != null && url) explorers[chainId] = url.replace(/\/$/, '')
}

const explBase = chainId => explorers[chainId] || null

export const expl = {
  has: chainId => !!explBase(chainId),
  base: explBase,
  name: chainId => {
    const base = explBase(chainId)
    return base ? base.replace(/^https?:\/\//, '').replace(/^www\./, '') : 'explorer'
  },
  tx: (chainId, h) => {
    const base = explBase(chainId)
    return base ? base + '/tx/' + h : null
  },
  addr: (chainId, a) => {
    const base = explBase(chainId)
    return base ? base + '/address/' + a : null
  },
}
