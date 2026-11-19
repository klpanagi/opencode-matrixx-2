import type { PackId } from "./types"

/**
 * Skill pack provenance constants: the shipping npm package, the pinned
 * version, and the on-disk layout shared by the installer and doctor.
 */
export const PACK_PACKAGE_NAME = "ui-ux-pro-max-cli"

export const PACK_PACKAGE_VERSION = "2.15.0"

export const CORE_PACK_ID: PackId = "ui-ux-pro-max"

export const PACK_ASSETS_DIRNAME = "assets"

export const PACK_SKILLS_DIRNAME = "skills"

export const PACK_SKILL_FILENAME = "SKILL.md"
