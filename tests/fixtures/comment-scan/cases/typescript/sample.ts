// Path helpers for the settings loader.

export type LoaderOptions = {
  root: string
}

/* Fallback used when the environment variable is absent. */
export function resolveRoot(options: LoaderOptions): string {
  const root = options.root || "/tmp" // temporary default
  return root
}
