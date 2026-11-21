import { delimiter, dirname } from "node:path"

export function sgSpawnEnv(cliPath: string): Record<string, string | undefined> {
  const binaryDir = dirname(cliPath)
  const currentPath = process.env.PATH
  return {
    ...process.env,
    PATH: currentPath ? `${binaryDir}${delimiter}${currentPath}` : binaryDir,
  }
}
