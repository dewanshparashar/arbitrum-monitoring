import { Block, Log } from 'viem'
import {
  DerivedFinding,
  MonitorRunResult,
  RawMetric,
  RawObservation,
} from 'monitor-core'
import {
  ASSERTION_CONFIRMED_EVENT,
  ASSERTION_CREATED_EVENT,
  NODE_CONFIRMED_EVENT,
  NODE_CREATED_EVENT,
} from './abi'

export interface BlockRange {
  fromBlock: bigint
  toBlock: bigint
}

export interface AssertionLogs {
  createdLogs: Log[]
  confirmedLogs: Log[]
}

/** Type for assertion/node creation events */
export type CreationEvent = Log<
  bigint,
  number,
  false,
  typeof ASSERTION_CREATED_EVENT | typeof NODE_CREATED_EVENT,
  true
> & {
  args: {
    assertionHash: `0x${string}`
    parentAssertionHash: `0x${string}`
    assertion: {
      wasmModuleRoot: `0x${string}`
      requiredStake: bigint
      challengeManager: `0x${string}`
      confirmPeriodBlocks: bigint
    }
  }
}

/** Type for assertion/node confirmation events */
export type ConfirmationEvent = Log<
  bigint,
  number,
  false,
  typeof ASSERTION_CONFIRMED_EVENT | typeof NODE_CONFIRMED_EVENT,
  true
> & {
  args: {
    blockHash: `0x${string}`
  }
}

/** Chain state information needed for monitoring */
export interface ChainState {
  childCurrentBlock: Block
  childLatestCreatedBlock?: Block
  childLatestConfirmedBlock?: Block
  parentCurrentBlock?: Block
  parentBlockAtCreation?: Block 
  parentBlockAtConfirmation?: Block
  recentCreationEvent: CreationEvent | null
  recentConfirmationEvent: ConfirmationEvent | null
  isValidatorWhitelistDisabled: boolean
  isBaseStakeBelowThreshold: boolean
  searchFromBlock?: bigint
  searchToBlock?: bigint
}

export type AssertionObservationKind =
  | 'assertion-rollup-config'
  | 'assertion-chain-state'
  | 'assertion-creation-event'
  | 'assertion-confirmation-event'

export interface AssertionObservation extends RawObservation {
  monitor: 'assertion'
  kind: AssertionObservationKind
}

export type AssertionMetricKey =
  | 'is_bold_enabled'
  | 'search_window_blocks'
  | 'latest_child_block_number'
  | 'latest_created_block_number'
  | 'latest_confirmed_block_number'
  | 'parent_blocks_since_confirmation'
  | 'parent_confirmation_threshold_blocks'
  | 'validator_whitelist_disabled'
  | 'base_stake_below_threshold'

export interface AssertionMetric extends RawMetric {
  monitor: 'assertion'
  key: AssertionMetricKey
}

export type AssertionFindingCode =
  | 'no_creation_events'
  | 'chain_activity_without_assertions'
  | 'no_confirmation_events'
  | 'no_confirmation_blocks_with_events'
  | 'confirmation_delay_exceeded'
  | 'creation_event_stuck'
  | 'non_bold_no_recent_creation'
  | 'validator_whitelist_disabled'
  | 'bold_low_base_stake'

export interface AssertionFinding extends DerivedFinding {
  monitor: 'assertion'
  code: AssertionFindingCode
}

export type AssertionMonitorResult = MonitorRunResult<
  AssertionObservation,
  AssertionMetric,
  AssertionFinding
>
