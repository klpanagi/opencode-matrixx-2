type DefaultModelPair = { providerID: string; modelID: string }

type DefaultModelEditor = {
  default?: { get?: () => { providerID?: string; modelID?: string } | undefined }
  [key: string]: unknown
}

type ModelTransform = (callback: (editor: DefaultModelEditor) => void) => Promise<unknown>

export type SystemDefaultModelSource = {
  model?: { transform?: ModelTransform }
}

async function release(registration: unknown): Promise<void> {
  const disposable = registration as { dispose?: unknown } | undefined
  if (typeof disposable?.dispose !== "function") return
  try {
    await (disposable.dispose as () => unknown)()
  } catch {
    return
  }
}

function toModelString(pair: { providerID?: string; modelID?: string } | undefined): string | undefined {
  if (!pair) return undefined
  const { providerID, modelID } = pair
  if (!providerID || !modelID) return undefined
  return `${providerID}/${modelID}`
}

/**
 * Reads the live default model. Precedence: `ModelEditor.default.get()` (the model actually
 * in force) over the config draft — both derive from the same setting, but if they ever
 * diverge the live default wins. The transform registration is released immediately so
 * repeated calls cannot accumulate scoped transforms.
 */
export async function resolveSystemDefaultModel(source: SystemDefaultModelSource = {}): Promise<string | undefined> {
  const transform = source.model?.transform
  if (typeof transform !== "function") return undefined

  let captured: { providerID?: string; modelID?: string } | undefined
  let registration: unknown 
  try {
    registration = await transform((editor) => {
      captured = editor.default?.get?.()
    })
  } catch {
    return undefined
  } finally {
    await release(registration)
  }

  return toModelString(captured)
}

export type { DefaultModelPair }
