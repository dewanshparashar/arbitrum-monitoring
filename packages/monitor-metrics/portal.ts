import snapshot from '../monitor-indexer/src/generated/portalMainnet.json'

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
  }
}

type PortalSnapshot = {
  portalMainnetChains: PortalMainnetChain[]
  parentStartBlocks: Record<string, number>
}

const data = snapshot as PortalSnapshot

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

export const getMainnetChains = () => data.portalMainnetChains

export const getParentStartBlocks = () =>
  Object.fromEntries(
    Object.entries(data.parentStartBlocks).map(([key, value]) => [Number(key), value])
  ) as Record<number, number>

export const getParentRpcUrls = () => ({
  ...defaultParentRpcs,
  ...parseParentRpcOverrides(),
})
