import yargs from 'yargs'
import { providers } from 'ethers'
import {
  getArbitrumNetwork,
  registerCustomArbitrumNetwork,
} from '@arbitrum/sdk'
import {
  ChildNetwork,
  DEFAULT_CONFIG_PATH,
  getConfig,
} from 'utils'
import {
  FindRetryablesOptions,
  OnFailedRetryableFound,
  OnRedeemedRetryableFound,
  RetryableMonitorResult,
} from './core/types'
import {
  checkRetryablesContinuous,
  checkRetryablesOneOff,
} from './core/retryableCheckerMode'
import { alertUntriagedNotionRetryables } from './handlers/notion/alertUntriagedRetraybles'
import { fetchNotionRetryables } from './handlers/notion/fetchedNotionRetryablesUtils'
import { handleFailedRetryablesFound } from './handlers/handleFailedRetryablesFound'
import { handleRedeemedRetryablesFound } from './handlers/handleRedeemedRetryablesFound'
import { postSlackMessage } from './handlers/slack/postSlackMessage'
import { buildRetryableMonitorResult } from './result'

const networkIsRegistered = (networkId: number) => {
  try {
    getArbitrumNetwork(networkId)
    return true
  } catch (_) {
    return false
  }
}

export const getMonitorConfig = (configPath = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      fromBlock: { type: 'number', default: 0 },
      toBlock: { type: 'number', default: 0 },
      continuous: { type: 'boolean', default: false },
      configPath: { type: 'string', default: configPath },
      enableAlerting: { type: 'boolean', default: false },
      writeToNotion: { type: 'boolean', default: false },
      autoRedeem: { type: 'boolean', default: false },
    })
    .strict()
    .parseSync() as FindRetryablesOptions

  if (options.autoRedeem && !options.writeToNotion) {
    console.warn(
      '[retryable-monitor] --autoRedeem has no effect unless the Notion sweep runs. ' +
        'You can enable it with --writeToNotion.'
    )
  }

  return {
    config: getConfig({ configPath: options.configPath }),
    options,
  }
}

const getHandlers = (
  writeToNotion: boolean
): {
  onFailedRetryableFound: OnFailedRetryableFound
  onRedeemedRetryableFound: OnRedeemedRetryableFound
} => ({
  onFailedRetryableFound: async ticket => {
    await handleFailedRetryablesFound(ticket, writeToNotion)
  },
  onRedeemedRetryableFound: async ticket => {
    await handleRedeemedRetryablesFound(ticket, writeToNotion)
  },
})

const getTicketCount = (result: RetryableMonitorResult) => {
  const metric = result.metrics.find(item => item.key === 'tickets_total')
  return typeof metric?.value === 'number' ? metric.value : 0
}

export const formatRetryableMonitorResult = (
  result: RetryableMonitorResult
) => `${result.chainName}:\n- ${result.findings.map(f => f.message).join('\n- ')}`

export const runRetryableMonitorForChain = async ({
  parentChainProvider,
  childChainProvider,
  childChain,
  fromBlock,
  toBlock,
  enableAlerting,
  writeToNotion,
}: {
  parentChainProvider: providers.Provider
  childChainProvider: providers.Provider
  childChain: ChildNetwork
  fromBlock: number
  toBlock: number
  enableAlerting: boolean
  writeToNotion: boolean
}): Promise<RetryableMonitorResult> => {
  const startedAt = Date.now()
  const { onFailedRetryableFound, onRedeemedRetryableFound } =
    getHandlers(writeToNotion)
  const result = await checkRetryablesOneOff({
    parentChainProvider,
    childChainProvider,
    childChain,
    fromBlock,
    toBlock,
    enableAlerting,
    onFailedRetryableFound,
    onRedeemedRetryableFound,
  })

  return buildRetryableMonitorResult({
    childChain,
    tickets: result.tickets,
    fromBlock: result.fromBlock,
    toBlock: result.toBlock,
    startedAt,
    finishedAt: Date.now(),
  })
}

const processChildChain = async (
  parentChainProvider: providers.Provider,
  childChainProvider: providers.Provider,
  childChain: ChildNetwork,
  fromBlock: number,
  toBlock: number,
  enableAlerting: boolean,
  continuous: boolean,
  writeToNotion: boolean,
  autoRedeem: boolean,
  childChains: ChildNetwork[]
) => {
  const { onFailedRetryableFound, onRedeemedRetryableFound } =
    getHandlers(writeToNotion)

  if (continuous) {
    console.log('Activating continuous check for retryables...')
    await checkRetryablesContinuous({
      parentChainProvider,
      childChainProvider,
      childChain,
      fromBlock,
      toBlock,
      enableAlerting,
      continuous,
      onFailedRetryableFound,
      onRedeemedRetryableFound,
    })

    if (writeToNotion) {
      console.log('Activating continuous sweep of Notion database...')
      setInterval(async () => {
        await alertUntriagedNotionRetryables(childChains, autoRedeem)
      }, 1000 * 60 * 60)
    }

    return
  }

  console.log('Activating one-off check for retryables...')
  const result = await runRetryableMonitorForChain({
    parentChainProvider,
    childChainProvider,
    childChain,
    fromBlock,
    toBlock,
    enableAlerting,
    writeToNotion,
  })

  if (getTicketCount(result) === 0) {
    console.log('No retryables found in the specified block range.')
  }

  return result
}

export const processOrbitChainsConcurrently = async () => {
  const { config, options } = getMonitorConfig()

  console.log(
    '>>>>>> Processing child chains: ',
    config.childChains.map((childChain: ChildNetwork) => ({
      name: childChain.name,
      chainID: childChain.chainId,
      orbitRpcUrl: childChain.orbitRpcUrl,
      parentRpcUrl: childChain.parentRpcUrl,
    }))
  )

  if (options.writeToNotion) {
    await fetchNotionRetryables()
  }

  const promises = config.childChains.map(async (childChain: ChildNetwork) => {
    try {
      if (!networkIsRegistered(childChain.chainId)) {
        registerCustomArbitrumNetwork(childChain)
      }

      const parentChainProvider = new providers.JsonRpcProvider(
        String(childChain.parentRpcUrl)
      )
      const childChainProvider = new providers.JsonRpcProvider(
        String(childChain.orbitRpcUrl)
      )

      return await processChildChain(
        parentChainProvider,
        childChainProvider,
        childChain,
        options.fromBlock,
        options.toBlock,
        options.enableAlerting,
        options.continuous,
        options.writeToNotion,
        !!options.autoRedeem,
        config.childChains
      )
    } catch (e) {
      const error = e as Error
      const errorStr = `Retryable monitor - Error processing chain [${childChain.name}]: ${error.message}`
      if (options.enableAlerting) {
        await postSlackMessage({ message: errorStr })
      }
      console.error(errorStr)
      return
    }
  })

  await Promise.allSettled(promises)

  if (options.writeToNotion) {
    await alertUntriagedNotionRetryables(
      config.childChains,
      !!options.autoRedeem
    )
  }
}

export const main = async () => {
  await processOrbitChainsConcurrently()
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
