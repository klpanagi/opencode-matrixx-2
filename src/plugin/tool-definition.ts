import { defineTool } from "../tools/shared/define-tool";
import type { DomainHooks } from "./setup-domains";

export const toolAuthoringEntry = defineTool;

export function createToolDefinitionHandler(args: {
  hooks: DomainHooks
}): (
  input: { toolID: string },
  output: { description: string; parameters: unknown },
) => Promise<void> {
  const { hooks: _hooks } = args

  return async (
    _input: { toolID: string },
    _output: { description: string; parameters: unknown },
  ): Promise<void> => {
  }
}
