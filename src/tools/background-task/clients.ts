import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import type { SessionMessage } from "../../shared/session/session-message"

export type BackgroundOutputMessage = SessionMessage

export type BackgroundOutputMessagesResult =
  | { data?: unknown[]; error?: unknown }
  | unknown[]

export type BackgroundOutputClient = {
  session: {
    messages: (args: { path: { id: string } }) => Promise<BackgroundOutputMessagesResult>
  }
}

export type BackgroundCancelClient = {
  session: {
    interrupt: (args: { sessionID: string }) => Promise<unknown>
  }
}

export type BackgroundOutputManager = Pick<BackgroundManager, "getTask"> & {
  findBySession?: (sessionId: string) => BackgroundTask | undefined
}
