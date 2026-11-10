/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  applyComplexityRewrite,
  mouseCategoryFor,
} from "../../../../src/plugin/tool/subagent-policy/complexity-rewrite"

describe("mouseCategoryFor", () => {
  test("maps mouse-* worker id to category", () => {
    expect(mouseCategoryFor("mouse-source")).toBe("source")
    expect(mouseCategoryFor("mouse-bullet-time")).toBe("bullet-time")
  })

  test("returns undefined for non-mouse agents", () => {
    expect(mouseCategoryFor("sati")).toBeUndefined()
    expect(mouseCategoryFor("mouse")).toBeUndefined()
    expect(mouseCategoryFor("oracle")).toBeUndefined()
  })
})

describe("applyComplexityRewrite", () => {
  test("non-mouse agent passes through untouched", () => {
    //#given
    const args: Record<string, unknown> = { agent: "sati", prompt: "typo fix", complexity: 1 }

    //#when
    const result = applyComplexityRewrite(args, {
      downgrades: { construct: { "1": "cheap/model" } },
      defaultModelFor: () => "orig/model",
    })

    //#then
    expect(result.downgraded).toBe(false)
    expect(args).not.toHaveProperty("model")
    expect(args).not.toHaveProperty("complexity")
  })

  test("continuation (sessionID present) skips model rewrite", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "typo",
      sessionID: "ses_abc123",
      model: "orig/model",
      complexity: 1,
    }

    //#when
    const result = applyComplexityRewrite(args, {
      downgrades: { source: { "1": "cheap/model" } },
    })

    //#then
    expect(result.downgraded).toBe(false)
    expect(args.model).toBe("orig/model")
  })

  test("downgrades explicit model at complexity 1 when map has entry", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-bullet-time",
      prompt: "fix typo",
      model: "orig/model",
      complexity: 1,
    }

    //#when
    const result = applyComplexityRewrite(args, {
      downgrades: { "bullet-time": { "1": "cheap/model" } },
    })

    //#then
    expect(result.downgraded).toBe(true)
    expect(args.model).toBe("cheap/model")
    expect(args).not.toHaveProperty("complexity")
  })

  test("never upgrades: complexity 5 leaves model alone", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "redesign system-wide architecture",
      model: "orig/model",
      complexity: 5,
    }

    //#when
    const result = applyComplexityRewrite(args, {
      downgrades: { source: { "1": "cheap/model", "5": "expensive/model" } },
    })

    //#then
    expect(result.downgraded).toBe(false)
    expect(args.model).toBe("orig/model")
  })

  test("absent model with no known default is a no-op", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "typo",
      complexity: 1,
    }

    //#when
    const result = applyComplexityRewrite(args, {
      downgrades: { source: { "1": "cheap/model" } },
    })

    //#then
    expect(result.downgraded).toBe(false)
    expect(args).not.toHaveProperty("model")
  })

  test("auto complexity resolves agent default then downgrades", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-bullet-time",
      prompt: "typo",
    }

    //#when
    const result = applyComplexityRewrite(
      args,
      {
        downgrades: { "bullet-time": { "1": "cheap/model" } },
        defaultModelFor: () => "orig/model",
      },
      [],
    )

    //#then
    expect(result.downgraded).toBe(true)
    expect(args.model).toBe("cheap/model")
  })

  test("invalid complexity value throws explicitly", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "x",
      model: "orig/model",
      complexity: 9,
    }

    //#when / #then
    expect(() => applyComplexityRewrite(args, {})).toThrow("complexity")
  })
})
