export function readConfig(): unknown {
  try {
    return load()
  } catch {}
}
