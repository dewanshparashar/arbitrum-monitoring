// Reconciles the real redemption status of indexed retryable tickets.
//
// The indexer only sees the parent-chain creation event (MessageDelivered kind
// 9) and assumes a flat 7-day life — it never observes whether a ticket was
// actually redeemed on the child chain. This module closes that gap using the
// exact primitive the reference retryable-monitor relies on: it rebuilds each
// parent→child message from the L1 creating transaction and asks the Arbitrum
// SDK for its live status (REDEEMED / EXPIRED / still pending).

import { providers } from 'ethers'
import {
  ParentTransactionReceipt,
  ParentToChildMessageStatus,
  registerCustomArbitrumNetwork,
  getArbitrumNetwork,
  type ArbitrumNetwork,
} from '@arbitrum/sdk'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// terminal = no point re-checking; pending = redeemable, recheck next cycle;
// unknown = not yet observable on the child chain (very recent), recheck.
export type RedemptionStatus =
  | 'redeemed' // REDEEMED — succeeded, nothing at risk
  | 'expired' // EXPIRED — timed out unredeemed, funds need manual recovery
  | 'failed' // CREATION_FAILED — ticket never created on the child
  | 'pending' // FUNDS_DEPOSITED_ON_CHILD — created, awaiting (re)redeem
  | 'unknown' // NOT_YET_CREATED — too recent to tell yet

export const TERMINAL_STATUSES: RedemptionStatus[] = ['redeemed', 'expired', 'failed']

const mapStatus = (status: ParentToChildMessageStatus): RedemptionStatus => {
  switch (status) {
    case ParentToChildMessageStatus.REDEEMED:
      return 'redeemed'
    case ParentToChildMessageStatus.EXPIRED:
      return 'expired'
    case ParentToChildMessageStatus.CREATION_FAILED:
      return 'failed'
    case ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD:
      return 'pending'
    default:
      return 'unknown' // NOT_YET_CREATED
  }
}

// The SDK keeps a global network registry; register each dedicated chain once.
const registered = new Set<number>()

const ensureRegistered = (chain: ChainConfig) => {
  if (registered.has(chain.chainId)) return
  try {
    getArbitrumNetwork(chain.chainId)
    registered.add(chain.chainId)
    return
  } catch {
    // not registered yet — fall through
  }
  const network: ArbitrumNetwork = {
    chainId: chain.chainId,
    name: chain.name,
    parentChainId: chain.parentChainId,
    isCustom: true,
    // not used for retryable status, but required by the type
    confirmPeriodBlocks: 45818,
    ethBridge: {
      bridge: chain.ethBridge.bridge,
      inbox: chain.ethBridge.inbox || ZERO_ADDRESS,
      sequencerInbox: chain.ethBridge.sequencerInbox,
      outbox: chain.ethBridge.outbox || ZERO_ADDRESS,
      rollup: chain.ethBridge.rollup,
    },
  }
  try {
    registerCustomArbitrumNetwork(network)
  } catch {
    // a concurrent register won the race — fine, it's now registered
  }
  registered.add(chain.chainId)
}

export type ChainConfig = {
  chainId: number
  parentChainId: number
  name: string
  rpcUrl: string
  ethBridge: {
    bridge: string
    rollup: string
    sequencerInbox: string
    inbox?: string | null
    outbox?: string | null
  }
}

export type ReconcileTicket = {
  id: string
  transactionHash: string
  messageIndex: string // inbox sequence number = SDK messageNumber
}

export type ReconcileResult = {
  id: string
  status: RedemptionStatus
  childTicketId: string | null
}

// Determines the live redemption status for a batch of tickets on one chain.
// Tickets are grouped by their parent creating tx so each L1 receipt is fetched
// once. A ticket whose status can't be read this cycle (RPC hiccup, receipt not
// yet available) is simply omitted — it stays unresolved and gets retried.
export const reconcileChainRedemptions = async (
  chain: ChainConfig,
  parentRpcUrl: string,
  tickets: ReconcileTicket[]
): Promise<ReconcileResult[]> => {
  if (!tickets.length) return []
  ensureRegistered(chain)

  const parentProvider = new providers.StaticJsonRpcProvider(parentRpcUrl, chain.parentChainId)
  const childProvider = new providers.StaticJsonRpcProvider(chain.rpcUrl, chain.chainId)

  const byTx = new Map<string, ReconcileTicket[]>()
  for (const ticket of tickets) {
    const list = byTx.get(ticket.transactionHash)
    if (list) list.push(ticket)
    else byTx.set(ticket.transactionHash, [ticket])
  }

  const results: ReconcileResult[] = []
  for (const [txHash, group] of byTx) {
    let messagesByNumber: Map<string, { status: () => Promise<ParentToChildMessageStatus>; retryableCreationId: string }>
    try {
      const receipt = await parentProvider.getTransactionReceipt(txHash)
      if (!receipt) continue
      const messages = await new ParentTransactionReceipt(receipt).getParentToChildMessages(
        childProvider
      )
      messagesByNumber = new Map(
        messages.map(message => [message.messageNumber.toString(), message])
      )
    } catch (error) {
      console.error(`[redemption] failed to read messages for ${chain.name} ${txHash}`, error)
      continue
    }

    for (const ticket of group) {
      const message = messagesByNumber.get(String(ticket.messageIndex))
      if (!message) continue
      try {
        const status = mapStatus(await message.status())
        results.push({
          id: ticket.id,
          status,
          childTicketId: message.retryableCreationId ?? null,
        })
      } catch (error) {
        console.error(`[redemption] status read failed for ticket ${ticket.id}`, error)
      }
    }
  }

  return results
}
