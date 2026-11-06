export function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[]
  }
  if (value !== null && typeof value === "object" && "data" in value) {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) {
      return data as T[]
    }
  }
  return []
}
