import { describe, expect, it } from "bun:test"
import { z } from "zod"
import type { MatrixxContext } from "../../src/plugin/tool/context"
import { emitToolInfo, type MatrixxToolDefinition } from "../../src/shared/tool/define-tool"
import { createGlobTools } from "../../src/tools/glob/tools"
import { createGrepTools } from "../../src/tools/grep/tools"
import { createHashlineEditTool } from "../../src/tools/hashline-edit/tools"

const deps = { directory: "/tmp/x", worktree: "/tmp/x" }

function createContext(): MatrixxContext {
  return { directory: "/tmp/x", worktree: "/tmp/x" } as unknown as MatrixxContext
}

function createStubDefinition(): MatrixxToolDefinition {
  return {
    description: "stub",
    args: { value: z.string() },
    execute: async () => "ok",
  }
}

describe("direct tool registration options", () => {
  it("hashline edit registers as a direct edit tool with edit permission", () => {
    //#given
    const definition = createHashlineEditTool()

    //#when
    const info = emitToolInfo("edit", definition, deps)

    //#then
    expect(info).toBeDefined()
    expect(info?.options).toEqual({ codemode: false, permission: "edit" })
  })

  it("grep registers as a direct tool without an edit permission", () => {
    //#given
    const grep = createGrepTools(createContext()).grep

    //#when
    const info = emitToolInfo("grep", grep, deps)

    //#then
    expect(info).toBeDefined()
    expect(info?.options).toEqual({ codemode: false })
  })

  it("glob registers as a direct tool without an edit permission", () => {
    //#given
    const glob = createGlobTools(createContext()).glob

    //#when
    const info = emitToolInfo("glob", glob, deps)

    //#then
    expect(info).toBeDefined()
    expect(info?.options).toEqual({ codemode: false })
  })

  it("keeps the name-keyed task registration options when the definition declares none", () => {
    //#given
    const definition = createStubDefinition()

    //#when
    const info = emitToolInfo("task", definition, deps)

    //#then
    expect(info?.options).toEqual({ codemode: false })
  })

  it("leaves tools without declared or keyed options unset", () => {
    //#given
    const definition = createStubDefinition()

    //#when
    const info = emitToolInfo("read", definition, deps)

    //#then
    expect(info?.options).toBeUndefined()
  })
})
