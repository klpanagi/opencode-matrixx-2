import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"
import { log } from "../../shared/logger"
import { unwrapList } from "../../shared/unwrap-list"
import type { OpencodeClient } from "./types"

function addFromProviderModels(
  out: Set<string>,
  providerID: string,
  models: Array<string | { id?: string }> | undefined
): void {
  if (!models) return
  for (const item of models) {
    const modelID = typeof item === "string" ? item : item?.id
    if (!modelID) continue
    out.add(`${providerID}/${modelID}`)
  }
}

export async function getAvailableModelsForDelegateTask(client: OpencodeClient): Promise<Set<string>> {
  const providerModelsCache = readProviderModelsCache()

  if (providerModelsCache?.models) {
    const connected = new Set(providerModelsCache.connected)

    const out = new Set<string>()
    for (const [providerID, models] of Object.entries(providerModelsCache.models)) {
      if (!connected.has(providerID)) continue
      addFromProviderModels(out, providerID, models as Array<string | { id?: string }> | undefined)
    }
    return out
  }

  const connectedProviders = readConnectedProvidersCache()

  if (!connectedProviders || connectedProviders.length === 0) {
    return new Set()
  }

  const modelList = (client as unknown as { model?: { list?: () => Promise<unknown> } })
    ?.model
    ?.list

  if (!modelList) {
    return new Set()
  }

  try {
    const result = await modelList()
    const rows = unwrapList<{ provider?: string; providerID?: string; id?: string; modelID?: string }>(result)

    const connected = new Set(connectedProviders)
    const out = new Set<string>()
    for (const row of rows) {
      const provider = row?.providerID ?? row?.provider
      const id = row?.modelID ?? row?.id
      if (!provider || !id) continue
      if (!connected.has(provider)) continue
      out.add(`${provider}/${id}`)
    }
    return out
  } catch (err) {
    log("[delegate-task] client.model.list failed", { error: String(err) })
    return new Set()
  }
}
