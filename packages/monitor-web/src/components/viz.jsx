/* Shared viz components. Ported from the design bundle's viz.jsx, minus
   MonitorTriad (the table renders the triad inline so it can use the API's
   decision-tree statuses directly). */

import React from 'react'

// Chain logo badge — colored rounded square with initial
export function ChainLogo({ chain, size = 30 }) {
  const initial = chain.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase()
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

// Uptime bar strip
export function UptimeBars({ history, w, h = 26, gap = 1.5 }) {
  if (!history || !history.length) {
    return (
      <div style={{ color: 'var(--text-4)', fontSize: 11, height: h, display: 'flex', alignItems: 'center' }}>
        no probe history in window
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap, alignItems: 'flex-end', height: h, width: w || '100%' }}>
      {history.map((v, i) => {
        const color = v >= 99.5 ? 'var(--ok)' : v >= 95 ? 'var(--warn)' : 'var(--crit)'
        return (
          <div
            key={i}
            title={v.toFixed(2) + '%'}
            style={{
              flex: 1,
              minWidth: 1.5,
              height: '100%',
              borderRadius: 1.5,
              background: color,
              opacity: v >= 99.5 ? 0.55 : 0.95,
            }}
          />
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
