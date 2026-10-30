import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  EVENT_CONSUMERS,
  fixtureFileFor,
  HOOK_CONSUMER_MAP,
  NON_DISPATCH_CONSUMERS,
} from "./manifest"

const EVENTS_DIR = import.meta.dir
const EVENT_SOURCE = join(EVENTS_DIR, "..", "..", "..", "src", "plugin", "event.ts")
const MANIFEST_FIXTURE = "manifest.test.ts"

function dispatchedHookNames(): string[] {
  const source = readFileSync(EVENT_SOURCE, "utf8")
  const names = new Set<string>()
  for (const match of source.matchAll(/hooks\.([A-Za-z]+)\?/g)) {
    names.add(match[1])
  }
  return [...names].sort()
}

function fixtureFiles(): string[] {
  return readdirSync(EVENTS_DIR)
    .filter((name) => name.endsWith(".test.ts") && name !== MANIFEST_FIXTURE)
    .sort()
}

describe("event consumer manifest", () => {
  it("covers every hook dispatched by createEventHandler", () => {
    // given the dispatch list parsed from src/plugin/event.ts
    const dispatched = dispatchedHookNames()

    // then every dispatched hook is mapped to a consumer
    expect(dispatched.length).toBeGreaterThan(0)
    const unmapped = dispatched.filter((name) => HOOK_CONSUMER_MAP[name] === undefined)
    expect(unmapped).toEqual([])
  })

  it("maps every hook to a listed consumer", () => {
    // given the mapped consumers
    const mapped = Object.values(HOOK_CONSUMER_MAP)

    // then each one appears in the consumer list
    const missing = mapped.filter((consumer) => !EVENT_CONSUMERS.includes(consumer))
    expect(missing).toEqual([])
  })

  it("lists every consumer reached outside the dispatch list", () => {
    // given the inline consumers
    const missing = NON_DISPATCH_CONSUMERS.filter((consumer) => !EVENT_CONSUMERS.includes(consumer))

    // then none of them is missing from the list
    expect(missing).toEqual([])
  })

  it("gives every consumer a fixture file", () => {
    // given the consumer list
    const missing = EVENT_CONSUMERS.filter(
      (consumer) => !existsSync(join(EVENTS_DIR, fixtureFileFor(consumer))),
    )

    // then each consumer has a fixture on disk
    expect(missing).toEqual([])
  })

  it("holds exactly one fixture per consumer and nothing else", () => {
    // given the fixture files present
    const files = fixtureFiles()

    // then they are exactly the manifest, and the count matches the manifest plus this test
    expect(files).toEqual(EVENT_CONSUMERS.map(fixtureFileFor).slice().sort())
    expect(files.length + 1).toBe(EVENT_CONSUMERS.length + 1)
  })
})
