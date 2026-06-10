import { Pool } from 'pg'
import yargs from 'yargs'
import { getMainnetChains, getParentRpcUrls, type PortalMainnetChain } from './portal'
import {
  arbSysAddress,
  decodeL2ToL1Log,
  decodeOutboxLog,
  findBlockByTimestamp,
  getArbOsVersionRaw,
  getBalance,
  getBlockNumber,
  getBlockTxStats,
  getErc20Balance,
  getErc20Decimals,
  getLogs,
  getRollupBaseStake,
  getTransactionFeeWei,
  getTransactionSender,
  getValidatorWhitelistDisabled,
  l2ToL1Topic,
  outboxExecutedTopic,
  probeRpc,
  readActiveOutbox,
} from './rpc'

const eightDaysSeconds = 8 * 24 * 60 * 60
const zeroAddress = '0x0000000000000000000000000000000000000000'

const readConfig = () =>
  yargs(process.argv.slice(2))
    .options({
      postgresUrl: { type: 'string', default: process.env.POSTGRES_URL },
      databaseSchema: {
        type: 'string',
        default: process.env.DATABASE_SCHEMA || 'public',
      },
      intervalSeconds: {
        type: 'number',
        default: Number(process.env.MONITOR_METRICS_INTERVAL_SECONDS || 300),
      },
      logChunkSize: {
        type: 'number',
        default: Number(process.env.MONITOR_METRICS_LOG_CHUNK_SIZE || 10000),
      },
    })
    .strict()
    .parseSync()

const normalizeSchemaName = (value: string) => {
  const schema = value.trim() || 'public'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid database schema "${value}"`)
  }

  return schema
}

const tableName = (schemaName: string, table: string) => `"${schemaName}"."${table}"`

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class MetricsDb {
  private readonly pool: Pool
  private readonly schemaName: string

  private readonly stateTable: string
  private readonly rpcChecksTable: string
  private readonly balanceSnapshotsTable: string
  private readonly pricesTable: string
  private readonly exitsTable: string
  private readonly chainRuntimeTable: string
  private readonly batchDeliveriesTable: string

  constructor(connectionString: string, schemaName: string) {
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 3),
    })
    this.schemaName = normalizeSchemaName(schemaName)
    this.stateTable = tableName(this.schemaName, 'metric_worker_state')
    this.rpcChecksTable = tableName(this.schemaName, 'rpc_checks')
    this.balanceSnapshotsTable = tableName(this.schemaName, 'native_balance_snapshots')
    this.pricesTable = tableName(this.schemaName, 'asset_prices')
    this.exitsTable = tableName(this.schemaName, 'exit_messages')
    this.chainRuntimeTable = tableName(this.schemaName, 'chain_runtime')
    // indexer-owned table, read-only here, to find recent batch tx hashes
    this.batchDeliveriesTable = tableName(this.schemaName, 'batch_deliveries')
  }

  async init() {
    await this.pool.query(`create schema if not exists "${this.schemaName}"`)
    await this.pool.query(`
      create table if not exists ${this.stateTable} (
        key text primary key,
        value text not null,
        updated_at timestamptz not null default now()
      )
    `)
    await this.pool.query(`
      create table if not exists ${this.rpcChecksTable} (
        id bigserial primary key,
        chain_id bigint not null,
        checked_at timestamptz not null,
        ok boolean not null,
        latency_ms integer,
        error_code text
      )
    `)
    await this.pool.query(`
      create table if not exists ${this.balanceSnapshotsTable} (
        id bigserial primary key,
        chain_id bigint not null,
        asset_key text not null,
        block_number numeric(78, 0) not null,
        balance_wei numeric(78, 0) not null,
        decimals integer not null default 18,
        checked_at timestamptz not null
      )
    `)
    // backfill the decimals column for tables created before it existed
    await this.pool.query(
      `alter table ${this.balanceSnapshotsTable} add column if not exists decimals integer not null default 18`
    )
    await this.pool.query(`
      create table if not exists ${this.pricesTable} (
        id bigserial primary key,
        asset_key text not null,
        price_usd numeric(20, 8) not null,
        checked_at timestamptz not null
      )
    `)
    await this.pool.query(`
      create table if not exists ${this.exitsTable} (
        id text primary key,
        chain_id bigint not null,
        parent_chain_id bigint not null,
        position numeric(78, 0) not null,
        value_wei numeric(78, 0) not null,
        started_at timestamptz not null,
        started_tx_hash text not null,
        child_block_number numeric(78, 0) not null,
        child_log_index integer not null,
        executed_at timestamptz,
        executed_tx_hash text
      )
    `)
    // current per-chain runtime metadata read on-chain (ArbOS version, active
    // batch poster). One row per chain, upserted each cycle.
    await this.pool.query(`
      create table if not exists ${this.chainRuntimeTable} (
        chain_id bigint primary key,
        arbos_raw integer,
        arbos_version integer,
        arbos_name text,
        batch_poster text,
        tps double precision,
        poster_balance_wei numeric(78, 0),
        base_stake_wei numeric(78, 0),
        validator_whitelist_disabled boolean,
        child_head_block numeric(78, 0),
        checked_at timestamptz not null
      )
    `)
    await this.pool.query(
      `alter table ${this.chainRuntimeTable} add column if not exists batch_poster text`
    )
    await this.pool.query(
      `alter table ${this.chainRuntimeTable} add column if not exists tps double precision`
    )
    for (const col of [
      'poster_balance_wei numeric(78, 0)',
      'base_stake_wei numeric(78, 0)',
      'validator_whitelist_disabled boolean',
      'child_head_block numeric(78, 0)',
      'daily_burn_wei numeric(78, 0)',
    ]) {
      await this.pool.query(`alter table ${this.chainRuntimeTable} add column if not exists ${col}`)
    }
  }

  async getState(key: string) {
    const result = await this.pool.query<{ value: string }>(
      `select value from ${this.stateTable} where key = $1`,
      [key]
    )
    return result.rows[0]?.value ?? null
  }

  async setState(key: string, value: string) {
    await this.pool.query(
      `
        insert into ${this.stateTable} (key, value, updated_at)
        values ($1, $2, now())
        on conflict (key) do update
        set value = excluded.value,
            updated_at = excluded.updated_at
      `,
      [key, value]
    )
  }

  async insertRpcCheck(row: {
    chainId: number
    checkedAt: string
    ok: boolean
    latencyMs: number | null
    errorCode: string | null
  }) {
    await this.pool.query(
      `
        insert into ${this.rpcChecksTable}
          (chain_id, checked_at, ok, latency_ms, error_code)
        values ($1, $2, $3, $4, $5)
      `,
      [row.chainId, row.checkedAt, row.ok, row.latencyMs, row.errorCode]
    )
  }

  async insertBalanceSnapshot(row: {
    chainId: number
    assetKey: string
    blockNumber: string
    balanceWei: string
    decimals: number
    checkedAt: string
  }) {
    await this.pool.query(
      `
        insert into ${this.balanceSnapshotsTable}
          (chain_id, asset_key, block_number, balance_wei, decimals, checked_at)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        row.chainId,
        row.assetKey,
        row.blockNumber,
        row.balanceWei,
        row.decimals,
        row.checkedAt,
      ]
    )
  }

  async insertPrice(row: { assetKey: string; priceUsd: number; checkedAt: string }) {
    await this.pool.query(
      `
        insert into ${this.pricesTable} (asset_key, price_usd, checked_at)
        values ($1, $2, $3)
      `,
      [row.assetKey, row.priceUsd, row.checkedAt]
    )
  }

  // Upserts the ArbOS columns; leaves batch_poster untouched (set separately).
  async upsertChainArbos(row: {
    chainId: number
    arbosRaw: number | null
    arbosVersion: number | null
    arbosName: string | null
    checkedAt: string
  }) {
    await this.pool.query(
      `
        insert into ${this.chainRuntimeTable}
          (chain_id, arbos_raw, arbos_version, arbos_name, checked_at)
        values ($1, $2, $3, $4, $5)
        on conflict (chain_id) do update
        set arbos_raw = excluded.arbos_raw,
            arbos_version = excluded.arbos_version,
            arbos_name = excluded.arbos_name,
            checked_at = excluded.checked_at
      `,
      [row.chainId, row.arbosRaw, row.arbosVersion, row.arbosName, row.checkedAt]
    )
  }

  // Recent batch tx hashes (newest first) + how many batches posted in the last
  // 24h — inputs for resolving the poster and estimating its daily gas burn.
  async getBatchBurnSample(chainId: number, limit: number) {
    try {
      const [recent, count] = await Promise.all([
        this.pool.query<{ transaction_hash: string }>(
          `
            select transaction_hash
            from ${this.batchDeliveriesTable}
            where chain_id = $1
            order by parent_block_number desc, log_index desc
            limit $2
          `,
          [chainId, limit]
        ),
        this.pool.query<{ n: number }>(
          `
            select count(*)::int as n
            from ${this.batchDeliveriesTable}
            where chain_id = $1
              and parent_block_timestamp >= cast(extract(epoch from now()) as bigint) - 86400
          `,
          [chainId]
        ),
      ])
      return {
        hashes: recent.rows.map(r => r.transaction_hash),
        count24h: count.rows[0]?.n ?? 0,
      }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') {
        return { hashes: [] as string[], count24h: 0 }
      }
      throw error
    }
  }

  // Batch poster EOA + its parent-chain balance + estimated 24h gas burn (wei).
  async upsertChainBatchPoster(row: {
    chainId: number
    batchPoster: string
    posterBalanceWei: string | null
    dailyBurnWei: string | null
    checkedAt: string
  }) {
    await this.pool.query(
      `
        insert into ${this.chainRuntimeTable} (chain_id, batch_poster, poster_balance_wei, daily_burn_wei, checked_at)
        values ($1, $2, $3, $4, $5)
        on conflict (chain_id) do update
        set batch_poster = excluded.batch_poster,
            poster_balance_wei = excluded.poster_balance_wei,
            daily_burn_wei = excluded.daily_burn_wei,
            checked_at = excluded.checked_at
      `,
      [row.chainId, row.batchPoster, row.posterBalanceWei, row.dailyBurnWei, row.checkedAt]
    )
  }

  // Rollup security params read on-chain (base stake, validator whitelist).
  async upsertChainAssertion(row: {
    chainId: number
    baseStakeWei: string | null
    validatorWhitelistDisabled: boolean | null
    checkedAt: string
  }) {
    await this.pool.query(
      `
        insert into ${this.chainRuntimeTable} (chain_id, base_stake_wei, validator_whitelist_disabled, checked_at)
        values ($1, $2, $3, $4)
        on conflict (chain_id) do update
        set base_stake_wei = excluded.base_stake_wei,
            validator_whitelist_disabled = excluded.validator_whitelist_disabled,
            checked_at = excluded.checked_at
      `,
      [row.chainId, row.baseStakeWei, row.validatorWhitelistDisabled, row.checkedAt]
    )
  }

  // TPS + child-chain head block (sampled per cycle).
  async upsertChainTps(row: {
    chainId: number
    tps: number | null
    childHeadBlock: string | null
    checkedAt: string
  }) {
    await this.pool.query(
      `
        insert into ${this.chainRuntimeTable} (chain_id, tps, child_head_block, checked_at)
        values ($1, $2, $3, $4)
        on conflict (chain_id) do update
        set tps = excluded.tps,
            child_head_block = excluded.child_head_block,
            checked_at = excluded.checked_at
      `,
      [row.chainId, row.tps, row.childHeadBlock, row.checkedAt]
    )
  }

  async upsertExit(row: {
    id: string
    chainId: number
    parentChainId: number
    position: string
    valueWei: string
    startedAt: string
    startedTxHash: string
    childBlockNumber: string
    childLogIndex: number
  }) {
    await this.pool.query(
      `
        insert into ${this.exitsTable}
          (
            id,
            chain_id,
            parent_chain_id,
            position,
            value_wei,
            started_at,
            started_tx_hash,
            child_block_number,
            child_log_index
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do nothing
      `,
      [
        row.id,
        row.chainId,
        row.parentChainId,
        row.position,
        row.valueWei,
        row.startedAt,
        row.startedTxHash,
        row.childBlockNumber,
        row.childLogIndex,
      ]
    )
  }

  async markExitExecuted(row: {
    chainId: number
    position: string
    executedAt: string
    executedTxHash: string
  }) {
    await this.pool.query(
      `
        update ${this.exitsTable}
        set executed_at = $3,
            executed_tx_hash = $4
        where chain_id = $1
          and position = $2
          and executed_at is null
      `,
      [row.chainId, row.position, row.executedAt, row.executedTxHash]
    )
  }

  async prune() {
    await this.pool.query(
      `delete from ${this.rpcChecksTable} where checked_at < now() - interval '8 days'`
    )
    await this.pool.query(
      `delete from ${this.balanceSnapshotsTable} where checked_at < now() - interval '8 days'`
    )
    await this.pool.query(
      `delete from ${this.pricesTable} where checked_at < now() - interval '8 days'`
    )
    await this.pool.query(
      `delete from ${this.exitsTable} where started_at < now() - interval '8 days'`
    )
  }

  async close() {
    await this.pool.end()
  }
}

const readJson = async <T>(url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`http_${response.status}`)
  }

  return (await response.json()) as T
}

const fetchEthereumPriceUsd = async () => {
  const body = await readJson<{ ethereum?: { usd?: number } }>(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
  )
  const priceUsd = body.ethereum?.usd
  return typeof priceUsd === 'number' ? priceUsd : null
}

const readCursor = async ({
  db,
  key,
  rpcUrl,
  fallbackSeconds,
}: {
  db: MetricsDb
  key: string
  rpcUrl: string
  fallbackSeconds: number
}) => {
  const existing = await db.getState(key)
  if (existing) {
    return BigInt(existing)
  }

  const block = await findBlockByTimestamp(rpcUrl, fallbackSeconds)
  await db.setState(key, block.toString())
  return block
}

const syncRpcChecks = async (db: MetricsDb) => {
  const checkedAt = new Date().toISOString()
  const chains = getMainnetChains()

  await Promise.all(
    chains.map(async chain => {
      const probe = await probeRpc(chain.rpcUrl)
      await db.insertRpcCheck({
        chainId: chain.chainId,
        checkedAt,
        ok: probe.ok,
        latencyMs: probe.latencyMs,
        errorCode: probe.errorCode,
      })
    })
  )
}

const isCustomGasToken = (token: string | undefined): token is string =>
  typeof token === 'string' && token.toLowerCase() !== zeroAddress

const syncBalances = async (db: MetricsDb) => {
  const checkedAt = new Date().toISOString()
  const parentRpcUrls = getParentRpcUrls()
  const parentBlocks = new Map<number, bigint>()

  await Promise.all(
    getMainnetChains().map(async chain => {
      // isolate per-chain so one failing RPC doesn't drop the whole cycle's snapshots
      try {
        const parentRpcUrl = parentRpcUrls[chain.parentChainId]
        if (!parentRpcUrl) {
          return
        }

        let blockNumber = parentBlocks.get(chain.parentChainId)
        if (blockNumber === undefined) {
          blockNumber = await getBlockNumber(parentRpcUrl)
          parentBlocks.set(chain.parentChainId, blockNumber)
        }

        const bridge = chain.ethBridge.bridge as `0x${string}`

        // Custom-gas-token chains lock an ERC-20 (the native token) in the
        // bridge, not ETH — so we must read THAT token's balance + decimals to
        // measure the real bridged value. ETH-native chains read ETH directly.
        if (isCustomGasToken(chain.nativeToken)) {
          const token = chain.nativeToken as `0x${string}`
          const [balanceWei, decimals] = await Promise.all([
            getErc20Balance(parentRpcUrl, token, bridge, blockNumber),
            getErc20Decimals(parentRpcUrl, token),
          ])
          await db.insertBalanceSnapshot({
            chainId: chain.chainId,
            assetKey: chain.nativeTokenSymbol || token.toLowerCase(),
            blockNumber: blockNumber.toString(),
            balanceWei: balanceWei.toString(),
            decimals,
            checkedAt,
          })
          return
        }

        // read the balance AT the recorded block so balance_wei and
        // block_number are consistent (head can advance between calls)
        const balanceWei = await getBalance(parentRpcUrl, bridge, blockNumber)
        await db.insertBalanceSnapshot({
          chainId: chain.chainId,
          assetKey: 'ethereum',
          blockNumber: blockNumber.toString(),
          balanceWei: balanceWei.toString(),
          decimals: 18,
          checkedAt,
        })
      } catch (error) {
        console.error(`balance sync failed for ${chain.slug}`, error)
      }
    })
  )
}

// ETH/USD is the only priced asset today; guard against absurd values so a
// bad upstream response can't poison TVL across the whole fleet.
const PRICE_SANITY_CEILING_USD = 10_000_000

const syncEthereumPrice = async (db: MetricsDb) => {
  const priceUsd = await fetchEthereumPriceUsd()
  if (priceUsd === null) {
    return
  }

  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > PRICE_SANITY_CEILING_USD) {
    console.error(`rejecting implausible ethereum price: ${priceUsd}`)
    return
  }

  await db.insertPrice({
    assetKey: 'ethereum',
    priceUsd,
    checkedAt: new Date().toISOString(),
  })
}

const syncChildExitLogs = async ({
  db,
  chain,
  chunkSize,
  oldestSeconds,
}: {
  db: MetricsDb
  chain: PortalMainnetChain
  chunkSize: number
  oldestSeconds: number
}) => {
  const stateKey = `child_exit_cursor:${chain.chainId}`
  let fromBlock = await readCursor({
    db,
    key: stateKey,
    rpcUrl: chain.rpcUrl,
    fallbackSeconds: oldestSeconds,
  })
  const cursorStart = fromBlock
  const latestBlock = await getBlockNumber(chain.rpcUrl)

  while (fromBlock <= latestBlock) {
    const toBlock = fromBlock + BigInt(chunkSize - 1)
    const endBlock = toBlock < latestBlock ? toBlock : latestBlock
    const logs = await getLogs({
      rpcUrl: chain.rpcUrl,
      address: arbSysAddress,
      topic: l2ToL1Topic,
      fromBlock,
      toBlock: endBlock,
    })

    for (const log of logs) {
      const decoded = decodeL2ToL1Log(log)
      if (decoded.value <= 0n) {
        continue
      }

      await db.upsertExit({
        id: `${chain.chainId}:${decoded.position}`,
        chainId: chain.chainId,
        parentChainId: chain.parentChainId,
        position: decoded.position.toString(),
        valueWei: decoded.value.toString(),
        startedAt: new Date(decoded.startedAt * 1000).toISOString(),
        startedTxHash: decoded.transactionHash,
        childBlockNumber: decoded.blockNumber.toString(),
        childLogIndex: decoded.logIndex,
      })
    }

    fromBlock = endBlock + 1n
    await db.setState(stateKey, fromBlock.toString())
  }

  return {
    chainId: chain.chainId,
    chainSlug: chain.slug,
    headBlock: Number(latestBlock),
    cursorBlock: Number(cursorStart),
    lagBlocks: Math.max(0, Number(latestBlock - cursorStart)),
  }
}

const syncParentExitExecutions = async ({
  db,
  chain,
  chunkSize,
  oldestSeconds,
}: {
  db: MetricsDb
  chain: PortalMainnetChain
  chunkSize: number
  oldestSeconds: number
}) => {
  const parentRpcUrl = getParentRpcUrls()[chain.parentChainId]
  if (!parentRpcUrl) {
    return
  }

  const outbox = await readActiveOutbox(
    parentRpcUrl,
    chain.ethBridge.bridge as `0x${string}`
  )
  if (!outbox || outbox.toLowerCase() === zeroAddress) {
    return
  }

  const stateKey = `parent_exit_cursor:${chain.chainId}`
  let fromBlock = await readCursor({
    db,
    key: stateKey,
    rpcUrl: parentRpcUrl,
    fallbackSeconds: oldestSeconds,
  })
  const latestBlock = await getBlockNumber(parentRpcUrl)

  while (fromBlock <= latestBlock) {
    const toBlock = fromBlock + BigInt(chunkSize - 1)
    const endBlock = toBlock < latestBlock ? toBlock : latestBlock
    const logs = await getLogs({
      rpcUrl: parentRpcUrl,
      address: outbox,
      topic: outboxExecutedTopic,
      fromBlock,
      toBlock: endBlock,
    })

    for (const log of logs) {
      const decoded = decodeOutboxLog(log)
      await db.markExitExecuted({
        chainId: chain.chainId,
        position: decoded.position.toString(),
        executedAt: new Date().toISOString(),
        executedTxHash: decoded.transactionHash,
      })
    }

    fromBlock = endBlock + 1n
    await db.setState(stateKey, fromBlock.toString())
  }
}

// Chains whose RPC refuses eth_getLogs (HTTP 4xx) are warned about once, then
// suppressed — the exit_messages backlog is a best-effort, lowest-priority
// signal and these RPCs simply don't serve logs.
const exitSyncWarned = new Set<number>()

const syncExitMessages = async (db: MetricsDb, chunkSize: number) => {
  const oldestSeconds = Math.floor(Date.now() / 1000) - eightDaysSeconds
  const backlog: unknown[] = []

  for (const chain of getMainnetChains()) {
    try {
      const info = await syncChildExitLogs({ db, chain, chunkSize, oldestSeconds })
      if (info) backlog.push(info)
      await syncParentExitExecutions({ db, chain, chunkSize, oldestSeconds })
      exitSyncWarned.delete(chain.chainId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!exitSyncWarned.has(chain.chainId)) {
        exitSyncWarned.add(chain.chainId)
        console.warn(
          `exit sync unavailable for ${chain.slug} (${message}) — its RPC rejected eth_getLogs; suppressing further warnings`
        )
      }
    }
  }

  try {
    await db.setState('exit_backlog', JSON.stringify(backlog))
  } catch (error) {
    console.error('failed to record exit backlog', error)
  }
}

// arbOSVersion() returns 55 + the actual ArbOS version (documented quirk), so
// subtract the offset. Names: exact known releases, else family-by-decade
// (20s Atlas, 30s Bianca, 40s Callisto, 50s Dia, 60s Elara — see
// docs.arbitrum.io/run-arbitrum-node/arbos-releases/overview).
const ARBOS_VERSION_OFFSET = 55
const ARBOS_RELEASE_NAMES: Record<number, string> = {
  20: 'Atlas',
  32: 'Bianca',
  40: 'Callisto',
  51: 'Dia',
  60: 'Elara',
}
const ARBOS_FAMILY_BY_DECADE: Record<number, string> = {
  2: 'Atlas',
  3: 'Bianca',
  4: 'Callisto',
  5: 'Dia',
  6: 'Elara',
}

const arbosNameFor = (version: number): string | null => {
  if (ARBOS_RELEASE_NAMES[version]) return ARBOS_RELEASE_NAMES[version]
  return ARBOS_FAMILY_BY_DECADE[Math.floor(version / 10)] ?? null
}

// child-chain TPS is sampled over a window of recent blocks each cycle
const TPS_WINDOW_BLOCKS = Math.max(2, Number(process.env.MONITOR_METRICS_TPS_WINDOW || 20))

// TPS = total txs across the last N child blocks / the window's wall-clock span.
// Also returns the chain's head block (reused for the block-backlog metric).
const sampleTps = async (rpcUrl: string): Promise<{ tps: number | null; head: bigint }> => {
  const head = await getBlockNumber(rpcUrl)
  const span = BigInt(TPS_WINDOW_BLOCKS - 1)
  const from = head > span ? head - span : 0n

  const nums: bigint[] = []
  for (let b = from; b <= head; b++) nums.push(b)
  const blocks = await Promise.all(nums.map(n => getBlockTxStats(rpcUrl, n)))
  if (blocks.length < 2) return { tps: null, head }

  const sumTx = blocks.reduce((total, block) => total + block.txCount, 0)
  const seconds = Number(blocks[blocks.length - 1].timestamp - blocks[0].timestamp)
  const tps = seconds > 0 ? sumTx / seconds : null
  return { tps: tps != null && Number.isFinite(tps) ? tps : null, head }
}

const syncChainRuntime = async (db: MetricsDb) => {
  const checkedAt = new Date().toISOString()
  const parentRpcUrls = getParentRpcUrls()

  await Promise.all(
    getMainnetChains().map(async chain => {
      // ArbOS version — read on the chain's own RPC. Child RPCs are public and
      // some reject the call, so isolate it from the batch-poster read below.
      try {
        const raw = await getArbOsVersionRaw(chain.rpcUrl)
        if (Number.isFinite(raw)) {
          const version = raw > ARBOS_VERSION_OFFSET ? raw - ARBOS_VERSION_OFFSET : raw
          await db.upsertChainArbos({
            chainId: chain.chainId,
            arbosRaw: raw,
            arbosVersion: version,
            arbosName: arbosNameFor(version),
            checkedAt,
          })
        }
      } catch (error) {
        console.error(`arbos read failed for ${chain.slug}`, error)
      }

      // Batch poster — the `from` of the most recent indexed batch tx, read on
      // the parent chain. Also snapshots its balance and estimates 24h gas burn
      // (avg fee of the last few batch txs × batches posted in 24h) for runway.
      try {
        const parentRpcUrl = parentRpcUrls[chain.parentChainId]
        if (!parentRpcUrl) {
          return
        }
        const { hashes, count24h } = await db.getBatchBurnSample(chain.chainId, 3)
        if (!hashes.length) {
          return
        }
        const sender = await getTransactionSender(parentRpcUrl, hashes[0])
        if (!sender) {
          return
        }

        let posterBalanceWei: string | null = null
        try {
          posterBalanceWei = (await getBalance(parentRpcUrl, sender)).toString()
        } catch {
          posterBalanceWei = null
        }

        let dailyBurnWei: string | null = null
        try {
          const fees = (
            await Promise.all(hashes.map(h => getTransactionFeeWei(parentRpcUrl, h).catch(() => null)))
          ).filter((f): f is bigint => f != null)
          if (fees.length && count24h > 0) {
            const avg = fees.reduce((sum, f) => sum + f, 0n) / BigInt(fees.length)
            dailyBurnWei = (avg * BigInt(count24h)).toString()
          }
        } catch {
          dailyBurnWei = null
        }

        await db.upsertChainBatchPoster({
          chainId: chain.chainId,
          batchPoster: sender,
          posterBalanceWei,
          dailyBurnWei,
          checkedAt,
        })
      } catch (error) {
        console.error(`batch poster read failed for ${chain.slug}`, error)
      }

      // Rollup security params (base stake, validator whitelist) — parent-chain
      // eth_call on the Rollup, isolated from the reads above.
      try {
        const parentRpcUrl = parentRpcUrls[chain.parentChainId]
        const rollup = chain.ethBridge.rollup as `0x${string}`
        if (parentRpcUrl && rollup) {
          let baseStakeWei: string | null = null
          let validatorWhitelistDisabled: boolean | null = null
          try {
            baseStakeWei = (await getRollupBaseStake(parentRpcUrl, rollup)).toString()
          } catch {
            baseStakeWei = null
          }
          try {
            validatorWhitelistDisabled = await getValidatorWhitelistDisabled(parentRpcUrl, rollup)
          } catch {
            validatorWhitelistDisabled = null
          }
          if (baseStakeWei !== null || validatorWhitelistDisabled !== null) {
            await db.upsertChainAssertion({
              chainId: chain.chainId,
              baseStakeWei,
              validatorWhitelistDisabled,
              checkedAt,
            })
          }
        }
      } catch (error) {
        console.error(`rollup info read failed for ${chain.slug}`, error)
      }

      // TPS + child head — sampled from the chain's own RPC, isolated so a
      // flaky child RPC doesn't drop the reads above.
      try {
        const { tps, head } = await sampleTps(chain.rpcUrl)
        await db.upsertChainTps({
          chainId: chain.chainId,
          tps,
          childHeadBlock: head != null ? head.toString() : null,
          checkedAt,
        })
      } catch (error) {
        console.error(`tps sample failed for ${chain.slug}`, error)
      }
    })
  )
}

// Records the live head block of each parent chain so the API can report how
// far behind the indexer is (head block vs latest indexed block).
const syncParentHeads = async (db: MetricsDb) => {
  const parentRpcUrls = getParentRpcUrls()
  const parents = Array.from(
    new Set(getMainnetChains().map(chain => chain.parentChainId))
  )
  const heads: Record<number, { block: string; checkedAt: string }> = {}
  await Promise.all(
    parents.map(async parentChainId => {
      try {
        const rpcUrl = parentRpcUrls[parentChainId]
        if (!rpcUrl) return
        const head = await getBlockNumber(rpcUrl)
        heads[parentChainId] = { block: head.toString(), checkedAt: new Date().toISOString() }
      } catch (error) {
        console.error(`parent head read failed for ${parentChainId}`, error)
      }
    })
  )
  if (Object.keys(heads).length) {
    await db.setState('parent_heads', JSON.stringify(heads))
  }
}

// Each stage is isolated so a failure in one (e.g. price API down) never
// blocks the others (RPC probes, balances, exit indexing) from updating.
// Failed stage names are collected so the heartbeat can report partial failure.
const runCycle = async (db: MetricsDb, chunkSize: number) => {
  const failed: string[] = []
  const stage = async (label: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      console.error(`${label} failed`, error)
      failed.push(label)
    }
  }

  await stage('rpc checks', () => syncRpcChecks(db))
  await stage('balance sync', () => syncBalances(db))
  await stage('price sync', () => syncEthereumPrice(db))
  await stage('chain runtime', () => syncChainRuntime(db))
  await stage('parent heads', () => syncParentHeads(db))
  await stage('exit sync', () => syncExitMessages(db, chunkSize))
  await stage('prune', () => db.prune())

  return { failed }
}

export const main = async () => {
  const options = readConfig()
  if (!options.postgresUrl) {
    throw new Error('POSTGRES_URL is required.')
  }

  const db = new MetricsDb(options.postgresUrl, options.databaseSchema)
  await db.init()

  const intervalMs = Math.max(options.intervalSeconds, 30) * 1000

  const close = async () => {
    await db.close()
  }

  process.on('SIGINT', () => {
    close().then(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    close().then(() => process.exit(0))
  })

  while (true) {
    const startedAt = Date.now()
    const heartbeat = async (status: 'ok' | 'error', error?: unknown) => {
      try {
        await db.setState(
          'worker_heartbeat',
          JSON.stringify({
            startedAt: Math.floor(startedAt / 1000),
            finishedAt: Math.floor(Date.now() / 1000),
            durationMs: Date.now() - startedAt,
            intervalSeconds: Math.round(intervalMs / 1000),
            status,
            ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
          })
        )
      } catch (stateError) {
        console.error('failed to write worker heartbeat', stateError)
      }
    }

    try {
      const { failed } = await runCycle(db, Math.max(options.logChunkSize, 100))
      console.log(
        `monitor-metrics cycle complete in ${Date.now() - startedAt}ms` +
          (failed.length ? ` (failed: ${failed.join(', ')})` : '')
      )
      await heartbeat(
        failed.length ? 'error' : 'ok',
        failed.length ? new Error(`stages failed: ${failed.join(', ')}`) : undefined
      )
    } catch (error) {
      console.error('monitor-metrics cycle failed', error)
      await heartbeat('error', error)
    }

    await sleep(intervalMs)
  }
}
