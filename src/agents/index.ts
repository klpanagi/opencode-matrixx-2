export { CONSTRUCT_PROMPT_METADATA, createConstructAgent } from "./definitions/construct"
export { createMerovingianAgent, MEROVINGIAN_PROMPT_METADATA, ORACLE_PROMPT_METADATA } from "./definitions/merovingian"
export { createMorpheusAgent } from "./definitions/morpheus"
export { createNiobeAgent, niobePromptMetadata } from "./definitions/niobe"
export { createOperatorAgent, OPERATOR_PROMPT_METADATA } from "./definitions/operator"
export {
  ORACLE_BEHAVIORAL_SUMMARY,
  ORACLE_HIGH_ACCURACY_MODE,
  ORACLE_IDENTITY_CONSTRAINTS,
  ORACLE_INTERVIEW_MODE,
  ORACLE_PERMISSION,
  ORACLE_PLAN_GENERATION,
  ORACLE_PLAN_TEMPLATE,
  ORACLE_SYSTEM_PROMPT,
} from "./definitions/oracle"
export { createSeraphAgent, SERAPH_SYSTEM_PROMPT, seraphPromptMetadata } from "./definitions/seraph"
export { createSmithAgent, SMITH_SYSTEM_PROMPT, smithPromptMetadata } from "./definitions/smith"
export { createTrinityAgent, TRINITY_PROMPT_METADATA } from "./definitions/trinity"
export { createBuiltinAgents } from "./registry"
export type {
  AgentTransformDomain,
  AgentTransformEditor,
  AgentTransformEntryFailure,
  AgentTransformInfo,
  RegisterAgentTransformInput,
  RegisterAgentTransformResult,
} from "./shared/agents.transform"
export { applyAgentEntry, registerAgentTransform } from "./shared/agents.transform"
export type { AvailableAgent, AvailableCategory, AvailableSkill } from "./shared/dynamic-agent-prompt-builder"
export * from "./shared/types"
