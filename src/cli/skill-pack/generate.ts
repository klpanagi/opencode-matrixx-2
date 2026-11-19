import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PACK_SKILL_FILENAME } from "../../skills/packs/constants"
import { assertSafeSkillName, sanitizePackTemplate } from "../../skills/packs/frontmatter"

/**
 * Port of the upstream `ui-ux-pro-max` skill renderer (R1), plus the aux copy
 * step that materialises the extracted `assets/skills/*` directories verbatim
 * (R4).
 *
 * The core `SKILL.md` is not shipped by the npm tarball: it is rendered from
 * `assets/templates/base/skill-content.md` driven by `platforms/opencode.json`,
 * then the core `data/` and `scripts/` trees are copied next to it. Test
 * fixtures live under `scripts/tests/` and are never installed.
 */

/** Platform descriptor mirrored from `platforms/opencode.json`. */
export interface CoreSkillPlatform {
  root: string
  skillPath: string
  filename: string
  scriptPath: string
  sections: {
    quickReference: boolean
  }
  title: string
  skillOrWorkflow: string
  frontmatter: {
    name: string
    description: string
  }
}

export interface GenerateCoreSkillOptions {
  /** Extracted pack `assets/` directory. */
  assetsDir: string
  /** Directory that will hold the generated `SKILL.md` and copied core assets. */
  coreSkillRoot: string
  /** Absolute path of the installed `scripts/search.py` (R2). */
  scriptPathAbsolute: string
  /** Parsed platform descriptor; defaults to {@link DEFAULT_CORE_SKILL_PLATFORM}. */
  platform?: CoreSkillPlatform
}

export interface GenerateCoreSkillResult {
  /** Absolute path of the generated `SKILL.md`. */
  skillFile: string
  /** Absolute script path substituted for `{{SCRIPT_PATH}}`. */
  scriptPath: string
  /** Absolute paths of every file written. */
  files: string[]
  /** The generated document. */
  content: string
}

export interface MaterializeAuxSkillsOptions {
  /** Extracted `assets/skills/` directory. */
  assetsSkillsDir: string
  /** Destination skills directory inside the installed pack. */
  destSkillsDir: string
  /** Extra skill directory names to skip. */
  excludeSkills?: string[]
}

export interface MaterializeAuxSkillsResult {
  /** Skill directory names copied, in readdir order. */
  skills: string[]
  /** Absolute paths of every file copied. */
  files: string[]
}

/** Default platform values documented for OpenCode installs. */
export const DEFAULT_CORE_SKILL_PLATFORM: CoreSkillPlatform = {
  root: ".opencode",
  scriptPath: "skills/ui-ux-pro-max/scripts/search.py",
  skillPath: "skills/ui-ux-pro-max",
  filename: PACK_SKILL_FILENAME,
  sections: { quickReference: false },
  title: "ui-ux-pro-max",
  skillOrWorkflow: "Skill",
  frontmatter: {
    name: "ui-ux-pro-max",
    description: "Design intelligence search and UI/UX reasoning for building polished interfaces.",
  },
}

const CORE_PACK_SKILL_NAME = "ui-ux-pro-max"
const CORE_COPY_DIRS = ["data", "scripts"] as const
const PLACEHOLDER_PATTERN = /\{\{[^}]*\}\}/

export class UnresolvedPlaceholderError extends Error {
  readonly code = "UNRESOLVED_PLACEHOLDER"

  constructor(readonly placeholder: string) {
    super(`Unresolved skill template placeholder: ${placeholder}`)
    this.name = "UnresolvedPlaceholderError"
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPlatformConfig(configPath: string): CoreSkillPlatform {
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"))
  if (!isRecord(raw)) return DEFAULT_CORE_SKILL_PLATFORM

  const sections = isRecord(raw.sections) ? raw.sections : {}
  const frontmatter = isRecord(raw.frontmatter) ? raw.frontmatter : {}

  return {
    root: asString(raw.root, DEFAULT_CORE_SKILL_PLATFORM.root),
    skillPath: asString(raw.skillPath, DEFAULT_CORE_SKILL_PLATFORM.skillPath),
    filename: asString(raw.filename, DEFAULT_CORE_SKILL_PLATFORM.filename),
    scriptPath: asString(raw.scriptPath, DEFAULT_CORE_SKILL_PLATFORM.scriptPath),
    sections: {
      quickReference: asBoolean(sections.quickReference, DEFAULT_CORE_SKILL_PLATFORM.sections.quickReference),
    },
    title: asString(raw.title, DEFAULT_CORE_SKILL_PLATFORM.title),
    skillOrWorkflow: asString(raw.skillOrWorkflow, DEFAULT_CORE_SKILL_PLATFORM.skillOrWorkflow),
    frontmatter: {
      name: asString(frontmatter.name, DEFAULT_CORE_SKILL_PLATFORM.frontmatter.name),
      description: asString(frontmatter.description, DEFAULT_CORE_SKILL_PLATFORM.frontmatter.description),
    },
  }
}

/**
 * Loads `<assetsDir>/../platforms/opencode.json` when the tarball ships one,
 * otherwise returns the documented OpenCode defaults.
 */
export function loadCoreSkillPlatform(assetsDir: string): CoreSkillPlatform {
  const configPath = join(assetsDir, "..", "platforms", "opencode.json")
  if (!existsSync(configPath)) return DEFAULT_CORE_SKILL_PLATFORM
  return readPlatformConfig(configPath)
}

function needsQuoting(value: string): boolean {
  return value.includes(":") || value.includes('"') || value.includes("\n")
}

function renderScalar(value: string): string {
  if (!needsQuoting(value)) return value
  const escaped = value.replace(/"/g, '\\"').replace(/\n/g, "\\n")
  return `"${escaped}"`
}

/** Renders the leading `---` block, quoting only YAML-significant scalars. */
export function renderFrontmatter(frontmatter: { name: string; description: string }): string {
  return ["---", `name: ${renderScalar(frontmatter.name)}`, `description: ${renderScalar(frontmatter.description)}`, "---", ""].join(
    "\n",
  )
}

/**
 * Copies `sourceDir` into `destDir` recursively, skipping files whose
 * destination-relative path matches `shouldSkip`.
 */
function copyTree(sourceDir: string, destDir: string, relativeDir: string, shouldSkip: (relativePath: string) => boolean): string[] {
  const files: string[] = []
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name
    if (shouldSkip(relativePath)) continue

    const sourcePath = join(sourceDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      files.push(...copyTree(sourcePath, destPath, relativePath, shouldSkip))
    } else if (entry.isFile()) {
      mkdirSync(destDir, { recursive: true })
      copyFileSync(sourcePath, destPath)
      files.push(destPath)
    }
  }
  return files
}

function isCoreTestScript(relativePath: string): boolean {
  return relativePath === "scripts/tests" || relativePath.startsWith("scripts/tests/")
}

function isAuxTestScript(relativePath: string): boolean {
  return /(^|\/)scripts\/tests(\/|$)/.test(relativePath)
}

function copyCoreAssets(assetsDir: string, coreSkillRoot: string): string[] {
  const files: string[] = []
  for (const dirName of CORE_COPY_DIRS) {
    const sourceDir = join(assetsDir, dirName)
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) continue
    files.push(...copyTree(sourceDir, join(coreSkillRoot, dirName), dirName, isCoreTestScript))
  }
  return files
}

function assertNoPlaceholders(document: string): void {
  const match = PLACEHOLDER_PATTERN.exec(document)
  if (match) throw new UnresolvedPlaceholderError(match[0])
}

/**
 * Generates the core `SKILL.md` and copies its runtime assets.
 *
 * Upstream renders a project-relative script path:
 * `rootedScriptPath = (root + "/" + scriptPath).replace(/\/{2,}/g, "/")`, then
 * prefixes `~/` for global installs. R2 overrides that: the installed pack
 * lives outside the project, so `{{SCRIPT_PATH}}` always receives the absolute
 * `scriptPathAbsolute` and the skill stays cwd-independent.
 */
export function generateCoreSkill(options: GenerateCoreSkillOptions): GenerateCoreSkillResult {
  const { assetsDir, coreSkillRoot, scriptPathAbsolute } = options
  const platform = options.platform ?? loadCoreSkillPlatform(assetsDir)
  const templatesDir = join(assetsDir, "templates", "base")

  let content = readFileSync(join(templatesDir, "skill-content.md"), "utf-8")
  const quickReference = platform.sections.quickReference
    ? readFileSync(join(templatesDir, "quick-reference.md"), "utf-8")
    : ""

  // Five global replacements in the upstream order.
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ["{{TITLE}}", platform.title],
    ["{{DESCRIPTION}}", platform.frontmatter.description],
    ["{{SCRIPT_PATH}}", scriptPathAbsolute],
    ["{{SKILL_OR_WORKFLOW}}", platform.skillOrWorkflow],
    ["{{QUICK_REFERENCE}}", `\n${quickReference}`],
  ]
  for (const [placeholder, value] of replacements) {
    content = content.split(placeholder).join(value)
  }

  const document = sanitizePackTemplate(`${renderFrontmatter(platform.frontmatter)}${content}`, { coreSkillRoot })
  assertNoPlaceholders(document)

  mkdirSync(coreSkillRoot, { recursive: true })
  const skillFile = join(coreSkillRoot, platform.filename)
  writeFileSync(skillFile, document, "utf-8")

  return {
    skillFile,
    scriptPath: scriptPathAbsolute,
    files: [skillFile, ...copyCoreAssets(assetsDir, coreSkillRoot)],
    content: document,
  }
}

/**
 * Copies every `<assetsSkillsDir>/<name>/` directory verbatim into
 * `destSkillsDir`, excluding the core pack (generated separately), explicit
 * exclusions, and any `scripts/tests/` tree (R4).
 */
export function materializeAuxSkills(options: MaterializeAuxSkillsOptions): MaterializeAuxSkillsResult {
  const { assetsSkillsDir, destSkillsDir } = options
  if (!existsSync(assetsSkillsDir)) return { skills: [], files: [] }

  const excluded = new Set<string>([CORE_PACK_SKILL_NAME, ...(options.excludeSkills ?? [])])
  const skills: string[] = []
  const files: string[] = []

  mkdirSync(destSkillsDir, { recursive: true })
  for (const entry of readdirSync(assetsSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || excluded.has(entry.name)) continue
    assertSafeSkillName(entry.name)
    skills.push(entry.name)
    files.push(
      ...copyTree(join(assetsSkillsDir, entry.name), join(destSkillsDir, entry.name), entry.name, isAuxTestScript),
    )
  }

  return { skills, files }
}
