import {
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
} from '@arbitrum/sdk'
import { providers } from 'ethers'
import { runAssertionMonitorForChain } from 'assertion-monitor'
import { runBatchPosterMonitorForChain } from 'batch-poster-monitor'
import { MonitorExecutor } from './types'
import { runRetryableMonitorForChain } from 'retryable-monitor'

const networkIsRegistered = (networkId: number) => {
  try {
    getArbitrumNetwork(networkId)
    return true
  } catch (_) {
    return false
  }
}

const createRetryableRunner = (): MonitorExecutor['run'] => async chain => {
  if (!networkIsRegistered(chain.chainId)) {
    registerCustomArbitrumNetwork(chain)
  }

  return runRetryableMonitorForChain({
    parentChainProvider: new providers.JsonRpcProvider(String(chain.parentRpcUrl)),
    childChainProvider: new providers.JsonRpcProvider(String(chain.orbitRpcUrl)),
    childChain: chain,
    fromBlock: 0,
    toBlock: 0,
    enableAlerting: false,
    writeToNotion: false,
  })
}

export const defaultMonitorExecutors: MonitorExecutor[] = [
  {
    type: 'batch-poster',
    intervalMs: 10 * 60 * 1000,
    run: runBatchPosterMonitorForChain,
  },
  {
    type: 'assertion',
    intervalMs: 15 * 60 * 1000,
    run: runAssertionMonitorForChain,
  },
  {
    type: 'retryable',
    intervalMs: 60 * 60 * 1000,
    run: createRetryableRunner(),
  },
]
