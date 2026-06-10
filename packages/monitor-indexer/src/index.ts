import { ponder } from 'ponder:registry'
import { assertionEvents, batchDeliveries, retryableTickets } from 'ponder:schema'
import { allSources } from './portal'

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60

for (const source of allSources) {
  if (source.kind === 'batch') {
    ponder.on(`${source.name}:SequencerBatchDelivered`, async ({ event, context }) => {
      await context.db
        .insert(batchDeliveries)
        .values({
          id: event.id,
          chainId: source.chain.chainId,
          chainName: source.chain.name,
          parentChainId: source.chain.parentChainId,
          parentChainName: source.parentChainName,
          parentBlockNumber: event.block.number,
          parentBlockTimestamp: Number(event.block.timestamp),
          transactionHash: event.transaction.hash,
          logIndex: event.log.logIndex,
          batchSequenceNumber: event.args.batchSequenceNumber,
          dataLocation: Number(event.args.dataLocation),
          minBlockNumber: event.args.timeBounds.minBlockNumber,
          maxBlockNumber: event.args.timeBounds.maxBlockNumber,
          minTimestamp: event.args.timeBounds.minTimestamp,
          maxTimestamp: event.args.timeBounds.maxTimestamp,
        })
        .onConflictDoNothing()
    })

    continue
  }

  if (source.kind === 'retryable') {
    ponder.on(`${source.name}:MessageDelivered`, async ({ event, context }) => {
      if (Number(event.args.kind) !== 9) {
        return
      }

      await context.db
        .insert(retryableTickets)
        .values({
          id: event.id,
          chainId: source.chain.chainId,
          chainName: source.chain.name,
          parentChainId: source.chain.parentChainId,
          parentChainName: source.parentChainName,
          parentBlockNumber: event.block.number,
          parentBlockTimestamp: Number(event.block.timestamp),
          transactionHash: event.transaction.hash,
          logIndex: event.log.logIndex,
          messageIndex: event.args.messageIndex,
          sender: event.args.sender,
          messageDataHash: event.args.messageDataHash,
          expiresAt: Number(event.block.timestamp) + SEVEN_DAYS_IN_SECONDS,
        })
        .onConflictDoNothing()
    })

    continue
  }

  if (source.kind === 'assertion_bold') {
    ponder.on(`${source.name}:AssertionCreated`, async ({ event, context }) => {
      await context.db
        .insert(assertionEvents)
        .values({
          id: event.id,
          chainId: source.chain.chainId,
          chainName: source.chain.name,
          parentChainId: source.chain.parentChainId,
          parentChainName: source.parentChainName,
          parentBlockNumber: event.block.number,
          parentBlockTimestamp: Number(event.block.timestamp),
          transactionHash: event.transaction.hash,
          logIndex: event.log.logIndex,
          kind: 'created',
          eventName: 'AssertionCreated',
          assertionHash: event.args.assertionHash,
          blockHash: null,
          confirmPeriodBlocks: event.args.assertion.beforeStateData.configData.confirmPeriodBlocks,
        })
        .onConflictDoNothing()
    })

    ponder.on(`${source.name}:AssertionConfirmed`, async ({ event, context }) => {
      await context.db
        .insert(assertionEvents)
        .values({
          id: event.id,
          chainId: source.chain.chainId,
          chainName: source.chain.name,
          parentChainId: source.chain.parentChainId,
          parentChainName: source.parentChainName,
          parentBlockNumber: event.block.number,
          parentBlockTimestamp: Number(event.block.timestamp),
          transactionHash: event.transaction.hash,
          logIndex: event.log.logIndex,
          kind: 'confirmed',
          eventName: 'AssertionConfirmed',
          assertionHash: event.args.assertionHash,
          blockHash: event.args.blockHash,
          confirmPeriodBlocks: null,
        })
        .onConflictDoNothing()
    })

    continue
  }

  ponder.on(`${source.name}:NodeCreated`, async ({ event, context }) => {
    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: source.chain.chainId,
        chainName: source.chain.name,
        parentChainId: source.chain.parentChainId,
        parentChainName: source.parentChainName,
        parentBlockNumber: event.block.number,
        parentBlockTimestamp: Number(event.block.timestamp),
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        kind: 'created',
        eventName: 'NodeCreated',
        assertionHash: null,
        blockHash: null,
        confirmPeriodBlocks: null,
      })
      .onConflictDoNothing()
  })

  ponder.on(`${source.name}:NodeConfirmed`, async ({ event, context }) => {
    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: source.chain.chainId,
        chainName: source.chain.name,
        parentChainId: source.chain.parentChainId,
        parentChainName: source.parentChainName,
        parentBlockNumber: event.block.number,
        parentBlockTimestamp: Number(event.block.timestamp),
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        kind: 'confirmed',
        eventName: 'NodeConfirmed',
        assertionHash: null,
        blockHash: event.args.blockHash,
        confirmPeriodBlocks: null,
      })
      .onConflictDoNothing()
  })
}
