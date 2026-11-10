import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { log } from "../shared/runtime/logger"
import { parseJsoncSafe } from "../shared/text/jsonc-parser"
import { type ModelPresets, ModelPresetsSchema } from "./schema/model-presets"

export const DEFAULT_PRESETS_FILENAME = "matrixx.presets.jsonc"

export interface PresetsFileResult {
  presets: ModelPresets | null
  error?: string
}

function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  return p
}

export function resolvePresetsFilePath(configPath: string, pointer?: string): string {
  const dir = dirname(configPath)
  if (!pointer) {
    const jsonc = join(dir, DEFAULT_PRESETS_FILENAME)
    // Fallback to .json sibling when no .jsonc exists (same detectConfigFile order).
    if (!existsSync(jsonc)) {
      const json = join(dir, "matrixx.presets.json")
      if (existsSync(json)) return json
    }
    return jsonc
  }
  const expanded = expandHome(pointer)
  if (isAbsolute(expanded)) return expanded
  return join(dir, expanded)
}

export function loadPresetsFile(presetsPath: string): PresetsFileResult {
  if (!existsSync(presetsPath)) return { presets: null }
  let content: string
  try {
    content = readFileSync(presetsPath, "utf-8")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log("Presets file unreadable", { presetsPath, message })
    return { presets: null, error: message }
  }
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0 || parsed.data === null) {
    const message = parsed.errors[0]?.message ?? "empty presets file"
    log("Presets file parse error", { presetsPath, message })
    return { presets: null, error: message }
  }
  const validated = ModelPresetsSchema.safeParse(parsed.data)
  if (!validated.success) {
    const message = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ")
    log("Presets file validation error", { presetsPath, message })
    return { presets: null, error: message }
  }
  return { presets: validated.data }
}

export function mergeFileAndInlinePresets(
  filePresets: ModelPresets | null,
  inlinePresets: ModelPresets | undefined,
): ModelPresets | undefined {
  if (!filePresets && !inlinePresets) return undefined
  return { ...(filePresets ?? {}), ...(inlinePresets ?? {}) }
}
