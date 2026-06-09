import { index, onchainTable } from 'ponder'

export const batchDeliveries = onchainTable(
  'batch_deliveries',
  t => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    chainName: t.text().notNull(),
    parentChainId: t.integer().notNull(),
    parentChainName: t.text().notNull(),
    parentBlockNumber: t.bigint().notNull(),
    parentBlockTimestamp: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    batchSequenceNumber: t.bigint().notNull(),
    dataLocation: t.integer().notNull(),
    minBlockNumber: t.bigint(),
    maxBlockNumber: t.bigint(),
    minTimestamp: t.bigint(),
    maxTimestamp: t.bigint(),
  }),
  table => [
    index('batch_deliveries_chain_time_idx').on(
      table.chainId,
      table.parentBlockTimestamp
    ),
  ]
)

export const assertionEvents = onchainTable(
  'assertion_events',
  t => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    chainName: t.text().notNull(),
    parentChainId: t.integer().notNull(),
    parentChainName: t.text().notNull(),
    parentBlockNumber: t.bigint().notNull(),
    parentBlockTimestamp: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    kind: t.text().notNull(),
    eventName: t.text().notNull(),
    assertionHash: t.hex(),
    blockHash: t.hex(),
    confirmPeriodBlocks: t.bigint(),
  }),
  table => [
    index('assertion_events_chain_time_idx').on(
      table.chainId,
      table.parentBlockTimestamp
    ),
  ]
)

export const retryableTickets = onchainTable(
  'retryable_tickets',
  t => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    chainName: t.text().notNull(),
    parentChainId: t.integer().notNull(),
    parentChainName: t.text().notNull(),
    parentBlockNumber: t.bigint().notNull(),
    parentBlockTimestamp: t.integer().notNull(),
    transactionHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    messageIndex: t.bigint().notNull(),
    sender: t.hex().notNull(),
    messageDataHash: t.hex().notNull(),
    expiresAt: t.integer().notNull(),
  }),
  table => [
    index('retryable_tickets_chain_time_idx').on(
      table.chainId,
      table.parentBlockTimestamp
    ),
  ]
)
