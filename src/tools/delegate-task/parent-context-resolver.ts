import { resolveMessageContext } from "../../features/context-injection/hook-bridge"
import { getSessionAgent } from "../../features/session-state/state"
import { getMessageDir } from "../../shared/opencode/opencode-message-dir"
import { log } from "../../shared/runtime/logger"
import type { ParentContext } from "./executor-types"
import type { NativeClient, ToolContextWithMetadata } from "./types"

export async function resolveParentContext(
  ctx: ToolContextWithMetadata,
  client: NativeClient
): Promise<ParentContext> {
  if (typeof ctx.sessionID !== "string" || ctx.sessionID.trim() === "") {
    throw new Error("Parent session ID is required to resolve parent context")
  }
  const messageDir = getMessageDir(ctx.sessionID)
  const { prevMessage, firstMessageAgent } = await resolveMessageContext(
    ctx.sessionID,
    client as unknown as Parameters<typeof resolveMessageContext>[1],
    messageDir
  )

  const sessionAgent = getSessionAgent(ctx.sessionID)
  const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

  log("[task] parentAgent resolution", {
    sessionID: ctx.sessionID,
    messageDir,
    ctxAgent: ctx.agent,
    sessionAgent,
    firstMessageAgent,
    prevMessageAgent: prevMessage?.agent,
    resolvedParentAgent: parentAgent,
  })

  const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
    ? {
        providerID: prevMessage.model.providerID,
        modelID: prevMessage.model.modelID,
        ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {}),
      }
    : undefined

  return {
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    agent: parentAgent,
    model: parentModel,
  }
}
