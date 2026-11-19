/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { replayPackSkills } from "../../../src/plugin/setup-domains/assemble"
import type { LoadInstalledPacksOptions } from "../../../src/skills/packs/loader"
import type { BuiltinSkill } from "../../../src/skills/loader/types"

function packSkill(name: string): BuiltinSkill {
  return { name, description: `${name} description`, template: "template" }
}

function createSkillDomain(added: unknown[]): {
  skill: { transform(callback: (editor: { add(entry: unknown): void }) => void): Promise<unknown> }
} {
  return {
    skill: {
      transform: async (callback) => {
        callback({ add: (entry) => added.push(entry) })
        return {}
      },
    },
  }
}

describe("replayPackSkills", () => {
  test("adds one editor entry per installed pack skill", async () => {
    //#given
    const added: unknown[] = []
    const ctx = createSkillDomain(added)
    const seen: LoadInstalledPacksOptions[] = []

    //#when
    const registration = await replayPackSkills(
      ctx,
      { skill_packs: { root: "/tmp/matrixx-packs", disabled_packs: ["skip"], disabled_skills: ["skip/one"] } },
      {
        loadPacks: (options) => {
          seen.push(options)
          return [packSkill("alpha"), packSkill("beta")]
        },
      },
    )

    //#then
    expect(added).toHaveLength(2)
    expect(added.map((entry) => (entry as { name: string }).name)).toEqual(["alpha", "beta"])
    expect(seen).toEqual([
      { root: "/tmp/matrixx-packs", disabledPacks: ["skip"], disabledSkills: ["skip/one"] },
    ])
    expect(registration).toBeDefined()
  })

  test("enabled:false neither loads packs nor adds entries", async () => {
    //#given
    const added: unknown[] = []
    const ctx = createSkillDomain(added)
    let loadCalls = 0

    //#when
    const registration = await replayPackSkills(
      ctx,
      { skill_packs: { enabled: false } },
      {
        loadPacks: () => {
          loadCalls += 1
          return [packSkill("alpha")]
        },
      },
    )

    //#then
    expect(loadCalls).toBe(0)
    expect(added).toEqual([])
    expect(registration).toBeUndefined()
  })

  test("absent skill_packs block neither loads packs nor adds entries", async () => {
    //#given
    const added: unknown[] = []
    const ctx = createSkillDomain(added)
    let loadCalls = 0

    //#when
    await replayPackSkills(ctx, {}, { loadPacks: () => (loadCalls += 1, []) })

    //#then
    expect(loadCalls).toBe(0)
    expect(added).toEqual([])
  })

  test("zero installed skills skips the transform replay", async () => {
    //#given
    const added: unknown[] = []
    const ctx = createSkillDomain(added)
    let replayCalls = 0

    //#when
    const registration = await replayPackSkills(ctx, { skill_packs: {} }, {
      loadPacks: () => [],
      replay: async () => {
        replayCalls += 1
        return { registration: {}, registered: [] }
      },
    })

    //#then
    expect(replayCalls).toBe(0)
    expect(added).toEqual([])
    expect(registration).toBeUndefined()
  })

  test("a throwing loader is swallowed and setup continues", async () => {
    //#given
    const added: unknown[] = []
    const ctx = createSkillDomain(added)

    //#when
    let caught: unknown
    let registration: unknown
    try {
      registration = await replayPackSkills(ctx, { skill_packs: {} }, {
        loadPacks: () => {
          throw new Error("boom")
        },
      })
    } catch (error) {
      caught = error
    }

    //#then
    expect(caught).toBeUndefined()
    expect(registration).toBeUndefined()
    expect(added).toEqual([])
  })

  test("a throwing skill transform is swallowed and setup continues", async () => {
    //#given
    const ctx = {
      skill: {
        transform: async () => {
          throw new Error("transform exploded")
        },
      },
    }

    //#when
    let caught: unknown
    let registration: unknown
    try {
      registration = await replayPackSkills(ctx, { skill_packs: {} }, {
        loadPacks: () => [packSkill("alpha")],
      })
    } catch (error) {
      caught = error
    }

    //#then
    expect(caught).toBeUndefined()
    expect(registration).toBeUndefined()
  })
})
