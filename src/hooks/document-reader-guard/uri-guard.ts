import { realpathSync } from "node:fs"
import { isIP } from "node:net"
import { resolve } from "node:path"

import { isWithin } from "../../shared/io/path-containment"
import {
  URI_NON_FILE_BLOCK_MESSAGE,
  uriHostBlockMessage,
  uriOutsideWorkspaceBlockMessage,
  uriUnresolvableBlockMessage,
} from "./constants"

const BLOCKED_LITERAL_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "::1",
])

const BLOCKED_IPV4_RANGES: ReadonlyArray<{ network: number; bits: number }> = [
  { network: 0xa9fe0000, bits: 16 },
  { network: 0x7f000000, bits: 8 },
  { network: 0x0a000000, bits: 8 },
  { network: 0xac100000, bits: 12 },
  { network: 0xc0a80000, bits: 16 },
]

function ipv4ToInt(text: string): number | undefined {
  const parts = text.split(".")
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = value * 256 + octet
  }
  return value
}

function isBlockedIpv4Value(ipv4: number): boolean {
  return BLOCKED_IPV4_RANGES.some(
    ({ network, bits }) => ipv4 >>> (32 - bits) === network >>> (32 - bits),
  )
}

function hextetValues(parts: string[]): number[] | undefined {
  const values: number[] = []
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined
    values.push(parseInt(part, 16))
  }
  return values.length === 8 ? values : undefined
}

/**
 * Expand a validated IPv6 address into its 8 hextets, folding an embedded
 * dotted-quad IPv4 tail (`::ffff:127.0.0.1`) into hex form first. `::`-based
 * compression is expanded; `undefined` when the spelling cannot be expanded.
 */
function expandIpv6Hextets(host: string): number[] | undefined {
  let text = host
  const embeddedV4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (embeddedV4) {
    const value = ipv4ToInt(embeddedV4[1])
    if (value === undefined) return undefined
    text =
      text.slice(0, text.length - embeddedV4[1].length) +
      `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`
  }

  const halves = text.split("::")
  if (halves.length > 2) return undefined
  if (halves.length === 2) {
    const head = halves[0] === "" ? [] : halves[0].split(":")
    const tail = halves[1] === "" ? [] : halves[1].split(":")
    const fill = 8 - head.length - tail.length
    if (fill < 1) return undefined
    return hextetValues([...head, ...Array.from({ length: fill }, () => "0"), ...tail])
  }
  if (!text.includes(":")) return undefined
  return hextetValues(text.split(":"))
}

/**
 * IPv6 blocklist: IPv4-mapped/compatible forms are reduced to their embedded
 * IPv4 and checked against the IPv4 ranges; explicit prefix checks cover ::1,
 * ::, fe80::/10 (link-local) and fc00::/7 (unique-local).
 */
function isBlockedIpv6Address(host: string): boolean {
  const hextets = expandIpv6Hextets(host)
  if (!hextets) return false
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets

  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0 || h5 === 0xffff)) {
    if (isBlockedIpv4Value(h6 * 0x10000 + h7)) return true
  }

  if (
    h0 === 0 &&
    h1 === 0 &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0 &&
    h6 === 0 &&
    (h7 === 0 || h7 === 1)
  ) {
    return true
  }

  if ((h0 & 0xffc0) === 0xfe80) return true
  if ((h0 & 0xfe00) === 0xfc00) return true
  return false
}

export function isBlockedUriHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").trim().toLowerCase()
  if (!host) return false
  if (BLOCKED_LITERAL_HOSTS.has(host)) return true

  const ipVersion = isIP(host)
  if (ipVersion === 4) {
    const value = ipv4ToInt(host)
    return value !== undefined && isBlockedIpv4Value(value)
  }
  if (ipVersion === 6) {
    return isBlockedIpv6Address(host)
  }
  return false
}

function describeFsError(err: unknown): string {
  const code = (err as { code?: unknown }).code
  if (typeof code === "string" && code.length > 0) return code
  return err instanceof Error ? err.message : String(err)
}

export function evaluateDocumentReaderUri(
  uri: string,
  workspaceRoot: string,
): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return URI_NON_FILE_BLOCK_MESSAGE
  }
  if (parsed.protocol.toLowerCase() !== "file:") return URI_NON_FILE_BLOCK_MESSAGE

  const host = parsed.hostname
  if (isBlockedUriHost(host)) return uriHostBlockMessage(host)

  let filePath: string
  try {
    filePath = decodeURIComponent(parsed.pathname)
  } catch {
    filePath = parsed.pathname
  }
    const absolutePath = resolve(workspaceRoot, filePath)

  if (!isWithin(workspaceRoot, absolutePath)) {
    return uriOutsideWorkspaceBlockMessage(absolutePath, workspaceRoot)
  }

  let realTarget: string
  try {
    realTarget = realpathSync(absolutePath)
  } catch (err) {
    return uriUnresolvableBlockMessage(absolutePath, describeFsError(err))
  }

  let realRoot: string
  try {
    realRoot = realpathSync(workspaceRoot)
  } catch {
    // Fail closed: without a canonical workspace root, containment cannot be proved.
    return uriOutsideWorkspaceBlockMessage(absolutePath, workspaceRoot)
  }

  if (!isWithin(realRoot, realTarget)) {
    return uriOutsideWorkspaceBlockMessage(realTarget, realRoot)
  }
  return undefined
}
