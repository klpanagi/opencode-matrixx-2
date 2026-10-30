const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
  mock: bunMock,
} = require("bun:test")

bunDescribe("sendSyncPrompt native payload (host session.prompt {sessionID, text})", () => {
  bunTest("sends {sessionID, text} instead of parts/agent/model wrappers", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    let captured: unknown
    const sendNativePrompt = bunMock(async (_session: unknown, args: unknown) => {
      captured = args
    })

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
      {
        session: {
          prompt: bunMock(async () => ({})),
          promptAsync: bunMock(async () => {
            throw new Error("promptAsync must not be called on the native client")
          }),
        },
      },
      input,
      { sendNativePrompt },
    )

    //#then - prompt succeeds silently (null) and args use the native text shape
    bunExpect(result).toBeNull()
    const record = captured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-v2-shape")
    bunExpect(record.text).toBe("test prompt")
    bunExpect("parts" in record).toBe(false)
    bunExpect("agent" in record).toBe(false)
    bunExpect("model" in record).toBe(false)
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })

  bunTest("merges systemContent into text and keeps model out of the prompt payload", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    let captured: unknown
    const sendNativePrompt = bunMock(async (_session: unknown, args: unknown) => {
      captured = args
    })

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
      {
        session: {
          prompt: bunMock(async () => ({})),
          promptAsync: bunMock(async () => {
            throw new Error("promptAsync must not be called on the native client")
          }),
        },
      },
      input,
      { sendNativePrompt },
    )

    //#then - model pins at session.create; system instructions ride in the text
    const record = captured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-v2-model")
    bunExpect(record.text).toBe("sys\n\ntest prompt")
    bunExpect("model" in record).toBe(false)
    bunExpect("variant" in record).toBe(false)
    bunExpect("system" in record).toBe(false)
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })

  bunTest("returns formatDetailedError with sessionID when the native prompt throws", async () => {
    //#given a deps prompt that THROWS (native session.prompt surfaces rejections as throws)
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    const sendNativePrompt = bunMock(async () => {
      throw new Error("Missing key [text]")
    })

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
      {
        session: {
          prompt: bunMock(async () => ({})),
          promptAsync: bunMock(async () => {
            throw new Error("promptAsync must not be called on the native client")
          }),
        },
      },
      input,
      { sendNativePrompt },
    )

    //#then - never a silent pass: detailed error carries status and sessionID
    bunExpect(typeof result).toBe("string")
        bunExpect(result as string).toContain("Missing key [text]")
    bunExpect(result as string).toContain("ses-400-envelope")
  })

  bunTest("returns null when the native prompt resolves", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    const sendNativePrompt = bunMock(async () => {})

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
      {
        session: {
          prompt: bunMock(async () => ({})),
          promptAsync: bunMock(async () => {
            throw new Error("promptAsync must not be called on the native client")
          }),
        },
      },
      input,
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toBeNull()
  })

  bunTest("oracle EOF fallback retries with the same text payload", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")

    let calls = 0
    let syncCaptured: unknown
    const sendNativePrompt = bunMock(async (_session: unknown, args: unknown) => {
      calls += 1
      if (calls === 1) throw new Error("JSON Parse error: Unexpected EOF")
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
      {
        session: {
          prompt: bunMock(async () => ({})),
          promptAsync: bunMock(async () => {
            throw new Error("promptAsync must not be called on the native client")
          }),
        },
      },
      input,
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toBeNull()
    const record = syncCaptured as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-oracle-v2")
    bunExpect(record.text).toBe("test prompt")
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })
})
