/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TaskSchema, type Task } from "../../../src/features/task-storage/types"
import {
  StaleGenerationError,
  writeTaskFenced,
} from "../../../src/features/task-storage/generation"

const TEST_DIR = join(tmpdir(), ".test-task-generation")

function seedTask(generation = 0): { path: string; task: Task } {
  const task: Task = {
    id: "T-gen-1",
    subject: "Fenced task",
    description: "epoch fencing",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
    generation,
  }
  const path = join(TEST_DIR, `${task.id}.json`)
  writeFileSync(path, JSON.stringify(task, null, 2), "utf-8")
  return { path, task }
}

describe("task-generation fencing", () => {
  beforeEach(() => {
    //#given
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("happy path", () => {
    test("current-epoch write applies and bumps persisted generation", () => {
      //#given
      const { path, task } = seedTask(0)

      //#when
      const next = writeTaskFenced(path, { ...task, subject: "Updated" }, 0)

      //#then
      expect(next.generation).toBe(1)
      const persisted = TaskSchema.parse(JSON.parse(readFileSync(path, "utf-8")))
      expect(persisted.subject).toBe("Updated")
      expect(persisted.generation).toBe(1)
    })
  })

  describe("stale epoch", () => {
    test("stale-generation write rejected with typed error, state unchanged", () => {
      //#given
      const { path, task } = seedTask(0)
      const before = readFileSync(path, "utf-8")
      const mtimeBefore = statSync(path).mtimeMs
      // a concurrent writer takes over and bumps the epoch 0 -> 1
      writeTaskFenced(path, task, 0)

      //#when
      let error: unknown
      try {
        writeTaskFenced(path, { ...task, subject: "Stale overwrite" }, 0)
      } catch (err) {
        error = err
      }

      //#then
      expect(error).toBeInstanceOf(StaleGenerationError)
      const typed = error as StaleGenerationError
      expect(typed.kind).toBe("StaleGeneration")
      expect(typed.expected).toBe(0)
      expect(typed.actual).toBe(1)
      const persisted = TaskSchema.parse(JSON.parse(readFileSync(path, "utf-8")))
      expect(persisted.subject).not.toBe("Stale overwrite")
      expect(persisted.generation).toBe(1)
      expect(readFileSync(path, "utf-8")).not.toBe(before)
      expect(statSync(path).mtimeMs).toBeGreaterThanOrEqual(mtimeBefore)
    })

    test("takeover bump invalidates old token, fresh token succeeds", () => {
      //#given
      const { path, task } = seedTask(0)
      const first = writeTaskFenced(path, task, 0)

      //#when
      const second = writeTaskFenced(path, { ...task, subject: "Takeover write" }, first.generation)

      //#then
      expect(first.generation).toBe(1)
      expect(second.generation).toBe(2)
      const persisted = TaskSchema.parse(JSON.parse(readFileSync(path, "utf-8")))
      expect(persisted.generation).toBe(2)
      expect(persisted.subject).toBe("Takeover write")
    })
  })

  describe("edge cases", () => {
    test("legacy record without generation defaults to epoch 0", () => {
      //#given
      const path = join(TEST_DIR, "T-legacy.json")
      const { generation: _omitted, ...legacy } = seedTask(0).task
      writeFileSync(path, JSON.stringify(legacy, null, 2), "utf-8")

      //#when
      const next = writeTaskFenced(path, { ...legacy, generation: 0 } as Task, 0)

      //#then
      expect(next.generation).toBe(1)
    })
  })
})
