import { describe, expect, test } from "bun:test"
import { allowActionsOnly, denyActions, rule } from "../../src/shared/permission-compat"

describe("permission-compat", () => {
  describe("rule", () => {
    test("defaults to allow on the wildcard resource", () => {
      //#given an action
      //#when building a rule with no effect or resource
      const result = rule("edit")

      //#then it allows everywhere
      expect(result).toEqual({ action: "edit", resource: "*", effect: "allow" })
    })

    test("takes an explicit effect and resource", () => {
      //#given an action, effect and resource
      //#when building a rule
      const result = rule("read", "deny", "*.env")

      //#then all three are set
      expect(result).toEqual({ action: "read", resource: "*.env", effect: "deny" })
    })
  })

  describe("denyActions", () => {
    test("returns a deny rule per action", () => {
      //#given actions to deny
      //#when building the deny rules
      const result = denyActions(["edit", "subagent"])

      //#then each action is denied on the wildcard resource
      expect(result).toEqual([
        { action: "edit", resource: "*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "deny" },
      ])
    })

    test("returns an empty ruleset for no actions", () => {
      //#given no actions
      //#when building the deny rules
      const result = denyActions([])

      //#then there is nothing to deny
      expect(result).toEqual([])
    })
  })

  describe("allowActionsOnly", () => {
    test("returns a leading wildcard deny followed by the allowed action", () => {
      //#given an action to allow
      //#when building the allowlist
      const result = allowActionsOnly(["read"])

      //#then the wildcard deny precedes the allow
      expect(result).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
    })

    test("emits a wildcard deny followed by every allowed action", () => {
      //#given multiple actions to allow
      //#when building the allowlist
      const result = allowActionsOnly(["read", "glob"])

      //#then the wildcard deny precedes both allows
      expect(result).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "glob", resource: "*", effect: "allow" },
      ])
    })
  })
})
