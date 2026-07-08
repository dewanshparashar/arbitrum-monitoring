import snapshot from '../monitor-indexer/src/generated/portalMainnet.json'
// inbox/outbox + gas-token fields live in a SEPARATE file so the indexer's
// portalMainnet.json (and thus its Ponder build id) stays stable. Merged in here.
import extra from '../monitor-indexer/src/generated/portalMainnetExtra.json'

export type PortalMainnetChain = {
  chainId: number
  name: string
  slug: string
  parentChainId: number
  rpcUrl: string
  ethBridge: {
    bridge: string
    rollup: string
    sequencerInbox: string
    inbox?: string | null
    outbox?: string | null
  }
  // Custom gas token (parent-chain ERC-20). Absent on ETH-native chains.
  nativeToken?: string
  nativeTokenSymbol?: string | null
  nativeTokenName?: string | null
}

type PortalSnapshot = {
  portalMainnetChains: PortalMainnetChain[]
  parentStartBlocks: Record<string, number>
}

const data = snapshot as PortalSnapshot

type ChainExtra = {
  inbox?: string
  outbox?: string
  nativeToken?: string
  nativeTokenSymbol?: string
  nativeTokenName?: string
}
const extraByChainId = extra as Record<string, ChainExtra>

const mergeExtra = (chain: PortalMainnetChain): PortalMainnetChain => {
  const e = extraByChainId[String(chain.chainId)]
  if (!e) return chain
  return {
    ...chain,
    ethBridge: { ...chain.ethBridge, inbox: e.inbox ?? null, outbox: e.outbox ?? null },
    nativeToken: e.nativeToken,
    nativeTokenSymbol: e.nativeTokenSymbol ?? null,
    nativeTokenName: e.nativeTokenName ?? null,
  }
}

const defaultParentRpcs: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
}

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

export const getMainnetChains = () => data.portalMainnetChains.map(mergeExtra)

export const getParentStartBlocks = () =>
  Object.fromEntries(
    Object.entries(data.parentStartBlocks).map(([key, value]) => [Number(key), value])
  ) as Record<number, number>

export const getParentRpcUrls = () => ({
  ...defaultParentRpcs,
  ...parseParentRpcOverrides(),
})
