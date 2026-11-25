import { describe, expect, test } from "bun:test"
import { redactSecrets } from "../../../src/shared/text/redact-secrets"

describe("redactSecrets", () => {
  test("redacts an Authorization header value", () => {
    //#given a header line carrying a bearer token
    const input = "Authorization: Bearer-abc123.def456"

    //#when
    const output = redactSecrets(input)

    //#then the value is replaced and the header name kept
    expect(output).toBe("Authorization: [REDACTED]")
  })

  test("redacts an entire Bearer Authorization value", () => {
    //#given a header with a space-separated scheme and credential
    const input = "Authorization: Bearer abc123"

    //#when
    const output = redactSecrets(input)

    //#then the whole value is gone, including the credential token
    expect(output).toBe("Authorization: [REDACTED]")
    expect(output).toContain("Authorization: [REDACTED]")
    expect(output).not.toContain("abc123")
    expect(output).not.toContain("Bearer")
  })

  test("redacts an entire Basic Authorization credential", () => {
    //#given a base64-encoded basic-auth credential
    const input = "Authorization: Basic dXNlcjpwYXNz"

    //#when
    const output = redactSecrets(input)

    //#then the encoded credential does not survive
    expect(output).toBe("Authorization: [REDACTED]")
    expect(output).not.toContain("dXNlcjpwYXNz")
  })

  test("redacts key/value credential assignments", () => {
    //#given labelled credentials in several separators and casings
    const input = [
      "api_key = sk-live-value",
      "API-KEY: live-value",
      "token: abc",
      "secret=hunter2",
      "password = correct-horse",
    ].join("\n")

    //#when
    const output = redactSecrets(input)

    //#then every value is gone while labels and separators survive
    expect(output).toBe(
      ["api_key = [REDACTED]", "API-KEY: [REDACTED]", "token: [REDACTED]", "secret=[REDACTED]", "password = [REDACTED]"].join("\n"),
    )
  })

  test("redacts provider-prefixed tokens", () => {
    //#given one token per recognised provider prefix
    const input = [
      "npm_abcdefghijklmnopqrstuvwx",
      "sk-abcdefghijklmnopqrstuvwx",
      "AKIAIOSFODNN7EXAMPLE",
      "ghp_abcdefghijklmnopqrstuvwx",
      "ghs_abcdefghijklmnopqrstuvwx",
    ].join(" ")

    //#when
    const output = redactSecrets(input)

    //#then
    expect(output).toBe(
      ["[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]"].join(" "),
    )
  })

  test("redacts a PEM private key block", () => {
    //#given a multi-line private key
    const input = [
      "before",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
      "-----END OPENSSH PRIVATE KEY-----",
      "after",
    ].join("\n")

    //#when
    const output = redactSecrets(input)

    //#then the whole block collapses to a single marker
    expect(output).toBe(["before", "[REDACTED]", "after"].join("\n"))
  })

  test("leaves benign text untouched", () => {
    //#given prose without credentials
    const input = "The tokenizer splits words and the secret sauce is documented."

    //#when
    const output = redactSecrets(input)

    //#then
    expect(output).toBe(input)
  })

  test("is idempotent", () => {
    //#given a mixed payload that every rule matches
    const input = [
      "Authorization: Basic-dXNlcjpwYXNz",
      "api_key = abcdef",
      "npm_abcdefghijklmnopqrstuvwx",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n")

    //#when
    const once = redactSecrets(input)
    const twice = redactSecrets(once)

    //#then a second pass is a no-op
    expect(twice).toBe(once)
  })

  test("is idempotent for Authorization header variants", () => {
    //#given the header forms that the Authorization rule must keep stable
    const inputs = [
      "Authorization: Bearer abc123",
      "Authorization: Basic dXNlcjpwYXNz",
      "Authorization: Bearer-abc123.def456",
      "authorization: bearer lowercase-token",
      "Authorization: [REDACTED]",
    ]

    //#when/then applying twice equals applying once for every case
    for (const input of inputs) {
      const once = redactSecrets(input)
      expect(redactSecrets(once)).toBe(once)
    }
  })
})
