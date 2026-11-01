export const HOOK_NAME = "subagent-block"

// Allowlist escape hatch: agent/session IDs listed in `subagent_block.allowlist`
// (or options.allowlist) bypass the block. Configure in matrixx.jsonc as
// `{ "subagent_block": { "enabled": true, "allowlist": ["my-agent"] } }`
// or disable the hook via `disabled_hooks: ["subagent-block"]`.
// Default stays enabled:true (see src/config/schema/subagent-block.ts).
export const BLOCK_MESSAGE =
  "[subagent-block] Native subagent tool is blocked. Use task tool instead (category or subagent_type + load_skills) to spawn agents so execution stays tracked and visible to background_output/background_wait_all. ses_ sessions remain manageable: cancellable via background_cancel (session.interrupt) and revivable by the owning parent via background_revive (session.prompt); foreign or unregistered ses_ IDs are still refused."

export const BYPASS_LOG_PREFIX = "[subagent-block] allowlist bypass"
