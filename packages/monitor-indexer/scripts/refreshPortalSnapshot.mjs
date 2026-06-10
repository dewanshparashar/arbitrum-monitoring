import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toEventSelector } from 'viem'
import boldAssertionEvents from '../src/abis/rollupBold.json' with { type: 'json' }

const PORTAL_URL =
  'https://raw.githubusercontent.com/OffchainLabs/arbitrum-portal/master/packages/arb-token-bridge-ui/src/util/orbitChainsData.json'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..')
const OUT_PATH = path.join(PACKAGE_DIR, 'src/generated/portalMainnet.json')
const EXTRA_OUT_PATH = path.join(PACKAGE_DIR, 'src/generated/portalMainnetExtra.json')
const require = createRequire(import.meta.url)
const rollupCoreArtifact = require(
  '@arbitrum/nitro-contracts/build/contracts/src/rollup/IRollupCore.sol/IRollupCore.json'
)

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

const boldAssertionCreatedEvent = boldAssertionEvents.find(
  item => item.type === 'event' && item.name === 'AssertionCreated'
)

const classicNodeCreatedEvent = rollupCoreArtifact.abi.find(
  item => item.type === 'event' && item.name === 'NodeCreated'
)

if (!classicNodeCreatedEvent || !boldAssertionCreatedEvent) {
  throw new Error('Required rollup events not found')
}

const classicNodeCreatedSelector = toEventSelector(classicNodeCreatedEvent)
const boldAssertionCreatedSelector = toEventSelector(boldAssertionCreatedEvent)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// IMPORTANT: keep portalMainnet.json MINIMAL — only the fields the indexer's
// Ponder config consumes. Anything else (inbox/outbox/gas token) goes into the
// separate portalMainnetExtra.json so changing it never perturbs the indexer's
// Ponder build id. See pickChainExtra below.
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

// Extra per-chain fields consumed by the API/worker only (NOT the indexer).
const pickChainExtra = chain => {
  const nativeToken = chain.nativeToken
  const hasCustomGasToken =
    typeof nativeToken === 'string' && nativeToken.toLowerCase() !== ZERO_ADDRESS
  const nativeTokenData = chain.bridgeUiConfig?.nativeTokenData ?? {}
  const extra = {}
  if (chain.ethBridge?.inbox) extra.inbox = chain.ethBridge.inbox
  if (chain.ethBridge?.outbox) extra.outbox = chain.ethBridge.outbox
  if (hasCustomGasToken) {
    extra.nativeToken = nativeToken
    if (nativeTokenData.symbol) extra.nativeTokenSymbol = nativeTokenData.symbol
    if (nativeTokenData.name) extra.nativeTokenName = nativeTokenData.name
  }
  return extra
}

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

const getCode = async (rpcUrl, chainId, address) => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `${chainId}-code-${address}`,
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [address, 'latest'],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to read code for parent ${chainId}: ${response.status} ${response.statusText}`
    )
  }

  const json = await response.json()
  if (json.error) {
    throw new Error(
      `RPC error for code on parent ${chainId}: ${json.error.message || 'unknown error'}`
    )
  }

  return String(json.result || '0x')
}

const detectRollupEventFamily = async (rpcUrl, chain) => {
  const code = (await getCode(rpcUrl, chain.parentChainId, chain.ethBridge.rollup))
    .toLowerCase()

  if (code.includes(boldAssertionCreatedSelector.slice(2).toLowerCase())) {
    return 'bold'
  }

  if (code.includes(classicNodeCreatedSelector.slice(2).toLowerCase())) {
    return 'classic'
  }

  return 'unknown'
}

const main = async () => {
  const response = await fetch(PORTAL_URL)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch portal snapshot: ${response.status} ${response.statusText}`
    )
  }

  const json = await response.json()
  const rawMainnet = (json.mainnet ?? []).filter(chain => !chain.isTestnet)
  const mainnet = rawMainnet.map(pickChain)

  // decoupled extras (inbox/outbox/gas token) keyed by chainId
  const extra = {}
  for (const chain of rawMainnet) {
    const e = pickChainExtra(chain)
    if (Object.keys(e).length) extra[chain.chainId] = e
  }

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

  const profiledMainnet = []

  for (const chain of mainnet) {
    const rpcUrl = PARENT_RPC_URLS[chain.parentChainId]
    profiledMainnet.push({
      ...chain,
      rollupEventFamily: await detectRollupEventFamily(rpcUrl, chain),
    })
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        maxLookbackDays: MAX_LOOKBACK_DAYS,
        portalMainnetChains: profiledMainnet,
        portalParentChainIds: parentChainIds,
        parentStartBlocks,
      },
      null,
      2
    )
  )
  writeFileSync(EXTRA_OUT_PATH, JSON.stringify(extra, null, 2) + '\n')
  console.log(`Wrote ${profiledMainnet.length} mainnet chains to ${OUT_PATH}`)
  console.log(`Wrote extras for ${Object.keys(extra).length} chains to ${EXTRA_OUT_PATH}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
