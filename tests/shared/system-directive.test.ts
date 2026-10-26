import { describe, expect, test } from "bun:test"
import {
  createSystemDirective,
  hasSystemReminder,
  isSystemDirective,
  removeSystemReminders,
  sanitizeKnownTags,
} from "../../src/shared/system-directive"

describe("system-directive utilities", () => {
  describe("hasSystemReminder", () => {
    test("should return true for messages containing <system-reminder> tags", () => {
      const text = `<system-reminder>
Some system content
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should return false for messages without system-reminder tags", () => {
      const text = "Just a normal user message"
      expect(hasSystemReminder(text)).toBe(false)
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>content</SYSTEM-REMINDER>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should detect system-reminder in mixed content", () => {
      const text = `User text here
<system-reminder>
System content
</system-reminder>
More user text`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle empty system-reminder tags", () => {
      const text = `<system-reminder></system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle multiline system-reminder content", () => {
      const text = `<system-reminder>
Line 1
Line 2
Line 3
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })
  })

  describe("removeSystemReminders", () => {
    test("should remove system-reminder tags and content", () => {
      const text = `<system-reminder>
System content that should be removed
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should preserve user text outside system-reminder tags", () => {
      const text = `User message here
<system-reminder>
System content to remove
</system-reminder>
More user text`
      const result = removeSystemReminders(text)
      expect(result).toContain("User message here")
      expect(result).toContain("More user text")
      expect(result).not.toContain("System content to remove")
    })

    test("should remove multiple system-reminder blocks", () => {
      const text = `<system-reminder>First block</system-reminder>
User text
<system-reminder>Second block</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("User text")
      expect(result).not.toContain("First block")
      expect(result).not.toContain("Second block")
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>Content</SYSTEM-REMINDER>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should handle nested tags correctly", () => {
      const text = `<system-reminder>
Outer content
<inner>Some inner tag</inner>
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should trim whitespace from result", () => {
      const text = `
<system-reminder>Remove this</system-reminder>

User text

`
      const result = removeSystemReminders(text)
      expect(result).toBe("User text")
    })

    test("should handle empty string input", () => {
      expect(removeSystemReminders("")).toBe("")
    })

    test("should handle text with no system-reminder tags", () => {
      const text = "Just normal user text without any system reminders"
      expect(removeSystemReminders(text)).toBe(text)
    })

    test("should preserve code blocks in user text", () => {
      const text = `Here's some code:
\`\`\`javascript
const x = 1;
\`\`\`
<system-reminder>System info</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("Here's some code:")
      expect(result).toContain("```javascript")
      expect(result).not.toContain("System info")
    })
  })

  describe("isSystemDirective", () => {
    test("should return true for MATRIXX system directives", () => {
      const directive = createSystemDirective("TEST")
      expect(isSystemDirective(directive)).toBe(true)
    })

    test("should return false for system-reminder tags", () => {
      const text = `<system-reminder>content</system-reminder>`
      expect(isSystemDirective(text)).toBe(false)
    })

    test("should return false for normal user messages", () => {
      expect(isSystemDirective("Just a normal message")).toBe(false)
    })

    test("should handle leading whitespace", () => {
      const directive = `  ${createSystemDirective("TEST")}`
      expect(isSystemDirective(directive)).toBe(true)
    })
  })

  describe("integration with keyword detection", () => {
    test("should prevent search keywords in system-reminders from triggering mode", () => {
      const text = `<system-reminder>
The system will search for the file and find all occurrences.
Please locate and scan the directory.
</system-reminder>`

      // After removing system reminders, no search keywords should remain
      const cleanText = removeSystemReminders(text)
      expect(cleanText).not.toMatch(/\b(search|find|locate|scan)\b/i)
    })

    test("should preserve search keywords in user text while removing system-reminder keywords", () => {
      const text = `<system-reminder>
System will find and locate files.
</system-reminder>

Please search for the bug in the code.`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("search")
      expect(cleanText).not.toContain("find and locate")
    })

    test("should handle complex mixed content with multiple modes", () => {
      const text = `<system-reminder>
System will search and investigate.
</system-reminder>

User wants to explore the codebase and analyze the implementation.

<system-reminder>
Another system reminder with research keyword.
</system-reminder>`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("explore")
      expect(cleanText).toContain("analyze")
      expect(cleanText).not.toContain("search and investigate")
      expect(cleanText).not.toContain("research")
    })
  })
})


describe("sanitizeKnownTags — closed-table passthrough", () => {
  test("drops control iteration_nudge element including inner text", () => {
    //#given
    const text = "keep <instruction name=iteration_nudge>compress now</instruction> this"
    //#when
    const out = sanitizeKnownTags(text)
    //#then
    expect(out).not.toContain("compress now")
    expect(out).not.toContain("iteration_nudge")
    expect(out).toContain("keep")
  })

  test("unwraps answer + analysis keeping inner text", () => {
    //#given //#when //#then
    expect(sanitizeKnownTags("<answer>forty-two</answer>")).toBe("forty-two")
    expect(sanitizeKnownTags("<analysis>deep thought</analysis>")).toBe("deep thought")
  })

  test("unknown foo passes through byte-identical", () => {
    //#given
    const foo = "<foo>bar</foo>"
    //#when //#then
    expect(sanitizeKnownTags(foo)).toBe(foo)
  })

  test("bare b1 prose passes through", () => {
    //#given
    const prose = "see build (b1) for details"
    //#when //#then
    expect(sanitizeKnownTags(prose)).toBe(prose)
  })

  test("unwrap-keep-inner preserves control prose for kept-nudge path", () => {
    //#given
    const text = "<instruction name=iteration_nudge>use the compress tool on it now</instruction>"
    //#when
    const out = sanitizeKnownTags(text, { control: "unwrap-keep-inner" })
    //#then
    expect(out).toBe("use the compress tool on it now")
  })

  test("unwrap-keep-inner strips lone control open tag keeping prose", () => {
    //#given //#when //#then
    expect(
      sanitizeKnownTags("<instruction name=iteration_nudge>sticky prose", {
        control: "unwrap-keep-inner",
      }),
    ).toBe("sticky prose")
  })

  test("leak scan: foo retained after sanitize", () => {
    //#given //#when
    const out = sanitizeKnownTags("note <foo>bar</foo> end")
    expect(out).toContain("<foo>")
    expect(out).toContain("bar")
  })
})
