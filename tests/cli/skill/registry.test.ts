import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REGISTRY_URL,
  PINNED_INTEGRITY,
  PINNED_PACKAGE_NAME,
  PINNED_PACK_VERSION,
} from "../../../src/cli/skill-pack/constants";
import { RegistryError } from "../../../src/cli/skill-pack/errors";
import { downloadTarball, fetchPackument } from "../../../src/cli/skill-pack/registry";

// Verbatim `dist` block from https://registry.npmjs.org/ui-ux-pro-max-cli/2.15.0
const PACKUMENT_FIXTURE = {
  _id: "ui-ux-pro-max-cli@2.15.0",
  name: "ui-ux-pro-max-cli",
  version: "2.15.0",
  dist: {
    shasum: "c19bf89b591770420b75a333b1dd0b6449d5e3dd",
    tarball: "https://registry.npmjs.org/ui-ux-pro-max-cli/-/ui-ux-pro-max-cli-2.15.0.tgz",
    fileCount: 196,
    integrity: "sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==",
    unpackedSize: 4656556,
  },
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function toUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function recordingFetch(handler: (url: string, init?: RequestInit) => Response): {
  fetchFn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = toUrlString(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("skill-pack constants", () => {
  test("pins the ui-ux-pro-max-cli package at 2.15.0", () => {
    //#given the npm distribution monitored by the installer
    //#when reading the pinned provenance constants
    //#then the package identity and version are fixed
    expect(PINNED_PACKAGE_NAME).toBe("ui-ux-pro-max-cli");
    expect(PINNED_PACK_VERSION).toBe("2.15.0");
  });

  test("pins the real sha512 integrity published on npm", () => {
    //#given the registry dist.integrity for 2.15.0
    //#when the pinned integrity constant is read
    //#then it matches the published digest verbatim
    expect(PINNED_INTEGRITY).toBe(
      "sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==",
    );
    expect(PINNED_INTEGRITY.startsWith("sha512-")).toBe(true);
  });

  test("defaults to the public npm registry", () => {
    //#given no registry override
    //#when the default registry URL is read
    //#then it points at registry.npmjs.org without a trailing slash
    expect(DEFAULT_REGISTRY_URL).toBe("https://registry.npmjs.org");
  });
});

describe("fetchPackument", () => {
  test("parses version and dist fields from the registry body", async () => {
    //#given a registry serving the real 2.15.0 packument
    const { fetchFn } = recordingFetch(() => jsonResponse(PACKUMENT_FIXTURE));

    //#when fetching the pinned version
    const packument = await fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then every field the installer needs is mapped
    expect(packument).toEqual({
      version: "2.15.0",
      integrity: PACKUMENT_FIXTURE.dist.integrity,
      tarball: PACKUMENT_FIXTURE.dist.tarball,
      shasum: PACKUMENT_FIXTURE.dist.shasum,
      unpackedSize: PACKUMENT_FIXTURE.dist.unpackedSize,
      fileCount: PACKUMENT_FIXTURE.dist.fileCount,
    });
  });

  test("requests the versioned endpoint with an Accept: application/json header", async () => {
    //#given a recording fetch
    const { fetchFn, calls } = recordingFetch(() => jsonResponse(PACKUMENT_FIXTURE));

    //#when fetching the packument
    await fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then exactly one JSON GET went to the versioned URL
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://registry.npmjs.org/${PINNED_PACKAGE_NAME}/2.15.0`);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("accept")).toBe("application/json");
  });

  test("honours a custom registryUrl and normalizes a trailing slash", async () => {
    //#given a mirror registry with a trailing slash
    const { fetchFn, calls } = recordingFetch(() => jsonResponse(PACKUMENT_FIXTURE));

    //#when fetching against the mirror
    await fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, {
      registryUrl: "https://mirror.example.test/npm/",
      fetchFn,
    });

    //#then the URL has a single slash before the package name
    expect(calls[0]?.url).toBe(`https://mirror.example.test/npm/${PINNED_PACKAGE_NAME}/2.15.0`);
  });

  test("encodes scoped package names for the registry path", async () => {
    //#given a scoped package name
    const { fetchFn, calls } = recordingFetch(() =>
      jsonResponse({ ...PACKUMENT_FIXTURE, name: "@scope/pkg", version: "1.0.0" }),
    );

    //#when fetching that version
    await fetchPackument("@scope/pkg", "1.0.0", { fetchFn });

    //#then the slash is percent-encoded so the scope stays a single path segment
    expect(calls[0]?.url).toBe("https://registry.npmjs.org/@scope%2fpkg/1.0.0");
  });

  test("throws RegistryError with code http and status on non-200", async () => {
    //#given a registry that answers 404
    const { fetchFn } = recordingFetch(() => jsonResponse({ error: "Not found" }, 404));

    //#when fetching the packument
    const result = fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then a typed error carries the status without leaking the body
    await expect(result).rejects.toBeInstanceOf(RegistryError);
    await expect(result).rejects.toMatchObject({ code: "http", status: 404 });
  });

  test("throws RegistryError code malformed-body on non-JSON response", async () => {
    //#given a registry returning HTML (proxy error page)
    const { fetchFn } = recordingFetch(() => new Response("<html>oops</html>", { status: 200 }));

    //#when fetching the packument
    const result = fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then parsing fails as a typed malformed-body error
    await expect(result).rejects.toMatchObject({ code: "malformed-body" });
  });

  test("throws RegistryError code malformed-body when dist.integrity is missing", async () => {
    //#given a body without an integrity digest
    const body = {
      ...PACKUMENT_FIXTURE,
      dist: { ...PACKUMENT_FIXTURE.dist, integrity: undefined },
    };
    const { fetchFn } = recordingFetch(() => jsonResponse(body));

    //#when fetching the packument
    const result = fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then the missing digest is rejected instead of returning a half-valid packument
    await expect(result).rejects.toMatchObject({ code: "malformed-body" });
  });

  test("throws RegistryError code malformed-body when version differs from the request", async () => {
    //#given a registry answering with a different version than requested
    const { fetchFn } = recordingFetch(() => jsonResponse({ ...PACKUMENT_FIXTURE, version: "2.14.0" }));

    //#when fetching 2.15.0
    const result = fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then the mismatch is rejected instead of pinning the wrong tarball
    await expect(result).rejects.toMatchObject({ code: "malformed-body" });
  });

  test("dry-run touches only the packument, never the tarball", async () => {
    //#given a dry run that resolves the pinned version
    const { fetchFn, calls } = recordingFetch(() => jsonResponse(PACKUMENT_FIXTURE));

    //#when the caller only fetches the packument
    await fetchPackument(PINNED_PACKAGE_NAME, PINNED_PACK_VERSION, { fetchFn });

    //#then no tarball download was issued
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => !call.url.endsWith(".tgz"))).toBe(true);
  });
});

describe("downloadTarball", () => {
  let workDir: string;

  beforeEach(async () => {
    //#given an isolated scratch directory
    workDir = await mkdtemp(join(tmpdir(), "skill-pack-registry-"));
  });

  afterEach(async () => {
    //#given the scratch directory created for the test
    //#when the test finishes
    //#then it is removed recursively
    await rm(workDir, { recursive: true, force: true });
  });

  test("streams the response body to destPath and reports bytes written", async () => {
    //#given a tarball endpoint serving known bytes
    const payload = new TextEncoder().encode("fake-tarball-bytes");
    const { fetchFn, calls } = recordingFetch(
      () => new Response(new Blob([payload]), { status: 200 }),
    );
    const destPath = join(workDir, "nested", "pack.tgz");

    //#when downloading the tarball
    const result = await downloadTarball("https://registry.npmjs.org/ui-ux-pro-max-cli/-/pack.tgz", destPath, {
      fetchFn,
    });

    //#then the file exists with the exact bytes and no partial remnants
    expect(calls[0]?.url).toBe("https://registry.npmjs.org/ui-ux-pro-max-cli/-/pack.tgz");
    expect(result).toEqual({ bytes: payload.byteLength, path: destPath });
    expect(new Uint8Array(await readFile(destPath))).toEqual(payload);
  });

  test("throws RegistryError and writes nothing on non-200", async () => {
    //#given a registry answering 500 for the tarball
    const { fetchFn } = recordingFetch(() => new Response("boom", { status: 500 }));
    const destPath = join(workDir, "pack.tgz");

    //#when downloading the tarball
    const result = downloadTarball("https://registry.npmjs.org/ui-ux-pro-max-cli/-/pack.tgz", destPath, {
      fetchFn,
    });

    //#then the error is typed and no destination file was created
    await expect(result).rejects.toMatchObject({ code: "http", status: 500 });
    await expect(readFile(destPath)).rejects.toBeDefined();
  });

  test("throws RegistryError code malformed-body when the response has no body", async () => {
    //#given a 200 response with an empty body
    const { fetchFn } = recordingFetch(() => new Response(null, { status: 200 }));
    const destPath = join(workDir, "empty.tgz");

    //#when downloading the tarball
    const result = downloadTarball("https://registry.npmjs.org/ui-ux-pro-max-cli/-/pack.tgz", destPath, {
      fetchFn,
    });

    //#then the empty body is reported instead of writing a zero-byte file
    await expect(result).rejects.toMatchObject({ code: "malformed-body" });
    await expect(readFile(destPath)).rejects.toBeDefined();
  });
});
