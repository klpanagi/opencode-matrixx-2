// Falls back to a temp directory when the root is empty.
export function resolveRoot(root: string): string {
  const value = root || "/tmp" // safest default
  return value
}
