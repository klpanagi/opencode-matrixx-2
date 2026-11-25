/// <reference types="bun-types" />
import { clearLazyTemplateCache } from "../../../src/skills/loader/lazy-skill-helper"
import { createBuiltinSkills } from "../../../src/skills/loader/factories"
import { formatTimingStats, time } from "../../perf/bench-utils"

const ITERS = 500

// Construction must stay allocation-only: no skill module is evaluated here.
const construct = time(() => createBuiltinSkills(), ITERS)

// Full first-load: one pass that hydrates every lazy template via its loader.
clearLazyTemplateCache()
const hydrateStart = performance.now()
const skills = createBuiltinSkills()
let templateChars = 0
for (const skill of skills) {
  templateChars += skill.template.length
}
const hydrateMs = performance.now() - hydrateStart

console.log(formatTimingStats("createBuiltinSkills (construct only)", construct))
console.log(
  JSON.stringify({
    firstFullHydrationMs: Number(hydrateMs.toFixed(3)),
    skills: skills.length,
    templateChars,
  }),
)
