import {
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
} from '@arbitrum/sdk'
import { providers } from 'ethers'
import { runAssertionMonitorForChain } from 'assertion-monitor'
import { runBatchPosterMonitorForChain } from 'batch-poster-monitor'
import { MonitorExecutor } from './types'
import { runRetryableMonitorForChain } from 'retryable-monitor'

const getLookbackBlocks = (hours: number, blockTimeSeconds: number) =>
  Math.ceil((hours * 60 * 60) / blockTimeSeconds)

const getFromBlock = (toBlock: bigint, blocksToProcess: number) => {
  const blockRange = BigInt(blocksToProcess)
  return toBlock > blockRange ? toBlock - blockRange : 0n
}

const getRetryableParentBlockTime = (parentChainId: number) => {
  if (
    parentChainId === 1 ||
    parentChainId === 11155111 ||
    parentChainId === 17000
  ) {
    return 12
  }

  if (parentChainId === 8453 || parentChainId === 84532) {
    return 2
  }

  return 2
}

const getAssertionParentBlockTime = (parentChainId: number) => {
  if (
    parentChainId === 1 ||
    parentChainId === 11155111 ||
    parentChainId === 17000
  ) {
    return 12
  }

  if (parentChainId === 8453 || parentChainId === 84532) {
    return 2
  }

  if (
    parentChainId === 42161 ||
    parentChainId === 42170 ||
    parentChainId === 421614
  ) {
    return 0.25
  }

  return 1
}

const networkIsRegistered = (networkId: number) => {
  try {
    getArbitrumNetwork(networkId)
    return true
  } catch (_) {
    return false
  }
}

const createAssertionRunner =
  (): MonitorExecutor['run'] => async (chain, context) => {
    if (!context?.lookbackHours) {
      return runAssertionMonitorForChain(chain)
    }

    const parentChainProvider = new providers.JsonRpcProvider(
      String(chain.parentRpcUrl)
    )
    const toBlock = BigInt(await parentChainProvider.getBlockNumber())
    const fromBlock = getFromBlock(
      toBlock,
      getLookbackBlocks(
        context.lookbackHours,
        getAssertionParentBlockTime(chain.parentChainId)
      )
    )

    return runAssertionMonitorForChain(chain, { fromBlock, toBlock })
  }

const createBatchPosterRunner =
  (): MonitorExecutor['run'] => async (chain, context) =>
    runBatchPosterMonitorForChain(chain, {
      lookbackHours: context?.lookbackHours,
    })

const createRetryableRunner =
  (): MonitorExecutor['run'] => async (chain, context) => {
    if (!networkIsRegistered(chain.chainId)) {
      registerCustomArbitrumNetwork(chain)
    }

    const parentChainProvider = new providers.JsonRpcProvider(
      String(chain.parentRpcUrl)
    )
    let fromBlock = 0
    let toBlock = 0

    if (context?.lookbackHours) {
      toBlock = await parentChainProvider.getBlockNumber()
      fromBlock = Number(
        getFromBlock(
          BigInt(toBlock),
          getLookbackBlocks(
            context.lookbackHours,
            getRetryableParentBlockTime(chain.parentChainId)
          )
        )
      )
    }

    return runRetryableMonitorForChain({
      parentChainProvider,
      childChainProvider: new providers.JsonRpcProvider(
        String(chain.orbitRpcUrl)
      ),
      childChain: chain,
      fromBlock,
      toBlock,
      enableAlerting: false,
      writeToNotion: false,
    })
  }

export const defaultMonitorExecutors: MonitorExecutor[] = [
  {
    type: 'batch-poster',
    intervalMs: 10 * 60 * 1000,
    run: createBatchPosterRunner(),
  },
  {
    type: 'assertion',
    intervalMs: 15 * 60 * 1000,
    run: createAssertionRunner(),
  },
  {
    type: 'retryable',
    intervalMs: 60 * 60 * 1000,
    run: createRetryableRunner(),
  },
]
