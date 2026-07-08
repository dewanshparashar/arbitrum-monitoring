/* Shared viz components. Ported from the design bundle's viz.jsx, minus
   MonitorTriad (the table renders the triad inline so it can use the API's
   decision-tree statuses directly). */

import React from 'react'
import { Tip } from './tooltip.jsx'
import { absolute } from '../time.js'

// Self-contained blinking terminal cursor. Owns its own interval so the
// blink never re-renders the parent (which would thrash open tooltips).
export function BlinkCursor({ color = '#3DD68C', h = 15 }) {
  const [on, setOn] = React.useState(true)
  React.useEffect(() => {
    const t = setInterval(() => setOn(o => !o), 530)
    return () => clearInterval(t)
  }, [])
  return (
    <span style={{ display: 'inline-block', width: 8, height: h, background: on ? color : 'transparent', verticalAlign: 'text-bottom', transform: 'translateY(2px)' }} />
  )
}

// Chain logo badge — colored rounded square with initial
export function ChainLogo({ chain, size = 30 }) {
  const initial = chain.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase()
  // render the real portal logo when available; fall back to the initial avatar
  // on missing/broken image (reset the failure flag when the chain changes)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [chain.logo])

  if (chain.logo && !failed) {
    return (
      <img
        src={chain.logo}
        alt={`${chain.name} logo`}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          flex: 'none',
          objectFit: 'cover',
          background: '#0E121B',
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08), 0 2px 6px ${chain.color}40`,
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: size * 0.46,
        letterSpacing: '-0.02em',
        background: `linear-gradient(150deg, ${chain.color}, ${chain.color}bb)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px ${chain.color}40`,
      }}
    >
      {initial}
    </div>
  )
}

// Uptime bar strip. `history` = 0..100 values; optional `checks` = the aligned
// rpc_checks rows ({ checked_at, ok, latency_ms, error_code }) for per-bar
// hover detail (timestamp in the browser's timezone).
// Each bar is one time bucket of RPC probes (server-bucketed across the full
// available window). `bars`: [{ pct, startAt, endAt, total, ok, anyFailed, p50 }].
export function UptimeBars({ bars, w, h = 26, gap = 1.5 }) {
  if (!bars || !bars.length) {
    return (
      <div style={{ color: 'var(--text-4)', fontSize: 11, height: h, display: 'flex', alignItems: 'center' }}>
        no probe history in window
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap, alignItems: 'flex-end', height: h, width: w || '100%' }}>
      {bars.map((b, i) => {
        const v = b.pct
        // any failure in the bucket → red; else slow (p50>350) → amber; else green
        const color = b.anyFailed || v < 95 ? 'var(--crit)' : (b.p50 != null && b.p50 > 350) || v < 99.5 ? 'var(--warn)' : 'var(--ok)'
        const bar = (
          <div
            style={{
              width: '100%',
              minWidth: 1.5,
              height: '100%',
              borderRadius: 1.5,
              background: color,
              opacity: color === 'var(--ok)' ? 0.55 : 0.95,
            }}
          />
        )
        const span =
          b.startAt != null && b.endAt != null && b.endAt !== b.startAt
            ? `${absolute(b.startAt)} – ${absolute(b.endAt)}`
            : b.startAt != null
              ? absolute(b.startAt)
              : ''
        const label = (
          <span>
            <span style={{ color: 'var(--text)' }}>{span}</span>
            <br />
            <span style={{ color, fontFamily: 'var(--mono)', fontSize: 11 }}>
              {b.ok}/{b.total} reachable · {v.toFixed(v >= 99.95 ? 0 : 1)}% up
              {b.p50 != null ? ` · p50 ${b.p50}ms` : ''}
            </span>
          </span>
        )
        return (
          <Tip key={i} block w={250} label={label} style={{ flex: 1, height: '100%' }}>
            {bar}
          </Tip>
        )
      })}
    </div>
  )
}

// Donut ring for a percentage
export function Ring({ value, size = 64, stroke = 7, color = 'var(--ok)', track = 'var(--surface-3)', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (value / 100) * c
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  )
}
