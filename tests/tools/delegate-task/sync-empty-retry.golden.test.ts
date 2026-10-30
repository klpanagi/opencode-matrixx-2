/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { isSessionEmpty } from "../../../src/tools/delegate-task/sync-empty-retry"

function clientReturning(payload: unknown) {
  return { session: { messages: async () => ({ data: payload }) } } as never
}

describe("golden: isSessionEmpty", () => {
  test("returns true for an empty data envelope", async () => {
    //#given a client whose session.messages returns an empty data array
    const client = clientReturning([])

    //#when
    const empty = await isSessionEmpty(client, "ses_golden")

    //#then
    expect(empty).toBe(true)
  })

  test("returns false for the non-empty corpora", async () => {
    //#given clients that return the v1-shaped and v2-flat corpora
    const v1 = await isSessionEmpty(clientReturning(loadCorpus("v1-shaped")), "ses_golden")
    const v2 = await isSessionEmpty(clientReturning(loadCorpus("v2-flat")), "ses_golden")

    //#then
    expect(v1).toBe(false)
    expect(v2).toBe(false)
  })

  test("returns false, never throws, for a null payload", async () => {
    //#given a client that returns null instead of a data envelope
    const client = { session: { messages: async () => null } } as never

    //#when
    const empty = await isSessionEmpty(client, "ses_golden")

    //#then
    expect(empty).toBe(false)
  })

  test("returns false, never throws, for a string payload", async () => {
    //#given a client that returns a bare string
    const client = { session: { messages: async () => "not a list" } } as never

    //#when
    const empty = await isSessionEmpty(client, "ses_golden")

    //#then
    expect(empty).toBe(false)
  })

  test("returns false, never throws, when the client rejects", async () => {
    //#given a client whose session.messages rejects
    const client = {
      session: {
        messages: async () => {
          throw new Error("boom")
        },
      },
    } as never

    //#when
    const empty = await isSessionEmpty(client, "ses_golden")

    //#then
    expect(empty).toBe(false)
  })
})
