import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import { deleteSubagentParent, setSubagentParent } from "../../../src/features/session-state/parent-registry"
import { clearSessionTools, getSessionTools } from "../../../src/shared/session/session-state"
import { ALLOWED_CHILD_TOOLS, buildChildToolMap } from "../../../src/tools/delegate-task/nested-depth"
import * as executor from "../../../src/tools/delegate-task/executor"
import { createDelegateTask } from "../../../src/tools/delegate-task/tools"

const PARENT_SESSION = "ses_parent_depth0"
const CHILD_SESSION = "ses_child_depth1"

function makeOptions() {
  return {
    manager: { launch: mock(async () => ({ id: "bg_task", status: "pending" })) } as never,
    client: {} as never,
    directory: "/tmp/nested-depth",
  }
}

function makeToolContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_1",
    agent: "morpheus",
    abort: new AbortController().signal,
    metadata: mock(async () => undefined),
  }
}

describe("nested delegation depth cap", () => {
  beforeEach(() => {
    clearSessionTools()
    deleteSubagentParent(CHILD_SESSION)
    deleteSubagentParent(PARENT_SESSION)
  })

  afterEach(() => {
    mock.restore()
    deleteSubagentParent(CHILD_SESSION)
    deleteSubagentParent(PARENT_SESSION)
    clearSessionTools()
  })

  test("depth-0 delegation proceeds (control)", async () => {
    //#given a top-level session with no registered parent
    spyOn(executor, "resolveParentContext").mockResolvedValue({
      sessionID: PARENT_SESSION,
      messageID: "msg_1",
      agent: "morpheus",
    })
    spyOn(executor, "resolveSubagentExecution").mockResolvedValue({
      agentToUse: "oracle",
      categoryModel: undefined,
    })
    const syncSpy = spyOn(executor, "executeSyncTask").mockResolvedValue("sync-proceeded")

    const tool = createDelegateTask(makeOptions())
    const args = {
      description: "depth zero control",
      prompt: "do work",
      load_skills: [],
      run_in_background: false,
      subagent_type: "oracle",
    }

    //#when the depth-0 session delegates
    const result = await tool.execute(args as never, makeToolContext(PARENT_SESSION) as never)

    //#then the delegation proceeds through the sync path
    expect(result).toBe("sync-proceeded")
    expect(syncSpy).toHaveBeenCalledTimes(1)
  })

  test("depth-1 delegation is rejected with nested-depth-exceeded", async () => {
    //#given a child session that itself was delegated to (depth 1)
    setSubagentParent(CHILD_SESSION, PARENT_SESSION)
    const launchSpy = mock(async () => ({ id: "bg_task", status: "pending" }))
    const options = makeOptions()
    options.manager = { launch: launchSpy } as never
    const tool = createDelegateTask(options)
    const args = {
      description: "nested attempt",
      prompt: "delegate again",
      load_skills: [],
      run_in_background: true,
      subagent_type: "oracle",
    }

    //#when the depth-1 session attempts a nested delegation
    const result = await tool.execute(args as never, makeToolContext(CHILD_SESSION) as never)

    //#then it is rejected before any launch, naming the terminal reason
    expect(typeof result).toBe("string")
    expect(result).toContain("nested-depth-exceeded")
    expect(launchSpy).not.toHaveBeenCalled()
  })

  test("firePrompt for a background child denies the task tool", async () => {
    //#given a background child task and a prompt-capable native client
    const sessionID = "ses_bg_child"
    const prompts: unknown[] = []
    const native = {
      session: {
        prompt: async (body: unknown) => {
          prompts.push(body)
          return {}
        },
        promptAsync: async () => ({}),
      },
    }
    const { firePrompt } = await import("../../../src/features/background-agent/manager/lifecycle")
    const task = {
      id: "bg_1",
      sessionID,
      parentSessionID: PARENT_SESSION,
      parentMessageID: "msg_1",
      description: "child",
      prompt: "work",
      agent: "oracle",
      status: "running",
    }

    //#when the child prompt is fired
    await firePrompt(native as never, task as never, "work")

    //#then the child tool map denies task delegation and keeps question off
    const tools = getSessionTools(sessionID)
    expect(tools?.task).toBe(false)
    expect(tools?.question).toBe(false)
    expect(prompts).toHaveLength(1)
  })

  test("ALLOWED_CHILD_TOOLS is the single source for child tools", () => {
    //#given the exported allowlist constant
    const allowlist = ALLOWED_CHILD_TOOLS

    //#when the child tool map is built for an agent
    const tools = buildChildToolMap("oracle")

    //#then the allowlist never grants task, and every listed tool is enabled
    expect(allowlist).not.toContain("task")
    expect(tools.task).toBe(false)
    for (const name of allowlist) {
      expect(tools[name]).toBe(true)
    }
  })
})
