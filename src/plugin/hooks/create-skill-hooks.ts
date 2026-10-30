import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import type { HookName } from "../../config"
import { createAutoSlashCommandHook, createCategorySkillReminderHook } from "../../hooks"
import { bindSafeHook } from "../../shared/safe-create-hook"
import type { BuiltinSkill } from "../../skills"
import type { MatrixxContext } from "../context"

export type SkillHooks = {
  categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null
  autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null
}

export function createSkillHooks(args: {
  ctx: MatrixxContext
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  builtinSkills: BuiltinSkill[]
  availableSkills: AvailableSkill[]
}): SkillHooks {
  const { ctx, isHookEnabled, safeHookEnabled, builtinSkills, availableSkills } = args

  const safeHook = bindSafeHook(safeHookEnabled)

  const categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? safeHook("category-skill-reminder", () =>
        createCategorySkillReminderHook(ctx, availableSkills))
    : null

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? safeHook("auto-slash-command", () =>
        createAutoSlashCommandHook({ skills: builtinSkills }))
    : null

  return { categorySkillReminder, autoSlashCommand }
}
