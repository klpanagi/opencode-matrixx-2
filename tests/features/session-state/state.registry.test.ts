/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  _resetForTesting,
  clearMainSession,
  getMainSessionID,
  getParentSessionID,
  hasSubagentSession,
  registerSubagentSession,
  resetSessionStateForDispose,
  resolveMainSessionFor,
  setMainSession,
} from "../../../src/features/session-state/state"

const SESSION_A = "ses_registry_a"
const SESSION_B = "ses_registry_b"
const SESSION_C = "ses_registry_c"

describe("session-state registry", () => {
  beforeEach(() => {
    // given - clean process-global state before each case
    _resetForTesting()
  })

  afterEach(() => {
    // then - no state leaks into sibling suites
    _resetForTesting()
  })

  describe("setMainSession", () => {
    test("keeps the first-seen top-level session as primary", () => {
      //#given
      setMainSession(SESSION_A)

      //#when
      setMainSession(SESSION_B)

      //#then
      expect(getMainSessionID()).toBe(SESSION_A)
    })

    test("clears the primary and the live set when passed undefined", () => {
      //#given
      setMainSession(SESSION_A)
      setMainSession(SESSION_B)

      //#when
      setMainSession(undefined)

      //#then
      expect(getMainSessionID()).toBeUndefined()
      expect(resolveMainSessionFor()).toBeUndefined()
    })
  })

  describe("resolveMainSessionFor", () => {
    test("prefers the explicit session id over the elected primary", () => {
      //#given
      setMainSession(SESSION_A)

      //#when
      const resolved = resolveMainSessionFor(SESSION_B)

      //#then
      expect(resolved).toBe(SESSION_B)
    })

    test("falls back to the primary when no session id is given", () => {
      //#given
      setMainSession(SESSION_A)

      //#when
      const resolved = resolveMainSessionFor(undefined)

      //#then
      expect(resolved).toBe(SESSION_A)
    })

    test("returns undefined when nothing is known", () => {
      //#given - no session has been created
      //#when
      const resolved = resolveMainSessionFor()

      //#then
      expect(resolved).toBeUndefined()
    })
  })

  describe("clearMainSession", () => {
    test("re-elects the oldest surviving top-level session after the primary is deleted", () => {
      //#given
      setMainSession(SESSION_A)
      setMainSession(SESSION_B)
      setMainSession(SESSION_C)

      //#when
      clearMainSession(SESSION_A)

      //#then
      expect(getMainSessionID()).toBe(SESSION_B)
    })

    test("walks first-seen order as further primaries disappear", () => {
      //#given
      setMainSession(SESSION_A)
      setMainSession(SESSION_B)
      setMainSession(SESSION_C)

      //#when
      clearMainSession(SESSION_A)
      clearMainSession(SESSION_B)

      //#then
      expect(getMainSessionID()).toBe(SESSION_C)

      //#when - last survivor goes away too
      clearMainSession(SESSION_C)

      //#then
      expect(getMainSessionID()).toBeUndefined()
    })

    test("leaves the primary untouched when a non-primary session is deleted", () => {
      //#given
      setMainSession(SESSION_A)
      setMainSession(SESSION_B)

      //#when
      clearMainSession(SESSION_B)

      //#then
      expect(getMainSessionID()).toBe(SESSION_A)
    })
  })

  describe("resetSessionStateForDispose", () => {
    test("clears the primary, the live set and the subagent registry", () => {
      //#given
      setMainSession(SESSION_A)
      setMainSession(SESSION_B)
      registerSubagentSession("ses_registry_child", SESSION_A)
      expect(hasSubagentSession("ses_registry_child")).toBe(true)

      //#when
      resetSessionStateForDispose()

      //#then
      expect(getMainSessionID()).toBeUndefined()
      expect(resolveMainSessionFor()).toBeUndefined()
      expect(hasSubagentSession("ses_registry_child")).toBe(false)
      expect(getParentSessionID("ses_registry_child")).toBeUndefined()
    })

    test("is idempotent so a second dispose does not throw", () => {
      //#given
      setMainSession(SESSION_A)

      //#when
      resetSessionStateForDispose()
      resetSessionStateForDispose()

      //#then
      expect(getMainSessionID()).toBeUndefined()
    })
  })
})
