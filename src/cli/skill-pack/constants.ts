import { PACK_PACKAGE_NAME, PACK_PACKAGE_VERSION } from "../../skills/packs/constants";

/**
 * Registry provenance for the pinned skill-pack distribution.
 *
 * The package identity and version are re-exported from the pack constants so
 * the registry client and the installer can never drift apart. The integrity
 * digest is copied verbatim from the published packument `dist.integrity`
 * (https://registry.npmjs.org/ui-ux-pro-max-cli/2.15.0) and must not be
 * truncated or rewritten.
 */
export const PINNED_PACKAGE_NAME = PACK_PACKAGE_NAME;

export const PINNED_PACK_VERSION = PACK_PACKAGE_VERSION;

export const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

export const PINNED_INTEGRITY =
  "sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==";

