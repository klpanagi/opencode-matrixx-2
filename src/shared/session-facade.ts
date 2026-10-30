import { log } from "./logger"

export type FacadeResult<T> = { ok: true; value: T } | { ok: false; error: Error }

export type SessionPromptBody = Record<string, unknown>
export type SessionQuery = Record<string, unknown>
export type SessionBody = Record<string, unknown>

export type SessionDomainLike = {
  context(args: { sessionID: string }): Promise<unknown>
  get(args: { sessionID: string }): Promise<unknown>
  list(query?: SessionQuery): Promise<unknown>
  create(body?: SessionBody): Promise<unknown>
  prompt(args: { sessionID: string } & SessionPromptBody): Promise<unknown>
  interrupt(args: { sessionID: string }): Promise<unknown>
  compact(args: { sessionID: string }): Promise<unknown>
  switchAgent(args: { sessionID: string } & SessionBody): Promise<unknown>
  switchModel(args: { sessionID: string } & SessionBody): Promise<unknown>
  wait(args: { sessionID: string }): Promise<unknown>
}

export type SessionFacadeDeps = { session: SessionDomainLike }

export type SessionFacade = {
  getContext(sessionID: string): Promise<FacadeResult<unknown>>
  getSession(sessionID: string): Promise<FacadeResult<unknown>>
  listSessions(query?: SessionQuery): Promise<FacadeResult<unknown>>
  createSession(body?: SessionBody): Promise<FacadeResult<unknown>>
  prompt(sessionID: string, body?: SessionPromptBody): Promise<FacadeResult<unknown>>
  promptAsync(sessionID: string, body?: SessionPromptBody): Promise<FacadeResult<true>>
  interrupt(sessionID: string): Promise<FacadeResult<unknown>>
  compact(sessionID: string): Promise<FacadeResult<unknown>>
  switchAgent(sessionID: string, body?: SessionBody): Promise<FacadeResult<unknown>>
  switchModel(sessionID: string, body?: SessionBody): Promise<FacadeResult<unknown>>
  waitForIdle(sessionID: string): Promise<FacadeResult<unknown>>
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown))
}

async function settle<T>(run: () => Promise<T>): Promise<FacadeResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (thrown) {
    return { ok: false, error: toError(thrown) }
  }
}

export function createSessionFacade(deps: SessionFacadeDeps): SessionFacade {
  const { session } = deps

  return {
    getContext: (sessionID) => settle(() => session.context({ sessionID })),
    getSession: (sessionID) => settle(() => session.get({ sessionID })),
    listSessions: (query) => settle(() => session.list(query)),
    createSession: (body) => settle(() => session.create(body)),
    prompt: (sessionID, body) => settle(() => session.prompt({ sessionID, ...(body ?? {}) })),
    promptAsync: async (sessionID, body) => {
      const launch = session.prompt({ sessionID, ...(body ?? {}) })
      Promise.resolve(launch).catch((thrown: unknown) => {
        log(`[matrixx] promptAsync generation rejected for ${sessionID}: ${toError(thrown).message}`)
      })
      return { ok: true, value: true }
    },
    interrupt: (sessionID) => settle(() => session.interrupt({ sessionID })),
    compact: (sessionID) => settle(() => session.compact({ sessionID })),
    switchAgent: (sessionID, body) => settle(() => session.switchAgent({ sessionID, ...(body ?? {}) })),
    switchModel: (sessionID, body) => settle(() => session.switchModel({ sessionID, ...(body ?? {}) })),
    waitForIdle: (sessionID) => settle(() => session.wait({ sessionID })),
  }
}
