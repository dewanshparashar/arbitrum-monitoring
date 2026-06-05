import yargs from 'yargs'
import {
  Log,
  PublicClient,
  createPublicClient,
  decodeFunctionData,
  defineChain,
  formatEther,
  http,
  parseAbi,
} from 'viem'
import { arbitrumNova } from 'viem/chains'
import { AbiEvent } from 'abitype'
import {
  getBatchPosters,
  isAnyTrust as isAnyTrustOrbitChain,
} from '@arbitrum/orbit-sdk'
import {
  getChainFromId,
  getBlockRangeForHours,
  getMaxBlockRange,
  getParentChainBlockTimeForBatchPosting,
  MAX_TIMEBOUNDS_SECONDS,
  BATCH_POSTING_TIMEBOUNDS_FALLBACK,
  BATCH_POSTING_TIMEBOUNDS_BUFFER,
  MIN_DAYS_OF_BALANCE_LEFT,
  MAX_LOGS_TO_PROCESS_FOR_BALANCE,
  BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK,
  supportedCoreChainIds,
} from './chains'
import {
  AnyTrustCheckResult,
  BatchPosterBalanceStatus,
  BatchPosterMonitorOptions,
  BatchPosterMonitorResult,
  BatchPosterMonitorSummary,
} from './types'
import { reportBatchPosterErrorToSlack } from './reportBatchPosterAlertToSlack'
import {
  buildBatchPosterFindings,
  buildBatchPosterMonitorResult,
  formatBatchPosterMonitorResult,
} from './result'
import {
  ChildNetwork as ChainInfo,
  DEFAULT_CONFIG_PATH,
  getConfig,
  getExplorerUrlPrefixes,
  resolveRollupAddress,
  processBlockRangeInChunks,
} from 'utils'
import {
  shouldIgnoreFunctionSelector,
  isIgnoredSelectorError,
  shouldIgnoreChain,
} from './ignoreList'

// Parsing command line arguments using yargs
let options: BatchPosterMonitorOptions = {
  configPath: DEFAULT_CONFIG_PATH,
  enableAlerting: false,
  writeToNotion: false,
}

const parseOptions = () => {
  options = yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: DEFAULT_CONFIG_PATH },
      enableAlerting: { type: 'boolean', default: false },
      writeToNotion: { type: 'boolean', default: false },
    })
    .strict()
    .parseSync() as BatchPosterMonitorOptions
}

const sequencerBatchDeliveredEventAbi: AbiEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'uint256',
      name: 'batchSequenceNumber',
      type: 'uint256',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'beforeAcc',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'afterAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'delayedAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'afterDelayedMessagesRead',
      type: 'uint256',
    },
    {
      components: [
        { internalType: 'uint64', name: 'minTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'maxTimestamp', type: 'uint64' },
        { internalType: 'uint64', name: 'minBlockNumber', type: 'uint64' },
        { internalType: 'uint64', name: 'maxBlockNumber', type: 'uint64' },
      ],
      indexed: false,
      internalType: 'struct ISequencerInbox.TimeBounds',
      name: 'timeBounds',
      type: 'tuple',
    },
    {
      indexed: false,
      internalType: 'enum ISequencerInbox.BatchDataLocation',
      name: 'dataLocation',
      type: 'uint8',
    },
  ],
  name: 'SequencerBatchDelivered',
  type: 'event',
}

const sequencerInboxAbi = [
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Espresso variant (selector 0x37501551) — 7th param for TEE attestation
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'batcherSignatureAndHotshotHeight',
        type: 'bytes',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Bold DelayProof variant (selector 0x69cacded) — 7th param is DelayProof struct
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'beforeDelayedAcc',
            type: 'bytes32',
          },
          {
            components: [
              {
                internalType: 'uint8',
                name: 'kind',
                type: 'uint8',
              },
              {
                internalType: 'address',
                name: 'sender',
                type: 'address',
              },
              {
                internalType: 'uint64',
                name: 'blockNumber',
                type: 'uint64',
              },
              {
                internalType: 'uint64',
                name: 'timestamp',
                type: 'uint64',
              },
              {
                internalType: 'uint256',
                name: 'inboxSeqNum',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'baseFeeL1',
                type: 'uint256',
              },
              {
                internalType: 'bytes32',
                name: 'messageDataHash',
                type: 'bytes32',
              },
            ],
            internalType: 'struct Messages.Message',
            name: 'message',
            type: 'tuple',
          },
        ],
        internalType: 'struct ISequencerInbox.DelayProof',
        name: 'delayProof',
        type: 'tuple',
      },
    ],
    name: 'addSequencerL2BatchFromOriginDelayProof',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const displaySummaryInformation = ({
  childChainInformation,
  lastBlockReported,
  latestBatchPostedBlockNumber,
  latestBatchPostedSecondsAgo,
  latestChildChainBlockNumber,
  batchPosterBacklogSize,
  batchPostingTimeBounds,
}: {
  childChainInformation: ChainInfo
  lastBlockReported: bigint
  latestBatchPostedBlockNumber: bigint
  latestBatchPostedSecondsAgo: bigint
  latestChildChainBlockNumber: bigint
  batchPosterBacklogSize: bigint
  batchPostingTimeBounds: number
}) => {
  console.log('**********')
  console.log(`Batch poster summary of [${childChainInformation.name}]`)
  console.log(
    `Latest block number on [${childChainInformation.name}] is ${latestChildChainBlockNumber}.`
  )
  console.log(
    `Latest [${
      childChainInformation.name
    }] block included on [Parent chain id: ${
      childChainInformation.parentChainId
    }, block-number ${latestBatchPostedBlockNumber}] is ${lastBlockReported} => ${
      latestBatchPostedSecondsAgo / 60n / 60n
    } hours, ${(latestBatchPostedSecondsAgo / 60n) % 60n} minutes, ${
      latestBatchPostedSecondsAgo % 60n
    } seconds ago.`
  )

  console.log(`Batch poster backlog is ${batchPosterBacklogSize} blocks.`)
  console.log(timeBoundsExpectedMessage(batchPostingTimeBounds))
  console.log('**********')
  console.log('')
}

const allBatchedAlertsContent: string[] = []

const appendSequencerInboxReason = (
  childChainInformation: ChainInfo,
  reasons: string[]
) => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
    childChainInformation
  )

  return [
    ...[...reasons].reverse(),
    `SequencerInbox located at <${
      PARENT_CHAIN_ADDRESS_PREFIX +
      childChainInformation.ethBridge.sequencerInbox
    }|${childChainInformation.ethBridge.sequencerInbox}> on [chain id ${
      childChainInformation.parentChainId
    }]`,
  ]
}

const showAlert = (childChainInformation: ChainInfo, reasons: string[]) => {
  const reasonsString = appendSequencerInboxReason(
    childChainInformation,
    reasons
  )
    .filter(reason => !!reason.trim().length)
    .join('\n• ')

  console.log(`Alert on ${childChainInformation.name}:`)
  console.log(`• ${reasonsString}`)
  console.log('--------------------------------------')
  console.log('')
  allBatchedAlertsContent.push(
    `[${childChainInformation.name}]:\n• ${reasonsString}`
  )
}

type EventLogs = Log<
  bigint,
  number,
  false,
  AbiEvent,
  undefined,
  [AbiEvent],
  string
>[]

const getBatchPosterFromEventLogs = async (
  eventLogs: EventLogs,
  parentChainClient: PublicClient
) => {
  // get the batch-poster for the first event log
  const batchPostingTransactionHash = eventLogs[0].transactionHash
  const tx = await parentChainClient.getTransaction({
    hash: batchPostingTransactionHash,
  })
  return tx.from
}

const getBatchPosterAddress = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo,
  sequencerInboxLogs: EventLogs
) => {
  // if we have sequencer inbox logs, then get the batch poster directly
  if (sequencerInboxLogs.length > 0) {
    return await getBatchPosterFromEventLogs(
      sequencerInboxLogs,
      parentChainClient
    )
  }

  return undefined
}

const getBatchPosterBalanceStatus = async (
  parentChainClient: PublicClient,
  childChainInformation: ChainInfo,
  sequencerInboxLogs: EventLogs
): Promise<BatchPosterBalanceStatus> => {
  const { PARENT_CHAIN_ADDRESS_PREFIX } = getExplorerUrlPrefixes(
    childChainInformation
  )

  const batchPoster = await getBatchPosterAddress(
    parentChainClient,
    childChainInformation,
    sequencerInboxLogs
  )

  if (!batchPoster) {
    return {
      batchPoster: '0x0000000000000000000000000000000000000000',
      currentBalance: 0n,
    }
  }

  const currentBalance = await parentChainClient.getBalance({
    address: batchPoster,
  })

  // if there are no logs, add a static check for low balance
  if (sequencerInboxLogs.length === 0) {
    const bal = Number(formatEther(currentBalance))
    if (bal < BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK) {
      return {
        batchPoster,
        currentBalance,
        message: `Low Batch poster balance (<${
          PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
        }|${batchPoster}>): ${formatEther(
          currentBalance
        )} ETH (Minimum expected balance: ${BATCH_POSTER_BALANCE_ALERT_THRESHOLD_FALLBACK} ETH). `,
      }
    }
    return {
      batchPoster,
      currentBalance,
    }
  }

  // Dynamic balance check based on the logs
  // Extract the most recent logs for processing to avoid overloading with too many logs
  const recentLogs = [...sequencerInboxLogs].slice(
    -MAX_LOGS_TO_PROCESS_FOR_BALANCE
  )

  // Calculate the elapsed time (in seconds) since the first block in the logs
  const firstTransaction = await parentChainClient.getTransaction({
    hash: recentLogs[0].transactionHash,
  })
  const initialBlock = await parentChainClient.getBlock({
    blockNumber: firstTransaction.blockNumber,
  })
  const initialBlockTimestamp = initialBlock.timestamp

  const elapsedTimeSinceFirstBlock =
    BigInt(Math.floor(Date.now() / 1000)) - initialBlockTimestamp

  // Loop through each log and calculate the gas cost for posting batches
  let postingCost = BigInt(0)
  for (const log of recentLogs) {
    const tx = await parentChainClient.getTransactionReceipt({
      hash: log.transactionHash,
    })
    postingCost += tx.gasUsed * tx.effectiveGasPrice // Accumulate the transaction cost
  }

  // Calculate the approximate balance spent over the last 24 hours
  const secondsIn1Day = 24n * 60n * 60n

  const timeRatio =
    secondsIn1Day / elapsedTimeSinceFirstBlock > 1n
      ? secondsIn1Day / elapsedTimeSinceFirstBlock
      : 1n // set minimum cap of the ratio to 1, since we are calculating the cost for 24 hours, else bigInt rounds off the ratio to zero

  const dailyPostingCostEstimate = timeRatio * postingCost

  // Estimate how many days the current balance will last based on the daily cost
  const daysLeftForCurrentBalance = currentBalance / dailyPostingCostEstimate
  console.log(
    `The current batch poster balance is ${formatEther(
      currentBalance
    )} ETH, and balance spent in 24 hours is approx ${formatEther(
      dailyPostingCostEstimate
    )} ETH. The current balance can last approximately ${daysLeftForCurrentBalance} days.`
  )

  // Determine the minimum expected balance needed to maintain operations for a certain number of days
  const minimumExpectedBalance =
    MIN_DAYS_OF_BALANCE_LEFT * dailyPostingCostEstimate

  // Check if the current balance is below the minimum expected balance
  // Return a warning message if low balance is detected
  const lowBalanceDetected = currentBalance < minimumExpectedBalance

  return {
    batchPoster,
    currentBalance,
    minimumExpectedBalance,
    dailyPostingCostEstimate,
    daysLeftForCurrentBalance,
    message: lowBalanceDetected
      ? `Low Batch poster balance (<${
          PARENT_CHAIN_ADDRESS_PREFIX + batchPoster
        }|${batchPoster}>): ${formatEther(
          currentBalance
        )} ETH (Minimum expected balance: ${formatEther(
          minimumExpectedBalance
        )} ETH). The current balance is expected to last for ~${daysLeftForCurrentBalance} days only.`
      : undefined,
  }
}

const checkForUserTransactionBlocks = async ({
  fromBlock,
  toBlock,
  publicClient,
  minTimestampSeconds,
}: {
  fromBlock: number
  toBlock: number
  publicClient: PublicClient
  minTimestampSeconds?: bigint
}) => {
  const MINER_OF_USER_TX_BLOCKS = '0xa4b000000000000000000073657175656e636572' // this will be the miner address if a block contains user tx

  for (let i = toBlock; i >= fromBlock; i--) {
    const block = await publicClient.getBlock({ blockNumber: BigInt(i) })
    if (
      minTimestampSeconds !== undefined &&
      block.timestamp < minTimestampSeconds
    ) {
      return false
    }

    if (block.miner === MINER_OF_USER_TX_BLOCKS) {
      return true
    }
  }

  return false
}

const getBatchPostingTimeBounds = async (
  childChainInformation: ChainInfo,
  parentChainClient: PublicClient
) => {
  let batchPostingTimeBounds = BATCH_POSTING_TIMEBOUNDS_FALLBACK
  try {
    const maxTimeVariation = await parentChainClient.readContract({
      address: childChainInformation.ethBridge.sequencerInbox as `0x${string}`,
      abi: parseAbi([
        'function maxTimeVariation() view returns (uint256, uint256, uint256, uint256)',
      ]),
      functionName: 'maxTimeVariation',
    })

    const delayBlocks = Number(maxTimeVariation[0])
    const delaySeconds = Number(maxTimeVariation[2].toString())

    // use the minimum of delayBlocks or delay seconds
    batchPostingTimeBounds = Math.min(
      delayBlocks *
        getParentChainBlockTimeForBatchPosting(childChainInformation),
      delaySeconds
    )
  } catch (_) {
    // no-op, use the fallback value
  }

  // formula : min(50% of x , max(1h, x - buffer))
  // minimum of half of the batchPostingTimeBounds vs [1 hour vs batchPostingTimeBounds - buffer]
  return Math.min(
    0.65 * batchPostingTimeBounds,
    Math.max(3600, batchPostingTimeBounds - BATCH_POSTING_TIMEBOUNDS_BUFFER)
  )
}

const timeBoundsExpectedMessage = (batchPostingTimebounds: number) =>
  `At least 1 batch is expected to be posted every ${
    batchPostingTimebounds / 60 / 60
  } hours.`

const isAnyTrust = async (
  childChainInformation: ChainInfo,
  parentChainClient: PublicClient
) => {
  const { chainId } = childChainInformation

  const anyTrustCoreChainIds = [arbitrumNova.id] as number[] // core chains that we know are AnyTrust

  // if chainId being passed is a core chainId
  if (supportedCoreChainIds.includes(chainId)) {
    // then return true if it's in anyTrust, else false
    return anyTrustCoreChainIds.includes(chainId)
  }

  try {
    return await isAnyTrustOrbitChain({
      publicClient: parentChainClient as any,
      rollup: childChainInformation.ethBridge.rollup as `0x${string}`,
    })
  } catch (e: any) {
    console.warn(
      `Warning: Failed to check AnyTrust status for chain [${
        childChainInformation.name
      }]: ${e?.message || e}`
    )
    return false
  }
}

export const runBatchPosterMonitorForChain = async (
  childChainInformation: ChainInfo,
  options?: { lookbackHours?: number }
): Promise<BatchPosterMonitorResult> => {
  const startedAt = Date.now()
  console.log(
    `[batch-poster] Starting [${childChainInformation.name}] (${childChainInformation.chainId})`
  )
  const parentChain = getChainFromId(childChainInformation.parentChainId)
  const childChain = defineChain({
    id: childChainInformation.chainId,
    name: childChainInformation.name,
    network: 'childChain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [childChainInformation.orbitRpcUrl],
      },
      public: {
        http: [childChainInformation.orbitRpcUrl],
      },
    },
  })

  const parentChainClient = createPublicClient({
    chain: parentChain,
    transport: http(childChainInformation.parentRpcUrl),
  })
  const childChainClient = createPublicClient({
    chain: childChain,
    transport: http(childChainInformation.orbitRpcUrl),
  })

  console.log(
    `[batch-poster] Resolving rollup for [${childChainInformation.name}]`
  )
  childChainInformation.ethBridge.rollup = await resolveRollupAddress(
    parentChainClient,
    childChainInformation.ethBridge,
    childChainInformation.name
  )

  // Getting sequencer inbox logs
  const latestBlockNumber = await parentChainClient.getBlockNumber()

  const blocksToProcess = options?.lookbackHours
    ? getBlockRangeForHours(parentChain, options.lookbackHours)
    : getMaxBlockRange(parentChain)
  const toBlock = latestBlockNumber
  const fromBlock = toBlock > blocksToProcess ? toBlock - blocksToProcess : 0n
  console.log(
    `[batch-poster] [${childChainInformation.name}] scanning parent blocks ${fromBlock} to ${toBlock}`
  )

  const sequencerInboxLogs = await processBlockRangeInChunks(
    Number(fromBlock.toString()),
    Number(toBlock.toString()),
    2000,
    async (from, to) =>
      parentChainClient.getLogs({
        address: childChainInformation.ethBridge
          .sequencerInbox as `0x${string}`,
        event: sequencerBatchDeliveredEventAbi,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      }),
    (prev, next) => [...prev, ...next],
    [] as Log<bigint, number, false, AbiEvent, true, readonly AbiEvent[]>[]
  )
  console.log(
    `[batch-poster] [${childChainInformation.name}] found ${sequencerInboxLogs.length} sequencer inbox log(s)`
  )

  const balanceStatus = await getBatchPosterBalanceStatus(
    parentChainClient,
    childChainInformation,
    sequencerInboxLogs
  )
  console.log(
    `[batch-poster] [${
      childChainInformation.name
    }] balance=${balanceStatus.currentBalance.toString()} message=${
      balanceStatus.message || 'none'
    }`
  )

  const batchPostingTimeBounds = await getBatchPostingTimeBounds(
    childChainInformation,
    parentChainClient
  )

  // Get the last block of the chain
  const latestChildChainBlockNumber = await childChainClient.getBlockNumber()
  const summary: BatchPosterMonitorSummary = {
    latestParentBlockNumber: latestBlockNumber,
    fromBlock,
    toBlock,
    sequencerInboxLogCount: sequencerInboxLogs.length,
    batchPostingTimeBounds,
    latestChildChainBlockNumber,
    balanceStatus,
  }

  if (!sequencerInboxLogs || sequencerInboxLogs.length === 0) {
    // get the last block that is 'safe' ie. can be assumed to have been posted
    const latestChildChainSafeBlock = await childChainClient.getBlock({
      blockTag: 'safe',
    })

    const blocksPendingToBePosted =
      latestChildChainBlockNumber - latestChildChainSafeBlock.number

    const doPendingBlocksContainUserTransactions =
      await checkForUserTransactionBlocks({
        fromBlock: Number(latestChildChainSafeBlock.number + 1n), // start checking AFTER the latest 'safe' block
        toBlock: Number(latestChildChainBlockNumber),
        publicClient: childChainClient,
        minTimestampSeconds: options?.lookbackHours
          ? BigInt(
              Math.floor(Date.now() / 1000) - options.lookbackHours * 60 * 60
            )
          : undefined,
      })

    const batchPostingBacklog =
      blocksPendingToBePosted > 0n && doPendingBlocksContainUserTransactions

    summary.latestSafeBlockNumber = latestChildChainSafeBlock.number
    summary.pendingBlocksToBePosted = blocksPendingToBePosted
    summary.pendingBlocksContainUserTransactions =
      doPendingBlocksContainUserTransactions
    summary.batchPosterBacklog = batchPostingBacklog
      ? blocksPendingToBePosted
      : 0n

    const findings = buildBatchPosterFindings({
      chainInfo: childChainInformation,
      summary,
    })
    console.log(
      `[batch-poster] Finished [${childChainInformation.name}] with ${
        findings.length
      } finding(s) in ${Date.now() - startedAt}ms`
    )

    return buildBatchPosterMonitorResult({
      chainInfo: childChainInformation,
      summary,
      findings,
      startedAt,
      finishedAt: Date.now(),
    })
  }

  // Get the latest log
  const lastSequencerInboxLog = sequencerInboxLogs.pop()

  const isChainAnyTrust = await isAnyTrust(
    childChainInformation,
    parentChainClient
  )
  summary.isAnyTrust = isChainAnyTrust

  if (isChainAnyTrust) {
    summary.anyTrustCheck = await inspectAnyTrustBatchPosting({
      parentChainClient,
      childChainInformation,
      lastSequencerInboxLog,
    })
  }
  // Get the timestamp of the block where that log was emitted
  const lastSequencerInboxBlock = await parentChainClient.getBlock({
    blockNumber: lastSequencerInboxLog!.blockNumber,
  })
  const lastBatchPostedTime = lastSequencerInboxBlock.timestamp
  const secondsSinceLastBatchPoster =
    BigInt(Math.floor(Date.now() / 1000)) - lastBatchPostedTime

  // Get last block that's part of a batch
  const lastBlockReported = await parentChainClient.readContract({
    address: childChainInformation.ethBridge.bridge as `0x${string}`,
    abi: parseAbi([
      'function sequencerReportedSubMessageCount() view returns (uint256)',
    ]),
    functionName: 'sequencerReportedSubMessageCount',
  })

  // Get batch poster backlog
  const batchPosterBacklog = latestChildChainBlockNumber - lastBlockReported
  summary.latestBatchPostedBlockNumber = lastSequencerInboxBlock.number
  summary.secondsSinceLastBatchPoster = secondsSinceLastBatchPoster
  summary.lastBlockReported = lastBlockReported
  summary.batchPosterBacklog = batchPosterBacklog

  const findings = buildBatchPosterFindings({
    chainInfo: childChainInformation,
    summary,
  })
  console.log(
    `[batch-poster] Finished [${childChainInformation.name}] with ${
      findings.length
    } finding(s) in ${Date.now() - startedAt}ms`
  )

  return buildBatchPosterMonitorResult({
    chainInfo: childChainInformation,
    summary,
    findings,
    startedAt,
    finishedAt: Date.now(),
  })
}

const monitorBatchPoster = async (childChainInformation: ChainInfo) => {
  const result = await runBatchPosterMonitorForChain(childChainInformation)
  const reasons = result.findings.map(f => f.message)

  if (reasons.length > 0) {
    showAlert(childChainInformation, reasons)
    return result
  }

  if (
    result.metrics.find(metric => metric.key === 'latest_safe_block_number')
      ?.value !== null
  ) {
    console.log(
      `**********\nBatch poster summary of [${childChainInformation.name}]`
    )
    console.log(
      `No user activity in the last ${
        MAX_TIMEBOUNDS_SECONDS / 60 / 60
      } hours, and hence no batch has been posted.\n`
    )
    return result
  }

  displaySummaryInformation({
    childChainInformation,
    lastBlockReported: result.metrics.find(
      metric => metric.key === 'last_block_reported'
    )?.value as bigint,
    latestBatchPostedBlockNumber: result.observations.find(
      observation => observation.kind === 'batch-poster-latest-batch'
    )?.data.latestBatchPostedBlockNumber as bigint,
    latestBatchPostedSecondsAgo: result.metrics.find(
      metric => metric.key === 'seconds_since_last_batch'
    )?.value as bigint,
    latestChildChainBlockNumber: result.metrics.find(
      metric => metric.key === 'latest_child_block_number'
    )?.value as bigint,
    batchPosterBacklogSize: result.metrics.find(
      metric => metric.key === 'batch_poster_backlog_blocks'
    )?.value as bigint,
    batchPostingTimeBounds: result.metrics.find(
      metric => metric.key === 'batch_posting_timebounds_seconds'
    )?.value as number,
  })

  return result
}

const main = async () => {
  parseOptions()
  const config = getConfig({ configPath: options.configPath })

  // log the chains being processed for better debugging in github actions
  console.log(
    '>>>>>> Processing chains: ',
    config.childChains.map((chainInformation: ChainInfo) => ({
      name: chainInformation.name,
      chainID: chainInformation.chainId,
      rpc: chainInformation.orbitRpcUrl,
    }))
  )

  // process each chain sequentially to avoid RPC rate limiting
  for (const childChain of config.childChains) {
    try {
      // Check if entire chain should be ignored (configured with 'all' in ignore list)
      if (shouldIgnoreChain(childChain.chainId)) {
        console.log(
          `Chain [${childChain.name}]: Skipping - configured with 'all' in ignore list`
        )
        continue
      }

      console.log('>>>>> Processing chain: ', childChain.name)
      await monitorBatchPoster(childChain)
    } catch (e) {
      // Check if this is an ignored selector error
      const { isIgnored, selector } = isIgnoredSelectorError(
        e,
        childChain.chainId
      )
      if (isIgnored) {
        console.log(
          `Chain [${childChain.name}]: Skipping - uses ignored function selector ${selector}`
        )
        continue
      }

      const errorStr = `Batch Posting alert on [${childChain.name}]:\nError processing chain: ${e.message}`
      if (options.enableAlerting) {
        await reportBatchPosterErrorToSlack({
          message: errorStr,
        })
      }
      console.error(errorStr)
    }
  }

  if (options.enableAlerting && allBatchedAlertsContent.length > 0) {
    const finalMessage = `Batch poster monitor summary \n\n${allBatchedAlertsContent.join(
      '\n--------------------------------------\n'
    )}`

    console.log(finalMessage)
    await reportBatchPosterErrorToSlack({
      message: finalMessage,
    })
  }
}

const inspectAnyTrustBatchPosting = async ({
  parentChainClient,
  childChainInformation,
  lastSequencerInboxLog,
}: {
  parentChainClient: PublicClient
  childChainInformation: ChainInfo
  lastSequencerInboxLog:
    | Log<bigint, number, false, AbiEvent, undefined, [AbiEvent], string>
    | undefined
}): Promise<AnyTrustCheckResult> => {
  const alerts: string[] = []
  const result: AnyTrustCheckResult = { alerts }

  try {
    // Get the transaction that emitted `lastSequencerInboxLog`
    const transaction = await parentChainClient.getTransaction({
      hash: lastSequencerInboxLog?.transactionHash as `0x${string}`,
    })
    result.transactionHash = transaction.hash

    // Check if this function selector should be ignored
    const functionSelector = transaction.input.slice(0, 10) // 0x + 8 chars
    result.functionSelector = functionSelector
    if (
      shouldIgnoreFunctionSelector(
        childChainInformation.chainId,
        functionSelector
      )
    ) {
      console.log(
        `Chain [${childChainInformation.name}]: Ignoring transaction with function selector ${functionSelector}`
      )
      return result
    }

    const { args } = decodeFunctionData({
      abi: sequencerInboxAbi,
      data: transaction.input,
    })

    // Extract the 'data' field
    const batchData = args[1] as `0x${string}`

    // Check the first byte of the data
    const firstByte = batchData.slice(0, 4)
    result.dataFirstByte = firstByte

    if (firstByte === '0x00') {
      alerts.push(
        `AnyTrust chain [${childChainInformation.name}] has fallen back to posting calldata on-chain. This indicates a potential issue with the Data Availability Committee.`
      )
    } else if (firstByte === '0x88') {
      console.log(
        `Chain [${childChainInformation.name}] is using AnyTrust DACert as expected.`
      )
    } else {
      console.log(
        `Chain [${childChainInformation.name}] is using an unknown data format. First byte: ${firstByte}`
      )
    }
  } catch (e) {
    const errorMsg = `Chain [${childChainInformation.name}]: Error checking if AnyTrust reverted to posting calldata on-chain: ${e.message}`
    console.log(errorMsg)
    alerts.push(errorMsg)
  }

  return result
}

const checkIfAnyTrustRevertedToPostDataOnChain = async (params: {
  parentChainClient: PublicClient
  childChainInformation: ChainInfo
  lastSequencerInboxLog:
    | Log<bigint, number, false, AbiEvent, undefined, [AbiEvent], string>
    | undefined
}): Promise<string[]> => {
  const result = await inspectAnyTrustBatchPosting(params)
  return result.alerts
}

// Export for testing
export { checkIfAnyTrustRevertedToPostDataOnChain }

// Only run main if this is the entry point
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error)
      process.exit(1)
    })
}
