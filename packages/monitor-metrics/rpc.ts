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

const l2ToL1Interface = new ethers.utils.Interface([
  'event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)',
])

const outboxInterface = new ethers.utils.Interface([
  'event OutBoxTransactionExecuted(address indexed to, address indexed l2Sender, uint256 indexed zero, uint256 transactionIndex)',
])

const rpcCall = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 10_000
): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method,
        params,
      }),
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
  rpcCall<string>(rpcUrl, 'eth_blockNumber', []).then(value => BigInt(value))

export const getBlock = async (rpcUrl: string, blockNumber: bigint) => {
  const block = await rpcCall<{ timestamp: string }>(rpcUrl, 'eth_getBlockByNumber', [
    toHexBlock(blockNumber),
    false,
  ])

  return {
    blockNumber,
    timestamp: BigInt(block.timestamp),
  }
}

export const getBalance = async (rpcUrl: string, address: string) => {
  const value = await rpcCall<string>(rpcUrl, 'eth_getBalance', [address, 'latest'])
  return BigInt(value)
}

export const readActiveOutbox = async (rpcUrl: string, bridge: string) => {
  const data = activeOutboxInterface.encodeFunctionData('activeOutbox')
  const result = await rpcCall<string>(rpcUrl, 'eth_call', [{ to: bridge, data }, 'latest'])
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
  rpcCall<RpcLog[]>(rpcUrl, 'eth_getLogs', [
    {
      address,
      topics: [topic],
      fromBlock: toHexBlock(fromBlock),
      toBlock: toHexBlock(toBlock),
    },
  ])

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
