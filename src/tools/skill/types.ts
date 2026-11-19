import type { BuiltinSkill } from "../../skills"

export interface SkillArgs {
  name: string
}

export interface SkillInfo {
  name: string
  description: string
  location?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface SkillLoadOptions {
  /** Pre-merged skills to use instead of discovering */
  skills?: BuiltinSkill[]
  /**
   * Recomputes the skill list on every access. Installed pack skills appear
   * and disappear through this seam without rebuilding the tool; names are
   * deduped with the builtin entry winning on collision.
   */
  refresh?: () => BuiltinSkill[]
  /** Runtime gate; returning false hides and rejects every skill. */
  isEnabled?: () => boolean
  /** MCP manager for querying skill-embedded MCP servers */
  mcpManager?: never
  /** Session ID getter for MCP client identification */
  getSessionID?: () => string
  disabledSkills?: Set<string>
}
