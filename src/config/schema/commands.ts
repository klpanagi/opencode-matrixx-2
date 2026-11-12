import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "matrix-loop",
  "rp-loop",
  "cancel-loop",
  "refactor",
  "start-work",
  "stop-continuation",
  "preset",
  "end-redpill",
  "handoff",
  "research",
  "assembly",
  "redpill",
  "bdd-pipeline",
  "plan-review",
  "quality-audit",
  "quality-assurance",
  "pickup",
  "remove-deadcode",
  "cleanup-tasks",
  "task-list",
  "humanize",
  "security-audit",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
