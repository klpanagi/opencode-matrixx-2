/** Failure classes surfaced by the npm registry client. */
export type RegistryErrorCode = "network" | "http" | "malformed-body";

/** Typed registry failure carrying the failure class and, when known, the HTTP status. */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly status?: number;

  constructor(message: string, code: RegistryErrorCode, status?: number) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.status = status;
  }
}
