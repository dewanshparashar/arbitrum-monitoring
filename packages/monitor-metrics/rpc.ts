import { ethers } from 'ethers'

type RpcLog = {
  address: string
  blockNumber: string
  transactionHash: string
  logIndex: string
  data: string
  topics: string[]
}

const activeOutboxInterface = new ethers.utils.Interface([
  'function activeOutbox() view returns (address)',
])

const erc20Interface = new ethers.utils.Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

const arbSysInterface = new ethers.utils.Interface([
  'function arbOSVersion() view returns (uint64)',
])

// Rollup core getters present on both classic and BoLD rollups.
const rollupInfoInterface = new ethers.utils.Interface([
  'function baseStake() view returns (uint256)',
  'function validatorWhitelistDisabled() view returns (bool)',
])

const l2ToL1Interface = new ethers.utils.Interface([
  'event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)',
])

const outboxInterface = new ethers.utils.Interface([
  'event OutBoxTransactionExecuted(address indexed to, address indexed l2Sender, uint256 indexed zero, uint256 transactionIndex)',
])

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Single JSON-RPC attempt with a hard timeout.
const rpcAttempt = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`http_${response.status}`)
    }

    const body = (await response.json()) as {
      error?: { code: number; message: string }
      result?: T
    }

    if (body.error) {
      throw new Error(`rpc_${body.error.code}`)
    }

    return body.result as T
  } finally {
    clearTimeout(timer)
  }
}

// Data calls retry transient failures with linear backoff. Reachability
// probes must NOT retry (retrying would mask real outages), so they pass
// retries: 0.
const rpcCall = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  { timeoutMs = 10_000, retries = 0 }: { timeoutMs?: number; retries?: number } = {}
): Promise<T> => {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(250 * attempt)
    }
    try {
      return await rpcAttempt<T>(rpcUrl, method, params, timeoutMs)
    } catch (error) {
      lastError = error
      // 4xx is a client-side rejection (e.g. the RPC refuses eth_getLogs) —
      // retrying won't change the outcome, so fail fast.
      const message = error instanceof Error ? error.message : ''
      if (/^http_4\d\d$/.test(message)) {
        break
      }
    }
  }
  throw lastError
}

const toHexBlock = (value: bigint) => `0x${value.toString(16)}`

export const arbSysAddress = '0x0000000000000000000000000000000000000064'

export const l2ToL1Topic = l2ToL1Interface.getEventTopic('L2ToL1Tx')
export const outboxExecutedTopic =
  outboxInterface.getEventTopic('OutBoxTransactionExecuted')

export const probeRpc = async (rpcUrl: string) => {
  const startedAt = Date.now()

  try {
    await rpcCall<string>(rpcUrl, 'eth_blockNumber', [])
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      errorCode: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'probe_failed'
    return {
      ok: false,
      latencyMs: null,
      errorCode: message,
    }
  }
}

export const getBlockNumber = (rpcUrl: string) =>
  rpcCall<string>(rpcUrl, 'eth_blockNumber', [], { retries: 2 }).then(value => BigInt(value))

// Block timestamp + transaction count in one call (transactions:false returns
// the array of tx hashes, whose length is the count). Used for TPS sampling.
export const getBlockTxStats = async (rpcUrl: string, blockNumber: bigint) => {
  const block = await rpcCall<{ timestamp: string; transactions: string[] }>(
    rpcUrl,
    'eth_getBlockByNumber',
    [toHexBlock(blockNumber), false],
    { timeoutMs: 8_000, retries: 1 }
  )
  return {
    timestamp: BigInt(block.timestamp),
    txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
  }
}

export const getBlock = async (rpcUrl: string, blockNumber: bigint) => {
  const block = await rpcCall<{ timestamp: string }>(
    rpcUrl,
    'eth_getBlockByNumber',
    [toHexBlock(blockNumber), false],
    { retries: 2 }
  )

  return {
    blockNumber,
    timestamp: BigInt(block.timestamp),
  }
}

// Reads the balance at an explicit block so the stored balance and
// block_number are consistent (the head can advance between calls). Defaults
// to 'latest' when no block is given.
export const getBalance = async (
  rpcUrl: string,
  address: string,
  blockNumber?: bigint
) => {
  const blockTag = blockNumber === undefined ? 'latest' : toHexBlock(blockNumber)
  const value = await rpcCall<string>(rpcUrl, 'eth_getBalance', [address, blockTag], {
    retries: 2,
  })
  return BigInt(value)
}

// ERC-20 balance of `holder`, read at an explicit block for consistency with
// the recorded block_number (defaults to 'latest'). Used for custom-gas-token
// chains where the canonical bridge locks an ERC-20, not ETH.
export const getErc20Balance = async (
  rpcUrl: string,
  token: string,
  holder: string,
  blockNumber?: bigint
) => {
  const blockTag = blockNumber === undefined ? 'latest' : toHexBlock(blockNumber)
  const data = erc20Interface.encodeFunctionData('balanceOf', [holder])
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: token, data }, blockTag], {
    retries: 2,
  })
  return BigInt(erc20Interface.decodeFunctionResult('balanceOf', result)[0].toString())
}

// Reads ArbOS version from the ArbSys precompile on the CHILD chain's own RPC.
// NOTE: arbOSVersion() returns 55 + the actual ArbOS version (a documented
// quirk), so callers subtract 55. See docs.arbitrum.io precompiles reference.
// The active batch poster is the EOA that sent the batch transaction — read
// the `from` of a recent batch tx on the parent chain.
export const getTransactionSender = async (rpcUrl: string, txHash: string) => {
  const tx = await rpcCall<{ from?: string } | null>(
    rpcUrl,
    'eth_getTransactionByHash',
    [txHash],
    { retries: 1 }
  )
  return tx?.from ? tx.from.toLowerCase() : null
}

// Tx fee (wei) = gasUsed × effectiveGasPrice from the receipt. Used to estimate
// the batch poster's gas burn. Returns null if the receipt isn't available.
export const getTransactionFeeWei = async (rpcUrl: string, txHash: string) => {
  const r = await rpcCall<{ gasUsed?: string; effectiveGasPrice?: string } | null>(
    rpcUrl,
    'eth_getTransactionReceipt',
    [txHash],
    { retries: 1 }
  )
  if (!r || r.gasUsed == null || r.effectiveGasPrice == null) return null
  return BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)
}

export const getArbOsVersionRaw = async (rpcUrl: string) => {
  const data = arbSysInterface.encodeFunctionData('arbOSVersion')
  const result = await rpcCall<string>(
    rpcUrl,
    'eth_call',
    [{ to: arbSysAddress, data }, 'latest'],
    { retries: 1 }
  )
  return Number(arbSysInterface.decodeFunctionResult('arbOSVersion', result)[0])
}

// Rollup baseStake (wei) — BoLD alerts when < 1 ETH. Returns null if the call
// reverts (e.g. a rollup variant without the getter).
export const getRollupBaseStake = async (rpcUrl: string, rollup: string) => {
  const data = rollupInfoInterface.encodeFunctionData('baseStake')
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: rollup, data }, 'latest'], {
    retries: 1,
  })
  return BigInt(rollupInfoInterface.decodeFunctionResult('baseStake', result)[0].toString())
}

// true = permissionless validation (whitelist disabled); false = whitelisted.
export const getValidatorWhitelistDisabled = async (rpcUrl: string, rollup: string) => {
  const data = rollupInfoInterface.encodeFunctionData('validatorWhitelistDisabled')
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: rollup, data }, 'latest'], {
    retries: 1,
  })
  return Boolean(rollupInfoInterface.decodeFunctionResult('validatorWhitelistDisabled', result)[0])
}

export const getErc20Decimals = async (rpcUrl: string, token: string) => {
  const data = erc20Interface.encodeFunctionData('decimals')
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: token, data }, 'latest'], {
    retries: 2,
  })
  return Number(erc20Interface.decodeFunctionResult('decimals', result)[0])
}

export const readActiveOutbox = async (rpcUrl: string, bridge: string) => {
  const data = activeOutboxInterface.encodeFunctionData('activeOutbox')
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: bridge, data }, 'latest'], {
    retries: 2,
  })
  return activeOutboxInterface.decodeFunctionResult('activeOutbox', result)[0] as string
}

export const getLogs = async ({
  rpcUrl,
  address,
  topic,
  fromBlock,
  toBlock,
}: {
  rpcUrl: string
  address: string
  topic: string
  fromBlock: bigint
  toBlock: bigint
}) =>
  rpcCall<RpcLog[]>(
    rpcUrl,
    'eth_getLogs',
    [
      {
        address,
        topics: [topic],
        fromBlock: toHexBlock(fromBlock),
        toBlock: toHexBlock(toBlock),
      },
    ],
    { retries: 2 }
  )

export const findBlockByTimestamp = async (rpcUrl: string, timestamp: number) => {
  const latestBlock = await getBlockNumber(rpcUrl)
  const latest = await getBlock(rpcUrl, latestBlock)

  if (Number(latest.timestamp) <= timestamp) {
    return latest.blockNumber
  }

  let low = 0n
  let high = latest.blockNumber

  while (low < high) {
    const middle = (low + high) / 2n
    const block = await getBlock(rpcUrl, middle)

    if (Number(block.timestamp) < timestamp) {
      low = middle + 1n
      continue
    }

    high = middle
  }

  return low
}

export const decodeL2ToL1Log = (log: RpcLog) => {
  const parsed = l2ToL1Interface.parseLog(log)

  return {
    position: BigInt(parsed.args.position.toString()),
    value: BigInt(parsed.args.callvalue.toString()),
    startedAt: Number(parsed.args.timestamp.toString()),
    blockNumber: BigInt(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: Number(log.logIndex),
  }
}

export const decodeOutboxLog = (log: RpcLog) => {
  const parsed = outboxInterface.parseLog(log)

  return {
    position: BigInt(parsed.args.transactionIndex.toString()),
    blockNumber: BigInt(log.blockNumber),
    transactionHash: log.transactionHash,
  }
}
