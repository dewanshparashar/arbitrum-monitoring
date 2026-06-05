import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_PORTAL_CONFIG_URL,
  getWorkerConfig,
  loadPortalConfig,
} from '../config'

const portalSnapshot = {
  mainnet: [
    {
      chainId: 660279,
      confirmPeriodBlocks: 45818,
      ethBridge: {
        bridge: '0x1',
        inbox: '0x2',
        outbox: '0x3',
        rollup: '0x4',
        sequencerInbox: '0x5',
      },
      explorerUrl: 'https://explorer.xai-chain.net',
      rpcUrl: 'https://xai-chain.net/rpc/',
      isCustom: true,
      isTestnet: false,
      name: 'Xai',
      parentChainId: 42161,
      slug: 'xai',
    },
  ],
  testnet: [
    {
      chainId: 37714555429,
      confirmPeriodBlocks: 150,
      ethBridge: {
        bridge: '0x1',
        inbox: '0x2',
        outbox: '0x3',
        rollup: '0x4',
        sequencerInbox: '0x5',
      },
      explorerUrl: 'https://testnet-explorer-v2.xai-chain.net',
      rpcUrl: 'https://testnet-v2.xai-chain.net/rpc',
      isCustom: true,
      isTestnet: true,
      name: 'Xai Testnet',
      parentChainId: 421614,
      slug: 'xai-testnet',
    },
  ],
}

describe('loadPortalConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('normalizes the portal snapshot into monitor config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => portalSnapshot,
      }))
    )

    const config = await loadPortalConfig({
      portalConfigUrl: DEFAULT_PORTAL_CONFIG_URL,
      portalNetwork: 'all',
    })

    expect(config.childChains).toHaveLength(2)
    expect(config.childChains[0]).toMatchObject({
      chainId: 660279,
      orbitRpcUrl: 'https://xai-chain.net/rpc',
      parentRpcUrl: 'https://arb1.arbitrum.io/rpc',
      explorerUrl: 'https://explorer.xai-chain.net/',
      parentExplorerUrl: 'https://arbiscan.io/',
    })
  })

  test('applies rpc overrides and network filtering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => portalSnapshot,
      }))
    )

    const config = await loadPortalConfig({
      portalConfigUrl: DEFAULT_PORTAL_CONFIG_URL,
      portalNetwork: 'testnet',
      chainRpcOverrides: JSON.stringify({
        37714555429: 'https://override.example/rpc/',
      }),
      parentRpcOverrides: JSON.stringify({
        421614: 'https://override-parent.example/rpc/',
      }),
      parentExplorerOverrides: JSON.stringify({
        421614: 'https://override-parent.example/explorer',
      }),
    })

    expect(config.childChains).toEqual([
      expect.objectContaining({
        chainId: 37714555429,
        orbitRpcUrl: 'https://override.example/rpc',
        parentRpcUrl: 'https://override-parent.example/rpc',
        parentExplorerUrl: 'https://override-parent.example/explorer/',
      }),
    ])
  })
})

describe('getWorkerConfig', () => {
  const originalArgv = process.argv
  const originalEnv = process.env

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  test('loads portal config when no config path is provided', async () => {
    process.argv = ['node', 'worker']
    process.env = {
      ...originalEnv,
      MONITOR_CONFIG_PATH: '',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => portalSnapshot,
      }))
    )

    const result = await getWorkerConfig()

    expect(result.options.portalNetwork).toBe('all')
    expect(result.config.childChains).toHaveLength(2)
  })
})
