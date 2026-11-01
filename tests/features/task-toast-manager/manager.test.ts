declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach, afterEach, mock } = require("bun:test")

import { resetNotifySink, setNotifySink, type NotifyLevel } from "../../../src/shared/notify"

type TaskToastManagerClass = typeof import("../../../src/features/task-toast-manager/manager").TaskToastManager

describe("TaskToastManager", () => {
  let TaskToastManager: TaskToastManagerClass
  let notices: Array<{ level: NotifyLevel; message: string }>
  let toastManager: InstanceType<TaskToastManagerClass>

  beforeEach(async () => {
    notices = []
    setNotifySink((level, message) => { notices.push({ level, message }) })
    const mod = await import("../../../src/features/task-toast-manager/manager")
    TaskToastManager = mod.TaskToastManager

    toastManager = new TaskToastManager()
  })

  afterEach(() => {
    mock.restore()
    resetNotifySink()
  })

  describe("skills in toast message", () => {
    test("should display skills when provided", () => {
      // given - a task with skills
      const task = {
        id: "task_1",
        description: "Test task",
        agent: "mouse",
        isBackground: true,
        skills: ["playwright", "git-master"],
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast message should include skills
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).toContain("playwright")
      expect(call.message).toContain("git-master")
    })

    test("should not display skills section when no skills provided", () => {
      // given - a task without skills
      const task = {
        id: "task_2",
        description: "Test task without skills",
        agent: "trinity",
        isBackground: true,
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast message should not include skills prefix
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).not.toContain("Skills:")
    })
  })

  describe("model fallback info in toast message", () => {
    test("should NOT display warning when model is category-default (normal behavior)", () => {
      // given - category-default is the intended behavior, not a fallback
      const task = {
        id: "task_1",
        description: "Task with category default model",
        agent: "mouse",
        isBackground: false,
        modelInfo: { model: "google/gemini-3-pro", type: "category-default" as const },
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast should NOT show warning - category default is expected
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).not.toContain("[FALLBACK]")
      expect(call.message).not.toContain("(category default)")
    })

    test("should display warning when model falls back to system-default", () => {
      // given - system-default is a fallback (no category default, no user config)
      const task = {
        id: "task_1b",
        description: "Task with system default model",
        agent: "mouse",
        isBackground: false,
        modelInfo: { model: "anthropic/claude-sonnet-4-5", type: "system-default" as const },
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast should show fallback warning
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).toContain("[FALLBACK]")
      expect(call.message).toContain("anthropic/claude-sonnet-4-5")
      expect(call.message).toContain("(system default fallback)")
    })

    test("should display warning when model is inherited from parent", () => {
      // given - inherited is a fallback (custom category without model definition)
      const task = {
        id: "task_2",
        description: "Task with inherited model",
        agent: "mouse",
        isBackground: false,
        modelInfo: { model: "cliproxy/claude-opus-4-6", type: "inherited" as const },
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast should show fallback warning
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).toContain("[FALLBACK]")
      expect(call.message).toContain("cliproxy/claude-opus-4-6")
      expect(call.message).toContain("(inherited from parent)")
    })

    test("should not display model info when user-defined", () => {
      // given - a task with user-defined model
      const task = {
        id: "task_3",
        description: "Task with user model",
        agent: "mouse",
        isBackground: false,
        modelInfo: { model: "my-provider/my-model", type: "user-defined" as const },
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast should NOT show model warning
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).not.toContain("[FALLBACK] Model:")
      expect(call.message).not.toContain("(inherited)")
      expect(call.message).not.toContain("(category default)")
      expect(call.message).not.toContain("(system default)")
    })

    test("should not display model info when not provided", () => {
      // given - a task without model info
      const task = {
        id: "task_4",
        description: "Task without model info",
        agent: "trinity",
        isBackground: true,
      }

      // when - addTask is called
      toastManager.addTask(task)

      // then - toast should NOT show model warning
      expect(notices).toHaveLength(1)
      const call = notices[0]
      expect(call.message).not.toContain("[FALLBACK] Model:")
    })
  })
})
