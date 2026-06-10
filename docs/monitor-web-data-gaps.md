# monitor-web — data gaps

The console UI (`packages/monitor-web`) is a faithful build of the Claude Design
"Console Monitor" mock, wired to the **live** monitor-api. Everything the
indexer (`monitor-indexer`) and worker (`monitor-metrics`) currently produce is
shown for real. This doc tracks the fields the design surfaces that the backend
does **not** produce yet, so we can close them one by one.

In the UI these fields render as a muted, dotted `n/a` with a tooltip pointing
here — they are never faked.

## How the UI maps to today's API

The R/B/A monitor triad, the row status glyph, and the synthesized
`alerts.firing` feed are driven **directly** by the decision-tree statuses the
API already computes (`health.retryable` / `health.batch` / `health.assertion`
in `packages/monitor-api/fleetDb.ts`, which encode the thresholds documented in
the reference monitors' READMEs). The UI does not re-derive its own heuristics.

Practical substitutions already made (no backend change needed):

- **RPC uptime**: the design's fixed "90-day" strip is replaced by the actual
  probe history we have. The inspector renders one bar per indexed
  `rpc_checks` row and labels the range from the oldest probe's timestamp
  (`fetchChainDetail` → `recentRpcChecks`). The fleet table shows the rolling
  uptime % over the indexer's 8-day window.
- **AnyTrust committee fallback**: detected from `batch_deliveries.data_location`
  — `0` (on-chain calldata) on an AnyTrust chain is shown as
  `calldata (DAC fallback)`, mirroring the batch-poster monitor's 0x00-prefix
  check.
- **Retryable lifecycle state**: derived from `retryable_tickets.expires_at`
  (Expired / Expiring <2d / Pending) since per-ticket redemption state isn't
  indexed.

## Gaps by panel

### bridge.flow
| Field | Status | Where it would come from |
| --- | --- | --- |
| Bridged TVL (native) | ✅ live | `native_balance_snapshots` × `asset_prices` |
| Pending withdrawals (USD + count) | ✅ live | `exit_messages` (worker) — empty until the worker populates it |
| Net 24h flow | ✅ live | balance delta vs 24h-ago snapshot |
| **ETH vs ERC-20 split** | ❌ gap | needs token-gateway deposit indexing (`DepositInitiated` / gateway `Transfer` correlation); today only aggregate native balance is tracked |
| **Lifetime ETH bridged in** | ❌ gap | needs cumulative deposit indexing, not just current balance |

### rpc.uptime
| Field | Status | Notes |
| --- | --- | --- |
| Uptime %, probe history, latency p50, status | ✅ live | `rpc_checks` (worker) |
| Heartbeat sparkline in the **fleet table** | ⚠️ partial | the `/api/fleet/chains` list returns only the aggregate `rpcScore`, not a per-chain history array, so the table heartbeat reflects the current uptime band rather than recent buckets. Per-probe history is shown in the inspector. To fully close: add a small recent-history array (e.g. last N buckets) to the chains endpoint. |

### batch.poster
| Field | Status | Where it would come from |
| --- | --- | --- |
| Last batch age, target, seq #, data location | ✅ live | `batch_deliveries` |
| Batch poster EOA | ✅ live | worker reads the `from` of the most recent indexed batch tx on the parent chain → `chain_runtime.batch_poster` |
| Poster balance | ✅ live | worker `eth_getBalance(batchPoster)` on the parent chain each cycle → `chain_runtime.poster_balance_wei` |
| Block backlog | ✅ live | `child_head_block − latest batch max_block_number` (worker samples child head; indexer provides the batch's max block) |
| Runway (days, estimate) | ✅ live | poster balance ÷ estimated daily gas burn (avg fee of the last few batch-tx receipts × batches posted in 24h) → `chain_runtime.daily_burn_wei` |
| **Compression ratio** | ❌ gap | needs batch calldata size vs decompressed size (brotli) per batch |
| **DAC committee online/total** | ❌ gap | needs DAC keyset / committee health probing for AnyTrust chains |

### assertion.health
| Field | Status | Where it would come from |
| --- | --- | --- |
| Last assertion age, created/confirmed counts | ✅ live | `assertion_events` |
| Confirm period (blocks) | ✅ live | portal snapshot `confirmPeriodBlocks` (inspector detail) |
| Dispute mode (BoLD/Classic) | ✅ live | inferred from latest assertion event name |
| Whitelist status (permissionless / whitelisted) | ✅ live | worker `Rollup.validatorWhitelistDisabled()` read → `chain_runtime.validator_whitelist_disabled` |
| Base stake | ✅ live | worker `Rollup.baseStake()` read → `chain_runtime.base_stake_wei` (BoLD <1 ETH highlighted) |
| **Validator count / set** | ❌ gap | enumerating the validator set is rollup-version-dependent; only the whitelist flag is read |

### retryable.tickets
| Field | Status | Where it would come from |
| --- | --- | --- |
| Open / expiring / expired counts, ticket list | ✅ live | `retryable_tickets` |
| **Triage state** (Untriaged / Investigating / Resolved) | ❌ gap | lives in the Notion board the reference retryable-monitor syncs to; not indexed |
| **Redeemed / failed in 24h** | ❌ gap | needs child-chain redemption events (`RedeemScheduled` / `TicketRedeemed` / `AutoRedemptionFailed`) indexed |
| Per-ticket value / callvalue / token deposit | ❌ gap | not in the current `retryable_tickets` columns |

### contracts
| Field | Status | Notes |
| --- | --- | --- |
| rollup, sequencerInbox, bridge, inbox, outbox | ✅ live | portal snapshot `ethBridge` (inbox/outbox now carried through `pickChain`) |
| batchPoster | ✅ live | `chain_runtime.batch_poster` — derived from recent batch tx senders (worker) |

## Suggested backend follow-ups (rough priority)

1. **exit_messages population** in the worker — pending-withdrawals is wired but
   empty until this lands.
2. **Batch-poster balance + runway** — highest-signal operational metric missing.
3. **Child-chain redemption events** — unlocks retryable redeemed/failed and a
   truer retryable lifecycle.
4. **Per-chain RPC history array** on `/api/fleet/chains` — makes the fleet-table
   heartbeat real.
5. **Outbox/inbox/batchPoster addresses** into the portal snapshot — trivial,
   completes the contracts panel.
6. Validator set / base stake / DAC committee reads — richer assertion & batch
   security signal.

## Logic audit & hardening (applied)

A pass over the worker (`monitor-metrics`) and the API's derivations:

- **TVL is now measured in the chain's actual bridged asset (Part A).** For
  ETH-native chains the canonical bridge balance is ETH (priced via CoinGecko).
  For the 19 custom-gas-token chains the bridge locks an ERC-20 (the native
  token), so the worker reads `nativeToken.balanceOf(bridge)` + `decimals()` at
  the snapshot block and stores it under the token's `asset_key`/`decimals`
  instead of mis-reading ETH. The API is decimals-aware (`toUsd(wei, price,
  decimals)`) and the UI shows the native amount + symbol, with **USD only
  where a price feed exists for that token** — otherwise an honest `n/a` USD
  with the native amount shown. **Part B (per-token USD pricing) is the
  remaining gap:** there's no universal oracle for arbitrary gas tokens, so
  custom-gas-token TVL is currently native-denominated only. Fleet-wide
  `totalTvlUsd` therefore reflects priced (ETH) chains only.
- **Balance ↔ block consistency.** Balances are now read *at the recorded block*
  (`eth_getBalance(addr, <block>)`) instead of `'latest'`, so `balance_wei` and
  `block_number` always refer to the same block (the head could advance between
  the two calls before).
- **Price sanity guard.** Implausible ETH prices (≤ 0, non-finite, or
  > $10,000,000) are rejected rather than poisoning fleet-wide TVL. Price
  freshness (`priceCheckedAt`) is surfaced in the UI so staleness is visible.
- **Per-stage + per-chain isolation.** Each worker cycle stage (rpc checks,
  balances, price, exit sync, prune) is isolated; a failure in one no longer
  aborts the others. Within balance sync, each chain is wrapped so one bad RPC
  doesn't drop the whole fleet's snapshots. Failed stages are reported in the
  worker heartbeat (`status: 'error'`, surfaced in `/api/fleet/status`).
- **Retries with backoff on data calls only.** `eth_getBalance` /
  `eth_blockNumber` / `eth_getLogs` / `eth_call` retry transient failures
  (2× linear backoff). **Reachability probes deliberately do NOT retry** —
  retrying would mask real outages and inflate uptime.
- **Indexer freshness is version-independent.** Rather than decode Ponder's
  internal `_ponder_checkpoint` (opaque, version-specific), `/api/fleet/status`
  derives indexer freshness from the newest indexed parent-chain event
  timestamp — a tight proxy on active chains (batches post every few minutes).
