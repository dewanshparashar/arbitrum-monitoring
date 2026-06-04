import { describe, expect, test, vi } from 'vitest'
import { getBlockRange } from '../index'

describe('getBlockRange', () => {
  test('caps testnet parent searches to 10000 blocks', async () => {
    const getBlock = vi.fn().mockResolvedValue({ number: 10_990_000n })
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(11_000_000n),
      getBlock,
    } as any

    const result = await getBlockRange(client, {
      name: 'Arbitrum Sepolia',
      chainId: 421614,
      parentChainId: 11155111,
      confirmPeriodBlocks: 45818,
    } as any)

    expect(getBlock).toHaveBeenCalledWith({
      blockNumber: 10_990_000n,
    })
    expect(result).toEqual({
      fromBlock: 10_990_000n,
      toBlock: 11_000_000n,
    })
  })

  test('keeps mainnet search windows unchanged', async () => {
    const getBlock = vi.fn().mockResolvedValue({ number: 14_949_600n })
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(15_000_000n),
      getBlock,
    } as any

    const result = await getBlockRange(client, {
      name: 'Mainnet Orbit',
      chainId: 1234,
      parentChainId: 1,
      confirmPeriodBlocks: 45818,
    } as any)

    expect(getBlock).toHaveBeenCalledWith({
      blockNumber: 14_949_600n,
    })
    expect(result).toEqual({
      fromBlock: 14_949_600n,
      toBlock: 15_000_000n,
    })
  })
})
