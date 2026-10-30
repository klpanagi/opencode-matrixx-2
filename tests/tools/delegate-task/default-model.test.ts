import { describe, expect, test } from "bun:test"
import { resolveSystemDefaultModel } from "../../../src/tools/delegate-task/default-model"

type DefaultPair = { providerID: string; modelID: string }

function sourceYielding(pair: DefaultPair | undefined) {
  return {
    model: {
      transform: async (callback: (editor: { default: { get: () => DefaultPair | undefined } }) => void) => {
        callback({ default: { get: () => pair } })
        return { dispose: async () => {} }
      },
    },
  }
}

describe("resolveSystemDefaultModel", () => {
  test("returns provider/model when the editor yields a default", async () => {
    //#given an editor whose live default is anthropic/claude-sonnet-4-6
    const source = sourceYielding({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when the system default is resolved
    const result = await resolveSystemDefaultModel(source)

    //#then it is rendered as a provider/model string
    expect(result).toBe("anthropic/claude-sonnet-4-6")
  })

  test("returns undefined when the editor yields no default", async () => {
    //#given an editor with no configured default
    const source = sourceYielding(undefined)

    //#when the system default is resolved
    const result = await resolveSystemDefaultModel(source)

    //#then nothing is reported so callers fall back
    expect(result).toBeUndefined()
  })

  test("returns undefined when the model domain is absent", async () => {
    //#given a context without a model domain
    const source = {}

    //#when the system default is resolved
    const result = await resolveSystemDefaultModel(source)

    //#then it does not throw and reports nothing
    expect(result).toBeUndefined()
  })

  test("returns undefined when the transform rejects", async () => {
    //#given a transform that rejects
    const source = {
      model: {
        transform: async () => {
          throw new Error("boom")
        },
      },
    }

    //#when the system default is resolved
    const result = await resolveSystemDefaultModel(source)

    //#then the failure is contained rather than breaking task startup
    expect(result).toBeUndefined()
  })

  test("disposes the transform registration it creates", async () => {
    //#given a registration whose dispose is observable
    let disposed = false
    const source = {
      model: {
        transform: async (callback: (editor: { default: { get: () => DefaultPair | undefined } }) => void) => {
          callback({ default: { get: () => undefined } })
          return {
            dispose: async () => {
              disposed = true
            },
          }
        },
      },
    }

    //#when the system default is resolved
    await resolveSystemDefaultModel(source)

    //#then the registration is released so repeated calls cannot accumulate transforms
    expect(disposed).toBe(true)
  })
})
