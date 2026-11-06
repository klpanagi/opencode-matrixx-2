const CIRCULAR = "[circular]"

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null
  if (value === undefined) return undefined
  const kind = typeof value
  if (kind === "string" || kind === "number" || kind === "boolean") return value
  if (kind === "bigint") return String(value)
  if (kind === "function" || kind === "symbol") return undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR
    seen.add(value)
    const out: unknown[] = []
    for (const item of value) {
      const clean = sanitize(item, seen)
      if (clean !== undefined) out.push(clean)
    }
    seen.delete(value)
    return out
  }
  if (kind === "object") {
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return CIRCULAR
    seen.add(obj)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      const clean = sanitize(obj[key], seen)
      if (clean !== undefined) out[key] = clean
    }
    seen.delete(obj)
    return out
  }
  return undefined
}

export function jsonSafeMetadata<T>(value: T): T {
  return sanitize(value, new WeakSet()) as T
}
