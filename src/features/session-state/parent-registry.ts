const subagentParentMap = new Map<string, string>()

export function setSubagentParent(sessionID: string, parentSessionID: string): void {
  subagentParentMap.set(sessionID, parentSessionID)
}

export function deleteSubagentParent(sessionID: string): void {
  subagentParentMap.delete(sessionID)
}

export function clearSubagentParents(): void {
  subagentParentMap.clear()
}

export function lookupSubagentParent(sessionID: string): string | undefined {
  return subagentParentMap.get(sessionID)
}
