import { PACK_PACKAGE_NAME, PACK_PACKAGE_VERSION } from "./constants"
import type { PackCatalogEntry, PackId } from "./types"

/**
 * Static pack catalog shipped with the plugin. Every entry mirrors one
 * installable unit of the `ui-ux-pro-max-cli` tarball (`assets/{data,scripts,skills,templates}`).
 */
const UI_UX_PRO_MAX: PackCatalogEntry = {
  id: "ui-ux-pro-max",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "Core design-intelligence search and UI/UX reasoning skill.",
  notes:
    "Core pack: installs first and provides search.py used by auxiliary packs. Requires a Python 3 interpreter.",
  isCore: true,
  skills: ["ui-ux-pro-max"],
  domains: [
    "colors",
    "typography",
    "styles",
    "ux-guidelines",
    "ui-reasoning",
    "charts",
    "landing-pages",
    "products",
  ],
  scripts: ["search.py", "design_system.py"],
  risk: ["requiresPython"],
}

const DESIGN_SYSTEM: PackCatalogEntry = {
  id: "design-system",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "Token, theme, and component scaffold generation.",
  notes: "Generates design tokens and component scaffolds through Node.",
  skills: ["design-system"],
  domains: ["tokens", "themes", "components"],
  scripts: ["design_system.js"],
  risk: ["requiresNode"],
}

const BRAND: PackCatalogEntry = {
  id: "brand",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "Brand identity, logo direction, and voice guidance.",
  notes: "Brand generation runs through Node.",
  skills: ["brand"],
  domains: ["brand-identity", "logo", "voice"],
  scripts: ["brand.js"],
  risk: ["requiresNode"],
}

const SLIDES: PackCatalogEntry = {
  id: "slides",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "Reference guidance for building presentation decks.",
  notes: "Reference-only pack: ships guidance files, no executable scripts.",
  refsOnly: true,
  skills: ["slides"],
  domains: ["presentation", "layout"],
  scripts: [],
  risk: [],
}

const BANNER_DESIGN: PackCatalogEntry = {
  id: "banner-design",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "Reference guidance for banner composition and sizing.",
  notes: "Reference-only pack: ships guidance files, no executable scripts.",
  refsOnly: true,
  skills: ["banner-design"],
  domains: ["banners", "layout"],
  scripts: [],
  risk: [],
}

const UI_STYLING: PackCatalogEntry = {
  id: "ui-styling",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "CSS, Tailwind, and font styling helpers.",
  notes:
    "Fonts are not bundled (R3); the pack fetches them over the network, so Node 18 or newer is required.",
  skills: ["ui-styling"],
  domains: ["css", "tailwind", "styling"],
  scripts: ["fetch-fonts.js"],
  risk: ["requiresNode", "requiresNetwork"],
  nodeMin: "18",
}

const DESIGN: PackCatalogEntry = {
  id: "design",
  packageName: PACK_PACKAGE_NAME,
  version: PACK_PACKAGE_VERSION,
  description: "API-backed design review and image-generation workflows.",
  notes:
    "Requires provider API keys, network access, and a Python 3 interpreter for the design client.",
  skills: ["design"],
  domains: ["design-review", "image-generation"],
  scripts: ["design.py"],
  risk: ["requiresApiKeys", "requiresNetwork", "requiresPython"],
}

export const PACK_CATALOG: readonly PackCatalogEntry[] = [
  UI_UX_PRO_MAX,
  DESIGN_SYSTEM,
  BRAND,
  SLIDES,
  BANNER_DESIGN,
  UI_STYLING,
  DESIGN,
]

export const PACK_CATALOG_BY_ID: Record<PackId, PackCatalogEntry> = {
  "ui-ux-pro-max": UI_UX_PRO_MAX,
  "design-system": DESIGN_SYSTEM,
  brand: BRAND,
  slides: SLIDES,
  "banner-design": BANNER_DESIGN,
  "ui-styling": UI_STYLING,
  design: DESIGN,
}
