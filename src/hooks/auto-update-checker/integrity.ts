import { log } from "../../shared/runtime/logger"

const REGISTRY_DIST_TIMEOUT_MS = 10_000

export interface RegistryDistMeta {
  integrity?: string
}

export async function fetchRegistryDist(pkg: string, version: string): Promise<RegistryDistMeta> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REGISTRY_DIST_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } }
    )
    if (!response.ok) {
      log(`[auto-update-checker] Registry dist fetch failed for ${pkg}@${version}: HTTP ${response.status}`)
      return {}
    }
    const data = (await response.json()) as { dist?: { integrity?: string } }
    return { integrity: data.dist?.integrity }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log(`[auto-update-checker] Registry dist fetch failed for ${pkg}@${version}:`, errorMessage)
    return {}
  } finally {
    clearTimeout(timeoutId)
  }
}

export function assertIntegrity(meta: RegistryDistMeta): string {
  if (!meta.integrity) {
    throw new Error("registry metadata is missing dist.integrity; refusing to install unverified package")
  }
  return meta.integrity
}

export function redactIntegrity(integrity: string): string {
  return `${integrity.slice(0, 14)}…`
}
