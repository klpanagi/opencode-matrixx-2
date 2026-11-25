import { describe, expect, mock, test } from "bun:test"

// Seam: spy on js-yaml's load via mock.module. frontmatter.ts is dynamically
// imported AFTER the mock is registered so its `import yaml from "js-yaml"`
// binding resolves to the spy (which delegates to the real implementation).
import * as actualJsYaml from "js-yaml"

let yamlLoadCalls = 0
mock.module("js-yaml", () => ({
  default: {
    ...actualJsYaml.default,
    JSON_SCHEMA: actualJsYaml.JSON_SCHEMA,
    load(text: string, opts?: Parameters<typeof actualJsYaml.load>[1]) {
      yamlLoadCalls++
      return actualJsYaml.load(text, opts)
    },
  },
}))

const { MAX_FRONTMATTER_BYTES, parseFrontmatter } = await import("../../src/shared/io/frontmatter")

describe("parseFrontmatter", () => {
  // #region backward compatibility
  test("parses simple key-value frontmatter", () => {
    // given
    const content = `---
description: Test command
agent: build
---
Body content`

    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data.description).toBe("Test command")
    expect(result.data.agent).toBe("build")
    expect(result.body).toBe("Body content")
  })

  test("parses boolean values", () => {
    // given
    const content = `---
subtask: true
enabled: false
---
Body`

    // when
    const result = parseFrontmatter<{ subtask: boolean; enabled: boolean }>(content)

    // then
    expect(result.data.subtask).toBe(true)
    expect(result.data.enabled).toBe(false)
  })
  // #endregion

  // #region complex YAML (handoffs support)
  test("parses complex array frontmatter (speckit handoffs)", () => {
    // given
    const content = `---
description: Execute planning workflow
handoffs:
  - label: Create Tasks
    agent: speckit.tasks
    prompt: Break the plan into tasks
    send: true
  - label: Create Checklist
    agent: speckit.checklist
    prompt: Create a checklist
---
Workflow instructions`

    interface TestMeta {
      description: string
      handoffs: Array<{ label: string; agent: string; prompt: string; send?: boolean }>
    }

    // when
    const result = parseFrontmatter<TestMeta>(content)

    // then
    expect(result.data.description).toBe("Execute planning workflow")
    expect(result.data.handoffs).toHaveLength(2)
    expect(result.data.handoffs[0].label).toBe("Create Tasks")
    expect(result.data.handoffs[0].agent).toBe("speckit.tasks")
    expect(result.data.handoffs[0].send).toBe(true)
    expect(result.data.handoffs[1].agent).toBe("speckit.checklist")
    expect(result.data.handoffs[1].send).toBeUndefined()
  })

  test("parses nested objects in frontmatter", () => {
    // given
    const content = `---
name: test
config:
  timeout: 5000
  retry: true
  options:
    verbose: false
---
Content`

    interface TestMeta {
      name: string
      config: {
        timeout: number
        retry: boolean
        options: { verbose: boolean }
      }
    }

    // when
    const result = parseFrontmatter<TestMeta>(content)

    // then
    expect(result.data.name).toBe("test")
    expect(result.data.config.timeout).toBe(5000)
    expect(result.data.config.retry).toBe(true)
    expect(result.data.config.options.verbose).toBe(false)
  })
  // #endregion

  // #region edge cases
  test("handles content without frontmatter", () => {
    // given
    const content = "Just body content"

    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual({})
    expect(result.body).toBe("Just body content")
  })

  test("handles empty frontmatter", () => {
    // given
    const content = `---
---
Body`

    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual({})
    expect(result.body).toBe("Body")
  })

  test("handles invalid YAML gracefully", () => {
    // given
    const content = `---
invalid: yaml: syntax: here
  bad indentation
---
Body`

    // when
    const result = parseFrontmatter(content)

    // then - should not throw, return empty data
    expect(result.data).toEqual({})
    expect(result.body).toBe("Body")
  })

  test("handles frontmatter with only whitespace", () => {
    // given
    const content = `---
   
---
Body with whitespace-only frontmatter`

    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual({})
    expect(result.body).toBe("Body with whitespace-only frontmatter")
  })
  // #endregion

  // #region mixed content
  test("preserves multiline body content", () => {
    // given
    const content = `---
title: Test
---
Line 1
Line 2

Line 4 after blank`

    // when
    const result = parseFrontmatter<{ title: string }>(content)

    // then
    expect(result.data.title).toBe("Test")
    expect(result.body).toBe("Line 1\nLine 2\n\nLine 4 after blank")
  })

  test("handles CRLF line endings", () => {
    // given
    const content = "---\r\ndescription: Test\r\n---\r\nBody"

    // when
    const result = parseFrontmatter<{ description: string }>(content)

    // then
    expect(result.data.description).toBe("Test")
    expect(result.body).toBe("Body")
  })
  // #endregion

  // #region extra fields tolerance
  test("allows extra fields beyond typed interface", () => {
    // given
    const content = `---
description: Test command
agent: build
extra_field: should not fail
another_extra:
  nested: value
  array:
    - item1
    - item2
custom_boolean: true
custom_number: 42
---
Body content`

    interface MinimalMeta {
      description: string
      agent: string
    }

    // when
    const result = parseFrontmatter<MinimalMeta>(content)

    // then
    expect(result.data.description).toBe("Test command")
    expect(result.data.agent).toBe("build")
    expect(result.body).toBe("Body content")
    // @ts-expect-error - accessing extra field not in MinimalMeta
    expect(result.data.extra_field).toBe("should not fail")
    // @ts-expect-error - accessing extra field not in MinimalMeta
    expect(result.data.another_extra).toEqual({ nested: "value", array: ["item1", "item2"] })
    // @ts-expect-error - accessing extra field not in MinimalMeta
    expect(result.data.custom_boolean).toBe(true)
    // @ts-expect-error - accessing extra field not in MinimalMeta
    expect(result.data.custom_number).toBe(42)
  })

  test("extra fields do not interfere with expected fields", () => {
    // given
    const content = `---
description: Original description
unknown_field: extra value
handoffs:
  - label: Task 1
    agent: test.agent
---
Content`

    interface HandoffMeta {
      description: string
      handoffs: Array<{ label: string; agent: string }>
    }

    // when
    const result = parseFrontmatter<HandoffMeta>(content)

    // then
    expect(result.data.description).toBe("Original description")
    expect(result.data.handoffs).toHaveLength(1)
    expect(result.data.handoffs[0].label).toBe("Task 1")
    expect(result.data.handoffs[0].agent).toBe("test.agent")
  })
  // #endregion
})


describe("parseFrontmatter size cap", () => {
  test("returns parseError result without loading YAML when input exceeds MAX_FRONTMATTER_BYTES", () => {
    // given
    yamlLoadCalls = 0
    const oversized = "---\nkey: value\n---\n" + "x".repeat(MAX_FRONTMATTER_BYTES + 10)

    // when
    const result = parseFrontmatter(oversized)

    // then
    expect(result).toEqual({ data: {}, body: "", hadFrontmatter: false, parseError: true })
    expect(yamlLoadCalls).toBe(0)
  })

  test("returns fast on a 2 MiB pathological document", () => {
    // given
    yamlLoadCalls = 0
    const pathological = "---\nbig: " + "a".repeat(2 * 1024 * 1024) + "\n---\nbody"
    const start = performance.now()

    // when
    const result = parseFrontmatter(pathological)
    const elapsedMs = performance.now() - start

    // then
    expect(result).toEqual({ data: {}, body: "", hadFrontmatter: false, parseError: true })
    expect(yamlLoadCalls).toBe(0)
    expect(elapsedMs).toBeLessThan(250)
  })

  test("still parses small frontmatter through the yaml seam", () => {
    // given
    yamlLoadCalls = 0
    const small = "---\ntitle: hello\n---\nbody text"

    // when
    const result = parseFrontmatter(small)

    // then
    expect(result.data).toEqual({ title: "hello" })
    expect(result.hadFrontmatter).toBe(true)
    expect(result.parseError).toBe(false)
    expect(yamlLoadCalls).toBe(1)
  })
})
