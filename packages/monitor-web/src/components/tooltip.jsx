/* Tooltip + external explorer link — terminal styled.
   Tip uses a body portal so it's never clipped by overflow containers.
   Ported from the design bundle; Ext now degrades to plain text when the
   target chain's explorer isn't known (real data, not a hardcoded table). */

import React from 'react'
import { createPortal } from 'react-dom'
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
} from '@floating-ui/react-dom'
import { expl } from '../fmt.js'

// close delay so the pointer can travel from the trigger into the tooltip
const CLOSE_DELAY_MS = 220

export function Tip({ label, children, w = 240, underline = false, block = false, style }) {
  const [show, setShow] = React.useState(false)
  const arrowRef = React.useRef(null)
  const closeTimer = React.useRef(null)

  // Floating UI handles collision-aware placement: flip() flips top/bottom when
  // it would overflow, shift() slides it horizontally to stay on-screen (fixes
  // corner cut-off), and autoUpdate keeps it pinned on scroll/resize.
  const { refs, floatingStyles, placement, middlewareData } = useFloating({
    open: show,
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(9),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  })

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const open = () => {
    cancelClose()
    setShow(true)
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setShow(false), CLOSE_DELAY_MS)
  }
  const closeNow = () => {
    cancelClose()
    setShow(false)
  }

  // Escape dismisses; autoUpdate repositions on scroll so we no longer hide on scroll.
  React.useEffect(() => {
    if (!show) return undefined
    const onKey = e => {
      if (e.key === 'Escape') closeNow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show])

  React.useEffect(() => () => cancelClose(), [])

  const wrapStyle = {
    display: block ? 'block' : 'inline',
    cursor: 'help',
    ...(underline ? { borderBottom: '1px dotted rgba(255,255,255,0.28)' } : {}),
    ...style,
  }

  const side = placement.split('-')[0] // top | bottom | left | right
  const above = side === 'top'
  const arrowData = middlewareData.arrow || {}

  return (
    <>
      <span ref={refs.setReference} onMouseEnter={open} onMouseLeave={scheduleClose} style={wrapStyle}>
        {children}
      </span>
      {show &&
        createPortal(
          <div
            ref={refs.setFloating}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              ...floatingStyles,
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
            {/* invisible bridge over the 9px offset gap so moving to the tip keeps it open */}
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                [above ? 'bottom' : 'top']: -10,
                height: 10,
              }}
            />
            {label}
            {/* arrow — only render for vertical placements where we have an x anchor */}
            {(side === 'top' || side === 'bottom') && (
              <span
                ref={arrowRef}
                style={{
                  position: 'absolute',
                  left: arrowData.x != null ? arrowData.x : '50%',
                  marginLeft: arrowData.x != null ? 0 : -5,
                  [above ? 'bottom' : 'top']: -5,
                  width: 9,
                  height: 9,
                  background: '#0E121B',
                  borderRight: '1px solid var(--hairline-2)',
                  borderBottom: '1px solid var(--hairline-2)',
                  transform: `rotate(${above ? 45 : 225}deg)`,
                }}
              />
            )}
          </div>,
          document.body
        )}
    </>
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
