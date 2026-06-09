import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORTAL_URL =
  'https://raw.githubusercontent.com/OffchainLabs/arbitrum-portal/master/packages/arb-token-bridge-ui/src/util/orbitChainsData.json'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..')
const OUT_PATH = path.join(PACKAGE_DIR, 'src/generated/portalMainnet.json')

const MAX_LOOKBACK_DAYS = 8

const PARENT_BLOCK_TIMES = {
  1: 12,
  8453: 2,
  42161: 0.25,
}

const PARENT_RPC_URLS = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
}

const pickChain = chain => ({
  chainId: chain.chainId,
  name: chain.name,
  slug: chain.slug,
  parentChainId: chain.parentChainId,
  confirmPeriodBlocks: chain.confirmPeriodBlocks,
  rpcUrl: chain.rpcUrl,
  explorerUrl: chain.explorerUrl,
  ethBridge: {
    bridge: chain.ethBridge.bridge,
    rollup: chain.ethBridge.rollup,
    sequencerInbox: chain.ethBridge.sequencerInbox,
  },
  bridgeUiConfig: {
    assertionIntervalSeconds:
      chain.bridgeUiConfig?.assertionIntervalSeconds ?? null,
    fastWithdrawalTime: chain.bridgeUiConfig?.fastWithdrawalTime ?? null,
  },
})

const getLatestBlockNumber = async (rpcUrl, chainId) => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: chainId,
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to read latest block for parent ${chainId}: ${response.status} ${response.statusText}`
    )
  }

  const json = await response.json()
  if (json.error) {
    throw new Error(
      `RPC error for parent ${chainId}: ${json.error.message || 'unknown error'}`
    )
  }

  return Number.parseInt(json.result, 16)
}

const main = async () => {
  const response = await fetch(PORTAL_URL)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch portal snapshot: ${response.status} ${response.statusText}`
    )
  }

  const json = await response.json()
  const mainnet = (json.mainnet ?? [])
    .filter(chain => !chain.isTestnet)
    .map(pickChain)

  const parentChainIds = Array.from(
    new Set(mainnet.map(chain => chain.parentChainId))
  ).sort((left, right) => left - right)

  const parentStartBlocks = {}

  for (const parentChainId of parentChainIds) {
    const rpcUrl = PARENT_RPC_URLS[parentChainId]
    const blockTime = PARENT_BLOCK_TIMES[parentChainId]

    if (!rpcUrl || !blockTime) {
      throw new Error(`Missing parent chain config for ${parentChainId}`)
    }

    const latestBlockNumber = await getLatestBlockNumber(rpcUrl, parentChainId)
    const lookbackBlocks = Math.ceil(
      (MAX_LOOKBACK_DAYS * 24 * 60 * 60) / blockTime
    )

    parentStartBlocks[parentChainId] = Math.max(
      latestBlockNumber - lookbackBlocks,
      0
    )
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        maxLookbackDays: MAX_LOOKBACK_DAYS,
        portalMainnetChains: mainnet,
        portalParentChainIds: parentChainIds,
        parentStartBlocks,
      },
      null,
      2
    )
  )
  console.log(`Wrote ${mainnet.length} mainnet chains to ${OUT_PATH}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
