/**
 * V2-native skill domain transform (D4).
 *
 * Owned by `src/skills/`: pure replay of skill entries onto
 * `ctx.skill.transform`. The entry builders in `./skills` are static data plus
 * allocation-only wrappers — no filesystem access, no spawn, no network — so
 * repeated runs over the same entries replay identically.
 */

import type { BuiltinSkill } from "./types"

/** Minimal structural editor: the real V2 skill editor satisfies this. */
export interface SkillTransformEditor {
  add(entry: unknown): void
}

export interface SkillTransformDomain {
  transform(callback: (editor: SkillTransformEditor) => void): Promise<unknown>
}

export interface RegisterSkillTransformResult {
  registration: unknown
  /** Skill names replayed onto the domain. */
  registered: string[]
}

/**
 * Pure replay: skill entries → `ctx.skill.transform`.
 * The only effect is the single `transform` call; the callback only calls
 * `editor.add`, so re-running over the same entries replays identically.
 */
export async function registerSkillTransform(
  skill: SkillTransformDomain,
  entries: Record<string, unknown> | BuiltinSkill[] | undefined,
): Promise<RegisterSkillTransformResult> {
  const registered: string[] = []
  const registration = await skill.transform((editor) => {
    const list: Array<Record<string, unknown>> = Array.isArray(entries)
      ? entries.map((entry) => ({ ...(entry as unknown as Record<string, unknown>) }))
      : Object.entries(entries ?? {}).map(([name, entry]) => ({
          ...(entry !== null && typeof entry === "object"
            ? (entry as Record<string, unknown>)
            : {}),
          name,
        }))
    for (const record of list) {
      editor.add(record)
      if (typeof record.name === "string") registered.push(record.name)
    }
  })
  return { registration, registered }
}
