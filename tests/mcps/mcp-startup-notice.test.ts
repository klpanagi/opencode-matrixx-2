/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { _resetMcpStartupFailuresForTesting, setMcpStartupFailures } from "../../src/mcps/mcp-startup-state"
import { buildMcpStartupNotice, getMcpStartupNotice } from "../../src/mcps/mcp-startup-notice"

afterEach(() => {
  _resetMcpStartupFailuresForTesting()
})

describe("buildMcpStartupNotice", () => {
  test("empty failures → no notice (silent when healthy)", async () => {
    //#given
    const failures: { name: string; error: string }[] = []

    //#when
    const notice = buildMcpStartupNotice(failures)

    //#then
    expect(notice).toBeUndefined()
  })

  test("uvx-missing document_reader failure → notice names uvx + install fix, no availability claim", async () => {
    //#given
    const failures = [
      {
        name: "document_reader",
        error:
          "uvx (uv package manager) not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh",
      },
    ]

    //#when
    const notice = buildMcpStartupNotice(failures)

    //#then
    expect(notice).toBeDefined()
    expect(notice).toContain("uvx")
    expect(notice).toContain("astral.sh/uv/install.sh")
    expect(notice).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh")
    expect(notice).toContain("uvx --from markitdown-mcp markitdown-mcp --help")
    expect(notice).toContain("document_reader")
    expect(notice).not.toContain("available for use")
    expect(notice).not.toContain("ready to use")
  })

  test("notice uses canonical tool name, never a bare short name", async () => {
    //#given
    const failures = [{ name: "document_reader", error: "uvx (uv package manager) not found in PATH" }]

    //#when
    const notice = buildMcpStartupNotice(failures) ?? ""

    //#then
    expect(notice).toContain("document_reader__convert_to_markdown")
  })
})

describe("getMcpStartupNotice", () => {
  test("reads failures from startup state; silent when state empty", async () => {
    //#given
    _resetMcpStartupFailuresForTesting()

    //#when
    const notice = getMcpStartupNotice()

    //#then
    expect(notice).toBeUndefined()
  })

  test("emits notice when startup state holds the uvx failure", async () => {
    //#given
    setMcpStartupFailures([
      {
        name: "document_reader",
        error:
          "uvx (uv package manager) not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh",
      },
    ])

    //#when
    const notice = getMcpStartupNotice()

    //#then
    expect(notice).toBeDefined()
    expect(notice).toContain("uvx")
    expect(notice).toContain("astral.sh/uv/install.sh")
  })
})
