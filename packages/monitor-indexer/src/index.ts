import { ponder } from 'ponder:registry'
import { assertionEvents, batchDeliveries, retryableTickets } from 'ponder:schema'
import { sourceMetaByName } from './portal'

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60

const getSourceMeta = (eventName: string) => {
  const sourceName = eventName.split(/[:.]/)[0]!
  const meta = sourceMetaByName[sourceName]

  if (!meta) {
    throw new Error(`Unknown source ${sourceName}`)
  }

  return meta
}

for (const sourceName of Object.keys(sourceMetaByName)) {
  const source = sourceMetaByName[sourceName]

  if (source.kind === 'batch') {
    ponder.on(`${sourceName}:SequencerBatchDelivered`, async ({ event, context }) => {
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
    ponder.on(`${sourceName}:MessageDelivered`, async ({ event, context }) => {
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

  ponder.on(`${sourceName}:AssertionCreated`, async ({ event, context }) => {
    const meta = getSourceMeta(`${sourceName}:AssertionCreated`)

    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: meta.chain.chainId,
        chainName: meta.chain.name,
        parentChainId: meta.chain.parentChainId,
        parentChainName: meta.parentChainName,
        parentBlockNumber: event.block.number,
        parentBlockTimestamp: Number(event.block.timestamp),
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        kind: 'created',
        eventName: 'AssertionCreated',
        assertionHash: event.args.assertionHash,
        blockHash: null,
        confirmPeriodBlocks: event.args.assertion.confirmPeriodBlocks,
      })
      .onConflictDoNothing()
  })

  ponder.on(`${sourceName}:AssertionConfirmed`, async ({ event, context }) => {
    const meta = getSourceMeta(`${sourceName}:AssertionConfirmed`)

    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: meta.chain.chainId,
        chainName: meta.chain.name,
        parentChainId: meta.chain.parentChainId,
        parentChainName: meta.parentChainName,
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

  ponder.on(`${sourceName}:NodeCreated`, async ({ event, context }) => {
    const meta = getSourceMeta(`${sourceName}:NodeCreated`)

    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: meta.chain.chainId,
        chainName: meta.chain.name,
        parentChainId: meta.chain.parentChainId,
        parentChainName: meta.parentChainName,
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

  ponder.on(`${sourceName}:NodeConfirmed`, async ({ event, context }) => {
    const meta = getSourceMeta(`${sourceName}:NodeConfirmed`)

    await context.db
      .insert(assertionEvents)
      .values({
        id: event.id,
        chainId: meta.chain.chainId,
        chainName: meta.chain.name,
        parentChainId: meta.chain.parentChainId,
        parentChainName: meta.parentChainName,
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
