/**
 * Type-level barrel for the skills subsystem.
 *
 * Runtime skill loading goes through `loader/factories` (`createBuiltinSkills`)
 * — never import individual skills from `builtin/` for runtime template access.
 * The `builtin/` tree is type-level data only; templates resolve lazily via the
 * loader's `createLazyTemplateSkill` wrapper.
 */

export type {BuiltinSkill, McpServerDefinition, 
  RegisterSkillTransformResult,SkillMcpConfig, 
  SkillTransformDomain,
  SkillTransformEditor
} from "./loader"
export {
  type CreateBuiltinSkillsOptions,
  createBuiltinSkills,registerSkillTransform 
} from "./loader"
