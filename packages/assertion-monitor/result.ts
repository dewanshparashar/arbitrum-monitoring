import { ChildNetwork as ChainInfo } from 'utils'
import { VALIDATOR_AFK_BLOCKS } from './constants'
import {
  AssertionFinding,
  AssertionMetric,
  AssertionMonitorResult,
  AssertionObservation,
  ChainState,
} from './types'

const createObservationId = (
  kind: AssertionObservation['kind'],
  chainId: number,
  suffix: string
) => `${kind}:${chainId}:${suffix}`

const createMetric = (
  key: AssertionMetric['key'],
  chainId: number,
  observedAt: number,
  value: AssertionMetric['value'],
  unit?: string
): AssertionMetric => ({
  key,
  monitor: 'assertion',
  chainId,
  observedAt,
  value,
  unit,
})

const createBlockRef = (chainId: number, block: ChainState[keyof ChainState]) => {
  if (!block || typeof block !== 'object' || !('number' in block)) {
    return undefined
  }

  return {
    chainId,
    number: block.number,
    hash: 'hash' in block ? block.hash : undefined,
    timestamp:
      'timestamp' in block ? Number(block.timestamp) : undefined,
  }
}

const createEventObservation = ({
  chainId,
  observedAt,
  kind,
  event,
  data,
}: {
  chainId: number
  observedAt: number
  kind: AssertionObservation['kind']
  event: ChainState['recentCreationEvent'] | ChainState['recentConfirmationEvent']
  data: AssertionObservation['data']
}): AssertionObservation | undefined => {
  if (!event) {
    return undefined
  }

  return {
    id: createObservationId(kind, chainId, event.transactionHash),
    monitor: 'assertion',
    chainId,
    observedAt,
    kind,
    refs: {
      logs: [
        {
          chainId,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          address: event.address,
          eventName: event.eventName,
        },
      ],
    },
    data,
  }
}

const createObservations = ({
  chainInfo,
  chainState,
  isBold,
  observedAt,
}: {
  chainInfo: ChainInfo
  chainState: ChainState
  isBold: boolean
  observedAt: number
}): AssertionObservation[] => {
  const observations: AssertionObservation[] = [
    {
      id: createObservationId(
        'assertion-rollup-config',
        chainInfo.chainId,
        chainInfo.ethBridge.rollup
      ),
      monitor: 'assertion',
      chainId: chainInfo.chainId,
      observedAt,
      kind: 'assertion-rollup-config',
      data: {
        chainName: chainInfo.name,
        parentChainId: chainInfo.parentChainId,
        rollupAddress: chainInfo.ethBridge.rollup,
        confirmPeriodBlocks: chainInfo.confirmPeriodBlocks,
        isBold,
      },
    },
    {
      id: createObservationId(
        'assertion-chain-state',
        chainInfo.chainId,
        String(chainState.parentCurrentBlock?.number ?? observedAt)
      ),
      monitor: 'assertion',
      chainId: chainInfo.chainId,
      observedAt,
      kind: 'assertion-chain-state',
      refs: {
        blocks: [
          createBlockRef(chainInfo.chainId, chainState.childCurrentBlock),
          createBlockRef(chainInfo.chainId, chainState.childLatestCreatedBlock),
          createBlockRef(
            chainInfo.chainId,
            chainState.childLatestConfirmedBlock
          ),
          createBlockRef(
            chainInfo.parentChainId,
            chainState.parentCurrentBlock
          ),
          createBlockRef(
            chainInfo.parentChainId,
            chainState.parentBlockAtCreation
          ),
          createBlockRef(
            chainInfo.parentChainId,
            chainState.parentBlockAtConfirmation
          ),
        ].filter(Boolean) as NonNullable<
          AssertionObservation['refs']
        >['blocks'],
      },
      data: {
        childCurrentBlockNumber: chainState.childCurrentBlock.number,
        childLatestCreatedBlockNumber:
          chainState.childLatestCreatedBlock?.number ?? null,
        childLatestConfirmedBlockNumber:
          chainState.childLatestConfirmedBlock?.number ?? null,
        parentCurrentBlockNumber:
          chainState.parentCurrentBlock?.number ?? null,
        parentBlockAtCreationNumber:
          chainState.parentBlockAtCreation?.number ?? null,
        parentBlockAtConfirmationNumber:
          chainState.parentBlockAtConfirmation?.number ?? null,
        searchFromBlock: chainState.searchFromBlock ?? null,
        searchToBlock: chainState.searchToBlock ?? null,
        isValidatorWhitelistDisabled:
          chainState.isValidatorWhitelistDisabled,
        isBaseStakeBelowThreshold: chainState.isBaseStakeBelowThreshold,
      },
    },
  ]

  const creationObservation = createEventObservation({
    chainId: chainInfo.parentChainId,
    observedAt,
    kind: 'assertion-creation-event',
    event: chainState.recentCreationEvent,
    data: chainState.recentCreationEvent
      ? {
          assertionHash: chainState.recentCreationEvent.args.assertionHash,
          parentAssertionHash:
            chainState.recentCreationEvent.args.parentAssertionHash,
          eventBlockNumber: chainState.recentCreationEvent.blockNumber,
        }
      : {},
  })
  if (creationObservation) observations.push(creationObservation)

  const confirmationObservation = createEventObservation({
    chainId: chainInfo.parentChainId,
    observedAt,
    kind: 'assertion-confirmation-event',
    event: chainState.recentConfirmationEvent,
    data: chainState.recentConfirmationEvent
      ? {
          blockHash: chainState.recentConfirmationEvent.args.blockHash,
          eventBlockNumber: chainState.recentConfirmationEvent.blockNumber,
        }
      : {},
  })
  if (confirmationObservation) observations.push(confirmationObservation)

  return observations
}

const createMetrics = ({
  chainInfo,
  chainState,
  isBold,
  observedAt,
}: {
  chainInfo: ChainInfo
  chainState: ChainState
  isBold: boolean
  observedAt: number
}): AssertionMetric[] => {
  const parentBlocksSinceLastConfirmation =
    chainState.parentCurrentBlock?.number &&
    chainState.parentBlockAtConfirmation?.number
      ? chainState.parentCurrentBlock.number -
        chainState.parentBlockAtConfirmation.number
      : 0n

  const parentConfirmationThreshold = BigInt(
    chainInfo.confirmPeriodBlocks + VALIDATOR_AFK_BLOCKS
  )

  return [
    createMetric('is_bold_enabled', chainInfo.chainId, observedAt, isBold),
    createMetric(
      'search_window_blocks',
      chainInfo.chainId,
      observedAt,
      chainState.searchFromBlock !== undefined && chainState.searchToBlock
        ? chainState.searchToBlock - chainState.searchFromBlock
        : 0n,
      'blocks'
    ),
    createMetric(
      'latest_child_block_number',
      chainInfo.chainId,
      observedAt,
      chainState.childCurrentBlock.number,
      'blocks'
    ),
    createMetric(
      'latest_created_block_number',
      chainInfo.chainId,
      observedAt,
      chainState.childLatestCreatedBlock?.number ?? null,
      'blocks'
    ),
    createMetric(
      'latest_confirmed_block_number',
      chainInfo.chainId,
      observedAt,
      chainState.childLatestConfirmedBlock?.number ?? null,
      'blocks'
    ),
    createMetric(
      'parent_blocks_since_confirmation',
      chainInfo.chainId,
      observedAt,
      parentBlocksSinceLastConfirmation,
      'blocks'
    ),
    createMetric(
      'parent_confirmation_threshold_blocks',
      chainInfo.chainId,
      observedAt,
      parentConfirmationThreshold,
      'blocks'
    ),
    createMetric(
      'validator_whitelist_disabled',
      chainInfo.chainId,
      observedAt,
      chainState.isValidatorWhitelistDisabled
    ),
    createMetric(
      'base_stake_below_threshold',
      chainInfo.chainId,
      observedAt,
      chainState.isBaseStakeBelowThreshold
    ),
  ]
}

export const buildAssertionMonitorResult = ({
  chainInfo,
  chainState,
  isBold,
  findings,
  startedAt,
  finishedAt,
}: {
  chainInfo: ChainInfo
  chainState: ChainState
  isBold: boolean
  findings: AssertionFinding[]
  startedAt: number
  finishedAt: number
}): AssertionMonitorResult => ({
  monitor: 'assertion',
  chainId: chainInfo.chainId,
  chainName: chainInfo.name,
  startedAt,
  finishedAt,
  status: findings.length > 0 ? 'partial' : 'ok',
  observations: createObservations({
    chainInfo,
    chainState,
    isBold,
    observedAt: finishedAt,
  }),
  metrics: createMetrics({
    chainInfo,
    chainState,
    isBold,
    observedAt: finishedAt,
  }),
  findings,
  meta: {
    parentChainId: chainInfo.parentChainId,
    rollupAddress: chainInfo.ethBridge.rollup,
  },
})
