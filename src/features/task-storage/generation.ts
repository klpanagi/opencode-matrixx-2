import { readFileSync } from "node:fs"
import { type ReadErrorKind, readJsonTyped, TypedReadError } from "./read-errors"
import { writeJsonAtomic } from "./storage"
import { type Task, TaskSchema } from "./types"

export const STALE_GENERATION_KIND: ReadErrorKind = "StaleGeneration"

export class StaleGenerationError extends TypedReadError {
  expected: number
  actual: number
  constructor(path: string, expected: number, actual: number) {
    super(STALE_GENERATION_KIND, path, 0, `stale generation: expected ${expected}, persisted ${actual}`)
    this.name = "StaleGenerationError"
    this.expected = expected
    this.actual = actual
  }
}

export function currentTaskGeneration(task: Partial<Task> | null | undefined): number {
  const generation = task?.generation
  return typeof generation === "number" && Number.isInteger(generation) && generation >= 0 ? generation : 0
}

export function assertCurrentGeneration(persistedGeneration: number, expectedGeneration: number, path: string): void {
  if (persistedGeneration !== expectedGeneration) {
    throw new StaleGenerationError(path, expectedGeneration, persistedGeneration)
  }
}

export function withBumpedGeneration(task: Task): Task {
  return { ...task, generation: currentTaskGeneration(task) + 1 }
}

export function writeTaskFenced(filePath: string, task: Task, expectedGeneration: number): Task {
  const current = readJsonTyped(filePath, TaskSchema)
  const persistedGeneration = current.ok ? currentTaskGeneration(current.value) : 0
  assertCurrentGeneration(persistedGeneration, expectedGeneration, filePath)
  const next: Task = { ...task, generation: persistedGeneration + 1 }
  writeJsonAtomic(filePath, next)
  return next
}

export function readTaskGeneration(filePath: string): number {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<Task>
    return currentTaskGeneration(parsed)
  } catch {
    return 0
  }
}
