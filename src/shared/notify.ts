import { log } from "./logger"

export type NotifyLevel = "info" | "warn" | "success" | "error"

export type NotifySink = (level: NotifyLevel, message: string, data?: unknown) => void

let sink: NotifySink | undefined

export function setNotifySink(next: NotifySink): void {
  sink = next
}

export function resetNotifySink(): void {
  sink = undefined
}

export function notify(level: NotifyLevel, message: string, data?: unknown): void {
  if (sink) {
    sink(level, message, data)
    return
  }
  log(`[matrixx] notify(${level}): ${message}`)
}
