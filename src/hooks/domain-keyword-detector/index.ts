export {
  DOMAIN_HINT_MARKER,
  DOMAIN_SKILL_ROUTES,
  type DomainSkillRoute,
  MAX_DOMAIN_HINT_CHARS,
} from "./constants"
export { buildDomainHint, detectDomainSkills, extractMessageText } from "./detector"
export { createDomainKeywordDetectorHook } from "./hook"
