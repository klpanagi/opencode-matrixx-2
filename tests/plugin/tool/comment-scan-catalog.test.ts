/// <reference types="bun-types" />
//#given a built tool catalog and the dynamic prompt categorizer
//#when the catalog is assembled
//#then comment_scan is registered and grouped with the ast-grep tools
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { categorizeTools } from "../../../src/agents/shared/dynamic-agent-prompt-builder"
import type { MatrixxConfig } from "../../../src/config"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import type { SkillContext } from "../../../src/plugin/tool/skill-context"
import { createToolCatalog } from "../../../src/plugin/tool/tool-catalog"

const directory = mkdtempSync(join(tmpdir(), "matrixx-comment-scan-catalog-"))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

function makeArgs(pluginConfig: MatrixxConfig) {
  return {
    ctx: { directory, client: {} } as unknown as MatrixxContext,
    pluginConfig,
    skillContext: {
      builtinSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set<string>(),
    } as unknown as SkillContext,
    availableCategories: [],
  }
}

describe("comment_scan catalog registration", () => {
  test("is registered in the built catalog", () => {
    //#given a default plugin config
    //#when building the tool catalog
    const { filteredTools } = createToolCatalog(makeArgs({} as MatrixxConfig))
    //#then comment_scan is present
    expect(filteredTools.comment_scan).toBeDefined()
  })

  test("is categorized with the ast-grep tools", () => {
    //#given the tool name exposed by the catalog
    //#when categorizing it for the dynamic agent prompt
    const [tool] = categorizeTools(["comment_scan"])
    //#then it shares the ast category
    expect(tool?.category).toBe("ast")
  })
})
