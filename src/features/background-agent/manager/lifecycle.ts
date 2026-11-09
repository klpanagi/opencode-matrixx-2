import { getAgentToolRestrictions, log } from "../../../shared"
import { promptNativeWithModelSuggestionRetry } from "../../../shared/model/model-suggestion-retry"
import type { NativeDomains } from "../../../shared/session/session-context-source"
import { setSessionTemperature, setSessionTools } from "../../../shared/session/session-state"
import { recordEffortForBackground } from "../../agent-effort/background"
import { registerSubagentSession } from "../../session-state/state"
import { getTaskToastManager } from "../../task-toast-manager"
import { buildSubagentTitle, sweepAndReadHandles } from "../handle-index"
import type { BackgroundTask, BackgroundTaskStatus, LaunchInput, ResumeInput } from "../types"
import { finalizeTask } from "./finalize"
import type { ManagerRuntime } from "./types"

/**
 * Task lifecycle: restore, launch, track, resume, prompt.
 *
 * Each function takes the shared `ManagerRuntime` explicitly instead of a
 * `BackgroundManager` receiver — same statements, no `this`. Thin
 * delegating methods on `BackgroundManager` preserve the public API.
 */


export function isSettled(status: BackgroundTaskStatus): boolean {
  return status !== "pending" && status !== "running"
}

function armWallclock(rt: ManagerRuntime, task: BackgroundTask): void {
  const timeoutMs = rt.config?.wallClockTimeoutMs
  const startedAtMs = task.startedAt?.getTime()
  if (timeoutMs === undefined || startedAtMs === undefined) return
  rt.store.wallclock.arm(task.id, startedAtMs, timeoutMs, () => {
    if (isSettled(task.status)) return
    task.terminalReason = "wall-clock-timeout"
    void finalizeTask(rt, task, {
      status: "error",
      source: "wall-clock-timeout",
      notify: false,
      removeToast: false,
      recordHistory: false,
      incomingError: "Wall-clock timeout exceeded",
      logMessage: null,
      computeEffort: async () => (await recordEffortForBackground(rt, task, rt.effortConfig))?.line ?? null,
    })
    if (task.sessionID !== undefined) {
      abortSessionQuietly(rt.native, task.sessionID, "wall-clock-timeout")
    }
  })
}

export async function restoreHandles(rt: ManagerRuntime): Promise<void> {
    const { handles, removed: swept } = sweepAndReadHandles(rt.directory, rt.store.taskTtlMs())

    let restored = 0
    for (const handle of handles) {
      if (rt.store.tasks.has(handle.taskId)) continue
      const uncertain =
        handle.status === "running" || handle.status === "pending"
      rt.store.tasks.set(handle.taskId, {
        generation: handle.generation,
        id: handle.taskId,
        parentSessionID: handle.parentSessionID,
        parentMessageID: handle.parentMessageID,
        description: handle.description,
        prompt: "",
        agent: handle.agent,
        status: uncertain ? "statusUncertain" : handle.status,
        sessionID: handle.sessionID,
        terminalReason: uncertain ? "uncertain" : handle.terminalReason,
        queuedAt:
          handle.queuedAt !== undefined ? new Date(handle.queuedAt) : undefined,
        startedAt:
          handle.startedAt !== undefined ? new Date(handle.startedAt) : undefined,
        completedAt:
          handle.completedAt !== undefined
            ? new Date(handle.completedAt)
            : undefined,
        model: handle.model,
        category: handle.category,
        concurrencyGroup: handle.concurrencyGroup,
      })
      if (handle.sessionID !== undefined) rt.store.knownSessions.add(handle.sessionID)
      restored++
    }

    log("[background-agent] Restored background handles:", { restored, swept })
}


export async function launchTask(rt: ManagerRuntime,
    input: LaunchInput & {
      sessionId?: string
      sessionID?: string
      messageId?: string
      messageID?: string
    },
  ): Promise<BackgroundTask> {
    if (input.parentSessionID === undefined) {
      const aliasedParent =
        input.sessionId ??
        input.sessionID
      if (aliasedParent !== undefined) input.parentSessionID = aliasedParent
    }
    if (input.parentMessageID === undefined) {
      const aliasedMsg =
        input.messageId ??
        input.messageID
      if (aliasedMsg !== undefined) input.parentMessageID = aliasedMsg
    }
    if (input.agent === undefined || input.agent === null) input.agent = 'task'
    if (input.parentSessionID === undefined) input.parentSessionID = 'ses_parent'
    if (input.parentMessageID === undefined) input.parentMessageID = 'msg_1'
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionID,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    if (
      typeof input.description !== "string" ||
      input.description.trim() === ""
    ) {
      const fromPrompt =
        typeof input.prompt === "string" && input.prompt.trim() !== ""
          ? input.prompt.trim().split(/\s+/).slice(0, 5).join(" ")
          : ""
      input.description =
        fromPrompt !== "" ? fromPrompt.slice(0, 80) : "Background task"
    }

    const concurrencyKey = `${input.parentSessionID}:${input.agent}:${(input.prompt ?? "").length}:${(input.prompt ?? "").slice(0, 120)}`
    for (const existing of rt.store.tasks.values()) {
      if (
        existing.concurrencyKey === concurrencyKey &&
        (existing.status === "pending" || existing.status === "running") &&
        existing.parentSessionID === input.parentSessionID
      ) {
        log("[background-agent] Launch dedup: reusing active task", { taskId: existing.id })
        return existing
      }
    }

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      concurrencyKey,
      status: "pending",
      queuedAt: new Date(),
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      parentModel: input.parentModel,
      parentAgent: input.parentAgent,
      parentTools: input.parentTools,
      model: input.model,
      category: input.category,
    }

    rt.store.tasks.set(task.id, task)
    rt.taskHistory.record(input.parentSessionID, {
      id: task.id,
      agent: input.agent,
      description: task.description,
      status: "pending",
      category: input.category,
    })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: input.description,
        agent: input.agent,
        isBackground: true,
        status: "queued",
        skills: input.skills,
      })
    }

    let created: { id?: string }
    rt.store.pendingSpawns.add(task.id)
    try {
      created = (await rt.native.session.create({
        parentID: input.parentSessionID,
        title: buildSubagentTitle(input.description, input.agent, input.category),
        agent: input.agent,
        ...(input.model
          ? {
              model: {
                id: input.model.modelID,
                providerID: input.model.providerID,
                ...(input.model.variant !== undefined ? { variant: input.model.variant } : {}),
              },
            }
          : {}),
      })) as { id?: string }
    } catch (error) {
      rt.store.pendingSpawns.delete(task.id)
      const message = error instanceof Error ? error.message : String(error)
      const errorMessage = `Failed to create background session: ${message}`
      await finalizeTask(rt, task, {
        status: "error",
        source: "launch-create-failed",
        notify: false,
        removeToast: false,
        recordHistory: false,
        incomingError: errorMessage,
        logMessage: null,
      })
      throw new Error(errorMessage)
    }

    rt.store.pendingSpawns.delete(task.id)
    if (isSettled(task.status)) {
      if (created.id) abortSessionQuietly(rt.native, created.id, "aborted-during-await")
      task.terminalReason = "aborted"
      rt.store.persistHandle(task)
      rt.store.wallclock.disarm(task.id)
      log("[background-agent] launch aborted during session.create - cleaning up:", {
        taskId: task.id,
        status: task.status,
      })
      return task
    }

    if (!created.id) {
      const errorMessage =
        "Failed to create background session: API returned no session ID"
      await finalizeTask(rt, task, {
        status: "error",
        source: "launch-no-session-id",
        notify: false,
        removeToast: false,
        recordHistory: false,
        incomingError: errorMessage,
        logMessage: null,
      })
      throw new Error(errorMessage)
    }

    const sessionID = created.id
    registerSubagentSession(sessionID, input.parentSessionID)
    rt.store.knownSessions.add(sessionID)

    task.status = "running"
    task.startedAt = new Date()
    task.sessionID = sessionID
    // Atomic handoff: index the session before the next event can observe the task.
    rt.store.reindexTask(task)
    task.progress = { toolCalls: 0, lastUpdate: new Date() }
    rt.store.persistHandle(task)
    rt.taskHistory.record(input.parentSessionID, {
      id: task.id,
      sessionID,
      agent: input.agent,
      description: task.description,
      status: "running",
      category: input.category,
      startedAt: task.startedAt,
    })

    if (toastManager) toastManager.updateTask(task.id, "running")

    log("[background-agent] Launching task:", {
      taskId: task.id,
      sessionID,
      agent: input.agent,
    })

    if (input.model?.temperature !== undefined) {
      setSessionTemperature(sessionID, input.model.temperature)
    }

    armWallclock(rt, task)

    firePrompt(rt.native, task, input.prompt, input.skillContent).catch((error) => {
      rt.store.wallclock.disarm(task.id)
      if (isSettled(task.status)) {
        log("[background-agent] prompt error after settle - keeping terminal state:", {
          taskId: task.id,
          status: task.status,
        })
        return
      }
      log("[background-agent] prompt error:", error)
      task.status = "interrupt"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()
      rt.store.persistHandle(task)
      abortSessionQuietly(rt.native, sessionID, "error-recovery")
    })

    return task
}


export async function trackTask(rt: ManagerRuntime,input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    const existingTask = rt.store.tasks.get(input.taskId)
    if (existingTask) {
      existingTask.parentSessionID = input.parentSessionID
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent
      }
      log("[background-agent] External task already registered:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
        status: existingTask.status,
      })
      return existingTask
    }

    const task: BackgroundTask = {
      id: input.taskId,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: "",
      description: input.description,
      prompt: "",
      agent: input.agent || "task",
      status: "running",
      startedAt: new Date(),
      progress: { toolCalls: 0, lastUpdate: new Date() },
      parentAgent: input.parentAgent,
    }

    rt.store.tasks.set(task.id, task)
    rt.store.persistHandle(task)
    registerSubagentSession(input.sessionID, input.parentSessionID)
    rt.store.knownSessions.add(input.sessionID)
    rt.taskHistory.record(input.parentSessionID, {
      id: task.id,
      sessionID: input.sessionID,
      agent: task.agent,
      description: task.description,
      status: "running",
      startedAt: task.startedAt,
    })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: task.description,
        agent: task.agent,
        isBackground: true,
      })
    }

    log("[background-agent] Registered external task:", {
      taskId: task.id,
      sessionID: input.sessionID,
    })
    return task
}


export async function resumeTask(rt: ManagerRuntime,input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = rt.store.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }
    if (!existingTask.sessionID) {
      throw new Error(`Task has no sessionID: ${existingTask.id}`)
    }
    if (existingTask.status === "running") {
      log("[background-agent] Resume skipped - task already running:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
      })
      return existingTask
    }

    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel
    existingTask.parentAgent = input.parentAgent
    if (input.parentTools) existingTask.parentTools = input.parentTools
    existingTask.startedAt = new Date()
    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }
    rt.store.persistHandle(existingTask)

    registerSubagentSession(existingTask.sessionID, input.parentSessionID)

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: existingTask.id,
        description: existingTask.description,
        agent: existingTask.agent,
        isBackground: true,
      })
    }

    log("[background-agent] Resuming task:", {
      taskId: existingTask.id,
      sessionID: existingTask.sessionID,
    })

    armWallclock(rt, existingTask)

    firePrompt(rt.native, existingTask, input.prompt).catch((error) => {
      rt.store.wallclock.disarm(existingTask.id)
      if (isSettled(existingTask.status)) {
        log("[background-agent] resume prompt error after settle - keeping terminal state:", {
          taskId: existingTask.id,
          status: existingTask.status,
        })
        return
      }
      log("[background-agent] resume prompt error:", error)
      existingTask.status = "interrupt"
      existingTask.error =
        error instanceof Error ? error.message : String(error)
      existingTask.completedAt = new Date()
      rt.store.persistHandle(existingTask)
      if (existingTask.sessionID) {
        abortSessionQuietly(rt.native, existingTask.sessionID, "resume-error")
      }
    })

    return existingTask
}


export function abortSessionQuietly(native: NativeDomains,sessionID: string, context?: string): void {
    native.session.interrupt({ sessionID }).catch((err) => {
      log(
        `[background-agent] Session abort failed${context ? ` (${context})` : ""}:`,
        { sessionID, error: err },
      )
    })
}


export async function firePrompt(native: NativeDomains,
    task: BackgroundTask,
    prompt: string,
    skillContent?: string,
  ): Promise<void> {
    const sessionID = task.sessionID
    if (!sessionID) throw new Error(`Task has no sessionID: ${task.id}`)
    const tools = {
      task: true,
      question: false,
      ...getAgentToolRestrictions(task.agent),
    }
    setSessionTools(sessionID, tools)

    // Native v2 session.prompt takes { sessionID, text } only: agent and model
    // are pinned at session.create above, tools flow through setSessionTools,
    // and skill content is prepended to the user text so the child receives it.
    const fireText =
      skillContent !== undefined && skillContent.length > 0 ? `${skillContent}\n\n${prompt}` : prompt
    await promptNativeWithModelSuggestionRetry(native.session, {
      sessionID,
      text: fireText,
    })
}
