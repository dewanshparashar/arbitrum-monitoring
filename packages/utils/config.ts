import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'

const resolveUpward = (relativePath: string, bases: string[]) => {
  for (const base of bases) {
    let current = path.resolve(base)

    while (true) {
      const candidate = path.resolve(current, relativePath)
      if (fs.existsSync(candidate)) {
        return candidate
      }

      const parent = path.dirname(current)
      if (parent === current) {
        break
      }

      current = parent
    }
  }

  return path.resolve(bases[0], relativePath)
}

dotenv.config({
  path: resolveUpward('.env', [process.cwd(), __dirname]),
})

// config.json file at project root
export const DEFAULT_CONFIG_PATH = './config.json'

export const resolveProjectPath = (filePath: string) => {
  if (path.isAbsolute(filePath)) {
    return filePath
  }

  return resolveUpward(filePath, [process.cwd(), __dirname])
}

export const getConfig = (options: { configPath: string }) => {
  try {
    const configFileContent = fs.readFileSync(resolveProjectPath(options.configPath), 'utf-8')

    const parsedConfig = JSON.parse(configFileContent)

    return parsedConfig
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in the config file')
    }
    if (error instanceof Error) {
      throw new Error(`Error reading or parsing config file: ${error.message}`)
    }
    throw new Error(
      'An unknown error occurred while processing the config file'
    )
  }
}
