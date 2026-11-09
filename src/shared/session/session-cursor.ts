import { idOf, timeOf } from "./session-message"

type CursorMessage = {
  id?: string
  time?: { created?: number }
}

interface CursorState {
  lastKey?: string
  lastCount: number
}

const sessionCursors = new Map<string, CursorState>()

function buildMessageKey(message: CursorMessage, index: number): string {
  const id = idOf(message)
  if (id) return `id:${id}`

  const created = timeOf(message)
  if (created !== 0) {
    return `t:${String(created)}:${String(index)}`
  }

  return `i:${String(index)}`
}

/**
 * Returns the messages that appeared after this cursor's previous read.
 *
 * `cursorKey` is a consumer scope, not necessarily a session id: any two
 * consumers that must track their own read position need distinct keys.
 */
export function consumeNewMessages<T extends CursorMessage>(
  cursorKey: string | undefined,
  messages: T[]
): T[] {
  if (!cursorKey) return messages

  const keys = messages.map((message, index) => buildMessageKey(message, index))
  const cursor = sessionCursors.get(cursorKey)
  let startIndex = 0

  if (cursor) {
    if (cursor.lastCount > messages.length) {
      startIndex = 0
    } else if (cursor.lastKey) {
      const lastIndex = keys.lastIndexOf(cursor.lastKey)
      if (lastIndex >= 0) {
        startIndex = lastIndex + 1
      } else {
        // History changed without a shrink; reset to avoid skipping messages.
        startIndex = 0
      }
    }
  }

  if (messages.length === 0) {
    sessionCursors.delete(cursorKey)
  } else {
    sessionCursors.set(cursorKey, {
      lastKey: keys[keys.length - 1],
      lastCount: messages.length,
    })
  }

  return messages.slice(startIndex)
}

export function resetMessageCursor(cursorKey?: string): void {
  if (cursorKey) {
    sessionCursors.delete(cursorKey)
    return
  }
  sessionCursors.clear()
}
