import { describe, expect, test } from "bun:test"
import { NIOBE_SYSTEM_PROMPT } from "../../../src/agents/niobe/default"
import { NIOBE_GPT_SYSTEM_PROMPT } from "../../../src/agents/niobe/gpt"

/**
 * RED pins for the Niobe orchestrator prompt wording fix.
 *
 * Root cause: the prompts say `Use task() with EITHER category OR agent
 * (mutually exclusive)` but the plugin task tool's real args are `category`
 * OR `subagent_type` (src/tools/delegate-task/tools.ts:102-129). The word
 * "agent" primes models to call the native OpenCode `subagent` tool whose
 * required key is literally `agent` -> core zod error "agent: Missing key".
 *
 * GREEN (later task, src-only): reword the delegation line to name
 * `subagent_type` and add an explicit NEVER-native-subagent sentence.
 */

const PROMPT_SOURCES: ReadonlyArray<{ readonly name: string; readonly prompt: string }> = [
  { name: "default (Claude-optimized)", prompt: NIOBE_SYSTEM_PROMPT },
  { name: "gpt (GPT-optimized)", prompt: NIOBE_GPT_SYSTEM_PROMPT },
]

for (const source of PROMPT_SOURCES) {
  describe(`Niobe orchestrator prompt [${source.name}]`, () => {
    test("names the real plugin task arg subagent_type", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const hasRealArg: boolean = prompt.includes("subagent_type")

      //#then
      expect(hasRealArg).toBe(true)
    })

    test("does NOT contain the leaky bare phrase OR agent", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const leaksBareAgentWord: boolean = prompt.includes("OR agent")

      //#then
      expect(leaksBareAgentWord).toBe(false)
    })

    test("contains a NEVER-native-subagent sentence", () => {
      //#given
      const prompt: string = source.prompt

      //#when
      const lowerPrompt: string = prompt.toLowerCase()

      //#then
      expect(lowerPrompt).toContain(
        "never call the native subagent tool; always use the plugin task tool",
      )
    })
  })
}
