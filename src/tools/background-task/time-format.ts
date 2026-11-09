import { isRecord } from "../../shared/runtime/record-type-guard"

export function messageTimeValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (isRecord(value)) {
    const created = value.created
    if (typeof created === "number") {
      return Number.isFinite(created) ? created : 0
    }
    if (typeof created === "string") {
      const parsed = Date.parse(created)
      return Number.isNaN(parsed) ? 0 : parsed
    }
  }
  return 0
}

export function compareMessageTime(a: { time?: unknown }, b: { time?: unknown }): number {
  return messageTimeValue(a.time) - messageTimeValue(b.time)
}

export function formatMessageTime(value: unknown): string {
  if (typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  if (isRecord(value)) {
    if ("created" in value) {
      const created = (value as { created?: number }).created
      if (typeof created === "number") {
        return new Date(created).toISOString()
      }
    }
  }
  return "Unknown time"
}
