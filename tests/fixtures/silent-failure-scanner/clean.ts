export function readConfig(): unknown {
  try {
    return load()
  } catch (error) {
    throw error
  }
}
