import { describe, expect, it } from "bun:test"
import type { BuiltinSkill } from "../../../src/skills"
import type { InstalledPackSkill } from "../../../src/skills/packs"
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool"
import { createSkillTool } from "../../../src/tools/skill/tools"

const toolContext: MatrixxToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function builtinSkill(name: string, template = `${name} builtin template`): BuiltinSkill {
  return { name, description: `${name} builtin description`, template }
}

function packSkill(
  name: string,
  packId: InstalledPackSkill["packId"] = "ui-ux-pro-max",
  template = `${name} pack template`,
): InstalledPackSkill {
  return {
    name,
    description: `${name} pack description`,
    template,
    packId,
    packRoot: `/packs/${packId}`,
    skillRoot: `/packs/${packId}/skills/${name}`,
    risk: [],
    source: "pack",
  }
}

async function runSkill(
  tool: ReturnType<typeof createSkillTool>,
  name: string,
): Promise<string> {
  const result = await tool.execute({ name }, toolContext)
  if (typeof result !== "string") throw new Error("expected string tool result")
  return result
}

describe("skill tool - installed pack refresh seam", () => {
  it("lists installed pack skill names separately from the builtin list", () => {
    //#given builtin and pack skills merged into the tool
    const skills: BuiltinSkill[] = [
      builtinSkill("git-master"),
      packSkill("ui-ux-pro-max"),
      packSkill("brand", "brand"),
    ]
    const tool = createSkillTool({ skills, refresh: () => skills })

    //#when the description is read
    const description = tool.description

    //#then builtins stay in available_skills and packs get their own section
    expect(description).toContain("<skill>git-master</skill>")
    expect(description).toContain("Installed skill packs: ui-ux-pro-max, brand")
  })

  it("executes a pack skill with its heading and sanitized template", async () => {
    //#given a pack skill supplied through the refresh seam
    const tool = createSkillTool({ refresh: () => [packSkill("ui-ux-pro-max")] })

    //#when the pack skill is executed
    const output = await runSkill(tool, "ui-ux-pro-max")

    //#then the standard heading and sanitized template are returned
    expect(output).toContain("## Skill: ui-ux-pro-max")
    expect(output).toContain("ui-ux-pro-max pack template")
  })

  it("picks up a newly installed pack on the next refresh", async () => {
    //#given a tool whose refresh source starts without the pack
    let skills: BuiltinSkill[] = [builtinSkill("git-master")]
    const tool = createSkillTool({ refresh: () => skills })

    //#when the pack is not installed yet
    //#then the skill is reported missing
    await expect(tool.execute({ name: "brand" }, toolContext)).rejects.toThrow(
      'Skill "brand" not found',
    )

    //#when the installer adds the pack to the refresh source
    skills = [builtinSkill("git-master"), packSkill("brand", "brand")]

    //#then the same tool can execute the new pack skill
    const output = await runSkill(tool, "brand")
    expect(output).toContain("## Skill: brand")
    expect(output).toContain("brand pack template")
  })

  it("never emits duplicate names and keeps the builtin on collision", async () => {
    //#given a pack skill that reuses a builtin name
    const skills: BuiltinSkill[] = [
      builtinSkill("shared", "shared builtin body"),
      packSkill("shared", "brand", "shared pack body"),
    ]
    const tool = createSkillTool({ refresh: () => skills })

    //#when the tool lists and executes the shared name
    const description = tool.description
    const output = await runSkill(tool, "shared")

    //#then only one entry exists and the builtin template wins
    expect(description.split("<skill>shared</skill>").length - 1).toBe(1)
    expect(output).toContain("shared builtin body")
    expect(output).not.toContain("shared pack body")
  })

  it("returns an empty catalog when the pack seam is disabled", async () => {
    //#given a disabled pack seam with skills still configured
    const tool = createSkillTool({
      skills: [builtinSkill("git-master")],
      refresh: () => [packSkill("brand", "brand")],
      isEnabled: () => false,
    })

    //#when the description and execution are requested
    //#then no skills are advertised or executable
    expect(tool.description).toContain("No skills are currently available")
    await expect(tool.execute({ name: "git-master" }, toolContext)).rejects.toThrow(
      'Skill "git-master" not found',
    )
  })

  it("keeps the eager description when no refresh seam is provided", async () => {
    //#given a tool built from a fixed skill list (no refresh)
    const tool = createSkillTool({ skills: [builtinSkill("playwright")] })

    //#when the description and execution are requested
    //#then behavior is unchanged from the pre-pack contract
    expect(tool.description).toContain("<skill>playwright</skill>")
    expect(tool.description).not.toContain("Installed skill packs")
    const output = await runSkill(tool, "playwright")
    expect(output).toContain("## Skill: playwright")
  })
})
