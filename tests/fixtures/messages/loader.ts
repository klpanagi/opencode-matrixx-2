import { readFileSync } from "node:fs"
import { join } from "node:path"

// Fixtures are checked in as JSON so a reviewer can read them without running
// any code. They are loaded through this helper (never `require`, never an
// absolute path) so the path resolution stays relative to this directory.

export const CORPUS_NAMES = ["v1-shaped", "v2-flat", "v2-assistant-tool"] as const

export type CorpusName = (typeof CORPUS_NAMES)[number]

const CORPUS_DIR = import.meta.dir

export function loadCorpus(name: CorpusName): unknown[] {
  if (!(CORPUS_NAMES as ReadonlyArray<string>).includes(name)) {
    throw new Error("Unknown message corpus: " + String(name))
  }
  const raw = readFileSync(join(CORPUS_DIR, name + ".json"), "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error("Message corpus is not an array: " + name)
  }
  return parsed
}
