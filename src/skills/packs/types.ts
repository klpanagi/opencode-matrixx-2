import type { BuiltinSkill } from "../loader/types"

/**
 * Identifier for a bundled skill pack shipped by the `ui-ux-pro-max-cli`
 * npm distribution. One id per installable unit under `assets/skills/`.
 */
export type PackId =
  | "ui-ux-pro-max"
  | "design-system"
  | "brand"
  | "slides"
  | "banner-design"
  | "ui-styling"
  | "design"

/**
 * Discrete runtime requirement a pack may impose. Presence is exercised by the
 * installer preflight and reported by the doctor command.
 */
export type PackRisk =
  | "requiresPython"
  | "requiresNode"
  | "requiresNetwork"
  | "requiresApiKeys"

/** Static metadata describing one pack in the bundled catalog. */
export interface PackCatalogEntry {
  /** Pack identifier; also the name of its skill directory. */
  id: PackId
  /** npm package that ships this pack. */
  packageName: string
  /** Package version the catalog was pinned against. */
  version: string
  /** One-line summary shown by `pack list` / `pack status`. */
  description: string
  /** Operational caveats surfaced to the user (assets, prerequisites). */
  notes: string
  /** Core packs are installed by default and unlocked first. */
  isCore?: boolean
  /** Packs that ship guidance only, with no executable scripts. */
  refsOnly?: boolean
  /** Skill directory names provided by this pack under `skills/`. */
  skills: string[]
  /** Data/reference domains bundled under `assets/data/`. */
  domains: string[]
  /** Script entry points bundled under `assets/scripts/`. */
  scripts: string[]
  /** Runtime requirements the installer must satisfy. */
  risk: PackRisk[]
  /** Minimum Node major version when `requiresNode` is present. */
  nodeMin?: string
}

/** Per-skill record inside a {@link PackLock}. Paths are relative to the pack root. */
export interface PackSkillLock {
  /** Skill directory name, matching `skills/<name>/SKILL.md`. */
  name: string
  /** Relative path to the skill directory. */
  skillRoot: string
  /** Relative paths of the files written for this skill. */
  files: string[]
}

/** Lockfile record for one installed pack. Paths are relative to the pack root. */
export interface PackLock {
  packId: PackId
  /** Installed package version. */
  version: string
  /** Subresource-integrity digest of the installed tarball. */
  integrity: string
  /** Resolved tarball URL the integrity was verified against. */
  sourceUrl: string
  /** ISO-8601 timestamp of the install. */
  installedAt: string
  /** Relative paths of every file written by the install. */
  files: string[]
  /** Per-skill records, used to verify and uninstall individual skills. */
  skills: PackSkillLock[]
  /** Risk flags resolved at install time. */
  risks: PackRisk[]
  /** True when the pack shipped Python scripts that must remain executable. */
  pythonRequired: boolean
}

/** A pack skill resolved into the builtin skill shape, retaining provenance. */
export interface InstalledPackSkill extends BuiltinSkill {
  packId: PackId
  /** Absolute path to the installed pack root. */
  packRoot: string
  /** Absolute path to this skill's directory. */
  skillRoot: string
  /** Risk flags the skill inherits from its pack. */
  risk: PackRisk[]
  source: "pack"
}
