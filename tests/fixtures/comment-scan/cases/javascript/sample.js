// Minimal event fan-out used by the settings watcher.

/* Listeners are invoked synchronously. */
export function createBus() {
  const listeners = [] // collected at subscribe time
  return {
    sub(fn) { listeners.push(fn) },
    emit(value) { for (const fn of listeners) fn(value) },
  }
}
