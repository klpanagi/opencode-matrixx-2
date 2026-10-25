import { describe, expect, test } from "bun:test"
import { createDomainKeywordDetectorHook } from "../../../src/hooks/domain-keyword-detector"

type DomainHook = ReturnType<typeof createDomainKeywordDetectorHook>
type Output = Parameters<DomainHook["experimental.chat.messages.transform"]>[1]

function outputWith(text: string): Output {
  return {
    messages: [{ info: { role: "user" }, parts: [{ type: "text", text }] }],
  }
}

function textOf(output: Output): string {
  return output.messages[0]?.parts[0]?.text ?? ""
}

describe("domain-keyword-detector", () => {
  test("injects matching finance skills when a domain keyword is present", async () => {
    //#given
    const hook = createDomainKeywordDetectorHook()
    const output = outputWith("fetch OHLCV candles with ccxt")

    //#when
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then
    const text = textOf(output)
    expect(text).toContain("[domain-skills]")
    expect(text).toContain("ccxt-rest")
    expect(text).toContain("---")
    expect(text).toContain("fetch OHLCV candles with ccxt")
  })

  test("is a no-op when the message has no domain keywords", async () => {
    //#given
    const hook = createDomainKeywordDetectorHook()
    const output = outputWith("just a normal message about nothing")

    //#when
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then
    expect(textOf(output)).toBe("just a normal message about nothing")
  })

  test("maps zeromq and influxdb keywords to their skills", async () => {
    //#given
    const hook = createDomainKeywordDetectorHook()
    const output = outputWith("publish ticks over zmq and store them in influxdb")

    //#when
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then
    const text = textOf(output)
    expect(text).toContain("zeromq-core")
    expect(text).toContain("influxdb-timeseries")
  })

  test("is idempotent across repeated transform passes", async () => {
    //#given
    const hook = createDomainKeywordDetectorHook()
    const output = outputWith("use grafana for dashboards")

    //#when
    await hook["experimental.chat.messages.transform"]({}, output)
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then
    const occurrences = textOf(output).split("[domain-skills]").length - 1
    expect(occurrences).toBe(1)
    expect(textOf(output)).toContain("grafana-dashboards")
  })

  test("does not route system-directive messages", async () => {
    //#given
    const hook = createDomainKeywordDetectorHook()
    const directive = "[SYSTEM DIRECTIVE: MATRIXX - TASK CONTINUATION] use ccxt"
    const output = outputWith(directive)

    //#when
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then
    expect(textOf(output)).toBe(directive)
  })
})
