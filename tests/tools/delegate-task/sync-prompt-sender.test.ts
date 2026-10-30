const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
  mock: bunMock,
} = require("bun:test")

function baseInput(overrides = {}) {
  return {
    sessionID: "test-session",
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
    ...overrides,
  }
}

function nativeClient(captured: { args?: unknown }) {
  return {
    session: {
      prompt: bunMock(async (_session: unknown, args: unknown) => {
        captured.args = args
      }),
      promptAsync: bunMock(async () => {
        throw new Error("promptAsync must not be called on the native client")
      }),
    },
  }
}

bunDescribe("sendSyncPrompt (native session.prompt)", () => {
  bunTest("calls native session.prompt with flat args and never promptAsync", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const captured: { args?: unknown } = {}
    const sendNativePrompt = bunMock(async (_session: unknown, args: unknown) => {
      captured.args = args
    })
    const client = nativeClient(captured)

    //#when
    const result = await sendSyncPrompt(client, baseInput(), { sendNativePrompt })

    //#then
    bunExpect(result).toBeNull()
    bunExpect(sendNativePrompt).toHaveBeenCalledTimes(1)
    const record = captured.args as Record<string, unknown>
    bunExpect(record.sessionID).toBe("test-session")
    bunExpect(record.text).toBe("test prompt")
    bunExpect("parts" in record).toBe(false)
    bunExpect("agent" in record).toBe(false)
    bunExpect("model" in record).toBe(false)
    bunExpect("path" in record).toBe(false)
    bunExpect("body" in record).toBe(false)
  })

  bunTest("prepends systemContent to the prompt text", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const captured: { args?: unknown } = {}
    const sendNativePrompt = bunMock(async (_s: unknown, args: unknown) => {
      captured.args = args
    })

    //#when
    const result = await sendSyncPrompt(
      nativeClient(captured),
      baseInput({ systemContent: "skill instructions" }),
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toBeNull()
    const record = captured.args as Record<string, unknown>
    bunExpect(record.text).toBe("skill instructions\n\ntest prompt")
  })

  bunTest("stores question=false in the session tools store", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const { getSessionTools } = require("../../../src/shared/session-state")
    const captured: { args?: unknown } = {}
    const sendNativePrompt = bunMock(async (_s: unknown, args: unknown) => {
      captured.args = args
    })

    //#when
    await sendSyncPrompt(nativeClient(captured), baseInput({ sessionID: "ses-tools-q" }), { sendNativePrompt })

    //#then
    const tools = getSessionTools("ses-tools-q") as Record<string, unknown>
    bunExpect(tools.question).toBe(false)
  })

  bunTest("applies agent tool restrictions for explore agent", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const captured: { args?: unknown } = {}
    const sendNativePrompt = bunMock(async (_s: unknown, args: unknown) => {
      captured.args = args
    })

    //#when
    await sendSyncPrompt(
      nativeClient(captured),
      baseInput({
        sessionID: "ses-tools-trinity",
        agentToUse: "trinity",
        args: { ...baseInput().args, category: "bullet-time" },
      }),
      { sendNativePrompt },
    )

    //#then
    const { getSessionTools } = require("../../../src/shared/session-state")
    const tools = getSessionTools("ses-tools-trinity") as Record<string, unknown>
    bunExpect(tools.task).toBe(false)
  })

  bunTest("includes model and variant in the flat shape when categoryModel is set", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const captured: { args?: unknown } = {}
    const sendNativePrompt = bunMock(async (_s: unknown, args: unknown) => {
      captured.args = args
    })

    //#when
    const result = await sendSyncPrompt(
      nativeClient(captured),
      baseInput({
        sessionID: "ses-v2-shape",
        categoryModel: { providerID: "opencode-go", modelID: "muse-spark", variant: "max" },
      }),
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toBeNull()
    const record = captured.args as Record<string, unknown>
    bunExpect(record.sessionID).toBe("ses-v2-shape")
    bunExpect(record.text).toBe("test prompt")
    bunExpect("model" in record).toBe(false)
    bunExpect("variant" in record).toBe(false)
  })

  bunTest("retries once via native prompt for oracle on unexpected EOF", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    let calls = 0
    const sendNativePrompt = bunMock(async () => {
      calls += 1
      if (calls === 1) throw new Error("JSON Parse error: Unexpected EOF")
    })

    //#when
    const result = await sendSyncPrompt(
      nativeClient({}),
      baseInput({ agentToUse: "oracle" }),
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toBeNull()
    bunExpect(sendNativePrompt).toHaveBeenCalledTimes(2)
  })

  bunTest("does not retry native prompt for non-oracle on unexpected EOF", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const sendNativePrompt = bunMock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })

    //#when
    const result = await sendSyncPrompt(
      nativeClient({}),
      baseInput({ agentToUse: "mouse" }),
      { sendNativePrompt },
    )

    //#then
    bunExpect(result).toContain("JSON Parse error: Unexpected EOF")
    bunExpect(sendNativePrompt).toHaveBeenCalledTimes(1)
  })

  bunTest("does not mask non-agent errors as agent-not-found", async () => {
    //#given
    const { sendSyncPrompt } = require("../../../src/tools/delegate-task/sync-prompt-sender")
    const sendNativePrompt = bunMock(async () => {
      throw new TypeError("client.session.promptAsync is not a function")
    })

    //#when
    const result = await sendSyncPrompt(nativeClient({}), baseInput(), { sendNativePrompt })

    //#then
    bunExpect(result).toContain("client.session.promptAsync is not a function")
    bunExpect(result).not.toContain("not found")
  })
})
