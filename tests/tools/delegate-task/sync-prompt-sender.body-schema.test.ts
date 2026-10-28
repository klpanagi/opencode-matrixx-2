const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
  mock: bunMock,
} = require("bun:test")

bunDescribe("sendSyncPrompt v2 body schema (host opencode v2.1.4)", () => {
  bunTest("sends flat v2 shape with top-level sessionID instead of {path,body}", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    let captured: unknown
    const promptWithModelSuggestionRetry = bunMock(async (_client: unknown, args: unknown) => {
      captured = args
    })
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "ses-v2-shape",
      agentToUse: "mouse",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      { promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry },
    )

    //#then - prompt succeeds silently (null) and args use the flat v2 shape
    bunExpect(result).toBeNull()
    const record = captured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-v2-shape")
    bunExpect(record.parts).toEqual([{ type: "text", text: "test prompt" }])
    bunExpect(record.agent).toBe("mouse")
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })

  bunTest("includes model and variant in the flat v2 shape when categoryModel is set", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    let captured: unknown
    const promptWithModelSuggestionRetry = bunMock(async (_client: unknown, args: unknown) => {
      captured = args
    })
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "ses-v2-model",
      agentToUse: "trinity",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: "sys",
      categoryModel: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "max" },
      toastManager: null,
      taskId: undefined,
    }

    //#when
    await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      { promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry },
    )

    //#then
    const record = captured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-v2-model")
    bunExpect(record.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    bunExpect(record.variant).toBe("max")
    bunExpect(record.system).toBe("sys")
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })

  bunTest("returns formatDetailedError with sessionID when prompt resolves a 400 error envelope", async () => {
    //#given a deps prompt that RESOLVES a hey-api error envelope (400 Missing key [text])
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => ({
      data: undefined,
      error: { message: "Missing key [text]" },
      response: { status: 400 },
      request: {},
    }))
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "ses-400-envelope",
      agentToUse: "mouse",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      { promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry },
    )

    //#then - never a silent pass: detailed error carries status and sessionID
    bunExpect(typeof result).toBe("string")
    bunExpect(result as string).toContain("400")
    bunExpect(result as string).toContain("Missing key [text]")
    bunExpect(result as string).toContain("ses-400-envelope")
  })

  bunTest("returns null when prompt resolves a success envelope", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => ({ data: {} }))
    const promptSyncWithModelSuggestionRetry = bunMock(async () => {})

    const input = {
      sessionID: "ses-ok-envelope",
      agentToUse: "mouse",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      { promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry },
    )

    //#then
    bunExpect(result).toBeNull()
  })

  bunTest("oracle EOF fallback also sends the flat v2 shape to the sync retry", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    const promptWithModelSuggestionRetry = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    let syncCaptured: unknown
    const promptSyncWithModelSuggestionRetry = bunMock(async (_client: unknown, args: unknown) => {
      syncCaptured = args
    })

    const input = {
      sessionID: "ses-oracle-v2",
      agentToUse: "oracle",
      args: {
        description: "test task",
        prompt: "test prompt",
        run_in_background: false,
        load_skills: [],
      },
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    }

    //#when
    const result = await sendSyncPrompt(
      { session: { promptAsync: bunMock(async () => ({ data: {} })) } },
      input,
      { promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry },
    )

    //#then
    bunExpect(result).toBeNull()
    const record = syncCaptured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-oracle-v2")
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })
})
