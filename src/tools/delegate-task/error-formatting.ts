/**
 * Re-export shim for backward compatibility.
 * The canonical location is src/shared/error-formatting.ts.
 * New code should import directly from "../../shared/text/error-formatting".
 */
export { type ErrorContext, formatDetailedError } from "../../shared/text/error-formatting"
