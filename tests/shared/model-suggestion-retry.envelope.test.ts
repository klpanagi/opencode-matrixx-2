import { describe, expect, it, mock } from "bun:test"
import { promptWithModelSuggestionRetry } from "../../src/shared/model-suggestion-retry"

type Client = Parameters<typeof promptWithModelSuggestionRetry>[0]

describe("promptWithModelSuggestionRetry SDK error envelope", () => {
  it("should throw structured error when promptAsync resolves {error} envelope", async () => {
    //#given a mock client whose promptAsync RESOLVES an hey-api error envelope (throwOnError=false)
    const promptMock = mock(() =>
      Promise.resolve({
        data: undefined,
        error: { message: "Method Not Allowed" },
        response: { status: 405 },
        request: {},
      })
    )
    const client = { session: { promptAsync: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    const promise = promptWithModelSuggestionRetry(client as unknown as Client, {
      path: { id: "session-405" },
      body: {
        agent: "trinity",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    })

    //#then it THROWS a structured error containing 405 and sessionID
    await expect(promise).rejects.toThrow(/405/)
    await expect(promise).rejects.toThrow(/session-405/)
  })

  it("should resolve normally on success envelope {data}", async () => {
    //#given a mock client resolving a success envelope
    const promptMock = mock(() => Promise.resolve({ data: {} }))
    const client = { session: { promptAsync: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    await promptWithModelSuggestionRetry(client as unknown as Client, {
      path: { id: "session-ok" },
      body: {
        parts: [{ type: "text", text: "hello" }],
      },
    })

    //#then it resolves without throwing
    expect(promptMock).toHaveBeenCalledTimes(1)
  })
})
