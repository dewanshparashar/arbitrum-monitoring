import yargs from 'yargs'
import { MonitorType } from 'monitor-core'
import { ChildNetwork, getConfig } from 'utils'

export const DEFAULT_PORTAL_CONFIG_URL =
  'https://raw.githubusercontent.com/OffchainLabs/arbitrum-portal/refs/heads/master/packages/arb-token-bridge-ui/src/util/orbitChainsData.json'

const DEFAULT_PARENT_RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  42170: 'https://nova.arbitrum.io/rpc',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155111: 'https://sepolia.drpc.org',
}

const DEFAULT_PARENT_EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/',
  8453: 'https://basescan.org/',
  42161: 'https://arbiscan.io/',
  42170: 'https://nova.arbiscan.io/',
  84532: 'https://sepolia.basescan.org/',
  421614: 'https://sepolia.arbiscan.io/',
  11155111: 'https://sepolia.etherscan.io/',
}

type PortalNetwork = 'all' | 'mainnet' | 'testnet'

type PortalChain = Omit<
  ChildNetwork,
  'orbitRpcUrl' | 'parentRpcUrl' | 'parentExplorerUrl'
> & {
  rpcUrl: string
}

type PortalSnapshot = {
  mainnet?: PortalChain[]
  testnet?: PortalChain[]
}

const MONITOR_TYPES: MonitorType[] = ['assertion', 'batch-poster', 'retryable']

const parseOverrideMap = (name: string, value: string | undefined) => {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON object`)
    }

    return Object.entries(parsed).reduce<Record<number, string>>(
      (result, [key, override]) => {
        if (typeof override !== 'string') {
          throw new Error(`${name} values must be strings`)
        }

        result[Number(key)] = override
        return result
      },
      {}
    )
  } catch (error) {
    throw new Error(
      `Invalid ${name}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    )
  }
}

const ensureTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`

const stripTrailingSlash = (value: string) =>
  value.endsWith('/') ? value.slice(0, -1) : value

const getPortalChains = (
  snapshot: PortalSnapshot,
  portalNetwork: PortalNetwork
) => {
  if (portalNetwork === 'mainnet') {
    return snapshot.mainnet ?? []
  }

  if (portalNetwork === 'testnet') {
    return snapshot.testnet ?? []
  }

  return [...(snapshot.mainnet ?? []), ...(snapshot.testnet ?? [])]
}

const normalizePortalChain = (
  chain: PortalChain,
  parentRpcUrls: Record<number, string>,
  parentExplorerUrls: Record<number, string>,
  chainRpcOverrides: Record<number, string>
): ChildNetwork => {
  const parentRpcUrl = parentRpcUrls[chain.parentChainId]
  if (!parentRpcUrl) {
    throw new Error(`Missing parent RPC URL for chain ${chain.chainId}`)
  }

  const parentExplorerUrl = parentExplorerUrls[chain.parentChainId]
  if (!parentExplorerUrl) {
    throw new Error(`Missing parent explorer URL for chain ${chain.chainId}`)
  }

  return {
    ...chain,
    orbitRpcUrl: stripTrailingSlash(
      chainRpcOverrides[chain.chainId] ?? chain.rpcUrl
    ),
    parentRpcUrl: stripTrailingSlash(parentRpcUrl),
    explorerUrl: ensureTrailingSlash(chain.explorerUrl),
    parentExplorerUrl: ensureTrailingSlash(parentExplorerUrl),
  }
}

export const loadPortalConfig = async (options: {
  portalConfigUrl: string
  portalNetwork: PortalNetwork
  chainRpcOverrides?: string
  parentRpcOverrides?: string
  parentExplorerOverrides?: string
}) => {
  const response = await fetch(options.portalConfigUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch portal config: ${response.status} ${response.statusText}`
    )
  }

  const snapshot = (await response.json()) as PortalSnapshot
  const parentRpcUrls = {
    ...DEFAULT_PARENT_RPC_URLS,
    ...parseOverrideMap(
      'MONITOR_PARENT_RPC_OVERRIDES',
      options.parentRpcOverrides
    ),
  }
  const parentExplorerUrls = {
    ...DEFAULT_PARENT_EXPLORER_URLS,
    ...parseOverrideMap(
      'MONITOR_PARENT_EXPLORER_OVERRIDES',
      options.parentExplorerOverrides
    ),
  }
  const chainRpcOverrides = parseOverrideMap(
    'MONITOR_CHAIN_RPC_OVERRIDES',
    options.chainRpcOverrides
  )

  return {
    childChains: getPortalChains(snapshot, options.portalNetwork).map(chain =>
      normalizePortalChain(
        chain,
        parentRpcUrls,
        parentExplorerUrls,
        chainRpcOverrides
      )
    ),
  }
}

const asBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  return value === 'true'
}

const parseMonitorTypes = (value: string | undefined) => {
  if (!value) {
    return MONITOR_TYPES
  }

  const types = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  if (types.length === 0) {
    return MONITOR_TYPES
  }

  for (const type of types) {
    if (!MONITOR_TYPES.includes(type as MonitorType)) {
      throw new Error(`Unknown monitor type: ${type}`)
    }
  }

  return types as MonitorType[]
}

const parseLookbackHours = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return value
}

export const getWorkerConfig = async () => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: {
        type: 'string',
        default: process.env.MONITOR_CONFIG_PATH,
      },
      portalConfigUrl: {
        type: 'string',
        default:
          process.env.MONITOR_PORTAL_CONFIG_URL || DEFAULT_PORTAL_CONFIG_URL,
      },
      portalNetwork: {
        type: 'string',
        choices: ['all', 'mainnet', 'testnet'],
        default: process.env.MONITOR_PORTAL_NETWORK || 'all',
      },
      chainRpcOverrides: {
        type: 'string',
        default: process.env.MONITOR_CHAIN_RPC_OVERRIDES,
      },
      parentRpcOverrides: {
        type: 'string',
        default: process.env.MONITOR_PARENT_RPC_OVERRIDES,
      },
      parentExplorerOverrides: {
        type: 'string',
        default: process.env.MONITOR_PARENT_EXPLORER_OVERRIDES,
      },
      monitors: {
        type: 'string',
        default: process.env.MONITOR_WORKER_MONITORS,
      },
      dbPath: {
        type: 'string',
        default: process.env.MONITOR_DB_PATH || 'monitoring.sqlite',
      },
      postgresUrl: { type: 'string', default: process.env.POSTGRES_URL },
      once: {
        type: 'boolean',
        default: asBoolean(process.env.MONITOR_WORKER_ONCE, false),
      },
      pollIntervalMs: {
        type: 'number',
        default: Number(
          process.env.MONITOR_WORKER_POLL_INTERVAL_MS || 60 * 1000
        ),
      },
      lookbackHours: {
        type: 'number',
        default: Number(process.env.MONITOR_LOOKBACK_HOURS || 0),
      },
    })
    .strict()
    .parseSync()

  const config = options.configPath
    ? getConfig({ configPath: options.configPath })
    : await loadPortalConfig({
        portalConfigUrl: options.portalConfigUrl,
        portalNetwork: options.portalNetwork as PortalNetwork,
        chainRpcOverrides: options.chainRpcOverrides,
        parentRpcOverrides: options.parentRpcOverrides,
        parentExplorerOverrides: options.parentExplorerOverrides,
      })

  return {
    config,
    options: {
      ...options,
      monitors: parseMonitorTypes(options.monitors),
      lookbackHours: parseLookbackHours(options.lookbackHours),
    },
  }
}
