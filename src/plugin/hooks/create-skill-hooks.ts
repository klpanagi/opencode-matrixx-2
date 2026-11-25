import type { AvailableSkill } from "../../agents/shared/dynamic-agent-prompt-builder"
import type { HookName, MatrixxConfig } from "../../config"
import { createAutoSlashCommandHook, createCategorySkillReminderHook } from "../../hooks"
import { bindSafeHook } from "../../shared/agent/safe-create-hook"
import type { BuiltinSkill } from "../../skills"
import type { MatrixxContext } from "../tool/context"

export type SkillHooks = {
  categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null
  autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null
}

export function createSkillHooks(args: {
  ctx: MatrixxContext
  pluginConfig: MatrixxConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  builtinSkills: BuiltinSkill[]
  availableSkills: AvailableSkill[]
}): SkillHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled, builtinSkills, availableSkills } = args

  const safeHook = bindSafeHook(safeHookEnabled)

  const categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? safeHook("category-skill-reminder", () =>
        createCategorySkillReminderHook(ctx, availableSkills))
    : null

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? safeHook("auto-slash-command", () =>
        createAutoSlashCommandHook({ skills: builtinSkills, security: pluginConfig.security }))
    : null

  return { categorySkillReminder, autoSlashCommand }
}
