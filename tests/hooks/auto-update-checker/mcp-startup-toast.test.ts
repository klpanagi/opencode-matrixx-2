/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { showMcpStartupNoticeIfAny } from "../../../src/hooks/auto-update-checker/hook/mcp-startup-toast"
import { _resetMcpStartupFailuresForTesting, setMcpStartupFailures } from "../../../src/mcps/mcp-startup-state"
import { resetNotifySink, setNotifySink } from "../../../src/shared/notify"

afterEach(() => {
  _resetMcpStartupFailuresForTesting()
  resetNotifySink()
})

describe("showMcpStartupNoticeIfAny", () => {
  test("silent when no startup failures (healthy)", async () => {
    //#given
    _resetMcpStartupFailuresForTesting()
    const seen: Array<{ level: string; message: string }> = []
    setNotifySink((level, message) => {
      seen.push({ level, message: String(message) })
    })

    //#when
    await showMcpStartupNoticeIfAny()

    //#then
    expect(seen).toEqual([])
  })

  test("warns with uvx + install fix when document_reader is disabled", async () => {
    //#given
    setMcpStartupFailures([
      {
        name: "document_reader",
        error:
          "uvx (uv package manager) not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh",
      },
    ])
    const seen: Array<{ level: string; message: string }> = []
    setNotifySink((level, message) => {
      seen.push({ level, message: String(message) })
    })

    //#when
    await showMcpStartupNoticeIfAny()

    //#then
    expect(seen).toHaveLength(1)
    expect(seen[0]?.level).toBe("warn")
    const text = seen[0]?.message ?? ""
    expect(text).toContain("uvx")
    expect(text).toContain("astral.sh/uv/install.sh")
    expect(text).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh")
    expect(text).toContain("uvx --from markitdown-mcp markitdown-mcp --help")
    expect(text).toContain("document_reader")
    expect(text).toContain("document_reader__convert_to_markdown")
    expect(text).not.toContain("available for use")
    expect(text).not.toContain("ready to use")
  })
})
