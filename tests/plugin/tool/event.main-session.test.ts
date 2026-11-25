/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../../../src/config"
import {
  _resetForTesting,
  getMainSessionID,
  getParentSessionID,
  hasSubagentSession,
  resolveMainSessionFor,
} from "../../../src/features/session-state/state"
import type { DomainHooks, DomainManagers } from "../../../src/plugin/setup-domains"
import type { V2Event } from "../../../src/plugin/tool/context"
import { createEventHandler, resetAllSessionState } from "../../../src/plugin/tool/event"
import { resolveSessionDepth } from "../../../src/shared/subagent/nested-depth"

const SESSION_A = "ses_main_a"
const SESSION_B = "ses_main_b"
const CHILD = "ses_main_child"

function buildHandler(dispatched: V2Event[] = []) {
  const onEvent = async (event: V2Event): Promise<void> => {
    dispatched.push(event)
  }

  return createEventHandler({
    ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {} as unknown as DomainManagers,
    hooks: {
      autoUpdateChecker: { event: onEvent },
    } as unknown as DomainHooks,
  })
}

function sessionCreated(id: string, parentID?: string): V2Event {
  return { type: "session.created", data: { info: { id, ...(parentID ? { parentID } : {}) } } }
}

function sessionDeleted(id: string): V2Event {
  return { type: "session.deleted", data: { info: { id } } }
}

describe("createEventHandler - main session identity", () => {
  beforeEach(() => {
    // given - clean session identity state before each case
    _resetForTesting()
  })

  afterEach(() => {
    // then - no state leaks into sibling suites
    _resetForTesting()
  })

  test("does not hijack the first session fallback when a second top-level session appears", async () => {
    //#given - two top-level sessions are created in the same process
    const handler = buildHandler()
    await handler(sessionCreated(SESSION_A))
    await handler(sessionCreated(SESSION_B))

    //#when - an event belonging to A resolves "the main session"
    const resolvedForA = resolveMainSessionFor(SESSION_A)

    //#then - A wins, never B
    expect(resolvedForA).toBe(SESSION_A)
    expect(resolvedForA).not.toBe(SESSION_B)
    expect(getMainSessionID()).toBe(SESSION_A)
  })

  test("re-elects a surviving top-level session when the primary is deleted", async () => {
    //#given
    const handler = buildHandler()
    await handler(sessionCreated(SESSION_A))
    await handler(sessionCreated(SESSION_B))
    expect(getMainSessionID()).toBe(SESSION_A)

    //#when - the elected primary goes away
    await handler(sessionDeleted(SESSION_A))

    //#then - B takes over instead of the primary going undefined
    expect(getMainSessionID()).toBe(SESSION_B)
    expect(resolveMainSessionFor()).toBe(SESSION_B)
  })

  test("registers a child session from session.created so the depth gate is live", async () => {
    //#given
    const handler = buildHandler()
    await handler(sessionCreated(SESSION_A))

    //#when - a child session arrives with parentID
    await handler(sessionCreated(CHILD, SESSION_A))

    //#then - the registry knows the child and depth resolves for both
    expect(hasSubagentSession(CHILD)).toBe(true)
    expect(getParentSessionID(CHILD)).toBe(SESSION_A)
    expect(resolveSessionDepth(CHILD)).toBe(1)
    expect(resolveSessionDepth(SESSION_A)).toBe(0)

    //#when - the child session is deleted
    await handler(sessionDeleted(CHILD))

    //#then - the registry no longer holds it
    expect(hasSubagentSession(CHILD)).toBe(false)
    expect(resolveSessionDepth(CHILD)).toBe(0)
  })

  test("dispose reset clears the primary and the subagent registry", async () => {
    //#given
    const handler = buildHandler()
    await handler(sessionCreated(SESSION_A))
    await handler(sessionCreated(CHILD, SESSION_A))

    //#when
    resetAllSessionState()

    //#then
    expect(getMainSessionID()).toBeUndefined()
    expect(hasSubagentSession(CHILD)).toBe(false)
  })

  test("dispose reset drops idle-dedupe memory so the next real idle dispatches", async () => {
    //#given - a synthetic idle leaves dedupe memory behind
    const dispatched: V2Event[] = []
    const handler = buildHandler(dispatched)
    const sessionID = "ses_main_dedup_reset"
    await handler({ type: "session.status", data: { sessionID, status: { type: "idle" } } })
    expect(dispatched.filter((event) => event.type === "session.idle")).toHaveLength(1)

    //#when - dispose reset runs and the handler observes the next event
    resetAllSessionState()

    //#then - the real idle is no longer deduped against the stale synthetic one
    await handler({ type: "session.idle", data: { sessionID } })
    expect(dispatched.filter((event) => event.type === "session.idle")).toHaveLength(2)
  })
})
