/**
 * Native session ID detection.
 *
 * OpenCode native sessions carry `ses_` IDs; background handles carry `bg_`
 * IDs. A `ses_` ID with no bg_ handle attached is a native session, which
 * can never be revived or polled as a background task.
 */

export function isNativeSessionId(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith("ses_")
}
