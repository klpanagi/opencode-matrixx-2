import type { MatrixxConfig } from "../../config"
import { log } from "../../shared/logger"
import {
  isSoftwareDevOrchestratorTarget,
  resolveSoftwareDevEnforcementContent,
} from "../../shared/software-dev-enforcement"
import {
  CODE_WRITING_SUBAGENT_TARGETS,
  HOOK_NAME,
  isCodeWritingPrompt,
  READ_ONLY_SUBAGENT_TARGETS,
  SOFTWARE_DEV_ENFORCEMENT_MARKER,
} from "./constants"

function resolveTarget(args: Record<string, unknown>): string | undefined {
  const raw = args.agent ?? args.subagent_type
  if (typeof raw !== "string") return undefined
  const normalized = raw.trim().toLowerCase()
  return normalized === "" ? undefined : normalized
}

function resolveDisabledSkills(pluginConfig?: MatrixxConfig): Set<string> {
  const disabled = new Set<string>(pluginConfig?.disabled_skills ?? [])
  if (!pluginConfig?.tdd_enforcer?.enabled) {
    disabled.add("tdd-enforcer")
  }
  return disabled
}

export function createSoftwareDevEnforcementHook(pluginConfig?: MatrixxConfig) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string },
    ): Promise<void> => {
      if (input.tool.trim().toLowerCase() !== "subagent") {
        return
      }
      const args = output.args
      if (!args) {
        return
      }
      const target = resolveTarget(args)
      if (!target) {
        return
      }
      const prompt = args.prompt
      if (typeof prompt !== "string" || prompt === "") {
        return
      }
      if (prompt.includes(SOFTWARE_DEV_ENFORCEMENT_MARKER)) {
        return
      }
      if ((READ_ONLY_SUBAGENT_TARGETS as readonly string[]).includes(target)) {
        return
      }

      const enforcementInput = pluginConfig?.softwareDevEnforcement
      const disabledSkills = resolveDisabledSkills(pluginConfig)
      const browserProvider = pluginConfig?.browser_automation_engine?.provider ?? "playwright"

      let payload: string | undefined
      try {
        if (isSoftwareDevOrchestratorTarget(target, enforcementInput)) {
          const result = resolveSoftwareDevEnforcementContent(target, undefined, [], {
            enforcement: enforcementInput,
            disabledSkills,
            browserProvider,
          })
          payload = result.content ?? result.error ?? undefined
        } else if ((CODE_WRITING_SUBAGENT_TARGETS as readonly string[]).includes(target)) {
          if (!isCodeWritingPrompt(prompt)) {
            return
          }
          const result = resolveSoftwareDevEnforcementContent(target === "sati" ? "mouse" : target, "source", [], {
            enforcement: enforcementInput,
            disabledSkills,
            browserProvider,
          })
          payload = result.content ?? result.error ?? undefined
        } else {
          return
        }
      } catch {
        return
      }
      if (!payload) {
        return
      }
      args.prompt =
        `<system-reminder>${SOFTWARE_DEV_ENFORCEMENT_MARKER}\n${payload}</system-reminder>\n${prompt}`
      log(`[${HOOK_NAME}] Injected software-dev enforcement into subagent`, {
        sessionID: input.sessionID,
        target,
      })
    },
  }
}
