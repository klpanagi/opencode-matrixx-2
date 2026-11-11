import type { SessionDomainLike } from "../../shared/session/session-facade"

export type SubagentControlAction = "cancel" | "wait"

export interface SubagentControlArgs {
  action: SubagentControlAction
  session_id: string
  timeout?: number
}

export type SubagentControlClient = {
  session: Pick<SessionDomainLike, "get" | "interrupt" | "wait">
}
