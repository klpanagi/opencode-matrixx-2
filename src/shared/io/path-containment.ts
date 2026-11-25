import { resolve, sep } from "node:path"

/**
 * Pure path-containment check: is `candidate` equal to, or nested under, `root`?
 *
 * Both paths are resolved (`.`/`..`/duplicate separators folded) before the
 * comparison, so a traversal such as `<root>/../etc` is rejected. There is no
 * filesystem access here — callers that must follow symlinks need to `lstat`
 * and `realpath` first, then re-run this check on the real paths.
 *
 * Returns `false` when either argument contains a NUL byte.
 */
export function isWithin(root: string, candidate: string): boolean {
  if (root.includes("\0") || candidate.includes("\0")) {
    return false
  }

  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate === resolvedRoot) {
    return true
  }

  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  return resolvedCandidate.startsWith(prefix)
}
