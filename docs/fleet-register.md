# Fleet Register Design

## Scope

This product path treats the portal chain list as the source of truth for chain inventory and limits indexed history to 8 days.

Current chain selection:

- portal snapshot: `orbitChainsData.json`
- network: mainnet only
- parents observed today: Ethereum, Base, Arbitrum One

## Current read models

The first pass indexes parent-chain events and exposes a fleet register API:

- batch deliveries from `SequencerInbox`
- assertion events from `Rollup`, with the event family selected from a generated rollup profile
- retryable creations from `Bridge.MessageDelivered(kind=9)`

The API materializes those into:

- chain inventory
- `R/B/A` health dots
- recent batches, assertions, and retryable creation rows
- fleet overview counts

## Why this is simpler than the old path

- the web app does not call chains
- the API only reads Postgres
- the indexer owns the portal snapshot and start-block generation
- the indexer owns rollup event-family detection and ABI selection
- the old polling worker is not part of the product path

## Rollup profiles

The portal refresh step now generates a chain profile for each rollup contract.

Current profile field:

- `rollupEventFamily`: `classic`, `bold`, or `unknown`

Detection strategy:

- fetch deployed rollup bytecode from the parent chain
- scan for the classic `NodeCreated` event selector
- scan for the BoLD `AssertionCreated` event selector
- persist the detected family into the generated portal snapshot
- use one shared BoLD event ABI definition for both selector generation and Ponder contract registration

Runtime behavior:

- `classic` chains register only classic node event sources
- `bold` chains register only BoLD assertion event sources
- `unknown` chains register both families as a fallback so indexing can still start

## Gaps still intentionally left open

### RPC uptime

Add a small probe process that pings every chain RPC every 5 to 10 minutes and writes one row per check:

- `chain_id`
- `checked_at`
- `ok`
- `latency_ms`
- optional `error_code`

The fleet API can then compute 8-day uptime directly from those rows and expose recent failures without touching the chain.

### Latency

Use the same probe table above.

- table column stays `latency_ms`
- fleet row shows the latest successful probe
- detail view can show the last N probe samples

### Retryable open count

The current table only indexes retryable creation events. To make `Open Retry` exact, add child-chain retryable lifecycle indexing on the `ArbRetryableTx` precompile:

- `TicketCreated`
- `RedeemScheduled`
- `LifetimeExtended`
- `Canceled`

That lets us compute:

- created in window
- expiring soon
- canceled
- latest timeout extension

The missing piece is redeemed state. The clean follow-up is a child-chain read model that joins `RedeemScheduled.retryTxHash` with transaction success so `Open Retry` becomes a real open set instead of a creation-side approximation.

### Pending out

Model this as pending L2 to L1 value that has been initiated on the child chain but not yet executed on the parent outbox.

Indexing plan:

- child chain: outbound message events from the Arbitrum system precompile path
- parent chain: outbox execution events
- read model: pending message set keyed by message identity

The primary UI number should be the native-token value still pending execution.

### Bridged TVL

Start with native-token balances only.

Indexing plan:

- derive canonical bridge contracts from the portal snapshot
- maintain token-to-balance mappings per chain
- for phase 1, track only the native token escrow balance that reflects bridged value
- later add ERC-20 gateway balances and token metadata pricing

## Questions to resolve next

1. Which exact contract balance should define native-token `Bridged TVL` for each chain: bridge escrow, inbox-facing escrow, or a chain-specific canonical balance?
2. Which child-chain outbound event shape should be the canonical source for `Pending Out` across rollup and AnyTrust chains?
3. Do we want the RPC probe data in the same Postgres schema as Ponder tables, or in separate app-owned tables in the same database?
4. Should the portal refresh script move parent RPC defaults into env vars before the Supabase-backed deployment pass?
