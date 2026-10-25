import { describe, expect, test } from "bun:test"
import {
  evaluateCommandTemplate,
  registerCommandTransform,
} from "../../../src/features/builtin-commands/commands.transform"

function createCaptureEditor() {
  const defs = new Map<string, Record<string, unknown>>()
  const editor = {
    add(def: { name: string; description?: string; execute: (input: unknown) => Promise<void> }): void {
      defs.set(def.name, def as unknown as Record<string, unknown>)
    },
  }
  const domain = {
    transform: async (cb: (e: typeof editor) => void): Promise<unknown> => {
      cb(editor)
      return {}
    },
  }
  return { editor, domain, defs }
}

describe("commands.transform execute", () => {
  test("every def has execute function", async () => {
    //#given
    const { domain, defs } = createCaptureEditor()
    //#when
    await registerCommandTransform(domain, {
      hello: { description: "hi", template: "do $ARGUMENTS" },
    })
    //#then
    for (const def of defs.values()) {
      expect(typeof def.execute).toBe("function")
    }
  })

  test("evaluateCommandTemplate handles $ARGUMENTS and $1/$2", () => {
    //#given/when/then
    expect(evaluateCommandTemplate("do $ARGUMENTS!", "x y")).toBe("do x y!")
    expect(evaluateCommandTemplate("run $1 and $2", "a b c")).toBe("run a and b c")
    expect(evaluateCommandTemplate("plain", "hello")).toBe("plain\n\nhello")
  })

  test("execute calls switchAgent + prompt with evaluated text", async () => {
    //#given
    const { domain, defs } = createCaptureEditor()
    const calls: Array<{ op: string; args: unknown }> = []
    const session = {
      switchAgent: async (args: unknown): Promise<unknown> => {
        calls.push({ op: "switchAgent", args })
        return {}
      },
      switchModel: async (args: unknown): Promise<unknown> => {
        calls.push({ op: "switchModel", args })
        return {}
      },
      prompt: async (args: unknown): Promise<unknown> => {
        calls.push({ op: "prompt", args })
        return {}
      },
    }
    await registerCommandTransform(
      domain,
      { "start-work": { description: "d", template: "work $ARGUMENTS", agent: "architect" } },
      { session },
    )
    const def = defs.get("start-work") as unknown as {
      execute: (input: { sessionID: string; prompt: { text: string } }) => Promise<void>
    }
    //#when
    await def.execute({ sessionID: "s1", prompt: { text: "my plan" } })
    //#then
    expect(calls.find((c) => c.op === "switchAgent")).toMatchObject({
      args: { sessionID: "s1", agent: "architect" },
    })
    const promptCall = calls.find((c) => c.op === "prompt")
    expect(promptCall).toBeDefined()
    expect((promptCall?.args as Record<string, unknown>).text).toContain("my plan")
  })
})
