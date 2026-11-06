export function normalizeSDKResponse<TData>(response: unknown, fallback: TData): TData {
  if (response === null || response === undefined) {
    return fallback
  }

  if (Array.isArray(response)) {
    return response as TData
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data !== null && data !== undefined) {
      return data as TData
    }

    return fallback
  }

  return fallback
}
