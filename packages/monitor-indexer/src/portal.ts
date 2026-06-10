import snapshot from './generated/portalMainnet.json'

export type RollupEventFamily = 'classic' | 'bold' | 'unknown'

export type PortalMainnetChain = {
  chainId: number
  name: string
  slug: string
  parentChainId: number
  confirmPeriodBlocks: number
  rpcUrl: string
  explorerUrl: string
  ethBridge: {
    bridge: string
    rollup: string
    sequencerInbox: string
  }
  bridgeUiConfig: {
    assertionIntervalSeconds: number | null
    fastWithdrawalTime: number | null
  }
  rollupEventFamily: RollupEventFamily
}

type PortalSnapshot = {
  generatedAt: string
  maxLookbackDays: number
  portalMainnetChains: PortalMainnetChain[]
  portalParentChainIds: number[]
  parentStartBlocks: Record<string, number>
}

export type FleetSourceKind =
  | 'assertion_bold'
  | 'assertion_classic'
  | 'batch'
  | 'retryable'

export type FleetSourceMeta = {
  kind: FleetSourceKind
  name: string
  chain: PortalMainnetChain
  parentChainName: string
  parentChainKey: string
  startBlock: number
}

const data = snapshot as PortalSnapshot

export const parentChainNames: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
}

const parentChainKeys: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  42161: 'arbitrumOne',
}

const defaultParentRpcs: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
}

export const portalSnapshotGeneratedAt = data.generatedAt
export const maxLookbackDays = data.maxLookbackDays
const normalizeRollupEventFamily = (
  value: string | undefined
): RollupEventFamily => {
  if (value === 'bold' || value === 'classic') {
    return value
  }

  return 'unknown'
}

export const portalMainnetChains = data.portalMainnetChains.map(chain => ({
  ...chain,
  rollupEventFamily: normalizeRollupEventFamily(
    (chain as { rollupEventFamily?: string }).rollupEventFamily
  ),
}))
export const portalParentChainIds = data.portalParentChainIds
export const parentStartBlocks = Object.fromEntries(
  Object.entries(data.parentStartBlocks).map(([key, value]) => [Number(key), value])
) as Record<number, number>

const parseParentRpcOverrides = () => {
  const raw = process.env.MONITOR_PARENT_RPC_OVERRIDES
  if (!raw) {
    return {}
  }

  const parsed = JSON.parse(raw) as Record<string, string>
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [Number(key), value])
  ) as Record<number, string>
}

export const getParentRpcUrls = () => ({
  ...defaultParentRpcs,
  ...parseParentRpcOverrides(),
})

export const getParentChainKey = (parentChainId: number) => {
  const key = parentChainKeys[parentChainId]
  if (!key) {
    throw new Error(`Unsupported parent chain ${parentChainId}`)
  }

  return key
}

const createSourceName = (kind: FleetSourceKind, chainId: number) =>
  `${kind}_${chainId}`

const createSourceMeta = (
  kind: FleetSourceKind,
  chain: PortalMainnetChain
): FleetSourceMeta => ({
  kind,
  name: createSourceName(kind, chain.chainId),
  chain,
  parentChainName: parentChainNames[chain.parentChainId] ?? `Chain ${chain.parentChainId}`,
  parentChainKey: getParentChainKey(chain.parentChainId),
  startBlock: parentStartBlocks[chain.parentChainId] ?? 0,
})

export const batchSources = portalMainnetChains.map(chain =>
  createSourceMeta('batch', chain)
)

const getAssertionKinds = (chain: PortalMainnetChain): FleetSourceKind[] => {
  if (chain.rollupEventFamily === 'bold') {
    return ['assertion_bold']
  }

  if (chain.rollupEventFamily === 'classic') {
    return ['assertion_classic']
  }

  return ['assertion_classic', 'assertion_bold']
}

export const assertionSources = portalMainnetChains.flatMap(chain =>
  getAssertionKinds(chain).map(kind => createSourceMeta(kind, chain))
)

export const retryableSources = portalMainnetChains.map(chain =>
  createSourceMeta('retryable', chain)
)

export const allSources = [
  ...batchSources,
  ...assertionSources,
  ...retryableSources,
]

export const sourceMetaByName = Object.fromEntries(
  allSources.map(source => [source.name, source])
) as Record<string, FleetSourceMeta>
