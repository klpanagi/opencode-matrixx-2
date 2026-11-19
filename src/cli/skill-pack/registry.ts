import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_REGISTRY_URL } from "./constants";
import { RegistryError } from "./errors";

export interface Packument {
  version: string;
  integrity: string;
  tarball: string;
  shasum: string;
  unpackedSize: number;
  fileCount: number;
}

export interface FetchPackumentOptions {
  registryUrl?: string;
  fetchFn?: typeof fetch;
}

export interface DownloadTarballOptions {
  fetchFn?: typeof fetch;
}

export interface DownloadResult {
  bytes: number;
  path: string;
}

function encodePackageName(packageName: string): string {
  return packageName.startsWith("@") ? packageName.replace("/", "%2f") : packageName;
}

function buildPackumentUrl(registryUrl: string, packageName: string, version: string): string {
  const base = registryUrl.replace(/\/+$/, "");
  return `${base}/${encodePackageName(packageName)}/${encodeURIComponent(version)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function request(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RegistryError(`${label} request to ${url} failed: ${reason}`, "network");
  }
}

function httpError(label: string, url: string, response: Response): RegistryError {
  return new RegistryError(
    `${label} request to ${url} failed with HTTP ${response.status} ${response.statusText}`,
    "http",
    response.status,
  );
}

function malformedError(message: string, status?: number): RegistryError {
  return new RegistryError(message, "malformed-body", status);
}

function parsePackument(body: unknown, expectedVersion: string): Packument {
  if (!isRecord(body)) {
    throw malformedError("registry response is not a JSON object");
  }
  if (body.version !== expectedVersion) {
    throw malformedError(
      `registry returned version ${String(body.version)} instead of ${expectedVersion}`,
    );
  }
  const dist = body.dist;
  if (!isRecord(dist)) {
    throw malformedError(`registry response for ${expectedVersion} has no dist block`);
  }
  const { integrity, tarball } = dist;
  if (typeof integrity !== "string" || integrity.length === 0) {
    throw malformedError(`registry response for ${expectedVersion} has no dist.integrity`);
  }
  if (typeof tarball !== "string" || tarball.length === 0) {
    throw malformedError(`registry response for ${expectedVersion} has no dist.tarball`);
  }
  return {
    version: expectedVersion,
    integrity,
    tarball,
    shasum: typeof dist.shasum === "string" ? dist.shasum : "",
    unpackedSize: typeof dist.unpackedSize === "number" ? dist.unpackedSize : 0,
    fileCount: typeof dist.fileCount === "number" ? dist.fileCount : 0,
  };
}

/** Fetches the packument for an exact package version and extracts the fields the installer needs. */
export async function fetchPackument(
  packageName: string,
  version: string,
  options: FetchPackumentOptions = {},
): Promise<Packument> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = buildPackumentUrl(options.registryUrl ?? DEFAULT_REGISTRY_URL, packageName, version);
  const response = await request(fetchFn, url, { headers: { Accept: "application/json" } }, "packument");
  if (!response.ok) {
    throw httpError("packument", url, response);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw malformedError(`registry response for ${url} is not valid JSON`, response.status);
  }
  return parsePackument(body, version);
}

/** Streams a tarball response body to `destPath`, creating parent directories as needed. */
export async function downloadTarball(
  url: string,
  destPath: string,
  options: DownloadTarballOptions = {},
): Promise<DownloadResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await request(fetchFn, url, undefined, "tarball");
  if (!response.ok) {
    throw httpError("tarball", url, response);
  }
  if (!response.body) {
    throw malformedError(`tarball response for ${url} has no body`, response.status);
  }
  await mkdir(dirname(destPath), { recursive: true });
  const bytes = await Bun.write(destPath, response.body);
  return { bytes, path: destPath };
}
