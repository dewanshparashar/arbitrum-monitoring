const monitors = ['assertion', 'batch-poster', 'retryable']
const statusNode = document.getElementById('status')
const overviewNode = document.getElementById('overview')
const chainsNode = document.getElementById('chains')
const detailNode = document.getElementById('detail')
const apiForm = document.getElementById('api-form')
const apiBaseInput = document.getElementById('api-base')
const refreshButton = document.getElementById('refresh-button')

const setStatus = (message) => {
  statusNode.textContent = message
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const formatTime = (value) => {
  if (!value) return '—'
  return new Date(Number(value)).toLocaleString()
}

const formatJson = (value) => escapeHtml(JSON.stringify(value, null, 2))

const loadConfigApiBase = () => window.MONITOR_WEB_CONFIG?.apiBase || ''

const loadApiBase = () =>
  localStorage.getItem('monitor-api-base') || loadConfigApiBase()

const saveApiBase = (value) => {
  localStorage.setItem('monitor-api-base', value.trim())
}

const getApiBase = () => {
  const value = loadApiBase()
  return value ? value.replace(/\/$/, '') : ''
}

const getRoute = () => {
  const params = new URLSearchParams(location.hash.slice(1))
  const chainId = params.get('chainId')
  const monitor = params.get('monitor')

  if (!chainId || !monitor) return null
  return { chainId, monitor }
}

const setRoute = (chainId, monitor) => {
  const params = new URLSearchParams()
  params.set('chainId', chainId)
  params.set('monitor', monitor)
  location.hash = params.toString()
}

const apiFetch = async (pathname) => {
  const response = await fetch(`${getApiBase()}${pathname}`)
  const body = await response.json()

  if (!response.ok) {
    throw new Error(body.error || 'Request failed.')
  }

  return body
}

const renderOverview = (overview) => {
  overviewNode.innerHTML = `
    <table>
      <tbody>
        <tr><th>Chains</th><td>${overview.chains}</td></tr>
        <tr><th>Snapshots</th><td>${overview.snapshots}</td></tr>
        <tr><th>OK</th><td>${overview.statuses.ok}</td></tr>
        <tr><th>Partial</th><td>${overview.statuses.partial}</td></tr>
        <tr><th>Error</th><td>${overview.statuses.error}</td></tr>
        <tr><th>Info findings</th><td>${overview.findings.info}</td></tr>
        <tr><th>Warning findings</th><td>${overview.findings.warning}</td></tr>
        <tr><th>Critical findings</th><td>${overview.findings.critical}</td></tr>
      </tbody>
    </table>
  `
}

const renderChains = (chains, selected) => {
  const rows = chains
    .map((chain) => {
      const chips = monitors
        .map((monitor) => {
          const snapshot = chain.monitors[monitor]
          if (!snapshot) return `<span class="chip">${monitor}: —</span>`

          const active =
            selected &&
            String(selected.chainId) === String(chain.chainId) &&
            selected.monitor === monitor

          return `
            <a
              class="chip ${active ? 'active' : ''} status-${snapshot.status}"
              href="#chainId=${chain.chainId}&monitor=${monitor}"
            >
              ${monitor}: ${snapshot.status}
            </a>
          `
        })
        .join('')

      return `
        <tr>
          <td>${escapeHtml(chain.chainName)}</td>
          <td>${chain.chainId}</td>
          <td><div class="chip-list">${chips}</div></td>
        </tr>
      `
    })
    .join('')

  chainsNode.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Chain</th>
          <th>Chain ID</th>
          <th>Monitors</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

const renderDetail = (detail) => {
  if (!detail) {
    detailNode.innerHTML = '<p>Select a chain monitor to inspect it.</p>'
    return
  }

  const historyRows = detail.history.runs
    .map(
      (run) => `
        <tr>
          <td>${escapeHtml(run.id)}</td>
          <td class="status-${run.status}">${escapeHtml(run.status)}</td>
          <td>${formatTime(run.startedAt)}</td>
          <td>${formatTime(run.finishedAt)}</td>
        </tr>
      `
    )
    .join('')

  const findingRows = detail.run.findings
    .map(
      (finding) => `
        <tr>
          <td>${escapeHtml(finding.severity)}</td>
          <td>${escapeHtml(finding.code)}</td>
          <td>${escapeHtml(finding.title)}</td>
          <td>${escapeHtml(finding.message)}</td>
        </tr>
      `
    )
    .join('')

  detailNode.innerHTML = `
    <h3>${escapeHtml(detail.latest.snapshot.chainName)} / ${escapeHtml(detail.latest.snapshot.monitor)}</h3>
    <table>
      <tbody>
        <tr><th>Status</th><td class="status-${detail.latest.snapshot.status}">${escapeHtml(detail.latest.snapshot.status)}</td></tr>
        <tr><th>Updated</th><td>${formatTime(detail.latest.snapshot.updatedAt)}</td></tr>
        <tr><th>Run ID</th><td>${escapeHtml(detail.latest.run.id)}</td></tr>
        <tr><th>Started</th><td>${formatTime(detail.latest.run.startedAt)}</td></tr>
        <tr><th>Finished</th><td>${formatTime(detail.latest.run.finishedAt)}</td></tr>
      </tbody>
    </table>
    <h3>Latest run findings</h3>
    ${
      findingRows
        ? `<table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Code</th>
                <th>Title</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>${findingRows}</tbody>
          </table>`
        : '<p>No findings.</p>'
    }
    <h3>Latest run metrics</h3>
    <pre>${formatJson(detail.run.metrics)}</pre>
    <h3>Latest run observations</h3>
    <pre>${formatJson(detail.run.observations)}</pre>
    <h3>History</h3>
    <table>
      <thead>
        <tr>
          <th>Run ID</th>
          <th>Status</th>
          <th>Started</th>
          <th>Finished</th>
        </tr>
      </thead>
      <tbody>${historyRows}</tbody>
    </table>
  `
}

const loadDetail = async (selection) => {
  const [latest, history] = await Promise.all([
    apiFetch(`/api/chains/${selection.chainId}/${selection.monitor}/latest`),
    apiFetch(`/api/chains/${selection.chainId}/${selection.monitor}/history?days=14`),
  ])

  const run = await apiFetch(`/api/runs/${latest.run.id}`)
  return { latest, history, run }
}

const loadPage = async () => {
  setStatus('Loading…')

  try {
    const [overview, chains] = await Promise.all([
      apiFetch('/api/overview'),
      apiFetch('/api/chains'),
    ])

    const current = getRoute()
    const firstChain = chains.find((chain) =>
      monitors.some((monitor) => chain.monitors[monitor])
    )
    const firstMonitor =
      firstChain && monitors.find((monitor) => firstChain.monitors[monitor])
    const fallback =
      firstChain && firstMonitor
        ? {
            chainId: String(firstChain.chainId),
            monitor: firstMonitor,
          }
        : null
    const selection = current || fallback

    renderOverview(overview)
    renderChains(chains, selection)

    if (!current && fallback) {
      setRoute(fallback.chainId, fallback.monitor)
    }

    if (!selection) {
      renderDetail(null)
      setStatus('Loaded.')
      return
    }

    const detail = await loadDetail(selection)
    renderDetail(detail)
    setStatus('Loaded.')
  } catch (error) {
    renderDetail(null)
    setStatus(error instanceof Error ? error.message : 'Failed to load.')
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
