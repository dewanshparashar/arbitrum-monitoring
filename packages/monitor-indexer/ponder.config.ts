import { createConfig } from 'ponder'
import { batchSources, assertionSources, getParentRpcUrls, retryableSources } from './src/portal'
import { sequencerInboxAbi } from './src/abis/batchPoster'
import { rollupAbi } from './src/abis/assertion'
import { bridgeAbi } from './src/abis/retryable'

const parentRpcUrls = getParentRpcUrls()

const createContractEntries = () => ({
  ...Object.fromEntries(
    batchSources.map(source => [
      source.name,
      {
        abi: sequencerInboxAbi,
        chain: source.parentChainKey,
        address: source.chain.ethBridge.sequencerInbox as `0x${string}`,
        startBlock: source.startBlock,
      },
    ])
  ),
  ...Object.fromEntries(
    assertionSources.map(source => [
      source.name,
      {
        abi: rollupAbi,
        chain: source.parentChainKey,
        address: source.chain.ethBridge.rollup as `0x${string}`,
        startBlock: source.startBlock,
      },
    ])
  ),
  ...Object.fromEntries(
    retryableSources.map(source => [
      source.name,
      {
        abi: bridgeAbi,
        chain: source.parentChainKey,
        address: source.chain.ethBridge.bridge as `0x${string}`,
        startBlock: source.startBlock,
      },
    ])
  ),
})

export default createConfig({
  database:
    process.env.DATABASE_URL || process.env.POSTGRES_URL
      ? {
          kind: 'postgres',
          connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
        }
      : undefined,
  ordering: 'multichain',
  chains: {
    ethereum: {
      id: 1,
      rpc: parentRpcUrls[1],
    },
    base: {
      id: 8453,
      rpc: parentRpcUrls[8453],
    },
    arbitrumOne: {
      id: 42161,
      rpc: parentRpcUrls[42161],
    },
  },
  contracts: createContractEntries(),
})
