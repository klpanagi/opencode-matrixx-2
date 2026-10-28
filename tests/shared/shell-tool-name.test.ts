/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { isShellTool, isTaskTool } from "../../src/shared/shell-tool-name"

describe("shell-tool-name", () => {
  test("bash and shell match in any case with surrounding whitespace", () => {
    //#given: both spellings in varied case/whitespace
    //#when: checked
    //#then: true
    for (const name of ["bash", "shell", "BASH", "SHELL", " Shell ", "  bash\t", "ShElL"]) {
      expect(isShellTool(name)).toBe(true)
    }
  })

  test("non-shell tool names do not match", () => {
    //#given: other tools, lookalikes, empty and nullish inputs
    //#when: checked
    //#then: false — exact bash|shell only
    for (const name of ["read", "grep", "glob", "webfetch", "", "   ", "interactive_bash", "bash-session", "shell-session", "shellcheck", "bashrc"]) {
      expect(isShellTool(name)).toBe(false)
    }
    expect(isShellTool(null)).toBe(false)
    expect(isShellTool(undefined)).toBe(false)
    expect(isShellTool(42)).toBe(false)
    expect(isShellTool({})).toBe(false)
  })

  test("isTaskTool matches task and subagent aliases", () => {
    //#given: both delegation-tool spellings
    //#when: checked
    //#then: true for task|subagent (any case/whitespace), false otherwise
    for (const name of ["task", "subagent", "TASK", "SubAgent", " task "]) {
      expect(isTaskTool(name)).toBe(true)
    }
    for (const name of ["shell", "bash", "read", "", "tasks", "sub-agent", null, undefined]) {
      expect(isTaskTool(name)).toBe(false)
    }
  })
})
