import { log } from "./logger"
import { isRecord } from "./record-type-guard"

export interface EphemeralSessionHandle {
  create(body: { title: string; parentID?: string }): Promise<unknown>
  remove(args: { sessionID: string }): Promise<unknown>
}

export interface EphemeralSessionOptions<T> {
  session: EphemeralSessionHandle
  title: string
  parentID?: string
  body: (sessionID: string) => Promise<T>
}

function isNotFoundError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "")
  return text.includes("404")
}

function idOfCreated(created: unknown): string {
  if (isRecord(created) && typeof created.id === "string") return created.id
  return ""
}

// Runs `body` with a throwaway child session that is always removed
// afterwards, so idle/compact triggers cannot accumulate rows in the TUI
// session list. Cleanup failures are logged and swallowed; a body failure
// always propagates unchanged from the finally block below.
export async function withEphemeralSession<T>(options: EphemeralSessionOptions<T>): Promise<T> {
  const { session, title, parentID, body } = options
  const created = await session.create({ title, ...(parentID ? { parentID } : {}) })
  const sessionID = idOfCreated(created)
  if (!sessionID) throw new Error("with-ephemeral-session: host session create failed")
  try {
    return await body(sessionID)
  } finally {
    try {
      await session.remove({ sessionID })
    } catch (error) {
      if (!isNotFoundError(error)) {
        log("[with-ephemeral-session] cleanup remove failed", { error: String(error) })
      }
    }
  }
}
