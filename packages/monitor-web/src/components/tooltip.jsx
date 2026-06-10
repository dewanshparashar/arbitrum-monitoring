/* Tooltip + external explorer link — terminal styled.
   Tip uses a body portal so it's never clipped by overflow containers.
   Ported from the design bundle; Ext now degrades to plain text when the
   target chain's explorer isn't known (real data, not a hardcoded table). */

import React from 'react'
import { createPortal } from 'react-dom'
import { expl } from '../fmt.js'

// close delay so the pointer can travel from the trigger into the tooltip
const CLOSE_DELAY_MS = 220

export function Tip({ label, children, w = 240, underline = false, block = false, style }) {
  const [show, setShow] = React.useState(false)
  const [pos, setPos] = React.useState({ x: 0, y: 0, above: true })
  const ref = React.useRef(null)
  const closeTimer = React.useRef(null)

  const place = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const above = r.top > 140
    setPos({ x: r.left + r.width / 2, y: above ? r.top - 9 : r.bottom + 9, above })
    setShow(true)
  }

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const open = () => {
    cancelClose()
    place()
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setShow(false), CLOSE_DELAY_MS)
  }
  const closeNow = () => {
    cancelClose()
    setShow(false)
  }

  // dismiss on scroll / Escape while open (fixed-position tip would otherwise detach)
  React.useEffect(() => {
    if (!show) return undefined
    const onScroll = () => closeNow()
    const onKey = e => {
      if (e.key === 'Escape') closeNow()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [show])

  React.useEffect(() => () => cancelClose(), [])

  const wrapStyle = {
    display: block ? 'block' : 'inline',
    cursor: 'help',
    ...(underline ? { borderBottom: '1px dotted rgba(255,255,255,0.28)' } : {}),
    ...style,
  }

  return (
    <span ref={ref} onMouseEnter={open} onMouseLeave={scheduleClose} style={wrapStyle}>
      {children}
      {show &&
        createPortal(
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
              maxWidth: w,
              zIndex: 9999,
              pointerEvents: 'auto',
              background: '#0E121B',
              border: '1px solid var(--hairline-2)',
              borderRadius: 8,
              padding: '9px 11px',
              boxShadow: '0 12px 30px -8px rgba(0,0,0,0.7)',
              fontFamily: 'var(--font)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-2)',
              animation: 'tipIn .12s ease',
            }}
          >
            {/* invisible bridge over the 9px gap so moving to the tip doesn't close it */}
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                [pos.above ? 'bottom' : 'top']: -10,
                height: 10,
              }}
            />
            {label}
            <span
              style={{
                position: 'absolute',
                left: '50%',
                marginLeft: -5,
                [pos.above ? 'bottom' : 'top']: -5,
                width: 9,
                height: 9,
                background: '#0E121B',
                borderRight: '1px solid var(--hairline-2)',
                borderBottom: '1px solid var(--hairline-2)',
                transform: `rotate(${pos.above ? 45 : 225}deg)`,
              }}
            />
          </div>,
          document.body
        )}
    </span>
  )
}

// External explorer link — cyan, dotted underline, ↗, opens new tab.
// kind: 'tx' | 'addr'. Falls back to plain monospace text if the explorer or
// hash is unknown (so the UI never renders a dead link).
export function Ext({ chainId, hash, kind = 'tx', children, tip, color = '#82AAFF', stop = true }) {
  const href = !hash ? null : kind === 'addr' ? expl.addr(chainId, hash) : expl.tx(chainId, hash)

  if (!href) {
    return (
      <span style={{ color, fontFamily: 'var(--mono)' }}>{children ?? '—'}</span>
    )
  }

  const explName = expl.name(chainId)
  const link = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => {
        if (stop) e.stopPropagation()
      }}
      style={{
        color,
        textDecoration: 'none',
        fontFamily: 'var(--mono)',
        borderBottom: `1px dotted ${color}66`,
        transition: 'border-color .15s, color .15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderBottomColor = color
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderBottomColor = color + '66'
      }}
    >
      {children}
      <span style={{ fontSize: '0.82em', opacity: 0.8, marginLeft: 2, verticalAlign: '1px' }}>↗</span>
    </a>
  )

  return (
    <Tip
      w={250}
      label={
        <span>
          <span style={{ color: 'var(--text)' }}>{tip || (kind === 'addr' ? 'View address' : 'View transaction')}</span>
          <br />
          <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{explName} ↗</span>
          <br />
          <span style={{ color: 'var(--text-4)', fontFamily: 'var(--mono)', fontSize: 10.5, wordBreak: 'break-all' }}>
            {hash.length > 22 ? hash.slice(0, 12) + '…' + hash.slice(-8) : hash}
          </span>
        </span>
      }
    >
      {link}
    </Tip>
  )
}
