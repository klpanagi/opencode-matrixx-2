export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"))
  }
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  const activeSignal: AbortSignal = signal
  return new Promise((resolve, reject) => {
    const timer = setTimeout(cleanupAndResolve, ms)
    function cleanupAndResolve(): void {
      activeSignal.removeEventListener("abort", onAbort)
      resolve()
    }
    function onAbort(): void {
      clearTimeout(timer)
      activeSignal.removeEventListener("abort", onAbort)
      reject(activeSignal.reason ?? new Error("Aborted"))
    }
    activeSignal.addEventListener("abort", onAbort, { once: true })
  })
}
