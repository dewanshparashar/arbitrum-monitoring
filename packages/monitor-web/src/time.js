/* Timestamp formatting in the user's browser timezone, via date-fns.

   Inputs are normalized:
   - number            -> treated as unix SECONDS
   - numeric string    -> unix seconds
   - ISO / date string -> parsed as-is
   - Date              -> used directly

   `relative()` stays compact (e.g. "5m", "3h", "2d") to fit monospace columns;
   `absolute()` / `full()` are verbose and carry the timezone for tooltips. */

import { format, formatDistanceStrict } from 'date-fns'

export const toDate = v => {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return new Date(v * 1000)
  const s = String(v).trim()
  if (s === '') return null
  if (s.includes('T') || s.includes('-') || s.includes(':')) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const n = Number(s)
  return Number.isFinite(n) ? new Date(n * 1000) : null
}

// short tz label for the browser, e.g. "PDT", "GMT+1"
let _tz = null
export const tzAbbr = () => {
  if (_tz !== null) return _tz
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')
    _tz = part?.value || ''
  } catch {
    _tz = ''
  }
  return _tz
}

// "Jun 10, 2026 14:33:05 PDT"
export const absolute = v => {
  const d = toDate(v)
  if (!d) return '—'
  const tz = tzAbbr()
  return format(d, 'MMM d, yyyy HH:mm:ss') + (tz ? ' ' + tz : '')
}

// compact "5m" / "3h" / "2d" (+"ago"/"in" only when withSuffix)
export const relative = (v, withSuffix = true) => {
  const d = toDate(v)
  if (!d) return '—'
  const now = new Date()
  const future = d.getTime() > now.getTime()
  const raw = formatDistanceStrict(d, now)
  // condense "5 minutes" -> "5m", "3 hours" -> "3h", etc.
  const compact = raw
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y')
  if (!withSuffix) return compact
  return future ? 'in ' + compact : compact + ' ago'
}

// "Jun 10, 2026 14:33:05 PDT (5m ago)" — for tooltips
export const full = v => {
  const d = toDate(v)
  if (!d) return 'no timestamp'
  return `${absolute(d)} (${relative(d)})`
}
