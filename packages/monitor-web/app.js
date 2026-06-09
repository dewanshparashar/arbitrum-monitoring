const healthMonitors = ['retryable', 'batch', 'assertion']
const statusNode = document.getElementById('status')
const overviewNode = document.getElementById('overview')
const chainsNode = document.getElementById('chains')
const detailNode = document.getElementById('detail')
const apiForm = document.getElementById('api-form')
const apiBaseInput = document.getElementById('api-base')
const refreshButton = document.getElementById('refresh-button')

const statusLabels = {
  healthy: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
}

const setStatus = (message) => {
  statusNode.textContent = message
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const formatAgo = (unixSeconds) => {
  if (!unixSeconds) return '—'

  const seconds = Math.max(Math.floor(Date.now() / 1000) - Number(unixSeconds), 0)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

const formatUntil = (unixSeconds) => {
  if (!unixSeconds) return '—'

  const seconds = Math.max(Number(unixSeconds) - Math.floor(Date.now() / 1000), 0)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000000 ? 1 : 0,
    notation: value >= 1000000 ? 'compact' : 'standard',
  }).format(Number(value))
}

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-US').format(Number(value))
}

const formatRpcScore = (value) => {
  if (value === null || value === undefined) {
    return '<span class="metric-empty">—</span>'
  }

  const rounded = Number(value).toFixed(2)
  const filled = Math.max(Math.min(Math.round(Number(value) / 10), 10), 0)
  const bars = Array.from({ length: 10 }, (_, index) => {
    const cls = index < filled ? 'spark-bar filled' : 'spark-bar'
    return `<span class="${cls}"></span>`
  }).join('')

  return `<div class="sparkline">${bars}<span class="spark-value">${rounded}</span></div>`
}

const formatOpenRetry = (chain) => {
  if (!chain.openRetryCount) {
    return '0'
  }

  return chain.openRetryUrgentCount > 0
    ? `${chain.openRetryCount} · ${chain.openRetryUrgentCount}!`
    : String(chain.openRetryCount)
}

const getDefaultApiBase = () => {
  const configured = window.MONITOR_WEB_CONFIG?.apiBase
  if (configured) {
    return configured
  }

  if (
    window.location.protocol === 'http:' &&
    window.location.port === '4020' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return `http://${window.location.hostname}:4010`
  }

  return ''
}

const loadConfigApiBase = () => window.MONITOR_WEB_CONFIG?.apiBase || ''

const loadApiBase = () =>
  localStorage.getItem('monitor-api-base') || loadConfigApiBase() || getDefaultApiBase()

const saveApiBase = (value) => {
  localStorage.setItem('monitor-api-base', value.trim())
}

const getApiBase = () => {
  const value = apiBaseInput.value.trim() || loadApiBase()
  return value ? value.replace(/\/$/, '') : ''
}

const getRoute = () => {
  const params = new URLSearchParams(location.hash.slice(1))
  const chainId = params.get('chainId')

  if (!chainId) return null
  return { chainId }
}

const setRoute = (chainId) => {
  const params = new URLSearchParams()
  params.set('chainId', chainId)
  location.hash = params.toString()
}

const apiFetch = async (pathname) => {
  const response = await fetch(`${getApiBase()}${pathname}`)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(body?.error || `${response.status} ${response.statusText}`)
  }

  return body
}

const renderHealthDot = (status, label) => `
  <div class="health-cell">
    <span class="health-dot status-${status}"></span>
    <span class="health-label">${escapeHtml(label)}</span>
  </div>
`

const renderOverview = (overview) => {
  const chips = [
    ['healthy', overview.statuses.healthy],
    ['warning', overview.statuses.warning],
    ['critical', overview.statuses.critical],
  ]
    .map(
      ([status, count]) => `
        <div class="summary-chip status-${status}">
          <span class="summary-chip-dot"></span>
          <span>${formatNumber(count)}</span>
        </div>
      `
    )
    .join('')

  overviewNode.innerHTML = `
    <div class="summary-head">
      <div>
        <h2>Fleet register</h2>
        <p class="summary-note">Parent-chain events are indexed for 8 days. RPC uptime, latency, TVL, and pending out are queued for the next read models.</p>
        <div class="summary-chip-row">${chips}</div>
      </div>
      <div class="summary-metrics">
        <div class="summary-metric"><span>Chains</span><strong>${formatNumber(overview.chains)}</strong></div>
        <div class="summary-metric"><span>Pending</span><strong>${formatNumber(overview.retryablesOpen)}</strong></div>
        <div class="summary-metric"><span>Urgent</span><strong>${formatNumber(overview.retryablesUrgent)}</strong></div>
        <div class="summary-metric"><span>Alerts</span><strong>${formatNumber(overview.alerts)}</strong></div>
      </div>
    </div>
  `
}

const renderChains = (chains, selected) => {
  const rows = chains
    .map((chain) => {
      const active = selected && String(selected.chainId) === String(chain.chainId)
      const letter = escapeHtml(chain.chainName[0] || '?')
      const dataLocation = chain.lastBatchAt ? formatAgo(chain.lastBatchAt) : '—'

      return `
        <tr class="fleet-row ${active ? 'active' : ''}" data-chain-id="${chain.chainId}">
          <td>
            <button class="chain-button" type="button" data-chain-id="${chain.chainId}">
              <span class="chain-mark"></span>
              <span class="chain-icon">${letter}</span>
              <span>
                <strong>${escapeHtml(chain.chainName)}</strong>
                <small>${chain.chainId}</small>
              </span>
            </button>
          </td>
          <td>${escapeHtml(chain.parentChainName)}</td>
          <td>${escapeHtml(chain.type)}</td>
          <td>${renderHealthDot(chain.health.retryable, 'R')}</td>
          <td>${renderHealthDot(chain.health.batch, 'B')}</td>
          <td>${renderHealthDot(chain.health.assertion, 'A')}</td>
          <td>${formatRpcScore(chain.rpcScore)}</td>
          <td>${chain.latencyMs === null ? '—' : `${formatNumber(chain.latencyMs)}ms`}</td>
          <td>${formatCurrency(chain.bridgedTvlUsd)}</td>
          <td>${formatCurrency(chain.pendingOutUsd)}</td>
          <td>${dataLocation}</td>
          <td class="retryable-cell">${escapeHtml(formatOpenRetry(chain))}</td>
          <td><span class="alert-pill ${chain.alerts ? 'has-alerts' : ''}">${formatNumber(chain.alerts)}</span></td>
        </tr>
      `
    })
    .join('')

  chainsNode.innerHTML = `
    <div class="fleet-table-wrap">
      <table class="fleet-table">
        <thead>
          <tr>
            <th>Chain</th>
            <th>Parent</th>
            <th>Type</th>
            <th>R</th>
            <th>B</th>
            <th>A</th>
            <th>RPC Uptime</th>
            <th>Latency</th>
            <th>Bridged TVL</th>
            <th>Pending Out</th>
            <th>Last Batch</th>
            <th>Open Retry</th>
            <th>Alerts</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `

  chainsNode.querySelectorAll('[data-chain-id]').forEach((node) => {
    node.addEventListener('click', () => {
      setRoute(node.getAttribute('data-chain-id'))
    })
  })
}

const renderList = (title, empty, rows, formatter) => {
  if (!rows || rows.length === 0) {
    return `<section class="detail-section"><h3>${title}</h3><p class="detail-empty">${empty}</p></section>`
  }

  return `
    <section class="detail-section">
      <h3>${title}</h3>
      <div class="detail-list">
        ${rows.map(formatter).join('')}
      </div>
    </section>
  `
}

const renderDetail = (detail) => {
  if (!detail || !detail.chain) {
    detailNode.innerHTML = '<p class="detail-empty">Select a chain to inspect its indexed events.</p>'
    return
  }

  detailNode.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(detail.chain.chainName)}</h2>
        <p class="muted">${escapeHtml(detail.chain.parentChainName)} · ${escapeHtml(detail.chain.type)}</p>
      </div>
      <div class="detail-badges">
        ${healthMonitors
          .map(
            (monitor) => `
              <span class="detail-badge status-${detail.chain.health[monitor]}">
                ${monitor.toUpperCase().slice(0, 1)} · ${statusLabels[detail.chain.health[monitor]]}
              </span>
            `
          )
          .join('')}
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-metric"><span>Last batch</span><strong>${formatAgo(detail.chain.lastBatchAt)}</strong></div>
      <div class="detail-metric"><span>Open retry</span><strong>${escapeHtml(formatOpenRetry(detail.chain))}</strong></div>
      <div class="detail-metric"><span>Assertions 8d</span><strong>${formatNumber(detail.chain.createdAssertions8d)}</strong></div>
      <div class="detail-metric"><span>Confirmations 8d</span><strong>${formatNumber(detail.chain.confirmedAssertions8d)}</strong></div>
    </div>
    ${renderList(
      'Recent batches',
      'No indexed batch deliveries in the current window.',
      detail.recentBatches,
      (row) => `
        <article class="detail-item">
          <strong>Batch #${escapeHtml(row.batch_sequence_number)}</strong>
          <span>${formatAgo(row.parent_block_timestamp)} ago</span>
          <small>dataLocation=${escapeHtml(row.data_location)}</small>
        </article>
      `
    )}
    ${renderList(
      'Recent assertions',
      'No indexed assertion events in the current window.',
      detail.recentAssertions,
      (row) => `
        <article class="detail-item">
          <strong>${escapeHtml(row.event_name)}</strong>
          <span>${formatAgo(row.parent_block_timestamp)} ago</span>
          <small>${escapeHtml(row.transaction_hash)}</small>
        </article>
      `
    )}
    ${renderList(
      'Recent retryables',
      'No indexed retryable creations in the current window.',
      detail.recentRetryables,
      (row) => `
        <article class="detail-item">
          <strong>Message #${escapeHtml(row.message_index)}</strong>
          <span>${formatAgo(row.parent_block_timestamp)} ago</span>
          <small>expires in ${formatUntil(row.expires_at)}</small>
        </article>
      `
    )}
  `
}

const loadDetail = async (selection) => {
  if (!selection) return null
  return apiFetch(`/api/fleet/chains/${selection.chainId}`)
}

const loadPage = async () => {
  setStatus('Loading fleet…')
  const selected = getRoute()

  try {
    const [overview, chains, detail] = await Promise.all([
      apiFetch('/api/fleet/overview'),
      apiFetch('/api/fleet/chains'),
      loadDetail(selected),
    ])

    renderOverview(overview)
    renderChains(chains, selected)
    renderDetail(detail)
    setStatus(`Indexed mainnet fleet loaded from ${new Date(overview.generatedAt).toLocaleString()}.`)
  } catch (error) {
    console.error(error)
    chainsNode.innerHTML = ''
    detailNode.innerHTML = ''
    setStatus(error instanceof Error ? error.message : 'Failed to load fleet register.')
  }
}

apiBaseInput.value = loadApiBase()

apiForm.addEventListener('submit', (event) => {
  event.preventDefault()
  saveApiBase(apiBaseInput.value)
  loadPage()
})

refreshButton.addEventListener('click', () => {
  loadPage()
})

window.addEventListener('hashchange', () => {
  loadPage()
})

loadPage()
