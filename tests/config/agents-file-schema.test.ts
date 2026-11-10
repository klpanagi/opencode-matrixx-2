/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import {
  AgentsFilePointerSchema,
  AgentsFileSchema,
} from "../../src/config/schema/agents-file"
import { MatrixxConfigSchema } from "../../src/config/schema/matrixx-config"

describe("AgentsFilePointerSchema", () => {
  test("accepts non-empty string", () => {
    //#given a valid pointer
    const pointer = "matrixx.agents.jsonc"

    //#when parsed
    const result = AgentsFilePointerSchema.safeParse(pointer)

    //#then it succeeds
    expect(result.success).toBe(true)
  })

  test("rejects empty string", () => {
    //#given an empty pointer
    const pointer = ""

    //#when parsed
    const result = AgentsFilePointerSchema.safeParse(pointer)

    //#then it fails
    expect(result.success).toBe(false)
  })
})

describe("AgentsFileSchema", () => {
  test("parses both agents and categories sections", () => {
    //#given a file object with both sections
    const file = {
      agents: { oracle: { model: "anthropic/claude-opus-4-6" } },
      categories: { "bullet-time": { model: "anthropic/claude-opus-4-6" } },
    }

    //#when parsed
    const result = AgentsFileSchema.safeParse(file)

    //#then it succeeds with both sections
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.oracle?.model).toBe("anthropic/claude-opus-4-6")
      expect(result.data.categories?.["bullet-time"]?.model).toBe("anthropic/claude-opus-4-6")
    }
  })

  test("strips unknown agent keys like inline does", () => {
    //#given a file with an unknown agent key
    const file = {
      agents: {
        oracle: { model: "anthropic/claude-opus-4-6" },
        nope_agent_xyz: { model: "anthropic/claude-opus-4-6" },
      },
    }

    //#when parsed
    const result = AgentsFileSchema.safeParse(file)

    //#then it succeeds and strips the unknown key
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.oracle).toBeDefined()
      expect(result.data.agents).not.toHaveProperty("nope_agent_xyz")
    }
  })

  test("accepts empty object (both sections optional)", () => {
    //#given an empty file object
    //#when parsed
    const result = AgentsFileSchema.safeParse({})

    //#then it succeeds
    expect(result.success).toBe(true)
  })
})

describe("MatrixxConfig agents_file field", () => {
  test("parses agents_file pointer in root config", () => {
    //#given a root config with pointer
    const config = { agents_file: "custom-agents.jsonc" }

    //#when parsed
    const result = MatrixxConfigSchema.safeParse(config)

    //#then it succeeds
    expect(result.success).toBe(true)
  })

  test("inline agents and categories still parse (deprecated but valid)", () => {
    //#given a root config with inline sections
    const config = {
      agents: { oracle: { model: "anthropic/claude-opus-4-6" } },
      categories: { "bullet-time": { model: "anthropic/claude-opus-4-6" } },
    }

    //#when parsed
    const result = MatrixxConfigSchema.safeParse(config)

    //#then it succeeds
    expect(result.success).toBe(true)
  })
})
