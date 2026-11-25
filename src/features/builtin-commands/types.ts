import type { CommandDefinition } from "../command-loader"

export type BuiltinCommandName = "init-deep" | "matrix-loop" | "cancel-loop" | "rp-loop" | "refactor" | "start-work" | "stop-continuation" | "handoff" | "pickup" | "remove-deadcode" | "preset" | "end-redpill" | "research" | "assembly" | "redpill" | "bdd-pipeline" | "cleanup-tasks" | "task-list" | "completion-review" | "quality-audit" | "quality-assurance" | "humanize" | "security-audit" | "academic-humanize" | "bug-hunt"

export type BuiltinCommands = Record<string, CommandDefinition>

// append-probe