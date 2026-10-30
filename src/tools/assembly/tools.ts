import { z } from "zod"
import type { AssemblyConfig } from "../../config/schema/assembly"
import type { BackgroundManager } from "../../features/background-agent/manager"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { executeAssembly } from "./assembly-executor"
import { TOOL_DESCRIPTION } from "./tool-description"
import { AssemblyArgsSchema } from "./types"

export interface AssemblyToolOptions {
  manager: BackgroundManager
  pluginConfig?: { assembly?: AssemblyConfig }
}

export function createAssemblyTool(
  options: AssemblyToolOptions,
): MatrixxToolDefinition {
  return defineTool("assembly", {
    description: TOOL_DESCRIPTION,
    args: {
      question: z.string().describe("The question or decision to reach consensus on"),
      voters: z.number().optional().describe("Number of voters (2-5, default: 3)"),
      rounds: z.number().optional().describe("Number of synthesis rounds (1-3, default: 2)"),
      models: z.array(z.string()).optional().describe("Override auto-selected models"),
    },
    async execute(args, toolContext) {
      const parsed = AssemblyArgsSchema.parse(args)

      const output = await executeAssembly({
        manager: options.manager,
        args: parsed,
        config: options.pluginConfig?.assembly,
        sessionID: toolContext.sessionID,
        messageID: toolContext.messageID,
      })

      return output.finalConsensus
    },
  })
}
