import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import { resolveProjectPath } from '../config'

describe('resolveProjectPath', () => {
  const originalCwd = process.cwd()

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test('finds config.json at the repo root from a workspace cwd', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-config-'))
    const packageDir = path.join(root, 'packages', 'monitor-worker')

    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'config.json'), '{"childChains":[]}')

    process.chdir(packageDir)

    expect(fs.realpathSync(resolveProjectPath('./config.json'))).toBe(
      fs.realpathSync(path.join(root, 'config.json'))
    )
  })
})
