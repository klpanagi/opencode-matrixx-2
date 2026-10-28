import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxConfig } from "../../src/config"
import type { BackgroundManager } from "../../src/features/background-agent"
import type { SkillContext } from "../../src/plugin/skill-context"
import { createToolCatalog } from "../../src/plugin/tool-catalog"
import type { PluginContext } from "../../src/plugin/types"

const NOTEPAD_TOOLS = ["notepad_create", "notepad_read", "notepad_append", "notepad_list"] as const

function makeArgs(pluginConfig: MatrixxConfig, directory: string) {
  return {
    ctx: { directory, client: {} } as unknown as PluginContext,
    pluginConfig,
    managers: { backgroundManager: {} as unknown as BackgroundManager },
    skillContext: {
      builtinSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set<string>(),
    } as unknown as SkillContext,
    availableCategories: [],
  }
}

describe("tool-catalog notepad_* registration (Task 4)", () => {
  test("all four notepad_* tools are present by default", () => {
    //#given a default plugin config with no disabled tools
    const dir = mkdtempSync(join(tmpdir(), "matrixx-notepad-catalog-"))
    //#when building the tool catalog
    const { filteredTools } = createToolCatalog(makeArgs({} as MatrixxConfig, dir))
    //#then all four notepad_* tools are registered
    for (const name of NOTEPAD_TOOLS) {
      expect(filteredTools[name]).toBeDefined()
    }
  })

  test('disabled_tools: ["notepad_append"] removes only that tool', () => {
    //#given a config disabling only notepad_append
    const dir = mkdtempSync(join(tmpdir(), "matrixx-notepad-catalog-"))
    const config = { disabled_tools: ["notepad_append"] } as unknown as MatrixxConfig
    //#when building the tool catalog
    const { filteredTools } = createToolCatalog(makeArgs(config, dir))
    //#then only notepad_append is gone and its siblings remain
    expect(filteredTools["notepad_append"]).toBeUndefined()
    expect(filteredTools["notepad_create"]).toBeDefined()
    expect(filteredTools["notepad_read"]).toBeDefined()
    expect(filteredTools["notepad_list"]).toBeDefined()
  })
})
