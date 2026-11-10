import { describe, expect, test } from "bun:test"
import { NIOBE_SYSTEM_PROMPT } from "../../../../src/agents/definitions/niobe/default"
import { NIOBE_GPT_SYSTEM_PROMPT } from "../../../../src/agents/definitions/niobe/gpt"

/**
 * RED pins for the Niobe orchestrator prompt wording fix.
 *
 * Native-subagent migration: the prompts say `Use subagent() with `agent`
 * (a `mouse-<category>` worker or a named agent)`. The native OpenCode
 * `subagent` tool's required key is literally `agent` (`mouse-<category>`
 * workers replace the retired plugin task tool's `category` arg).
 *
 * GREEN (this task, src+tests): reword the delegation line to name `agent`
 * and add an explicit ALWAYS-native-subagent sentence.
 */

const PROMPT_SOURCES: ReadonlyArray<{ readonly name: string; readonly prompt: string }> = [
  { name: "default (Claude-optimized)", prompt: NIOBE_SYSTEM_PROMPT },
  { name: "gpt (GPT-optimized)", prompt: NIOBE_GPT_SYSTEM_PROMPT },
]

for (const source of PROMPT_SOURCES) {
  describe(`Niobe orchestrator prompt [${source.name}]`, () => {
    test("names the native subagent arg agent", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const hasRealArg: boolean = prompt.includes('agent="mouse-') || prompt.includes('agent="[')

      //#then
      expect(hasRealArg).toBe(true)
    })

    test("does NOT contain the retired plugin task tool call", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const leaksLegacyTaskCall: boolean = /\btask\s*\(/.test(prompt)

      //#then
      expect(leaksLegacyTaskCall).toBe(false)
    })

    test("contains an ALWAYS-native-subagent sentence", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const lowerPrompt: string = prompt.toLowerCase()

      //#then
      expect(lowerPrompt).toContain(
        "always use the native subagent tool for delegation",
      )
    })
  })
}
