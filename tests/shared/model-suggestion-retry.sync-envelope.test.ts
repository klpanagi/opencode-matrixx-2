import { describe, expect, it, mock } from "bun:test"
import { promptSyncWithModelSuggestionRetry } from "../../src/shared/model-suggestion-retry"

type Client = Parameters<typeof promptSyncWithModelSuggestionRetry>[0]

describe("promptSyncWithModelSuggestionRetry SDK error envelope", () => {
  it("should throw structured error when prompt resolves {error} envelope", async () => {
    //#given a mock client whose session.prompt RESOLVES a hey-api error envelope (throwOnError=false)
    const promptMock = mock(() =>
      Promise.resolve({
        data: undefined,
        error: { message: "Missing key [text]" },
        response: { status: 400 },
        request: {},
      })
    )
    const client = { session: { prompt: promptMock } }

    //#when calling promptSyncWithModelSuggestionRetry
    const promise = promptSyncWithModelSuggestionRetry(client as unknown as Client, {
      path: { id: "session-400" },
      body: {
        agent: "oracle",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    })

    //#then it THROWS a structured error containing the status and sessionID
    await expect(promise).rejects.toThrow(/400/)
    await expect(promise).rejects.toThrow(/session-400/)
    //#then NO model-suggestion retry logic runs (single call, no retry)
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw structured error when the suggestion-retry call resolves {error} envelope", async () => {
    //#given a client whose first call THROWS model-not-found and whose retry RESOLVES an error envelope
    const promptMock = mock()
      .mockRejectedValueOnce({
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: ["claude-sonnet-4"],
        },
      })
      .mockResolvedValueOnce({
        data: undefined,
        error: { message: "Method Not Allowed" },
        response: { status: 405 },
        request: {},
      })
    const client = { session: { prompt: promptMock } }

    //#when calling promptSyncWithModelSuggestionRetry
    const promise = promptSyncWithModelSuggestionRetry(client as unknown as Client, {
      path: { id: "session-retry-405" },
      body: {
        agent: "oracle",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonet-4" },
      },
    })

    //#then it THROWS a structured error containing the retry status and sessionID
    await expect(promise).rejects.toThrow(/405/)
    await expect(promise).rejects.toThrow(/session-retry-405/)
    expect(promptMock).toHaveBeenCalledTimes(2)
  })

  it("should resolve normally on success envelope {data}", async () => {
    //#given a mock client resolving a success envelope
    const promptMock = mock(() => Promise.resolve({ data: {} }))
    const client = { session: { prompt: promptMock } }

    //#when calling promptSyncWithModelSuggestionRetry
    await promptSyncWithModelSuggestionRetry(client as unknown as Client, {
      path: { id: "session-ok" },
      body: {
        parts: [{ type: "text", text: "hello" }],
      },
    })

    //#then it resolves without throwing
    expect(promptMock).toHaveBeenCalledTimes(1)
  })
})
